/**
 * `trunk new`, entirely offline. The local path has no `gh`; remote tests fake
 * GitHub while still exercising the real local Git and Worktrunk pipeline.
 */
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {describe, expect, test} from 'bun:test';
import {runNew} from '../source/commands/new.js';
import {agentIds} from '../source/core/agents.js';
import type {CliFlags} from '../source/core/arguments.js';
import {resolveExecutable, type ToolProbe} from '../source/core/env.js';
import {sshRemoteUrl} from '../source/core/gh.js';
import {
	runCommand,
	type CommandOptions,
	type CommandRunner,
} from '../source/core/process.js';
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
			sshRemoteUrl('Example-Org', 'demo', {
				realHost: 'github.com',
				aliases,
				siblingHosts: ['github.com-work'],
			}),
		).toBe('git@github.com-work:Example-Org/demo.git');
	});

	test('falls back to an alias that resolves to the host', () => {
		expect(
			sshRemoteUrl('someone', 'demo', {realHost: 'github.com', aliases}),
		).toBe('git@github.com:someone/demo.git');
	});

	test('uses the host itself when no alias matches', () => {
		expect(
			sshRemoteUrl('someone', 'demo', {realHost: 'example.com', aliases}),
		).toBe('git@example.com:someone/demo.git');
	});
});

describe('trunk new with a GitHub remote', () => {
	test('shows and uses the ssh alias already used by a sibling project', async () => {
		const workspace = await createWorkspace();
		const events: string[] = [];
		try {
			await createSiblingProject(workspace, 'github.com-work');
			await writeSshConfig(workspace);
			const run = githubRunner(workspace, events);

			const outcome = await runNew(
				['demo'],
				flags({yes: true, remote: true, owner: 'Example-Org'}),
				await probeTools('gh-test'),
				{
					...dependencies(workspace),
					run,
					report(_kind, line) {
						events.push(`report ${line}`);
					},
				},
			);

			expect(outcome.code).toBe(exitCodes.success);
			const url = 'git@github.com-work:Example-Org/demo.git';
			const reportIndex = events.indexOf(`report remote will be ${url}`);
			const localCreateIndex = events.findIndex(event =>
				event.includes(' init --bare '),
			);
			const remoteCreateIndex = events.findIndex(event =>
				event.includes('gh-test repo create Example-Org/demo'),
			);
			expect(reportIndex).toBeGreaterThanOrEqual(0);
			expect(reportIndex).toBeLessThan(localCreateIndex);
			expect(reportIndex).toBeLessThan(remoteCreateIndex);

			const configured = await git([
				'--git-dir',
				join(workspace.root, 'demo', '.git'),
				'remote',
				'get-url',
				'origin',
			]);
			expect(configured.trim()).toBe(url);
		} finally {
			await rm(workspace.root, {recursive: true, force: true});
		}
	}, 60_000);

	test('rolls back local files but leaves a created GitHub repository', async () => {
		const workspace = await createWorkspace();
		const events: string[] = [];
		const questions: string[] = [];
		try {
			await writeSshConfig(workspace);
			const outcome = await runNew(
				['demo'],
				flags({remote: true, owner: 'Example-Org'}),
				await probeTools('gh-test'),
				{
					...dependencies(workspace),
					interactive: true,
					run: githubRunner(workspace, events, true),
					prompts: {
						async choose(question) {
							questions.push(question);
							return 'rollback';
						},
						async confirm() {
							return true;
						},
					},
					report(_kind, line) {
						events.push(`report ${line}`);
					},
				},
			);

			expect(outcome.code).toBe(exitCodes.userAborted);
			expect(questions).toContain('keep, or roll back what this run created?');
			const reported = events.join('\n');
			expect(reported).toContain('Example-Org/demo');
			expect(reported).toContain(
				'GitHub repository (trunk will not delete it)',
			);
			expect(reported).toContain('gh repo delete Example-Org/demo --yes');
			expect(events.some(event => event.startsWith('gh repo delete '))).toBe(
				false,
			);
			expect(await exists(join(workspace.root, 'demo'))).toBe(false);
		} finally {
			await rm(workspace.root, {recursive: true, force: true});
		}
	}, 60_000);
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
async function probeTools(ghPath?: string): Promise<ToolProbe> {
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
		gh: {name: 'gh', path: ghPath},
		agents: Object.fromEntries(
			agentIds.map(id => [id, {name: id}]),
		) as ToolProbe['agents'],
	};
}

function githubRunner(
	workspace: Workspace,
	events: string[],
	failRemoteAdd = false,
): CommandRunner {
	return async (command, arguments_, options) => {
		events.push(`${command} ${arguments_.join(' ')}`);
		if (command === 'gh-test') {
			if (arguments_[0] === 'api' && arguments_[1] === 'user') {
				return {code: 0, stdout: 'signed-in-user\n', stderr: ''};
			}

			if (arguments_[0] === 'repo' && arguments_[1] === 'create') {
				return {
					code: 0,
					stdout: 'https://github.com/Example-Org/demo\n',
					stderr: '',
				};
			}
		}

		if (
			failRemoteAdd &&
			arguments_.includes('remote') &&
			arguments_.includes('add') &&
			arguments_.includes('origin')
		) {
			return {code: 1, stdout: '', stderr: 'simulated remote failure'};
		}

		if (arguments_.includes('fetch') || arguments_.includes('push')) {
			return {code: 0, stdout: '', stderr: ''};
		}

		return runCommand(command, arguments_, {
			...options,
			env: options?.env ?? workspace.environment,
		});
	};
}

async function createSiblingProject(
	workspace: Workspace,
	host: string,
): Promise<void> {
	const sibling = join(workspace.root, 'existing-project');
	const gitDirectory = join(sibling, '.git');
	await mkdir(sibling);
	await git(['init', '--bare', gitDirectory]);
	await git([
		'--git-dir',
		gitDirectory,
		'remote',
		'add',
		'origin',
		`git@${host}:Example-Org/existing-project.git`,
	]);
}

async function writeSshConfig(workspace: Workspace): Promise<void> {
	const ssh = join(workspace.root, 'home', '.ssh');
	await mkdir(ssh, {recursive: true});
	await writeFile(
		join(ssh, 'config'),
		`Host github.com
  HostName github.com

Host github.com-work
  HostName github.com
`,
	);
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
