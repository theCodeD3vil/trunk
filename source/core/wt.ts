/**
 * Worktrunk wrappers. Two kinds live here: captured calls, whose output trunk
 * reads, and attached calls, which borrow trunk's terminal so wt can ask its
 * own questions.
 *
 * trunk never writes to the user's worktrunk config. When wt needs to know
 * something, such as where worktrees belong for a project, wt asks for it
 * itself through an attached call.
 */
import {
	runAttached,
	runCommand,
	type AttachedRunner,
	type CommandResult,
	type CommandRunner,
} from './process.js';

export type WtOptions = Readonly<{
	wtPath?: string;
	run?: CommandRunner;
	attach?: AttachedRunner;
	env?: NodeJS.ProcessEnv;
}>;

export type HookType = 'pre-start' | 'post-start';

/**
 * The first `wt switch` in a project, with the terminal attached so wt's own
 * worktree-path question reaches the user.
 */
export async function switchAttached(
	projectDirectory: string,
	branch: string,
	options: WtOptions = {},
): Promise<number> {
	return attach(options)(
		wtPath(options),
		['-C', projectDirectory, 'switch', branch],
		{env: options.env},
	);
}

/**
 * Creates the setup worktree. `--no-hooks` is mandatory: the config being
 * written has not been approved yet, and the hooks would otherwise run against
 * a half-configured repository.
 */
export async function switchCreateAttached(
	projectDirectory: string,
	branch: string,
	options: WtOptions = {},
): Promise<number> {
	return attach(options)(
		wtPath(options),
		['-C', projectDirectory, 'switch', '--create', branch, '--no-hooks'],
		{env: options.env},
	);
}

/** Undoes {@link switchCreateAttached}; also the rollback path's first step. */
export async function remove(
	projectDirectory: string,
	branch: string,
	options: WtOptions = {},
): Promise<CommandResult> {
	return run(options)(
		wtPath(options),
		['-C', projectDirectory, 'remove', branch, '--no-hooks', '--yes'],
		{env: options.env},
	);
}

/** Interactive by design: the user is approving commands that will run. */
export async function approvalsAdd(
	worktreePath: string,
	options: WtOptions = {},
): Promise<number> {
	return attach(options)(
		wtPath(options),
		['-C', worktreePath, 'config', 'approvals', 'add'],
		{env: options.env},
	);
}

/**
 * Runs one hook as the smoke test. Attached, because post-start starts a real
 * dev server and prints where it is listening.
 */
export async function runHook(
	worktreePath: string,
	hook: HookType,
	options: WtOptions = {},
): Promise<number> {
	return attach(options)(wtPath(options), ['-C', worktreePath, 'hook', hook], {
		env: options.env,
	});
}

/** Where wt writes a failed hook's output, for the message after a failure. */
export function hookLogPath(
	projectDirectory: string,
	branch: string,
	hook: HookType,
): string {
	return `${projectDirectory}/.git/wt/logs/${sanitizeBranch(
		branch,
	)}/project/${hook}/`;
}

/** Worktrunk's own branch-to-path rule, used for log paths and warnings. */
export function sanitizeBranch(branch: string): string {
	return branch.replaceAll('/', '-');
}

function wtPath(options: WtOptions): string {
	return options.wtPath ?? 'wt';
}

function run(options: WtOptions): CommandRunner {
	return options.run ?? runCommand;
}

function attach(options: WtOptions): AttachedRunner {
	return options.attach ?? runAttached;
}
