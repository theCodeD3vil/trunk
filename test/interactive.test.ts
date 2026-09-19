import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, test} from 'bun:test';
import {colourLevel, importInteractive} from '../source/core/interactive.js';

const sourceRoot = fileURLToPath(new URL('../source/', import.meta.url));
const original = process.env['CI'];

afterEach(() => {
	if (original === undefined) {
		delete process.env['CI'];
	} else {
		process.env['CI'] = original;
	}
});

/** A terminal that answers for the environment it is given, as Node's does. */
function terminal(depth: (environment: NodeJS.ProcessEnv) => number) {
	return {getColorDepth: depth};
}

/** An environment from name/value pairs, so the names can stay upper case. */
const env = (...pairs: Array<[string, string]>): NodeJS.ProcessEnv =>
	Object.fromEntries(pairs);

describe('colour under the CI override', () => {
	test('the colour level ignores CI, which is only set to silence Ink', () => {
		// Node, like Ink's colour library, says "no colour" whenever CI exists.
		const depth = (environment: NodeJS.ProcessEnv) =>
			'CI' in environment ? 1 : 24;

		expect(colourLevel(terminal(depth), env(['CI', 'false']))).toBe(3);
		expect(colourLevel(terminal(depth), env(['CI', 'true']))).toBe(3);
	});

	test('maps the terminal depth to chalk levels', () => {
		const at = (bits: number) =>
			colourLevel(
				terminal(() => bits),
				env(),
			);

		expect([at(24), at(8), at(4), at(1)]).toEqual([3, 2, 1, 0]);
		// A stream that cannot say, such as a pipe, gets no colour.
		expect(colourLevel({}, env())).toBe(0);
	});

	test('pins the level for the import, then restores what the user had', async () => {
		const environment = env(['CI', 'true']);
		let during: Array<string | undefined> = [];

		await importInteractive(
			async () => {
				during = [environment['CI'], environment['FORCE_COLOR']];
			},
			terminal(() => 24),
			environment,
		);

		// Ink sees CI=false, and its colour library sees a truecolor terminal.
		expect(during).toEqual(['false', '3']);
		expect(environment).toEqual(env(['CI', 'true']));
	});

	test('does not override a FORCE_COLOR the user set', async () => {
		const environment = env(['FORCE_COLOR', '1']);
		let during: string | undefined;

		await importInteractive(
			async () => {
				during = environment['FORCE_COLOR'];
			},
			terminal(() => 24),
			environment,
		);

		expect(during).toBe('1');
		expect(environment['FORCE_COLOR']).toBe('1');
	});

	test('asks for no colour when the terminal offers none, as with NO_COLOR', async () => {
		const environment = env(['NO_COLOR', '1']);
		let during: string | undefined;

		await importInteractive(
			async () => {
				during = environment['FORCE_COLOR'];
			},
			terminal(() => 1),
			environment,
		);

		expect(during).toBeUndefined();
	});
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
