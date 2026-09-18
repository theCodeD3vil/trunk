import process from 'node:process';
import meow, {type TypedFlags} from 'meow';

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
`;

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
		booleanDefault: undefined,
		allowUnknownFlags: false,
		flags: flagDefinitions,
	});
}
