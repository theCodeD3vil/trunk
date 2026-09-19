/**
 * `trunk clone` against a local bare remote. Everything here runs the real
 * pipeline: real git, real wt, real files. Only the terminal is missing, which
 * is the point — this is the `--yes` path a script or CI would take.
 */
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import {runClone} from '../source/commands/clone.js';
import type {SetupPrompts} from '../source/core/pipeline.js';
import type {CliFlags} from '../source/core/arguments.js';
import {agentIds} from '../source/core/agents.js';
import {originFetchRefspec} from '../source/core/git.js';
import {resolveExecutable, type ToolProbe} from '../source/core/env.js';
import {runCommand, type CommandOptions} from '../source/core/process.js';
import {exitCodes} from '../source/core/result.js';
import {resolve} from '../source/core/resolve.js';
import type {collectSettings} from '../source/core/collect.js';

type CollectSettings = typeof collectSettings;

type Fixture = Readonly<{
	root: string;
	remote: string;
	workingDirectory: string;
	environment: NodeJS.ProcessEnv;
	tools: ToolProbe;
}>;

describe('trunk clone end to end', () => {
	let fixture: Fixture;

	beforeAll(async () => {
		fixture = await createFixture('main');
	});

	afterAll(async () => {
		await rm(fixture.root, {recursive: true, force: true});
	});

	test('sets up a project from a file:// remote with --yes', async () => {
		const outcome = await runClone(
			[`file://${fixture.remote}`, 'acme-admin'],
			flags({yes: true}),
			fixture.tools,
			dependencies(fixture),
		);

		expect(outcome.code).toBe(exitCodes.success);

		const project = join(fixture.workingDirectory, 'acme-admin');
		const gitDirectory = join(project, '.git');
		expect(await exists(gitDirectory)).toBe(true);

		// The refspec a bare clone omits, without which origin/* stays empty.
		const refspec = await git([
			'--git-dir',
			gitDirectory,
			'config',
			'remote.origin.fetch',
		]);
		expect(refspec.trim()).toBe(originFetchRefspec);

		const references = await git([
			'--git-dir',
			gitDirectory,
			'for-each-ref',
			'--format=%(refname)',
			'refs/remotes/origin',
		]);
		expect(references).toContain('refs/remotes/origin/main');

		const worktrees = await git([
			'--git-dir',
			gitDirectory,
			'worktree',
			'list',
			'--porcelain',
		]);
		expect(worktrees).toContain(join(project, 'main'));
		expect(worktrees).toContain(join(project, 'chore-trunk-setup'));

		const setupWorktree = join(project, 'chore-trunk-setup');
		const config = await readFile(
			join(setupWorktree, '.config', 'wt.toml'),
			'utf8',
		);
		expect(config).toContain('# Worktree automation shared by everyone');
		// `--yes` defaults: tmux on, no agents, copy-ignored off, mc on.
		expect(config).toContain("tmux = '''");
		expect(config).not.toContain('-n Agents');
		expect(config).not.toContain('copy-ignored');
		expect(config).toContain('mc = ');

		// Committed, and nothing else came with it.
		const committed = await git([
			'-C',
			setupWorktree,
			'show',
			'--name-only',
			'--format=%s',
			'HEAD',
		]);
		expect(committed).toContain('Add worktree automation');
		expect(committed).toContain('.config/wt.toml');

		const status = await git(['-C', setupWorktree, 'status', '--porcelain']);
		expect(status.trim()).toBe('');

		const configShow = await wt(['-C', setupWorktree, 'config', 'show']);
		expect(configShow.toLowerCase()).not.toContain('warning');
	}, 60_000);

	test('ends by naming the approvals step and wt up, without a smoke test', async () => {
		const lines: string[] = [];
		const local = await createFixture('main');
		try {
			const outcome = await runClone(
				[`file://${local.remote}`, 'guided'],
				flags({yes: true}),
				local.tools,
				{
					...dependencies(local),
					report(_kind, line) {
						lines.push(line);
					},
				},
			);

			expect(outcome.code).toBe(exitCodes.success);
			const reported = lines.join('\n');
			expect(reported).toContain('next: wt config approvals add');
			expect(reported).toContain('wt up');
			expect(reported).not.toContain('smoke');
			// Trunk never starts a hook: no tmux session appears as a side effect.
			expect(outcome.message).toContain('set up');
		} finally {
			await rm(local.root, {recursive: true, force: true});
		}
	}, 60_000);

	test('warns that worktree-path is unset, naming the real identifier', async () => {
		const lines: string[] = [];
		const local = await createFixture('main');
		try {
			await runClone(
				[`file://${local.remote}`, 'acme-admin'],
				flags({yes: true}),
				local.tools,
				{
					...dependencies(local),
					report(_kind, line) {
						lines.push(line);
					},
				},
			);

			const warning = lines.join('\n');
			expect(warning).toContain('worktree-path is not configured for');
			expect(warning).toContain(local.remote.replace(/^\//, ''));
			expect(warning).toContain('worktree-path = "{{ repo_path }}');
		} finally {
			await rm(local.root, {recursive: true, force: true});
		}
	}, 60_000);

	test('handles a remote whose default branch is master', async () => {
		const local = await createFixture('master');
		try {
			const outcome = await runClone(
				[`file://${local.remote}`, 'legacy'],
				flags({yes: true}),
				local.tools,
				dependencies(local),
			);

			expect(outcome.code).toBe(exitCodes.success);
			const project = join(local.workingDirectory, 'legacy');
			const head = await git([
				'--git-dir',
				join(project, '.git'),
				'symbolic-ref',
				'HEAD',
			]);
			expect(head.trim()).toBe('refs/heads/master');
			const worktrees = await git([
				'--git-dir',
				join(project, '.git'),
				'worktree',
				'list',
				'--porcelain',
			]);
			expect(worktrees).toContain(join(project, 'master'));
		} finally {
			await rm(local.root, {recursive: true, force: true});
		}
	}, 60_000);

	test('refuses a folder that already holds something', async () => {
		const occupied = join(fixture.workingDirectory, 'occupied');
		await mkdir(occupied, {recursive: true});
		await writeFile(join(occupied, 'notes.txt'), 'mine\n');

		const outcome = await runClone(
			[`file://${fixture.remote}`, 'occupied'],
			flags({yes: true}),
			fixture.tools,
			dependencies(fixture),
		);

		expect(outcome.code).toBe(exitCodes.badUsage);
		const entries = await readFile(join(occupied, 'notes.txt'), 'utf8');
		expect(entries).toBe('mine\n');
	});

	test('a failed validation commits nothing and lists what it created', async () => {
		const lines: string[] = [];
		const local = await createFixture('main');
		try {
			// A wt that always fails stands in for a config Worktrunk rejects.
			const outcome = await runClone(
				[`file://${local.remote}`, 'broken'],
				flags({yes: true}),
				{...local.tools, wt: {name: 'wt', path: '/usr/bin/false'}},
				{
					...dependencies(local),
					report(_kind, line) {
						lines.push(line);
					},
				},
			);

			expect(outcome.code).toBe(exitCodes.operationFailed);

			const reported = lines.join('\n');
			expect(reported).toContain('created by this run:');
			expect(reported).toContain('bare repo');
			expect(reported).toContain('worktree + branch (wt.toml uncommitted)');
			expect(reported).toContain('resume: trunk init ./broken');

			const setupWorktree = join(
				local.workingDirectory,
				'broken',
				'chore-trunk-setup',
			);
			const log = await git(['-C', setupWorktree, 'log', '--oneline']);
			expect(log).not.toContain('Add worktree automation');
			// Git collapses the untracked directory; the file is inside it.
			const status = await git(['-C', setupWorktree, 'status', '--porcelain']);
			expect(status).toContain('?? .config/');
		} finally {
			await rm(local.root, {recursive: true, force: true});
		}
	}, 60_000);

	test('rolls back the worktree, the branch and the folder it created', async () => {
		const local = await createFixture('main');
		try {
			const outcome = await runClone(
				[`file://${local.remote}`, 'discarded'],
				flags(),
				local.tools,
				{
					...dependencies(local),
					interactive: true,
					prompts: decliningPrompts('rollback'),
					collect: acceptDefaults,
				},
			);

			expect(outcome.code).toBe(exitCodes.userAborted);

			const project = join(local.workingDirectory, 'discarded');
			// Trunk created the folder, so rolling back removes all of it.
			expect(await exists(project)).toBe(false);
		} finally {
			await rm(local.root, {recursive: true, force: true});
		}
	}, 60_000);

	test('rolling back leaves a folder trunk did not create', async () => {
		const lines: string[] = [];
		const local = await createFixture('main');
		const project = join(local.workingDirectory, 'preexisting');
		await mkdir(project, {recursive: true});
		try {
			const outcome = await runClone(
				[`file://${local.remote}`, 'preexisting'],
				flags(),
				local.tools,
				{
					...dependencies(local),
					interactive: true,
					prompts: decliningPrompts('rollback'),
					collect: acceptDefaults,
					report(_kind, line) {
						lines.push(line);
					},
				},
			);

			const reported = lines.join('\n');

			expect(outcome.code).toBe(exitCodes.userAborted);

			// The folder was the user's, so only what trunk put inside it goes.
			expect(await exists(project)).toBe(true);
			const worktrees = await git([
				'--git-dir',
				join(project, '.git'),
				'worktree',
				'list',
				'--porcelain',
			]);
			expect(worktrees).not.toContain('chore-trunk-setup');
			const branches = await git([
				'--git-dir',
				join(project, '.git'),
				'branch',
				'--list',
				'chore/trunk-setup',
			]);
			expect(branches.trim()).toBe('');

			// Worktrunk keeps its own copy of what it removed. Trunk does not
			// delete someone else's undo; it says where the copy is.
			expect(reported).toContain('worktrunk kept a copy');
			expect(reported).toContain(join(project, '.git', 'wt', 'trash'));
		} finally {
			await rm(local.root, {recursive: true, force: true});
		}
	}, 60_000);

	test('keeping an interrupted run prints how to resume and how to undo', async () => {
		const lines: string[] = [];
		const local = await createFixture('main');
		try {
			const outcome = await runClone(
				[`file://${local.remote}`, 'kept'],
				flags(),
				local.tools,
				{
					...dependencies(local),
					interactive: true,
					prompts: decliningPrompts('keep'),
					collect: acceptDefaults,
					report(_kind, line) {
						lines.push(line);
					},
				},
			);

			expect(outcome.code).toBe(exitCodes.operationFailed);

			const reported = lines.join('\n');
			expect(reported).toContain('resume: trunk init ./kept');
			expect(reported).toContain('remove chore/trunk-setup --no-hooks --yes');
			expect(await exists(join(local.workingDirectory, 'kept'))).toBe(true);
		} finally {
			await rm(local.root, {recursive: true, force: true});
		}
	}, 60_000);

	test('keeps an existing wt.toml byte for byte under --yes', async () => {
		const local = await createFixture('main', existing);
		try {
			const outcome = await runClone(
				[`file://${local.remote}`, 'adopted'],
				flags({yes: true}),
				local.tools,
				dependencies(local),
			);

			expect(outcome.code).toBe(exitCodes.success);
			const kept = await readFile(
				join(local.workingDirectory, 'adopted', 'main', '.config', 'wt.toml'),
				'utf8',
			);
			expect(kept).toBe(existing);
		} finally {
			await rm(local.root, {recursive: true, force: true});
		}
	}, 60_000);
});

/**
 * Declines the commit, which is the realistic way a run reaches the interrupted
 * step with a working wt, then answers the keep-or-rollback question.
 */
function decliningPrompts(answer: 'keep' | 'rollback'): SetupPrompts {
	return {
		async choose(question) {
			return question.includes('roll back') ? answer : 'keep';
		},
		async confirm(question) {
			return !question.includes('commit');
		},
	};
}

/** Stands in for the form: takes the resolved defaults without asking. */
const acceptDefaults: CollectSettings = async ({resolveOptions}) => {
	const resolution = resolve({...resolveOptions, acceptDefaults: true});
	if (resolution.kind !== 'complete') {
		throw new Error('Expected the defaults to resolve completely.');
	}

	return {kind: 'settings', settings: resolution.settings};
};

const existing = '# hand written\n[aliases]\nup = "echo up"\n';

/** Only the flags a test sets matter; the rest stay undefined, as meow leaves them. */
function flags(overrides: Partial<CliFlags> = {}): CliFlags {
	return Object.assign(Object.create(null) as CliFlags, overrides);
}

function dependencies(fixture: Fixture) {
	return {
		cwd: fixture.workingDirectory,
		env: fixture.environment,
		interactive: false,
		invocation: {executable: 'trunk', arguments: ['clone']},
		now: () => new Date('2026-09-18T00:00:00.000Z'),
		// Capture what would normally stream to trunk's terminal, so the test
		// runner's output stays readable.
		async attach(
			command: string,
			arguments_: readonly string[],
			options?: CommandOptions,
		) {
			const result = await runCommand(command, arguments_, options);
			return result.code ?? 1;
		},
		report() {
			// The pipeline's progress is not what these tests assert.
		},
	};
}

async function createFixture(
	defaultBranch: string,
	config?: string,
): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), 'trunk-e2e-'));
	const source = join(root, 'source');
	const remote = join(root, 'remote.git');
	const workingDirectory = join(root, 'work');
	const home = join(root, 'home');
	await Promise.all([
		mkdir(source),
		mkdir(workingDirectory),
		mkdir(join(home, '.config'), {recursive: true}),
	]);

	await git(['init', '--initial-branch', defaultBranch, source]);
	await writeFile(join(source, 'README.md'), '# acme-admin\n');
	if (config) {
		await mkdir(join(source, '.config'), {recursive: true});
		await writeFile(join(source, '.config', 'wt.toml'), config);
	}

	await git(['-C', source, 'add', '.']);
	await git([
		'-C',
		source,
		'-c',
		'user.name=Trunk Tests',
		'-c',
		'user.email=trunk@example.com',
		'commit',
		'-m',
		'Initial commit',
	]);
	await git(['clone', '--bare', source, remote]);
	await git([
		'--git-dir',
		remote,
		'symbolic-ref',
		'HEAD',
		`refs/heads/${defaultBranch}`,
	]);

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
		tools: await probeTools(),
	};
}

async function probeTools(): Promise<ToolProbe> {
	const [gitPath, wtPath] = await Promise.all([
		resolveExecutable('git'),
		resolveExecutable('wt'),
	]);
	expect(gitPath).toBeDefined();
	expect(wtPath).toBeDefined();

	return {
		git: {name: 'git', path: gitPath},
		wt: {name: 'wt', path: wtPath},
		tmux: {name: 'tmux'},
		gh: {name: 'gh'},
		agents: Object.fromEntries(
			agentIds.map(id => [id, {name: id}]),
		) as ToolProbe['agents'],
	};
}

/** Present or not, without turning a missing path into a thrown test failure. */
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

async function wt(arguments_: readonly string[]): Promise<string> {
	const wtPath = await resolveExecutable('wt');
	const result = await runCommand(wtPath ?? 'wt', arguments_);
	return `${result.stdout}${result.stderr}`;
}
