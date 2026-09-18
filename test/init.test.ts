/**
 * `trunk init` against real repositories on disk: a project trunk already set
 * up, one assembled by hand, one that never had an origin, an empty repository
 * and a plain clone it must refuse.
 */
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {describe, expect, test} from 'bun:test';
import {runInit} from '../source/commands/init.js';
import {agentIds} from '../source/core/agents.js';
import type {CliFlags} from '../source/core/arguments.js';
import {resolveExecutable, type ToolProbe} from '../source/core/env.js';
import {originFetchRefspec} from '../source/core/git.js';
import {runCommand, type CommandOptions} from '../source/core/process.js';
import {exitCodes} from '../source/core/result.js';
import type {SetupPrompts} from '../source/core/pipeline.js';
import {resolve} from '../source/core/resolve.js';
import type {collectSettings} from '../source/ui/SetupForm.js';

type CollectSettings = typeof collectSettings;

type Fixture = Readonly<{
	root: string;
	remote: string;
	project: string;
	workingDirectory: string;
	environment: NodeJS.ProcessEnv;
	tools: ToolProbe;
}>;

describe('trunk init', () => {
	test('sets up a bare-layout project made by hand', async () => {
		const fixture = await createBareProject();
		try {
			const outcome = await runInit(
				[fixture.project],
				flags({yes: true}),
				fixture.tools,
				dependencies(fixture),
			);

			expect(outcome.code).toBe(exitCodes.success);

			const config = await readFile(
				join(fixture.project, 'chore-trunk-setup', '.config', 'wt.toml'),
				'utf8',
			);
			expect(config).toContain('# Worktree automation shared by everyone');
			// `--yes` defaults: tmux on, no agents, copy-ignored off, mc on.
			expect(config).toContain("tmux = '''");
			expect(config).not.toContain('-n Agents');
			expect(config).not.toContain('copy-ignored');
			expect(config).toContain('mc = ');

			// The refspec a hand-made bare clone is missing.
			const refspec = await git([
				'--git-dir',
				join(fixture.project, '.git'),
				'config',
				'remote.origin.fetch',
			]);
			expect(refspec.trim()).toBe(originFetchRefspec);
		} finally {
			await rm(fixture.root, {recursive: true, force: true});
		}
	}, 60_000);

	test('resolves the project root from inside a worktree', async () => {
		const fixture = await createBareProject();
		try {
			const lines: string[] = [];
			const outcome = await runInit([], flags({yes: true}), fixture.tools, {
				...dependencies(fixture),
				// Standing inside the default worktree, not at the project root.
				cwd: join(fixture.project, 'main'),
				report(_kind, line) {
					lines.push(line);
				},
			});

			expect(outcome.code).toBe(exitCodes.success);
			const config = await readFile(
				join(fixture.project, 'chore-trunk-setup', '.config', 'wt.toml'),
				'utf8',
			);
			expect(config).toContain('[[pre-start]]');
		} finally {
			await rm(fixture.root, {recursive: true, force: true});
		}
	}, 60_000);

	test('keeps an existing config byte for byte under --yes', async () => {
		const fixture = await createBareProject();
		try {
			const worktree = join(fixture.project, 'main');
			await mkdir(join(worktree, '.config'), {recursive: true});
			await writeFile(join(worktree, '.config', 'wt.toml'), handWritten);

			const outcome = await runInit(
				[fixture.project],
				flags({yes: true}),
				fixture.tools,
				dependencies(fixture),
			);

			expect(outcome.code).toBe(exitCodes.success);
			const kept = await readFile(join(worktree, '.config', 'wt.toml'), 'utf8');
			expect(kept).toBe(handWritten);
		} finally {
			await rm(fixture.root, {recursive: true, force: true});
		}
	}, 60_000);

	test('shows what overwriting removes before writing', async () => {
		const fixture = await createBareProject(handWritten);
		try {
			const lines: string[] = [];
			await runInit([fixture.project], flags(), fixture.tools, {
				...dependencies(fixture),
				interactive: true,
				prompts: overwritePrompts(true),
				collect: acceptDefaults,
				report(_kind, line) {
					lines.push(line);
				},
			});

			const reported = lines.join('\n');
			// The hand-written alias is about to be lost; it has to be on screen,
			// with a count, before anything is written.
			expect(reported).toContain('- up = "echo up"');
			expect(reported).toMatch(/changes: \d+ added, \d+ removed/);
			expect(reported.indexOf('- up = "echo up"')).toBeLessThan(
				reported.indexOf('wrote .config/wt.toml'),
			);
		} finally {
			await rm(fixture.root, {recursive: true, force: true});
		}
	}, 60_000);

	test('declining the diff leaves the existing config alone', async () => {
		const fixture = await createBareProject(handWritten);
		try {
			const outcome = await runInit([fixture.project], flags(), fixture.tools, {
				...dependencies(fixture),
				interactive: true,
				prompts: overwritePrompts(false),
				collect: acceptDefaults,
			});

			expect(outcome.code).toBe(exitCodes.operationFailed);
			const kept = await readFile(
				join(fixture.project, 'main', '.config', 'wt.toml'),
				'utf8',
			);
			expect(kept).toBe(handWritten);
		} finally {
			await rm(fixture.root, {recursive: true, force: true});
		}
	}, 60_000);

	test('never adopts old values or renames tmux sessions', async () => {
		const fixture = await createBareProject(configuredWithPrefix);
		try {
			const commands: string[] = [];
			await runInit([fixture.project], flags(), fixture.tools, {
				...dependencies(fixture),
				interactive: true,
				prompts: overwritePrompts(true),
				collect: acceptDefaults,
				async run(command, arguments_, options) {
					commands.push(command);
					return runCommand(command, arguments_, options);
				},
			});

			// The old `P=acme` is replaced by the suggested prefix, not carried over.
			// Interactive runs let wt place the setup worktree, so ask git where.
			const setup = await worktreeOf(fixture.project, 'chore/trunk-setup');
			const config = await readFile(join(setup, '.config', 'wt.toml'), 'utf8');
			expect(config).not.toContain('P=acme\n');
			expect(config).toContain('P=remote');
			// Git and wt run, but nothing ever talks to a tmux server.
			expect(commands.filter(command => command.endsWith('tmux'))).toEqual([]);
		} finally {
			await rm(fixture.root, {recursive: true, force: true});
		}
	}, 60_000);

	test('sets up a bare project that has no origin', async () => {
		const fixture = await createBareProject(undefined, {origin: false});
		try {
			const lines: string[] = [];
			const outcome = await runInit(
				[fixture.project],
				flags({yes: true}),
				fixture.tools,
				{
					...dependencies(fixture),
					report(_kind, line) {
						lines.push(line);
					},
				},
			);

			expect(outcome.code).toBe(exitCodes.success);
			const config = await readFile(
				join(fixture.project, 'chore-trunk-setup', '.config', 'wt.toml'),
				'utf8',
			);
			// The project folder is the only name there is, so it seeds the prefix.
			expect(config).toContain('P=acme-a');

			const remotes = await git([
				'--git-dir',
				join(fixture.project, '.git'),
				'remote',
			]);
			expect(remotes.trim()).toBe('');
			const reported = lines.join('\n');
			expect(reported).toContain('no origin to push to');
			expect(reported).toContain('merge chore/trunk-setup');
			// Nothing to fetch or repair without an origin.
			expect(reported).not.toContain('fetch refspec');
		} finally {
			await rm(fixture.root, {recursive: true, force: true});
		}
	}, 60_000);

	test('refuses an empty bare repository without creating history', async () => {
		const root = await mkdtemp(join(tmpdir(), 'trunk-init-'));
		try {
			const project = join(root, 'empty-project');
			await mkdir(project);
			await git(['init', '--bare', join(project, '.git')]);

			const outcome = await runInit(
				[project],
				flags({yes: true}),
				await probeTools(),
				{
					cwd: root,
					interactive: false,
					report() {
						// Nothing is reported on this path.
					},
				},
			);

			expect(outcome.code).toBe(exitCodes.badUsage);
			expect(outcome.message).toContain('empty bare repository');
			expect(outcome.message).toContain('first commit yourself');

			// No branch, no commit, no worktree.
			const references = await git([
				'--git-dir',
				join(project, '.git'),
				'for-each-ref',
			]);
			expect(references.trim()).toBe('');
			expect(await readdirNames(project)).toEqual(['.git']);
		} finally {
			await rm(root, {recursive: true, force: true});
		}
	}, 60_000);

	test('highlights the diff and asks before overwriting', async () => {
		const fixture = await createBareProject(handWritten);
		try {
			const lines: string[] = [];
			const questions: string[] = [];
			await runInit([fixture.project], flags(), fixture.tools, {
				...dependencies(fixture),
				interactive: true,
				color: true,
				prompts: {
					...overwritePrompts(false),
					async confirm(question) {
						questions.push(question);
						return false;
					},
				},
				collect: acceptDefaults,
				report(_kind, line) {
					lines.push(line);
				},
			});

			// Removed lines red, added lines green, and the question comes after.
			expect(lines).toContain('\u001B[31m- up = "echo up"\u001B[39m');
			expect(lines.some(line => line.startsWith('\u001B[32m+ '))).toBe(true);
			expect(questions[0]).toContain('write this config');
		} finally {
			await rm(fixture.root, {recursive: true, force: true});
		}
	}, 60_000);

	test('offers only the approvals step and points at wt up', async () => {
		const fixture = await createBareProject();
		try {
			const lines: string[] = [];
			const questions: string[] = [];
			const outcome = await runInit([fixture.project], flags(), fixture.tools, {
				...dependencies(fixture),
				interactive: true,
				prompts: {
					async choose() {
						return 'keep';
					},
					async confirm(question) {
						questions.push(question);
						return question.includes('commit');
					},
				},
				collect: acceptDefaults,
				report(_kind, line) {
					lines.push(line);
				},
			});

			expect(outcome.code, lines.join('\n')).toBe(exitCodes.success);
			expect(
				questions.some(question => question.includes('approvals add')),
			).toBe(true);
			// No smoke test: nothing offers to run the hooks.
			expect(questions.join('\n')).not.toContain('smoke');
			expect(lines.join('\n')).toContain('wt up');
		} finally {
			await rm(fixture.root, {recursive: true, force: true});
		}
	}, 60_000);

	test('refuses a plain clone with a recipe and a warning', async () => {
		const fixture = await createPlainClone();
		try {
			const lines: string[] = [];
			const outcome = await runInit(
				[fixture.project],
				flags({yes: true}),
				fixture.tools,
				{
					...dependencies(fixture),
					report(_kind, line) {
						lines.push(line);
					},
				},
			);

			expect(outcome.code).toBe(exitCodes.unsupportedEnvironment);

			const reported = lines.join('\n');
			expect(reported).toContain('is a normal clone');
			expect(reported).toContain(`trunk clone ${fixture.remote}`);
			expect(reported).toContain('uncommitted changes');
			expect(reported).toContain('rm -rf');
			// The recipe is generic: no project-file or stack assumptions.
			expect(reported).not.toContain('.env');

			// Nothing was touched.
			const status = await git([
				'-C',
				fixture.project,
				'status',
				'--porcelain',
			]);
			expect(status).toContain('scratch.txt');
		} finally {
			await rm(fixture.root, {recursive: true, force: true});
		}
	}, 60_000);

	test('refuses a directory that holds no repository', async () => {
		const root = await mkdtemp(join(tmpdir(), 'trunk-init-'));
		try {
			const outcome = await runInit(
				[root],
				flags({yes: true}),
				await probeTools(),
				{
					cwd: root,
					interactive: false,
					report() {
						// Nothing is reported on this path.
					},
				},
			);

			expect(outcome.code).toBe(exitCodes.badUsage);
			expect(outcome.message).toContain('trunk clone');
		} finally {
			await rm(root, {recursive: true, force: true});
		}
	});
});

/** Overwrites the existing config, then answers the diff confirmation. */
function overwritePrompts(writeIt: boolean): SetupPrompts {
	return {
		async choose(question) {
			return question.includes('Keep it') ? 'overwrite' : 'keep';
		},
		async confirm(question) {
			if (question.includes('write this config')) {
				return writeIt;
			}

			// Approvals, the smoke test and publishing all touch the real machine;
			// renaming is stubbed, so it is safe to accept.
			return question.includes('commit') || question.includes('rename');
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

/** Shaped like a config from an older trunk: a prefix and a hand-added hook. */
const configuredWithPrefix = [
	'[[pre-start]]',
	"tmux = '''",
	'P=acme',
	"'''",
	'',
	'[[post-start]]',
	'extra = "echo hand added"',
	'',
].join('\n');

const handWritten = '# hand written\n[aliases]\nup = "echo up"\n';

function flags(overrides: Partial<CliFlags> = {}): CliFlags {
	return Object.assign(Object.create(null) as CliFlags, overrides);
}

function dependencies(fixture: Fixture) {
	return {
		cwd: fixture.workingDirectory,
		env: fixture.environment,
		interactive: false,
		invocation: {executable: 'trunk', arguments: ['init']},
		now: () => new Date('2026-09-18T00:00:00.000Z'),
		async attach(
			command: string,
			arguments_: readonly string[],
			options?: CommandOptions,
		) {
			const result = await runCommand(command, arguments_, options);
			return result.code ?? 1;
		},
		report() {
			// Progress is not what these tests assert.
		},
	};
}

/** A bare-layout project assembled the way a user would by hand. */
async function createBareProject(
	config?: string,
	options: Readonly<{origin?: boolean}> = {},
): Promise<Fixture> {
	const base = await createBase();
	const project = join(base.workingDirectory, 'acme-admin');
	await mkdir(project, {recursive: true});
	await git(['clone', '--bare', base.remote, join(project, '.git')]);
	if (options.origin === false) {
		await git([
			'--git-dir',
			join(project, '.git'),
			'remote',
			'remove',
			'origin',
		]);
	}

	await git([
		'--git-dir',
		join(project, '.git'),
		'worktree',
		'add',
		join(project, 'main'),
		'main',
	]);
	if (config) {
		await mkdir(join(project, 'main', '.config'), {recursive: true});
		await writeFile(join(project, 'main', '.config', 'wt.toml'), config);
	}

	return {...base, project};
}

async function createPlainClone(): Promise<Fixture> {
	const base = await createBase();
	const project = join(base.workingDirectory, 'acme-admin');
	await git(['clone', base.remote, project]);
	await writeFile(join(project, 'scratch.txt'), 'work in progress\n');
	return {...base, project};
}

async function createBase(): Promise<Omit<Fixture, 'project'>> {
	const root = await mkdtemp(join(tmpdir(), 'trunk-init-'));
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
	await git(['-C', source, 'add', '.']);
	await git(['-C', source, 'commit', '-m', 'Initial commit']);
	await git(['clone', '--bare', source, remote]);
	await git(['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main']);

	return {
		root,
		remote,
		workingDirectory,
		environment: gitEnvironment(home, root),
		tools: await probeTools(),
	};
}

function gitEnvironment(home: string, root: string): NodeJS.ProcessEnv {
	return Object.fromEntries([
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
	]);
}

async function probeTools(): Promise<ToolProbe> {
	const [gitPath, wtPath] = await Promise.all([
		resolveExecutable('git'),
		resolveExecutable('wt'),
	]);

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

/** Where git says a branch is checked out, wherever wt decided to put it. */
async function worktreeOf(project: string, branch: string): Promise<string> {
	const output = await git([
		'--git-dir',
		join(project, '.git'),
		'worktree',
		'list',
		'--porcelain',
	]);
	const entry = output
		.split('\n\n')
		.find(block => block.includes(`branch refs/heads/${branch}`));
	const path = /^worktree (.+)$/m.exec(entry ?? '')?.[1];
	if (!path) {
		throw new Error(`No worktree holds ${branch}.`);
	}

	return path;
}

async function readdirNames(path: string): Promise<string[]> {
	const names = await readdir(path);
	return names.sort();
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
