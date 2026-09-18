import {isAbsolute, resolve} from 'node:path';
import {runCommand, type CommandResult, type CommandRunner} from './process.js';

export type GitOptions = Readonly<{
	gitPath?: string;
	run?: CommandRunner;
}>;

export class GitCommandError extends Error {
	readonly arguments: readonly string[];
	readonly result: CommandResult;

	constructor(arguments_: readonly string[], result: CommandResult) {
		const detail =
			result.stderr.trim() || result.stdout.trim() || 'unknown error';
		super(`git ${arguments_.join(' ')} failed: ${detail}`);
		this.name = 'GitCommandError';
		this.arguments = arguments_;
		this.result = result;
	}
}

export async function runGit(
	arguments_: readonly string[],
	options: GitOptions = {},
): Promise<CommandResult> {
	return (options.run ?? runCommand)(options.gitPath ?? 'git', arguments_);
}

export async function gitCommonDirectory(
	gitDirectory: string,
	options: GitOptions = {},
): Promise<string | undefined> {
	const result = await runGit(
		['--git-dir', gitDirectory, 'rev-parse', '--git-common-dir'],
		options,
	);
	if (result.code !== 0) {
		return undefined;
	}

	const value = result.stdout.trim();
	if (!value) {
		return undefined;
	}

	return isAbsolute(value) ? value : resolve(gitDirectory, value);
}

export async function isBareRepository(
	gitDirectory: string,
	options: GitOptions = {},
): Promise<boolean | undefined> {
	const result = await runGit(
		['--git-dir', gitDirectory, 'rev-parse', '--is-bare-repository'],
		options,
	);
	if (result.code !== 0) {
		return undefined;
	}

	const value = result.stdout.trim();
	return value === 'true' ? true : value === 'false' ? false : undefined;
}

export async function existingDefaultBranch(
	gitDirectory: string,
	options: GitOptions = {},
): Promise<string | undefined> {
	const symbolic = await runGit(
		['--git-dir', gitDirectory, 'symbolic-ref', '--short', 'HEAD'],
		options,
	);
	if (symbolic.code === 0 && symbolic.stdout.trim()) {
		return symbolic.stdout.trim();
	}

	const configured = await runGit(
		['--git-dir', gitDirectory, 'config', '--get', 'worktrunk.default-branch'],
		options,
	);
	return configured.code === 0 && configured.stdout.trim()
		? configured.stdout.trim()
		: undefined;
}

export function parseRemoteDefaultBranch(output: string): string | undefined {
	for (const line of output.split(/\r?\n/)) {
		const match = /^ref:\s+refs\/heads\/(.+?)\s+HEAD$/.exec(line.trim());
		if (match) {
			return match[1];
		}
	}

	return undefined;
}

export async function remoteDefaultBranch(
	url: string,
	options: GitOptions = {},
): Promise<string> {
	const result = await runGit(['ls-remote', '--symref', url, 'HEAD'], options);
	if (result.code !== 0) {
		throw new GitCommandError(['ls-remote', '--symref', url, 'HEAD'], result);
	}

	const branch = parseRemoteDefaultBranch(result.stdout);
	if (!branch) {
		throw new Error(`Remote HEAD did not name a branch: ${url}`);
	}

	return branch;
}

export function createRemoteDefaultBranchResolver(
	options: GitOptions = {},
): (url: string) => Promise<string> {
	const cache = new Map<string, Promise<string>>();
	return async url => {
		const cached = cache.get(url);
		if (cached) {
			return cached;
		}

		const pending = remoteDefaultBranch(url, options);
		cache.set(url, pending);
		try {
			return await pending;
		} catch (error: unknown) {
			cache.delete(url);
			throw error;
		}
	};
}
