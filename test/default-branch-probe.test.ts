/**
 * The review screen names a clone's default branch before anything is cloned,
 * by asking the remote while the questions are answered. The question must
 * never disturb the screen it is filling in, so it is checked here for what it
 * refuses to do: prompt, hang, or throw.
 */
import {describe, expect, test} from 'bun:test';
import {probeDefaultBranch} from '../source/core/git.js';
import type {CommandRunner} from '../source/core/process.js';

/** An environment from name/value pairs, so the names can stay upper case. */
const env = (...pairs: Array<[string, string]>): NodeJS.ProcessEnv =>
	Object.fromEntries(pairs);

const symref = 'ref: refs/heads/trunk\tHEAD\nabc123\tHEAD\n';

describe('probeDefaultBranch', () => {
	test('reads the branch the remote HEAD points at', async () => {
		const run: CommandRunner = async () => ({
			code: 0,
			stdout: symref,
			stderr: '',
		});

		expect(await probeDefaultBranch('git@example.com:a/b.git', {run})).toBe(
			'trunk',
		);
	});

	test('asks for HEAD only, with the URL it was given', async () => {
		const seen: string[][] = [];
		const run: CommandRunner = async (_command, arguments_) => {
			seen.push([...arguments_]);
			return {code: 0, stdout: symref, stderr: ''};
		};

		await probeDefaultBranch('https://example.com/a/b.git', {run});

		expect(seen).toEqual([
			['ls-remote', '--symref', 'https://example.com/a/b.git', 'HEAD'],
		]);
	});

	test('never lets git or ssh prompt on the terminal the UI owns', async () => {
		let environment: NodeJS.ProcessEnv = {};
		const run: CommandRunner = async (_command, _arguments, options) => {
			environment = options?.env ?? {};
			return {code: 0, stdout: symref, stderr: ''};
		};

		await probeDefaultBranch('x', {run, env: env(['PATH', '/bin'])});

		expect(environment['GIT_TERMINAL_PROMPT']).toBe('0');
		expect(environment['GIT_SSH_COMMAND']).toBe('ssh -o BatchMode=yes');
		// Everything else the user has is passed along, so their ssh keys still work.
		expect(environment['PATH']).toBe('/bin');
	});

	test('leaves an ssh command the user chose alone', async () => {
		let environment: NodeJS.ProcessEnv = {};
		const run: CommandRunner = async (_command, _arguments, options) => {
			environment = options?.env ?? {};
			return {code: 0, stdout: symref, stderr: ''};
		};

		await probeDefaultBranch('x', {
			run,
			env: env(['GIT_SSH_COMMAND', 'ssh -i ~/.ssh/work']),
		});

		expect(environment['GIT_SSH_COMMAND']).toBe('ssh -i ~/.ssh/work');
		expect(environment['GIT_TERMINAL_PROMPT']).toBe('0');
	});

	test('a remote that refuses, or names no branch, is simply not known', async () => {
		const refused: CommandRunner = async () => ({
			code: 128,
			stdout: '',
			stderr: 'fatal: could not read from remote repository',
		});
		const silent: CommandRunner = async () => ({
			code: 0,
			stdout: '',
			stderr: '',
		});

		expect(await probeDefaultBranch('x', {run: refused})).toBeUndefined();
		expect(await probeDefaultBranch('x', {run: silent})).toBeUndefined();
	});

	test('a git that cannot start is not an error either', async () => {
		const run: CommandRunner = async () => {
			throw new Error('spawn git ENOENT');
		};

		expect(await probeDefaultBranch('x', {run})).toBeUndefined();
	});

	test('gives up on a remote that does not answer, instead of holding the form', async () => {
		const run: CommandRunner = async () =>
			new Promise(() => {
				// Never settles, like a host that drops packets.
			});
		const started = Date.now();

		const branch = await probeDefaultBranch('x', {run, timeoutMs: 50});

		expect(branch).toBeUndefined();
		expect(Date.now() - started).toBeLessThan(1000);
	});
});
