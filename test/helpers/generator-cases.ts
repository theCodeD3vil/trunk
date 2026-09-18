import type {Settings} from '../../source/core/settings.js';
import {testSettings} from './settings.js';

/** Representative settings; each name is also the snapshot file it matches. */
export const generatorCases: ReadonlyArray<
	readonly [name: string, settings: Settings]
> = [
	// What `--yes` produces.
	['defaults', testSettings({agents: [], copyIgnored: false})],
	['copy-and-agents', testSettings()],
	[
		'four-agents-no-mc',
		testSettings({
			agents: ['claude', 'codex', 'opencode', 'antigravity'],
			copyIgnored: false,
			mcAlias: false,
		}),
	],
	// Copy-ignored is a start hook, so `up` exists even without a session.
	[
		'copy-without-tmux',
		testSettings({tmux: false, agents: [], copyIgnored: true}),
	],
	[
		'minimal',
		testSettings({
			tmux: false,
			agents: [],
			copyIgnored: false,
			mcAlias: false,
		}),
	],
];
