import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {describe, expect, test} from 'bun:test';
import {compose} from '../source/core/generate/index.js';
import {serverCommand} from '../source/core/generate/steps.js';
import {assertSettings} from '../source/core/settings.js';
import {generatedCommands, parseGenerated} from './helpers/generated.js';
import {generatorCases} from './helpers/generator-cases.js';
import {testSettings} from './helpers/settings.js';

const snapshotDirectory = fileURLToPath(new URL('snapshots/', import.meta.url));

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
	}

	test('omits every disabled table and ignores caddy without a server', () => {
		const generated = compose(
			testSettings({
				tmux: false,
				agents: [],
				copyIgnored: false,
				server: false,
				caddy: true,
				mcAlias: false,
			}),
		);
		const document = parseGenerated(generated);

		expect(document['aliases']).toBeUndefined();
		expect(document['pre-start']).toBeUndefined();
		expect(document['pre-remove']).toBeUndefined();
		expect(document['step']).toBeUndefined();
		expect(document['list']).toBeUndefined();
		expect(generatedCommands(generated).map(command => command.label)).toEqual([
			'post-start:install',
		]);
	});

	test('keeps the whole dev server inside the tether', () => {
		for (const pm of ['npm', 'pnpm', 'bun'] as const) {
			const command = serverCommand(testSettings({pm, appDir: 'apps/web'}));
			const tethered = command.slice('wt step tether -- '.length);

			expect(command.startsWith('wt step tether -- ')).toBe(true);
			// A shell operator here would end the tethered command early.
			expect(tethered).not.toContain('&&');
			expect(tethered).not.toContain(';');
			expect(tethered).toContain('apps/web');
		}
	});

	test('uses literal list host and remote-repo Caddy identity', () => {
		const generated = compose(testSettings());

		expect(generated).toContain(
			'url = "http://{{ branch | sanitize }}.web-shop--portal.localhost:8080"',
		);
		expect(generated).toContain(
			'ID=wt:{{ remote_repo | lower }}:{{ branch | sanitize }}',
		);
	});

	test('rejects invalid settings before emitting text', () => {
		expect(() => {
			assertSettings(testSettings({generatedOn: '2026-02-30'}));
		}).toThrow('real calendar date');
		expect(() => compose(testSettings({hostLabel: 'different'}))).toThrow(
			'lowercase repoName',
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
