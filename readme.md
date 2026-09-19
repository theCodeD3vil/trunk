# trunk

`trunk` sets a Git repository up for parallel work with [Worktrunk](https://worktrunk.dev). It clones or adopts a project into Worktrunk's bare layout and commits one shared, language-agnostic `.config/wt.toml`: a tmux workspace for every worktree, optional copying of ignored files, and a couple of convenience aliases.

`trunk` configures the worktree experience and then gets out of the way. It does not detect, choose, install, start, proxy, or otherwise model your project's stack, and it never writes global Worktrunk configuration. Stack-specific setup is manual, and `trunk docs` teaches it offline.

## Install

```sh
npm install --global @cod3vil/trunk
```

or:

```sh
bun add --global @cod3vil/trunk
```

The installed command is `trunk`. That name is also used by the Rust/Wasm `trunk` tool and by Trunk.io, so check `command -v trunk` if one of those is already installed.

## Prerequisites

| Tool                                              | Requirement                                                    |
| ------------------------------------------------- | -------------------------------------------------------------- |
| Node.js                                           | 20 or newer                                                    |
| Git                                               | Required                                                       |
| Worktrunk (`wt`)                                  | Required; generated templates are tested with v0.77.0          |
| tmux                                              | Optional; creates one workspace per worktree                   |
| GitHub CLI (`gh`)                                 | Optional; opens the pull request for the setup branch          |
| claude, codex, opencode, copilot, antigravity, pi | Optional; offered and started in tmux only when installed here |

macOS and Linux are supported, including Linux under WSL. Native Windows is not supported.

## Repository Layout

Worktrunk uses a bare repository with sibling worktrees. Before using `trunk`, understand that the project directory itself is not a checked-out branch:

```text
storefront/
  .git/                  bare repository and shared Git data
  main/                  default-branch worktree
  chore-trunk-setup/     temporary setup worktree, when needed
  feature-checkout/      another worktree created by wt
```

Run project commands inside a worktree such as `storefront/main`, not in `storefront`. `trunk clone` creates this layout. `trunk init` adopts an existing bare-layout project and deliberately refuses to rewrite an ordinary clone in place; it prints the steps to migrate one instead.

## Commands

`trunk` has three commands.

### Clone

Clone a remote into the bare layout and commit the generated configuration on `chore/trunk-setup`:

```sh
trunk clone git@github.com:acme/storefront.git ~/Projects/storefront
```

The branch is pushed, and a pull request opened when `gh` is installed, only when you answer yes to the question on the result card. It starts on "Not now", and nothing is pushed under `--yes`.

### Init

Set up an existing bare-layout project, whether it was cloned by hand, already uses Worktrunk, or never had a remote:

```sh
trunk init ~/Projects/storefront
```

Without an origin, `trunk init` uses the project directory's name for the suggested prefix and prints the local merge command instead of a pull request. It refuses an empty bare repository, because `trunk` never creates Git history.

If `.config/wt.toml` already exists, an interactive run shows a highlighted diff and replaces the file only after you confirm. A run with `--yes` keeps the existing file byte for byte. `trunk` never reads values out of an old file and never renames live tmux sessions.

### Docs

Browse the offline documentation:

```sh
trunk docs
```

`trunk docs` opens an interactive terminal browser with two topics, Config Basics and Node. The topics and their pages are listed in a sidebar; the left and right arrows step through the pages, the up and down arrows scroll, `/` searches, `c` copies a snippet, and `q` quits. Everything is bundled with the package, so it works without a checkout, a browser, or a network connection. It needs a terminal that can read keys and exits with status 2 otherwise.

## The Terminal Screens

In a terminal, `clone` and `init` are one continuous screen rather than a series of prompts:

1. A short form for whatever you did not pass as a flag. A preview beside it shows exactly the hooks your answers will produce, and updates as you type.
2. A review of what will be written and where. Nothing is created until you confirm it, and you can go back and edit.
3. The named steps running, each with its own detail and time.
4. A result card with the next commands to run, and the one question about pushing.

If `.config/wt.toml` already exists, the run pauses on a numbered diff. Keeping your file is the default. If something fails, a card says what went wrong, what the run created, and how to resume, and offers to keep the result or roll it back. Ctrl+C at a question cancels; during a run it stops after the current step, and a second press quits at once.

The screens use up to 104 columns. At 100 columns or more the form and the docs show two panes; below that they fold to one. They follow your terminal:

| Variable                      | Effect                                                                      |
| ----------------------------- | --------------------------------------------------------------------------- |
| `NO_COLOR`                    | Draw with bold, dim, and underline only, no colour                          |
| `TRUNK_ASCII=1`               | Use plain ASCII instead of box-drawing characters, as a Linux console needs |
| `TRUNK_THEME=light` or `dark` | Pick the palette; otherwise `COLORFGBG` decides, and dark is the default    |

Trunk switches to ASCII by itself on `TERM=linux`, `TERM=dumb`, and a locale that is not UTF-8. Without a terminal, or with `--yes`, none of this is used and the output is plain lines.

## Options

`clone` and `init` share these options. Without `--yes` they open a short form for whatever you did not pass.

| Option                 | Effect                                                                                             | Default                    |
| ---------------------- | -------------------------------------------------------------------------------------------------- | -------------------------- |
| `--yes`                | Accept the defaults without opening the form; required without a TTY                               |                            |
| `--prefix <name>`      | Set the tmux session prefix                                                                        | Initials of the repository |
| `--agents <a,b>`       | Up to four installed agents from `claude`, `codex`, `opencode`, `copilot`, `antigravity`, and `pi` | none                       |
| `--tmux` / `--no-tmux` | Enable or disable the tmux workspace hooks                                                         | on                         |
| `--copy` / `--no-copy` | Enable or disable `wt step copy-ignored` as the first start step                                   | off                        |
| `--mc` / `--no-mc`     | Enable or disable the `wt mc` merge alias                                                          | on                         |
| `--direct`             | Commit on the current branch instead of `chore/trunk-setup`                                        | off                        |

`--no-tmux` together with `--agents` is a usage error, and `--agents` only accepts agents that are installed on the machine. Run `trunk --help` for the same surface in the terminal.

## What It Generates

The generated `.config/wt.toml` contains only worktree concerns:

- a header with where the file came from, how to approve it, and the per-machine tmux overrides `WT_TMUX`, `WT_AGENTS`, and `WT_EDITOR`;
- `wt up`, which re-runs the start hooks, when there is a start hook to run, and `wt mc`;
- a `pre-start` pipeline: optionally `wt step copy-ignored`, then a tmux session with an Editor window, a two-pane Terminal window, and an Agents window only for agents you selected;
- `pre-remove` and `post-remove` hooks that ask the session's processes to exit and then close exactly that session.

It contains no dependency install, dev server, port, proxy, or framework content, not even in comments. The file is normal project configuration, not generated code that must remain untouched: edit it freely. The [annotated generated configuration](https://github.com/theCodeD3vil/trunk/blob/main/docs/generated-config.md) walks through every block and is checked against the generator in the test suite.

Worktrunk treats project hooks as trusted code. Run `wt config approvals add` after reviewing a new file, and run it again whenever `.config/wt.toml` changes. `trunk` shows it as a next step but never approves anything itself, and it never starts a hook. Run `wt up` when you are ready.

## Project-Specific Setup

Installing dependencies, starting a dev server, or routing a local URL is left to you, because only you know the project. `trunk docs` has copyable fragments for the common cases:

- **Config Basics** explains the file: hook lifecycle, pipelines and ordering, templates, approvals, aliases, and how to add your own hooks.
- **Node** has additive recipes for npm, pnpm, and Bun: dependency install, monorepo subfolders, a tethered dev server, and an optional Caddy route.

The fragments are added to the generated file; they do not replace it, and `trunk` does not detect your package manager for you.

## What It Does Not Do

- It does not detect package managers, lockfiles, scripts, or frameworks.
- It does not install dependencies, start servers, allocate ports, or configure proxies such as Caddy.
- It does not create projects, scaffold files, or create GitHub repositories.
- It does not write global Worktrunk configuration or approve hooks for you.
- It does not rewrite an existing `.config/wt.toml` without showing a diff and asking, and it does not convert an ordinary clone in place.

## Upgrading From 0.1.x

Version 0.1.x detected a package manager and generated install, dev-server, and Caddy hooks, and shipped `trunk new`. Those features are gone: `trunk new`, `--pm`, `--server`, `--caddy`, `--remote`, `--owner`, and `--public` are removed, and the old generated configuration is not carried over.

Nothing changes on disk until you run `trunk` again. An existing `.config/wt.toml` keeps working with Worktrunk exactly as before. To move to the generic file, run `trunk init` in the project, review the diff, and confirm; the install and server steps you want to keep can then be re-added from `trunk docs`.

## Development

```sh
bun install --frozen-lockfile
bun run build
bun run test
bun run smoke
```

`bun run build` creates a clean `dist/`. The published package runs on Node.js; `bun run smoke` packs the tarball, installs it the way an npm consumer would, and exercises the installed CLI on real repositories. The test suite drives a real Worktrunk, tmux, and ShellCheck, so all three must be installed.

## Releasing

Releases are published by hand from `main`, never by CI. See [docs/releasing.md](https://github.com/theCodeD3vil/trunk/blob/main/docs/releasing.md) for the checklist.

## License

MIT
