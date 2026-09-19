/**
 * The generated tmux hooks, run for real against a tmux server on a private
 * socket. Shell syntax is checked elsewhere; this proves the behaviour: the
 * layout that gets built, the graceful-then-final cleanup order, and that the
 * session kill can never hit a neighbouring session.
 */
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import process from 'node:process';
import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import {resolveExecutable} from '../source/core/env.js';
import {compose} from '../source/core/generate/index.js';
import {runCommand} from '../source/core/process.js';
import {parseGenerated} from './helpers/generated.js';
import {testSettings} from './helpers/settings.js';

const socket = `trunk-hooks-${process.pid}`;
const branch = 'feature-demo';
const session = `web-sp_${branch}`;

type Hooks = Readonly<{start: string; stop: string; kill: string}>;

let root: string;
let worktree: string;
let environment: NodeJS.ProcessEnv;
let tmuxPath: string;

describe('generated tmux hooks on a real tmux server', () => {
	beforeAll(async () => {
		const found = await resolveExecutable('tmux');
		expect(found).toBeDefined();
		tmuxPath = found!;

		root = await mkdtemp(join(tmpdir(), 'trunk-tmux-'));
		worktree = join(root, 'worktree');
		const tools = join(root, 'tools');
		await Promise.all([mkdir(worktree), mkdir(tools)]);

		// The hooks call plain `tmux`; this wrapper pins every call to the private
		// socket so a developer's real sessions are never visible or at risk.
		const wrapper = join(tools, 'tmux');
		await writeFile(wrapper, `#!/bin/sh\nexec ${tmuxPath} -L ${socket} "$@"\n`);
		await chmod(wrapper, 0o755);

		environment = Object.fromEntries([
			['HOME', root],
			['PATH', [tools, process.env['PATH'] ?? ''].join(delimiter)],
			['SHELL', '/bin/sh'],
			['TERM', 'dumb'],
			// An empty editor keeps the Editor window from launching a real one.
			['WT_EDITOR', ''],
		]);
	});

	afterAll(async () => {
		await runCommand(tmuxPath, ['-L', socket, 'kill-server']);
		await rm(root, {recursive: true, force: true});
	});

	test('builds an Editor window and a two-pane Terminal window', async () => {
		const hooks = renderHooks(testSettings({agents: []}));
		await run(hooks.start);

		expect(await windows()).toEqual(['Editor', 'Terminal']);
		const panes = await tmux(['list-panes', '-t', `=${session}:Terminal`]);
		expect(panes.trim().split('\n')).toHaveLength(2);

		await run(hooks.kill);
	}, 30_000);

	test('adds an Agents window only when agents were selected', async () => {
		await run(renderHooks(testSettings({agents: ['claude']})).start);

		expect(await windows()).toEqual(['Editor', 'Agents', 'Terminal']);

		await run(renderHooks(testSettings()).kill);
	}, 30_000);

	test('lets a process shut down on SIGTERM, then removes the session in post-remove', async () => {
		const hooks = renderHooks(testSettings({agents: []}));
		await run(hooks.start);
		const marker = join(root, 'terminated');
		await startWorker('graceful', `trap 'touch "${marker}"; exit 0' TERM`);

		const started = Date.now();
		await run(hooks.stop);
		const elapsed = Date.now() - started;

		// The process ran its own TERM handler, so nothing needed a forced kill,
		// and the pre-remove step did not sit out its whole grace period.
		expect(await exists(marker)).toBe(true);
		expect(elapsed).toBeLessThan(2500);
		// The session outlives pre-remove; only post-remove ends it.
		expect(await hasSession(session)).toBe(true);

		await run(hooks.kill);
		expect(await hasSession(session)).toBe(false);
	}, 30_000);

	test('force-stops a process that ignores SIGTERM', async () => {
		const hooks = renderHooks(testSettings({agents: []}));
		await run(hooks.start);
		const pidFile = join(root, 'stubborn.pid');
		await startWorker('stubborn', `trap '' TERM\necho $$ > "${pidFile}"`);
		const recorded = await readFile(pidFile, 'utf8');
		const pid = Number(recorded.trim());
		expect(isAlive(pid)).toBe(true);

		await run(hooks.stop);

		expect(isAlive(pid)).toBe(false);
		await run(hooks.kill);
	}, 30_000);

	test('kills only the exact session, never one it is a prefix of', async () => {
		const neighbour = `${session}-2`;
		await tmux(['new-session', '-d', '-s', neighbour]);

		await run(renderHooks(testSettings()).kill);

		// Without `=`, tmux would resolve the missing name to this longer one.
		expect(await hasSession(neighbour)).toBe(true);
		await tmux(['kill-session', '-t', `=${neighbour}`]);
	}, 30_000);

	test('a second start keeps the session instead of rebuilding it', async () => {
		const hooks = renderHooks(testSettings({agents: []}));
		await run(hooks.start);
		const before = await sessionId(session);
		expect(await tag(session)).toBe(worktree);

		await run(hooks.start);

		expect(await sessionId(session)).toBe(before);
		await run(hooks.kill);
	}, 30_000);

	describe('when the user renames the session', () => {
		const renamed = 'my-own-name';

		test('finds it again: no duplicate on a second start, then stop and kill reach it', async () => {
			const hooks = renderHooks(testSettings({agents: []}));
			await run(hooks.start);
			await tmux(['rename-session', '-t', `=${session}`, renamed]);

			// Starting again must adopt the renamed session, not build a twin.
			await run(hooks.start);
			expect(await hasSession(session)).toBe(false);
			expect(await sessionNames()).toEqual([renamed]);

			const pidFile = join(root, 'renamed.pid');
			await startWorker(
				'renamed',
				`trap '' TERM\necho $$ > "${pidFile}"`,
				renamed,
			);
			const recorded = await readFile(pidFile, 'utf8');
			const pid = Number(recorded.trim());
			expect(isAlive(pid)).toBe(true);

			await run(hooks.stop);
			expect(isAlive(pid)).toBe(false);
			expect(await hasSession(renamed)).toBe(true);

			await run(hooks.kill);
			expect(await sessionNames()).toEqual([]);
		}, 30_000);

		test('leaves alone a session tagged for another worktree that took this name', async () => {
			const other = join(root, 'other-worktree');
			await mkdir(other);
			await tmux(['new-session', '-d', '-s', session, '-c', other]);
			await tmux(['set-option', '-t', session, '@twt', other]);
			const hooks = renderHooks(testSettings({agents: []}));

			await run(hooks.stop);
			await run(hooks.kill);
			expect(await hasSession(session)).toBe(true);

			// Nor may the start hook replace a live neighbour.
			await run(hooks.start);
			expect(await sessionNames()).toEqual([session]);
			expect(await tag(session)).toBe(other);

			await tmux(['kill-session', '-t', `=${session}`]);
		}, 30_000);
	});

	describe('a session made before sessions were tagged', () => {
		test('is still removed by its generated name', async () => {
			await tmux(['new-session', '-d', '-s', session, '-c', worktree]);

			await run(renderHooks(testSettings()).kill);

			expect(await hasSession(session)).toBe(false);
		}, 30_000);

		test('is adopted by the start hook, so a later rename cannot lose it', async () => {
			await tmux(['new-session', '-d', '-s', session, '-c', worktree]);
			const before = await sessionId(session);
			const hooks = renderHooks(testSettings());

			await run(hooks.start);

			// The same session, now tagged; not a replacement built beside it.
			expect(await sessionId(session)).toBe(before);
			expect(await tag(session)).toBe(worktree);

			await tmux(['rename-session', '-t', session, 'renamed-later']);
			await run(hooks.kill);
			expect(await sessionNames()).toEqual([]);
		}, 30_000);
	});

	test('does nothing when the session is already gone', async () => {
		const hooks = renderHooks(testSettings());

		await run(hooks.stop);
		await run(hooks.kill);
	}, 30_000);
});

/** Pulls the three tmux hook bodies out of a generated file and fills in the templates. */
function renderHooks(settings: ReturnType<typeof testSettings>): Hooks {
	const document = parseGenerated(compose(settings)) as {
		'pre-start': Array<Record<string, string>>;
		'pre-remove': Record<string, string>;
		'post-remove': Record<string, string>;
	};
	const start = document['pre-start'].find(step => step['tmux'])!['tmux']!;
	return {
		start: render(start),
		stop: render(document['pre-remove']['tmux']!),
		kill: render(document['post-remove']['tmux']!),
	};
}

function render(body: string): string {
	return body
		.split('{{ branch | sanitize }}')
		.join(branch)
		.split('{{ worktree_path }}')
		.join(worktree);
}

async function run(body: string): Promise<void> {
	const result = await runCommand('sh', ['-c', body], {env: environment});
	expect(result.code, result.stderr || result.stdout).toBe(0);
}

/**
 * Starts a background script in the Terminal window's first pane and waits until
 * it has begun, so a signal cannot arrive before its trap is installed.
 */
async function startWorker(
	name: string,
	setup: string,
	target = session,
): Promise<void> {
	const script = join(root, `${name}.sh`);
	const started = join(root, `${name}.started`);
	await writeFile(
		script,
		`${setup}\ntouch "${started}"\nwhile :; do sleep 0.2; done\n`,
	);
	await tmux([
		'send-keys',
		'-t',
		`=${target}:Terminal.0`,
		`sh ${script}`,
		'Enter',
	]);
	await waitFor(async () => exists(started));
}

async function tmux(arguments_: readonly string[]): Promise<string> {
	const result = await runCommand(tmuxPath, ['-L', socket, ...arguments_], {
		env: environment,
	});
	return result.stdout;
}

async function windows(): Promise<string[]> {
	const output = await tmux([
		'list-windows',
		'-t',
		`=${session}`,
		'-F',
		'#{window_name}',
	]);
	return output.trim().split('\n');
}

/** The session's id, which unlike its name does not change on a rename. */
async function sessionId(name: string): Promise<string> {
	const output = await tmux([
		'display-message',
		'-p',
		'-t',
		`=${name}:`,
		'#{session_id}',
	]);
	return output.trim();
}

async function tag(name: string): Promise<string> {
	const output = await tmux(['show-options', '-qv', '-t', name, '@twt']);
	return output.trim();
}

async function sessionNames(): Promise<string[]> {
	const result = await runCommand(
		tmuxPath,
		['-L', socket, 'list-sessions', '-F', '#{session_name}'],
		{env: environment},
	);
	// With no server left, tmux exits non-zero and prints nothing on stdout.
	return result.stdout.trim() === '' ? [] : result.stdout.trim().split('\n');
}

async function hasSession(name: string): Promise<boolean> {
	const result = await runCommand(
		tmuxPath,
		['-L', socket, 'has-session', '-t', `=${name}`],
		{env: environment},
	);
	return result.code === 0;
}

async function waitFor(condition: () => Promise<boolean>): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		// Polling is the point: each check has to follow the previous delay.
		// eslint-disable-next-line no-await-in-loop
		if (await condition()) {
			return;
		}

		// eslint-disable-next-line no-await-in-loop
		await new Promise(resolve => {
			setTimeout(resolve, 100);
		});
	}

	throw new Error('Timed out waiting for the worker to start.');
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await readFile(path);
		return true;
	} catch {
		return false;
	}
}
