/**
 * Thin wrappers over the git commands trunk needs to read. Every call passes an
 * explicit `--git-dir` instead of changing directory, so a command can never be
 * answered by whatever repository the process happens to sit in.
 */
import {isAbsolute, resolve} from 'node:path';
import process from 'node:process';
import {
	runAttached,
	runCommand,
	type AttachedRunner,
	type CommandResult,
	type CommandRunner,
} from './process.js';

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

/**
 * True when the repository holds no refs at all, which is what a bare repository
 * that has never received a commit looks like. A repository that only has
 * remote-tracking refs still counts as having history.
 */
export async function isEmptyRepository(
	gitDirectory: string,
	options: GitOptions = {},
): Promise<boolean> {
	const result = await runGit(
		[
			'--git-dir',
			gitDirectory,
			'for-each-ref',
			'--count=1',
			'--format=%(refname)',
		],
		options,
	);
	return result.code === 0 && result.stdout.trim() === '';
}

/** The refspec a bare clone leaves out, which `wt step copy-ignored` needs. */
export const originFetchRefspec = '+refs/heads/*:refs/remotes/origin/*';

/**
 * Clones into `<project>/.git`, the layout trunk sets up: a bare repository
 * with the worktrees as siblings rather than inside it.
 */
export async function cloneBare(
	url: string,
	gitDirectory: string,
	options: GitOptions & {attach?: AttachedRunner} = {},
): Promise<number> {
	return (options.attach ?? runAttached)(options.gitPath ?? 'git', [
		'clone',
		'--bare',
		'--progress',
		url,
		gitDirectory,
	]);
}

/**
 * Clones without borrowing the terminal, for the interactive UI, which owns the
 * screen. A failure carries git's own message so the UI can show it.
 */
export async function cloneBareQuietly(
	url: string,
	gitDirectory: string,
	options: GitOptions = {},
): Promise<CommandResult> {
	return runGit(['clone', '--bare', url, gitDirectory], options);
}

/**
 * A bare clone has no fetch refspec, so `origin/*` never appears and anything
 * comparing against the remote silently sees nothing. Set it, then fetch once
 * to populate the refs.
 */
export async function configureOriginFetch(
	gitDirectory: string,
	options: GitOptions = {},
): Promise<CommandResult> {
	const configured = await runGit(
		[
			'--git-dir',
			gitDirectory,
			'config',
			'remote.origin.fetch',
			originFetchRefspec,
		],
		options,
	);
	if (configured.code !== 0) {
		return configured;
	}

	return runGit(
		['--git-dir', gitDirectory, 'fetch', 'origin', '--prune'],
		options,
	);
}

/** Points the bare repository's HEAD at the branch the remote considers default. */
export async function setHeadBranch(
	gitDirectory: string,
	branch: string,
	options: GitOptions = {},
): Promise<CommandResult> {
	return runGit(
		['--git-dir', gitDirectory, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`],
		options,
	);
}

/**
 * Adds a worktree beside the bare repository, the sibling layout trunk sets up.
 * `createBranch` starts a new branch from HEAD instead of checking out one that
 * already exists.
 */
export async function addWorktree(
	gitDirectory: string,
	path: string,
	branch: string,
	options: GitOptions & {createBranch?: boolean} = {},
): Promise<CommandResult> {
	const arguments_ = options.createBranch
		? ['worktree', 'add', '-b', branch, path]
		: ['worktree', 'add', path, branch];
	return runGit(['--git-dir', gitDirectory, ...arguments_], options);
}

export type WorktreeEntry = Readonly<{path: string; branch?: string}>;

/**
 * Every worktree with the branch it holds. Finding a worktree by its branch is
 * the only reliable way to know where wt put one, since wt may place it beside
 * the git directory rather than where trunk proposed.
 */
export async function listWorktreeEntries(
	gitDirectory: string,
	options: GitOptions = {},
): Promise<readonly WorktreeEntry[]> {
	const result = await runGit(
		['--git-dir', gitDirectory, 'worktree', 'list', '--porcelain'],
		options,
	);
	if (result.code !== 0) {
		return Object.freeze([]);
	}

	const entries: WorktreeEntry[] = [];
	let path: string | undefined;
	let branch: string | undefined;
	const flush = () => {
		if (path) {
			entries.push(Object.freeze({path, branch}));
		}

		path = undefined;
		branch = undefined;
	};

	for (const line of result.stdout.split(/\r?\n/)) {
		if (line.startsWith('worktree ')) {
			flush();
			path = line.slice('worktree '.length).trim();
		} else if (line.startsWith('branch refs/heads/')) {
			branch = line.slice('branch refs/heads/'.length).trim();
		}
	}

	flush();
	return Object.freeze(entries);
}

/** Absolute worktree paths, used to check where wt actually put one. */
export async function listWorktrees(
	gitDirectory: string,
	options: GitOptions = {},
): Promise<readonly string[]> {
	const result = await runGit(
		['--git-dir', gitDirectory, 'worktree', 'list', '--porcelain'],
		options,
	);
	if (result.code !== 0) {
		return Object.freeze([]);
	}

	return Object.freeze(
		result.stdout
			.split(/\r?\n/)
			.filter(line => line.startsWith('worktree '))
			.map(line => line.slice('worktree '.length).trim())
			.filter(Boolean),
	);
}

/**
 * Commits one path and nothing else, so an unrelated file the user was already
 * working on is never swept into trunk's commit.
 */
export async function commitPath(
	worktreePath: string,
	path: string,
	message: string,
	options: GitOptions = {},
): Promise<CommandResult> {
	const staged = await runGit(['-C', worktreePath, 'add', '--', path], options);
	if (staged.code !== 0) {
		return staged;
	}

	return runGit(
		['-C', worktreePath, 'commit', '--only', '--message', message, '--', path],
		options,
	);
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
 * Asks the remote for its default branch without ever getting in the way: no
 * credential or host-key prompt (the terminal belongs to the UI), a short
 * time limit, and no error, only `undefined`, for a remote that will not say.
 * It only fills in a label on the review screen; the clone itself still decides.
 */
/**
 * The environment for a command that must never wait for the user: git and ssh
 * would otherwise ask for a password, a passphrase or a host-key decision on
 * the terminal, where nobody is looking while the UI owns the screen. Without
 * a prompt the command fails in a moment with a message that can be shown.
 */
export function withoutPrompts(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {...base};
	env['GIT_TERMINAL_PROMPT'] = '0';
	env['GH_PROMPT_DISABLED'] = '1';
	// Someone who set their own ssh command meant it; otherwise never prompt.
	if (base['GIT_SSH_COMMAND'] === undefined && base['GIT_SSH'] === undefined) {
		env['GIT_SSH_COMMAND'] = 'ssh -o BatchMode=yes';
	}

	return env;
}

export async function probeDefaultBranch(
	url: string,
	options: GitOptions & {
		env?: NodeJS.ProcessEnv;
		timeoutMs?: number;
	} = {},
): Promise<string | undefined> {
	const env = withoutPrompts(options.env ?? process.env);

	const asked = (async () => {
		try {
			const result = await (options.run ?? runCommand)(
				options.gitPath ?? 'git',
				['ls-remote', '--symref', url, 'HEAD'],
				{env},
			);
			return result.code === 0
				? parseRemoteDefaultBranch(result.stdout)
				: undefined;
		} catch {
			return undefined;
		}
	})();
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<undefined>(resolve => {
		timer = setTimeout(() => {
			resolve(undefined);
		}, options.timeoutMs ?? 6000);
	});
	try {
		return await Promise.race([asked, timeout]);
	} finally {
		clearTimeout(timer);
	}
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
