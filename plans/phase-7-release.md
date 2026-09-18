# Phase 7 — Docs, CI and release

**Goal.** Ship `@cod3vil/trunk` to npm, with documentation aimed at two audiences: the
person running trunk, and the teammate who only ever sees the generated `wt.toml`.

**Depends on.** Phases 0–6.

**Deliverables.**

```
readme.md                      rewritten (the starter text goes)
docs/generated-config.md       annotated tour of a generated wt.toml
.github/workflows/ci.yml       test matrix
package.json                   version, repository, keywords, files
```

## Steps

1. **Readme.** Replace the create-ink-app text with:
   - what trunk does in three lines, and what it explicitly does not do (no global config, no
     management after setup);
   - install: `npm i -g @cod3vil/trunk` (or `bun add -g @cod3vil/trunk`), noting
     that the command is `trunk` and may clash with the Rust `trunk` or Trunk.io if those are
     installed;
   - the three commands with a real example each;
   - the flag table from phase 0;
   - a "what it generates" section linking to `docs/generated-config.md`;
   - prerequisites: git and `wt` required; tmux, caddy, gh and agents optional;
   - the one-paragraph explanation of the bare layout, since that is the part people have to
     understand before the rest makes sense.
2. **`docs/generated-config.md`.** A real generated file, annotated block by block: why
   `-t "=name"` is used everywhere, why the URL is printed from pre-start, why `list.url`
   writes the host label out, why the port hashes repo + branch, what `WT_*` does, and the
   reminder that `wt config approvals add` must be re-run whenever the file changes.
3. **Version and metadata.** `version` starts at `0.1.0`. Add `repository`, `homepage`,
   `bugs`, `keywords` (`worktrunk`, `git-worktree`, `tmux`, `caddy`, `cli`), `license: MIT`,
   and `engines.node >= 20`. Confirm `files: ["dist"]` ships only the build.
4. **CI** (`ci.yml`): on push and pull request, matrix `ubuntu-latest` × `macos-latest`.
   Steps: checkout, `oven-sh/setup-bun` (pin the bun version), `bun install --frozen-lockfile`,
   install shellcheck (`apt-get install shellcheck` / `brew install shellcheck`), install `wt`
   (the release binary; pin the version the templates were written against), `bun run build`,
   then `bun run test`. Also add a **node smoke job**: `actions/setup-node` with Node 20 and
   22, `bun run build`, and `node dist/cli.js --help`, so the published artifact is proven to
   run on the runtime users actually install it under. Export `WORKTRUNK_CONFIG_PATH` to a
   temp file for the whole job so nothing can touch a real config, and set
   `git config --global user.email/user.name` so commits work in tests.
5. **End-to-end in CI.** The phase 4 test uses a `file://` remote, so no network or SSH is
   needed. Skip the gh-dependent parts unless `GH_TOKEN` is present; those stay manual.
6. **Release is manual, with `np`.** CI tests; it never publishes. `bun run release` runs
   `np`, which checks the branch and working tree, reinstalls from `bun.lock`, runs the test
   script, bumps the version, commits, tags, pushes and publishes, then opens a GitHub
   release draft. npm credentials stay on the machine doing the release, so no token is
   stored in the repository.

   `packageManager` in `package.json` tells np to use bun: it installs with
   `bun install --frozen-lockfile` and publishes through npm, which bun cannot do itself.
   `prepack` builds, so the tarball is always compiled from the committed source.

   `np.branch` is `main`, because np tags the commit it creates and a tag is only meaningful
   if that commit is reachable from the published history. Releasing from a side branch and
   then squashing or rebasing the merge leaves the tag on a commit that never shipped, which
   breaks `git describe` and shows as "not on main" on the release page. Merge first, release
   from `main`, then merge `main` back into the working branch.
7. **Changelog.** `changelog.md`, hand-written, one section per version. The first entry
   records that trunk generates for worktrunk v0.77.0 templates.
8. **Version stamp.** The generated header carries trunk's version, so the build must inject
   it: read `package.json` `version` at build time into a generated `source/version.ts`
   (avoid runtime `require` of `package.json`, which breaks when only `dist` ships).
9. **Manual acceptance run** before tagging, on this machine:
   - `trunk clone` a real Example-Org repo that has no config yet (e.g. `abc-frontend`) into a scratch
     folder, all the way through the PR and smoke test, then delete the scratch folder and
     close the PR;
   - `trunk init --overwrite` in `acme-admin`, compare the generated file against the
     hand-written one, and check the diff screen shows the `mc` alias and `.next/` exclude
     carried over;
   - `trunk new` with `--no-remote` and confirm the dev server and Caddy URL work.

## Acceptance criteria

- [ ] `bun run release --dry-run` completes, and `bun pm pack` contains `dist/` and nothing else of consequence, and
      `npx @cod3vil/trunk` prints usage from a clean machine (users install with npm).
- [x] CI is green on both platforms, including shellcheck over generated hook bodies and the
      end-to-end clone test.
- [x] `trunk --version` matches `package.json`, and the same string appears in the header of
      a generated file.
- [ ] The readme's example commands were all run by hand at least once.
- [ ] The three manual acceptance runs in step 9 are done and their results noted in the
      changelog entry.

## Risks & notes

- The generated templates are tied to worktrunk behaviour (`wt step tether`,
  `wt step copy-ignored`, the `hash_port` and `sanitize` filters, hook names). Pin the wt
  version in CI and mention the tested version in the readme; when wt changes, the snapshots
  are what will tell you.
- npm scope: the scope has to be one npm knows you own, which is the npm account name and
  not the GitHub one. `@cod3vil` matches the `cod3vil` account; the earlier `@thecoded3vil`
  matched the GitHub handle and does not exist on npm, so the first publish failed a
  prerequisite check with a 403 rather than a clear message — npm will not say whether a
  package exists in a scope you cannot see. `--access public` is still needed on the first
  publish.
- Development runs on bun; the published package targets Node. Keep the node smoke job
  green, or a bun-only API will slip into `dist/` unnoticed.
- Keep the readme honest about the command-name clash rather than trying to work around it.

## Pre-release verification (2026-09-18)

- `bun pm pack` produced a 0.1.0 tarball containing `dist/` plus npm's required
  `package.json`, readme and MIT license.
- The tarball installed into an empty npm prefix, its linked binary and a local `npx`
  invocation printed `0.1.0`, and the packed CLI did the same under Node 20 and Node 22.
- The local suite passes with generated hooks validated by Worktrunk and ShellCheck.
- Hosted CI, the registry-backed `npx @cod3vil/trunk` check, and the three credentialed
  manual acceptance runs remain pending before the `v0.1.0` tag.
