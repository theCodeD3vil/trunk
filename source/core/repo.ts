/**
 * What a repository is and what shape a directory is in: parsing a remote URL
 * into the identity wt uses, resolving SSH host aliases, and classifying a
 * directory as a trunk-layout project, a plain clone, empty or occupied.
 */
import {readFile, readdir, realpath, stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename, dirname, isAbsolute, join, resolve} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {gitCommonDirectory, isBareRepository, type GitOptions} from './git.js';

/** A remote on a hosting service, parsed from any URL form git accepts. */
export type Remote = Readonly<{
	kind: 'hosted';
	/** The URL exactly as the user typed it. */
	url: string;
	/** The host as written, which may be an SSH alias such as `github.com-work`. */
	host: string;
	/** What that alias resolves to in ~/.ssh/config, for deciding gh can reach it. */
	realHost: string;
	owner: string;
	/** Repository name without the `.git` suffix. */
	repo: string;
	/**
	 * `host/owner/repo`, matching what `wt config show` prints as its Identifier.
	 * The alias is kept verbatim, because that is the string wt keys its
	 * per-project settings on.
	 */
	identifier: string;
}>;

export type LocalRemote = Readonly<{
	kind: 'local';
	url: string;
	path: string;
	repo: string;
	identifier: string;
}>;

export type ParsedRemote = Remote | LocalRemote;
export type SshAliases = Readonly<Record<string, string>>;

/**
 * - `bare-project`: the directory is a trunk-layout project root, holding a bare
 *   `.git` with worktrees beside it. This is the layout trunk sets up.
 * - `bare-inside`: somewhere inside such a project, for example one of its
 *   worktrees; `projectRoot` points at the top.
 * - `plain-clone`: an ordinary clone, which trunk refuses to convert in place.
 * - `empty`: nothing there yet, which is what clone and new want.
 * - `occupied`: files that are not a repository.
 */
export type LayoutKind =
	| 'bare-project'
	| 'bare-inside'
	| 'plain-clone'
	| 'empty'
	| 'occupied';

export type RepositoryLayout = Readonly<{
	kind: LayoutKind;
	path: string;
	/**
	 * The directory whose git marker produced this classification. It differs
	 * from `path` when the answer came from an ancestor, which is how a plain
	 * subdirectory of a repository is reported; callers that need the target
	 * itself to be the repository must compare the two.
	 */
	matchedAt?: string;
	projectRoot?: string;
	gitDir?: string;
	worktreeRoot?: string;
}>;

/** Entries an otherwise empty directory may hold and still count as empty. */
const ignorableEntries = new Set(['.DS_Store', '.localized', 'Thumbs.db']);

/**
 * Parses any remote git understands: scp-style (`git@host:owner/repo.git`),
 * https, ssh:// and a plain local path. The repository name comes from here and
 * nowhere else — in trunk's layout the project folder holds a bare `.git`, so
 * the folder name is not the project's identity.
 */
export function parseRemote(
	url: string,
	aliases: SshAliases = {},
	workingDirectory: string = process.cwd(),
): ParsedRemote {
	const value = url.trim();
	if (!value) {
		throw new TypeError('Remote URL cannot be empty.');
	}

	if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
		const parsed = new URL(value);
		if (parsed.protocol === 'file:') {
			return localRemote(value, fileURLToPath(parsed), workingDirectory);
		}

		if (['http:', 'https:', 'ssh:'].includes(parsed.protocol)) {
			return hostedRemote(value, parsed.hostname, parsed.pathname, aliases);
		}
	}

	// The scp-style form `[user@]host:path` has no scheme to match on. The
	// Windows check keeps `C:\repo` from being read as a host named C.
	const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(value);
	if (scp && !looksLikeLocalWindowsPath(value)) {
		return hostedRemote(value, scp[1]!, scp[2]!, aliases);
	}

	return localRemote(value, value, workingDirectory);
}

/**
 * Reads `Host`/`HostName` pairs out of an ssh config. Parsed here rather than
 * shelled out to `ssh -G` so it stays fast and testable; this only needs to
 * cover the common forms, since a miss just leaves the alias unresolved.
 */
export function parseSshAliases(contents: string): SshAliases {
	const aliases: Record<string, string> = {};
	// Directives apply to the Host block above them, so the current block is
	// carried down the file. ssh honours the first value it sees for a host.
	let hosts: string[] = [];

	for (const originalLine of contents.split(/\r?\n/)) {
		const line = originalLine.replace(/\s+#.*$/, '').trim();
		if (!line) {
			continue;
		}

		const parsed = parseSshDirective(line);
		if (!parsed) {
			continue;
		}

		const {directive, values} = parsed;
		if (directive.toLowerCase() === 'host') {
			hosts = values.filter(host => !host.startsWith('!'));
			continue;
		}

		if (directive.toLowerCase() !== 'hostname' || values.length === 0) {
			continue;
		}

		for (const host of hosts) {
			if (!hasAlias(aliases, host)) {
				aliases[host] = values[0]!;
			}
		}
	}

	return Object.freeze(aliases);
}

/** Best effort: no ssh config, or one that cannot be read, simply means no aliases. */
export async function loadSshAliases(
	configPath: string = join(homedir(), '.ssh', 'config'),
): Promise<SshAliases> {
	try {
		return parseSshAliases(await readFile(configPath, 'utf8'));
	} catch {
		return Object.freeze({});
	}
}

/**
 * Turns an alias into the host it really points at. An exact entry wins over a
 * pattern such as `*.internal`, and an unknown host is returned unchanged.
 */
export function resolveSshAlias(host: string, aliases: SshAliases): string {
	const entries = Object.entries(aliases);
	const exact = entries.find(
		([alias]) => alias.toLowerCase() === host.toLowerCase(),
	);
	const matched = exact ?? entries.find(([alias]) => hostMatches(alias, host));
	return matched?.[1].split('%h').join(host) ?? host;
}

/**
 * Works out what a directory is, so a command knows whether to set it up,
 * refuse it, or resolve upwards to the project it belongs to. A missing
 * directory counts as empty: that is a target waiting to be created.
 */
export async function detectLayout(
	path: string,
	gitOptions: GitOptions = {},
): Promise<RepositoryLayout> {
	const resolvedPath = resolve(path);
	const targetStat = await safeStat(resolvedPath);
	if (!targetStat) {
		return layout('empty', resolvedPath);
	}

	const target = await realpath(resolvedPath);

	if (!targetStat.isDirectory()) {
		return layout('occupied', target);
	}

	const targetEntries = await readdir(target);
	if (targetEntries.every(entry => ignorableEntries.has(entry))) {
		return layout('empty', target);
	}

	return searchLayout(target, target, gitOptions);
}

function hostedRemote(
	url: string,
	host: string,
	remotePath: string,
	aliases: SshAliases,
): Remote {
	const parts = remotePath
		.replace(/^\/+/, '')
		.replace(/\/+$/, '')
		.split('/')
		.filter(Boolean);
	if (parts.length !== 2) {
		throw new TypeError(`Remote must contain an owner and repository: ${url}`);
	}

	const owner = parts[0]!;
	const repo = stripGitSuffix(parts[1]!);
	if (!owner || !repo) {
		throw new TypeError(`Remote must contain an owner and repository: ${url}`);
	}

	return Object.freeze({
		kind: 'hosted',
		url,
		host,
		realHost: resolveSshAlias(host, aliases),
		owner,
		repo,
		identifier: `${host}/${owner}/${repo}`,
	});
}

function localRemote(
	url: string,
	path: string,
	workingDirectory: string,
): LocalRemote {
	const absolutePath = isAbsolute(path)
		? resolve(path)
		: resolve(workingDirectory, path);
	const identityPath = stripGitSuffix(absolutePath);
	const repo = basename(identityPath);
	if (!repo) {
		throw new TypeError(`Local remote does not name a repository: ${url}`);
	}

	return Object.freeze({
		kind: 'local',
		url,
		path: absolutePath,
		repo,
		identifier: url.startsWith('file:') ? stripGitSuffix(url) : identityPath,
	});
}

type LayoutCandidate = Readonly<{
	gitDirectory: string;
	target: string;
	matchedAt: string;
	worktreeRoot?: string;
}>;

async function layoutFromGitDirectory(
	candidate: LayoutCandidate,
	gitOptions: GitOptions,
): Promise<RepositoryLayout | undefined> {
	const {gitDirectory, target, matchedAt, worktreeRoot} = candidate;
	const commonDirectory = await gitCommonDirectory(gitDirectory, gitOptions);
	if (!commonDirectory) {
		return undefined;
	}

	const bare = await isBareRepository(commonDirectory, gitOptions);
	if (bare === undefined) {
		return undefined;
	}

	// In trunk's layout the bare git directory sits at `<project>/.git`, so the
	// project root is its parent either way.
	const projectRoot = dirname(commonDirectory);
	if (!bare) {
		return layout('plain-clone', target, {
			matchedAt,
			projectRoot,
			gitDir: commonDirectory,
			worktreeRoot,
		});
	}

	return layout(
		target === projectRoot ? 'bare-project' : 'bare-inside',
		target,
		{
			matchedAt,
			projectRoot,
			gitDir: commonDirectory,
			worktreeRoot,
		},
	);
}

/**
 * Walks from the target up towards the filesystem root looking for a git
 * marker, the way git itself resolves a repository. That is what lets a command
 * run from inside a worktree or a subdirectory; `matchedAt` records how far up
 * the answer came from.
 */
async function searchLayout(
	current: string,
	target: string,
	gitOptions: GitOptions,
): Promise<RepositoryLayout> {
	// Being inside `<project>/.git` itself: there is no `.git` entry to find here.
	if (basename(current) === '.git') {
		const direct = await layoutFromGitDirectory(
			{gitDirectory: current, target, matchedAt: current},
			gitOptions,
		);
		if (direct) {
			return direct;
		}
	}

	// A `.git` directory is a repository; a `.git` file is a linked worktree
	// pointing at one.
	const marker = join(current, '.git');
	const markerStat = await safeStat(marker);
	if (markerStat?.isDirectory()) {
		const detected = await layoutFromGitDirectory(
			{gitDirectory: marker, target, matchedAt: current},
			gitOptions,
		);
		if (detected) {
			return detected;
		}
	} else if (markerStat?.isFile()) {
		const gitDirectory = await gitDirectoryFromFile(marker);
		if (gitDirectory) {
			const detected = await layoutFromGitDirectory(
				{gitDirectory, target, matchedAt: current, worktreeRoot: current},
				gitOptions,
			);
			if (detected) {
				return detected;
			}
		}
	}

	const parent = dirname(current);
	return parent === current
		? layout('occupied', target)
		: searchLayout(parent, target, gitOptions);
}

async function gitDirectoryFromFile(path: string): Promise<string | undefined> {
	try {
		const contents = await readFile(path, 'utf8');
		const match = /^gitdir:\s*(.+)\s*$/i.exec(contents.trim());
		if (!match) {
			return undefined;
		}

		return isAbsolute(match[1]!)
			? resolve(match[1]!)
			: resolve(dirname(path), match[1]!);
	} catch {
		return undefined;
	}
}

async function safeStat(path: string) {
	try {
		return await stat(path);
	} catch (error: unknown) {
		if (isMissingFileError(error)) {
			return undefined;
		}

		throw error;
	}
}

function layout(
	kind: LayoutKind,
	path: string,
	details: Omit<RepositoryLayout, 'kind' | 'path'> = {},
): RepositoryLayout {
	return Object.freeze({kind, path, ...details});
}

function stripGitSuffix(value: string): string {
	return value.replace(/\.git$/i, '');
}

function looksLikeLocalWindowsPath(value: string): boolean {
	return /^[a-z]:[\\/]/i.test(value);
}

function hasAlias(aliases: Record<string, string>, host: string): boolean {
	return Object.keys(aliases).some(
		alias => alias.toLowerCase() === host.toLowerCase(),
	);
}

function parseSshDirective(
	line: string,
): Readonly<{directive: string; values: readonly string[]}> | undefined {
	const match = /^([^\s=]+)(?:\s*=\s*|\s+)(.+)$/.exec(line);
	if (!match) {
		return undefined;
	}

	return {
		directive: match[1]!,
		values: match[2]!.trim().split(/\s+/),
	};
}

function hostMatches(pattern: string, host: string): boolean {
	const specialCharacters = '\\^$.*+?()[]{}|';
	const expression = [...pattern]
		.map(character => {
			if (character === '*') {
				return '.*';
			}

			if (character === '?') {
				return '.';
			}

			return specialCharacters.includes(character)
				? `\\${character}`
				: character;
		})
		.join('');
	return new RegExp(`^${expression}$`, 'i').test(host);
}

function isMissingFileError(error: unknown): boolean {
	if (!(error instanceof Error) || !('code' in error)) {
		return false;
	}

	return error.code === 'ENOENT' || error.code === 'ENOTDIR';
}
