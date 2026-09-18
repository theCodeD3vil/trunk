/**
 * The complete input to the wt.toml generator. Keeping runtime detection and
 * clocks outside this type makes composition deterministic and easy to test.
 *
 * Trunk models only the worktree experience, so these are the five choices a
 * user makes plus the provenance stamped into the header.
 */
import {isAgentId, maximumAgents, type AgentId} from './agents.js';
import {validatePrefix} from './prefix.js';

export type Settings = Readonly<{
	trunkVersion: string;
	generatedOn: string;
	prefix: string;
	tmux: boolean;
	agents: readonly AgentId[];
	copyIgnored: boolean;
	mcAlias: boolean;
}>;

/** What `--yes` and an untouched form produce. */
export const settingsDefaults = Object.freeze({
	tmux: true,
	agents: Object.freeze([]) as readonly AgentId[],
	copyIgnored: false,
	mcAlias: true,
});

/** Rejects values that cannot be represented safely by the generated config. */
export function assertSettings(settings: Settings): void {
	assertSingleLine('trunkVersion', settings.trunkVersion);
	assertDate(settings.generatedOn);

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
