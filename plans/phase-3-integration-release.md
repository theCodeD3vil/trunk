# Phase 3: Integration and release readiness

**Goal.** Make the simplified public contract coherent across documentation,
tests, packaging, and manual release flow.

**Depends on.** Phases 1-2.

## Scope

1. **Rewrite public documentation.** Update the README and package metadata for
   `clone`, `init`, and `docs` only. Explain the bare layout, generic generated
   config, manual environment recipes, and the explicit non-goals: no stack
   detection, server setup, proxy setup, project scaffolding, or GitHub repo
   creation.

2. **Retire obsolete docs and tests.** Remove or rewrite Node/Caddy-specific
   generated-config tours, snapshot names, plans, and test fixtures. Keep Node
   knowledge only in bundled docs-browser content.

3. **Harden validation.** Keep Worktrunk validation and ShellCheck for generated
   hook bodies. Add regression tests that assert generated config is
   stack-neutral, the old flags/command are rejected, generic overwrite safety
   holds, originless init works, and all docs snippets remain valid.

4. **Update CI and packaging.** Keep Bun development and Node runtime smoke
   coverage. CI must install only tools required by retained tests: Worktrunk,
   ShellCheck, and tmux. Remove Caddy/Brew assumptions. Verify that docs content
   is bundled, the npm tarball contains the executable artifact, and the packed
   CLI works offline on supported Node versions.

5. **Preserve manual releases.** Keep `np` publishing from `main`; CI tests but
   never publishes. Update the release checklist to verify the generic config
   and docs browser rather than a Node/Caddy project setup.

## Acceptance criteria

- [ ] README, CLI help, package metadata, and bundled docs agree on the three
      commands and language-agnostic scope.
- [ ] CI is green on macOS and Linux with the retained toolchain only.
- [ ] The npm tarball contains the offline docs browser and has no runtime
      dependency on repository files or a network connection.
- [ ] A clean Node installation can run `trunk --help`, `trunk docs`, and the
      generic `clone`/`init` paths.
- [ ] `bun run release -- --dry-run` succeeds from `main`.
- [ ] Manual release acceptance verifies one generic clone, one originless init,
      one reviewed overwrite, and the Node docs recipes in an isolated fixture.

## Risks

- This is a pre-publication redesign. Do not imply compatibility with the old
  generated Node/Caddy config; existing files remain unchanged unless a user
  explicitly reviews and confirms overwrite.
- Keep the docs browser's content source close to its rendering tests so a
  release cannot ship stale copyable TOML.
