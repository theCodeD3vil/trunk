import {describe, expect, test} from 'bun:test';
import {agentIds, type AgentId} from '../source/core/agents.js';
import {
	buildRerunCommand,
	installedAgents,
	resolve,
	setupFieldOrder,
	setupFlagsFromCli,
	type NeedsInputResolution,
	type ResolveOptions,
} from '../source/core/resolve.js';
import {parseArguments} from '../source/core/arguments.js';

const fixed = Object.freeze({
	trunkVersion: '0.0.0-test',
	generatedOn: '2026-09-18',
	repoName: 'Web-shop--portal',
});

describe('setup resolution', () => {
	test('--yes produces the documented defaults', () => {
		const resolution = resolve({
			fixed,
			tools: tools(['claude', 'codex']),
			acceptDefaults: true,
		});

		expect(resolution.kind).toBe('complete');
		expect(resolution.draft).toEqual({
			trunkVersion: '0.0.0-test',
			generatedOn: '2026-09-18',
			prefix: 'web-sp',
			tmux: true,
			// Installed agents are offered, never preselected.
			agents: [],
			copyIgnored: false,
			mcAlias: true,
		});
	});

	test('asks exactly the five setup questions, in order', () => {
		const resolution = resolve({fixed, tools: tools(['claude'])});

		expect(resolution.kind).toBe('questions');
		expect(resolution.questions.map(question => question.field)).toEqual([
			'prefix',
			'tmux',
			'agents',
			'copyIgnored',
			'mcAlias',
		]);
		expect([...setupFieldOrder]).toEqual([
			'prefix',
			'tmux',
			'agents',
			'copyIgnored',
			'mcAlias',
		]);
	});

	test('suggests the initials of the repository name as the prefix', () => {
		const resolution = resolve({fixed, tools: tools()});
		const prefix = resolution.questions.find(
			question => question.field === 'prefix',
		);

		expect(prefix?.defaultValue).toBe('web-sp');
		expect(
			resolve({
				fixed: {...fixed, repoName: 'acme-web-backend'},
				tools: tools(),
				acceptDefaults: true,
			}).draft.prefix,
		).toBe('acme-wb');
	});

	test('flags settle a field so the form does not ask about it', () => {
		const resolution = resolve({
			fixed,
			tools: tools(['claude']),
			flags: {prefix: 'mine', tmux: true, copyIgnored: true, mcAlias: false},
		});

		expect(resolution.questions.map(question => question.field)).toEqual([
			'agents',
		]);
		expect(resolution.draft).toMatchObject({
			prefix: 'mine',
			tmux: true,
			copyIgnored: true,
			mcAlias: false,
		});
		expect(resolution.sources.prefix).toBe('flag');
	});

	test('a form answer wins over a default and a flag wins over an answer', () => {
		const resolution = resolve({
			fixed,
			tools: tools(),
			acceptDefaults: true,
			answers: {prefix: 'answered', copyIgnored: true},
			flags: {prefix: 'flagged'},
		});

		expect(resolution.draft).toMatchObject({
			prefix: 'flagged',
			copyIgnored: true,
		});
		expect(resolution.sources.copyIgnored).toBe('answer');
	});

	test('offers only installed agents', () => {
		const resolution = resolve({
			fixed,
			tools: tools(['claude', 'antigravity']),
		});
		const agents = resolution.questions.find(
			question => question.field === 'agents',
		);

		expect(agents?.kind).toBe('multi-select');
		if (agents?.kind === 'multi-select') {
			expect(agents.options.map(option => option.id)).toEqual([
				'claude',
				'antigravity',
			]);
			// The command that starts it is shown, not just the id.
			expect(agents.options[1]!.command).toBe('agy');
		}
	});

	test('does not ask about agents when none is installed', () => {
		const resolution = resolve({fixed, tools: tools()});

		expect(resolution.questions.map(question => question.field)).not.toContain(
			'agents',
		);
		expect(installedAgents(tools())).toEqual([]);
	});

	test('accepts --agents for installed agents, in canonical order', () => {
		const resolution = resolve({
			fixed,
			tools: tools(['claude', 'codex', 'pi']),
			acceptDefaults: true,
			flags: {agents: 'pi,claude'},
		});

		expect(resolution.draft.agents).toEqual(['claude', 'pi']);
	});

	test('rejects --agents for an agent that is not installed', () => {
		expect(() =>
			resolve({
				fixed,
				tools: tools(['claude']),
				acceptDefaults: true,
				flags: {agents: 'claude,codex'},
			}),
		).toThrow('codex (codex) is not installed');
		expect(() =>
			resolve({
				fixed,
				tools: tools(),
				acceptDefaults: true,
				flags: {agents: 'antigravity'},
			}),
		).toThrow('antigravity (agy) is not installed');
	});

	test('rejects unknown, duplicated and excess agents', () => {
		const all = tools([...agentIds]);
		const attempt = (agents: string) =>
			resolve({fixed, tools: all, acceptDefaults: true, flags: {agents}});

		expect(() => attempt('emacs')).toThrow('Unknown agent "emacs"');
		expect(() => attempt('claude,claude')).toThrow('duplicates');
		expect(() => attempt('claude,codex,opencode,copilot,pi')).toThrow('max 4');
		expect(() => attempt('claude,,codex')).toThrow('empty entries');
	});

	test('an explicit --no-tmux with agents is a usage error', () => {
		expect(() =>
			resolve({
				fixed,
				tools: tools(['claude']),
				acceptDefaults: true,
				flags: {tmux: false, agents: 'claude'},
			}),
		).toThrow('Agents require --tmux');
	});

	test('--no-tmux alone quietly drops the agents question', () => {
		const resolution = resolve({
			fixed,
			tools: tools(['claude']),
			flags: {tmux: false},
		});

		expect(resolution.draft.agents).toEqual([]);
		expect(resolution.sources.agents).toBe('dependency');
		expect(resolution.questions.map(question => question.field)).not.toContain(
			'agents',
		);
	});

	test('validates the prefix', () => {
		expect(() =>
			resolve({
				fixed,
				tools: tools(),
				acceptDefaults: true,
				flags: {prefix: 'Bad_Prefix'},
			}),
		).toThrow();
	});

	test('maps the command line onto setup flags', () => {
		const {flags} = parseArguments([
			'clone',
			'url',
			'--prefix=x',
			'--no-tmux',
			'--copy',
			'--no-mc',
			'--agents=',
		]);

		expect(setupFlagsFromCli(flags)).toEqual({
			prefix: 'x',
			tmux: false,
			agents: '',
			copyIgnored: true,
			mcAlias: false,
		});
	});

	test('builds a reproducible rerun command from the open questions', () => {
		const resolution = resolve({
			fixed,
			tools: tools(),
			flags: {prefix: 'mine'},
		}) as NeedsInputResolution;

		const rerun = buildRerunCommand(
			'trunk',
			['clone', 'git@example.com:o/r.git', '--prefix=mine'],
			resolution,
		);

		expect(rerun.display).toBe(
			'trunk clone git@example.com:o/r.git --prefix=mine --tmux --no-copy --mc',
		);
	});
});

function tools(installed: readonly AgentId[] = []): ResolveOptions['tools'] {
	return {
		tmux: {name: 'tmux', path: '/tools/tmux'},
		agents: Object.fromEntries(
			agentIds.map(id => [
				id,
				installed.includes(id) ? {name: id, path: `/tools/${id}`} : {name: id},
			]),
		) as ResolveOptions['tools']['agents'],
	};
}
