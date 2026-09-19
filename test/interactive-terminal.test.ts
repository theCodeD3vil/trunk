/**
 * Every interactive screen, in a real terminal, with the environment variables
 * that make Ink believe it is running in CI. Ink then draws nothing until the
 * program exits, which for a person at a keyboard looks like a hung command that
 * only shows its screen after Ctrl+C. Each screen has to appear on its own.
 */
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {afterAll, describe, expect, test} from 'bun:test';
import {resolveExecutable} from '../source/core/env.js';
import {runCommand} from '../source/core/process.js';
import {buildCli} from './helpers/run.js';

const socket = `trunk-interactive-${process.pid}`;

/** Each of these alone makes Ink's CI check true. */
const ciEnvironments: ReadonlyArray<readonly [string, string]> = [
	['a generic CI flag', 'CI=true'],
	['a hosting vendor marker', 'VERCEL=1'],
	['GitHub Actions', 'GITHUB_ACTIONS=true'],
	['a build number', 'BUILD_NUMBER=7'],
];

describe('interactive screens appear live even when the environment looks like CI', () => {
	const build = buildCli();
	const roots: string[] = [];

	afterAll(async () => {
		const tmux = await resolveExecutable('tmux');
		if (tmux) {
			await runCommand(tmux, ['-L', socket, 'kill-server']);
		}

		await Promise.all(
			roots.map(async root => rm(root, {recursive: true, force: true})),
		);
		const {cleanup} = await build;
		await cleanup();
	});

	for (const [name, variable] of ciEnvironments) {
		test(`trunk docs shows its menu with ${name} (${variable})`, async () => {
			const tmux = await requireTmux();
			const {cliPath} = await build;
			const root = await scratch(roots);

			const session = `docs-${variable.split('=')[0]!}`;

			await start(tmux, session, root, [
				variable,
				`node ${quote(cliPath)} docs`,
			]);

			// No key has been pressed: the screen must already be there.
			const screen = await waitForScreen(tmux, session, 'Config Basics');
			// The sidebar lists every topic and section straight away.
			expect(screen).toContain('Node');
			expect(screen).toContain('Install dependencies');
			expect(screen).toContain('scroll');

			await send(tmux, session, 'q');
			await waitForExit(tmux, session);
		}, 60_000);
	}

	test('at 80 columns the docs fold the sidebar away and the side arrows step through sections', async () => {
		const tmux = await requireTmux();
		const {cliPath} = await build;
		const root = await scratch(roots);

		await start(
			tmux,
			'narrow',
			root,
			['CI=true', `node ${quote(cliPath)} docs`],
			80,
		);
		const first = await waitForScreen(tmux, 'narrow', 'What Trunk generates');
		expect(first).toContain('1 of 13');
		expect(first).not.toContain('Adding your own hooks');

		await send(tmux, 'narrow', 'Right');
		const second = await waitForScreen(tmux, 'narrow', '2 of 13');
		expect(second).toContain('Hook lifecycle');

		await send(tmux, 'narrow', 'q');
		await waitForExit(tmux, 'narrow');
	}, 60_000);

	test('the setup form appears live too, and Ctrl+C leaves it cleanly', async () => {
		const tmux = await requireTmux();
		const {cliPath} = await build;
		const root = await scratch(roots);
		const project = await bareProject(root);

		await start(tmux, 'form', root, [
			'CI=true',
			'VERCEL=1',
			`WORKTRUNK_CONFIG_PATH=${quote(join(root, 'worktrunk.toml'))}`,
			`node ${quote(cliPath)} init ${quote(project)}`,
		]);

		const screen = await waitForScreen(
			tmux,
			'form',
			'Configure worktree automation',
		);
		for (const field of [
			'Session prefix',
			'tmux workspace',
			'Copy ignored files',
			'wt mc alias',
			'Preview',
		]) {
			expect(screen).toContain(field);
		}

		await send(tmux, 'form', 'C-c');
		await waitForExit(tmux, 'form');
	}, 90_000);

	test('init walks the form, the review and the run, and does not push unasked', async () => {
		const tmux = await requireTmux();
		const {cliPath} = await build;
		const root = await scratch(roots);
		const project = await bareProject(root);

		await start(tmux, 'flow', root, [
			'CI=true',
			'VERCEL=1',
			`WORKTRUNK_CONFIG_PATH=${quote(join(root, 'worktrunk.toml'))}`,
			`node ${quote(cliPath)} init ${quote(project)}`,
		]);
		await waitForScreen(tmux, 'flow', 'Configure worktree automation');

		// Accept every default. How many questions there are depends on which
		// agents this machine has, so press Enter until the review appears.
		let review = '';
		for (let attempt = 0; attempt < 12 && review === ''; attempt += 1) {
			// eslint-disable-next-line no-await-in-loop
			const screen = await screenOf(tmux, 'flow');
			if (screen.includes('Ready to set up')) {
				review = screen;
			} else {
				// eslint-disable-next-line no-await-in-loop
				await send(tmux, 'flow', 'Enter');
				// eslint-disable-next-line no-await-in-loop
				await delay(150);
			}
		}

		expect(review).toContain('Your choices');
		expect(review).toContain('chore-trunk-setup/');
		await send(tmux, 'flow', 'Enter');

		// The result card, with the push question on its safe answer.
		const result = await waitForScreen(tmux, 'flow', 'Not now');
		expect(result).toContain('is ready');
		expect(result).toContain('Validate with Worktrunk');
		expect(result).toContain('cd ');
		await send(tmux, 'flow', 'Enter');
		await waitForExit(tmux, 'flow');

		const config = await readFile(
			join(project, 'chore-trunk-setup', '.config', 'wt.toml'),
			'utf8',
		);
		expect(config).toContain('# Worktree automation shared by everyone');
		const branches = await runCommand('git', [
			'-C',
			join(root, 'source'),
			'branch',
			'--list',
		]);
		expect(branches.stdout).not.toContain('chore/trunk-setup');
	}, 120_000);
});

async function requireTmux(): Promise<string> {
	const tmux = await resolveExecutable('tmux');
	expect(tmux).toBeDefined();
	return tmux!;
}

async function scratch(roots: string[]): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'trunk-interactive-'));
	roots.push(root);
	return root;
}

/**
 * Starts a command in a pane. `env -i` clears the developer's own environment
 * first, so the only CI-like variables are the ones the test names.
 */
async function start(
	tmux: string,
	session: string,
	root: string,
	assignmentsAndCommand: readonly string[],
	columns = 110,
): Promise<void> {
	const command = assignmentsAndCommand.at(-1)!;
	const assignments = assignmentsAndCommand.slice(0, -1);
	const environment = [
		`PATH=${quote(process.env['PATH'] ?? '')}`,
		`HOME=${quote(root)}`,
		'TERM=tmux-256color',
		'GIT_AUTHOR_NAME=Trunk',
		'GIT_AUTHOR_EMAIL=trunk@example.com',
		'GIT_COMMITTER_NAME=Trunk',
		'GIT_COMMITTER_EMAIL=trunk@example.com',
		...assignments,
	].join(' ');
	const started = await runCommand(tmux, [
		'-L',
		socket,
		'new-session',
		'-d',
		'-x',
		String(columns),
		'-y',
		'36',
		'-s',
		session,
		'-c',
		root,
		`env -i ${environment} ${command}`,
	]);
	expect(started.code, started.stderr).toBe(0);
}

/** A bare-layout project with a main worktree, ready for `trunk init`. */
async function bareProject(root: string): Promise<string> {
	const git = async (arguments_: readonly string[]) => {
		const result = await runCommand('git', arguments_, {
			env: Object.fromEntries([
				['HOME', root],
				['PATH', process.env['PATH'] ?? ''],
				['GIT_CONFIG_NOSYSTEM', '1'],
				['GIT_AUTHOR_NAME', 'Trunk'],
				['GIT_AUTHOR_EMAIL', 'trunk@example.com'],
				['GIT_COMMITTER_NAME', 'Trunk'],
				['GIT_COMMITTER_EMAIL', 'trunk@example.com'],
			]),
		});
		expect(result.code, result.stderr).toBe(0);
	};

	const source = join(root, 'source');
	const project = join(root, 'acme-admin');
	await mkdir(source);
	await mkdir(project);
	await git(['init', '--initial-branch', 'main', source]);
	await writeFile(join(source, 'README.md'), '# fixture\n');
	await git(['-C', source, 'add', 'README.md']);
	await git(['-C', source, 'commit', '-m', 'Initial commit']);
	await git(['clone', '--bare', source, join(project, '.git')]);
	await git([
		'--git-dir',
		join(project, '.git'),
		'worktree',
		'add',
		join(project, 'main'),
		'main',
	]);
	return project;
}

async function send(tmux: string, session: string, key: string): Promise<void> {
	await runCommand(tmux, ['-L', socket, 'send-keys', '-t', session, key]);
}

async function screenOf(tmux: string, session: string): Promise<string> {
	const result = await runCommand(tmux, [
		'-L',
		socket,
		'capture-pane',
		'-p',
		'-t',
		session,
	]);
	return result.stdout;
}

async function waitForScreen(
	tmux: string,
	session: string,
	text: string,
): Promise<string> {
	let latest = '';
	for (let attempt = 0; attempt < 100; attempt += 1) {
		// Polling: each check has to follow the previous delay.
		// eslint-disable-next-line no-await-in-loop
		latest = await screenOf(tmux, session);
		if (latest.includes(text)) {
			return latest;
		}

		// eslint-disable-next-line no-await-in-loop
		await delay(100);
	}

	throw new Error(
		`"${text}" never appeared before a key was pressed. Screen:\n${latest}`,
	);
}

async function waitForExit(tmux: string, session: string): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		// eslint-disable-next-line no-await-in-loop
		const result = await runCommand(tmux, [
			'-L',
			socket,
			'has-session',
			'-t',
			session,
		]);
		if (result.code !== 0) {
			return;
		}

		// eslint-disable-next-line no-await-in-loop
		await delay(100);
	}

	throw new Error(`${session} did not exit.`);
}

async function delay(milliseconds: number): Promise<void> {
	await new Promise(resolve => {
		setTimeout(resolve, milliseconds);
	});
}

function quote(value: string): string {
	return `'${value.split("'").join(`'"'"'`)}'`;
}
