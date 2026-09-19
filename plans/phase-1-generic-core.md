# Phase 1: Generic worktree core

**Goal.** Make `clone` and `init` generate only language-agnostic Worktrunk and
tmux configuration. Remove all project-stack behaviour.

**Depends on.** None.

## Scope

1. **Remove stack modelling.** Delete package-manager and lockfile detection,
   app-directory detection, package-manager/server/Caddy settings, Caddy/Brew
   probing, URL/list/proxy generation, port hashing, server validation, and all
   associated flags, form fields, summaries, tests, and snapshots.

2. **Remove project creation.** Delete `trunk new`, `--remote`, `--owner`, and
   `--public`; remove new-project GitHub creation and Node-flavoured `.gitignore`
   code. Keep GitHub support only where `clone`/`init` use it for an optional PR.

3. **Shrink the setup contract.** Keep only prefix, tmux, agents,
   copy-ignored, and `mc` in `Settings`, resolution, flags, form, and summary.
   Use these defaults:
   - prefix: stable initials from repository name;
   - tmux: on;
   - agents: none;
   - copy-ignored: off;
   - `mc`: on.

   The form and `--agents` accept only locally installed supported agents. An
   explicit `--no-tmux` with agents remains a usage error. Retain the three
   per-machine tmux overrides: `WT_TMUX`, `WT_AGENTS`, and `WT_EDITOR`.

4. **Generate the generic file.** Generate only:
   - a concise generic header: provenance, edit-freely notice, approval
     guidance, `trunk docs` pointer, and retained tmux overrides;
   - `up`, only when Trunk-managed start hooks exist;
   - the default-on `mc` alias;
   - an ordered `pre-start` pipeline: optional `wt step copy-ignored`, then
     tmux setup;
   - `pre-remove` graceful process-tree shutdown;
   - `post-remove` exact `tmux kill-session -t "=..."` cleanup.

   Preserve the Editor and two-pane Terminal layout. Create the Agents window
   only for explicitly selected agents. Do not clear inherited AI-agent
   environment variables.

5. **Simplify command flow.** Keep the bare clone/refspec/default-branch/setup
   branch/commit/PR/rollback workflow. Remove stack detection and real hook smoke
   tests. After validation, offer only `wt config approvals add`; tell the user
   to run `wt up` when ready.

   `init` must:
   - support originless bare-layout projects that already have a default branch
     and worktree, using the project directory name for the prefix suggestion;
   - refuse an empty bare repository without creating Git history;
   - retain the generic normal-clone migration recipe, without `.env` or other
     stack language;
   - show a highlighted diff before an interactive overwrite, then replace the
     file only after confirmation;
   - keep an existing config byte-for-byte under `--yes` and never adopt old
     values or rename tmux sessions.

6. **Delete obsolete infrastructure.** Remove stack adoption, tmux-session
   renaming, generated-config prose that teaches stack setup, and dead runtime
   dependencies. Keep only tests and helpers that serve the generic contract.

## Acceptance criteria

- [ ] `trunk --help` lists only `clone`, `init`, and `docs`, with no
      package-manager, server, Caddy, or new-project flags.
- [ ] A generated wt.toml contains no stack-specific live or commented content.
- [ ] The form contains exactly prefix, tmux, agents, copy-ignored, and `mc`.
- [ ] `--yes` produces tmux on, no agents, copy-ignored off, and `mc` on.
- [ ] Copy-ignored runs before tmux when enabled; no copy hook exists when off.
- [ ] Tmux cleanup gracefully stops pane descendants in `pre-remove` and kills
      the exact session in `post-remove`, without a detached delay.
- [ ] `init` without an origin succeeds for an existing bare project, while an
      empty bare repository fails with a clear explanation.
- [ ] Interactive overwrite shows a highlighted diff and requires confirmation;
      non-interactive runs preserve an existing file byte-for-byte.
- [ ] `clone` and `init` still pass real Worktrunk validation and the existing
      bare-layout end-to-end scenarios.

## Risks

- Project configs may contain hand-written setup hooks. Overwrite intentionally
  replaces them only after the user reviews the diff; Trunk does not attempt a
  fragile parser or partial preservation layer.
- `post-remove` runs in the primary worktree after deletion. Use Worktrunk's
  preserved template variables and exact tmux targeting, not the removed path as
  the current directory.
