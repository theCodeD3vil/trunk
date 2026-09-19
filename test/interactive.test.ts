import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, test} from 'bun:test';
import {importInteractive} from '../source/core/interactive.js';

const sourceRoot = fileURLToPath(new URL('../source/', import.meta.url));
const original = process.env['CI'];

afterEach(() => {
	if (original === undefined) {
		delete process.env['CI'];
	} else {
		process.env['CI'] = original;
	}
});

describe('importInteractive', () => {
	test('switches CI detection off while the module loads', async () => {
		process.env['CI'] = 'true';
		let seen: string | undefined;

		await importInteractive(async () => {
			seen = process.env['CI'];
		});

		// Ink reads `CI=false` as "not in CI", but only when it is set at load time.
		expect(seen).toBe('false');
	});

	test('puts a CI value the user exported back afterwards', async () => {
		process.env['CI'] = 'true';

		await importInteractive(async () => undefined);

		expect(process.env['CI']).toBe('true');
	});

	test('leaves CI unset when it was unset', async () => {
		delete process.env['CI'];

		await importInteractive(async () => undefined);

		expect(Object.hasOwn(process.env, 'CI')).toBe(false);
	});

	test('restores the environment when the import fails, and passes the error on', async () => {
		process.env['CI'] = 'true';

		let failure: unknown;
		try {
			await importInteractive(async () => {
				throw new Error('could not load');
			});
		} catch (error: unknown) {
			failure = error;
		}

		expect((failure as Error).message).toBe('could not load');
		expect(process.env['CI']).toBe('true');
	});

	test('returns what the import produced', async () => {
		expect(await importInteractive(async () => 42)).toBe(42);
	});
});

describe('Ink is never loaded ahead of the guard', () => {
	async function files(directory: string): Promise<string[]> {
		const entries = await readdir(directory, {withFileTypes: true});
		const nested = await Promise.all(
			entries.map(async entry =>
				entry.isDirectory()
					? files(join(directory, entry.name))
					: [join(directory, entry.name)],
			),
		);
		return nested.flat();
	}

	test('nothing outside ui/ imports a UI module, or Ink, except as a type', async () => {
		const everything = await files(sourceRoot);
		const outside = everything.filter(file => !file.includes('/source/ui/'));
		expect(outside.length).toBeGreaterThan(20);

		for (const file of outside) {
			// eslint-disable-next-line no-await-in-loop
			const contents = await readFile(file, 'utf8');
			const staticImports = [
				...contents.matchAll(/^import (?!type\b)[^;]*?from '([^']+)';/gms),
			].map(match => match[1]!);

			for (const specifier of staticImports) {
				expect(
					specifier === 'ink' || /(?:^|\/)ui\//.test(specifier),
					`${file} statically imports ${specifier}`,
				).toBe(false);
			}
		}
	});

	test('the UI is only reached through importInteractive', async () => {
		// Cli.tsx loads the setup UI and commands/docs.ts loads the docs browser.
		for (const file of ['cli.tsx', 'commands/docs.ts']) {
			// eslint-disable-next-line no-await-in-loop
			const contents = await readFile(join(sourceRoot, file), 'utf8');

			expect(contents, file).toContain('importInteractive');
			expect(contents, file).toMatch(/import\('\.{1,2}\/ui\//);
		}
	});
});
