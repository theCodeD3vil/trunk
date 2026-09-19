/**
 * The "Config Basics" topic: how a project's `.config/wt.toml` works and how to
 * extend what Trunk generated. It is stack-neutral on purpose; anything that
 * names a language or tool lives in its own topic.
 */
import {list, shell, text, toml} from './blocks.js';
import type {Topic} from './types.js';

export const configBasics: Topic = Object.freeze({
	id: 'config-basics',
	title: 'Config Basics',
	summary: 'What Trunk generates, and how to add your own hooks to it.',
	sections: Object.freeze([
		{
			id: 'what-trunk-generates',
			title: 'What Trunk generates',
			blocks: [
				text(
					"Trunk writes one file: .config/wt.toml at the root of your repository. It is Worktrunk's project configuration, committed to git so everyone who works on the repository gets the same worktree automation. Trunk keeps it language-agnostic: it sets up the worktree experience and does not know, detect or configure what your project is built with.",
				),
				text('The generated file contains:'),
				list(
					'a header that says where the file came from, how to approve its hooks, and which per-machine tmux overrides exist;',
					'aliases: `up` runs the start hooks again, and `mc` merges with a commit message you write in your editor;',
					'a pre-start pipeline: optionally `wt step copy-ignored`, then a tmux session with an Editor window, a two-pane Terminal window and, if you picked agents, an Agents window;',
					'pre-remove and post-remove hooks that ask what runs in the session to exit, then close it.',
				),
				toml(
					'Shape of the generated file',
					`[aliases]
up = "wt hook pre-start"

[[pre-start]]
tmux = '''
# ...creates the tmux session...
'''

[pre-remove]
tmux = '''
# ...asks the session's processes to exit...
'''

[post-remove]
tmux = '''
# ...closes the session...
'''`,
					'standalone',
				),
				text(
					'Trunk only rewrites the file if you ask: `trunk-cli init` shows a diff and waits for your confirmation, and `--yes` always keeps the file that is there. Everything else in it is yours to edit.',
				),
				text(
					"Personal settings, such as where worktrees are created, how commit messages are generated, or hooks only you want, belong in Worktrunk's user config, ~/.config/worktrunk/config.toml. Trunk never writes to it. See https://worktrunk.dev/config/.",
				),
			],
		},
		{
			id: 'hook-lifecycle',
			title: 'Hook lifecycle',
			blocks: [
				text(
					'Worktrunk runs hooks at five points in the life of a worktree. Each point has a pre- hook, which blocks and cancels the operation if it fails, and a post- hook, which runs in the background.',
				),
				list(
					'switch: pre-switch, post-switch',
					'start, when a worktree is created: pre-start, post-start',
					'commit: pre-commit, post-commit',
					'merge: pre-merge, post-merge',
					'remove: pre-remove, post-remove',
				),
				text(
					'Trunk uses three of them. pre-start runs once when a worktree is created and finishes before anything after it begins, which is why the tmux session is created there: setup you add above it is done by the time the session opens. pre-remove runs in the worktree that is about to be deleted. post-remove runs in the primary worktree afterwards, so it can rely on template variables but not on the removed directory.',
				),
				text(
					'Background hooks write their output to log files instead of the terminal. Run one in the foreground to watch it.',
				),
				shell(
					'Inspect and run hooks',
					`wt hook show                    # every configured hook
wt hook show --expanded         # with templates filled in
wt hook pre-start               # run the start hooks now
wt hook post-start --foreground # run a background hook in the terminal`,
				),
				text(
					'`wt up`, the alias Trunk generates, is a shortcut for running the pre-start hooks again. It helps in a worktree that predates the config, or whose tmux session you closed.',
				),
			],
		},
		{
			id: 'pipelines',
			title: 'Ordering and pipelines',
			keywords: ['concurrency', 'concurrent', 'parallel'],
			blocks: [
				text(
					'A hook takes one of three shapes, decided by its TOML form. A string is a single command. A table of named commands runs them concurrently. A pipeline is a sequence of double-bracket blocks such as [[pre-start]] that run one after another; keys inside one block run concurrently, and a failing block stops the rest.',
				),
				toml(
					'A single command and a table of concurrent commands',
					`# A single command.
pre-commit = "make lint"

# Named commands that run together.
[post-start]
watch = "make watch"
docs = "make docs"`,
					'standalone',
				),
				toml(
					'An ordered pipeline',
					`# seed starts only after setup has finished.
[[post-start]]
setup = "./scripts/setup.sh"

[[post-start]]
seed = "./scripts/seed.sh"`,
					'append',
				),
				text(
					"Trunk's file already writes pre-start as a pipeline, and that is what lets you add your own. A second [pre-start] table would be invalid TOML, and a table cannot be mixed with double-bracket blocks for the same hook, so always write [[pre-start]] and put the block where its order matters. Blocks run in file order: place one above Trunk's tmux block if it must finish before the session opens, below it if it can wait.",
				),
				toml(
					'Runs before the tmux session opens',
					`[[pre-start]]
setup = "./scripts/setup.sh"`,
					'before-tmux',
				),
				text(
					'post-remove is different: Trunk generates it as a table, so add your key inside that table instead of declaring [post-remove] again. If the file has no [post-remove] table because tmux is off, write the header yourself.',
				),
				toml(
					'Add inside the existing [post-remove] table',
					'cleanup = "./scripts/cleanup.sh"',
					{table: 'post-remove'},
				),
			],
		},
		{
			id: 'templates',
			title: 'Templates',
			blocks: [
				text(
					'Commands are templates: {{ ... }} expressions are filled in when the hook runs. Worktrunk shell-escapes every value, so you do not add quotes around them.',
				),
				list(
					'`{{ branch }}`: the branch the operation acts on',
					'`{{ worktree_path }}`: the worktree directory',
					'`{{ remote_repo }}`: the repository name from the origin remote, without .git',
					'`{{ repo }}`: the repository directory name; in a bare layout this is `.git`, so prefer remote_repo',
					'`{{ default_branch }}`: the default branch, such as main',
				),
				text('Filters transform a value:'),
				list(
					'`sanitize` replaces `/` with `-`, so feature/login is safe in a name',
					'`lower` lowercases a value',
					'`hash_port` turns a string into a stable port from 10000 to 19999',
				),
				toml(
					'Templates in an alias',
					'branch-log = "git log --oneline {{ default_branch }}..{{ branch }}"',
					{table: 'aliases'},
				),
				text(
					// eslint-disable-next-line no-template-curly-in-string -- shows shell syntax.
					'Two cautions. Undefined variables are errors, so guard optional ones with {% if upstream %} ... {% endif %}. And the shell has its own syntax: the sequence ${# would open a template comment, so avoid shell length expansion such as ${#name} in a hook body.',
				),
				text(
					'`wt hook show --expanded` prints every hook with its templates filled in for the current worktree, the quickest way to check a fragment you just added.',
				),
			],
		},
		{
			id: 'approvals',
			title: 'Approvals',
			blocks: [
				text(
					"Worktrunk never runs a project's hooks or aliases until you have approved them: the commands in .config/wt.toml are shell code that arrived with the repository. The first time a command would run, Worktrunk shows it and asks.",
				),
				list(
					'`wt config approvals add` reviews and approves every command in the current project.',
					'An approval is stored on your machine, not in the repository, so each teammate approves once.',
					'When a command changes it needs approval again, so run the same command after you edit the file.',
					"Declining skips all of the project's commands for that operation, including ones you approved earlier.",
				),
				text(
					'Trunk offers to run `wt config approvals add` after `trunk-cli clone` and `trunk-cli init`, and never approves anything itself. The `--yes` flag on wt commands skips the prompt; keep it for CI, where the contents of the file are already controlled.',
				),
				shell(
					'Review and approve',
					`wt config approvals add
wt config approvals list`,
				),
			],
		},
		{
			id: 'aliases',
			title: 'Aliases',
			blocks: [
				text(
					'Aliases are project commands run as `wt <name>`. Trunk generates `up` and, unless you turned it off, `mc`.',
				),
				list(
					'`wt up` runs `wt hook pre-start` again for the current worktree.',
					'`wt mc` runs `wt merge` and opens your editor for the commit message.',
					'Aliases share the template engine with hooks, so {{ branch }} works, and extra arguments arrive as {{ args }}.',
				),
				text(
					'Add your own inside the existing [aliases] table; a second [aliases] header would be invalid TOML.',
				),
				toml(
					'Add inside the existing [aliases] table',
					`hello = "echo hello from {{ branch }}"
say = "echo {{ args }}"`,
					{table: 'aliases'},
				),
				text(
					'An alias with several steps uses [[aliases.name]] blocks, with the same ordering rules as hooks.',
				),
				toml(
					'A multi-step alias',
					`[[aliases.release]]
check = "make check"

[[aliases.release]]
package = "make package"`,
					'append',
				),
				shell(
					'Check an alias without running it',
					`wt config alias show up
wt config alias dry-run up`,
				),
			],
		},
		{
			id: 'custom-hooks',
			title: 'Adding your own hooks',
			blocks: [
				list(
					'1. Pick the hook by when it should run: a pre- hook when later steps depend on it, a post- hook for background work.',
					'2. Write it as a double-bracket block and place it where its order matters.',
					'3. Use templates for anything that differs per worktree, then run `wt hook show --expanded` to read the result.',
					'4. Try it: `wt hook pre-start` runs the start hooks, and `wt switch --create try-hooks` makes a scratch worktree.',
					'5. Commit the file and ask teammates to run `wt config approvals add` again.',
				),
				toml(
					'A commented custom hook',
					`# Prepares local files once per worktree, before the tmux session opens.
[[pre-start]]
prepare = "./scripts/prepare.sh"`,
					'before-tmux',
				),
				shell(
					'Try it',
					`wt hook show --expanded
wt switch --create try-hooks`,
				),
				text(
					"Comment why each hook exists, because the whole team reads the file, and be careful with commands that delete data or download and run scripts: teammates approve them without seeing your intent. Setup that belongs to a particular language, such as installing dependencies or starting a dev server, is what the other topics' fragments are for.",
				),
			],
		},
		{
			id: 'further-reading',
			title: 'Further reading',
			blocks: [
				text(
					"Worktrunk's own documentation covers everything beyond the project file:",
				),
				list(
					'Personal and global configuration, including worktree paths and commit messages: https://worktrunk.dev/config/',
					'Every hook, template variable and filter: https://worktrunk.dev/hook/',
					'Aliases and custom subcommands: https://worktrunk.dev/extending/',
					'Recipes and patterns: https://worktrunk.dev/tips-patterns/',
				),
			],
		},
	]),
});
