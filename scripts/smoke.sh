#!/usr/bin/env bash
# Packs the package, installs the tarball the way an npm consumer would, and
# exercises the installed `trunk` on throwaway repositories: help, version,
# `trunk docs` with and without a terminal, and the generic clone and init
# flows against a real Worktrunk.
#
# It needs git, wt, tmux, node, npm and tar, and it never touches your own
# repositories or Worktrunk configuration: everything lives in a temp folder
# and HOME and WORKTRUNK_CONFIG_PATH point into it. CI runs this on every
# supported Node version, and the release checklist runs it before publishing.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WORK=$(mktemp -d)
SOCKET="trunk-smoke-$$"

cleanup() {
  tmux -L "$SOCKET" kill-server >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() {
  echo "smoke: FAIL: $*" >&2
  exit 1
}

step() {
  echo "smoke: $*"
}

for tool in git wt tmux node npm tar; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is required"
done

# Nothing here may reach the user's real Git or Worktrunk configuration.
export HOME="$WORK/home"
export XDG_CONFIG_HOME="$HOME/.config"
export WORKTRUNK_CONFIG_PATH="$WORK/worktrunk.toml"
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME="Trunk Smoke" GIT_AUTHOR_EMAIL="smoke@example.com"
export GIT_COMMITTER_NAME="Trunk Smoke" GIT_COMMITTER_EMAIL="smoke@example.com"
mkdir -p "$HOME" "$XDG_CONFIG_HOME"

step "packing (this runs the real build)"
(cd "$ROOT" && npm pack --silent --pack-destination "$WORK" >"$WORK/pack.out")
TARBALL="$WORK/$(tail -n 1 "$WORK/pack.out")"
[ -f "$TARBALL" ] || fail "npm pack produced no tarball"

step "checking the tarball carries the executable and the bundled docs"
tar -tzf "$TARBALL" >"$WORK/files.txt"
for file in \
  package/dist/cli.js \
  package/dist/commands/docs.js \
  package/dist/ui/DocsBrowser.js \
  package/dist/docs/config-basics.js \
  package/dist/docs/node.js \
  package/package.json; do
  grep -qx "$file" "$WORK/files.txt" || fail "tarball is missing $file"
done
# The browser must not depend on anything that lives outside dist.
if grep -E '^package/(docs|source|test|plans|scripts)/' "$WORK/files.txt"; then
  fail "tarball contains repository files that the CLI must not depend on"
fi

step "installing the tarball as a consumer"
npm install --silent --no-audit --no-fund --prefix "$WORK/consumer" "$TARBALL"
CLI="$WORK/consumer/node_modules/.bin/trunk"
[ -x "$CLI" ] || fail "installed package has no trunk executable"

step "trunk --help lists only clone, init and docs"
HELP=$("$CLI" --help)
COMMANDS=$(printf '%s\n' "$HELP" | grep -E '^ *\$ trunk ' | awk '{print $3}' | tr '\n' ' ')
[ "$COMMANDS" = "clone init docs " ] || fail "help lists: $COMMANDS"
if printf '%s\n' "$HELP" | grep -Eiq 'trunk new|--pm|--server|--caddy|--remote|--owner|--public'; then
  fail "help still mentions a removed command or flag"
fi

step "trunk --version matches package.json"
EXPECTED=$(node -p "require('$ROOT/package.json').version")
[ "$("$CLI" --version)" = "$EXPECTED" ] || fail "version differs from $EXPECTED"

step "trunk docs without a terminal exits 2"
CODE=0
"$CLI" docs </dev/null >"$WORK/docs.out" 2>"$WORK/docs.err" || CODE=$?
[ "$CODE" = 2 ] || fail "trunk docs exited $CODE without a terminal"
grep -q "needs a terminal" "$WORK/docs.err" || fail "trunk docs gave no guidance"
if grep -Eq 'Raw mode|component:|^ +at ' "$WORK/docs.err"; then
  fail "trunk docs printed a stack trace"
fi

step "trunk docs shows the two-topic menu in a real terminal"
# env -i starts from nothing, then CI and VERCEL are set on purpose: many
# developers export a CI marker in their shell profile, and Ink draws nothing
# until exit when it sees one. The menu has to appear regardless.
tmux -L "$SOCKET" new-session -d -x 110 -y 36 -s docs -c "$WORK" \
  "env -i PATH='$PATH' HOME='$HOME' TERM=tmux-256color CI=true VERCEL=1 node '$WORK/consumer/node_modules/@cod3vil/trunk/dist/cli.js' docs"
SCREEN=
for _ in $(seq 1 50); do
  SCREEN=$(tmux -L "$SOCKET" capture-pane -p -t docs 2>/dev/null || true)
  case "$SCREEN" in *"Config Basics"*) break ;; esac
  sleep 0.2
done
case "$SCREEN" in *"Config Basics"*"Node"*) ;; *) fail "menu never appeared: $SCREEN" ;; esac
tmux -L "$SOCKET" send-keys -t docs q
for _ in $(seq 1 50); do
  tmux -L "$SOCKET" has-session -t docs 2>/dev/null || break
  sleep 0.2
done
if tmux -L "$SOCKET" has-session -t docs 2>/dev/null; then
  fail "trunk docs did not exit after q"
fi

# A repository with a default branch, and a bare remote to clone from.
git init --quiet --initial-branch main "$WORK/source"
printf '# fixture\n' >"$WORK/source/README.md"
git -C "$WORK/source" add README.md
git -C "$WORK/source" commit --quiet -m "Initial commit"
git clone --quiet --bare "$WORK/source" "$WORK/remote.git"

step "trunk clone --yes sets up a generic project"
"$CLI" clone --yes "file://$WORK/remote.git" "$WORK/cloned" >"$WORK/clone.out" 2>&1 \
  || { cat "$WORK/clone.out"; fail "trunk clone failed"; }
CONFIG="$WORK/cloned/chore-trunk-setup/.config/wt.toml"
[ -f "$CONFIG" ] || fail "clone wrote no $CONFIG"
grep -q "tmux = '''" "$CONFIG" || fail "generated config has no tmux hook"
grep -q '^\[post-remove\]' "$CONFIG" || fail "generated config has no post-remove hook"
if grep -Eiq 'npm|pnpm|bun|node|caddy|localhost|hash_port|dev server' "$CONFIG"; then
  fail "generated config contains stack-specific content"
fi
wt -C "$WORK/cloned/chore-trunk-setup" config show >"$WORK/wt-show.out" 2>&1 \
  || fail "wt rejected the generated config"
grep -q "Add worktree automation" < <(git -C "$WORK/cloned/chore-trunk-setup" log -1 --format=%s) \
  || fail "the config was not committed"

step "trunk init --yes sets up a bare project that has no origin"
mkdir "$WORK/originless"
git clone --quiet --bare "$WORK/remote.git" "$WORK/originless/.git"
git --git-dir "$WORK/originless/.git" remote remove origin
git --git-dir "$WORK/originless/.git" worktree add --quiet "$WORK/originless/main" main
"$CLI" init --yes "$WORK/originless" >"$WORK/init.out" 2>&1 \
  || { cat "$WORK/init.out"; fail "trunk init failed without an origin"; }
[ -f "$WORK/originless/chore-trunk-setup/.config/wt.toml" ] || fail "init wrote no config"
grep -q "no origin to push to" "$WORK/init.out" || fail "init did not explain the missing origin"

step "trunk init --yes keeps an existing config byte for byte"
mkdir "$WORK/existing"
git clone --quiet --bare "$WORK/remote.git" "$WORK/existing/.git"
git --git-dir "$WORK/existing/.git" worktree add --quiet "$WORK/existing/main" main
mkdir "$WORK/existing/main/.config"
printf '# hand written\n[aliases]\nup = "echo up"\n' >"$WORK/existing/main/.config/wt.toml"
cp "$WORK/existing/main/.config/wt.toml" "$WORK/expected.toml"
"$CLI" init --yes "$WORK/existing" >"$WORK/keep.out" 2>&1 \
  || { cat "$WORK/keep.out"; fail "trunk init failed on an existing config"; }
cmp -s "$WORK/existing/main/.config/wt.toml" "$WORK/expected.toml" \
  || fail "trunk init --yes changed an existing config"

step "trunk init refuses an empty bare repository without creating history"
mkdir "$WORK/empty"
git init --quiet --bare "$WORK/empty/.git"
CODE=0
"$CLI" init --yes "$WORK/empty" >"$WORK/empty.out" 2>&1 || CODE=$?
[ "$CODE" = 2 ] || fail "trunk init exited $CODE for an empty repository"
grep -q "empty bare repository" "$WORK/empty.out" || fail "no explanation for the empty repository"
[ -z "$(git --git-dir "$WORK/empty/.git" for-each-ref)" ] || fail "trunk init created history"

echo "smoke: ok ($EXPECTED)"
