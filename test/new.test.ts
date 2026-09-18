/**
 * `trunk new`, entirely offline. The local path never touches the network, so
 * these tests exercise the real pipeline with `gh` absent from the probe.
 */
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {describe, expect, test} from 'bun:test';
import {runNew} from '../source/commands/new.js';
import {agentIds} from '../source/core/agents.js';
import type {CliFlags} from '../source/core/arguments.js';
import {resolveExecutable, type ToolProbe} from '../source/core/env.js';
import {sshRemoteUrl} from '../source/core/gh.js';
import {runCommand, type CommandOptions} from '../source/core/process.js';
import {exitCodes} from '../source/core/result.js';

describe('trunk new, offline', () => {
	test('creates a bare repo, a first commit and a clean config', async () => {
		const workspace = await createWorkspace();
		try {
			const outcome = await runNew(
				['demo'],
				flags({yes: true, remote: false}),
				await probeTools(),
				dependencies(workspace),
			);

			expect(outcome.code).toBe(exitCodes.success);

			const project = join(workspace.root, 'demo');
			const bare = await git([
				'--git-dir',
				join(project, '.git'),
				'rev-parse',
				'--is-bare-repository',
			]);
			expect(bare.trim()).toBe('true');

			const committed = await git([
				'-C',
				join(project, 'main'),
				'show',
				'--name-only',
				'--format=%s',
				'HEAD',
			]);
			expect(committed).toContain('Initial commit');
			expect(committed).toContain('.config/wt.toml');
			expect(committed).toContain('.gitignore');

			const status = await git([
				'-C',
				join(project, 'main'),
				'status',
				'--porcelain',
			]);
			expect(status.trim()).toBe('');

			const shown = await wt(['-C', join(project, 'main'), 'config', 'show']);
			expect(shown.toLowerCase()).not.toContain('warning');
		} finally {
			await rm(workspace.root, {recursive: true, force: true});
		}
	}, 60_000);

	test('writes the project name out where remote_repo would be empty', async () => {
		const workspace = await createWorkspace();
		try {
			await runNew(
				['demo'],
				// Caddy is not installed in the probe, so the route is asked for
				// explicitly; its templates are the ones that need the literal name.
				flags({yes: true, remote: false, server: true, caddy: true}),
				await probeTools(),
				dependencies(workspace),
			);

			const config = await readFile(
				join(workspace.root, 'demo', 'main', '.config', 'wt.toml'),
				'utf8',
			);

			expect(config).toContain('# No git remote yet');
			expect(config).toContain('ID=wt:demo:{{ branch | sanitize }}');
			expect(config).toContain('HOST={{ branch | sanitize }}.demo.localhost');
			expect(config).toContain(
				'url = "http://{{ branch | sanitize }}.demo.localhost:8080"',
			);
			expect(config).toContain("{{ ('demo/' ~ branch) | hash_port }}");
			// The variable that would render empty must not appear anywhere but
			// the note that explains it.
			const uses = config
				.split('\n')
				.filter(line => line.includes('remote_repo') && !line.startsWith('#'));
			expect(uses).toEqual([]);
		} finally {
			await rm(workspace.root, {recursive: true, force: true});
		}
	}, 60_000);

	test('refuses a name GitHub would reject, before creating anything', async () => {
		const workspace = await createWorkspace();
		try {
			const outcome = await runNew(
				['not valid/name'],
				flags({yes: true, remote: false}),
				await probeTools(),
				dependencies(workspace),
			);

			expect(outcome.code).toBe(exitCodes.badUsage);
			expect(outcome.message).toContain('not a valid repository name');
		} finally {
			await rm(workspace.root, {recursive: true, force: true});
		}
	});

	test('refuses a folder that already holds something', async () => {
		const workspace = await createWorkspace();
		const occupied = join(workspace.root, 'demo');
		await mkdir(occupied, {recursive: true});
		await writeFile(join(occupied, 'notes.txt'), 'mine\n');
		try {
			const outcome = await runNew(
				['demo'],
				flags({yes: true, remote: false}),
				await probeTools(),
				dependencies(workspace),
			);

			expect(outcome.code).toBe(exitCodes.badUsage);
			expect(await readFile(join(occupied, 'notes.txt'), 'utf8')).toBe(
				'mine\n',
			);
		} finally {
			await rm(workspace.root, {recursive: true, force: true});
		}
	});

	test('stays local when gh is not installed', async () => {
		const workspace = await createWorkspace();
		const lines: string[] = [];
		try {
			const outcome = await runNew(
				['demo'],
				// Asking for a remote on a machine without gh warns and carries on.
				flags({yes: true, remote: true}),
				await probeTools(),
				{
					...dependencies(workspace),
					report(_kind, line) {
						lines.push(line);
					},
				},
			);

			expect(outcome.code).toBe(exitCodes.success);
			expect(lines.join('\n')).toContain('gh is not installed');
			const remotes = await git([
				'--git-dir',
				join(workspace.root, 'demo', '.git'),
				'remote',
			]);
			expect(remotes.trim()).toBe('');
		} finally {
			await rm(workspace.root, {recursive: true, force: true});
		}
	}, 60_000);
});

describe('choosing the ssh host for a new remote', () => {
	const aliases = Object.freeze(
		Object.fromEntries([
			['github.com', 'github.com'],
			['github.com-work', 'github.com'],
			['gitlab.com-eq', 'gitlab.com'],
		]),
	);

	test('prefers the alias a sibling project already uses', () => {
		expect(
			sshRemoteUrl('Example-Org', 'demo', 'github.com', aliases, [
				'github.com-work',
			]),
		).toBe('git@github.com-work:Example-Org/demo.git');
	});

	test('falls back to an alias that resolves to the host', () => {
		expect(sshRemoteUrl('someone', 'demo', 'github.com', aliases)).toBe(
			'git@github.com:someone/demo.git',
		);
	});

	test('uses the host itself when no alias matches', () => {
		expect(sshRemoteUrl('someone', 'demo', 'example.com', aliases)).toBe(
			'git@example.com:someone/demo.git',
		);
	});
});

type Workspace = Readonly<{root: string; environment: NodeJS.ProcessEnv}>;

function flags(overrides: Partial<CliFlags> = {}): CliFlags {
	return Object.assign(Object.create(null) as CliFlags, overrides);
}

function dependencies(workspace: Workspace) {
	return {
		cwd: workspace.root,
		env: workspace.environment,
		interactive: false,
		invocation: {executable: 'trunk', arguments: ['new']},
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

async function createWorkspace(): Promise<Workspace> {
	const root = await mkdtemp(join(tmpdir(), 'trunk-new-'));
	const home = join(root, 'home');
	await mkdir(join(home, '.config'), {recursive: true});

	return {
		root,
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

/** `gh` is deliberately absent: the offline path must not need it. */
async function probeTools(): Promise<ToolProbe> {
	const [gitPath, wtPath] = await Promise.all([
		resolveExecutable('git'),
		resolveExecutable('wt'),
	]);

	return {
		git: {name: 'git', path: gitPath},
		wt: {name: 'wt', path: wtPath},
		tmux: {name: 'tmux'},
		caddy: {name: 'caddy'},
		brew: {name: 'brew'},
		gh: {name: 'gh'},
		agents: Object.fromEntries(
			agentIds.map(id => [id, {name: id}]),
		) as ToolProbe['agents'],
	};
}

async function git(arguments_: readonly string[]): Promise<string> {
	const result = await runCommand('git', arguments_, {
		env: Object.fromEntries([
			['HOME', tmpdir()],
			['PATH', process.env['PATH'] ?? ''],
			['GIT_CONFIG_NOSYSTEM', '1'],
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
