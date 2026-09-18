/**
 * `trunk init [dir]`: set up a project that is already on disk in the bare
 * layout — cloned by hand, already using worktrunk, or left behind by an
 * interrupted `trunk clone`.
 *
 * Everything from the existing-config question onward is the same code
 * `trunk clone` runs. What is specific here is finding the project, refusing a
 * plain clone, and repairing whatever a hand-made setup is missing.
 */
import {join, resolve as resolvePath} from 'node:path';
import {adoptConfig} from '../core/adopt.js';
import type {CliFlags} from '../core/arguments.js';
import type {ToolProbe} from '../core/env.js';
import {
	addWorktree,
	configureOriginFetch,
	existingDefaultBranch,
	listWorktrees,
	originFetchRefspec,
	remoteDefaultBranch,
	runGit,
	setHeadBranch,
	type GitOptions,
} from '../core/git.js';
import {
	configureProject,
	createContext,
	errorMessage,
	interrupted,
	locateWorktree,
	readExistingConfig,
	warnAboutWorktreePath,
	type SetupContext,
	type SetupDependencies,
} from '../core/pipeline.js';
import {
	detectLayout,
	loadSshAliases,
	parseRemote,
	type ParsedRemote,
	type RepositoryLayout,
} from '../core/repo.js';
import {
	badUsage,
	unsupportedEnvironment,
	type Outcome,
} from '../core/result.js';
import {switchAttached} from '../core/wt.js';

export type {SetupDependencies as InitDependencies} from '../core/pipeline.js';

export async function runInit(
	arguments_: readonly string[],
	flags: CliFlags,
	tools: ToolProbe,
	dependencies: SetupDependencies = {},
): Promise<Outcome> {
	const [directory, ...extra] = arguments_;
	if (extra.length > 0) {
		return badUsage(`unexpected argument: ${extra[0]!}`);
	}

	const context = createContext(flags, tools, dependencies);
	const target = resolvePath(context.cwd, directory ?? '.');
	const layout = await detectLayout(target, context.git);

	switch (layout.kind) {
		case 'plain-clone': {
			return refusePlainClone(context, layout);
		}

		case 'empty': {
			return badUsage(
				`${target} holds no repository; use \`trunk clone <url> ${
					directory ?? '<dir>'
				}\` instead`,
			);
		}

		case 'occupied': {
			return badUsage(`${target} is not a git repository`);
		}

		default: {
			break;
		}
	}

	const projectDirectory = layout.projectRoot ?? target;
	const gitDirectory = layout.gitDir ?? join(projectDirectory, '.git');

	try {
		return await setUpExisting(context, projectDirectory, gitDirectory);
	} catch (error: unknown) {
		return interrupted(context, projectDirectory, errorMessage(error));
	}
}

async function setUpExisting(
	context: SetupContext,
	projectDirectory: string,
	gitDirectory: string,
): Promise<Outcome> {
	const url = await originUrl(gitDirectory, context.git);
	if (!url) {
		return badUsage(
			`${projectDirectory} has no origin remote; trunk needs one to name the project`,
		);
	}

	let remote: ParsedRemote;
	try {
		remote = parseRemote(url, await loadSshAliases(), context.cwd);
	} catch (error: unknown) {
		return badUsage(errorMessage(error));
	}

	const defaultBranch = await repairDefaultBranch(
		context,
		gitDirectory,
		remote,
	);
	await repairFetchRefspec(context, gitDirectory);
	const defaultWorktree = await ensureWorktree(context, {
		remote,
		projectDirectory,
		gitDirectory,
		branch: defaultBranch,
	});
	if (!defaultWorktree) {
		return interrupted(
			context,
			projectDirectory,
			`could not create the ${defaultBranch} worktree`,
		);
	}

	// Adoption runs before the form so the repository's own choices become the
	// defaults, rather than trunk's.
	const existing = await readExistingConfig(defaultWorktree);
	const adoption = existing ? adoptConfig(existing) : undefined;
	for (const note of adoption?.notes ?? []) {
		context.report('warning', note.message);
	}

	return configureProject(context, {
		remote,
		projectDirectory,
		gitDirectory,
		defaultWorktree,
		defaultBranch,
		adopted: adoption?.values,
		copyIgnoredExclude: adoption?.copyIgnoredExclude,
	});
}

/**
 * Trunk sets up bare-layout projects and never converts a checkout in place:
 * the checkout may hold uncommitted work, ignored files and a shell someone is
 * standing in. It prints the recipe and lets the user decide.
 */
async function refusePlainClone(
	context: SetupContext,
	layout: RepositoryLayout,
): Promise<Outcome> {
	const clone = layout.worktreeRoot ?? layout.projectRoot ?? layout.path;
	const gitDirectory = layout.gitDir ?? join(clone, '.git');
	const url = (await originUrl(gitDirectory, context.git)) ?? '<remote url>';
	const name = clone.split('/').at(-1) ?? 'project';

	const dirty = await describeUnsavedWork(context, clone);
	if (dirty.length > 0) {
		context.report(
			'warning',
			`${clone} still holds ${dirty.join(' and ')}; keep it until that is safe`,
		);
	}

	for (const line of [
		`${clone} is a normal clone; trunk sets up bare-layout projects.`,
		'',
		`  trunk clone ${url} ${name}-wt`,
		`  cp ${name}/.env* ${name}-wt/<default branch>/`,
		`  # check nothing uncommitted or unpushed is left in ${name}, then:`,
		`  rm -rf ${name} && mv ${name}-wt ${name}`,
	]) {
		context.report('info', line);
	}

	return unsupportedEnvironment(`${clone} is a normal clone`);
}

/** Uncommitted and unpushed work, named so the warning is specific. */
async function describeUnsavedWork(
	context: SetupContext,
	clone: string,
): Promise<readonly string[]> {
	const found: string[] = [];
	const status = await runGit(
		['-C', clone, 'status', '--porcelain'],
		context.git,
	);
	if (status.code === 0 && status.stdout.trim()) {
		found.push('uncommitted changes');
	}

	const unpushed = await runGit(
		['-C', clone, 'log', '--branches', '--not', '--remotes', '--oneline'],
		context.git,
	);
	if (unpushed.code === 0 && unpushed.stdout.trim()) {
		found.push('unpushed commits');
	}

	return Object.freeze(found);
}

/** A hand-made bare clone usually has no refspec, so `origin/*` is empty. */
async function repairFetchRefspec(
	context: SetupContext,
	gitDirectory: string,
): Promise<void> {
	const configured = await runGit(
		['--git-dir', gitDirectory, 'config', '--get', 'remote.origin.fetch'],
		context.git,
	);
	if (
		configured.code === 0 &&
		configured.stdout.trim() === originFetchRefspec
	) {
		return;
	}

	const repaired = await configureOriginFetch(gitDirectory, context.git);
	context.report(
		repaired.code === 0 ? 'success' : 'warning',
		repaired.code === 0
			? 'set the origin fetch refspec and fetched'
			: 'could not set the origin fetch refspec',
	);
}

/** HEAD first, then the remote; record it the way wt expects to find it. */
async function repairDefaultBranch(
	context: SetupContext,
	gitDirectory: string,
	remote: ParsedRemote,
): Promise<string> {
	const existing = await existingDefaultBranch(gitDirectory, context.git);
	if (existing) {
		return existing;
	}

	const branch = await remoteDefaultBranch(remote.url, context.git);
	await setHeadBranch(gitDirectory, branch, context.git);
	await runGit(
		['--git-dir', gitDirectory, 'config', 'worktrunk.default-branch', branch],
		context.git,
	);
	context.report('success', `recorded the default branch ${branch}`);
	return branch;
}

/**
 * Reuses the worktree for the default branch when there is one, which is also
 * what makes `trunk init` the resume command after an interrupted clone.
 */
async function ensureWorktree(
	context: SetupContext,
	location: Readonly<{
		remote: ParsedRemote;
		projectDirectory: string;
		gitDirectory: string;
		branch: string;
	}>,
): Promise<string | undefined> {
	const {remote, projectDirectory, gitDirectory, branch} = location;
	const expected = join(projectDirectory, branch.replaceAll('/', '-'));
	const worktrees = await listWorktrees(gitDirectory, context.git);
	const existing = await locateWorktree(gitDirectory, expected, context.git);
	if (worktrees.includes(existing) && existing !== projectDirectory) {
		return existing;
	}

	context.journal.record({kind: 'worktree', path: expected, branch});
	if (context.interactive) {
		await switchAttached(projectDirectory, branch, {
			wtPath: context.wtPath,
			attach: context.attach,
			env: context.env,
		});
	} else {
		const added = await addWorktree(
			gitDirectory,
			expected,
			branch,
			context.git,
		);
		if (added.code !== 0) {
			return undefined;
		}

		warnAboutWorktreePath(context, remote, expected);
	}

	const actual = await locateWorktree(gitDirectory, expected, context.git);
	if (actual !== expected) {
		context.journal.relocate(expected, actual);
		warnAboutWorktreePath(context, remote, actual);
	}

	return actual;
}

async function originUrl(
	gitDirectory: string,
	options: GitOptions,
): Promise<string | undefined> {
	const result = await runGit(
		['--git-dir', gitDirectory, 'config', '--get', 'remote.origin.url'],
		options,
	);
	return result.code === 0 ? result.stdout.trim() || undefined : undefined;
}
