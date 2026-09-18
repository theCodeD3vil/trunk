import {readFile, readdir, realpath, stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename, dirname, isAbsolute, join, resolve} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {gitCommonDirectory, isBareRepository, type GitOptions} from './git.js';

export type Remote = Readonly<{
	kind: 'hosted';
	url: string;
	host: string;
	realHost: string;
	owner: string;
	repo: string;
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

	const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(value);
	if (scp && !looksLikeLocalWindowsPath(value)) {
		return hostedRemote(value, scp[1]!, scp[2]!, aliases);
	}

	return localRemote(value, value, workingDirectory);
}

export function parseSshAliases(contents: string): SshAliases {
	const aliases: Record<string, string> = {};
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

export async function loadSshAliases(
	configPath: string = join(homedir(), '.ssh', 'config'),
): Promise<SshAliases> {
	try {
		return parseSshAliases(await readFile(configPath, 'utf8'));
	} catch {
		return Object.freeze({});
	}
}

export function resolveSshAlias(host: string, aliases: SshAliases): string {
	const entries = Object.entries(aliases);
	const exact = entries.find(
		([alias]) => alias.toLowerCase() === host.toLowerCase(),
	);
	const matched = exact ?? entries.find(([alias]) => hostMatches(alias, host));
	return matched?.[1].split('%h').join(host) ?? host;
}

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

async function searchLayout(
	current: string,
	target: string,
	gitOptions: GitOptions,
): Promise<RepositoryLayout> {
	if (basename(current) === '.git') {
		const direct = await layoutFromGitDirectory(
			{gitDirectory: current, target, matchedAt: current},
			gitOptions,
		);
		if (direct) {
			return direct;
		}
	}

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
