/* eslint-disable unicorn/filename-case -- Phase 5 specifies tmuxRename.ts. */
/**
 * Renaming live tmux sessions after a prefix change. Sessions are named
 * `<prefix>_<branch>`, so changing the prefix without renaming them leaves
 * sessions that `wt remove` can no longer find.
 *
 * Every target is matched exactly. A session belonging to another project that
 * merely starts with the same letters is never touched, and neither is one
 * whose name matches the prefix but has no branch after it.
 */
import {runCommand, type CommandRunner} from './process.js';

export type SessionRename = Readonly<{from: string; to: string}>;

export type RenameOptions = Readonly<{
	tmuxPath?: string;
	run?: CommandRunner;
	env?: NodeJS.ProcessEnv;
	/** For tests: an isolated tmux server, as in `tmux -L trunk-test`. */
	socketName?: string;
}>;

export type RenameResult = Readonly<{
	renamed: readonly SessionRename[];
	failed: readonly SessionRename[];
}>;

/**
 * Which sessions a prefix change affects. Pure, so the list can be shown to the
 * user before anything is renamed.
 */
export function planRenames(
	sessionNames: readonly string[],
	oldPrefix: string,
	newPrefix: string,
): readonly SessionRename[] {
	if (!oldPrefix || oldPrefix === newPrefix) {
		return Object.freeze([]);
	}

	const start = `${oldPrefix}_`;
	return Object.freeze(
		sessionNames
			.filter(name => name.startsWith(start) && name.length > start.length)
			.map(name =>
				Object.freeze({
					from: name,
					to: `${newPrefix}_${name.slice(start.length)}`,
				}),
			),
	);
}

/** The sessions tmux currently knows about, or none when tmux is not running. */
export async function listSessions(
	options: RenameOptions = {},
): Promise<readonly string[]> {
	const result = await run(options)(
		tmuxPath(options),
		[...socket(options), 'list-sessions', '-F', '#{session_name}'],
		{env: options.env},
	);
	if (result.code !== 0) {
		return Object.freeze([]);
	}

	return Object.freeze(
		result.stdout
			.split(/\r?\n/)
			.map(line => line.trim())
			.filter(Boolean),
	);
}

/** Renames each session, reporting which ones tmux refused. */
export async function renameSessions(
	renames: readonly SessionRename[],
	options: RenameOptions = {},
): Promise<RenameResult> {
	const renamed: SessionRename[] = [];
	const failed: SessionRename[] = [];
	for (const rename of renames) {
		// Renames must not race each other on the same tmux server.
		// eslint-disable-next-line no-await-in-loop
		const result = await run(options)(
			tmuxPath(options),
			[
				...socket(options),
				'rename-session',
				'-t',
				// The `=` prefix is an exact match; without it tmux would accept a
				// unique prefix and could rename the wrong session.
				`=${rename.from}`,
				rename.to,
			],
			{env: options.env},
		);
		if (result.code === 0) {
			renamed.push(rename);
		} else {
			failed.push(rename);
		}
	}

	return Object.freeze({
		renamed: Object.freeze(renamed),
		failed: Object.freeze(failed),
	});
}

/** What to run by hand when a rename failed and the session is stranded. */
export function manualKillCommands(
	failed: readonly SessionRename[],
): readonly string[] {
	return Object.freeze(
		failed.map(rename => `tmux kill-session -t '=${rename.from}'`),
	);
}

function socket(options: RenameOptions): readonly string[] {
	return options.socketName ? ['-L', options.socketName] : [];
}

function tmuxPath(options: RenameOptions): string {
	return options.tmuxPath ?? 'tmux';
}

function run(options: RenameOptions): CommandRunner {
	return options.run ?? runCommand;
}
