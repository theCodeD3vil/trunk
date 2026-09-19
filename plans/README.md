# trunk implementation plan

## Product boundary

Trunk is a language- and framework-agnostic generator for a repository's
`.config/wt.toml`. It configures the worktree experience, then gets out of the
way. It does not detect, choose, install, start, proxy, or otherwise model a
project's development stack.

- Trunk never writes global Worktrunk configuration.
- Generated configs contain no Node, package-manager, dev-server, port, Caddy,
  URL, or framework content, including comments.
- Stack-specific setup is manual and taught by the offline `trunk docs` browser.
- The initial documentation recipe supports Node only; it offers npm, pnpm, and
  Bun alternatives without detecting any of them.
- `trunk new` is out of scope. Trunk does not scaffold projects or create GitHub
  repositories.
- The public commands are `clone`, `init`, and `docs`.

## Generated configuration

The generated file manages only these shared worktree concerns:

- a concise generic header with provenance, approval guidance, and a `trunk docs`
  pointer;
- a tmux workspace: Editor, two-pane Terminal, and an Agents window only when
  agents were explicitly selected;
- optional `copy-ignored`, disabled by default and run as a blocking first
  `pre-start` step;
- `pre-remove` graceful pane-process shutdown and `post-remove` exact tmux
  session removal;
- `up`, when at least one Trunk-managed start hook exists, and the default-on
  `mc` merge alias.

The form and flags control only prefix, tmux, agents, copy-ignored, and `mc`.
Tmux defaults on; agents default to none; copy-ignored defaults off; `mc`
defaults on. An agent is selectable only when its command is installed locally.
The generated config retains `WT_TMUX`, `WT_AGENTS`, and `WT_EDITOR` overrides
and preserves inherited agent environment variables.

## Commands and safety

`clone` and `init` retain the bare-layout setup branch, validation, commit, and
optional PR workflow. `--direct` remains an explicit bypass. They offer hook
approval but never launch a real smoke test automatically.

`init` supports a bare-layout repository without an origin when it already has a
HEAD branch and worktree. It refuses an empty bare repository and ordinary clones
with a generic migration recipe. When a config exists, an interactive user sees a
highlighted diff and explicitly chooses whether to overwrite; `--yes` always
keeps the existing file. Trunk never parses or preserves values from an old
config, and never renames live tmux sessions.

## Phases

| Phase | File | Outcome |
| --- | --- | --- |
| 1 | [phase-1-generic-core.md](phase-1-generic-core.md) | Remove stack coupling and produce the generic worktree config. |
| 2 | [phase-2-docs-browser.md](phase-2-docs-browser.md) | Ship the offline interactive docs browser and manual Node recipes. |
| 3 | [phase-3-integration-release.md](phase-3-integration-release.md) | Update public documentation, validation, CI, packaging, and release readiness. |

Phases are sequential: Phase 2 documents the Phase 1 config contract, and
Phase 3 validates the finished public package.
