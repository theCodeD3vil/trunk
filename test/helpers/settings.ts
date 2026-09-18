import type {Settings} from '../../source/core/settings.js';

export function testSettings(overrides: Partial<Settings> = {}): Settings {
	return Object.freeze({
		trunkVersion: '0.0.0-test',
		generatedOn: '2026-09-18',
		prefix: 'web-sp',
		tmux: true,
		agents: Object.freeze(['claude', 'codex']),
		copyIgnored: true,
		mcAlias: true,
		...overrides,
	});
}
