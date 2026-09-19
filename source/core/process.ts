/**
 * The one way trunk runs another program. Everything goes through `spawn`
 * without a shell, so an argument containing a space or a quote can never be
 * reinterpreted as shell syntax.
 */
import {spawn} from 'node:child_process';

export type CommandResult = Readonly<{
	code: number | undefined;
	stdout: string;
	stderr: string;
	/** True when the command was stopped through its `signal` rather than finishing. */
	aborted?: boolean;
}>;

export type CommandOptions = Readonly<{
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	/** Stops the command when aborted; the result then has `aborted` set. */
	signal?: AbortSignal;
}>;

/**
 * Runs a command with trunk's own terminal, so the child can ask the user its
 * own questions and stream its own progress. Nothing is captured, so callers
 * get the exit code only.
 */
export type AttachedRunner = (
	command: string,
	arguments_: readonly string[],
	options?: CommandOptions,
) => Promise<number>;

export const runAttached: AttachedRunner = async (
	command,
	arguments_,
	options = {},
) =>
	new Promise((resolve, reject) => {
		const child = spawn(command, arguments_, {
			cwd: options.cwd,
			env: options.env,
			stdio: 'inherit',
		});
		child.once('error', reject);
		child.once('close', code => {
			resolve(code ?? 1);
		});
	});

/**
 * The shape callers accept, so a test can pass a stub in place of
 * {@link runCommand} and never touch the real machine.
 */
export type CommandRunner = (
	command: string,
	arguments_: readonly string[],
	options?: CommandOptions,
) => Promise<CommandResult>;

/**
 * Runs a command to completion and collects its output. A non-zero exit is a
 * normal result, not a rejection; only a process that could not be started at
 * all rejects.
 */
export const runCommand: CommandRunner = async (
	command,
	arguments_,
	options = {},
) =>
	new Promise((resolve, reject) => {
		const child = spawn(command, arguments_, {
			cwd: options.cwd,
			env: options.env,
			stdio: ['ignore', 'pipe', 'pipe'],
			signal: options.signal,
		});
		let stdout = '';
		let stderr = '';

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk: string) => {
			stderr += chunk;
		});
		child.once('error', error => {
			// Aborting is a normal way for a command to end, not a failure to start.
			if (error.name === 'AbortError') {
				resolve(
					Object.freeze({code: undefined, stdout, stderr, aborted: true}),
				);
			} else {
				reject(error);
			}
		});
		child.once('close', code => {
			resolve(Object.freeze({code: code ?? undefined, stdout, stderr}));
		});
	});
