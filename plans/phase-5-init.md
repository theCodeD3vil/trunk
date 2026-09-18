# Phase 5 — `trunk init`

**Goal.** Set up a project that already exists on disk in the bare layout: repos cloned by
hand, repos already using worktrunk (acme-admin, webshop-website, acme-website), and
runs resumed after a failure. Also the polite refusal for plain clones.

**Depends on.** Phase 4 (it reuses the same pipeline from step 6 onward).

**Deliverables.**

```
source/commands/init.tsx
source/core/adopt.ts        read values back out of an existing wt.toml
source/core/tmuxRename.ts   rename live sessions after a prefix change
test/adopt.test.ts, test/init.test.ts
```

## Steps

1. **Resolve the target.** `[dir]` argument, else the current directory. Walk up to find the
   project root: a directory containing a bare `.git`, or the worktree/`.git` directory the
   user is standing in (phase 1 layout detection).

2. **Refuse plain clones** (D20). When the directory is a normal clone, exit `3` with the
   recipe, filled in with the real paths and remote:

   ```
   ✗ ~/Projects/example-org/abc-admin is a normal clone; trunk sets up bare-layout projects.

     trunk clone git@github.com-work:Example-Org/abc-admin.git abc-admin-wt
     cp abc-admin/.env* abc-admin-wt/main/
     # check nothing uncommitted or unpushed is left in abc-admin, then:
     rm -rf abc-admin && mv abc-admin-wt abc-admin
   ```

   Before printing, check the clone for uncommitted or unpushed work and add a warning line
   naming what it found. trunk never touches or deletes the checkout (D2).

3. **Repair what's missing.** For a genuine bare-layout project, bring it up to the state
   phase 4 would have produced:
   - `remote.origin.fetch` refspec missing → set it and fetch (with a report line);
   - no worktree for the default branch → create it through `wt switch <default>` with the
     terminal attached (phase 4, step 5), including the non-TTY warning;
   - `worktrunk.default-branch` unset → set it from the remote HEAD.

4. **Existing `wt.toml`** (D9). Ask `keep / overwrite`; `--yes` keeps.
   - **keep** → report and jump to the approvals/smoke-test offer.
   - **overwrite** → adoption (step 5), then the normal write, validate, commit, PR flow.

5. **Adoption** (`adopt.ts`, D8). Read what can be read from the existing file and pre-fill
   the form:

   | Read from | Into |
   |-----------|------|
   | `P=<value>` in the tmux hook | prefix |
   | install command | package manager (cross-checked against the lockfile; mismatch is shown) |
   | presence of `[[post-start]] server` / `proxy` | dev server, Caddy |
   | `wt step copy-ignored` | copy-ignored |
   | `[aliases] mc` | mc alias |
   | `WT_AGENTS-...` default in the agent loop | agent selection |
   | `[step.copy-ignored] exclude` | carried over verbatim |

   Parse with a TOML reader plus a couple of narrow regexes for the shell bodies; anything
   unreadable simply falls back to detection, and the form shows it as a normal default.
   **Anything trunk cannot model is lost on overwrite**, so the confirmation screen shows a
   diff of the old file against the new one before writing (this is the only place trunk
   shows a diff).

6. **Prefix change** (D8). When adoption read `P=acme` and the user picks something else,
   offer to rename live sessions before writing:

   ```sh
   tmux list-sessions -F '#{session_name}'   # filter ^acme_
   tmux rename-session -t "=acme_main" "acme-a_main"
   ```

   Exact `=name` targeting only. Skip silently when tmux is missing or no session matches.
   Report each rename. If renaming fails, warn that `wt remove` will not find the old
   sessions and print the manual kill commands.

7. **Resume after a failed run.** When the journal from phase 4 shows a `chore/trunk-setup`
   worktree already exists, reuse it instead of creating a second one, and continue from the
   write step. This is what the `resume: trunk init <dir>` hint points at.

## Acceptance criteria

- [ ] `trunk init` inside `<proj>/main`, `<proj>/.git` and `<proj>` all resolve to the same
      project root.
- [ ] A plain clone exits `3`, prints the recipe with real paths, and flags uncommitted work.
- [ ] Adoption of the real acme-admin `wt.toml` recovers: prefix `acme`, npm,
      server on, caddy on, copy-ignored on, mc on, agents `claude opencode`, and the
      `.next/` exclude.
- [ ] `--yes` on a repo with an existing `wt.toml` leaves it byte-identical.
- [ ] Overwrite shows a diff and only writes after confirmation.
- [ ] A prefix change offers renames, and after accepting, `tmux ls` shows the new names
      (tested on an isolated socket with `tmux -L trunk-test`).
- [ ] A missing fetch refspec is repaired and reported.

## Risks & notes

- Adoption is best-effort by design. Never fail a run because an existing file could not be
  parsed; fall back to detection and say so.
- The old `wt.toml` might contain hand-written extras (a repo-specific hook, a second alias).
  The diff screen is the user's only chance to notice, so it must show the removed lines
  clearly and let them abort.
- `tmux rename-session` on a session whose worktree was already removed is harmless, but do
  not rename sessions that belong to another project that happens to share the prefix —
  match `^<old>_` exactly and list what will be renamed before doing it.
