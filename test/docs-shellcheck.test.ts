/**
 * ShellCheck over everything the documentation tells a reader to run: every
 * command inside a TOML fragment, with Worktrunk's templates filled in, and
 * every shell snippet. Generated hook bodies are checked in shellcheck.test.ts;
 * this covers the documented ones, such as the Caddy route.
 */
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, describe, expect, test} from 'bun:test';
import {resolveExecutable} from '../source/core/env.js';
import {runCommand} from '../source/core/process.js';
import {
	allSnippets,
	commandStrings,
	parseFragment,
	type Snippet,
} from './helpers/docs.js';

/** Fills Worktrunk's templates with plausible values, the way a hook run would. */
function render(command: string): string {
	return command
		.replaceAll("{{ (remote_repo ~ '/' ~ branch) | hash_port }}", '12345')
		.replaceAll('{{ remote_repo | lower }}', 'web-shop--portal')
		.replaceAll('{{ branch | sanitize }}', 'feature-demo')
		.replaceAll('{{ worktree_path }}', '/tmp/project/feature-demo')
		.replaceAll(/{{[^}]*}}/g, 'value');
}

/** The scripts a snippet would run. Values that are not commands are skipped. */
function scripts({block}: Snippet): string[] {
	if (block.language === 'sh') {
		return [block.code];
	}

	const parsed = parseFragment(block.code, block.placement);
	// `[list] url` is an address for `wt list`, not something a shell runs.
	const runnable = Object.fromEntries(
		Object.entries(parsed).filter(([key]) => key !== 'list'),
	);
	return commandStrings(runnable).map(command => render(command));
}

describe('documented snippets pass ShellCheck', () => {
	const directory = mkdtemp(join(tmpdir(), 'trunk-docs-shellcheck-'));

	afterAll(async () => {
		await rm(await directory, {recursive: true, force: true});
	});

	test('there is something to check', () => {
		const total = allSnippets.flatMap(snippet => scripts(snippet));

		expect(total.length).toBeGreaterThan(20);
		// The long Caddy route body is among them.
		expect(total.some(script => script.includes('reverse_proxy'))).toBe(true);
	});

	for (const [index, snippet] of allSnippets.entries()) {
		test(`${snippet.topic.id}/${snippet.sectionId}: ${snippet.block.label}`, async () => {
			const shellcheck = await resolveExecutable('shellcheck');
			expect(shellcheck).toBeDefined();
			if (!shellcheck) {
				return;
			}

			const root = await directory;
			for (const [position, script] of scripts(snippet).entries()) {
				const path = join(root, `snippet-${index}-${position}.sh`);
				// eslint-disable-next-line no-await-in-loop
				await writeFile(path, `#!/bin/sh\n${script}\n`);
				// eslint-disable-next-line no-await-in-loop
				const result = await runCommand(shellcheck, ['-s', 'sh', path]);

				expect(result.code, `${script}\n${result.stdout}${result.stderr}`).toBe(
					0,
				);
			}
		});
	}
});
