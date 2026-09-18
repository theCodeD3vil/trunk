import {describe, expect, test} from 'bun:test';
import {adoptConfig} from '../source/core/adopt.js';
import {compose} from '../source/core/generate/index.js';
import {testSettings} from './helpers/settings.js';

describe('adopting an existing config', () => {
	test('recovers everything the generator wrote', () => {
		const settings = testSettings({
			prefix: 'acme',
			pm: 'pnpm',
			agents: ['claude', 'opencode'],
			copyIgnored: true,
			server: true,
			caddy: true,
			mcAlias: true,
		});

		const adoption = adoptConfig(compose(settings));

		expect(adoption.values).toEqual({
			prefix: 'acme',
			pm: 'pnpm',
			tmux: true,
			agents: ['claude', 'opencode'],
			copyIgnored: true,
			server: true,
			caddy: true,
			mcAlias: true,
		});
		expect(adoption.notes).toEqual([]);
	});

	test('reads a step as off when its command is absent', () => {
		const adoption = adoptConfig(
			compose(
				testSettings({
					tmux: false,
					agents: [],
					copyIgnored: false,
					server: false,
					caddy: false,
					mcAlias: false,
				}),
			),
		);

		expect(adoption.values).toMatchObject({
			tmux: false,
			copyIgnored: false,
			server: false,
			caddy: false,
			mcAlias: false,
		});
		expect(adoption.values.prefix).toBeUndefined();
	});

	test('carries the copy-ignored excludes over verbatim', () => {
		const excludes = ['.next/', 'coverage/'];
		const source = compose(
			testSettings({copyIgnored: true, copyIgnoredExclude: excludes}),
		);

		expect(source).toContain(
			'[step.copy-ignored]\nexclude = [".next/", "coverage/"]',
		);
		expect(adoptConfig(source).copyIgnoredExclude).toEqual(excludes);
	});

	test('reads a hand-written config that trunk did not generate', () => {
		const adoption = adoptConfig(handWritten);

		expect(adoption.values).toMatchObject({
			prefix: 'acme',
			pm: 'npm',
			tmux: true,
			agents: ['claude', 'opencode'],
			copyIgnored: true,
			server: true,
			caddy: true,
			mcAlias: true,
		});
		expect(adoption.copyIgnoredExclude).toEqual(['.next/']);
	});

	test('keeps going when the file cannot be parsed', () => {
		const adoption = adoptConfig('[[[ not toml');

		expect(adoption.values).toEqual({});
		expect(adoption.notes[0]?.message).toContain('could not be parsed');
	});

	test('notes what it could not read instead of guessing', () => {
		const adoption = adoptConfig(
			[
				'[[pre-start]]',
				'tmux = """',
				agentLoop('claude nonesuch'),
				'"""',
				'',
				'[[post-start]]',
				'install = "make setup"',
			].join('\n'),
		);

		expect(adoption.values.prefix).toBeUndefined();
		expect(adoption.values.pm).toBeUndefined();
		expect(adoption.values.agents).toEqual(['claude']);
		expect(adoption.notes.map(note => note.field)).toEqual([
			'prefix',
			'agents',
			'pm',
		]);
	});

	test('keeps only the first four agents', () => {
		const adoption = adoptConfig(
			[
				'[[pre-start]]',
				'tmux = """',
				'P=acme',
				agentLoop('claude codex opencode copilot pi'),
				'"""',
			].join('\n'),
		);

		expect(adoption.values.agents).toEqual([
			'claude',
			'codex',
			'opencode',
			'copilot',
		]);
		expect(adoption.notes[0]?.message).toContain('keeping the first 4');
	});
});

/** Shaped like a config written by hand before trunk existed. */
/** The generated agent loop, whose default list adoption reads. */
function agentLoop(defaults: string): string {
	return `for a in \${WT_AGENTS-${defaults}}; do :; done`;
}

const handWritten = `# Worktree automation
[aliases]
mc = "wt merge"

[[pre-start]]
tmux = '''
P='acme'
for a in \${WT_AGENTS-claude opencode}; do
  tmux send-keys "$a" Enter
done
'''

[[post-start]]
copy = "wt step copy-ignored"

[[post-start]]
install = "npm install --prefer-offline"
server = "wt step tether -- npm run dev"
proxy = '''
curl -sfX PUT http://localhost:2019/config/
'''

[step.copy-ignored]
exclude = [".next/"]
`;
