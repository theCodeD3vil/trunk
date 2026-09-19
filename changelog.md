# Changelog

## Unreleased

`trunk` is now language-agnostic. It configures the worktree experience and no longer models a project's stack. This release is breaking; it is expected to ship as 0.2.0.

### Added

- `trunk docs`, an offline interactive documentation browser bundled with the package. It has two topics, Config Basics and Node, with live search, scrolling, and copyable snippets. Without a terminal that can read keys it exits with status 2.
- `trunk init` support for a bare-layout project that has no origin remote. The project directory's name seeds the suggested prefix, and the local merge command is printed instead of a pull request.
- `trunk init` refuses an empty bare repository instead of creating history in it.
- A highlighted diff before an interactive overwrite of an existing `.config/wt.toml`.
- `bun run smoke`, which packs the tarball, installs it as an npm consumer, and exercises the installed CLI on throwaway repositories.

### Changed

- The terminal UI is redesigned as one continuous screen: a welcome, a setup form with a live preview of the hooks it will generate, a review that gates everything, named running steps with timings, a result card with the next commands, a numbered diff before overwriting an existing config, and cards for failures and refusals. `trunk docs` is now a two-pane browser with a sidebar.
- Interactive `clone` and `init` ask for consent once, at the review, and never commit before it. The result card asks whether to push, and the answer starts on "Not now".
- The screens honour `NO_COLOR`, `TRUNK_ASCII=1`, and `TRUNK_THEME`, fall back to ASCII on a Linux console or non-UTF-8 locale, and lay out to 104 columns, with two panes from 100.
- The interactive path runs Git and Worktrunk quietly so nothing scrolls through the screen; the `--yes` and non-terminal paths are unchanged.
- The generated `.config/wt.toml` contains only worktree concerns: a generic header, `up` and `mc` aliases, an ordered `pre-start` pipeline (optional `wt step copy-ignored`, then tmux), a `pre-remove` that asks pane processes to exit and force-stops stragglers, and a `post-remove` that closes exactly that tmux session. It has no dependency, server, port, proxy, or framework content, live or commented.
- The setup form and flags cover only the prefix, tmux, agents, `copy-ignored`, and `mc`. Defaults are tmux on, no agents, `copy-ignored` off, and `mc` on.
- Agents can only be selected when they are installed, and `--no-tmux` together with `--agents` is a usage error.
- Trunk no longer clears inherited AI-agent environment variables when it creates a tmux session.
- After validation, `clone` and `init` offer only `wt config approvals add` and point at `wt up`; they never run a hook.
- Under `--yes`, an existing `.config/wt.toml` is kept byte for byte. Trunk never reads values out of an old file.

### Removed

- `trunk new`, and the `--remote`, `--owner`, and `--public` flags. Trunk no longer creates projects or GitHub repositories; GitHub is used only to open an optional pull request for the setup branch.
- Package-manager, lockfile, and app-directory detection, and the `--pm`, `--server`, and `--caddy` flags with their form fields.
- The install, dev-server, port, Caddy route, and `wt list` URL hooks, and the `url` alias.
- Caddy and Homebrew probing.
- Adoption of values from an existing config, and tmux session renaming when the prefix changes.
- The hook smoke test that ran real hooks after setup.

### Fixed

- Interactive screens, `trunk docs` and the setup form, now draw immediately when the environment looks like CI, for example a `CI` variable or a hosting vendor marker such as `VERCEL` exported in a shell profile. Ink treats such an environment as CI and draws nothing until the program exits, so the screen only appeared after Ctrl+C, when the command was already gone.
- A worktree that Worktrunk placed somewhere other than the proposed path is now found by its branch, so the generated file is written into the real setup worktree.
- Rolling back an interrupted run now removes the setup worktree even though it holds the uncommitted config, which `wt remove` otherwise refuses to do.

### Upgrading

- Nothing changes on disk until you run `trunk` again, and an existing `.config/wt.toml` keeps working with Worktrunk unchanged.
- To adopt the generic file, run `trunk init`, review the diff, and confirm. The old generated file is not carried over; re-add the install and server steps you want from `trunk docs`.
- Project-specific setup that used to be generated is now documented, not detected. See the Node topic in `trunk docs`.

## 0.1.0 - 2026-09-18

Initial public release.

### Added

- `trunk clone` for creating a bare-layout project from an existing remote.
- `trunk init` for adopting an existing bare-layout project and preserving recognized settings.
- `trunk new` for creating a local project and optionally its GitHub repository.
- Deterministic `.config/wt.toml` generation for npm, pnpm, and Bun projects.
- Optional tmux workspaces, development servers, Caddy routes, copied ignored files, agent panes, and Worktrunk aliases.
- Validation through Worktrunk plus ShellCheck coverage for every generated hook body.
- Keep-or-rollback recovery with a journal of local and remote resources.

### Compatibility

- Generated templates are tested against Worktrunk v0.77.0.
- The published CLI targets Node.js 20 and newer on macOS and Linux, including WSL.

### Acceptance Status

- Automated local generation, validation, rollback, Node runtime, and package checks are covered by the test suite.
- The credentialed pre-tag runs against real repositories, pull requests, tmux, Caddy, and GitHub remain pending. Record their results here before creating `v0.1.0`.
