import type {Settings} from '../../source/core/settings.js';

export function testSettings(overrides: Partial<Settings> = {}): Settings {
	return Object.freeze({
		trunkVersion: '0.0.0-test',
		generatedOn: '2026-09-18',
		repoName: 'Web-shop--portal',
		hostLabel: 'web-shop--portal',
		prefix: 'web-sp',
		pm: 'npm',
		tmux: true,
		agents: Object.freeze(['claude', 'codex']),
		editorWindow: true,
		copyIgnored: true,
		server: true,
		caddy: true,
		mcAlias: true,
		devScript: 'dev',
		scripts: Object.freeze(['build', 'dev', 'lint']),
		...overrides,
	});
}
