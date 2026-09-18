import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {describe, expect, test} from 'bun:test';
import {compose, expectedHooks} from '../source/core/generate/index.js';
import {assertSettings} from '../source/core/settings.js';
import {generatedCommands, parseGenerated} from './helpers/generated.js';
import {generatorCases} from './helpers/generator-cases.js';
import {testSettings} from './helpers/settings.js';

const snapshotDirectory = fileURLToPath(new URL('snapshots/', import.meta.url));

/** Words that would mean trunk had started modelling a project's stack again. */
const stackVocabulary =
	/\b(npm|pnpm|yarn|bun|node|caddy|brew|localhost|proxy|hash_port|remote_repo|package\.json|lockfile|dev server|--port)\b/i;

describe('wt.toml generator', () => {
	for (const [name, settings] of generatorCases) {
		test(`matches ${name} snapshot`, async () => {
			const generated = compose(settings);
			const snapshotPath = join(snapshotDirectory, `${name}.toml`);
			if (process.env['UPDATE_SNAPSHOTS'] === '1') {
				await mkdir(dirname(snapshotPath), {recursive: true});
				await writeFile(snapshotPath, generated);
			}

			expect(generated).toBe(await readFile(snapshotPath, 'utf8'));
			expect(compose(settings)).toBe(generated);
			expect(() => {
				parseGenerated(generated);
			}).not.toThrow();
		});

		test(`${name} carries no stack-specific content, live or commented`, () => {
			expect(compose(settings)).not.toMatch(stackVocabulary);
		});
	}

	test('emits only a header when everything is off', () => {
		const generated = compose(
			testSettings({
				tmux: false,
				agents: [],
				copyIgnored: false,
				mcAlias: false,
			}),
		);
		const document = parseGenerated(generated);

		expect(Object.keys(document)).toEqual([]);
		expect(
			expectedHooks(testSettings({tmux: false, copyIgnored: false})),
		).toEqual([]);
	});

	test('copies ignored files before the tmux session opens', () => {
		const document = parseGenerated(compose(testSettings()));
		const steps = document['pre-start'] as Array<Record<string, string>>;

		expect(steps.map(step => Object.keys(step))).toEqual([['copy'], ['tmux']]);
		expect(steps[0]!['copy']).toBe('wt step copy-ignored');
	});

	test('has no copy hook when copy-ignored is off', () => {
		const generated = compose(testSettings({copyIgnored: false}));

		expect(generated).not.toContain('copy-ignored');
		expect(generatedCommands(generated).map(command => command.label)).toEqual([
			'pre-start:tmux',
			'pre-remove:tmux',
			'post-remove:tmux',
			'alias:up',
			'alias:mc',
		]);
	});

	test('defines `up` only when a start hook exists', () => {
		const withHooks = parseGenerated(compose(testSettings())) as {
			aliases: Record<string, string>;
		};
		const copyOnly = parseGenerated(
			compose(testSettings({tmux: false, agents: []})),
		) as {aliases: Record<string, string>};
		const none = parseGenerated(
			compose(testSettings({tmux: false, agents: [], copyIgnored: false})),
		) as {aliases: Record<string, string>};

		expect(withHooks.aliases['up']).toBe('wt hook pre-start');
		expect(copyOnly.aliases['up']).toBe('wt hook pre-start');
		expect(none.aliases['up']).toBeUndefined();
		expect(none.aliases['mc']).toBeDefined();
	});

	test('creates the Agents window only for selected agents', () => {
		const without = compose(testSettings({agents: []}));
		const withAgents = compose(testSettings({agents: ['claude']}));

		expect(without).not.toContain('-n Agents');
		expect(without).not.toContain('WT_AGENTS');
		expect(withAgents).toContain('-n Agents');
		expect(withAgents).toContain('WT_AGENTS');
		// The layout that always exists.
		for (const generated of [without, withAgents]) {
			expect(generated).toContain('-n Editor');
			expect(generated).toContain('-n Terminal');
			expect(generated).toContain('split-window -h -t "$TERM_W"');
		}
	});

	test('leaves inherited agent environment variables alone', () => {
		const generated = compose(testSettings());

		expect(generated).not.toMatch(/\bunset\b/);
		expect(generated).not.toContain('ANTHROPIC');
		expect(generated).not.toContain('CLAUDE*');
	});

	test('stops pane processes before removal and kills the exact session after', () => {
		const document = parseGenerated(compose(testSettings())) as {
			'pre-remove': Record<string, string>;
			'post-remove': Record<string, string>;
		};
		const stop = document['pre-remove']['tmux']!;
		const kill = document['post-remove']['tmux']!;

		expect(stop).toContain('kill -TERM');
		expect(stop).toContain('kill -KILL');
		expect(stop).not.toContain('kill-session');
		// No detached, delayed command: the shutdown finishes before removal does.
		expect(stop).not.toContain('run-shell');
		expect(kill).toContain('tmux kill-session -t "=$S"');
		expect(kill).not.toContain('run-shell');
		expect(kill).toContain(`S="\${P}_$B"`);
	});

	test('names every expected hook the generated file defines', () => {
		for (const [, settings] of generatorCases) {
			const defined = new Set(
				generatedCommands(compose(settings))
					.map(command => command.label)
					.filter(label => !label.startsWith('alias:')),
			);
			const expected = expectedHooks(settings).map(
				hook => `${hook.type}:${hook.name}`,
			);

			expect([...defined].sort()).toEqual([...expected].sort());
		}
	});

	test('the header points at the docs and keeps the tmux overrides', () => {
		const header = compose(testSettings()).split('\n[')[0]!;

		expect(header).toContain('Generated by trunk 0.0.0-test on 2026-09-18');
		expect(header).toContain('edit it freely');
		expect(header).toContain('wt config approvals add');
		expect(header).toContain('trunk docs');
		for (const override of ['WT_TMUX', 'WT_AGENTS', 'WT_EDITOR']) {
			expect(header).toContain(override);
		}

		const withoutTmux = compose(testSettings({tmux: false, agents: []}));
		expect(withoutTmux).not.toContain('WT_TMUX');
	});

	test('rejects invalid settings before emitting text', () => {
		expect(() => {
			assertSettings(testSettings({generatedOn: '2026-02-30'}));
		}).toThrow('real calendar date');
		expect(() => compose(testSettings({prefix: 'Bad'}))).toThrow('lowercase');
		expect(() => compose(testSettings({tmux: false}))).toThrow(
			'Agents require the tmux session',
		);
		expect(() =>
			compose(
				testSettings({
					agents: ['claude', 'codex', 'opencode', 'copilot', 'pi'],
				}),
			),
		).toThrow('At most 4');
	});
});
