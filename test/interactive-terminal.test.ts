/**
 * Every interactive screen, in a real terminal, with the environment variables
 * that make Ink believe it is running in CI. Ink then draws nothing until the
 * program exits, which for a person at a keyboard looks like a hung command that
 * only shows its screen after Ctrl+C. Each screen has to appear on its own.
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
import {afterAll, describe, expect, test} from 'bun:test';
import {resolveExecutable} from '../source/core/env.js';
import {runCommand} from '../source/core/process.js';
import {buildCli} from './helpers/run.js';

const socket = `trunk-interactive-${process.pid}`;

// Bold, as a terminal capture spells it: an SGR sequence with a 1 among its codes.
// eslint-disable-next-line no-control-regex
const boldOn = /\u001B\[[\d;]*1[;m]/;

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

	test('the screens are drawn in colour, however the environment is set', async () => {
		const tmux = await requireTmux();
		const {cliPath} = await build;
		const root = await scratch(roots);

		// A plain terminal, a CI flag, and a hosting marker in a shell profile.
		for (const [index, variable] of [
			'TRUNK_TEST=1',
			'CI=true',
			'VERCEL=1',
		].entries()) {
			const session = `colour-${index}`;
			// eslint-disable-next-line no-await-in-loop
			await start(tmux, session, root, [
				'COLORTERM=truecolor',
				variable,
				`node ${quote(cliPath)} docs`,
			]);
			// eslint-disable-next-line no-await-in-loop
			await waitForScreen(tmux, session, 'Config Basics');
			// eslint-disable-next-line no-await-in-loop
			const styled = await screenOf(tmux, session, true);

			// The teal brand pill is a background colour: without it the design is gone.
			expect(styled, variable).toContain('48;2;111;211;192');
			// Teal is also the focus colour on text, and the current page is bold.
			expect(styled, variable).toContain('38;2;111;211;192');
			expect(styled, variable).toMatch(boldOn);

			// eslint-disable-next-line no-await-in-loop
			await send(tmux, session, 'q');
			// eslint-disable-next-line no-await-in-loop
			await waitForExit(tmux, session);
		}
	}, 90_000);

	test('NO_COLOR keeps bold and dim but draws no colour', async () => {
		const tmux = await requireTmux();
		const {cliPath} = await build;
		const root = await scratch(roots);

		await start(tmux, 'mono', root, [
			'COLORTERM=truecolor',
			'NO_COLOR=1',
			`node ${quote(cliPath)} docs`,
		]);
		await waitForScreen(tmux, 'mono', 'Config Basics');
		const styled = await screenOf(tmux, 'mono', true);

		expect(styled).not.toContain('38;2;');
		expect(styled).not.toContain('48;2;');
		expect(styled).toMatch(boldOn);

		await send(tmux, 'mono', 'q');
		await waitForExit(tmux, 'mono');
	}, 60_000);

	test('pasted text and held keys arrive whole', async () => {
		const tmux = await requireTmux();
		const {cliPath} = await build;
		const root = await scratch(roots);

		await start(tmux, 'paste', root, [
			'CI=true',
			`node ${quote(cliPath)} docs`,
		]);
		await waitForScreen(tmux, 'paste', 'Config Basics');

		await send(tmux, 'paste', '/');
		await waitForScreen(tmux, 'paste', 'titles, prose and code');
		// One write, as a paste is: every character must count.
		await sendLiteral(tmux, 'paste', 'pnpm');
		const found = await waitForScreen(tmux, 'paste', 'pnpm');
		expect(found).toMatch(/\/ {2}pnpm.*\d+ results?/);
		expect(found).toContain('Install dependencies');

		// Two Backspaces in one write, as a held key arrives while the screen redraws.
		await runCommand(tmux, [
			'-L',
			socket,
			'send-keys',
			'-t',
			'paste',
			'-H',
			'7f',
			'7f',
		]);
		const shorter = await waitForScreen(tmux, 'paste', '/  pn');
		expect(shorter).not.toContain('/  pnpm');

		await send(tmux, 'paste', 'Escape');
		await send(tmux, 'paste', 'q');
		await waitForExit(tmux, 'paste');
	}, 60_000);

	test('the mouse clicks key caps and sidebar entries, and the wheel scrolls', async () => {
		const tmux = await requireTmux();
		const {cliPath} = await build;
		const root = await scratch(roots);

		await start(tmux, 'mouse', root, [
			'CI=true',
			`node ${quote(cliPath)} docs`,
		]);
		const first = await waitForScreen(tmux, 'mouse', 'Config Basics');
		expect(await mouseReported(tmux, 'mouse')).toBe(true);

		// A sidebar entry opens its page.
		const entry = locate(first, 'Hook lifecycle');
		await sendLiteral(tmux, 'mouse', click(entry.column, entry.row));
		const second = await waitForScreen(tmux, 'mouse', '2 of 13');
		expect(second).toContain('docs › Config Basics › Hook lifecycle');

		// The wheel scrolls the reader by lines, like the arrow keys.
		const before = second.split('\n')[3];
		await sendLiteral(tmux, 'mouse', wheelDown + wheelDown);
		await waitForChange(
			tmux,
			'mouse',
			screen => screen.split('\n')[3] !== before,
		);

		// A key cap does what the key does: quit.
		const bar = await screenOf(tmux, 'mouse');
		const quit = locate(bar, ' q ');
		await sendLiteral(tmux, 'mouse', click(quit.column + 1, quit.row));
		await waitForExit(tmux, 'mouse');
	}, 60_000);

	test('mouse reporting is off when TRUNK_MOUSE=0, and off again once trunk has quit', async () => {
		const tmux = await requireTmux();
		const {cliPath} = await build;
		const root = await scratch(roots);

		await start(tmux, 'no-mouse', root, [
			'CI=true',
			'TRUNK_MOUSE=0',
			`node ${quote(cliPath)} docs`,
		]);
		await waitForScreen(tmux, 'no-mouse', 'Config Basics');
		expect(await mouseReported(tmux, 'no-mouse')).toBe(false);
		await send(tmux, 'no-mouse', 'q');
		await waitForExit(tmux, 'no-mouse');

		// With it on, leaving the screen must hand the terminal back clean.
		await start(tmux, 'left', root, [
			'CI=true',
			`node ${quote(cliPath)} docs; echo TRUNK-HAS-EXITED; sleep 30`,
		]);
		await waitForScreen(tmux, 'left', 'Config Basics');
		expect(await mouseReported(tmux, 'left')).toBe(true);
		await send(tmux, 'left', 'q');
		await waitForScreen(tmux, 'left', 'TRUNK-HAS-EXITED');
		expect(await mouseReported(tmux, 'left')).toBe(false);
	}, 90_000);

	test('plain trunk is the short welcome, and --help lists every option', async () => {
		const tmux = await requireTmux();
		const {cliPath} = await build;
		const root = await scratch(roots);

		await start(tmux, 'welcome', root, [
			'COLORTERM=truecolor',
			`node ${quote(cliPath)}; sleep 30`,
		]);
		const welcome = await waitForScreen(
			tmux,
			'welcome',
			'Add --yes to skip every question.',
		);
		expect(welcome).toContain(
			'--yes · --prefix · --agents · --tmux · --copy · --mc · --direct',
		);
		expect(welcome).not.toContain('tmux session prefix');
		expect(welcome).toContain(
			'❯ trunk clone git@github.com:acme/storefront.git',
		);

		await start(tmux, 'help', root, [
			'COLORTERM=truecolor',
			`node ${quote(cliPath)} --help; sleep 30`,
		]);
		const help = await waitForScreen(tmux, 'help', 'commit on this branch');
		expect(help).toContain('tmux session prefix');
		expect(help).toContain('up to 4 installed agents');
	}, 60_000);

	test('the key bar stays on the last row from the form to the result, at any height', async () => {
		const tmux = await requireTmux();
		const {cliPath} = await build;
		const root = await scratch(roots);

		for (const rows of [30, 44]) {
			const session = `pinned-${rows}`;
			// eslint-disable-next-line no-await-in-loop
			const home = await scratch(roots);
			// eslint-disable-next-line no-await-in-loop
			const project = await bareProject(home);
			// eslint-disable-next-line no-await-in-loop
			await start(
				tmux,
				session,
				root,
				[
					'CI=true',
					`WORKTRUNK_CONFIG_PATH=${quote(
						join(root, `worktrunk-${rows}.toml`),
					)}`,
					`node ${quote(cliPath)} init ${quote(project)}`,
				],
				104,
				rows,
			);

			// One row is left free: a frame as tall as the terminal is cleared by Ink.
			// The pane can be shorter than asked when a tmux status line is showing.
			// eslint-disable-next-line no-await-in-loop
			const height = await paneHeight(tmux, session);
			const lastRow = height - 1;
			// eslint-disable-next-line no-await-in-loop
			const form = await waitForScreen(
				tmux,
				session,
				'Configure worktree automation',
			);
			expect(keyBarRow(form, 'next'), `form at ${rows}`).toBe(lastRow);

			let review = '';
			for (let attempt = 0; attempt < 12 && review === ''; attempt += 1) {
				// eslint-disable-next-line no-await-in-loop
				const screen = await screenOf(tmux, session);
				if (screen.includes('Ready to set up')) {
					review = screen;
				} else {
					// eslint-disable-next-line no-await-in-loop
					await send(tmux, session, 'Enter');
					// eslint-disable-next-line no-await-in-loop
					await delay(150);
				}
			}

			expect(keyBarRow(review, 'edit choices'), `review at ${rows}`).toBe(
				lastRow,
			);
			// eslint-disable-next-line no-await-in-loop
			await send(tmux, session, 'Enter');
			// eslint-disable-next-line no-await-in-loop
			const result = await waitForScreen(tmux, session, 'confirm');
			expect(keyBarRow(result, 'confirm'), `result at ${rows}`).toBe(lastRow);
			// eslint-disable-next-line no-await-in-loop
			await send(tmux, session, 'Enter');
			// eslint-disable-next-line no-await-in-loop
			await waitForExit(tmux, session);
		}
	}, 180_000);

	test('at 80 by 24 the push question is still on the screen', async () => {
		const tmux = await requireTmux();
		const {cliPath} = await build;
		const root = await scratch(roots);
		const project = await bareProject(root);

		await start(
			tmux,
			'short',
			root,
			[
				'CI=true',
				`WORKTRUNK_CONFIG_PATH=${quote(join(root, 'worktrunk.toml'))}`,
				`node ${quote(cliPath)} init ${quote(project)}`,
			],
			80,
			24,
		);
		await waitForScreen(tmux, 'short', 'Configure worktree automation');
		for (let attempt = 0; attempt < 12; attempt += 1) {
			// eslint-disable-next-line no-await-in-loop
			const screen = await screenOf(tmux, 'short');
			if (screen.includes('Ready to set up')) {
				break;
			}

			// eslint-disable-next-line no-await-in-loop
			await send(tmux, 'short', 'Enter');
			// eslint-disable-next-line no-await-in-loop
			await delay(150);
		}

		await send(tmux, 'short', 'Enter');
		const result = await waitForScreen(tmux, 'short', 'is ready');
		expect(result).toContain('Push');
		expect(result).toContain('and open a pull request?');
		expect(result).toContain('Not now');
		const height = await paneHeight(tmux, 'short');
		expect(keyBarRow(result, 'confirm')).toBe(height - 1);

		await send(tmux, 'short', 'Enter');
		await waitForExit(tmux, 'short');
	}, 90_000);

	test('a failed run offers to roll back, and says what it removed under the steps', async () => {
		const tmux = await requireTmux();
		const {cliPath} = await build;
		const root = await scratch(roots);
		const project = await bareProject(root);
		// A wt that works except for validation, which is what fails.
		const real = await resolveExecutable('wt');
		const binary = join(root, 'bin');
		await mkdir(binary);
		await writeFile(
			join(binary, 'wt'),
			`#!/bin/sh\ncase " $* " in\n  *" config show"*) echo "unknown field pre_start" >&2; exit 1;;\nesac\nexec "${real}" "$@"\n`,
		);
		await chmod(join(binary, 'wt'), 0o755);

		await start(tmux, 'fail', root, [
			'COLORTERM=truecolor',
			`PATH=${quote(`${binary}:${process.env['PATH'] ?? ''}`)}`,
			`WORKTRUNK_CONFIG_PATH=${quote(join(root, 'worktrunk.toml'))}`,
			`node ${quote(cliPath)} init ${quote(project)}; sleep 30`,
		]);
		await waitForScreen(tmux, 'fail', 'Configure worktree automation');
		for (let attempt = 0; attempt < 12; attempt += 1) {
			// eslint-disable-next-line no-await-in-loop
			const screen = await screenOf(tmux, 'fail');
			if (screen.includes('Ready to set up')) {
				break;
			}

			// eslint-disable-next-line no-await-in-loop
			await send(tmux, 'fail', 'Enter');
			// eslint-disable-next-line no-await-in-loop
			await delay(150);
		}

		await send(tmux, 'fail', 'Enter');
		const card = await waitForScreen(tmux, 'fail', 'Roll back');
		expect(card).toContain('Worktrunk rejected the generated config');
		expect(card).toContain('wt config show reported:');
		expect(card).toContain('unknown field pre_start');
		expect(card).toContain('Created by this run');
		expect(card).toContain('Resume later with trunk init');

		// Click Roll back: the button answers at once.
		const button = locate(card, ' Roll back ');
		await sendLiteral(tmux, 'fail', click(button.column + 2, button.row));
		const done = await waitForScreen(
			tmux,
			'fail',
			'Removed the chore/trunk-setup worktree and branch.',
		);
		expect(done).toContain('✗ Validate with Worktrunk');
		expect(done).not.toContain('rolled back /');
		expect(done).not.toContain('created by this run');
		expect(await exists(join(project, 'chore-trunk-setup'))).toBe(false);
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
	rows = 36,
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
		String(rows),
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

async function screenOf(
	tmux: string,
	session: string,
	styled = false,
): Promise<string> {
	const result = await runCommand(tmux, [
		'-L',
		socket,
		'capture-pane',
		'-p',
		...(styled ? ['-e'] : []),
		'-t',
		session,
	]);
	return result.stdout;
}

/** Types text as the terminal would deliver a paste: all bytes at once. */
async function sendLiteral(
	tmux: string,
	session: string,
	text: string,
): Promise<void> {
	await runCommand(tmux, [
		'-L',
		socket,
		'send-keys',
		'-t',
		session,
		'-l',
		text,
	]);
}

/** Whether the program in the pane has asked the terminal to report the mouse. */
async function mouseReported(tmux: string, session: string): Promise<boolean> {
	const result = await runCommand(tmux, [
		'-L',
		socket,
		'display-message',
		'-p',
		'-t',
		session,
		'#{mouse_any_flag}',
	]);
	return result.stdout.trim() === '1';
}

/** The pane's real height, which a tmux status line can make one less than asked for. */
async function paneHeight(tmux: string, session: string): Promise<number> {
	const result = await runCommand(tmux, [
		'-L',
		socket,
		'display-message',
		'-p',
		'-t',
		session,
		'#{pane_height}',
	]);
	return Number(result.stdout.trim());
}

/** Where on screen (1-based) some text is, for aiming a click at it. */
function locate(screen: string, needle: string): {column: number; row: number} {
	const lines = screen.split('\n');
	const row = lines.findIndex(line => line.includes(needle));
	if (row === -1) {
		throw new Error(`"${needle}" is not on the screen:\n${screen}`);
	}

	return {column: lines[row]!.indexOf(needle) + 1, row: row + 1};
}

/** A wheel notch down, as an xterm-compatible terminal reports it. */
const wheelDown = '\u001B[<65;60;10M';

/** A left click as an xterm-compatible terminal reports it. */
const click = (column: number, row: number): string =>
	`\u001B[<0;${column};${row}M`;

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

/** The 1-based row of the line that holds `needle`, for checking where a key bar sits. */
function keyBarRow(screen: string, needle: string): number {
	return locate(screen, needle).row;
}

/** Waits until the screen satisfies a condition, for effects with no text of their own. */
async function waitForChange(
	tmux: string,
	session: string,
	changed: (screen: string) => boolean,
): Promise<string> {
	let latest = '';
	for (let attempt = 0; attempt < 100; attempt += 1) {
		// eslint-disable-next-line no-await-in-loop
		latest = await screenOf(tmux, session);
		if (changed(latest)) {
			return latest;
		}

		// eslint-disable-next-line no-await-in-loop
		await delay(100);
	}

	throw new Error(`The screen never changed. Last screen:\n${latest}`);
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

async function delay(milliseconds: number): Promise<void> {
	await new Promise(resolve => {
		setTimeout(resolve, milliseconds);
	});
}

function quote(value: string): string {
	return `'${value.split("'").join(`'"'"'`)}'`;
}
