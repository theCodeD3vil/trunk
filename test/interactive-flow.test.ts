/**
 * The interactive setup flow, driven by a fake session instead of a terminal.
 * Everything else is real: `trunk clone` runs against a local bare remote with
 * real git and wt, so these tests check what the screens are told (steps, the
 * result card, the questions) and what really ends up on disk.
 */
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {afterAll, afterEach, beforeAll, describe, expect, test} from 'bun:test';
import {runClone} from '../source/commands/clone.js';
import type {CliFlags} from '../source/core/arguments.js';
import {agentIds} from '../source/core/agents.js';
import {resolveExecutable, type ToolProbe} from '../source/core/env.js';
import {runCommand} from '../source/core/process.js';
import {exitCodes} from '../source/core/result.js';
import type {
	ConfigureRequest,
	FailureRequest,
	FinishRequest,
	OverwriteRequest,
	PublishProblem,
	PublishRequest,
	PublishStatus,
	PublishStep,
	ResultLine,
	Session,
	StepDefinition,
	StepStatus,
	TerminalUi,
} from '../source/core/session.js';
import type {Settings} from '../source/core/settings.js';

type Answers = Partial<{
	configure: 'accept' | 'cancel';
	overwrite: 'keep' | 'replace' | undefined;
	finish: 'push' | 'skip' | undefined;
	fail: 'keep' | 'rollback' | undefined;
	/** Answers to the questions a failed push or pull request asks, in order. */
	problems: ReadonlyArray<'retry' | 'later' | undefined>;
	/** Aborts the publish this many milliseconds after it starts, as Ctrl+C would. */
	cancelAfter: number;
}>;

/** Records everything the flow tells the UI and answers each question as told. */
function fakeSession(answers: Answers = {}) {
	const record = {
		configured: undefined as ConfigureRequest | undefined,
		steps: [] as StepDefinition[],
		updates: [] as Array<readonly [string, StepStatus, string | undefined]>,
		overwrite: undefined as OverwriteRequest | undefined,
		finish: undefined as FinishRequest | undefined,
		failure: undefined as FailureRequest | undefined,
		results: [] as ResultLine[],
		closed: false,
		publish: {
			request: undefined as PublishRequest | undefined,
			updates: [] as Array<
				readonly [PublishStep, PublishStatus, string | undefined]
			>,
			problems: [] as PublishProblem[],
			ended: undefined as readonly ResultLine[] | undefined,
		},
	};
	const queue = [...(answers.problems ?? [])];
	const session: Session = {
		async configure(request) {
			record.configured = request;
			return answers.configure === 'cancel'
				? undefined
				: request.toSettings(request.values);
		},
		start(steps) {
			record.steps = [...steps];
		},
		update(id, status, detail) {
			record.updates.push([id, status, detail]);
		},
		async overwrite(request) {
			record.overwrite = request;
			return 'overwrite' in answers ? answers.overwrite : 'replace';
		},
		async finish(request) {
			record.finish = request;
			return 'finish' in answers ? answers.finish : 'skip';
		},
		result(lines) {
			record.results.push(...lines);
		},
		async fail(request) {
			record.failure = request;
			return 'fail' in answers ? answers.fail : 'keep';
		},
		publishStart(request) {
			record.publish.request = request;
			const controller = new AbortController();
			if (answers.cancelAfter !== undefined) {
				setTimeout(() => {
					controller.abort();
				}, answers.cancelAfter);
			}

			return controller.signal;
		},
		publishUpdate(step, status, detail) {
			record.publish.updates.push([step, status, detail]);
		},
		async publishProblem(problem) {
			record.publish.problems.push(problem);
			return queue.shift();
		},
		publishEnd(lines) {
			record.publish.ended = lines;
		},
		aborted: () => false,
		async close() {
			record.closed = true;
		},
	};
	const terminal: TerminalUi = {
		async session() {
			return session;
		},
		async refuse() {
			// Refusals are not what this file covers.
		},
		async welcome() {
			// Nor the welcome.
		},
	};
	return {record, terminal};
}

describe('the interactive setup flow', () => {
	const roots: string[] = [];

	beforeAll(async () => {
		// Fail early, and clearly, on a machine without the real tools.
		expect(await resolveExecutable('git')).toBeDefined();
		expect(await resolveExecutable('wt')).toBeDefined();
	});

	afterAll(async () => {
		await Promise.all(
			roots.map(async root => rm(root, {recursive: true, force: true})),
		);
	});

	test('walks the named steps, commits on a setup branch and leaves pushing to the user', async () => {
		const fixture = await createFixture(roots);
		const {record, terminal} = fakeSession();

		const outcome = await run(fixture, terminal);

		expect(outcome.code).toBe(exitCodes.success);
		expect(record.closed).toBe(true);
		// The questions come first, then the work, in the order the screen shows.
		expect(record.configured?.command).toBe('clone');
		expect(record.steps.map(step => step.id)).toEqual([
			'clone',
			'branch',
			'worktree',
			'generate',
			'validate',
			'commit',
		]);
		const finished = record.updates
			.filter(([, status]) => status === 'done')
			.map(([id]) => id);
		expect(finished).toEqual([
			'clone',
			'branch',
			'worktree',
			'generate',
			'validate',
			'commit',
		]);
		expect(record.updates.some(([, status]) => status === 'failed')).toBe(
			false,
		);

		const project = join(fixture.workingDirectory, 'acme-admin');
		const setup = join(project, 'chore-trunk-setup');
		const config = await readFile(join(setup, '.config', 'wt.toml'), 'utf8');
		expect(config).toContain('# Worktree automation shared by everyone');

		// The result card says where to go next, and never pushes unasked.
		expect(record.finish?.next[0]?.command).toStartWith('cd ');
		expect(record.finish?.next[0]?.command).toContain('chore-trunk-setup');
		expect(record.finish?.push?.branch).toBe('chore/trunk-setup');
		// The remote was asked while the questions were answered, so the review
		// could name the branch before anything was cloned.
		expect(record.configured?.probedDefaultBranch?.()).toBe('main');
		expect(
			await git([
				'--git-dir',
				fixture.remote,
				'branch',
				'--list',
				'chore/trunk-setup',
			]),
		).toBe('');
	}, 60_000);

	test('cancelling at the questions leaves nothing behind', async () => {
		const fixture = await createFixture(roots);
		const {record, terminal} = fakeSession({configure: 'cancel'});

		const outcome = await run(fixture, terminal);

		expect(outcome.code).toBe(exitCodes.userAborted);
		expect(record.closed).toBe(true);
		expect(record.steps).toEqual([]);
		expect(
			await exists(
				join(fixture.workingDirectory, 'acme-admin', 'chore-trunk-setup'),
			),
		).toBe(false);
	}, 60_000);

	test('an existing config is shown as a diff, and keeping it changes nothing', async () => {
		const existing = '# mine\n[post-start]\nedit = "true"\n';
		const fixture = await createFixture(roots, existing);
		const {record, terminal} = fakeSession({overwrite: 'keep'});

		const outcome = await run(fixture, terminal);

		expect(outcome.code).toBe(exitCodes.success);
		expect(record.overwrite?.existing).toBe(existing);
		expect(record.overwrite?.generated).toContain(
			'# Worktree automation shared by everyone',
		);
		expect(record.finish?.title).toBe('Kept your existing config');
		const kept = await readFile(
			join(
				fixture.workingDirectory,
				'acme-admin',
				'main',
				'.config',
				'wt.toml',
			),
			'utf8',
		);
		expect(kept).toBe(existing);
		expect(
			await exists(
				join(fixture.workingDirectory, 'acme-admin', 'chore-trunk-setup'),
			),
		).toBe(false);
	}, 60_000);

	test('a failed step offers to roll back, and rolling back removes what the run created', async () => {
		const fixture = await createFixture(roots);
		const {record, terminal} = fakeSession({fail: 'rollback'});
		// A wt that works except for the validation step, which is what fails.
		const failing = await fakeWorktrunk(fixture.root);

		const outcome = await run(fixture, terminal, failing);

		expect(outcome.code).toBe(exitCodes.userAborted);
		expect(
			record.updates.some(
				([id, status]) => id === 'validate' && status === 'failed',
			),
		).toBe(true);
		expect(record.failure?.rollback).toBe(true);
		expect(record.failure?.detail).toContain('validation exploded');
		expect(record.failure?.created.length).toBeGreaterThan(0);
		expect(await exists(join(fixture.workingDirectory, 'acme-admin'))).toBe(
			false,
		);
		// The outcome is drawn under the steps as data, and nothing is printed
		// afterwards: no cross on a rollback that worked, no path dump.
		const said = record.results.map(
			line => `${line.ok ? 'ok' : 'bad'} ${line.text}`,
		);
		expect(said).toContain(
			'ok Removed the chore/trunk-setup worktree and branch.',
		);
		expect(said).toContain('ok Removed the default worktree.');
		expect(said).toContain('ok Removed the project folder trunk created.');
		expect(said.some(line => line.startsWith('bad'))).toBe(false);
		expect(outcome.message).toBeUndefined();
	}, 60_000);

	test('keeping a failed run leaves the project in place', async () => {
		const fixture = await createFixture(roots);
		const {record, terminal} = fakeSession({fail: 'keep'});
		const failing = await fakeWorktrunk(fixture.root);

		const outcome = await run(fixture, terminal, failing);

		expect(outcome.code).toBe(exitCodes.operationFailed);
		expect(record.failure).toBeDefined();
		// The failure card is replaced by the steps, so how to resume is repeated.
		const said = record.results.map(line => line.text);
		expect(said).toHaveLength(2);
		expect(said[0]).toBe('Kept everything this run created.');
		expect(said[1]).toMatch(/^Resume later with trunk init /);
		expect(await exists(join(fixture.workingDirectory, 'acme-admin'))).toBe(
			true,
		);
	}, 60_000);
});

type Fixture = Readonly<{
	root: string;
	remote: string;
	workingDirectory: string;
	environment: NodeJS.ProcessEnv;
}>;

type RunOptions = Readonly<{
	url?: string;
	gitPath?: string;
	ghPath?: string;
	environment?: NodeJS.ProcessEnv;
}>;

async function run(
	fixture: Fixture,
	terminal: TerminalUi,
	wtPath?: string,
	options: RunOptions = {},
) {
	const probed = await probeTools(wtPath);
	const tools: ToolProbe = {
		...probed,
		git: {...probed.git, path: options.gitPath ?? probed.git.path},
		gh: {name: 'gh', path: options.ghPath},
	};
	return runClone(
		[options.url ?? `file://${fixture.remote}`, 'acme-admin'],
		Object.assign(Object.create(null) as CliFlags, {}),
		tools,
		{
			cwd: fixture.workingDirectory,
			env: {...fixture.environment, ...options.environment},
			interactive: true,
			terminalUi: async () => terminal,
			invocation: {executable: 'trunk', arguments: ['clone']},
			now: () => new Date('2026-09-18T00:00:00.000Z'),
			async attach(command, arguments_, options) {
				const result = await runCommand(command, arguments_, options);
				return result.code ?? 1;
			},
			report() {
				// Buffered output is not what these tests assert.
			},
		},
	);
}

/**
 * A wt that defers to the real one for everything except `config show`, which
 * fails the way a config error would. Trunk validates through that command.
 */
async function fakeWorktrunk(root: string): Promise<string> {
	const real = await resolveExecutable('wt');
	const path = join(root, 'wt-fails-validation');
	await writeFile(
		path,
		`#!/bin/sh\n# Trunk calls \`wt -C <dir> config show\`, so look at every argument.\ncase " $* " in\n  *" config show"*) echo "validation exploded" >&2; exit 1;;\nesac\nexec "${real}" "$@"\n`,
	);
	await chmod(path, 0o755);
	return path;
}

async function createFixture(
	roots: string[],
	config?: string,
): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), 'trunk-flow-'));
	roots.push(root);
	const source = join(root, 'source');
	const remote = join(root, 'remote.git');
	const workingDirectory = join(root, 'work');
	const home = join(root, 'home');
	await Promise.all([
		mkdir(source),
		mkdir(workingDirectory),
		mkdir(join(home, '.config'), {recursive: true}),
	]);

	await git(['init', '--initial-branch', 'main', source]);
	await writeFile(join(source, 'README.md'), '# acme-admin\n');
	if (config !== undefined) {
		await mkdir(join(source, '.config'), {recursive: true});
		await writeFile(join(source, '.config', 'wt.toml'), config);
	}

	await git(['-C', source, 'add', '.']);
	await git(['-C', source, 'commit', '-m', 'Initial commit']);
	await git(['clone', '--bare', source, remote]);
	await git(['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main']);

	return {
		root,
		remote,
		workingDirectory,
		environment: Object.fromEntries([
			['HOME', home],
			['NO_COLOR', '1'],
			['PATH', process.env['PATH'] ?? ''],
			['TERM', 'dumb'],
			['GIT_AUTHOR_NAME', 'Trunk Tests'],
			['GIT_AUTHOR_EMAIL', 'trunk@example.com'],
			['GIT_COMMITTER_NAME', 'Trunk Tests'],
			['GIT_COMMITTER_EMAIL', 'trunk@example.com'],
			['WORKTRUNK_CONFIG_PATH', join(root, 'worktrunk.toml')],
			['XDG_CONFIG_HOME', join(home, '.config')],
		]),
	};
}

async function probeTools(wtPath?: string): Promise<ToolProbe> {
	const [gitPath, realWt] = await Promise.all([
		resolveExecutable('git'),
		resolveExecutable('wt'),
	]);
	return {
		git: {name: 'git', path: gitPath},
		wt: {name: 'wt', path: wtPath ?? realWt},
		tmux: {name: 'tmux'},
		gh: {name: 'gh'},
		agents: Object.fromEntries(
			agentIds.map(id => [id, {name: id}]),
		) as ToolProbe['agents'],
	};
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function git(arguments_: readonly string[]): Promise<string> {
	const result = await runCommand('git', arguments_, {
		env: Object.fromEntries([
			['HOME', tmpdir()],
			['PATH', process.env['PATH'] ?? ''],
			['GIT_CONFIG_NOSYSTEM', '1'],
			['GIT_AUTHOR_NAME', 'Trunk Tests'],
			['GIT_AUTHOR_EMAIL', 'trunk@example.com'],
			['GIT_COMMITTER_NAME', 'Trunk Tests'],
			['GIT_COMMITTER_EMAIL', 'trunk@example.com'],
		]),
	});
	if (result.code !== 0) {
		throw new Error(`git ${arguments_.join(' ')}: ${result.stderr}`);
	}

	return result.stdout;
}

describe('publishing the setup branch', () => {
	const roots: string[] = [];
	const saved = new Map<string, string | undefined>();

	afterEach(() => {
		for (const [name, value] of saved) {
			if (value === undefined) {
				Reflect.deleteProperty(process.env, name);
			} else {
				process.env[name] = value;
			}
		}

		saved.clear();
	});

	afterAll(async () => {
		await Promise.all(
			roots.map(async root => rm(root, {recursive: true, force: true})),
		);
	});

	/** A script on disk that stands in for a tool, and a log of what it saw. */
	async function stub(
		root: string,
		name: string,
		body: string,
	): Promise<string> {
		const path = join(root, name);
		await writeFile(path, `#!/bin/sh\n${body}\n`);
		await chmod(path, 0o755);
		return path;
	}

	/**
	 * Makes `git@github.com:acme/admin.git` mean the fixture's bare repository,
	 * so the flow sees a GitHub remote while git talks to a folder.
	 */
	function hosted(fixture: Fixture): RunOptions {
		const pairs: Array<[string, string]> = [
			['GIT_CONFIG_COUNT', '1'],
			['GIT_CONFIG_KEY_0', `url.file://${fixture.remote}.insteadOf`],
			['GIT_CONFIG_VALUE_0', 'git@github.com:acme/admin.git'],
		];
		// The clone runs in this process's environment; the push in the flow's.
		for (const [name, value] of pairs) {
			saved.set(name, process.env[name]);
			process.env[name] = value;
		}

		return {
			url: 'git@github.com:acme/admin.git',
			environment: Object.fromEntries(pairs),
		};
	}

	/** Wraps git so a push can be slow or fail, and records what environment it ran in. */
	async function wrappedGit(
		fixture: Fixture,
		onPush: string,
	): Promise<{path: string; log: string}> {
		const real = await resolveExecutable('git');
		const log = join(fixture.root, 'push.log');
		const path = await stub(
			fixture.root,
			'git-wrapper',
			`case " $* " in\n  *" push "*)\n    echo "prompt=$GIT_TERMINAL_PROMPT ssh=$GIT_SSH_COMMAND gh=$GH_PROMPT_DISABLED" >> "${log}"\n    ${onPush}\n    ;;\nesac\nexec "${real}" "$@"`,
		);
		return {path, log};
	}

	const branchesOn = async (fixture: Fixture) =>
		git(['--git-dir', fixture.remote, 'branch', '--list', 'chore/trunk-setup']);

	test('a push to a plain remote is one step, and the branch arrives', async () => {
		const fixture = await createFixture(roots);
		const {record, terminal} = fakeSession({finish: 'push'});

		const outcome = await run(fixture, terminal);

		expect(outcome.code).toBe(exitCodes.success);
		expect(record.publish.request).toMatchObject({
			branch: 'chore/trunk-setup',
			withPullRequest: false,
		});
		expect(
			record.publish.updates.map(([step, status]) => `${step}:${status}`),
		).toEqual(['push:active', 'push:done']);
		expect(record.publish.problems).toEqual([]);
		expect(record.publish.ended).toEqual([]);
		expect(await branchesOn(fixture)).toContain('chore/trunk-setup');
	}, 60_000);

	test('on GitHub it opens a pull request as a second step, and says how to see it', async () => {
		const fixture = await createFixture(roots);
		const options = hosted(fixture);
		const gh = await stub(
			fixture.root,
			'gh',
			'echo "https://github.com/acme/admin/pull/12"',
		);
		const {record, terminal} = fakeSession({finish: 'push'});

		await run(fixture, terminal, undefined, {...options, ghPath: gh});

		expect(record.publish.request).toMatchObject({
			destination: 'github.com:acme/admin',
			withPullRequest: true,
		});
		expect(record.publish.updates).toEqual([
			['push', 'active', undefined],
			['push', 'done', undefined],
			['pr', 'active', undefined],
			['pr', 'done', '#12  github.com/acme/admin/pull/12'],
		]);
		expect(record.publish.ended?.[0]).toMatchObject({
			command: 'gh pr view --web',
		});
		expect(await branchesOn(fixture)).toContain('chore/trunk-setup');
	}, 60_000);

	test('a push that cannot ask for a password fails with the reason, and Retry pushes again', async () => {
		const fixture = await createFixture(roots);
		const options = hosted(fixture);
		const marker = join(fixture.root, 'failed-once');
		const wrapper = await wrappedGit(
			fixture,
			`if [ ! -f "${marker}" ]; then touch "${marker}"; echo "! [remote rejected] chore/trunk-setup -> chore/trunk-setup (permission denied)" >&2; echo "error: failed to push some refs to 'x'" >&2; exit 1; fi`,
		);
		const gh = await stub(
			fixture.root,
			'gh',
			'echo "https://github.com/acme/admin/pull/3"',
		);
		const {record, terminal} = fakeSession({
			finish: 'push',
			problems: ['retry'],
		});

		await run(fixture, terminal, undefined, {
			...options,
			gitPath: wrapper.path,
			ghPath: gh,
		});

		expect(
			record.publish.updates.map(([step, status]) => `${step}:${status}`),
		).toEqual([
			'push:active',
			'push:failed',
			'push:active',
			'push:done',
			'pr:active',
			'pr:done',
		]);
		const [problem] = record.publish.problems;
		expect(problem).toMatchObject({tone: 'error', title: 'Push failed'});
		expect(problem?.said.join(' ')).toContain('permission denied');
		// The line that only repeats the failure is left out.
		expect(problem?.said.join(' ')).not.toContain('failed to push some refs');
		expect(problem?.fix).toBe(
			'Check that you can write to acme/admin, then try again.',
		);
		expect(problem?.after).toBe('git push -u origin chore/trunk-setup');
		expect(await branchesOn(fixture)).toContain('chore/trunk-setup');
	}, 60_000);

	test('git and gh are never allowed to ask a question on the terminal', async () => {
		const fixture = await createFixture(roots);
		const options = hosted(fixture);
		const wrapper = await wrappedGit(fixture, ':');
		const gh = await stub(
			fixture.root,
			'gh',
			'echo "https://github.com/acme/admin/pull/1"',
		);
		const {terminal} = fakeSession({finish: 'push'});

		await run(fixture, terminal, undefined, {
			...options,
			gitPath: wrapper.path,
			ghPath: gh,
		});

		const seen = await readFile(wrapper.log, 'utf8');
		expect(seen).toContain('prompt=0');
		expect(seen).toContain('ssh=ssh -o BatchMode=yes');
		expect(seen).toContain('gh=1');
	}, 60_000);

	test('leaving it local after a failed push ends with how to push later, and nothing is pushed', async () => {
		const fixture = await createFixture(roots);
		const wrapper = await wrappedGit(
			fixture,
			'echo "fatal: unable to access the remote" >&2; exit 1',
		);
		const {record, terminal} = fakeSession({
			finish: 'push',
			problems: ['later'],
		});

		const outcome = await run(fixture, terminal, undefined, {
			gitPath: wrapper.path,
		});

		expect(outcome.code).toBe(exitCodes.success);
		expect(record.publish.updates.map(([, status]) => status)).toEqual([
			'active',
			'failed',
		]);
		expect(record.publish.problems).toHaveLength(1);
		expect(record.publish.ended?.map(line => line.text)).toEqual([
			'Kept it local.',
			'When you are ready: ',
		]);
		expect(record.publish.ended?.[1]?.command).toBe(
			'git push -u origin chore/trunk-setup',
		);
		expect(await branchesOn(fixture)).toBe('');
	}, 60_000);

	test('a pull request that fails keeps the push, and Retry repeats only the pull request', async () => {
		const fixture = await createFixture(roots);
		const options = hosted(fixture);
		const wrapper = await wrappedGit(fixture, ':');
		const marker = join(fixture.root, 'gh-failed-once');
		const gh = await stub(
			fixture.root,
			'gh',
			`if [ ! -f "${marker}" ]; then touch "${marker}"; echo "To get started with GitHub CLI, please run:  gh auth login" >&2; exit 1; fi\necho "https://github.com/acme/admin/pull/9"`,
		);
		const {record, terminal} = fakeSession({
			finish: 'push',
			problems: ['retry'],
		});

		await run(fixture, terminal, undefined, {
			...options,
			gitPath: wrapper.path,
			ghPath: gh,
		});

		expect(
			record.publish.updates.map(([step, status]) => `${step}:${status}`),
		).toEqual([
			'push:active',
			'push:done',
			'pr:active',
			'pr:warned',
			'pr:active',
			'pr:done',
		]);
		expect(record.publish.problems[0]).toMatchObject({
			tone: 'warning',
			title: 'Pushed, but no pull request',
			after: 'gh auth login',
		});
		expect(record.publish.problems[0]?.link).toBe(
			'https://github.com/acme/admin/compare/chore%2Ftrunk-setup?expand=1',
		);
		// One push only: the retry did not push again.
		const pushes = await readFile(wrapper.log, 'utf8');
		expect(pushes.trim().split('\n')).toHaveLength(1);
	}, 60_000);

	test('Ctrl+C stops the push and says how to finish by hand', async () => {
		const fixture = await createFixture(roots);
		const wrapper = await wrappedGit(fixture, 'exec /bin/sleep 30');
		const {record, terminal} = fakeSession({finish: 'push', cancelAfter: 400});
		const started = Date.now();

		const outcome = await run(fixture, terminal, undefined, {
			gitPath: wrapper.path,
		});

		expect(outcome.code).toBe(exitCodes.success);
		// It did not wait for the 30 second sleep.
		expect(Date.now() - started).toBeLessThan(20_000);
		expect(record.publish.updates.map(([, status]) => status)).toEqual([
			'active',
			'cancelled',
		]);
		expect(record.publish.ended?.[0]).toMatchObject({tone: 'warning'});
		expect(record.publish.ended?.[1]?.command).toBe(
			'git push -u origin chore/trunk-setup',
		);
		expect(await branchesOn(fixture)).toBe('');
	}, 60_000);
});
