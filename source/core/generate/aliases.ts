/** Project-level convenience commands: `wt up` and the optional `wt mc`. */
import type {Settings} from '../settings.js';
import {inlineCommand, multilineCommand} from './toml.js';

export function generateAliases(settings: Settings): string | undefined {
	const aliases: string[] = [];
	const up = upCommand(settings);
	if (up) {
		aliases.push(`up = ${inlineCommand(up)}`);
	}

	if (settings.mcAlias) {
		aliases.push(`mc = ${multilineCommand(mcAliasBody)}`);
	}

	return aliases.length > 0 ? `[aliases]\n${aliases.join('\n')}` : undefined;
}

/**
 * Re-runs the start hooks trunk manages, for a worktree that was created before
 * the config existed or whose session was closed. There is no `up` when no start
 * hook exists, because it would have nothing to run.
 */
export function upCommand(settings: Settings): string | undefined {
	return settings.tmux || settings.copyIgnored
		? 'wt hook pre-start'
		: undefined;
}

/** Keep this quoting aligned with Worktrunk's documented editor alias. */
export const mcAliasBody = `WORKTRUNK_COMMIT__GENERATION__COMMAND='f=$(mktemp); printf "\\n\\n" > "$f"; sed "s/^/# /" >> "$f"; \${EDITOR:-vi} "$f" < /dev/tty > /dev/tty; grep -v "^#" "$f"' wt merge`;
