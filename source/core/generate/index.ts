/** Deterministically composes a complete project `.config/wt.toml`. */
import {assertSettings, usesCaddy, type Settings} from '../settings.js';
import {generateAliases} from './aliases.js';
import {generateHeader} from './header.js';
import {
	generateList,
	generateUrlPreStart,
	proxyRemoveBody,
	proxyStartBody,
} from './proxy.js';
import {generatePostStart} from './steps.js';
import {generateTmuxPreStart, tmuxRemoveBody} from './tmux.js';
import {multilineCommand, tomlString} from './toml.js';

export type GeneratedHook = Readonly<{
	type: 'pre-start' | 'post-start' | 'pre-remove';
	name: string;
}>;

export function compose(settings: Settings): string {
	assertSettings(settings);
	const sections = [
		generateHeader(settings),
		generateAliases(settings),
		generateTmuxPreStart(settings),
		generateUrlPreStart(settings),
		generatePostStart(settings, proxyStartBody(settings)),
		generatePreRemove(settings),
		generateCopyIgnoredStep(settings),
		generateList(settings),
	].filter(Boolean);

	return `${sections.join('\n\n')}\n`;
}

export function expectedHooks(settings: Settings): readonly GeneratedHook[] {
	const hooks: GeneratedHook[] = [];
	if (settings.tmux) {
		hooks.push({type: 'pre-start', name: 'tmux'});
	}

	if (usesCaddy(settings)) {
		hooks.push({type: 'pre-start', name: 'url'});
	}

	if (settings.copyIgnored) {
		hooks.push({type: 'post-start', name: 'copy'});
	}

	hooks.push({type: 'post-start', name: 'install'});
	if (settings.server) {
		hooks.push({type: 'post-start', name: 'server'});
	}

	if (usesCaddy(settings)) {
		hooks.push({type: 'post-start', name: 'proxy'});
	}

	if (settings.tmux) {
		hooks.push({type: 'pre-remove', name: 'tmux'});
	}

	if (usesCaddy(settings)) {
		hooks.push({type: 'pre-remove', name: 'proxy'});
	}

	return Object.freeze(hooks.map(hook => Object.freeze(hook)));
}

/**
 * Paths a repository already excluded from `wt step copy-ignored`. Only ever
 * present when adopting a config that had them, so an empty list emits nothing.
 */
function generateCopyIgnoredStep(settings: Settings): string | undefined {
	const excludes = settings.copyIgnoredExclude ?? [];
	if (!settings.copyIgnored || excludes.length === 0) {
		return undefined;
	}

	const values = excludes.map(value => tomlString(value)).join(', ');
	return `[step.copy-ignored]\nexclude = [${values}]`;
}

function generatePreRemove(settings: Settings): string | undefined {
	const commands: string[] = [];
	const tmux = tmuxRemoveBody(settings);
	if (tmux) {
		commands.push(`tmux = ${multilineCommand(tmux)}`);
	}

	const proxy = proxyRemoveBody(settings);
	if (proxy) {
		commands.push(`proxy = ${multilineCommand(proxy)}`);
	}

	return commands.length > 0
		? `[pre-remove]\n${commands.join('\n')}`
		: undefined;
}
