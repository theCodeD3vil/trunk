/**
 * The complete input to the wt.toml generator. Keeping runtime detection and
 * clocks outside this type makes composition deterministic and easy to test.
 */
import {isAgentId, maximumAgents, type AgentId} from './agents.js';
import type {PackageManager} from './detect.js';
import {validatePrefix} from './prefix.js';

export type Settings = Readonly<{
	trunkVersion: string;
	generatedOn: string;
	repoName: string;
	hostLabel: string;
	prefix: string;
	pm: PackageManager;
	appDir?: string;
	tmux: boolean;
	agents: readonly AgentId[];
	editorWindow: true;
	copyIgnored: boolean;
	server: boolean;
	caddy: boolean;
	mcAlias: boolean;
	devScript: string;
	scripts: readonly string[];
	/**
	 * Extra paths for `[step.copy-ignored]`. trunk never proposes these; they are
	 * carried over verbatim when adopting a hand-written config, so a repository
	 * that already excludes something does not lose it on overwrite.
	 */
	copyIgnoredExclude?: readonly string[];
	/**
	 * A project created before its remote exists. `remote_repo` renders empty
	 * without an origin, and every URL-bearing template is built from it, so the
	 * project name is written out literally instead.
	 */
	noRemote?: boolean;
}>;

export const settingsDefaults = Object.freeze({
	tmux: true,
	agents: Object.freeze([]) as readonly AgentId[],
	editorWindow: true,
	copyIgnored: true,
	server: true,
	caddy: true,
	mcAlias: true,
	devScript: 'dev',
	scripts: Object.freeze([]) as readonly string[],
});

/** Rejects values that cannot be represented safely by the generated config. */
export function assertSettings(settings: Settings): void {
	assertSingleLine('trunkVersion', settings.trunkVersion);
	assertDate(settings.generatedOn);
	assertSingleLine('repoName', settings.repoName);
	assertSingleLine('hostLabel', settings.hostLabel);
	assertSingleLine('devScript', settings.devScript);

	if (settings.hostLabel !== settings.repoName.toLowerCase()) {
		throw new TypeError('hostLabel must be the lowercase repoName.');
	}

	const prefix = validatePrefix(settings.prefix);
	if (!prefix.valid) {
		throw new TypeError(prefix.reason);
	}

	if (settings.agents.length > maximumAgents) {
		throw new TypeError(`At most ${maximumAgents} agents can be generated.`);
	}

	if (!settings.tmux && settings.agents.length > 0) {
		throw new TypeError('Agents require the tmux session.');
	}

	if (new Set(settings.agents).size !== settings.agents.length) {
		throw new TypeError('Agent ids must be unique.');
	}

	for (const agent of settings.agents) {
		const value: string = agent;
		if (!isAgentId(value)) {
			throw new TypeError(`Unknown agent id: ${value}`);
		}
	}

	if (settings.appDir) {
		assertRelativePath(settings.appDir);
	}

	for (const script of settings.scripts) {
		assertSingleLine('script name', script);
	}

	for (const exclude of settings.copyIgnoredExclude ?? []) {
		assertSingleLine('copy-ignored exclude', exclude);
	}
}

/** Caddy has nothing to route when the development server is disabled. */
export function usesCaddy(settings: Settings): boolean {
	return settings.server && settings.caddy;
}

function assertDate(value: string): void {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new TypeError('generatedOn must use YYYY-MM-DD.');
	}

	const parsed = new Date(`${value}T00:00:00.000Z`);
	if (
		Number.isNaN(parsed.valueOf()) ||
		!parsed.toISOString().startsWith(value)
	) {
		throw new TypeError('generatedOn must be a real calendar date.');
	}
}

function assertSingleLine(name: string, value: string): void {
	if (!value || /[\0\r\n]/.test(value)) {
		throw new TypeError(`${name} must be a non-empty single line.`);
	}
}

function assertRelativePath(value: string): void {
	assertSingleLine('appDir', value);
	if (
		value.startsWith('/') ||
		value.startsWith('~') ||
		value.split(/[\\/]/).includes('..')
	) {
		throw new TypeError('appDir must be a relative path inside the worktree.');
	}
}
