# Releasing

Releases are published by hand from `main`, never by CI, so the npm credentials stay on one machine. CI only tests: it has read-only permissions and no publish step.

`np` tags the commit it creates, and a tag only means something if that commit is reachable from `main`. Squashing or rebasing a release made on a side branch would leave the tag pointing at history that never shipped, which is why releases happen on `main`.

## Before you release

1. Check out `main`, pull, and confirm the working tree is clean.
2. In `changelog.md`, rename `Unreleased` to the new version and date. Removing a command or flag is a breaking change, so use a minor bump while the version is below 1.0.
3. Run the full checks. They need Worktrunk, tmux, and ShellCheck installed:

   ```sh
   bun install --frozen-lockfile
   bun run test
   bun run smoke
   ```

   `bun run smoke` packs the tarball, installs it as an npm consumer, and runs the installed CLI on throwaway repositories. It checks that the docs are inside the tarball and that nothing outside `dist` is needed at run time.

4. Rehearse the release without publishing anything:

   ```sh
   bun run release -- --dry-run
   ```

   Run it in a terminal you are sitting at. `np` checks the branch, working tree, remote history, and npm login, reinstalls, runs the tests, and bumps the version, and then asks for your npm one-time password even in a dry run, so it cannot finish unattended.

## Manual acceptance

The automated checks cover these flows, but a release is not done until you have seen them work yourself in an isolated fixture. Point every tool at a temporary directory so nothing touches your own repositories or Worktrunk configuration:

```sh
export FIXTURE=$(mktemp -d)
export HOME="$FIXTURE/home" XDG_CONFIG_HOME="$FIXTURE/home/.config"
export WORKTRUNK_CONFIG_PATH="$FIXTURE/worktrunk.toml"
mkdir -p "$HOME"

git init --initial-branch main "$FIXTURE/source"
git -C "$FIXTURE/source" commit --allow-empty -m "Initial commit"
git clone --bare "$FIXTURE/source" "$FIXTURE/remote.git"
```

Use the packed CLI (`npm install --global "$(npm pack --silent)"` from a checkout of `main`, or run `dist/cli.js` after `bun run build`), then check each of these:

1. **A generic clone.** Run `trunk clone "file://$FIXTURE/remote.git" "$FIXTURE/cloned"` and answer the form. Confirm `chore-trunk-setup/.config/wt.toml` exists and is committed, that it has no dependency, server, or proxy content, that `wt config show` accepts it, and that the run ends by offering `wt config approvals add` and naming `wt up`.
2. **An originless init.** Create a bare project with no remote (`git clone --bare` then `git remote remove origin`, and add a `main` worktree), run `trunk init` on it, and confirm the prefix suggestion comes from the folder name and a local merge command is printed. Then run it on an empty `git init --bare` and confirm it refuses and creates no history.
3. **A reviewed overwrite.** In a project that has a hand-written `.config/wt.toml`, run `trunk init` interactively. Confirm you are asked whether to overwrite, that a highlighted diff is shown before anything is written, that declining leaves the file untouched, and that accepting replaces it. Then run `trunk init --yes` and confirm the file is kept byte for byte.
4. **The Node docs recipes.** Run `trunk docs`, open the Node topic, and use `c` to copy an install fragment. Paste it into the fixture's `.config/wt.toml` above the tmux block, then run `wt hook show --expanded` and confirm Worktrunk lists it before `tmux`. Repeat for the tethered server and, if Caddy is installed, the Caddy route with its `post-remove` cleanup.

## Publishing

```sh
bun run release            # or: bun run release minor
```

That runs [`np`](https://github.com/sindresorhus/np), which verifies the branch and working tree, reinstalls from `bun.lock`, runs the tests, bumps the version, commits, tags, pushes, publishes, and opens a GitHub release draft.

After it finishes, check the published package:

```sh
npm view @cod3vil/trunk version
npx --yes @cod3vil/trunk --version
```

Then merge `main` back into the working branch to pick up the version bump.
