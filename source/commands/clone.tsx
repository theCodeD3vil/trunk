/**
 * `trunk clone <url> [dir]`: from a remote URL to a project on disk, then into
 * the shared setup pipeline.
 *
 * Nothing here ever changes directory: every git call carries `--git-dir` or
 * `-C`, so the pipeline is safe to run from inside another worktree. And every
 * step records what it is about to create in the journal before acting, so an
 * interrupted run can describe or undo precisely what exists.
 */
import {join, basename, resolve as resolvePath} from 'node:path';
import type {CliFlags} from '../core/arguments.js';
import type {ToolProbe} from '../core/env.js';
import {
	addWorktree,
	cloneBare,
	cloneBareQuietly,
	configureOriginFetch,
	probeDefaultBranch,
	remoteDefaultBranch,
	setHeadBranch,
} from '../core/git.js';
import {
	displayPath,
	runInteractiveSetup,
	type FlowPlan,
} from '../core/interactive-flow.js';
import {
	configureProject,
	createContext,
	errorMessage,
	folderState,
	interrupted,
	locateWorktree,
	outputOf,
	warnAboutWorktreePath,
	type SetupContext,
	type SetupDependencies,
} from '../core/pipeline.js';
import {loadSshAliases, parseRemote, type ParsedRemote} from '../core/repo.js';
import {badUsage, type Outcome} from '../core/result.js';
import {switchAttached} from '../core/wt.js';

export type {SetupDependencies as CloneDependencies} from '../core/pipeline.js';

export async function runClone(
	arguments_: readonly string[],
	flags: CliFlags,
	tools: ToolProbe,
	dependencies: SetupDependencies = {},
): Promise<Outcome> {
	const [url, directory, ...extra] = arguments_;
	if (!url) {
		return badUsage('trunk clone needs a remote URL');
	}

	if (extra.length > 0) {
		return badUsage(`unexpected argument: ${extra[0]!}`);
	}

	const context = createContext(flags, tools, dependencies);
	let remote: ParsedRemote;
	try {
		remote = parseRemote(url, await loadSshAliases(), context.cwd);
	} catch (error: unknown) {
		return badUsage(errorMessage(error));
	}

	const projectDirectory = resolvePath(
		context.cwd,
		directory ?? (remote.repo || basename(url)),
	);
	const emptiness = await folderState(projectDirectory);
	if (emptiness === 'occupied') {
		return badUsage(
			`${projectDirectory} already exists and is not empty; choose another folder`,
		);
	}

	try {
		if (context.interactive && context.terminalUi) {
			return await runInteractiveSetup(
				context,
				await context.terminalUi(),
				clonePlan(remote, projectDirectory, emptiness, context),
			);
		}

		return await pipeline(context, remote, projectDirectory, emptiness);
	} catch (error: unknown) {
		return interrupted(context, projectDirectory, errorMessage(error));
	}
}

/**
 * The interactive version of the same work, as named steps the UI can show.
 * It uses plain git throughout: a step that borrowed the terminal, such as
 * git's progress or a wt question, would tear the screen apart.
 */
function clonePlan(
	remote: ParsedRemote,
	projectDirectory: string,
	emptiness: 'missing' | 'empty',
	context: SetupContext,
): FlowPlan {
	const gitDirectory = join(projectDirectory, '.git');
	const root = basename(projectDirectory);
	return {
		command: 'clone',
		remote,
		repoName: remote.repo,
		project:
			remote.kind === 'hosted' ? `${remote.owner}/${remote.repo}` : remote.repo,
		projectDirectory,
		gitDirectory,
		async probeDefaultBranch() {
			return probeDefaultBranch(remote.url, {
				gitPath: context.git.gitPath,
				env: context.env,
			});
		},
		prepareSteps: [
			{id: 'clone', label: 'Clone repository', detail: remote.url},
			{
				id: 'branch',
				label: 'Detect default branch',
				detail: 'asking the remote',
			},
			{
				id: 'worktree',
				label: 'Create worktree',
				detail: `${root}/<default branch>`,
			},
		],
		async prepare({context, step}) {
			if (emptiness === 'missing') {
				context.journal.record({kind: 'folder', path: projectDirectory});
			}

			context.journal.record({kind: 'bare-repo', path: gitDirectory});
			await step('clone', async () => {
				const cloned = await cloneBareQuietly(
					remote.url,
					gitDirectory,
					context.git,
				);
				if (cloned.code !== 0) {
					throw new Error(`git clone failed: ${outputOf(cloned)}`);
				}

				return {value: undefined, detail: remote.url};
			});
			// A bare clone has no fetch refspec, so origin/* would stay empty; the
			// remote also decides the default branch, never an assumed `main`.
			const branch = await step('branch', async () => {
				const configured = await configureOriginFetch(
					gitDirectory,
					context.git,
				);
				if (configured.code !== 0) {
					throw new Error(
						`could not configure the origin refspec: ${outputOf(configured)}`,
					);
				}

				const name = await remoteDefaultBranch(remote.url, context.git);
				await setHeadBranch(gitDirectory, name, context.git);
				return {value: name, detail: name};
			});
			const defaultWorktree = await step('worktree', async () => {
				const expected = join(projectDirectory, branch.replaceAll('/', '-'));
				context.journal.record({kind: 'worktree', path: expected, branch});
				const added = await addWorktree(
					gitDirectory,
					expected,
					branch,
					context.git,
				);
				if (added.code !== 0) {
					throw new Error(
						`could not create the ${branch} worktree: ${outputOf(added)}`,
					);
				}

				const actual = await locateWorktree(
					gitDirectory,
					expected,
					context.git,
					branch,
				);
				if (actual !== expected) {
					context.journal.relocate(expected, actual);
				}

				return {value: actual, detail: displayPath(actual)};
			});
			return {defaultWorktree, defaultBranch: branch};
		},
	};
}

async function pipeline(
	context: SetupContext,
	remote: ParsedRemote,
	projectDirectory: string,
	emptiness: 'missing' | 'empty',
): Promise<Outcome> {
	const gitDirectory = join(projectDirectory, '.git');

	// Step 2: the bare clone, which is also what creates the folder.
	if (emptiness === 'missing') {
		context.journal.record({kind: 'folder', path: projectDirectory});
	}

	context.journal.record({kind: 'bare-repo', path: gitDirectory});
	context.report('info', `cloning ${remote.url}`);
	const cloned = await cloneBare(remote.url, gitDirectory, {
		...context.git,
		attach: context.attach,
	});
	if (cloned !== 0) {
		return interrupted(context, projectDirectory, 'git clone failed');
	}

	// Step 3: a bare clone has no fetch refspec, so origin/* would stay empty.
	const configured = await configureOriginFetch(gitDirectory, context.git);
	if (configured.code !== 0) {
		return interrupted(
			context,
			projectDirectory,
			`could not configure the origin refspec: ${outputOf(configured)}`,
		);
	}

	// Step 4: the remote decides the default branch; never assume main.
	const defaultBranch = await remoteDefaultBranch(remote.url, context.git);
	await setHeadBranch(gitDirectory, defaultBranch, context.git);
	context.report('success', `default branch ${defaultBranch}`);

	// Step 5: let wt place the first worktree so it can ask its own question.
	const defaultWorktree = await createFirstWorktree(context, {
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

	return configureProject(context, {
		remote,
		repoName: remote.repo,
		projectDirectory,
		gitDirectory,
		defaultWorktree,
	});
}

/**
 * Worktrunk owns worktree placement, so the attached call is the one that gets
 * it right. Without a terminal it cannot ask, so trunk falls back to plain git and
 * says what that will cost.
 */
async function createFirstWorktree(
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

	const actual = await locateWorktree(
		gitDirectory,
		expected,
		context.git,
		branch,
	);
	if (actual !== expected) {
		warnAboutWorktreePath(context, remote, actual);
	}

	return actual;
}
