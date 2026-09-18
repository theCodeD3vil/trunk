/**
 * `trunk docs` from a packed tarball, run in a real terminal. The point is what
 * the published artifact carries: the docs must be inside it, and the browser
 * must start from an unpacked copy with no checkout, no repository files and
 * no network reachable from its environment.
 */
import {mkdir, mkdtemp, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {afterAll, describe, expect, test} from 'bun:test';
import {resolveExecutable} from '../source/core/env.js';
import {runCommand} from '../source/core/process.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const socket = `trunk-docs-package-${process.pid}`;

describe('packaged installation', () => {
	const roots: string[] = [];

	afterAll(async () => {
		const tmux = await resolveExecutable('tmux');
		if (tmux) {
			await runCommand(tmux, ['-L', socket, 'kill-server']);
		}

		await Promise.all(
			roots.map(async root => rm(root, {recursive: true, force: true})),
		);
	});

	test('the tarball carries the docs and trunk docs shows the two-topic menu offline', async () => {
		const [npm, tmux, tar] = await Promise.all([
			resolveExecutable('npm'),
			resolveExecutable('tmux'),
			resolveExecutable('tar'),
		]);
		expect(npm).toBeDefined();
		expect(tmux).toBeDefined();
		expect(tar).toBeDefined();

		const root = await mkdtemp(join(tmpdir(), 'trunk-package-'));
		roots.push(root);

		// `npm pack` runs the real prepack build, so this is what would be published.
		const packed = await runCommand(
			npm!,
			['pack', '--silent', '--pack-destination', root],
			{cwd: projectRoot, env: process.env},
		);
		expect(packed.code, packed.stderr).toBe(0);
		const tarball = join(root, packed.stdout.trim().split('\n').at(-1)!);

		const listing = await runCommand(tar!, ['-tzf', tarball]);
		const files = listing.stdout.split('\n').filter(Boolean);
		for (const file of [
			'package/dist/cli.js',
			'package/dist/commands/docs.js',
			'package/dist/ui/DocsBrowser.js',
			'package/dist/docs/config-basics.js',
			'package/dist/docs/node.js',
			'package/package.json',
		]) {
			expect(files, file).toContain(file);
		}

		// Nothing the browser needs lives outside dist: no docs folder, no source.
		expect(
			files.filter(file => /^package\/(docs|source|test|plans)\//.test(file)),
		).toEqual([]);

		const extracted = await runCommand(tar!, ['-xzf', tarball, '-C', root]);
		expect(extracted.code, extracted.stderr).toBe(0);
		const installed = join(root, 'package');
		await symlink(
			join(projectRoot, 'node_modules'),
			join(installed, 'node_modules'),
			'dir',
		);
		// Run from a directory that has nothing to do with the checkout.
		const elsewhere = join(root, 'elsewhere');
		await mkdir(elsewhere);

		const environment = [
			`PATH=${shellQuote(process.env['PATH'] ?? '')}`,
			`HOME=${shellQuote(root)}`,
			'TERM=tmux-256color',
		].join(' ');
		// `env -i` starts from nothing, so no CI variable can switch Ink's renderer off.
		const started = await runCommand(tmux!, [
			'-L',
			socket,
			'new-session',
			'-d',
			'-x',
			'80',
			'-y',
			'24',
			'-s',
			'docs',
			'-c',
			elsewhere,
			`env -i ${environment} node ${shellQuote(
				join(installed, 'dist', 'cli.js'),
			)} docs`,
		]);
		expect(started.code, started.stderr).toBe(0);

		const menu = await waitForScreen(tmux!, 'Config Basics');
		expect(menu).toContain('Node');
		expect(menu).toContain('trunk docs');

		// Keys go in one at a time, as they do from a keyboard.
		await sendKeys(tmux!, ['Down']);
		await sendKeys(tmux!, ['Enter']);
		const sections = await waitForScreen(
			tmux!,
			'Install dependencies (npm, pnpm, Bun)',
		);
		expect(sections).toContain('Caddy routes (advanced)');

		await sendKeys(tmux!, ['q']);
		await waitForSessionEnd(tmux!);
	}, 240_000);
});

async function sendKeys(tmux: string, keys: readonly string[]): Promise<void> {
	await runCommand(tmux, ['-L', socket, 'send-keys', '-t', 'docs', ...keys]);
}

async function screen(tmux: string): Promise<string> {
	const result = await runCommand(tmux, [
		'-L',
		socket,
		'capture-pane',
		'-p',
		'-t',
		'docs',
	]);
	return result.stdout;
}

async function waitForScreen(tmux: string, text: string): Promise<string> {
	let latest = '';
	for (let attempt = 0; attempt < 100; attempt += 1) {
		// Polling: each check has to follow the previous delay.
		// eslint-disable-next-line no-await-in-loop
		latest = await screen(tmux);
		if (latest.includes(text)) {
			return latest;
		}

		// eslint-disable-next-line no-await-in-loop
		await delay(100);
	}

	throw new Error(`Never saw "${text}" on screen. Last screen:\n${latest}`);
}

async function waitForSessionEnd(tmux: string): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		// eslint-disable-next-line no-await-in-loop
		const result = await runCommand(tmux, [
			'-L',
			socket,
			'has-session',
			'-t',
			'docs',
		]);
		if (result.code !== 0) {
			return;
		}

		// eslint-disable-next-line no-await-in-loop
		await delay(100);
	}

	throw new Error('trunk docs did not exit after q.');
}

async function delay(milliseconds: number): Promise<void> {
	await new Promise(resolve => {
		setTimeout(resolve, milliseconds);
	});
}

function shellQuote(value: string): string {
	return `'${value.split("'").join(`'"'"'`)}'`;
}
