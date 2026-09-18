/** Deterministically composes a complete project `.config/wt.toml`. */
import {assertSettings, type Settings} from '../settings.js';
import {generateAliases} from './aliases.js';
import {generateHeader} from './header.js';
import {tmuxKillBody, tmuxStartBody, tmuxStopBody} from './tmux.js';
import {inlineCommand, multilineCommand} from './toml.js';

export type GeneratedHook = Readonly<{
	type: 'pre-start' | 'pre-remove' | 'post-remove';
	name: string;
}>;

export function compose(settings: Settings): string {
	assertSettings(settings);
	const sections = [
		generateHeader(settings),
		generateAliases(settings),
		generatePreStart(settings),
		generatePreRemove(settings),
		generatePostRemove(settings),
	].filter(Boolean);

	return `${sections.join('\n\n')}\n`;
}

/** The hooks a config for these settings must expose, for validation. */
export function expectedHooks(settings: Settings): readonly GeneratedHook[] {
	const hooks: GeneratedHook[] = [];
	if (settings.copyIgnored) {
		hooks.push({type: 'pre-start', name: 'copy'});
	}

	if (settings.tmux) {
		hooks.push(
			{type: 'pre-start', name: 'tmux'},
			{type: 'pre-remove', name: 'tmux'},
			{type: 'post-remove', name: 'tmux'},
		);
	}

	return Object.freeze(hooks.map(hook => Object.freeze(hook)));
}

/**
 * One `[[pre-start]]` block per step: Worktrunk runs the blocks in order and
 * waits for each, so files are copied before the tmux session opens on them.
 */
function generatePreStart(settings: Settings): string | undefined {
	const blocks: string[] = [];
	if (settings.copyIgnored) {
		blocks.push(
			`[[pre-start]]\ncopy = ${inlineCommand('wt step copy-ignored')}`,
		);
	}

	if (settings.tmux) {
		blocks.push(
			`[[pre-start]]\ntmux = ${multilineCommand(tmuxStartBody(settings))}`,
		);
	}

	return blocks.length > 0 ? blocks.join('\n\n') : undefined;
}

function generatePreRemove(settings: Settings): string | undefined {
	return settings.tmux
		? `[pre-remove]\ntmux = ${multilineCommand(tmuxStopBody(settings))}`
		: undefined;
}

function generatePostRemove(settings: Settings): string | undefined {
	return settings.tmux
		? `[post-remove]\ntmux = ${multilineCommand(tmuxKillBody(settings))}`
		: undefined;
}
