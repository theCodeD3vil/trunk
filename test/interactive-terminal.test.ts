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
	symlink,
	writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {afterAll, describe, expect, test} from 'bun:test';
import {agentCommands, type AgentId} from '../source/core/agents.js';
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
		test(`trunk-cli docs shows its menu with ${name} (${variable})`, async () => {
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
			'❯ trunk-cli clone git@github.com:acme/storefront.git',
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
		expect(card).toContain('Resume later with trunk-cli init');

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

	test('the agents list shows every agent, picks with Space, refuses a fifth, and explains a missing one', async () => {
		const tmux = await requireTmux();
		const {cliPath} = await build;
		const root = await scratch(roots);
		const project = await bareProject(root);
		// Five of the six are on this machine, so the sixth must be shown dim.
		const binary = await toolbox(root, {
			agents: ['claude', 'codex', 'opencode', 'copilot', 'antigravity'],
		});

		await start(
			tmux,
			'agents',
			root,
			[
				'COLORTERM=truecolor',
				`PATH=${quote(binary)}`,
				`WORKTRUNK_CONFIG_PATH=${quote(join(root, 'worktrunk.toml'))}`,
				`node ${quote(cliPath)} init ${quote(project)}`,
			],
			104,
			36,
		);
		await waitForScreen(tmux, 'agents', 'Configure worktree automation');
		await send(tmux, 'agents', 'Enter');
		await send(tmux, 'agents', 'Enter');
		const open = await waitForScreen(tmux, 'agents', 'Pick up to 4.');

		// All six are on screen at once, one per row, and none is cut off.
		for (const name of [
			'claude',
			'codex',
			'opencode',
			'copilot',
			'antigravity',
			'pi',
		]) {
			expect(open, name).toMatch(new RegExp(`[◼◻–] +${name}\\b`));
		}

		expect(open).toMatch(/– +pi +not installed/);
		expect(open).toContain('0 of 4 selected');
		expect(open).toMatch(/↑↓ +move +Space +toggle +⏎ +next/);

		// The row under the cursor is tinted, in the palette's own colour.
		const styled = await screenOf(tmux, 'agents', true);
		expect(styled).toContain('48;2;27;37;33');

		// Space picks it, and the box fills.
		await send(tmux, 'agents', 'Space');
		const picked = await waitForScreen(tmux, 'agents', '1 of 4 selected');
		expect(picked).toMatch(/◼ +claude/);
		expect(picked).toMatch(/├─ Agents {2}claude/);

		// Pick three more, then a fifth is refused with the reason.
		for (const _ of [1, 2, 3]) {
			// eslint-disable-next-line no-await-in-loop
			await send(tmux, 'agents', 'Down');
			// eslint-disable-next-line no-await-in-loop
			await send(tmux, 'agents', 'Space');
			// eslint-disable-next-line no-await-in-loop
			await delay(80);
		}

		await waitForScreen(tmux, 'agents', '4 of 4 selected');
		await send(tmux, 'agents', 'Down');
		await send(tmux, 'agents', 'Space');
		const refused = await waitForScreen(
			tmux,
			'agents',
			'4 is the most. Turn one off first.',
		);
		expect(refused).toMatch(/◻ +antigravity +limit reached/);

		// Clicking the agent that is not installed says so, and picks nothing.
		const missing = locate(refused, 'pi ');
		await sendLiteral(tmux, 'agents', click(missing.column, missing.row));
		const explained = await waitForScreen(
			tmux,
			'agents',
			'pi is not installed on this machine.',
		);
		expect(explained).toContain('4 of 4 selected'.slice(0, 1));

		await send(tmux, 'agents', 'C-c');
		await waitForExit(tmux, 'agents');
	}, 90_000);

	test('the agents list becomes a window on a short terminal, and Down follows it', async () => {
		const tmux = await requireTmux();
		const {cliPath} = await build;
		const root = await scratch(roots);
		const project = await bareProject(root);
		const binary = await toolbox(root, {
			agents: ['claude', 'codex', 'opencode', 'copilot', 'antigravity', 'pi'],
		});

		await start(
			tmux,
			'window',
			root,
			[
				`PATH=${quote(binary)}`,
				`WORKTRUNK_CONFIG_PATH=${quote(join(root, 'worktrunk.toml'))}`,
				`node ${quote(cliPath)} init ${quote(project)}`,
			],
			80,
			24,
		);
		await waitForScreen(tmux, 'window', 'Configure worktree automation');
		await send(tmux, 'window', 'Enter');
		await send(tmux, 'window', 'Enter');
		const top = await waitForScreen(tmux, 'window', 'Pick up to 4.');

		expect(top).toMatch(/claude/);
		expect(top).toMatch(/▾ \d more/);
		const height = await paneHeight(tmux, 'window');
		expect(keyBarRow(top, 'move')).toBe(height - 1);

		for (const _ of [1, 2, 3, 4, 5]) {
			// eslint-disable-next-line no-await-in-loop
			await send(tmux, 'window', 'Down');
			// eslint-disable-next-line no-await-in-loop
			await delay(80);
		}

		const bottom = await waitForScreen(tmux, 'window', '▴');
		expect(bottom).toMatch(/▸ +[◼◻] +pi/);
		expect(keyBarRow(bottom, 'move')).toBe(height - 1);

		await send(tmux, 'window', 'C-c');
		await waitForExit(tmux, 'window');
	}, 90_000);

	/** Everything a push test needs: a GitHub-looking origin that is really a folder, and stand-in tools. */
	async function publishing(
		roots_: string[],
		options: {push?: string; gh?: string},
	) {
		const root = await scratch(roots_);
		const project = await bareProject(root);
		const source = join(root, 'source');
		// The project's origin says GitHub; git is told where that really is.
		await runCommand('git', [
			'-C',
			join(project, '.git'),
			'remote',
			'set-url',
			'origin',
			'git@github.com:acme/storefront.git',
		]);
		const binary = await toolbox(root, {
			agents: [],
			push: options.push,
			// A pull request needs gh, so unless a test says otherwise there is one.
			gh: options.gh ?? 'echo "https://github.com/acme/storefront/pull/1"',
		});
		const assignments = [
			`PATH=${quote(binary)}`,
			'GIT_CONFIG_COUNT=1',
			`GIT_CONFIG_KEY_0=${quote(`url.file://${source}.insteadOf`)}`,
			'GIT_CONFIG_VALUE_0=git@github.com:acme/storefront.git',
			`WORKTRUNK_CONFIG_PATH=${quote(join(root, 'worktrunk.toml'))}`,
		];
		return {root, project, source, assignments};
	}

	const toReview = async (tmux: string, session: string) => {
		await waitForScreen(tmux, session, 'Configure worktree automation');
		for (let attempt = 0; attempt < 12; attempt += 1) {
			// eslint-disable-next-line no-await-in-loop
			const screen = await screenOf(tmux, session);
			if (screen.includes('Ready to set up')) {
				return;
			}

			// eslint-disable-next-line no-await-in-loop
			await send(tmux, session, 'Enter');
			// eslint-disable-next-line no-await-in-loop
			await delay(150);
		}
	};

	/** From the review to the push question, then answer Push. */
	const pushIt = async (tmux: string, session: string) => {
		await toReview(tmux, session);
		await send(tmux, session, 'Enter');
		await waitForScreen(tmux, session, 'Not now');
		await send(tmux, session, 'Left');
		await delay(150);
		await send(tmux, session, 'Enter');
	};

	test('pushing shows two steps that turn, then both ticked and the way to see the pull request', async () => {
		const tmux = await requireTmux();
		const {cliPath} = await build;
		const {root, project, source, assignments} = await publishing(roots, {
			// Slow enough to be caught mid-way.
			push: 'exec_real_after_sleep 3',
			gh: 'echo "https://github.com/acme/storefront/pull/12"',
		});

		await start(tmux, 'push', root, [
			'COLORTERM=truecolor',
			...assignments,
			`node ${quote(cliPath)} init ${quote(
				project,
			)}; echo TRUNK-HAS-EXITED; sleep 30`,
		]);
		await pushIt(tmux, 'push');

		// The question is gone, replaced by two steps: the first turning, the second waiting.
		const running = await waitForScreen(
			tmux,
			'push',
			'Publishing chore/trunk-setup',
		);
		expect(running).toMatch(
			/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Push to origin +chore\/trunk-setup → github\.com:acme\/storefront/,
		);
		expect(running).toMatch(/○ Open pull request +gh pr create --fill/);
		expect(running).not.toContain('open a pull request?');
		expect(running).toMatch(/Ctrl\+C +cancel/);

		const done = await waitForScreen(
			tmux,
			'push',
			'Published chore/trunk-setup',
		);
		await waitForScreen(tmux, 'push', 'TRUNK-HAS-EXITED');
		expect(done).toMatch(/✓ Push to origin/);
		expect(done).toMatch(
			/✓ Open pull request +#12 +github\.com\/acme\/storefront\/pull\/12/,
		);
		expect(done).toContain('Open it with  gh pr view --web');

		// It really pushed: the branch is on the origin the folder stands for.
		const branches = await runCommand('git', [
			'-C',
			source,
			'branch',
			'--list',
			'chore/trunk-setup',
		]);
		expect(branches.stdout).toContain('chore/trunk-setup');
	}, 120_000);

	test('a slow push says it is still waiting after ten seconds', async () => {
		const tmux = await requireTmux();
		const {cliPath} = await build;
		const {root, project, assignments} = await publishing(roots, {
			push: 'exec_real_after_sleep 13',
			gh: 'echo "https://github.com/acme/storefront/pull/2"',
		});

		await start(tmux, 'slow', root, [
			...assignments,
			`node ${quote(cliPath)} init ${quote(
				project,
			)}; echo TRUNK-HAS-EXITED; sleep 30`,
		]);
		await pushIt(tmux, 'slow');

		const waiting = await waitForScreen(
			tmux,
			'slow',
			'Still waiting for github.com',
		);
		expect(waiting).toMatch(
			/Still waiting for github\.com \(1\ds\)\. Ctrl\+C stops waiting\./,
		);
		await waitForScreen(tmux, 'slow', 'Published chore/trunk-setup', 300);
	}, 120_000);

	test('Ctrl+C during a push stops it, says how to finish, and pushes nothing', async () => {
		const tmux = await requireTmux();
		const {cliPath} = await build;
		const {root, project, source, assignments} = await publishing(roots, {
			push: 'exec /bin/sleep 60',
		});

		await start(tmux, 'stop', root, [
			...assignments,
			`node ${quote(cliPath)} init ${quote(
				project,
			)}; echo TRUNK-HAS-EXITED; sleep 30`,
		]);
		await pushIt(tmux, 'stop');
		await waitForScreen(tmux, 'stop', 'Publishing chore/trunk-setup');
		await delay(500);
		await send(tmux, 'stop', 'C-c');

		const stopped = await waitForScreen(tmux, 'stop', 'Stopped waiting.');
		await waitForScreen(tmux, 'stop', 'TRUNK-HAS-EXITED');
		expect(stopped).toContain('Publishing chore/trunk-setup stopped');
		expect(stopped).toMatch(/— Push to origin +cancelled/);
		expect(stopped).toMatch(/— Open pull request +skipped/);
		expect(stopped).toContain('git status -sb');
		expect(stopped).toContain('git push -u origin chore/trunk-setup');
		const branches = await runCommand('git', [
			'-C',
			source,
			'branch',
			'--list',
			'chore/trunk-setup',
		]);
		expect(branches.stdout.trim()).toBe('');
	}, 120_000);

	test('a failed push is a card with the reason, and clicking Retry pushes again', async () => {
		const tmux = await requireTmux();
		const {cliPath} = await build;
		const root0 = await scratch(roots);
		const marker = join(root0, 'failed-once');
		const {root, project, source, assignments} = await publishing(roots, {
			push: `if [ ! -f "${marker}" ]; then /usr/bin/touch "${marker}"; echo "To github.com:acme/storefront.git" >&2; echo " ! [remote rejected] chore/trunk-setup -> chore/trunk-setup (permission denied)" >&2; echo "error: failed to push some refs to 'github.com:acme/storefront.git'" >&2; exit 1; fi`,
			gh: 'echo "https://github.com/acme/storefront/pull/5"',
		});

		await start(tmux, 'retry', root, [
			'COLORTERM=truecolor',
			...assignments,
			`node ${quote(cliPath)} init ${quote(
				project,
			)}; echo TRUNK-HAS-EXITED; sleep 30`,
		]);
		await pushIt(tmux, 'retry');

		const card = await waitForScreen(
			tmux,
			'retry',
			'Try again, or leave it local?',
		);
		expect(card).toContain('Publishing chore/trunk-setup stopped');
		expect(card).toMatch(/✗ Push to origin +did not go through/);
		expect(card).toContain('✗ Push failed');
		expect(card).toContain('remote rejected');
		expect(card).not.toContain('failed to push some refs');
		expect(card).toContain(
			'Fix   Check that you can write to acme/storefront, then try again.',
		);
		expect(card).toContain('Then  git push -u origin chore/trunk-setup');
		expect(card).toMatch(/Retry +Not now +Nothing was changed on origin\./);
		// No raw output leaked past the frame: every line stays inside its columns.
		for (const line of card.split('\n')) {
			expect([...line].length).toBeLessThanOrEqual(104);
		}

		const retry = locate(card, ' Retry ');
		await sendLiteral(tmux, 'retry', click(retry.column + 2, retry.row));
		const done = await waitForScreen(
			tmux,
			'retry',
			'Published chore/trunk-setup',
		);
		expect(done).toMatch(/✓ Push to origin/);
		const branches = await runCommand('git', [
			'-C',
			source,
			'branch',
			'--list',
			'chore/trunk-setup',
		]);
		expect(branches.stdout).toContain('chore/trunk-setup');
	}, 120_000);

	test('leaving it local after a failed push ends with the command for later', async () => {
		const tmux = await requireTmux();
		const {cliPath} = await build;
		const {root, project, source, assignments} = await publishing(roots, {
			push: 'echo "fatal: unable to access the remote" >&2; exit 1',
		});

		await start(tmux, 'later', root, [
			...assignments,
			`node ${quote(cliPath)} init ${quote(
				project,
			)}; echo TRUNK-HAS-EXITED; sleep 30`,
		]);
		await pushIt(tmux, 'later');
		await waitForScreen(tmux, 'later', 'Try again, or leave it local?');
		await send(tmux, 'later', 'Right');
		await delay(150);
		await send(tmux, 'later', 'Enter');

		const kept = await waitForScreen(tmux, 'later', 'Kept it local.');
		await waitForScreen(tmux, 'later', 'TRUNK-HAS-EXITED');
		expect(kept).toContain(
			'When you are ready: git push -u origin chore/trunk-setup',
		);
		expect(kept).not.toContain('Try again');
		const branches = await runCommand('git', [
			'-C',
			source,
			'branch',
			'--list',
			'chore/trunk-setup',
		]);
		expect(branches.stdout.trim()).toBe('');
	}, 120_000);

	test('when only the pull request fails, the push stays ticked and the card offers the link', async () => {
		const tmux = await requireTmux();
		const {cliPath} = await build;
		const {root, project, assignments} = await publishing(roots, {
			gh: 'echo "To get started with GitHub CLI, please run:  gh auth login" >&2; exit 1',
		});

		await start(tmux, 'pr', root, [
			...assignments,
			`node ${quote(cliPath)} init ${quote(project)}`,
		]);
		await pushIt(tmux, 'pr');

		const card = await waitForScreen(tmux, 'pr', 'Try opening it again?');
		expect(card).toContain('Pushed chore/trunk-setup');
		expect(card).toMatch(/✓ Push to origin/);
		expect(card).toMatch(/▲ Open pull request +no pull request/);
		expect(card).toContain('▲ Pushed, but no pull request');
		expect(card).toContain('Then  gh auth login');
		expect(card).toContain(
			'https://github.com/acme/storefront/compare/chore%2Ftrunk-setup?expand=1',
		);
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

/** A bare-layout project with a main worktree, ready for `trunk-cli init`. */
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

/**
 * A folder to use as the whole PATH: git and wt as they are, stand-ins for the
 * agents named here, and optionally a git that misbehaves on `push` and a gh
 * that answers as told. Nothing else on this machine can leak into the test.
 */
async function toolbox(
	root: string,
	options: {agents: readonly AgentId[]; push?: string; gh?: string},
): Promise<string> {
	const binary = join(root, 'toolbox');
	await mkdir(binary);
	const [node, git, wt] = await Promise.all([
		resolveExecutable('node'),
		resolveExecutable('git'),
		resolveExecutable('wt'),
	]);
	const link = async (name: string, target: string | undefined) => {
		if (target !== undefined) {
			await symlink(target, join(binary, name));
		}
	};

	await link('node', node);
	await link('wt', wt);
	if (options.push === undefined) {
		await link('git', git);
	} else {
		// `exec_real_after_sleep N` waits, then pushes for real.
		const body = options.push.replace(
			/^exec_real_after_sleep (\d+)$/,
			'/bin/sleep $1',
		);
		await writeFile(
			join(binary, 'git'),
			`#!/bin/sh\ncase " $* " in\n  *" push "*)\n    ${body}\n    ;;\nesac\nexec "${git}" "$@"\n`,
		);
		await chmod(join(binary, 'git'), 0o755);
	}

	if (options.gh !== undefined) {
		await writeFile(
			join(binary, 'gh'),
			`#!/bin/sh\ncase "$1 $2" in\n  "pr create") ${options.gh};;\nesac\n`,
		);
		await chmod(join(binary, 'gh'), 0o755);
	}

	for (const agent of options.agents) {
		// An agent is found by its command, which is not always its name.
		// eslint-disable-next-line no-await-in-loop
		await writeFile(join(binary, agentCommands[agent]), '#!/bin/sh\nexit 0\n');
		// eslint-disable-next-line no-await-in-loop
		await chmod(join(binary, agentCommands[agent]), 0o755);
	}

	return binary;
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
	attempts = 100,
): Promise<string> {
	let latest = '';
	for (let attempt = 0; attempt < attempts; attempt += 1) {
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
