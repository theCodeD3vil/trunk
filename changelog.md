# Changelog

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
