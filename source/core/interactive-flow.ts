/**
 * `clone` and `init` as one continuous interactive session: ask the questions,
 * let the user review, then do all the work as named steps, then offer to push.
 * Nothing is created until the review is confirmed, and nothing is pushed unless
 * the user says so.
 *
 * The two commands differ only in how they prepare a project (clone it, or
 * inspect and repair it), so each supplies a `prepare` function and this module
 * does the rest: the config, the setup branch, validation, the commit, the
 * result, and what to do when a step fails or the user cancels.
 */
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename, join, relative} from 'node:path';
import process from 'node:process';
import {agentIds} from './agents.js';
import {upCommand} from './generate/aliases.js';
import {compose, expectedHooks} from './generate/index.js';
import {
	canOpenPullRequest,
	compareUrl,
	createPullRequest,
	publishCommands,
} from './gh.js';
import {addWorktree, commitPath, withoutPrompts} from './git.js';
import {resumeCommand, undoCommands} from './journal.js';
import {
	describePullRequest,
	destinationLabel,
	pullRequestProblem,
	pushProblem,
} from './publish.js';
import type {ParsedRemote} from './repo.js';
import {
	installedAgents,
	resolve,
	setupFieldOrder,
	setupFlagsFromCli,
	type SetupField,
	type SetupValues,
} from './resolve.js';
import {
	badUsage,
	exitCodes,
	operationFailed,
	succeed,
	userAborted,
	type Outcome,
} from './result.js';
import type {
	ConfigureRequest,
	FinishRequest,
	NextStep,
	ResultLine,
	Session,
	StepDefinition,
	TerminalUi,
} from './session.js';
import {assertSettings, type Settings} from './settings.js';
import {validateGeneratedConfig} from './validate.js';
import {trunkVersion} from './version.js';
import {
	commitMessage,
	configPath,
	errorMessage,
	locateWorktree,
	outputOf,
	readExistingConfig,
	rollback,
	setupBranch,
	today,
	writeConfig,
	type SetupContext,
} from './pipeline.js';

/** Raised when the user cancels; the run stops at the next step boundary. */
class AbortedRun extends Error {}

/** A step that did not complete, carrying the reason to show. */
class StepFailure extends Error {
	constructor(readonly stepId: string, message: string) {
		super(message);
		this.name = 'StepFailure';
	}
}

export type StepWork<T> = () => Promise<{value: T; detail?: string}>;

export type PrepareEnvironment = Readonly<{
	context: SetupContext;
	/** Runs one named step: marks it active, then done or failed, with timings. */
	step: <T>(id: string, work: StepWork<T>) => Promise<T>;
}>;

export type FlowPlan = Readonly<{
	command: 'clone' | 'init';
	remote?: ParsedRemote;
	/** Seeds the suggested prefix. */
	repoName: string;
	/** The right side of the header. */
	project: string;
	projectDirectory: string;
	gitDirectory: string;
	/** Known before any work for `init`; a clone learns it after cloning. */
	defaultBranch?: string;
	/** For a clone: asks the remote for its default branch while the questions run. */
	probeDefaultBranch?: () => Promise<string | undefined>;
	/** The steps before the shared ones, in order. */
	prepareSteps: readonly StepDefinition[];
	prepare: (
		environment: PrepareEnvironment,
	) => Promise<{defaultWorktree: string; defaultBranch: string}>;
}>;

/** A path as the user would type it: relative to home when it lives there. */
export function displayPath(path: string): string {
	const home = homedir();
	return path === home || path.startsWith(`${home}/`)
		? `~${path.slice(home.length)}`
		: path;
}

function flagFor(field: SetupField, values: SetupValues): string {
	switch (field) {
		case 'prefix': {
			return '--prefix';
		}

		case 'agents': {
			return '--agents';
		}

		case 'tmux': {
			return values.tmux ? '--tmux' : '--no-tmux';
		}

		case 'copyIgnored': {
			return values.copyIgnored ? '--copy' : '--no-copy';
		}

		case 'mcAlias': {
			return values.mcAlias ? '--mc' : '--no-mc';
		}
	}
}

/**
 * Whether the user's Worktrunk config already says where worktrees go. Trunk
 * creates them beside the bare repository, which Worktrunk only reproduces once
 * told, so the result card mentions it until it has been.
 */
export async function worktreePathConfigured(
	environment: NodeJS.ProcessEnv,
): Promise<boolean> {
	const path =
		environment['WORKTRUNK_CONFIG_PATH'] ??
		join(
			environment['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'),
			'worktrunk',
			'config.toml',
		);
	try {
		const text = await readFile(path, 'utf8');
		return text.includes('worktree-path');
	} catch {
		return false;
	}
}

export async function runInteractiveSetup(
	base: SetupContext,
	terminal: TerminalUi,
	plan: FlowPlan,
): Promise<Outcome> {
	const {flags} = base;
	// Bad flags are a usage error, decided before anything is drawn.
	let resolution;
	try {
		resolution = resolve({
			fixed: {
				trunkVersion: trunkVersion(),
				generatedOn: today(base.now()),
				repoName: plan.repoName,
			},
			flags: setupFlagsFromCli(flags),
			tools: base.tools,
		});
	} catch (error: unknown) {
		return badUsage(errorMessage(error));
	}

	const {draft} = resolution;
	const values: SetupValues = {
		prefix: draft.prefix,
		tmux: draft.tmux,
		agents: draft.agents,
		copyIgnored: draft.copyIgnored,
		mcAlias: draft.mcAlias,
	};
	const fromFlags: Partial<Record<SetupField, string>> = {};
	for (const field of setupFieldOrder) {
		if (resolution.sources[field] === 'flag') {
			fromFlags[field] = flagFor(field, values);
		}
	}

	// A clone cannot know the default branch until it has cloned, but the review
	// can name it if the remote is asked while the questions are being answered.
	let probed: string | undefined;
	if (plan.probeDefaultBranch !== undefined) {
		void (async () => {
			probed = await plan.probeDefaultBranch?.();
		})();
	}

	const installed = installedAgents(base.tools);
	const rootName = basename(plan.projectDirectory);
	const request: ConfigureRequest = {
		command: plan.command,
		project: plan.project,
		rootName,
		destination: displayPath(plan.projectDirectory),
		defaultBranch: plan.defaultBranch,
		probedDefaultBranch: () => probed,
		direct: flags.direct ?? false,
		values,
		fromFlags,
		installedAgents: installed,
		missingAgents: agentIds.filter(id => !installed.includes(id)),
		tmuxInstalled: base.tools.tmux.path !== undefined,
		toSettings(answers) {
			const settings: Settings = {
				trunkVersion: draft.trunkVersion,
				generatedOn: draft.generatedOn,
				prefix: answers.prefix,
				tmux: answers.tmux,
				agents: answers.agents,
				copyIgnored: answers.copyIgnored,
				mcAlias: answers.mcAlias,
			};
			assertSettings(settings);
			return Object.freeze(settings);
		},
	};

	// Anything reported while the UI owns the screen would corrupt it, so plain
	// lines wait until the UI has closed.
	const buffered: Array<
		readonly ['success' | 'error' | 'info' | 'warning', string]
	> = [];
	const context: SetupContext = {
		...base,
		report(kind, line) {
			buffered.push([kind, line]);
		},
	};
	const session = await terminal.session();
	try {
		return await runSession(context, session, plan, request);
	} finally {
		await session.close();
		for (const [kind, line] of buffered) {
			base.report(kind, line);
		}
	}
}

async function runSession(
	context: SetupContext,
	session: Session,
	plan: FlowPlan,
	request: ConfigureRequest,
): Promise<Outcome> {
	const {direct} = request;
	const setupLabel = direct
		? 'Commit on the default branch'
		: `Commit on ${setupBranch}`;
	const definitions: readonly StepDefinition[] = [
		...plan.prepareSteps,
		{
			id: 'generate',
			label: 'Generate configuration',
			detail: `your choices ${'→'} ${configPath}`,
		},
		{
			id: 'validate',
			label: 'Validate with Worktrunk',
			detail: 'wt config show',
		},
		{id: 'commit', label: setupLabel, detail: 'Add worktree automation'},
	];
	const labels = new Map(
		definitions.map(definition => [definition.id, definition.label]),
	);
	let current = 'configure';

	const step = async <T>(id: string, work: StepWork<T>): Promise<T> => {
		if (session.aborted()) {
			throw new AbortedRun();
		}

		current = id;
		session.update(id, 'active');
		try {
			const result = await work();
			session.update(id, 'done', result.detail);
			return result.value;
		} catch (error: unknown) {
			if (error instanceof AbortedRun) {
				throw error;
			}

			session.update(id, 'failed');
			throw error instanceof StepFailure
				? error
				: new StepFailure(id, errorMessage(error));
		}
	};

	try {
		const settings = await session.configure(request);
		if (settings === undefined) {
			return userAborted();
		}

		session.start(definitions, plan.command, plan.project);
		const {defaultWorktree} = await plan.prepare({context, step});

		const generated = compose(settings);
		const existing = await readExistingConfig(defaultWorktree);
		const placed = await step('generate', async () => {
			let worktree = defaultWorktree;
			let branch: string | undefined;
			if (existing !== undefined) {
				const answer = await session.overwrite({
					command: plan.command,
					project: plan.project,
					path: configPath,
					existing,
					generated,
				});
				if (answer === undefined) {
					throw new AbortedRun();
				}

				if (answer === 'keep') {
					return {
						value: {written: false, worktree, branch},
						detail: 'kept your file',
					};
				}

				// The decision is not work: start the step's clock again.
				session.update('generate', 'active');
			}

			if (!direct) {
				const target = join(
					plan.projectDirectory,
					setupBranch.replaceAll('/', '-'),
				);
				context.journal.record({
					kind: 'branch-worktree',
					path: target,
					branch: setupBranch,
					note: 'wt.toml uncommitted',
				});
				const created = await addWorktree(
					plan.gitDirectory,
					target,
					setupBranch,
					{
						...context.git,
						createBranch: true,
					},
				);
				if (created.code !== 0) {
					throw new StepFailure(
						'generate',
						`could not create the ${setupBranch} worktree: ${outputOf(
							created,
						)}`,
					);
				}

				worktree = await locateWorktree(
					plan.gitDirectory,
					target,
					context.git,
					setupBranch,
				);
				if (worktree !== target) {
					context.journal.relocate(target, worktree);
				}

				branch = setupBranch;
			}

			await writeConfig(worktree, settings);
			return {
				value: {written: true, worktree, branch},
				detail: existing === undefined ? configPath : `${configPath} replaced`,
			};
		});
		const {worktree, branch} = placed;

		if (!placed.written) {
			session.update('validate', 'skipped', 'nothing changed');
			session.update('commit', 'skipped', 'nothing to commit');
			return await finish(context, session, plan, settings, {
				title: 'Kept your existing config',
				worktree: defaultWorktree,
				branch: undefined,
				defaultWorktree,
				changed: false,
			});
		}

		await step('validate', async () => {
			try {
				await validateGeneratedConfig(worktree, settings, {
					wtPath: context.wtPath,
					env: context.env,
				});
			} catch (error: unknown) {
				throw new StepFailure('validate', errorMessage(error));
			}

			const hooks = expectedHooks(settings).length;
			return {
				value: undefined,
				detail:
					hooks > 0 ? `${hooks} hooks expand cleanly` : 'wt accepted the file',
			};
		});

		await step('commit', async () => {
			const committed = await commitPath(
				worktree,
				configPath,
				commitMessage(settings),
				context.git,
			);
			if (committed.code !== 0) {
				throw new StepFailure(
					'commit',
					`commit failed: ${outputOf(committed)}`,
				);
			}

			context.journal.annotate(worktree, 'wt.toml committed');
			return {value: undefined, detail: commitMessage(settings).split('\n')[0]};
		});

		return await finish(context, session, plan, settings, {
			title: `${request.rootName} is ready`,
			worktree,
			branch,
			defaultWorktree,
			changed: true,
		});
	} catch (error: unknown) {
		return handleFailure(
			context,
			session,
			plan,
			error,
			labels.get(current) ?? current,
		);
	}
}

type FinishInput = Readonly<{
	title: string;
	worktree: string;
	branch: string | undefined;
	defaultWorktree: string;
	changed: boolean;
}>;

async function finish(
	context: SetupContext,
	session: Session,
	plan: FlowPlan,
	settings: Settings,
	input: FinishInput,
): Promise<Outcome> {
	const next: NextStep[] = [{command: `cd ${displayPath(input.worktree)}`}];
	const hasCommands =
		expectedHooks(settings).length > 0 ||
		settings.mcAlias ||
		upCommand(settings) !== undefined;
	if (hasCommands) {
		next.push({
			command: 'wt config approvals add',
			note: 'review and approve the hooks',
		});
	}

	if (upCommand(settings) !== undefined) {
		next.push({
			command: 'wt up',
			note: settings.tmux ? 'start the tmux workspace' : 'run the start hooks',
		});
	}

	const {remote} = plan;
	if (input.changed && input.branch !== undefined && remote === undefined) {
		next.push({
			command: `git -C ${displayPath(input.defaultWorktree)} merge ${
				input.branch
			}`,
			note: 'there is no origin, so merge it yourself',
		});
	}

	const notes: string[] = [];
	if (
		input.changed &&
		!(await worktreePathConfigured(context.env ?? process.env))
	) {
		notes.push(
			'Worktrunk does not know where worktrees go yet. Run `wt switch <branch>` once.',
		);
	}

	const {branch} = input;
	const pushable =
		input.changed && remote !== undefined && branch !== undefined;
	const withPullRequest =
		remote !== undefined &&
		canOpenPullRequest(remote, context.tools.gh.path !== undefined);
	const request: FinishRequest = {
		command: plan.command,
		project: plan.project,
		title: input.title,
		next,
		notes,
		push:
			pushable && branch !== undefined
				? {branch, label: withPullRequest ? 'Push and open PR' : 'Push branch'}
				: undefined,
	};
	const answer = await session.finish(request);
	if (answer === 'push' && remote !== undefined && branch !== undefined) {
		await publish(
			context,
			session,
			remote,
			input.worktree,
			branch,
			withPullRequest,
		);
	} else if (
		answer === 'skip' &&
		branch !== undefined &&
		remote !== undefined
	) {
		session.result([
			{ok: true, text: 'Kept it local.'},
			{
				ok: true,
				plain: true,
				text: `When you are ready: ${
					publishCommands(branch, withPullRequest)[0] ?? ''
				}`,
			},
		]);
	}

	return session.aborted() ? userAborted() : succeed();
}

/**
 * Pushes the setup branch and, when it can, opens a pull request, as two steps
 * the screen shows while they run. Neither command may ask a question: both run
 * with prompts off, so a bad key or token fails at once with a card the user can
 * read, and both stop when the user presses Ctrl+C.
 */
async function publish(
	context: SetupContext,
	session: Session,
	remote: ParsedRemote,
	worktree: string,
	branch: string,
	withPullRequest: boolean,
): Promise<void> {
	const signal = session.publishStart({
		branch,
		destination: destinationLabel(remote),
		withPullRequest,
	});
	const environment = withoutPrompts(context.env ?? process.env);
	const compare = compareUrl(remote, branch);
	const [pushCommand = '', pullRequestCommand = ''] = publishCommands(
		branch,
		withPullRequest,
	);
	const command = (text: string): ResultLine => ({
		ok: true,
		plain: true,
		text: '',
		command: text,
	});
	const stopped = (again: string): ResultLine[] => [
		{
			ok: false,
			tone: 'warning',
			text: 'Stopped waiting. Check with git status -sb, or run it later:',
		},
		command(again),
	];
	const kept = (again: string): ResultLine[] => [
		{ok: true, text: 'Kept it local.'},
		{ok: true, plain: true, text: 'When you are ready: ', command: again},
	];

	let pushed = false;
	for (;;) {
		if (!pushed) {
			session.publishUpdate('push', 'active');
			// eslint-disable-next-line no-await-in-loop
			const result = await context.run(
				context.git.gitPath ?? 'git',
				['-C', worktree, 'push', '-u', 'origin', branch],
				{env: environment, signal},
			);
			if (result.aborted === true || signal.aborted) {
				session.publishUpdate('push', 'cancelled');
				session.publishEnd(stopped(pushCommand));
				return;
			}

			if (result.code !== 0) {
				session.publishUpdate('push', 'failed');
				// eslint-disable-next-line no-await-in-loop
				const answer = await session.publishProblem(
					pushProblem(outputOf(result), remote, branch),
				);
				if (answer === 'retry') {
					continue;
				}

				session.publishEnd(kept(pushCommand));
				return;
			}

			pushed = true;
			session.publishUpdate('push', 'done');
		}

		if (!withPullRequest) {
			session.publishEnd(
				compare === undefined
					? []
					: [
							{
								ok: true,
								plain: true,
								text: 'Open a pull request  ',
								link: compare,
							},
					  ],
			);
			return;
		}

		session.publishUpdate('pr', 'active');
		// eslint-disable-next-line no-await-in-loop
		const pullRequest = await createPullRequest(worktree, {
			ghPath: context.tools.gh.path,
			run: context.run,
			env: environment,
			signal,
		});
		if (pullRequest.aborted === true || signal.aborted) {
			session.publishUpdate('pr', 'cancelled');
			session.publishEnd(stopped(pullRequestCommand));
			return;
		}

		if (pullRequest.code !== 0) {
			session.publishUpdate('pr', 'warned');
			// eslint-disable-next-line no-await-in-loop
			const answer = await session.publishProblem(
				pullRequestProblem(outputOf(pullRequest), compare),
			);
			if (answer === 'retry') {
				continue;
			}

			session.publishEnd(kept(pullRequestCommand));
			return;
		}

		session.publishUpdate(
			'pr',
			'done',
			describePullRequest(outputOf(pullRequest)),
		);
		session.publishEnd([
			{
				ok: true,
				plain: true,
				text: 'Open it with  ',
				command: 'gh pr view --web',
			},
		]);
		return;
	}
}

/** Cancel, or a step that failed: show what exists and let the user keep or undo it. */
async function handleFailure(
	context: SetupContext,
	session: Session,
	plan: FlowPlan,
	error: unknown,
	label: string,
): Promise<Outcome> {
	const {journal} = context;
	const resume = resumeCommand(plan.projectDirectory, context.cwd);
	const undo = undoCommands(
		journal,
		plan.projectDirectory,
		context.wtPath,
		context.git.gitPath ?? 'git',
	);
	const reportKept = () => {
		if (!journal.isEmpty) {
			context.report('info', 'created by this run:');
			for (const line of journal.describe(context.cwd)) {
				context.report('info', `  ${line}`);
			}

			context.report('info', `resume: ${resume}`);
		}
	};

	if (error instanceof AbortedRun || session.aborted()) {
		reportKept();
		return userAborted();
	}

	const message = errorMessage(error);
	// A rejected config is the one failure with its own wording: what wt said, under a lead-in.
	const rejection = 'Worktrunk rejected the generated config.';
	const rejected =
		error instanceof StepFailure &&
		error.stepId === 'validate' &&
		message.startsWith(rejection);
	const rows = journal.rows(context.cwd);
	const created = journal.entries.map((entry, index) => ({
		path:
			entry.path === plan.projectDirectory
				? `${basename(plan.projectDirectory)}/`
				: `${relative(plan.projectDirectory, entry.path)}/`,
		description: rows[index]?.description ?? '',
	}));
	const answer = await session.fail({
		command: plan.command,
		project: plan.project,
		title: rejected
			? rejection.replace(/\.$/, '')
			: error instanceof StepFailure
			? `${label} failed`
			: 'Setup stopped',
		detail: rejected
			? `wt config show reported:\n${message.slice(rejection.length).trim()}`
			: message,
		created,
		resume,
		rollback: !journal.isEmpty,
	});
	if (answer === 'rollback') {
		// The outcome is drawn under the steps, so nothing is printed afterwards.
		const removed: ResultLine[] = [];
		await rollback(
			{
				...context,
				report(kind, text) {
					removed.push(
						kind === 'info'
							? {ok: true, plain: true, text}
							: {
									ok: kind === 'success',
									text: `${text.replace(/^remove /, 'Removed ')}${
										kind === 'success' ? '.' : ''
									}`,
							  },
					);
				},
			},
			plan.projectDirectory,
			undo,
		);
		session.result(removed);
		return {code: exitCodes.userAborted};
	}

	// The failure card disappears when the steps come back, so what it said about
	// how to resume is repeated under them.
	session.result([
		{ok: true, text: 'Kept everything this run created.'},
		{ok: true, plain: true, text: `Resume later with ${resume}`},
	]);
	return operationFailed(message.split('\n')[0] ?? 'setup failed');
}
