# trunk — implementation plans

`trunk` is a one-shot setup tool. It writes a project's `.config/wt.toml` so nobody has to
type it by hand, then gets out of the way.

- It **sets up** repositories. It does not manage them afterwards.
- It has **no global config**, no registry, no spec file, no `sync`, no `doctor`.
- The generated `wt.toml` is **self-contained**: every hook body is inline POSIX sh, and
  every optional tool guards itself with `command -v`. Teammates only need `wt`.
- Node CLI built with Ink, published to npm as **`@cod3vil/trunk`**, command `trunk`.
- **Development runs on bun** (`bun install`, `bun run build`, `bun test`, `bunx xo`); npm is
  never used for this repo's own workflow. The published artifact still targets plain Node.
- Supported platforms: macOS and Linux/WSL. Native Windows is refused with a message.

## Commands

```
trunk clone <url> [dir]   set up a bare-layout project from a remote
trunk init [dir]          set up an existing bare-layout project
trunk new <name>          create a new project (optionally on GitHub)
```

Bare `trunk` prints usage and exits. Every form field also has a flag, plus `--yes`.
Without a TTY and without `--yes`, trunk stops and prints the command it would need.

## Phases

| Phase | File | Outcome |
|-------|------|---------|
| 0 | [phase-0-foundation.md](phase-0-foundation.md) | Repo, toolchain, CLI skeleton, test harness |
| 1 | [phase-1-probe-and-model.md](phase-1-probe-and-model.md) | Environment probing, repo identity, prefix, stack detection |
| 2 | [phase-2-generator.md](phase-2-generator.md) | `wt.toml` generator + snapshot/shellcheck tests |
| 3 | [phase-3-setup-form.md](phase-3-setup-form.md) | Ink form, flag parity, `--yes`, non-TTY behaviour |
| 4 | [phase-4-clone.md](phase-4-clone.md) | `trunk clone` end to end, including PR and smoke test |
| 5 | [phase-5-init.md](phase-5-init.md) | `trunk init`, adoption, prefix rename, plain-clone refusal |
| 6 | [phase-6-new.md](phase-6-new.md) | `trunk new`, gh repo creation, local-only projects |
| 7 | [phase-7-release.md](phase-7-release.md) | Docs, CI, npm publish as `@cod3vil/trunk` |

Phases are ordered by dependency. Phases 5 and 6 can be built in parallel once phase 4 lands.

## Design decisions behind these plans

Recorded on 2026-09-17 during the design interview. Each is referenced by the phase that
implements it.

| # | Decision |
|---|----------|
| D1 | trunk generates `.config/wt.toml` only. No spec file, no global state, no post-setup management. |
| D2 | Entry points: `clone`, `init`, `new`. Never converts an existing normal clone in place. |
| D3 | trunk never writes `~/.config/worktrunk/config.toml`. `worktree-path` is left to wt's own prompt. |
| D4 | The first worktree is created by running `wt switch main` with the terminal attached, so wt's prompt appears while the user is present. |
| D5 | Generated files are committed on a `chore/trunk-setup` worktree (created `--no-hooks`) and offered as a PR. `--direct` skips the branch. |
| D6 | Detection is limited to the Node package manager (lockfile). Everything else is left to the user with comment notes in the file. |
| D7 | tmux prefix: initials by default, random word or custom as alternatives. No clash checking. |
| D8 | On `init`, the existing `P=` is pre-filled; changing it offers to rename live tmux sessions. |
| D9 | If `wt.toml` already exists, trunk asks keep or overwrite. |
| D10 | All steps are checked by default. Dev server is a yes/no; Caddy is asked only if the dev server is on. |
| D11 | Agents: up to 4 of claude, codex, opencode, copilot, antigravity (`agy`), pi. Missing ones are marked but selectable. |
| D12 | Agent panes: 1 full, 2 side by side, 3 tiled (2 + 1 wide), 4 as a 2×2 grid. |
| D13 | tmux windows are fixed: Editor / Agents / Terminal. The Agents window is omitted when agents are off. |
| D14 | The server step uses the package manager's own argument syntax. |
| D15 | Missing caddy triggers a `brew install caddy` offer when brew is present. |
| D16 | The generated file keeps a full team header, tailored to the choices. |
| D17 | Before committing, the file is validated with `wt config show` and `wt hook show --expanded`. |
| D18 | After the PR, trunk offers `wt config approvals add` plus a hook smoke test. |
| D19 | On failure, trunk asks keep or roll back; with no TTY it keeps everything and prints how to resume. |
| D20 | `trunk init` in a normal clone refuses and prints the migration recipe. |
| D21 | Tests: snapshots per option combination, shellcheck on every hook body, one end-to-end run. |
| D22 | npm only (`@cod3vil/trunk`), subcommands only, flags for every field plus `--yes`. |

## Verified facts these plans rely on

Checked on 2026-09-17 against the tools installed on this machine.

- **wt v0.77.0, bare repo with no `worktree-path` entry.** With a TTY, wt asks
  `Configure worktree-path to place worktrees at proj/main? [y/N]` and writes a
  `[projects."<id>"]` entry on yes. **Without a TTY it never asks and never writes, even
  with `--yes`**: it creates `<proj>/.git.<branch>` and prints a hint.
  `WORKTRUNK_CONFIG_PATH` overrides the user config path, which is how tests stay isolated.
- **`worktree-path` is user-config only.** It cannot be set in a repo's `.config/wt.toml`.
- **wt has no `include`/`extends`**, and TOML forbids repeating a table, so a generated file
  and hand-written sections cannot share `[aliases]` or `[pre-remove]`.
- **Argument forwarding** (npm 12.0.2, pnpm 11.10.0, bun 1.4.0):
  `npm run dev -- --port N` → `["--port","N"]`; without `--` npm swallows the flag.
  `pnpm run dev -- --port N` → `["--","--port","N"]`, which breaks next/nuxt, so pnpm must
  use `pnpm run dev --port N`. bun forwards correctly either way.
- **tmux 3.7c `select-layout tiled`**: 2 panes stack top/bottom, 3 give two on top plus one
  wide below, 4 give a 2×2 grid. `even-horizontal` is used for exactly 2 panes.
- **`tmux kill-session -t NAME` matches name prefixes**; `-t "=NAME"` is required for an
  exact match.
- **Agent commands**: `claude`, `codex`, `opencode`, `copilot`, `agy` (Antigravity), `pi`.
- **Bare clones have no `remote.origin.fetch` refspec**, so `origin/*` refs are missing until
  trunk adds it. This previously broke `wt step copy-ignored` with
  `No primary worktree found`.
- **`{{ repo }}` renders `.git`** in the bare layout; templates must use
  `{{ remote_repo | lower }}`. `[list] url` cannot use repo variables at all: the host label
  must be written out literally, or the whole URL renders empty.
- **A failed `pre-start` hook does not fail `wt`**: it skips install and the dev server and
  still exits 0, which is why validation and the smoke test matter.
