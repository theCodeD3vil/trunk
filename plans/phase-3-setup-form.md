# Phase 3 — The setup form

**Goal.** Collect the `Settings` object (phase 2) from the user, from flags, or from
detection, with identical results whichever path is taken. The form is the only interactive
part of trunk.

**Depends on.** Phases 1 and 2.

**Deliverables.**

```
source/ui/SetupForm.tsx        the Ink form
source/ui/fields/Select.tsx    single choice
source/ui/fields/MultiSelect.tsx  checkboxes with a max
source/ui/fields/TextInput.tsx    prefix entry
source/ui/Summary.tsx          the preview shown before writing
source/core/resolve.ts         detection + flags -> Settings (no UI)
test/resolve.test.ts
```

## Steps

1. **Resolution is headless.** `resolve()` takes detection results, flags and defaults and
   returns either a complete `Settings` or a list of open questions. The form only fills the
   open questions; `--yes` answers them with the defaults. This keeps the interactive and
   scripted paths on one code path, and makes the tests UI-free.

   Precedence, highest first: explicit flag → value read from an existing `wt.toml`
   (overwrite path, phase 5) → detection → built-in default.

2. **Field order** (one screen, top to bottom):

   | Field | Default | Notes |
   |-------|---------|-------|
   | folder / path | from args | shown read-only on `init` |
   | prefix | `initials(repoName)` | `[r]` random word, `[c]` custom (D7) |
   | package manager | detected | ambiguity marked "confirm" (D6) |
   | tmux session | on | off removes the session hooks entirely |
   | agents | on, installed agents up to 4, list order | multi-select, max 4 (D11) |
   | copy-ignored | on | (D10) |
   | dev server | on | yes/no |
   | Caddy route | on if caddy present | only shown when the dev server is on (D10) |
   | `mc` alias | on | |

3. **Prefix field.** Text input pre-filled with the initials. Keys: `r` inserts a random
   word, `c` clears for custom entry. Validation from phase 1 runs on every keystroke and
   shows the reason inline. No clash checking of any kind (D7) — the field's help line is
   `keep it unique across your repos`.

4. **Agent multi-select.** All six listed in a fixed order (claude, codex, opencode, copilot,
   antigravity, pi). Installed ones are pre-checked up to four, in that order. Missing ones
   render as `not installed` but remain selectable (D11). Selecting a fifth is refused with
   `max 4 (2×2 grid)`. When every agent is unchecked, the Agents window is dropped from the
   generated file.

5. **Caddy branch** (D15). When the dev server is on and `caddy` is missing:
   - brew present → `? caddy not found. Install with 'brew install caddy'? (Y/n)`. On yes,
     run it with output streamed; on failure, keep going and fall through to the next case.
   - no brew → print `https://caddyserver.com/docs/install`, default the Caddy field to off,
     and leave a checkbox reading `include anyway (teammates may have it)`.

6. **Summary screen** (D17). After the form and before anything is written:

   ```
   folder    ~/Projects/nvc/djulah-admin
   prefix    djulah-a          session djulah-a_<branch>
   install   npm install --prefer-offline --no-audit --no-fund
   server    npm run dev -- --port <hash of repo+branch>
   route     http://<branch>.djulah-admin.localhost:8080
   agents    claude, codex
   steps     tmux · copy-ignored · install · server · proxy · mc
   ```

   `[Enter]` writes, `[b]` goes back, `[q]` aborts with exit code `4`.

7. **Non-TTY behaviour** (D22). `process.stdin.isTTY === false` (or `--yes`) skips Ink
   entirely: `resolve()` runs, and any remaining open question is either answered by its
   default (`--yes`) or ends the run with exit `2` and the exact command to re-run, listing
   the flags that were missing.

8. **Ink specifics.** Mount with `render(<SetupForm/>, { exitOnCtrlC: false })` and handle
   `Ctrl+C` as an abort that returns exit `4` through the normal outcome path, so phase 4's
   rollback question can still run. Never write to stdout from the reporter while Ink is
   mounted; queue those lines and flush after unmount.

## Acceptance criteria

- [ ] `resolve()` with all flags set returns a complete `Settings` and asks nothing.
- [ ] `--yes` with no flags returns the documented defaults for an npm Next.js fixture.
- [ ] Flags beat detection, and detection beats built-in defaults (table-driven test).
- [ ] `--agents claude,codex,opencode,copilot,pi` fails with `max 4`.
- [ ] `--agents antigravity` maps to the `agy` command in the generated file.
- [ ] Piping trunk's output (no TTY) with no `--yes` exits `2` and prints the re-run command.
- [ ] Aborting the form exits `4` and writes nothing.
- [ ] The form renders at 80 columns without wrapping damage (ink-testing-library snapshot).

## Risks & notes

- Ink 4 with React 18 is what the starter ships; keep components small and avoid hook-heavy
  state so the `bun test` + ink-testing-library snapshots stay readable. Check early that
  ink-testing-library renders under bun; if it does not, run only the UI tests through node.
- The summary must render the **same strings** that go into the file (reuse the generator's
  helpers), otherwise the preview drifts from reality.
- `brew install caddy` is the only thing trunk installs. It must never run without an
  explicit yes, and never in `--yes` mode.
