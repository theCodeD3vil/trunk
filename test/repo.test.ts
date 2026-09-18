import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import process from 'node:process';
import {promisify} from 'node:util';
import {afterEach, describe, expect, test} from 'bun:test';
import {
	createRemoteDefaultBranchResolver,
	existingDefaultBranch,
	GitCommandError,
	parseRemoteDefaultBranch,
	remoteDefaultBranch,
} from '../source/core/git.js';
import type {CommandRunner} from '../source/core/process.js';
import {
	detectLayout,
	parseRemote,
	parseSshAliases,
} from '../source/core/repo.js';

const executeFile = promisify(execFile);

describe('remote parsing', () => {
	const aliases = parseSshAliases(`
		Host github.com-work work
			HostName github.com # company account

		Host github.com-work
			HostName ignored.example.com

		Host *.internal
			HostName gateway.internal

		Host github.com-alt
			HostName=github.com

		Host gitlab.com-eq
			HostName = gitlab.com
	`);

	test('parses an SSH alias and preserves its identifier', () => {
		expect(
			parseRemote(
				'git@github.com-work:New-Vision-Creatives/djulah-admin.git',
				aliases,
			),
		).toEqual({
			kind: 'hosted',
			url: 'git@github.com-work:New-Vision-Creatives/djulah-admin.git',
			host: 'github.com-work',
			realHost: 'github.com',
			owner: 'New-Vision-Creatives',
			repo: 'djulah-admin',
			identifier: 'github.com-work/New-Vision-Creatives/djulah-admin',
		});
	});

	test.each([
		['git@github.com:user/repo.git', 'github.com', 'user', 'repo'],
		['https://github.com/user/repo', 'github.com', 'user', 'repo'],
		['https://github.com/user/repo.git', 'github.com', 'user', 'repo'],
		['ssh://git@github.com/user/repo.git', 'github.com', 'user', 'repo'],
	] as const)('parses %s', (url, host, owner, repository) => {
		const remote = parseRemote(url);
		expect(remote.kind).toBe('hosted');
		if (remote.kind === 'hosted') {
			expect(remote.host).toBe(host);
			expect(remote.realHost).toBe(host);
			expect(remote.owner).toBe(owner);
			expect(remote.repo).toBe(repository);
		}
	});

	test('represents local paths without invented host or owner values', () => {
		const remote = parseRemote('../fixtures/example.git', {}, '/tmp/project');
		expect(remote).toEqual({
			kind: 'local',
			url: '../fixtures/example.git',
			path: resolve('/tmp/project', '../fixtures/example.git'),
			repo: 'example',
			identifier: resolve('/tmp/project', '../fixtures/example'),
		});
	});

	test('parses file URLs as local remotes', () => {
		const remote = parseRemote('file:///tmp/example.git');
		expect(remote.kind).toBe('local');
		expect(remote.repo).toBe('example');
		expect(remote.identifier).toBe('file:///tmp/example');
	});

	test('uses the first SSH value and supports common config syntax', () => {
		expect(aliases).toEqual(
			Object.fromEntries([
				['github.com-work', 'github.com'],
				['work', 'github.com'],
				['*.internal', 'gateway.internal'],
				['github.com-alt', 'github.com'],
				['gitlab.com-eq', 'gitlab.com'],
			]),
		);
		expect(
			parseRemote('git@api.internal:owner/repo.git', aliases),
		).toMatchObject({realHost: 'gateway.internal'});
	});

	test('accepts a local bare-layout git directory', () => {
		const remote = parseRemote('/tmp/project/.git');
		expect(remote).toMatchObject({
			kind: 'local',
			repo: 'project',
			identifier: '/tmp/project/',
		});
	});
});

describe('default branch detection', () => {
	test('parses a symref response with CRLF and extra lines', () => {
		expect(
			parseRemoteDefaultBranch(
				'ref: refs/heads/develop\tHEAD\r\nabc123\tHEAD\r\n',
			),
		).toBe('develop');
	});

	test('falls back to the Worktrunk config key', async () => {
		const run: CommandRunner = async (_command, arguments_) =>
			arguments_.includes('symbolic-ref')
				? {code: 1, stdout: '', stderr: 'detached'}
				: {code: 0, stdout: 'release\n', stderr: ''};

		expect(await existingDefaultBranch('/repo/.git', {run})).toBe('release');
	});

	test('caches successful remote lookups per resolver', async () => {
		let calls = 0;
		const run: CommandRunner = async () => {
			calls += 1;
			return {
				code: 0,
				stdout: 'ref: refs/heads/main\tHEAD\nabc\tHEAD\n',
				stderr: '',
			};
		};

		const branch = createRemoteDefaultBranchResolver({run});

		expect(await branch('remote')).toBe('main');
		expect(await branch('remote')).toBe('main');
		expect(calls).toBe(1);
	});

	test('preserves the raw git error', async () => {
		const run: CommandRunner = async () => ({
			code: 128,
			stdout: '',
			stderr: 'Permission denied (publickey).\n',
		});

		try {
			await remoteDefaultBranch('git@example.com:owner/repo.git', {run});
			throw new Error('Expected lookup to fail.');
		} catch (error: unknown) {
			expect(error).toBeInstanceOf(GitCommandError);
			if (error instanceof GitCommandError) {
				expect(error.result.stderr).toBe('Permission denied (publickey).\n');
			}
		}
	});
});

describe('repository layout detection', () => {
	const temporaryDirectories: string[] = [];

	afterEach(async () => {
		await Promise.all(
			temporaryDirectories
				.splice(0)
				.map(async directory => rm(directory, {recursive: true, force: true})),
		);
	});

	test('distinguishes missing, empty, and occupied directories', async () => {
		const root = await temporaryDirectory();
		const empty = join(root, 'empty');
		const occupied = join(root, 'occupied');
		await Promise.all([mkdir(empty), mkdir(occupied)]);
		await writeFile(join(occupied, 'notes.txt'), 'content');

		const missingLayout = await detectLayout(join(root, 'missing'));
		const emptyLayout = await detectLayout(empty);
		const occupiedLayout = await detectLayout(occupied);
		expect(missingLayout.kind).toBe('empty');
		expect(emptyLayout.kind).toBe('empty');
		expect(occupiedLayout.kind).toBe('occupied');
	});

	test('treats a directory holding only platform clutter as empty', async () => {
		const root = await temporaryDirectory();
		const visited = join(root, 'visited');
		await mkdir(visited);
		await writeFile(join(visited, '.DS_Store'), '');

		const visitedLayout = await detectLayout(visited);
		expect(visitedLayout.kind).toBe('empty');
	});

	test('reports where a nested directory inherited its layout from', async () => {
		const root = await temporaryDirectory();
		const clone = join(root, 'clone');
		const nested = join(clone, 'sub', 'notes');
		await createRepository(clone);
		await mkdir(nested, {recursive: true});
		await writeFile(join(nested, 'notes.txt'), 'content');
		const canonicalClone = await realpath(clone);

		const layout = await detectLayout(nested);

		expect(layout.kind).toBe('plain-clone');
		expect(layout.matchedAt).toBe(canonicalClone);
		expect(layout.path).not.toBe(layout.matchedAt);
		expect(await detectLayout(clone)).toMatchObject({
			matchedAt: canonicalClone,
			path: canonicalClone,
		});
	});

	test('resolves a bare project, its git directory, and its worktree', async () => {
		const root = await temporaryDirectory();
		const {project, gitDirectory, worktree} = await createBareProject(root);

		const projectLayout = await detectLayout(project);
		const gitLayout = await detectLayout(gitDirectory);
		const worktreeLayout = await detectLayout(worktree);

		expect(projectLayout).toMatchObject({
			kind: 'bare-project',
			projectRoot: project,
			gitDir: gitDirectory,
		});
		expect(gitLayout).toMatchObject({
			kind: 'bare-inside',
			projectRoot: project,
			gitDir: gitDirectory,
		});
		expect(worktreeLayout).toMatchObject({
			kind: 'bare-inside',
			projectRoot: project,
			gitDir: gitDirectory,
			worktreeRoot: worktree,
		});
		expect(await existingDefaultBranch(gitDirectory)).toBe('main');
		expect(await remoteDefaultBranch(gitDirectory)).toBe('main');
	});

	test('identifies a plain clone and its linked worktree', async () => {
		const root = await temporaryDirectory();
		const clone = join(root, 'clone');
		const linked = join(root, 'linked');
		await createRepository(clone);
		await git(['-C', clone, 'worktree', 'add', '-b', 'linked', linked]);
		const canonicalClone = await realpath(clone);
		const canonicalLinked = await realpath(linked);

		expect(await detectLayout(clone)).toMatchObject({
			kind: 'plain-clone',
			projectRoot: canonicalClone,
			gitDir: join(canonicalClone, '.git'),
		});
		expect(await detectLayout(linked)).toMatchObject({
			kind: 'plain-clone',
			projectRoot: canonicalClone,
			gitDir: join(canonicalClone, '.git'),
			worktreeRoot: canonicalLinked,
		});
	});

	async function temporaryDirectory(): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), 'trunk-repo-'));
		temporaryDirectories.push(directory);
		return directory;
	}
});

async function createBareProject(root: string) {
	const source = join(root, 'source');
	const project = join(root, 'project');
	const gitDirectory = join(project, '.git');
	const worktree = join(project, 'main');
	await createRepository(source);
	await mkdir(project);
	await git(['clone', '--bare', source, gitDirectory]);
	await git(['--git-dir', gitDirectory, 'worktree', 'add', worktree, 'main']);
	const [canonicalProject, canonicalGitDirectory, canonicalWorktree] =
		await Promise.all([
			realpath(project),
			realpath(gitDirectory),
			realpath(worktree),
		]);
	return {
		project: canonicalProject,
		gitDirectory: canonicalGitDirectory,
		worktree: canonicalWorktree,
	};
}

async function createRepository(path: string): Promise<void> {
	await git(['init', '--initial-branch', 'main', path]);
	await writeFile(join(path, 'README.md'), '# fixture\n');
	await git(['-C', path, 'add', 'README.md']);
	await git([
		'-C',
		path,
		'-c',
		'user.name=Trunk Tests',
		'-c',
		'user.email=trunk@example.com',
		'commit',
		'-m',
		'Initial commit',
	]);
}

async function git(arguments_: readonly string[]): Promise<void> {
	await executeFile('git', arguments_, {
		env: Object.fromEntries([
			['HOME', tmpdir()],
			['PATH', process.env['PATH']],
			['GIT_CONFIG_NOSYSTEM', '1'],
		]),
	});
}
