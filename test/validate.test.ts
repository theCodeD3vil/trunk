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

			// Every generated alias must survive expansion.
			for (const alias of aliasNames(settings)) {
				// eslint-disable-next-line no-await-in-loop
				const dryRun = await runCommand(
					wtPath,
					['-C', worktree, 'config', 'alias', 'dry-run', alias],
					{env: environment},
				);
				expect(dryRun.code, dryRun.stderr || dryRun.stdout).toBe(0);
			}
		}
	}, 30_000);

	test('wt expands the removal hook that ends the tmux session', async () => {
		const wtPath = await resolveExecutable('wt');
		expect(wtPath).toBeDefined();
		if (!wtPath) {
			return;
		}

		const {worktree, environment} = await fixture;
		await writeFile(
			join(worktree, '.config', 'wt.toml'),
			compose(testSettings()),
		);
		const shown = await runCommand(
			wtPath,
			['-C', worktree, 'hook', 'show', '--expanded', '--format', 'json'],
			{env: environment},
		);
		const hooks = JSON.parse(shown.stdout) as Array<{
			type: string;
			name: string;
			expanded: string;
		}>;
		const postRemove = hooks.find(
			hook => hook.type === 'post-remove' && hook.name === 'tmux',
		);

		// The branch comes from Worktrunk's template variables, so the hook needs
		// nothing from the worktree that is about to disappear.
		expect(postRemove?.expanded).toContain('B=main');
		expect(postRemove?.expanded).toContain('tmux kill-session -t "$SID"');
	}, 30_000);

	test('reports a hook the config failed to define', async () => {
		const wtPath = await resolveExecutable('wt');
		if (!wtPath) {
			return;
		}

		const {worktree, environment} = await fixture;
		// The settings claim a tmux session but the file defines none of its hooks.
		await writeFile(join(worktree, '.config', 'wt.toml'), '# empty\n');

		let failure: unknown;
		try {
			await validateGeneratedConfig(worktree, testSettings(), {
				wtPath,
				env: environment,
			});
		} catch (error: unknown) {
			failure = error;
		}

		expect(failure).toBeInstanceOf(GeneratedConfigError);
		expect((failure as Error).message).toContain('omitted generated hooks');
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
	// `up` re-runs the start hooks, so it exists whenever one does.
	if (settings.tmux || settings.copyIgnored) {
		names.push('up');
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
