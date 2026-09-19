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
import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
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
	};
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

async function run(fixture: Fixture, terminal: TerminalUi, wtPath?: string) {
	const tools = await probeTools(wtPath);
	return runClone(
		[`file://${fixture.remote}`, 'acme-admin'],
		Object.assign(Object.create(null) as CliFlags, {}),
		tools,
		{
			cwd: fixture.workingDirectory,
			env: fixture.environment,
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
