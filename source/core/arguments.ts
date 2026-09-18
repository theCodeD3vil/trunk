/**
 * The command line surface: the help text and every flag trunk accepts. It is
 * kept apart from `cli.tsx` so tests can parse an argument list without running
 * a command, and so the help text stays the single description of the CLI.
 */
import process from 'node:process';
import meow, {type TypedFlags} from 'meow';

/** Printed for `trunk` with no command and for `--help`. */
export const helpText = `
	Usage
	  $ trunk clone <url> [dir]   set up a bare-layout project from a remote
	  $ trunk init [dir]          set up an existing bare-layout project
	  $ trunk new <name>          create a new project (optionally on GitHub)

	Options
	  --yes                 accept detected defaults, no form (needed without a TTY)
	  --prefix <name>       tmux session prefix
	  --pm <npm|pnpm|bun>   package manager
	  --agents <a,b>        up to 4 of claude,codex,opencode,copilot,antigravity,pi
	  --server/--no-server  dev server step
	  --caddy/--no-caddy    Caddy route step
	  --tmux/--no-tmux      tmux session hooks
	  --copy/--no-copy      wt step copy-ignored
	  --mc/--no-mc          \`wt mc\` alias
	  --direct              commit on the current branch instead of chore/trunk-setup

	Options for \`trunk new\`
	  --remote/--no-remote  create the GitHub repository too
	  --owner <name>        account or organisation that owns it
	  --public              create it public instead of private
`;

/**
 * Every flag is declared here even when a later phase is what reads it, so that
 * an unknown flag is always an error rather than silently ignored.
 */
export const flagDefinitions = {
	yes: {
		type: 'boolean',
	},
	prefix: {
		type: 'string',
	},
	pm: {
		type: 'string',
	},
	agents: {
		type: 'string',
	},
	server: {
		type: 'boolean',
	},
	caddy: {
		type: 'boolean',
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
	// `trunk new` only.
	remote: {
		type: 'boolean',
	},
	owner: {
		type: 'string',
	},
	public: {
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
		// Booleans stay tri-state: a flag that was never passed reads as
		// `undefined`, which is how the setup form tells "leave it to me" apart
		// from an explicit `--no-server`.
		booleanDefault: undefined,
		allowUnknownFlags: false,
		flags: flagDefinitions,
	});
}
