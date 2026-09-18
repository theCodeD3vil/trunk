/**
 * Worktrunk wrappers. Every call here is attached: it borrows trunk's terminal
 * so wt can ask its own questions and the user can see its output.
 *
 * trunk never writes to the user's worktrunk config. When wt needs to know
 * something, such as where worktrees belong for a project, wt asks for it
 * itself through an attached call.
 */
import {runAttached, type AttachedRunner} from './process.js';

export type WtOptions = Readonly<{
	wtPath?: string;
	attach?: AttachedRunner;
	env?: NodeJS.ProcessEnv;
}>;

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

function wtPath(options: WtOptions): string {
	return options.wtPath ?? 'wt';
}

function attach(options: WtOptions): AttachedRunner {
	return options.attach ?? runAttached;
}
