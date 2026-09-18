/** Caddy route lifecycle, terminal URL report, and `wt list` URL fragment. */
import {usesCaddy, type Settings} from '../settings.js';
import {inlineCommand, multilineCommand, shellQuote} from './toml.js';

const branchTemplate = '{{ branch | sanitize }}';
const remoteRepositoryTemplate = '{{ remote_repo | lower }}';
const portTemplate = "{{ (remote_repo ~ '/' ~ branch) | hash_port }}";

export function proxyStartBody(settings: Settings): string | undefined {
	if (!usesCaddy(settings)) {
		return undefined;
	}

	return `[ "\${WT_PROXY-on}" = off ] && exit 0
command -v caddy >/dev/null 2>&1 || { echo "caddy not found; skipping proxy"; exit 0; }
command -v curl >/dev/null 2>&1 || { echo "curl not found; skipping proxy"; exit 0; }
ID=wt:${remoteRepositoryTemplate}:${branchTemplate}
HOST=${branchTemplate}.${remoteRepositoryTemplate}.localhost
PORT=${portTemplate}
curl -sf --max-time 0.5 http://localhost:2019/config/ >/dev/null || caddy start
curl -sf http://localhost:2019/config/apps/http/servers/wt >/dev/null || \\
  curl -sfX PUT http://localhost:2019/config/apps/http/servers/wt \\
    -H 'Content-Type: application/json' \\
    -d '{"listen":[":8080"],"automatic_https":{"disable":true},"routes":[]}'
curl -sf -X DELETE "http://localhost:2019/id/$ID" >/dev/null || true
PAYLOAD=$(printf '{"@id":"%s","match":[{"host":["%s"]}],"handle":[{"handler":"reverse_proxy","upstreams":[{"dial":"127.0.0.1:%s"}]}]}' "$ID" "$HOST" "$PORT")
curl -sfX PUT http://localhost:2019/config/apps/http/servers/wt/routes/0 \\
  -H 'Content-Type: application/json' \\
  -d "$PAYLOAD"`;
}

export function proxyRemoveBody(settings: Settings): string | undefined {
	if (!usesCaddy(settings)) {
		return undefined;
	}

	return `command -v curl >/dev/null 2>&1 || exit 0
ID=wt:${remoteRepositoryTemplate}:${branchTemplate}
curl -sf -X DELETE "http://localhost:2019/id/$ID" >/dev/null || true`;
}

export function generateUrlPreStart(settings: Settings): string | undefined {
	if (!usesCaddy(settings)) {
		return undefined;
	}

	const suffix = shellQuote(`.${settings.hostLabel}.localhost:8080`);
	const body = `BRANCH=${branchTemplate}
HOST_SUFFIX=${suffix}
URL="http://\${BRANCH}\${HOST_SUFFIX}"
printf '↗ Local server: %s\\n' "$URL"`;
	return `[[pre-start]]\nurl = ${multilineCommand(body)}`;
}

export function generateList(settings: Settings): string | undefined {
	if (!usesCaddy(settings)) {
		return undefined;
	}

	const url = routeUrl(settings, branchTemplate);
	return `[list]\nurl = ${inlineCommand(url)}`;
}

/** The generated route with a caller-selected branch placeholder. */
export function routeUrl(settings: Settings, branch: string): string {
	return `http://${branch}.${settings.hostLabel}.localhost:8080`;
}
