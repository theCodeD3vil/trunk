/**
 * Publishing the setup branch. `gh` is optional throughout: without it, or
 * against a host it cannot speak to, trunk pushes and prints the compare URL
 * so the user can open the pull request themselves.
 */
import {runCommand, type CommandResult, type CommandRunner} from './process.js';
import type {ParsedRemote, SshAliases} from './repo.js';

export type GhOptions = Readonly<{
	ghPath?: string;
	gitPath?: string;
	run?: CommandRunner;
	env?: NodeJS.ProcessEnv;
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

export async function pushBranch(
	worktreePath: string,
	branch: string,
	options: GhOptions = {},
): Promise<CommandResult> {
	return (options.run ?? runCommand)(
		options.gitPath ?? 'git',
		['-C', worktreePath, 'push', '-u', 'origin', branch],
		{env: options.env},
	);
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
		{cwd: worktreePath, env: options.env},
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

export type RepositoryOwner = Readonly<{login: string; kind: 'user' | 'org'}>;

/**
 * The accounts a repository can be created under: the signed-in user first,
 * then the organisations they belong to. An empty list means gh could not
 * answer, which the caller treats as "ask for the owner instead of guessing".
 */
export async function listOwners(
	options: GhOptions = {},
): Promise<readonly RepositoryOwner[]> {
	const run = options.run ?? runCommand;
	const gh = options.ghPath ?? 'gh';
	const [user, orgs] = await Promise.all([
		run(gh, ['api', 'user', '--jq', '.login'], {env: options.env}),
		run(gh, ['api', 'user/orgs', '--jq', '.[].login'], {env: options.env}),
	]);

	const owners: RepositoryOwner[] = [];
	const login = user.code === 0 ? user.stdout.trim() : '';
	if (login) {
		owners.push(Object.freeze({login, kind: 'user'}));
	}

	if (orgs.code === 0) {
		for (const line of orgs.stdout.split(/\r?\n/)) {
			const value = line.trim();
			if (value) {
				owners.push(Object.freeze({login: value, kind: 'org'}));
			}
		}
	}

	return Object.freeze(owners);
}

/** Which account gh would act as, for the confirmation and for auth errors. */
export async function activeAccount(
	options: GhOptions = {},
): Promise<string | undefined> {
	const result = await (options.run ?? runCommand)(
		options.ghPath ?? 'gh',
		['api', 'user', '--jq', '.login'],
		{env: options.env},
	);
	return result.code === 0 ? result.stdout.trim() || undefined : undefined;
}

/**
 * Creates the repository and nothing else: no push, no clone, no source. trunk
 * builds the local side itself, so gh only has to make the remote exist.
 */
export async function createRepository(
	owner: string,
	name: string,
	options: GhOptions & {visibility?: 'private' | 'public'} = {},
): Promise<CommandResult> {
	return (options.run ?? runCommand)(
		options.ghPath ?? 'gh',
		[
			'repo',
			'create',
			`${owner}/${name}`,
			`--${options.visibility ?? 'private'}`,
			'--disable-wiki',
		],
		{env: options.env},
	);
}

/** What to run by hand; trunk never deletes a remote repository itself. */
export function deleteRepositoryCommand(owner: string, name: string): string {
	return `gh repo delete ${owner}/${name} --yes`;
}

/**
 * The SSH URL to use for a new remote. gh reports an https URL, but someone
 * with several accounts reaches each through its own ssh alias, so the alias
 * whose resolved host matches is preferred — and among those, one a sibling
 * project already uses, since that is demonstrably the right account.
 */
export function sshRemoteUrl(
	owner: string,
	name: string,
	options: Readonly<{
		realHost: string;
		aliases: SshAliases;
		siblingHosts?: readonly string[];
	}>,
): string {
	const {realHost, aliases, siblingHosts = []} = options;
	const matching = Object.entries(aliases)
		.filter(([, hostName]) => hostName.toLowerCase() === realHost.toLowerCase())
		.map(([alias]) => alias);
	const preferred =
		matching.find(alias => siblingHosts.includes(alias)) ?? matching[0];
	return `git@${preferred ?? realHost}:${owner}/${name}.git`;
}
