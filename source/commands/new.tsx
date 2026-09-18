/**
 * `trunk new <name> [dir]`: a project from nothing — a bare-layout repository,
 * a first commit carrying `.config/wt.toml`, and optionally the GitHub
 * repository behind it.
 *
 * The difference from clone and init is that there is no history to work from:
 * the first worktree has to be created before any commit exists, and without a
 * remote the generated config cannot use `remote_repo` at all.
 */
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, join, resolve as resolvePath} from 'node:path';
import type {CliFlags} from '../core/arguments.js';
import type {ToolProbe} from '../core/env.js';
import {compose} from '../core/generate/index.js';
import {
	activeAccount,
	createRepository,
	deleteRepositoryCommand,
	listOwners,
	sshRemoteUrl,
} from '../core/gh.js';
import {
	addWorktree,
	commitPath,
	configureOriginFetch,
	runGit,
	setHeadBranch,
} from '../core/git.js';
import {
	confirmStep,
	createContext,
	errorMessage,
	finish,
	folderState,
	interrupted,
	type SetupContext,
	type SetupDependencies,
} from '../core/pipeline.js';
import {loadSshAliases, parseRemote, type SshAliases} from '../core/repo.js';
import {setupFlagsFromCli} from '../core/resolve.js';
import {badUsage, exitCodes, type Outcome} from '../core/result.js';
import type {Settings} from '../core/settings.js';
import {validateGeneratedConfig} from '../core/validate.js';
import {trunkVersion} from '../core/version.js';

export type {SetupDependencies as NewDependencies} from '../core/pipeline.js';

/** GitHub's rule for a repository name, checked before anything is created. */
const validName = /^[\w.-]+$/;

const gitignore = `node_modules/
.env
.env.*
dist/
build/
.next/
coverage/
`;

export async function runNew(
	arguments_: readonly string[],
	flags: CliFlags,
	tools: ToolProbe,
	dependencies: SetupDependencies = {},
): Promise<Outcome> {
	const [name, directory, ...extra] = arguments_;
	if (!name) {
		return badUsage('trunk new needs a project name');
	}

	if (extra.length > 0) {
		return badUsage(`unexpected argument: ${extra[0]!}`);
	}

	if (!validName.test(name)) {
		return badUsage(
			`${name} is not a valid repository name; use letters, digits, dot, dash or underscore`,
		);
	}

	const context = createContext(flags, tools, dependencies);
	const projectDirectory = resolvePath(context.cwd, directory ?? name);
	const emptiness = await folderState(projectDirectory);
	if (emptiness === 'occupied') {
		return badUsage(
			`${projectDirectory} already exists and is not empty; choose another folder`,
		);
	}

	try {
		return await create(context, {name, projectDirectory, emptiness});
	} catch (error: unknown) {
		return interrupted(context, projectDirectory, errorMessage(error));
	}
}

async function create(
	context: SetupContext,
	project: Readonly<{
		name: string;
		projectDirectory: string;
		emptiness: 'missing' | 'empty';
	}>,
): Promise<Outcome> {
	const {name, projectDirectory, emptiness} = project;
	const gitDirectory = join(projectDirectory, '.git');
	const branch = 'main';

	const remote = await decideRemote(context, name, projectDirectory);
	if (remote.kind === 'aborted') {
		return interrupted(context, projectDirectory, 'aborted');
	}

	if (emptiness === 'missing') {
		context.journal.record({kind: 'folder', path: projectDirectory});
	}

	context.journal.record({kind: 'bare-repo', path: gitDirectory});
	await mkdir(projectDirectory, {recursive: true});
	const initialised = await runGit(
		['init', '--bare', gitDirectory],
		context.git,
	);
	if (initialised.code !== 0) {
		return interrupted(context, projectDirectory, 'git init --bare failed');
	}

	await setHeadBranch(gitDirectory, branch, context.git);

	if (remote.kind === 'remote') {
		const created = await createRemote(context, remote, name);
		if (created) {
			return interrupted(context, projectDirectory, created);
		}

		await runGit(
			['--git-dir', gitDirectory, 'remote', 'add', 'origin', remote.url],
			context.git,
		);
		await configureOriginFetch(gitDirectory, context.git);
	}

	// A bare repository has no commits, so the first worktree starts an orphan
	// branch rather than checking one out.
	const worktree = join(projectDirectory, branch);
	context.journal.record({kind: 'worktree', path: worktree, branch});
	const added = await addOrphanWorktree(
		context,
		gitDirectory,
		worktree,
		branch,
	);
	if (!added) {
		return interrupted(
			context,
			projectDirectory,
			`could not create the ${branch} worktree`,
		);
	}

	// No lockfile exists yet, so nothing can be detected; the form asks instead.
	const collected = await context.collect({
		folder: worktree,
		resolveOptions: {
			fixed: {
				trunkVersion: trunkVersion(),
				generatedOn: today(context.now()),
				repoName: name,
				hostLabel: name.toLowerCase(),
			},
			flags: setupFlagsFromCli(context.flags),
			tools: context.tools,
		},
		invocation: context.invocation,
		yes: context.flags.yes ?? false,
		interactive: context.interactive,
	});
	if (collected.kind === 'outcome') {
		return collected.outcome.code === exitCodes.userAborted
			? interrupted(context, projectDirectory, 'aborted')
			: collected.outcome;
	}

	const settings: Settings = {
		...collected.settings,
		noRemote: remote.kind !== 'remote',
	};

	await writeProjectFiles(worktree, settings);
	context.report('success', 'wrote .config/wt.toml and .gitignore');

	try {
		const validation = await validateGeneratedConfig(worktree, settings, {
			wtPath: context.wtPath,
			env: context.env,
		});
		for (const [label, value] of [
			['session', validation.preview.session],
			['port', validation.preview.port],
			['url', validation.preview.url],
		] as const) {
			if (value !== undefined) {
				context.report('info', `${label} ${value}`);
			}
		}
	} catch (error: unknown) {
		return interrupted(context, projectDirectory, errorMessage(error));
	}

	// The whole repository is new, so there is no setup branch to review: the
	// first commit is the setup.
	const committed = await commitAll(context, worktree);
	if (committed) {
		return interrupted(context, projectDirectory, committed);
	}

	context.journal.annotate(worktree, 'first commit');
	context.report('success', 'committed the first commit');

	if (remote.kind === 'remote') {
		const pushed = await context.run(
			context.git.gitPath ?? 'git',
			['-C', worktree, 'push', '-u', 'origin', branch],
			{env: context.env},
		);
		context.report(
			pushed.code === 0 ? 'success' : 'warning',
			pushed.code === 0
				? `pushed ${branch} to ${remote.url}`
				: `push failed: ${pushed.stderr.trim() || pushed.stdout.trim()}`,
		);
	}

	context.report('info', 'nothing to install yet; add dependencies first');
	return finish(context, projectDirectory, worktree, branch);
}

type RemoteChoice =
	| Readonly<{kind: 'none'}>
	| Readonly<{kind: 'aborted'}>
	| Readonly<{
			kind: 'remote';
			owner: string;
			url: string;
			visibility: 'private' | 'public';
	  }>;

/**
 * Whether to create the GitHub repository, and under which account. `--yes`
 * alone only says yes when gh can actually answer for an account, so a scripted
 * run on a machine without gh quietly stays local instead of failing.
 */
async function decideRemote(
	context: SetupContext,
	name: string,
	projectDirectory: string,
): Promise<RemoteChoice> {
	const ghPath = context.tools.gh.path;
	const wanted = context.flags.remote;
	if (wanted === false || !ghPath) {
		if (wanted === true && !ghPath) {
			context.report('warning', 'gh is not installed; creating a local repo');
		}

		return {kind: 'none'};
	}

	const account = await activeAccount({
		ghPath,
		run: context.run,
		env: context.env,
	});
	if (!account) {
		if (wanted === true) {
			context.report(
				'warning',
				'gh is not signed in; run `gh auth login`, or `gh auth switch` to pick an account',
			);
		}

		return {kind: 'none'};
	}

	if (wanted !== true) {
		const answer = await confirmStep(
			context,
			`create the GitHub repository as ${account}?`,
		);
		if (answer === undefined) {
			return {kind: 'aborted'};
		}

		if (!answer) {
			return {kind: 'none'};
		}
	}

	const owner = await chooseOwner(context, account);
	if (!owner) {
		return {kind: 'aborted'};
	}

	const aliases = await loadSshAliases();
	const url = sshRemoteUrl(
		owner,
		name,
		'github.com',
		aliases,
		await siblingHosts(context, projectDirectory),
	);
	context.report('info', `remote will be ${url}`);

	return {
		kind: 'remote',
		owner,
		url,
		visibility: context.flags.public ? 'public' : 'private',
	};
}

async function chooseOwner(
	context: SetupContext,
	account: string,
): Promise<string | undefined> {
	const flagged = context.flags.owner;
	if (flagged) {
		return flagged;
	}

	if (!context.interactive || (context.flags.yes ?? false)) {
		return account;
	}

	const owners = await listOwners({
		ghPath: context.tools.gh.path,
		run: context.run,
		env: context.env,
	});
	if (owners.length < 2) {
		return account;
	}

	const answer = await context.prompts?.choose(
		'which account should own the repository?',
		owners.map(owner => owner.login),
	);
	return answer ?? account;
}

/**
 * The ssh hosts sibling projects already use. A folder full of projects reached
 * through one alias is the best evidence of which account this one belongs to.
 */
async function siblingHosts(
	context: SetupContext,
	projectDirectory: string,
): Promise<readonly string[]> {
	const parent = dirname(projectDirectory);
	const listed = await runGit(
		['-C', parent, 'config', '--get', 'remote.origin.url'],
		context.git,
	);
	if (listed.code !== 0 || !listed.stdout.trim()) {
		return Object.freeze([]);
	}

	try {
		const remote = parseRemote(listed.stdout.trim(), {} as SshAliases, parent);
		return remote.kind === 'hosted'
			? Object.freeze([remote.host])
			: Object.freeze([]);
	} catch {
		return Object.freeze([]);
	}
}

async function createRemote(
	context: SetupContext,
	remote: Extract<RemoteChoice, {kind: 'remote'}>,
	name: string,
): Promise<string | undefined> {
	const result = await createRepository(remote.owner, name, {
		ghPath: context.tools.gh.path,
		run: context.run,
		env: context.env,
		visibility: remote.visibility,
	});
	if (result.code === 0) {
		// Recorded so an interrupted run names it, though trunk never deletes it.
		context.report('success', `created ${remote.owner}/${name} on GitHub`);
		context.report(
			'info',
			`trunk will not delete it; to undo: ${deleteRepositoryCommand(
				remote.owner,
				name,
			)}`,
		);
		return undefined;
	}

	return `gh repo create failed: ${
		result.stderr.trim() || result.stdout.trim()
	}`;
}

/**
 * `--orphan` starts a branch with no history, which is what an empty bare
 * repository needs. It arrived in git 2.42, so older versions get an empty root
 * commit instead rather than a failure.
 */
async function addOrphanWorktree(
	context: SetupContext,
	gitDirectory: string,
	worktree: string,
	branch: string,
): Promise<boolean> {
	const orphan = await runGit(
		[
			'--git-dir',
			gitDirectory,
			'worktree',
			'add',
			'--orphan',
			'-b',
			branch,
			worktree,
		],
		context.git,
	);
	if (orphan.code === 0) {
		return true;
	}

	const tree = await runGit(
		['--git-dir', gitDirectory, 'hash-object', '-t', 'tree', '/dev/null'],
		context.git,
	);
	if (tree.code !== 0) {
		return false;
	}

	const commit = await runGit(
		[
			'--git-dir',
			gitDirectory,
			'commit-tree',
			tree.stdout.trim(),
			'-m',
			'Initial commit',
		],
		context.git,
	);
	if (commit.code !== 0) {
		return false;
	}

	const pointed = await runGit(
		[
			'--git-dir',
			gitDirectory,
			'update-ref',
			`refs/heads/${branch}`,
			commit.stdout.trim(),
		],
		context.git,
	);
	if (pointed.code !== 0) {
		return false;
	}

	const added = await addWorktree(gitDirectory, worktree, branch, context.git);
	return added.code === 0;
}

async function writeProjectFiles(
	worktree: string,
	settings: Settings,
): Promise<void> {
	await mkdir(join(worktree, '.config'), {recursive: true});
	await Promise.all([
		writeFile(join(worktree, '.config', 'wt.toml'), compose(settings)),
		writeFile(join(worktree, '.gitignore'), gitignore),
	]);
}

async function commitAll(
	context: SetupContext,
	worktree: string,
): Promise<string | undefined> {
	const staged = await runGit(
		['-C', worktree, 'add', '--', '.config/wt.toml', '.gitignore'],
		context.git,
	);
	if (staged.code !== 0) {
		return `could not stage the first commit: ${staged.stderr.trim()}`;
	}

	const committed = await commitPath(
		worktree,
		'.',
		'Initial commit',
		context.git,
	);
	return committed.code === 0
		? undefined
		: `commit failed: ${committed.stderr.trim() || committed.stdout.trim()}`;
}

function today(date: Date): string {
	return date.toISOString().slice(0, 10);
}
