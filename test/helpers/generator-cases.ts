import type {Settings} from '../../source/core/settings.js';
import {testSettings} from './settings.js';

export const generatorCases: ReadonlyArray<
	readonly [name: string, settings: Settings]
> = [
	['npm-full-agents-2', testSettings()],
	['npm-server-agents-1', testSettings({agents: ['claude'], caddy: false})],
	[
		'pnpm-subdir-agents-3',
		testSettings({
			pm: 'pnpm',
			appDir: 'backend',
			agents: ['claude', 'opencode', 'antigravity'],
			copyIgnored: false,
			mcAlias: false,
		}),
	],
	[
		'pnpm-no-server-agents-4',
		testSettings({
			pm: 'pnpm',
			agents: ['claude', 'codex', 'opencode', 'copilot'],
			server: false,
			caddy: true,
		}),
	],
	['bun-proxy-agents-0', testSettings({pm: 'bun', agents: []})],
	[
		// Guards the tether: `cd <dir> &&` here would end the tethered command and
		// leave the dev server running loose in the worktree root.
		'bun-subdir-agents-1',
		testSettings({pm: 'bun', appDir: 'apps/web', agents: ['claude']}),
	],
	[
		'npm-minimal',
		testSettings({
			tmux: false,
			agents: [],
			copyIgnored: false,
			server: false,
			caddy: false,
			mcAlias: false,
			scripts: [],
		}),
	],
];
