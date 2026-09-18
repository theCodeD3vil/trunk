# Phase 6 — `trunk new`

**Goal.** Create a project from nothing: a bare-layout repo with a default branch, a first
commit that carries `.config/wt.toml`, and optionally the GitHub repository behind it.

**Depends on.** Phase 4 (shared pipeline), phase 1 (SSH alias resolution).

**Deliverables.**

```
source/commands/new.tsx
source/core/gh.ts            repo create + owner listing (shared with phase 4's PR code)
test/new.test.ts             local-only path, fully offline
```

## Steps

1. **Arguments.** `trunk new <name> [dir]`. `<name>` is the project and repository name; the
   folder defaults to `./<name>`. Validate the name as a GitHub repo name
   (`^[A-Za-z0-9._-]+$`) and refuse a non-empty existing folder.

2. **Ask about the remote** (D20 revision: the form asks, rather than assuming):

   ```
   ? Create the GitHub repository now? (Y/n)
   ```

   `--remote` / `--no-remote` answer it from flags; `--yes` alone means yes when `gh` is
   authenticated, and no otherwise.

3. **With a remote.**
   - **Owner.** List choices from `gh api user` and `gh api user/orgs --jq '.[].login'`,
     defaulting to the active `gh` account. `--owner <x>` skips the question.
   - **Visibility.** `private` by default; `--public` flips it.
   - **Create.** `gh repo create <owner>/<name> --private --disable-wiki` without pushing
     anything yet (no `--source`, no `--clone`).
   - **Remote URL with the right SSH alias.** `gh` prints an `https://github.com/...` URL;
     rewrite it to SSH using the alias whose resolved `HostName` matches, preferring the one
     already used by sibling projects in the parent folder:
     `git@github.com-work:Example-Org/<name>.git` for Example-Org,
     `git@github.com:<user>/<name>.git` otherwise. Show the final URL for confirmation.
   - **Local repo.** `git init --bare <dir>/.git`, `git remote add origin <url>`, set the
     fetch refspec, and `git symbolic-ref HEAD refs/heads/main` (or `--default-branch`).

4. **Without a remote.** Same local setup, no `origin`. Because `remote_repo` renders empty
   with no remote, and every URL-bearing template depends on it, the generator is called with
   `hostLabel = <name>` **written out literally**, and these lines are emitted with a note:

   ```
   # No git remote yet, so the repo name is written out below. After you add one
   # (git remote add origin <url>), you can switch these back to {{ remote_repo | lower }}.
   ```

   Affected: the Caddy `ID` and `HOST`, the pre-start URL print, `[list] url`, and the port
   template (`{{ (remote_repo ~ '/' ~ branch) | hash_port }}` → `('<name>/' ~ branch)`).

5. **First worktree and first commit.** A bare repo with no commits has nothing to check out:
   - `git --git-dir <dir>/.git worktree add <dir>/main --orphan main` (git ≥ 2.42) or, as a
     fallback, create an empty root commit with `git commit-tree` and add the worktree from it;
   - run the form (phase 3), generate the file, write `.config/wt.toml` and a starter
     `.gitignore` (`node_modules/`, `.env*`, build output for the chosen stack when known);
   - validate with `wt config show` / `wt hook show --expanded` (D17);
   - commit as `Initial commit` on `main` — there is no `chore/trunk-setup` branch here (D5),
     since the whole repo is new;
   - with a remote: `git push -u origin main`.

6. **Package manager.** A new project has no lockfile, so detection can't run. The form asks
   (default npm), and `--pm` sets it. The generated install command is still written; the
   note above the server step explains it will only work once a `dev` script exists.

7. **Finish.** Same offer as phase 4 step 11: `wt config approvals add`, then the hook smoke
   test. The smoke test's install step will be a no-op in an empty project, which is fine and
   worth printing as `nothing to install yet`.

## Acceptance criteria

- [x] `trunk new demo --no-remote --yes` produces `demo/.git` (bare), `demo/main` with a
      first commit containing `.config/wt.toml` and `.gitignore`, and `wt config show` clean —
      with no network access at all.
- [x] In the no-remote file, the Caddy host, route id, `list.url` and port template all use
      the literal project name, and the explanatory note is present.
- [x] With `--remote --owner <org>`, the created remote URL uses the SSH alias that matches
      the sibling projects, and the confirmation screen shows it before anything is created.
- [x] A failure after `gh repo create` reaches the phase 4 keep/rollback question, and the
      journal names the GitHub repository as something trunk created but will **not** delete
      (print the `gh repo delete` command instead).
- [x] An existing non-empty folder exits `2` before anything is created.

The `--remote` path is covered by tests driving a stubbed `gh`, and was also run once
against a real account on 2026-09-18: `gh repo create` made a private repository with the
wiki disabled, the remote was written as `git@github.com-work:<owner>/<name>.git` through
the ssh alias a sibling project uses, the push over that alias succeeded, and
`wt config show` reported the matching identifier with no warnings. The keep/rollback path
after a failed create is covered by the stubbed test only, since exercising it live would
leave a second repository behind.

## Risks & notes

- Deleting a remote repository is out of scope for rollback: too destructive, and `gh repo
  delete` needs an extra scope. Print the command and let the user run it.
- `gh` may be authenticated as the wrong account (two are configured here). Show the account
  it will use and offer `gh auth switch` in the error when creation is refused.
- `--orphan` support depends on the git version; check `git --version` and use the
  `commit-tree` fallback below 2.42 rather than failing.
