import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import process from 'node:process';
import {afterAll, describe, expect, test} from 'bun:test';
import {compose} from '../source/core/generate/index.js';
import {resolveExecutable} from '../source/core/env.js';
import {runCommand, type CommandResult} from '../source/core/process.js';
import type {Settings} from '../source/core/settings.js';
import {
	GeneratedConfigError,
	validateGeneratedConfig,
} from '../source/core/validate.js';
import {generatorCases} from './helpers/generator-cases.js';
import {testSettings} from './helpers/settings.js';

describe('generated config validation', () => {
	const fixture = createFixture();

	afterAll(async () => {
		const resolvedFixture = await fixture;
		await rm(resolvedFixture.root, {recursive: true, force: true});
	});

	test('wt validates and expands every representative snapshot', async () => {
		const wtPath = await resolveExecutable('wt');
		expect(wtPath).toBeDefined();
		if (!wtPath) {
			return;
		}

		const {worktree, environment} = await fixture;
		for (const [, settings] of generatorCases) {
			// Cases share one worktree, so config writes and reads must stay serial.
			// eslint-disable-next-line no-await-in-loop
			await writeFile(join(worktree, '.config', 'wt.toml'), compose(settings));
			// eslint-disable-next-line no-await-in-loop
			const result = await validateGeneratedConfig(worktree, settings, {
				wtPath,
				env: environment,
			});

			expect(result.configOutput.toLowerCase()).not.toContain('warning');
			if (settings.tmux) {
				expect(result.preview.session).toBe(`${settings.prefix}_main`);
			}

			if (settings.server) {
				expect(result.preview.port).toBeGreaterThanOrEqual(10_000);
				expect(result.preview.port).toBeLessThanOrEqual(19_999);
			}

			// Every generated alias must survive expansion, not just `url`.
			for (const alias of aliasNames(settings)) {
				// eslint-disable-next-line no-await-in-loop
				const dryRun = await runCommand(
					wtPath,
					['-C', worktree, 'config', 'alias', 'dry-run', alias],
					{env: environment},
				);
				expect(dryRun.code, dryRun.stderr || dryRun.stdout).toBe(0);
			}

			if (settings.server && settings.caddy) {
				expect(result.preview.url).toBe(
					`http://main.${settings.hostLabel}.localhost:8080`,
				);
				// eslint-disable-next-line no-await-in-loop
				const aliasResults = await Promise.all([
					runCommand(
						wtPath,
						['-C', worktree, 'config', 'alias', 'dry-run', 'url'],
						{env: environment},
					),
					runCommand(
						wtPath,
						[
							'-C',
							worktree,
							'config',
							'alias',
							'dry-run',
							'url',
							'--',
							'feature/auth',
						],
						{env: environment},
					),
				]);
				for (const aliasResult of aliasResults) {
					expect(
						aliasResult.code,
						aliasResult.stderr || aliasResult.stdout,
					).toBe(0);
				}
			}
		}
	}, 30_000);

	test('surfaces raw Worktrunk warnings', async () => {
		const warning = 'warning: misplaced setting\n';
		try {
			await validateGeneratedConfig('/tmp/project', testSettings(), {
				run: async (): Promise<CommandResult> => ({
					code: 0,
					stdout: warning,
					stderr: '',
				}),
			});
			throw new Error('Expected validation to fail.');
		} catch (error: unknown) {
			expect(error).toBeInstanceOf(GeneratedConfigError);
			if (error instanceof GeneratedConfigError) {
				expect(error.output).toBe(warning.trimEnd());
			}
		}
	});
});

function aliasNames(settings: Settings): string[] {
	const names: string[] = [];
	// `up` re-runs pre-start, the server step, or both, so it exists whenever
	// either side does.
	if (settings.tmux || settings.server) {
		names.push('up');
	}

	if (settings.server && settings.caddy) {
		names.push('url');
	}

	if (settings.mcAlias) {
		names.push('mc');
	}

	return names;
}

async function createFixture(): Promise<{
	root: string;
	worktree: string;
	environment: NodeJS.ProcessEnv;
}> {
	const root = await mkdtemp(join(tmpdir(), 'trunk-validate-'));
	const worktree = join(root, 'project');
	const home = join(root, 'home');
	const configPath = join(root, 'config', 'worktrunk.toml');
	await Promise.all([
		mkdir(worktree),
		mkdir(home),
		mkdir(dirname(configPath), {recursive: true}),
	]);
	await git(['init', '--initial-branch', 'main', worktree]);
	await mkdir(join(worktree, '.config'));
	await writeFile(join(worktree, 'README.md'), '# fixture\n');
	await git(['-C', worktree, 'add', 'README.md']);
	await git([
		'-C',
		worktree,
		'-c',
		'user.name=Trunk Tests',
		'-c',
		'user.email=trunk@example.com',
		'commit',
		'-m',
		'Initial commit',
	]);
	await git(['-C', worktree, 'config', 'worktrunk.default-branch', 'main']);
	await git([
		'-C',
		worktree,
		'remote',
		'add',
		'origin',
		'git@example.com:example/Web-shop--portal.git',
	]);

	return {
		root,
		worktree,
		environment: Object.fromEntries([
			['HOME', home],
			['NO_COLOR', '1'],
			['PATH', process.env['PATH'] ?? ''],
			['TERM', 'dumb'],
			['WORKTRUNK_CONFIG_PATH', configPath],
			['WORKTRUNK_SYSTEM_CONFIG_PATH', join(root, 'config', 'system.toml')],
			['XDG_CONFIG_HOME', join(home, '.config')],
		]),
	};
}

async function git(arguments_: readonly string[]): Promise<void> {
	const result = await runCommand('git', arguments_, {
		env: Object.fromEntries([
			['HOME', tmpdir()],
			['PATH', process.env['PATH'] ?? ''],
			['GIT_CONFIG_NOSYSTEM', '1'],
		]),
	});
	if (result.code !== 0) {
		throw new Error(result.stderr || result.stdout);
	}
}
