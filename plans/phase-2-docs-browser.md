# Phase 2: Offline docs browser

**Goal.** Add `trunk docs`, an offline interactive terminal browser that teaches
manual project-environment setup without coupling generated configuration to a
stack.

**Depends on.** Phase 1.

## Scope

1. **Ship docs with the CLI.** Bundle structured documentation into the
   published artifact. `trunk docs` must work without a checkout, browser, or
   network connection.

2. **Build the terminal browser.** Reuse the terminal UI runtime with the same
   raw-input guard used by the setup form. Without an interactive terminal,
   exit 2 with clear guidance rather than mounting Ink or writing a large plain
   text fallback.

3. **Navigation and search.** Start at a menu with:
   - Config Basics;
   - Node.

   `/` opens a live search input. Search indexes headings, prose, and code
   blocks. Results show a title and matching snippet; Enter opens the selected
   section and Esc returns to the menu.

4. **Copyable snippets.** On a recipe page, `c` copies the only code block
   immediately or opens a labeled snippet picker when several blocks exist.
   Use available platform clipboard commands with a clear fallback that tells
   the user how to select and copy from their terminal. Clipboard support is
   optional, never a runtime dependency.

5. **Write Config Basics.** Explain only committed project `.config/wt.toml`:
   what Trunk generates, hook lifecycle phases, pipelines, templates, approvals,
   aliases, and how to add generic custom hooks. Link to Worktrunk's official
   documentation for personal/global configuration. Do not include a framework
   recipe in this topic.

6. **Write Node recipes.** Provide additive TOML fragments, not full replacement
   configs. Include:
   - npm, pnpm, and Bun dependency-install alternatives;
   - the conventional `dev` script, with a note that projects can replace it;
   - monorepo working-directory variants for all three package managers;
   - a tethered `post-start` server recipe;
   - an advanced optional Caddy recipe using
     `http://<branch>.<repo>.localhost:8080`, a repository-and-branch route ID,
     and a matching `post-remove` cleanup fragment.

   Node install fragments must be placed before Trunk's tmux hook in the
   `pre-start` pipeline. Caddy guidance names Caddy and curl as prerequisites and
   links to Caddy's official install documentation rather than prescribing a
   system package manager.

## Acceptance criteria

- [ ] A packaged installation runs `trunk docs` offline and shows the two-topic
      menu.
- [ ] `trunk docs` without raw-capable terminal input exits 2 without an Ink
      stack trace.
- [ ] `/pnpm`, `/hash_port`, and a prose-only term each return the right section
      and a relevant snippet.
- [ ] Navigation, Esc/back, Ctrl+C, and search selection have deterministic UI
      tests.
- [ ] `c` copies a single recipe, opens a picker for multiple recipes, and has a
      clear no-clipboard fallback.
- [ ] Every documented TOML fragment parses with Worktrunk in an isolated test
      repository.
- [ ] The docs browser and generated wt.toml contain no automatic stack
      detection or setup behaviour.

## Risks

- Additive TOML must explain pipeline placement precisely: TOML table repetition
  is invalid, while `[[pre-start]]`/`[[post-start]]` pipeline blocks are ordered
  and composable.
- Caddy is documentation only. Its commands must never be copied into Trunk's
  generator, probe, form, or defaults.
