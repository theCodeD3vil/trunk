# trunk

`trunk` creates a shared [Worktrunk](https://worktrunk.dev) configuration for a Git repository. It detects the package manager and development script, generates worktree hooks for dependencies and a development server, and can add optional tmux workspaces and Caddy routes. The generated `.config/wt.toml` is committed with the project so every contributor gets the same workflow.

`trunk` is a setup tool, not a worktree manager. It does not write global Worktrunk configuration and does not manage the project after setup; use `wt` and edit the generated file directly from then on.

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

| Tool                                              | Requirement                                           |
| ------------------------------------------------- | ----------------------------------------------------- |
| Node.js                                           | 20 or newer                                           |
| Git                                               | Required                                              |
| Worktrunk (`wt`)                                  | Required; generated templates are tested with v0.77.0 |
| tmux                                              | Optional; creates one workspace per worktree          |
| Caddy and curl                                    | Optional; creates a stable local URL per worktree     |
| GitHub CLI (`gh`)                                 | Optional; creates repositories and pull requests      |
| claude, codex, opencode, copilot, antigravity, pi | Optional; started in tmux when selected               |

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

Run project commands inside a worktree such as `storefront/main`, not in `storefront`. `trunk clone` and `trunk new` create this layout. `trunk init` adopts an existing bare-layout project and deliberately refuses to rewrite an ordinary clone in place.

## Commands

### Clone

Clone an existing remote into the bare layout and commit the generated configuration on `chore/trunk-setup`:

```sh
trunk clone git@github.com:acme/storefront.git ~/Projects/storefront
```

### Init

Set up an existing bare-layout project, whether it was cloned by hand or already uses Worktrunk:

```sh
trunk init ~/Projects/storefront
```

### New

Create a new bare-layout project and, optionally, its GitHub repository:

```sh
trunk new api-service ~/Projects/api-service --remote --owner acme
```

For a fully local project:

```sh
trunk new scratch-app --no-remote --yes
```

## Options

| Option                     | Effect                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `--yes`                    | Accept detected defaults without opening the form; required without a TTY                       |
| `--prefix <name>`          | Set the tmux session prefix                                                                     |
| `--pm <npm\|pnpm\|bun>`    | Set the package manager                                                                         |
| `--agents <a,b>`           | Select up to four agents from `claude`, `codex`, `opencode`, `copilot`, `antigravity`, and `pi` |
| `--server` / `--no-server` | Enable or disable the development-server step                                                   |
| `--caddy` / `--no-caddy`   | Enable or disable the Caddy route                                                               |
| `--tmux` / `--no-tmux`     | Enable or disable tmux session hooks                                                            |
| `--copy` / `--no-copy`     | Enable or disable `wt step copy-ignored`                                                        |
| `--mc` / `--no-mc`         | Enable or disable the `wt mc` merge alias                                                       |
| `--direct`                 | Commit on the current branch instead of `chore/trunk-setup`                                     |
| `--remote` / `--no-remote` | With `trunk new`, create or skip the GitHub repository                                          |
| `--owner <name>`           | With `trunk new`, choose the GitHub user or organization                                        |
| `--public`                 | With `trunk new`, create a public repository instead of a private one                           |

Run `trunk --help` for the same command surface in the terminal.

## What It Generates

The generated `.config/wt.toml` can contain:

- `wt up`, `wt url`, and `wt mc` aliases;
- pre-start hooks for tmux and the local URL;
- post-start hooks for copied ignored files, dependency installation, the development server, and Caddy;
- pre-remove cleanup for tmux processes and Caddy routes;
- a stable URL shown by `wt list`.

The file is normal project configuration, not generated code that must remain untouched. Review and edit it for the repository's real commands. See the [annotated generated configuration](https://github.com/theCodeD3vil/trunk/blob/main/docs/generated-config.md) for the complete lifecycle and the reasons behind the less obvious template expressions.

Worktrunk treats project hooks as trusted code. Run `wt config approvals add` after reviewing a new file, and run it again whenever `.config/wt.toml` changes.

## Development

```sh
bun install --frozen-lockfile
bun run build
bun run test
```

`bun run build` creates a clean `dist/` and stamps the package version into the compiled CLI. The published package runs on Node.js; the test suite and CI exercise that runtime explicitly.

## Releasing

Releases are published by hand, never by CI, so the npm credentials stay on one machine:

```sh
git checkout main && git pull
bun run release            # or: bun run release minor
```

That runs [`np`](https://github.com/sindresorhus/np), which verifies the branch and working
tree, reinstalls from `bun.lock`, runs the tests, bumps the version, commits, tags, pushes,
publishes, and opens a GitHub release draft. `bun run release -- --dry-run` shows every step
without performing any of them.

Releases happen on `main` because that is the published history. `np` tags the commit it
creates, and a tag only means something if that commit is reachable from `main` — squashing
or rebasing a release made on a side branch leaves the tag pointing at history that never
shipped. After releasing, merge `main` back into the working branch to pick up the version
bump.

## License

MIT
