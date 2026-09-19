/**
 * The command line surface: the help text and every flag trunk accepts. It is
 * kept apart from `cli.tsx` so tests can parse an argument list without running
 * a command, and so the help text stays the single description of the CLI.
 */
import process from 'node:process';
import meow, {type TypedFlags} from 'meow';
import {trunkVersion} from './version.js';

/** Printed for `trunk-cli` with no command and for `--help`. */
export const helpText = `
	Usage
	  $ trunk-cli clone <url> [dir]   set up a bare-layout project from a remote
	  $ trunk-cli init [dir]          set up an existing bare-layout project
	  $ trunk-cli docs                browse the offline documentation

	Options
	  --yes                 accept the defaults, no form (needed without a TTY)
	  --prefix <name>       tmux session prefix
	  --agents <a,b>        up to 4 installed agents of claude,codex,opencode,copilot,antigravity,pi
	  --tmux/--no-tmux      tmux session hooks
	  --copy/--no-copy      wt step copy-ignored
	  --mc/--no-mc          \`wt mc\` alias
	  --direct              commit on the current branch instead of chore/trunk-setup
`;

/** Declaring every flag makes an unknown one an error rather than a no-op. */
export const flagDefinitions = {
	yes: {
		type: 'boolean',
	},
	prefix: {
		type: 'string',
	},
	agents: {
		type: 'string',
	},
	tmux: {
		type: 'boolean',
	},
	// Named for the wt step it controls, but spelled `--copy` on the command line.
	copyIgnored: {
		type: 'boolean',
		alias: 'copy',
	},
	mc: {
		type: 'boolean',
	},
	direct: {
		type: 'boolean',
	},
} as const;

export type CliFlags = TypedFlags<typeof flagDefinitions>;

export function parseArguments(
	argv: readonly string[] = process.argv.slice(2),
) {
	return meow(helpText, {
		importMeta: import.meta,
		argv,
		version: trunkVersion(),
		// Booleans stay tri-state: a flag that was never passed reads as
		// `undefined`, which is how the setup form tells "leave it to me" apart
		// from an explicit `--no-server`.
		booleanDefault: undefined,
		allowUnknownFlags: false,
		// Help is drawn by trunk itself, so a terminal gets the styled screen.
		autoHelp: false,
		flags: {...flagDefinitions, help: {type: 'boolean', alias: 'h'}},
	});
}
