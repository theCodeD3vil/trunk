/**
 * The "Node" topic: copy-and-edit recipes for a Node project. Everything here
 * is documentation. Trunk never detects a package manager, never reads a
 * package.json and never adds any of these fragments itself.
 *
 * Every TOML block names its placement so the tests can drop it into a real
 * generated config and ask Worktrunk to parse it.
 */
import {shell, text, toml} from './blocks.js';
import type {Topic} from './types.js';

/** The port every server and route in this topic agrees on. */
const port = "{{ (remote_repo ~ '/' ~ branch) | hash_port }}";

export const node: Topic = Object.freeze({
	id: 'node',
	title: 'Node',
	summary:
		'Dependency install, a tethered dev server, and an optional Caddy route.',
	sections: Object.freeze([
		{
			id: 'how-these-recipes-work',
			title: 'How these recipes work',
			blocks: [
				text(
					"These are additive fragments for a Node project's .config/wt.toml. Trunk does not detect your package manager or your scripts and never adds any of this for you: copy a fragment, edit the commands to fit your project, and commit it.",
				),
				text(
					'Pick one package manager. Each step comes in npm, pnpm and Bun forms; use the one your project already uses.',
				),
				text(
					"Where a fragment goes matters. Dependency install belongs in the pre-start pipeline, above Trunk's tmux block, so it finishes before the session opens. If you turned on copy-ignored, keep the install below that block's copy step so cached files arrive first. The dev server goes in post-start, which runs in the background.",
				),
				text(
					'The recipes assume the conventional `dev` script and a --port flag. If your project uses another script, such as `start` or `serve`, replace `dev` with it.',
				),
				text('After adding a fragment, check it and approve it:'),
				shell(
					'Check and approve',
					`wt hook show --expanded
wt config approvals add`,
				),
			],
		},
		{
			id: 'install-dependencies',
			title: 'Install dependencies',
			keywords: ['npm', 'pnpm', 'bun'],
			blocks: [
				text(
					'Installing in pre-start means dependencies are ready before the tmux session opens. Pick the block for your package manager and place it above the tmux block.',
				),
				toml(
					'npm',
					`[[pre-start]]
install = "npm install --prefer-offline --no-audit --no-fund"`,
					'before-tmux',
				),
				toml(
					'pnpm',
					`[[pre-start]]
install = "pnpm install --prefer-offline"`,
					'before-tmux',
				),
				toml(
					'Bun',
					`[[pre-start]]
install = "bun install"`,
					'before-tmux',
				),
				text(
					'`--prefer-offline` reuses the local package cache, which keeps new worktrees quick. To pin installs strictly to the lockfile, use `npm ci`, `pnpm install --frozen-lockfile` or `bun install --frozen-lockfile` instead.',
				),
			],
		},
		{
			id: 'monorepo',
			title: 'Monorepo subfolders',
			keywords: ['app', 'workspace'],
			blocks: [
				text(
					'When the Node app lives in a subfolder such as apps/web, point the package manager at it instead of changing directory. Replace apps/web with your path.',
				),
				toml(
					'npm, app in apps/web',
					`[[pre-start]]
install = "npm --prefix apps/web install --prefer-offline --no-audit --no-fund"`,
					'before-tmux',
				),
				toml(
					'pnpm, app in apps/web',
					`[[pre-start]]
install = "pnpm --dir apps/web install --prefer-offline"`,
					'before-tmux',
				),
				toml(
					'Bun, app in apps/web',
					`[[pre-start]]
install = "bun install --cwd=apps/web"`,
					'before-tmux',
				),
				text(
					'If your workspace tool installs everything from the repository root, the plain fragments on the previous page already do the job.',
				),
			],
		},
		{
			id: 'dev-server',
			title: 'Dev server (tethered)',
			blocks: [
				text(
					'post-start runs in the background right after the worktree is created. `wt step tether` runs the server in its own process group and stops the whole group when the worktree is removed, so nothing lingers and no cleanup hook is needed.',
				),
				text(
					'The port comes from hash_port, a hash of the repository and the branch that maps to a number from 10000 to 19999. A branch always gets the same port, and the same branch name in two repositories gets two ports. remote_repo is read from the origin remote; a project without one should write its name in its place.',
				),
				toml(
					'npm',
					`[[post-start]]
server = "wt step tether -- npm run dev -- --port ${port}"`,
					'append',
				),
				toml(
					'pnpm',
					`[[post-start]]
server = "wt step tether -- pnpm run dev --port ${port}"`,
					'append',
				),
				toml(
					'Bun',
					`[[post-start]]
server = "wt step tether -- bun run dev --port ${port}"`,
					'append',
				),
				text(
					'pnpm passes a literal -- through to the script, so write `pnpm run dev --port ...` rather than `pnpm run dev -- --port ...`.',
				),
				toml(
					'npm, server reads a PORT variable',
					`[[post-start]]
server = "wt step tether -- env PORT=${port} npm run start:dev"`,
					'append',
				),
				text(
					"For an app in a subfolder, use the package manager's own directory flag. Do not write `cd apps/web && ...`: everything after -- is one command, and a shell && would end the tethered command and leave the server running loose.",
				),
				toml(
					'npm, app in apps/web',
					`[[post-start]]
server = "wt step tether -- npm --prefix apps/web run dev -- --port ${port}"`,
					'append',
				),
				toml(
					'pnpm, app in apps/web',
					`[[post-start]]
server = "wt step tether -- pnpm --dir apps/web run dev --port ${port}"`,
					'append',
				),
				toml(
					'Bun, app in apps/web',
					`[[post-start]]
server = "wt step tether -- bun --cwd=apps/web run dev --port ${port}"`,
					'append',
				),
				text('Show the address in the URL column of `wt list`:'),
				toml(
					'URL in wt list',
					`[list]
url = "http://localhost:${port}"`,
					'append',
				),
				text(
					"Trunk's `up` alias only re-runs pre-start. To start the server with it, change the alias to `wt hook pre-start && wt hook post-start server`.",
				),
			],
		},
		{
			id: 'caddy',
			title: 'Caddy routes (advanced)',
			blocks: [
				text(
					'Optional. A Caddy route gives every worktree a stable address, http://<branch>.<repo>.localhost:8080, in front of its dev server, instead of a hashed port. Use it together with the tethered server: the route forwards to the same port.',
				),
				text(
					'Prerequisites: Caddy and curl. Install Caddy with the method that suits your system, from its official instructions at https://caddyserver.com/docs/install. Trunk never installs or runs Caddy, and each fragment skips itself when Caddy or curl is missing.',
				),
				text(
					'Every route gets an ID built from the repository and the branch, wt:<repo>:<branch>, so the same branch name in two repositories never collides and a route can be removed precisely. Most browsers resolve .localhost names to your own machine.',
				),
				text(
					'Steps of a [[post-start]] pipeline wait for each other, and a tethered server never finishes, so the route has to sit in the same block as the server, where keys run together. This block replaces the plain server block from the previous page; swap its server line for your package manager.',
				),
				toml(
					'post-start: server and route together (npm shown)',
					String.raw`[[post-start]]
server = "wt step tether -- npm run dev -- --port ${port}"
proxy = '''
command -v caddy >/dev/null 2>&1 || { echo "caddy not found; skipping route"; exit 0; }
command -v curl >/dev/null 2>&1 || { echo "curl not found; skipping route"; exit 0; }
ID=wt:{{ remote_repo | lower }}:{{ branch | sanitize }}
HOST={{ branch | sanitize }}.{{ remote_repo | lower }}.localhost
PORT=${port}
curl -sf --max-time 0.5 http://localhost:2019/config/ >/dev/null || caddy start
curl -sf http://localhost:2019/config/apps/http/servers/wt >/dev/null || \
  curl -sfX PUT http://localhost:2019/config/apps/http/servers/wt \
    -H 'Content-Type: application/json' \
    -d '{"listen":[":8080"],"automatic_https":{"disable":true},"routes":[]}'
curl -sf -X DELETE "http://localhost:2019/id/$ID" >/dev/null || true
PAYLOAD=$(printf '{"@id":"%s","match":[{"host":["%s"]}],"handle":[{"handler":"reverse_proxy","upstreams":[{"dial":"127.0.0.1:%s"}]}]}' "$ID" "$HOST" "$PORT")
curl -sfX PUT http://localhost:2019/config/apps/http/servers/wt/routes/0 \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD"
'''`,
					'append',
				),
				text(
					'Removing the worktree should remove its route. Add this key inside the [post-remove] table Trunk generated, or use the second block when your file has no such table.',
				),
				toml(
					'post-remove: remove the route (inside the existing table)',
					String.raw`caddy = '''
command -v curl >/dev/null 2>&1 || exit 0
ID=wt:{{ remote_repo | lower }}:{{ branch | sanitize }}
curl -sf -X DELETE "http://localhost:2019/id/$ID" >/dev/null || true
'''`,
					{table: 'post-remove'},
				),
				toml(
					'post-remove: remove the route (no [post-remove] table yet)',
					String.raw`[post-remove]
caddy = '''
command -v curl >/dev/null 2>&1 || exit 0
ID=wt:{{ remote_repo | lower }}:{{ branch | sanitize }}
curl -sf -X DELETE "http://localhost:2019/id/$ID" >/dev/null || true
'''`,
					'standalone',
				),
				text(
					'To show the Caddy address in `wt list`, use this instead of the localhost URL from the previous page; a file can only declare [list] once.',
				),
				toml(
					'URL in wt list (Caddy address)',
					`[list]
url = "http://{{ branch | sanitize }}.{{ remote_repo | lower }}.localhost:8080"`,
					'append',
				),
				text(
					"The first route starts Caddy's admin API on localhost:2019 and a server on port 8080 with automatic HTTPS off, since these are local names. Routes live in Caddy's running configuration, so restarting Caddy clears them; run `wt hook post-start proxy` to register the current worktree again.",
				),
			],
		},
	]),
});
