/**
 * The coding agents trunk knows how to start, and the commands that start them.
 *
 * This is deliberately a module of its own with no imports: both the tool probe
 * and the wt.toml generator need it, and the generator has no business pulling
 * in the filesystem and process machinery the probe depends on.
 */

/**
 * Agent id as the user writes it in `--agents` and `WT_AGENTS`, mapped to the
 * command that starts it. Most match; antigravity ships as `agy`. Keep this the
 * only place that knows the difference.
 */
export const agentCommands = Object.freeze({
	claude: 'claude',
	codex: 'codex',
	opencode: 'opencode',
	copilot: 'copilot',
	antigravity: 'agy',
	pi: 'pi',
});

export type AgentId = keyof typeof agentCommands;

/** Every id, in the order they are offered and started. */
export const agentIds: readonly AgentId[] = Object.freeze(
	Object.keys(agentCommands) as AgentId[],
);

/**
 * How many agents a worktree starts at once. Beyond this the tmux panes are too
 * small to be useful, so the generated hook stops and says so.
 */
export const maximumAgents = 4;

/** Narrows an arbitrary string, for reading `--agents` and config files. */
export function isAgentId(value: string): value is AgentId {
	return Object.hasOwn(agentCommands, value);
}
