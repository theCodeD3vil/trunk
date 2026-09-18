import {describe, expect, test} from 'bun:test';
import {agentIds, type AgentId} from '../source/core/agents.js';
import type {PackageDetection} from '../source/core/detect.js';
import {compose} from '../source/core/generate/index.js';
import {
	buildRerunCommand,
	resolve,
	type ResolveOptions,
} from '../source/core/resolve.js';
import {exitCodes} from '../source/core/result.js';
import {collectSettings} from '../source/ui/SetupForm.js';

const fixed = Object.freeze({
	trunkVersion: '0.0.0-test',
	generatedOn: '2026-09-18',
	repoName: 'acme-admin',
	hostLabel: 'acme-admin',
});

describe('setup resolution', () => {
	test('all flags produce complete settings without questions', () => {
		const result = resolve({
			fixed,
			packageDetection: packageDetection(),
			tools: tools({installedAgents: agentIds, caddy: true}),
			flags: {
				prefix: 'flagged',
				pm: 'bun',
				tmux: true,
				agents: 'pi,antigravity',
				copyIgnored: false,
				server: true,
				caddy: false,
				mcAlias: false,
			},
		});

		expect(result.kind).toBe('complete');
		expect(result.questions).toEqual([]);
		if (result.kind === 'complete') {
			expect(result.settings).toMatchObject({
				prefix: 'flagged',
				pm: 'bun',
				agents: ['antigravity', 'pi'],
				copyIgnored: false,
				caddy: false,
				mcAlias: false,
			});
		}
	});

	test('--yes accepts npm Next.js defaults without opening the form', () => {
		const result = resolve({
			fixed,
			acceptDefaults: true,
			packageDetection: packageDetection(),
			tools: tools({
				installedAgents: ['claude', 'codex', 'opencode', 'copilot', 'pi'],
				caddy: true,
			}),
		});

		expect(result.kind).toBe('complete');
		if (result.kind === 'complete') {
			expect(result.settings).toMatchObject({
				prefix: 'acme-a',
				pm: 'npm',
				tmux: true,
				agents: ['claude', 'codex', 'opencode', 'copilot'],
				copyIgnored: true,
				server: true,
				caddy: true,
				mcAlias: true,
				devScript: 'dev',
				scripts: ['build', 'dev'],
			});
		}
	});

	test.each([
		[
			'flag',
			{
				defaults: {pm: 'bun'},
				packageDetection: packageDetection('pnpm'),
				existing: {pm: 'npm'},
				flags: {pm: 'bun'},
			},
			'bun',
			'flag',
		],
		[
			'existing config',
			{
				defaults: {pm: 'bun'},
				packageDetection: packageDetection('pnpm'),
				existing: {pm: 'npm'},
			},
			'npm',
			'existing',
		],
		[
			'detection',
			{defaults: {pm: 'bun'}, packageDetection: packageDetection('pnpm')},
			'pnpm',
			'detection',
		],
		['built-in default', {defaults: {pm: 'bun'}}, 'bun', 'built-in'],
	] as const)(
		'uses %s before lower-precedence values',
		(_name, options, expected, source) => {
			const result = resolve({
				fixed,
				acceptDefaults: true,
				...(options as Partial<ResolveOptions>),
			});

			expect(result.kind).toBe('complete');
			expect(result.draft.pm).toBe(expected);
			expect(result.sources.pm).toBe(source);
		},
	);

	test('keeps questions ordered and marks ambiguous package detection', () => {
		const detection = packageDetection('bun', true);
		const result = resolve({
			fixed,
			packageDetection: detection,
			tools: tools(),
		});

		expect(result.kind).toBe('questions');
		expect(result.questions.map(question => question.field)).toEqual([
			'prefix',
			'pm',
			'tmux',
			'agents',
			'copyIgnored',
			'server',
			'caddy',
			'mcAlias',
		]);
		const packageQuestion = result.questions.find(
			question => question.field === 'pm',
		);
		expect(packageQuestion).toMatchObject({needsConfirmation: true});
	});

	test('normalizes children when tmux or the server is disabled', () => {
		const result = resolve({
			fixed,
			acceptDefaults: true,
			existing: {agents: ['claude'], caddy: true},
			flags: {tmux: false, server: false},
		});

		expect(result.draft.agents).toEqual([]);
		expect(result.draft.caddy).toBe(false);
		expect(result.sources.agents).toBe('dependency');
		expect(result.sources.caddy).toBe('dependency');
	});

	test('rejects a fifth agent with the documented limit', () => {
		expect(() =>
			resolve({
				fixed,
				flags: {
					agents: 'claude,codex,opencode,copilot,pi',
				},
			}),
		).toThrow('max 4 (2×2 grid)');
	});

	test('keeps antigravity as an id and generates the agy command', () => {
		const result = resolve({
			fixed,
			acceptDefaults: true,
			flags: {agents: 'antigravity'},
		});
		expect(result.kind).toBe('complete');
		if (result.kind === 'complete') {
			expect(result.settings.agents).toEqual(['antigravity']);
			expect(compose(result.settings)).toContain('cmd=agy');
		}
	});

	test('builds a shell-safe rerun with every missing flag', () => {
		const result = resolve({fixed, tools: tools()});
		expect(result.kind).toBe('questions');
		if (result.kind === 'questions') {
			const rerun = buildRerunCommand(
				'trunk',
				['clone', 'git@example.com:org/acme admin.git'],
				result,
			);

			expect(rerun.arguments).toContain('--prefix=acme-a');
			expect(rerun.arguments).toContain('--agents=');
			expect(rerun.display).toContain("'git@example.com:org/acme admin.git'");
		}
	});

	test('non-TTY setup returns exit 2 with the exact rerun command', async () => {
		const result = await collectSettings({
			folder: '/tmp/acme-admin',
			resolveOptions: {fixed, tools: tools()},
			invocation: {
				executable: 'trunk',
				arguments: ['init', '/tmp/acme-admin'],
			},
			interactive: false,
		});

		expect(result.kind).toBe('outcome');
		if (result.kind === 'outcome') {
			expect(result.outcome.code).toBe(exitCodes.badUsage);
			expect(result.outcome.message).toContain(
				'trunk init /tmp/acme-admin --prefix=acme-a',
			);
			expect(result.outcome.message).toContain('--no-caddy');
		}
	});

	test('aborting the form exits 4 and produces no settings', async () => {
		const result = await collectSettings({
			folder: '/tmp/acme-admin',
			resolveOptions: {fixed, tools: tools()},
			invocation: {executable: 'trunk', arguments: ['init']},
			interactive: true,
			report() {
				// The Caddy install hint is not under test here.
			},
			async runForm() {
				return {kind: 'aborted'};
			},
		});

		expect(result).toEqual({
			kind: 'outcome',
			outcome: {code: exitCodes.userAborted, message: 'setup aborted'},
		});
	});

	test('passes the form settings straight through', async () => {
		const result = await collectSettings({
			folder: '/tmp/acme-admin',
			resolveOptions: {fixed, tools: tools()},
			invocation: {executable: 'trunk', arguments: ['init']},
			interactive: true,
			report() {
				// The Caddy install hint is not under test here.
			},
			async runForm({options}) {
				const resolution = resolve({...options, acceptDefaults: true});
				if (resolution.kind !== 'complete') {
					throw new Error('Expected a complete resolution.');
				}

				return {kind: 'settings', settings: resolution.settings};
			},
		});

		expect(result.kind).toBe('settings');
		if (result.kind === 'settings') {
			expect(result.settings.prefix).toBe('acme-a');
		}
	});

	test('runs the Caddy installer with the arguments it advertised', async () => {
		const calls: Array<readonly [string, readonly string[]]> = [];
		await collectSettings({
			folder: '/tmp/acme-admin',
			resolveOptions: {fixed, tools: tools({brew: true})},
			invocation: {executable: 'trunk', arguments: ['init']},
			interactive: true,
			report() {
				// The install hint is not under test here.
			},
			async askInstall() {
				return 'yes';
			},
			async installCaddy(executable, arguments_) {
				calls.push([executable, arguments_]);
				return false;
			},
			async runForm() {
				return {kind: 'aborted'};
			},
		});

		expect(calls).toEqual([['/tools/brew', ['install', 'caddy']]]);
	});

	test('falls back to flags when the terminal cannot read keys', async () => {
		const result = await collectSettings({
			folder: '/tmp/acme-admin',
			resolveOptions: {fixed, tools: tools()},
			invocation: {
				executable: 'trunk',
				arguments: ['init', '/tmp/acme-admin'],
			},
			interactive: true,
			report() {
				// The Caddy install hint is not under test here.
			},
			// Ink cannot put a pipe into raw mode; the form reports that rather
			// than letting React surface a component stack.
			async runForm() {
				return {kind: 'unavailable', reason: 'stdin is not a terminal'};
			},
		});

		expect(result.kind).toBe('outcome');
		if (result.kind === 'outcome') {
			expect(result.outcome.code).toBe(exitCodes.badUsage);
			expect(result.outcome.message).toContain('stdin is not a terminal');
			expect(result.outcome.message).toContain(
				'trunk init /tmp/acme-admin --prefix=acme-a',
			);
		}
	});

	test('--yes never invokes the Caddy installer', async () => {
		let installCalls = 0;
		const result = await collectSettings({
			folder: '/tmp/acme-admin',
			resolveOptions: {fixed, tools: tools({brew: true})},
			invocation: {executable: 'trunk', arguments: ['init']},
			yes: true,
			interactive: false,
			async installCaddy() {
				installCalls += 1;
				return true;
			},
		});

		expect(result.kind).toBe('settings');
		expect(installCalls).toBe(0);
	});

	test('turns invalid scripted flags into a usage outcome', async () => {
		const result = await collectSettings({
			folder: '/tmp/acme-admin',
			resolveOptions: {
				fixed,
				flags: {agents: 'claude,codex,opencode,copilot,pi'},
			},
			invocation: {executable: 'trunk', arguments: ['init']},
			interactive: false,
		});

		expect(result).toEqual({
			kind: 'outcome',
			outcome: {code: exitCodes.badUsage, message: 'max 4 (2×2 grid)'},
		});
	});
});

function packageDetection(
	packageManager: 'npm' | 'pnpm' | 'bun' = 'npm',
	needsConfirmation = false,
): PackageDetection {
	return Object.freeze({
		packageManager,
		matches: Object.freeze([
			Object.freeze({file: 'package-lock.json', packageManager}),
		]),
		ambiguous: needsConfirmation,
		needsConfirmation,
		scripts: Object.freeze(['build', 'dev']),
		packageJson: 'package.json',
		warnings: Object.freeze([]),
	});
}

function tools(
	options: Readonly<{
		installedAgents?: readonly AgentId[];
		caddy?: boolean;
		brew?: boolean;
	}> = {},
): NonNullable<ResolveOptions['tools']> {
	const installed = new Set(options.installedAgents ?? []);
	return Object.freeze({
		tmux: tool('tmux', true),
		caddy: tool('caddy', options.caddy ?? false),
		brew: tool('brew', options.brew ?? false),
		agents: Object.freeze(
			Object.fromEntries(
				agentIds.map(id => [id, tool(id, installed.has(id))]),
			) as Record<AgentId, ReturnType<typeof tool>>,
		),
	});
}

function tool(name: string, found: boolean) {
	return Object.freeze(found ? {name, path: `/tools/${name}`} : {name});
}
