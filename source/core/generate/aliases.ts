/** Project-level convenience commands assembled from the enabled hooks. */
import {usesCaddy, type Settings} from '../settings.js';
import {inlineCommand, multilineCommand, shellQuote} from './toml.js';

const branchTemplate = '{{ branch | sanitize }}';

export function generateAliases(settings: Settings): string | undefined {
	const aliases: string[] = [];
	const up = upCommand(settings);
	if (up) {
		aliases.push(`up = ${inlineCommand(up)}`);
	}

	if (usesCaddy(settings)) {
		aliases.push(`url = ${multilineCommand(urlAliasBody(settings))}`);
	}

	if (settings.mcAlias) {
		aliases.push(`mc = ${multilineCommand(mcAliasBody)}`);
	}

	return aliases.length > 0 ? `[aliases]\n${aliases.join('\n')}` : undefined;
}

export function upCommand(settings: Settings): string | undefined {
	const commands: string[] = [];
	if (settings.tmux || usesCaddy(settings)) {
		commands.push('wt hook pre-start');
	}

	if (settings.server) {
		commands.push(
			usesCaddy(settings)
				? 'wt hook post-start server proxy'
				: 'wt hook post-start server',
		);
	}

	return commands.length > 0 ? commands.join(' && ') : undefined;
}

export function urlAliasBody(settings: Settings): string {
	const suffix = shellQuote(`.${settings.hostLabel}.localhost:8080`);
	return `{% if args %}BRANCH={{ args[0] | sanitize }}{% else %}BRANCH=${branchTemplate}{% endif %}
HOST_SUFFIX=${suffix}
URL="http://\${BRANCH}\${HOST_SUFFIX}"
if command -v open >/dev/null 2>&1; then
  open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL"
else
  printf '%s\\n' "$URL"
fi`;
}

/** Keep this quoting aligned with Worktrunk's documented editor alias. */
export const mcAliasBody = `WORKTRUNK_COMMIT__GENERATION__COMMAND='f=$(mktemp); printf "\\n\\n" > "$f"; sed "s/^/# /" >> "$f"; \${EDITOR:-vi} "$f" < /dev/tty > /dev/tty; grep -v "^#" "$f"' wt merge`;
