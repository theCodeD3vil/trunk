import {readFile} from 'node:fs/promises';
import {sep} from 'node:path';
import {afterAll, afterEach, describe, expect, test} from 'bun:test';
import {parseArguments} from '../source/core/arguments.js';
import {compose} from '../source/core/generate/index.js';
import {guardPlatform} from '../source/core/platform.js';
import {exitCodes} from '../source/core/result.js';
import {trunkVersion} from '../source/core/version.js';
import {buildCli, runCli, type CliRun} from './helpers/run.js';
import {testSettings} from './helpers/settings.js';

describe('CLI', () => {
	const build = buildCli();
	const runs: CliRun[] = [];

	afterAll(async () => {
		const cliBuild = await build;
		await cliBuild.cleanup();
	});

	afterEach(async () => {
		await Promise.all(runs.splice(0).map(async run => run.cleanup()));
	});

	test('shows usage without a command', async () => {
		const run = await runBuiltCli();
		runs.push(run);

		expect(run.exitCode).toBe(exitCodes.success);
		expect(run.stdout).toContain('Usage');
		expect(run.stdout).toContain('$ trunk-cli clone <url> [dir]');
		expect(run.stderr).toBe('');
	});

	test('shows usage for --help', async () => {
		const run = await runBuiltCli(['--help']);
		runs.push(run);

		expect(run.exitCode).toBe(exitCodes.success);
		expect(run.stdout).toContain('$ trunk-cli docs');
		expect(run.stderr).toBe('');
	});

	test('lists only clone, init and docs, with no stack or project-creation flags', async () => {
		const run = await runBuiltCli(['--help']);
		runs.push(run);

		const commands = [...run.stdout.matchAll(/^\s*\$ trunk-cli (\w+)/gm)].map(
			match => match[1],
		);
		expect(commands).toEqual(['clone', 'init', 'docs']);
		for (const removed of [
			'trunk-cli new',
			'--pm',
			'--server',
			'--caddy',
			'--remote',
			'--owner',
			'--public',
			'package manager',
			'Caddy',
		]) {
			expect(run.stdout).not.toContain(removed);
		}
	});

	test('rejects the removed command and flags', async () => {
		const removedCommand = await runBuiltCli(['new', 'demo']);
		runs.push(removedCommand);
		expect(removedCommand.exitCode).toBe(exitCodes.badUsage);
		expect(removedCommand.stderr).toContain('unknown command: new');

		for (const flag of [
			'--pm=npm',
			'--server',
			'--no-caddy',
			'--remote',
			'--owner=me',
			'--public',
		]) {
			// eslint-disable-next-line no-await-in-loop
			const run = await runBuiltCli(['clone', 'url', flag]);
			runs.push(run);
			expect(run.exitCode, flag).not.toBe(exitCodes.success);
			expect(run.stdout, flag).toBe('');
		}
	});

	test('trunk-cli docs without a terminal exits 2 with guidance and no stack trace', async () => {
		// The built CLI runs with stdin ignored, which is the shape that would
		// otherwise reach Ink's raw mode and print a React component stack.
		const run = await runBuiltCli(['docs']);
		runs.push(run);

		expect(run.exitCode).toBe(exitCodes.badUsage);
		expect(run.stdout).toBe('');
		expect(run.stderr).toContain('needs a terminal that can read keys');
		expect(run.stderr).toContain('https://worktrunk.dev');
		expect(run.stderr).not.toContain('Raw mode is not supported');
		expect(run.stderr).not.toContain('component:');
		expect(run.stderr).not.toContain('    at ');
	});

	test('trunk-cli docs takes no arguments', async () => {
		const run = await runBuiltCli(['docs', 'node']);
		runs.push(run);

		expect(run.exitCode).toBe(exitCodes.badUsage);
		expect(run.stderr).toContain('unexpected argument: node');
	});

	test('rejects an unknown command', async () => {
		const run = await runBuiltCli(['bogus']);
		runs.push(run);

		expect(run.exitCode).toBe(exitCodes.badUsage);
		expect(run.stdout).toBe('');
		expect(run.stderr).toContain('unknown command: bogus');
		expect(run.stderr).not.toContain('\u001B[');
	});

	test('rejects a remote that names no repository', async () => {
		const run = await runBuiltCli([
			'clone',
			'https://example.com/repository.git',
		]);
		runs.push(run);

		expect(run.exitCode).toBe(exitCodes.badUsage);
		expect(run.stderr).toContain('must contain an owner and repository');
		expect(run.stderr).not.toContain('    at ');
	});

	test('asks for a URL before doing anything', async () => {
		const run = await runBuiltCli(['clone']);
		runs.push(run);

		expect(run.exitCode).toBe(exitCodes.badUsage);
		expect(run.stderr).toContain('needs a remote URL');
	});

	test('exits 3 with the install hint when required tools are missing', async () => {
		const {cliPath} = await build;
		const run = await runCli(
			cliPath,
			['clone', 'https://example.com/repository.git'],
			{environment: Object.fromEntries([['PATH', '']])},
		);
		runs.push(run);

		expect(run.exitCode).toBe(exitCodes.unsupportedEnvironment);
		expect(run.stderr).toContain('Missing required tools: git, wt');
		expect(run.stderr).toContain('https://worktrunk.dev');
	});

	test('keeps boolean flags tri-state', () => {
		expect(parseArguments(['clone', 'url']).flags.tmux).toBeUndefined();
		expect(parseArguments(['clone', 'url', '--no-tmux']).flags.tmux).toBe(
			false,
		);
		expect(parseArguments(['clone', 'url', '--copy']).flags.copyIgnored).toBe(
			true,
		);
		expect(parseArguments(['clone', 'url', '--no-mc']).flags.mc).toBe(false);
	});

	test('rejects native Windows', () => {
		expect(guardPlatform('win32')).toEqual({
			code: exitCodes.unsupportedEnvironment,
			message: 'trunk supports macOS and Linux (including WSL).',
		});
		expect(guardPlatform('linux')).toBeUndefined();
	});

	test('isolates Worktrunk configuration in the temporary directory', async () => {
		const run = await runBuiltCli(['bogus']);
		runs.push(run);

		expect(run.environment['WORKTRUNK_CONFIG_PATH']).toBe(run.configPath);
		expect(run.configPath.startsWith(`${run.temporaryDirectory}${sep}`)).toBe(
			true,
		);
	});

	async function runBuiltCli(arguments_: readonly string[] = []) {
		const {cliPath} = await build;
		return runCli(cliPath, arguments_);
	}
});
