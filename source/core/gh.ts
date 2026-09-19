/**
 * Publishing the setup branch. `gh` is optional throughout: without it, or
 * against a host it cannot speak to, trunk pushes and prints the compare URL
 * so the user can open the pull request themselves. It is only ever used for
 * that optional pull request; trunk never creates repositories.
 */
import {runCommand, type CommandResult, type CommandRunner} from './process.js';
import type {ParsedRemote} from './repo.js';

export type GhOptions = Readonly<{
	ghPath?: string;
	gitPath?: string;
	run?: CommandRunner;
	env?: NodeJS.ProcessEnv;
	/** Stops the command, for a Ctrl+C while it waits on the network. */
	signal?: AbortSignal;
}>;

/**
 * `gh` only authenticates against GitHub, so an SSH alias is resolved to its
 * real host before deciding. A non-GitHub remote still gets a push and a URL.
 */
export function canOpenPullRequest(
	remote: ParsedRemote,
	ghInstalled: boolean,
): boolean {
	return (
		ghInstalled && remote.kind === 'hosted' && remote.realHost === 'github.com'
	);
}

/** Where the user opens the pull request when trunk cannot do it for them. */
export function compareUrl(
	remote: ParsedRemote,
	branch: string,
): string | undefined {
	if (remote.kind !== 'hosted') {
		return undefined;
	}

	return `https://${remote.realHost}/${remote.owner}/${
		remote.repo
	}/compare/${encodeURIComponent(branch)}?expand=1`;
}

/**
 * `--fill` reuses the commit message, which is why the commit body is written
 * for teammates: it becomes the pull request description.
 */
export async function createPullRequest(
	worktreePath: string,
	options: GhOptions = {},
): Promise<CommandResult> {
	return (options.run ?? runCommand)(
		options.ghPath ?? 'gh',
		['pr', 'create', '--fill'],
		{cwd: worktreePath, env: options.env, signal: options.signal},
	);
}

/** The two commands trunk prints when it stops after the commit. */
export function publishCommands(
	branch: string,
	withPullRequest: boolean,
): readonly string[] {
	const commands = [`git push -u origin ${branch}`];
	if (withPullRequest) {
		commands.push('gh pr create --fill');
	}

	return Object.freeze(commands);
}
