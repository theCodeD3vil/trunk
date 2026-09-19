/**
 * `trunk-cli init [dir]`: set up a project that is already on disk in the bare
 * layout — cloned by hand, already using worktrunk, created without any remote,
 * or left behind by an interrupted `trunk-cli clone`.
 *
 * Everything from the existing-config question onward is the same code
 * `trunk-cli clone` runs. What is specific here is finding the project, refusing a
 * plain clone or an empty repository, and repairing whatever a hand-made setup
 * is missing.
 */
import {basename, join, resolve as resolvePath} from 'node:path';
import type {CliFlags} from '../core/arguments.js';
import type {ToolProbe} from '../core/env.js';
import {
	addWorktree,
	configureOriginFetch,
	existingDefaultBranch,
	isEmptyRepository,
	listWorktrees,
	originFetchRefspec,
	remoteDefaultBranch,
	runGit,
	setHeadBranch,
	type GitOptions,
} from '../core/git.js';
import {
	configureProject,
	createContext,
	errorMessage,
	interrupted,
	locateWorktree,
	warnAboutWorktreePath,
	type SetupContext,
	type SetupDependencies,
} from '../core/pipeline.js';
import {
	detectLayout,
	loadSshAliases,
	parseRemote,
	type ParsedRemote,
	type RepositoryLayout,
} from '../core/repo.js';
import {
	badUsage,
	exitCodes,
	unsupportedEnvironment,
	type Outcome,
} from '../core/result.js';
import {
	displayPath,
	runInteractiveSetup,
	type FlowPlan,
} from '../core/interactive-flow.js';
import {switchAttached} from '../core/wt.js';

export type {SetupDependencies as InitDependencies} from '../core/pipeline.js';

export async function runInit(
	arguments_: readonly string[],
	flags: CliFlags,
	tools: ToolProbe,
	dependencies: SetupDependencies = {},
): Promise<Outcome> {
	const [directory, ...extra] = arguments_;
	if (extra.length > 0) {
		return badUsage(`unexpected argument: ${extra[0]!}`);
	}

	const context = createContext(flags, tools, dependencies);
	const target = resolvePath(context.cwd, directory ?? '.');
	const layout = await detectLayout(target, context.git);

	switch (layout.kind) {
		case 'plain-clone': {
			return refusePlainClone(context, layout);
		}

		case 'empty': {
			return badUsage(
				`${target} holds no repository; use \`trunk-cli clone <url> ${
					directory ?? '<dir>'
				}\` instead`,
			);
		}

		case 'occupied': {
			return badUsage(`${target} is not a git repository`);
		}

		default: {
			break;
		}
	}

	const projectDirectory = layout.projectRoot ?? target;
	const gitDirectory = layout.gitDir ?? join(projectDirectory, '.git');

	try {
		return await setUpExisting(context, projectDirectory, gitDirectory);
	} catch (error: unknown) {
		return interrupted(context, projectDirectory, errorMessage(error));
	}
}

async function setUpExisting(
	context: SetupContext,
	projectDirectory: string,
	gitDirectory: string,
): Promise<Outcome> {
	// The origin is optional: a project that never had one is still a project.
	// Without it the folder name is the only name there is.
	const url = await originUrl(gitDirectory, context.git);
	let remote: ParsedRemote | undefined;
	if (url) {
		try {
			remote = parseRemote(url, await loadSshAliases(), context.cwd);
		} catch (error: unknown) {
			return badUsage(errorMessage(error));
		}
	}

	const repoName = remote?.repo ?? basename(projectDirectory);
	const terminal = context.terminalUi ? await context.terminalUi() : undefined;
	if (terminal && context.interactive) {
		// Reads only: nothing is repaired or created until the review is confirmed.
		const known = await existingDefaultBranch(gitDirectory, context.git);
		if (!remote) {
			if (known === undefined) {
				return badUsage(
					`${projectDirectory} has no default branch and no origin to ask; check out a branch first`,
				);
			}

			if (await isEmptyRepository(gitDirectory, context.git)) {
				await terminal.refuse({
					kind: 'empty-repository',
					name: basename(projectDirectory),
					rerun: `trunk-cli init ${displayPath(projectDirectory)}`,
				});
				return {code: exitCodes.badUsage};
			}
		}

		return runInteractiveSetup(
			context,
			terminal,
			initPlan(remote, repoName, projectDirectory, gitDirectory, known),
		);
	}

	const defaultBranch = await repairDefaultBranch(
		context,
		gitDirectory,
		remote,
	);
	if (!defaultBranch) {
		return badUsage(
			`${projectDirectory} has no default branch and no origin to ask; check out a branch first`,
		);
	}

	if (remote) {
		await repairFetchRefspec(context, gitDirectory);
	}

	// Trunk sets up projects and never invents history: with nothing to check
	// out there is no worktree to configure, and a first commit is the user's.
	if (await isEmptyRepository(gitDirectory, context.git)) {
		if (terminal) {
			await terminal.refuse({
				kind: 'empty-repository',
				name: basename(projectDirectory),
				rerun: `trunk-cli init ${displayPath(projectDirectory)}`,
			});
			return {code: exitCodes.badUsage};
		}

		return badUsage(
			`${projectDirectory} is an empty bare repository with no commits; make the first commit yourself, then run \`trunk-cli init\` again`,
		);
	}

	const defaultWorktree = await ensureWorktree(
		context,
		{
			remote,
			projectDirectory,
			gitDirectory,
			branch: defaultBranch,
		},
		{attached: context.interactive, warn: true},
	);
	if (!defaultWorktree) {
		return interrupted(
			context,
			projectDirectory,
			`could not create the ${defaultBranch} worktree`,
		);
	}

	return configureProject(context, {
		remote,
		repoName,
		projectDirectory,
		gitDirectory,
		defaultWorktree,
	});
}

/** The interactive run of `init`: inspect and repair, then the shared steps. */
function initPlan(
	remote: ParsedRemote | undefined,
	repoName: string,
	projectDirectory: string,
	gitDirectory: string,
	knownBranch: string | undefined,
): FlowPlan {
	const root = basename(projectDirectory);
	return {
		command: 'init',
		remote,
		repoName,
		project:
			remote?.kind === 'hosted' ? `${remote.owner}/${remote.repo}` : repoName,
		projectDirectory,
		gitDirectory,
		defaultBranch: knownBranch,
		prepareSteps: [
			{id: 'inspect', label: 'Inspect project', detail: 'bare layout'},
			{
				id: 'worktree',
				label: 'Prepare worktree',
				detail: knownBranch === undefined ? root : `${root}/${knownBranch}`,
			},
		],
		async prepare({context, step}) {
			const branch = await step('inspect', async () => {
				const name = await repairDefaultBranch(context, gitDirectory, remote);
				if (name === undefined) {
					throw new Error(
						'the project has no default branch and no origin to ask; check out a branch first',
					);
				}

				if (remote) {
					await repairFetchRefspec(context, gitDirectory);
				}

				if (await isEmptyRepository(gitDirectory, context.git)) {
					throw new Error(
						'this is an empty bare repository with no commits; make the first commit yourself, then run `trunk-cli init` again',
					);
				}

				return {value: name, detail: `bare layout \u00B7 ${name}`};
			});
			const defaultWorktree = await step('worktree', async () => {
				const found = await ensureWorktree(
					context,
					{remote, projectDirectory, gitDirectory, branch},
					// Plain git only: a wt prompt would tear the screen apart.
					{attached: false, warn: false},
				);
				if (found === undefined) {
					throw new Error(`could not create the ${branch} worktree`);
				}

				return {value: found, detail: displayPath(found)};
			});
			return {defaultWorktree, defaultBranch: branch};
		},
	};
}

/**
 * Trunk sets up bare-layout projects and never converts a checkout in place:
 * the checkout may hold uncommitted work, ignored files and a shell someone is
 * standing in. It prints the recipe and lets the user decide.
 */
async function refusePlainClone(
	context: SetupContext,
	layout: RepositoryLayout,
): Promise<Outcome> {
	const clone = layout.worktreeRoot ?? layout.projectRoot ?? layout.path;
	const gitDirectory = layout.gitDir ?? join(clone, '.git');
	const url = (await originUrl(gitDirectory, context.git)) ?? '<remote url>';
	const name = clone.split('/').at(-1) ?? 'project';

	const dirty = await describeUnsavedWork(context, clone);
	const terminal = context.terminalUi ? await context.terminalUi() : undefined;
	if (terminal) {
		await terminal.refuse({
			kind: 'normal-clone',
			name,
			url,
			unsaved: dirty,
			branch: await existingDefaultBranch(gitDirectory, context.git),
		});
		return {code: exitCodes.unsupportedEnvironment};
	}

	if (dirty.length > 0) {
		context.report(
			'warning',
			`${clone} still holds ${dirty.join(' and ')}; keep it until that is safe`,
		);
	}

	for (const line of [
		`${clone} is a normal clone; trunk sets up bare-layout projects.`,
		'',
		`  trunk-cli clone ${url} ${name}-wt`,
		`  # copy any local-only files you still need into ${name}-wt/<default branch>/`,
		`  # check nothing uncommitted or unpushed is left in ${name}, then:`,
		`  rm -rf ${name} && mv ${name}-wt ${name}`,
	]) {
		context.report('info', line);
	}

	return unsupportedEnvironment(`${clone} is a normal clone`);
}

/** Uncommitted and unpushed work, named so the warning is specific. */
async function describeUnsavedWork(
	context: SetupContext,
	clone: string,
): Promise<readonly string[]> {
	const found: string[] = [];
	const status = await runGit(
		['-C', clone, 'status', '--porcelain'],
		context.git,
	);
	if (status.code === 0 && status.stdout.trim()) {
		found.push('uncommitted changes');
	}

	const unpushed = await runGit(
		['-C', clone, 'log', '--branches', '--not', '--remotes', '--oneline'],
		context.git,
	);
	if (unpushed.code === 0 && unpushed.stdout.trim()) {
		found.push('unpushed commits');
	}

	return Object.freeze(found);
}

/** A hand-made bare clone usually has no refspec, so `origin/*` is empty. */
async function repairFetchRefspec(
	context: SetupContext,
	gitDirectory: string,
): Promise<void> {
	const configured = await runGit(
		['--git-dir', gitDirectory, 'config', '--get', 'remote.origin.fetch'],
		context.git,
	);
	if (
		configured.code === 0 &&
		configured.stdout.trim() === originFetchRefspec
	) {
		return;
	}

	const repaired = await configureOriginFetch(gitDirectory, context.git);
	context.report(
		repaired.code === 0 ? 'success' : 'warning',
		repaired.code === 0
			? 'set the origin fetch refspec and fetched'
			: 'could not set the origin fetch refspec',
	);
}

/**
 * HEAD first, then the remote; record it the way wt expects to find it. Returns
 * undefined when HEAD names nothing and there is no remote to ask.
 */
async function repairDefaultBranch(
	context: SetupContext,
	gitDirectory: string,
	remote: ParsedRemote | undefined,
): Promise<string | undefined> {
	const existing = await existingDefaultBranch(gitDirectory, context.git);
	if (existing !== undefined || !remote) {
		return existing;
	}

	const branch = await remoteDefaultBranch(remote.url, context.git);
	await setHeadBranch(gitDirectory, branch, context.git);
	await runGit(
		['--git-dir', gitDirectory, 'config', 'worktrunk.default-branch', branch],
		context.git,
	);
	context.report('success', `recorded the default branch ${branch}`);
	return branch;
}

/**
 * Reuses the worktree for the default branch when there is one, which is also
 * what makes `trunk-cli init` the resume command after an interrupted clone.
 */
async function ensureWorktree(
	context: SetupContext,
	location: Readonly<{
		remote?: ParsedRemote;
		projectDirectory: string;
		gitDirectory: string;
		branch: string;
	}>,
	options: Readonly<{
		/** Let wt place the worktree with the terminal attached, so it can ask. */
		attached: boolean;
		/** Say when the worktree landed somewhere unexpected. */
		warn: boolean;
	}>,
): Promise<string | undefined> {
	const {remote, projectDirectory, gitDirectory, branch} = location;
	const expected = join(projectDirectory, branch.replaceAll('/', '-'));
	const worktrees = await listWorktrees(gitDirectory, context.git);
	const existing = await locateWorktree(
		gitDirectory,
		expected,
		context.git,
		branch,
	);
	if (worktrees.includes(existing) && existing !== projectDirectory) {
		return existing;
	}

	context.journal.record({kind: 'worktree', path: expected, branch});
	if (options.attached) {
		await switchAttached(projectDirectory, branch, {
			wtPath: context.wtPath,
			attach: context.attach,
			env: context.env,
		});
	} else {
		const added = await addWorktree(
			gitDirectory,
			expected,
			branch,
			context.git,
		);
		if (added.code !== 0) {
			return undefined;
		}

		if (options.warn) {
			warnAboutWorktreePath(context, remote, expected);
		}
	}

	const actual = await locateWorktree(
		gitDirectory,
		expected,
		context.git,
		branch,
	);
	if (actual !== expected) {
		context.journal.relocate(expected, actual);
		if (options.warn) {
			warnAboutWorktreePath(context, remote, actual);
		}
	}

	return actual;
}

async function originUrl(
	gitDirectory: string,
	options: GitOptions,
): Promise<string | undefined> {
	const result = await runGit(
		['--git-dir', gitDirectory, 'config', '--get', 'remote.origin.url'],
		options,
	);
	return result.code === 0 ? result.stdout.trim() || undefined : undefined;
}
