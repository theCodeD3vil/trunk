/**
 * Thin wrappers over the git commands trunk needs to read. Every call passes an
 * explicit `--git-dir` instead of changing directory, so a command can never be
 * answered by whatever repository the process happens to sit in.
 */
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

/**
 * The repository's shared git directory. For a linked worktree this is the main
 * one rather than the worktree's own, which is what identifies the project.
 * Returns undefined when the path is not a repository at all.
 */
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

/**
 * The default branch of a repository that is already on disk. HEAD answers it
 * normally; the git config key wt maintains covers a repository whose HEAD is
 * detached. Never assume `main` — plenty of projects use something else.
 */
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

/** Pulls the branch out of `ls-remote --symref` output: `ref: refs/heads/x HEAD`. */
export function parseRemoteDefaultBranch(output: string): string | undefined {
	for (const line of output.split(/\r?\n/)) {
		const match = /^ref:\s+refs\/heads\/(.+?)\s+HEAD$/.exec(line.trim());
		if (match) {
			return match[1];
		}
	}

	return undefined;
}

/**
 * Asks the remote which branch its HEAD points at. This is the one call that
 * needs network and credentials, so its raw git error is passed through
 * untouched: for an auth failure that message is the actionable part.
 */
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

/**
 * Wraps {@link remoteDefaultBranch} with a per-run cache so one trunk run hits
 * the network once per URL. Failures are evicted so a retry can succeed.
 */
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
