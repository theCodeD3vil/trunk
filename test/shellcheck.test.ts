import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, describe, expect, test} from 'bun:test';
import {compose} from '../source/core/generate/index.js';
import {assertShellTemplate} from '../source/core/generate/toml.js';
import {resolveExecutable} from '../source/core/env.js';
import {runCommand} from '../source/core/process.js';
import {generatedCommands, type GeneratedCommand} from './helpers/generated.js';
import {generatorCases} from './helpers/generator-cases.js';

/**
 * Warnings that are intentional in a specific body, declared here rather than
 * as `# shellcheck disable=` lines in the generated file, which the user reads.
 *
 * - SC2016: the `mc` alias passes a single-quoted script through to Worktrunk.
 * - SC2046/SC2086: word splitting is the point when iterating command output
 *   and when expanding the collected pid list or `$WT_AGENTS`.
 */
const shellcheckExclusions: Readonly<Record<string, readonly string[]>> =
	Object.fromEntries([
		['alias:mc', ['SC2016']],
		['pre-start:tmux', ['SC2046', 'SC2086']],
		['pre-remove:tmux', ['SC2046', 'SC2086']],
	]);

describe('generated POSIX shell', () => {
	const temporaryDirectory = mkdtemp(join(tmpdir(), 'trunk-shellcheck-'));

	afterAll(async () => {
		await rm(await temporaryDirectory, {recursive: true, force: true});
	});

	test('contains only intentional Worktrunk expressions', () => {
		for (const [, settings] of generatorCases) {
			for (const command of generatedCommands(compose(settings))) {
				expect(command.body).not.toContain("'''");
				expect(command.body).not.toContain('${#');
				expect(command.body).not.toContain('{#');
				expect(() => {
					assertShellTemplate(command.body);
				}).not.toThrow();
			}
		}
	});

	test('passes shellcheck -s sh for every generated body', async () => {
		const shellcheck = await resolveExecutable('shellcheck');
		expect(shellcheck).toBeDefined();
		if (!shellcheck) {
			return;
		}

		const directory = await temporaryDirectory;
		const checks = generatorCases.flatMap(([caseName, settings]) =>
			generatedCommands(compose(settings)).map(async command => {
				await checkCommand(shellcheck, directory, caseName, command);
			}),
		);
		await Promise.all(checks);
	});
});

async function checkCommand(
	shellcheck: string,
	directory: string,
	caseName: string,
	command: GeneratedCommand,
): Promise<void> {
	await Promise.all(
		renderVariants(command.body).map(async (body, index) => {
			const name = `${caseName}-${command.label}-${index}`.replaceAll(
				/[^a-z\d-]+/gi,
				'-',
			);
			const path = join(directory, `${name}.sh`);
			await writeFile(path, `#!/bin/sh\n${body}\n`);
			const exclusions = shellcheckExclusions[command.label] ?? [];
			const arguments_ = ['-s', 'sh'];
			if (exclusions.length > 0) {
				arguments_.push('-e', exclusions.join(','));
			}

			const result = await runCommand(shellcheck, [...arguments_, path]);
			expect(
				result.code,
				`${caseName} ${command.label}\n${result.stdout}${result.stderr}`,
			).toBe(0);
		}),
	);
}

/** Substitutes the only templates a generated body may contain. */
function renderVariants(body: string): string[] {
	return [
		body
			.split('{{ branch | sanitize }}')
			.join('feature-demo')
			.split('{{ worktree_path }}')
			.join('/tmp/project/feature-demo'),
	];
}
