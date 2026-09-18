import {spawn} from 'node:child_process';

export type CommandResult = Readonly<{
	code: number | undefined;
	stdout: string;
	stderr: string;
}>;

export type CommandOptions = Readonly<{
	cwd?: string;
	env?: NodeJS.ProcessEnv;
}>;

export type CommandRunner = (
	command: string,
	arguments_: readonly string[],
	options?: CommandOptions,
) => Promise<CommandResult>;

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
		child.once('error', reject);
		child.once('close', code => {
			resolve(Object.freeze({code: code ?? undefined, stdout, stderr}));
		});
	});
