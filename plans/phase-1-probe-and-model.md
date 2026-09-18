# Phase 1 — Environment probing and the repo model

**Goal.** Everything trunk needs to *know* before it can generate anything: which tools
exist, what the repository is called, what layout it is in, which package manager it uses,
and what the session prefix should be. Pure functions plus thin process wrappers, all
testable without a network.

**Depends on.** Phase 0.

**Deliverables.**

```
source/core/env.ts        tool probing and versions
source/core/git.ts        git wrappers (read-only parts used here)
source/core/repo.ts       remote parsing, identity, layout detection
source/core/detect.ts     package manager + scripts
source/core/prefix.ts     initials, word list, validation
source/core/words.ts      built-in word list (>= 120 entries)
test/prefix.test.ts, test/repo.test.ts, test/detect.test.ts
```

## Steps

1. **Tool probe** (`env.ts`). One function returning a frozen record:

   ```ts
   type Tool = { name: string; path?: string; version?: string };
   probe(): Promise<{ git: Tool; wt: Tool; tmux: Tool; caddy: Tool; brew: Tool;
                      gh: Tool; agents: Record<AgentId, Tool> }>
   ```

   Look each up with `which`-style resolution over `PATH` (do not shell out to `which`;
   read `process.env.PATH` and `fs.access(X_OK)` so behaviour is identical without a shell).
   Version strings come from `--version` where cheap (`git`, `wt`, `tmux`, `caddy`, `gh`),
   and are never required. Agent ids map to commands: `claude`, `codex`, `opencode`,
   `copilot`, `antigravity → agy`, `pi`.
2. **Hard requirements.** `git` and `wt` are mandatory: missing means exit `3` with an
   install hint (`https://worktrunk.dev`). `tmux`, `caddy`, `gh`, and every agent are
   optional and only influence defaults and warnings.
3. **wt version check.** Parse `wt --version` (`wt v0.77.0`). Warn, do not fail, when the
   major/minor is lower than the version trunk's templates were written against; record the
   number so phase 2 can print it in the generated header.
4. **Remote parsing** (`repo.ts`). Accept every form used in these repos:
   `git@github.com-work:Example-Org/acme-admin.git`,
   `git@github.com:user/repo.git`, `https://github.com/user/repo(.git)`, and a local path.
   Produce:

   ```ts
   type Remote = {
     url: string;          // as given
     host: string;         // github.com-work  (the SSH alias, kept verbatim)
     realHost: string;     // github.com        (resolved from ~/.ssh/config when aliased)
     owner: string;        // Example-Org
     repo: string;         // acme-admin      (no .git suffix)
     identifier: string;   // github.com-work/Example-Org/acme-admin
   };
   ```

   `identifier` must match what `wt config show` prints as `Identifier:`; assert this in the
   end-to-end test rather than trusting the parser.
5. **SSH alias resolution.** Read `~/.ssh/config` (best effort, no shelling out) to map an
   alias like `github.com-work` to its `HostName`. Used by phase 6 when building a remote
   URL, and to decide whether `gh` can talk to the host at all.
6. **Layout detection.** Given a directory, classify it:

   | Layout | Test | Meaning |
   |--------|------|---------|
   | `bare-project` | `<dir>/.git` is a directory with `core.bare=true` | trunk's layout |
   | `bare-inside` | cwd is `<proj>/.git` or a worktree of one | resolve up to the project root |
   | `plain-clone` | `<dir>/.git` is a directory with `core.bare=false`, or a file (linked worktree of a plain clone) | refuse (D20, phase 5) |
   | `empty` | directory missing or empty | fine for `clone`/`new` |
   | `occupied` | anything else | refuse |

   Use `git rev-parse --git-common-dir` / `--is-bare-repository` with an explicit
   `--git-dir`, never a `cd`.
7. **Default branch.** For a remote: `git ls-remote --symref <url> HEAD` → `refs/heads/X`.
   For an existing bare repo: `git symbolic-ref HEAD`, falling back to the `worktrunk.default-branch`
   git config key wt maintains. Never assume `main`.
8. **Package manager detection** (`detect.ts`). Look in the worktree root, and one level
   down when the root has no `package.json` (Acme-backend keeps its app in `backend/`):

   | File | Result |
   |------|--------|
   | `package-lock.json` | npm |
   | `pnpm-lock.yaml` | pnpm |
   | `bun.lock` / `bun.lockb` | bun |
   | `yarn.lock` | yarn → **unsupported**, fall back to npm and warn |
   | none | ask (form) or default npm with a warning (`--yes`) |

   Two lockfiles is an **ambiguity**, not an error: report all matches, pick by a fixed
   priority (bun > pnpm > npm) and mark the field as "please confirm" in the form.
   Also collect `package.json` `scripts` keys for the comment notes in the generated file,
   and record `appDir` when `package.json` was found in a subdirectory.
9. **Prefix generation** (`prefix.ts`).

   ```ts
   initials(name: string): string
   ```

   Lowercase, split on any run of non-alphanumerics, drop empty parts. One word → the word
   itself. Otherwise `first + '-' + remaining.map(w => w[0]).join('')`.
   Verified outputs: `acme-admin → acme-a`, `Acme-backend → acme-b`,
   `acme-website → acme-w`, `abc-frontend → abc-f`, `Web-shop--portal → web-sp`,
   `WebShop-backend- → webshop-b`, `XYZ-WEBSITE → xyz-w`, `open-data-backend → open-db`.
   The input is the **remote repo name**, not the folder name.
10. **Word list** (`words.ts`). 120–200 short, unambiguous, lowercase English nouns
    (`otter`, `maple`, `anvil`…). Rules: 3–7 characters, no digits, no hyphens, no word that
    is also a common CLI name (`git`, `node`, `next`, `main`, `dev`). `randomWord(exclude)`
    picks one not in `exclude`.
11. **Prefix validation.** Accept `^[a-z0-9][a-z0-9-]{0,23}$`. Reject `.` and `:` (tmux
    rewrites them), reject `_` (it separates prefix from branch), reject a leading `-`.
    Explain the reason in the error; never silently rewrite what the user typed.

## Acceptance criteria

- [x] `probe()` on this machine finds git, wt, tmux, caddy, brew, gh and all six agents, and
      reports `antigravity → agy`.
- [x] Missing `wt` exits `3` with an install hint; missing `tmux` or `caddy` does not fail.
- [x] `initials()` matches every verified output in step 9 (table-driven test).
- [x] `randomWord()` never returns a reserved word, and is stable under a seeded RNG in tests.
- [ ] Remote parsing handles SSH aliases, HTTPS, and `.git` suffixes; `identifier` matches
      `wt config show` for acme-admin in the end-to-end test.
- [x] Layout detection distinguishes `<proj>/.git` (bare) from a plain clone and from a
      linked worktree, using fixtures created by `git init` in temp dirs.
- [x] Package-manager detection returns the right answer for fixtures covering npm, pnpm,
      bun, both-lockfiles, subdirectory app, and no lockfile.

## Risks & notes

- `{{ repo }}` renders `.git` in this layout, so **nothing** downstream may use the folder
  name for identity. `remote.repo` from step 4 is the single source for the prefix, the
  Caddy host and route ids, and `list.url`.
- Prefix collisions are accepted by design (D7): `acme-admin` and a future `acme-api`
  both give `acme-a`. The form shows the value; the user can change it.
- `ls-remote` needs network and SSH access. Cache the result per run and surface auth
  failures with the raw git error, which is usually the actionable message.
