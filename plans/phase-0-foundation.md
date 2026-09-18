# Phase 0 — Foundation

**Goal.** Turn the create-ink-app starter into the skeleton of a real CLI: correct package
identity, subcommand dispatch, a shared result/exit convention, and a test harness that the
later phases plug into. No feature logic yet.

**Depends on.** Nothing.

**Deliverables.**

```
package.json                  name @cod3vil/trunk, bin trunk, scripts
source/cli.tsx                argv parsing + dispatch, no UI
source/commands/clone.tsx     stub: prints "not implemented", exit 2
source/commands/init.tsx      stub
source/commands/new.tsx       stub
source/core/result.ts         Outcome type + exit codes
source/core/log.ts            plain-text reporter (works without a TTY)
source/core/platform.ts       macOS/Linux check
test/cli.test.ts              usage, unknown command, platform guard
plans/                        these documents
```

## Steps

1. **Package identity.** In `package.json`: `"name": "@cod3vil/trunk"`,
   `"bin": { "trunk": "dist/cli.js" }`, `"engines": { "node": ">=20" }` (Ink 4 plus modern
   `node:` APIs), `"files": ["dist"]`, `"publishConfig": { "access": "public" }`, and
   `"type": "module"` (already set). Set `"version": "0.0.0"` until phase 7.
2. **Toolchain: bun for every development command.** `bun install`, `bun run build`,
   `bun test`, `bunx xo`, `bunx prettier`. npm is never used for this repo's own workflow;
   it only appears as one of the package managers trunk *detects* in other projects.
   - Drop ava, ts-node and the `ava` block from `package.json`: bun runs TypeScript and TSX
     directly, so the loader config is dead weight. Tests become `bun:test`
     (`import { test, expect } from 'bun:test'`), with `expect(...).toMatchSnapshot()` for
     the phase 2 snapshots.
   - Scripts: `"build": "tsc"`, `"dev": "tsc --watch"`,
     `"test": "prettier --check . && xo && bun test"`. `tsc` still produces `dist/` because
     the published package must run on plain Node.
   - Commit `bun.lock`; delete `package-lock.json` if one appears.
   - Add `test/` and `plans/` to `.prettierignore` only if formatting fights you.
3. **Argument parsing.** Keep `meow` for flags, but dispatch on `cli.input[0]` yourself:

   ```ts
   const [command, ...rest] = cli.input;
   switch (command) {
     case 'clone': return runClone(rest, cli.flags);
     case 'init':  return runInit(rest, cli.flags);
     case 'new':   return runNew(rest, cli.flags);
     case undefined: cli.showHelp(0);       // bare `trunk` → usage, exit 0 (D22)
     default: fail(`unknown command: ${command}`);
   }
   ```

   Declare every flag now, even though later phases consume them: `yes`, `prefix`, `pm`,
   `agents`, `server`, `caddy`, `tmux`, `copyIgnored`, `mc`, `direct`. Booleans get explicit
   `--no-*` handling (meow supports `--no-server` for a boolean flag named `server`); keep
   them tri-state (`true | false | undefined`) so "not passed" differs from "passed false".
4. **Help text** is the single source of the command surface:

   ```
   Usage
     $ trunk clone <url> [dir]   set up a bare-layout project from a remote
     $ trunk init [dir]          set up an existing bare-layout project
     $ trunk new <name>          create a new project (optionally on GitHub)

   Options
     --yes                 accept detected defaults, no form (needed without a TTY)
     --prefix <name>       tmux session prefix
     --pm <npm|pnpm|bun>   package manager
     --agents <a,b>        up to 4 of claude,codex,opencode,copilot,antigravity,pi
     --server/--no-server  dev server step
     --caddy/--no-caddy    Caddy route step
     --tmux/--no-tmux      tmux session hooks
     --copy/--no-copy      wt step copy-ignored
     --mc/--no-mc          `wt mc` alias
     --direct              commit on the current branch instead of chore/trunk-setup
   ```
5. **Exit codes and the outcome type.** `source/core/result.ts`:
   `0` success; `1` an operation failed (git, wt, gh); `2` bad usage; `3` unsupported
   environment (Windows, no git, no wt); `4` the user aborted. Every command returns
   `{ code, message? }` and `cli.tsx` is the only place that calls `process.exit`.
6. **Reporter.** `source/core/log.ts` prints step lines (`✓`, `✗`, `→`, `⚠`) to stderr and
   machine-readable results to stdout. It must work when Ink is not mounted, because
   `--yes` runs have no UI at all. Respect `NO_COLOR` and a non-TTY stdout (no ANSI).
7. **Platform guard.** `source/core/platform.ts` exits `3` on `process.platform === 'win32'`
   with: `trunk supports macOS and Linux (including WSL).`
8. **Test harness.** `test/helpers/run.ts` executes the built CLI in a temp directory with
   a scrubbed environment (`WORKTRUNK_CONFIG_PATH` pointing at a temp file so no test can
   ever touch the real worktrunk config, `NO_COLOR=1`, `TERM=dumb`). Run the built
   `dist/cli.js` with **node**, not bun, so tests exercise what users install. Mark tests
   that touch git as serial (`test.serial` equivalent: one `describe` with awaited steps).

## Acceptance criteria

- [ ] `bun run build && node dist/cli.js` prints usage and exits `0`.
- [ ] `trunk bogus` exits `2` with `unknown command: bogus`.
- [ ] `trunk clone <url>` exits `2` (stub) and never throws a stack trace.
- [ ] `--no-server` produces `flags.server === false`, and omitting it leaves `undefined`.
- [ ] `bun test` passes, and `bun run test` also runs prettier and xo clean.
- [ ] No test writes outside its temp directory; `WORKTRUNK_CONFIG_PATH` is set in the
      harness and asserted to be a temp path.

## Risks & notes

- Bun is the development runtime; the shipped artifact is still plain Node ESM in `dist/`.
  Never introduce a `bun:` import into `source/` — it would break the published CLI.
- xo's React rules come from the starter; the `core/` modules are plain TypeScript and
  should not import React, so the CLI can run its `--yes` path without mounting Ink.
- Keep `dist/` out of git; the npm `files` field ships it.
- Node 20+ is required so `node:util.parseArgs`-era APIs and `fs.cp` are available if meow
  is ever dropped.
