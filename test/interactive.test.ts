import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, test} from 'bun:test';
import {colourLevel, importInteractive} from '../source/core/interactive.js';

const sourceRoot = fileURLToPath(new URL('../source/', import.meta.url));
const {emitWarning} = process;

afterEach(() => {
	process.emitWarning = emitWarning;
});

/** A terminal that answers for the environment it is given, as Node's does. */
function terminal(depth: (environment: NodeJS.ProcessEnv) => number) {
	return {getColorDepth: depth};
}

/** An environment from name/value pairs, so the names can stay upper case. */
const env = (...pairs: Array<[string, string]>): NodeJS.ProcessEnv =>
	Object.fromEntries(pairs);

describe('colour level', () => {
	test('ignores CI, which says nothing about the terminal in front of the user', () => {
		// Node says "no colour" whenever CI exists.
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
});

describe('importInteractive', () => {
	/** Records what reaches Node's own warning output. */
	function printedWarnings(): string[] {
		const printed: string[] = [];
		process.emitWarning = ((warning: string | Error) => {
			printed.push(String(warning));
		}) as typeof process.emitWarning;
		return printed;
	}

	test('silences the experimental-FFI warning and nothing else', async () => {
		const printed = printedWarnings();

		await importInteractive(async () => {
			process.emitWarning(
				'FFI is an experimental feature and might change at any time',
				'ExperimentalWarning',
			);
			process.emitWarning('something else', 'ExperimentalWarning');
		});

		expect(printed).toEqual(['something else']);
	});

	test('hides DEV while the UI loads, so it never dials React DevTools', async () => {
		const environment = env(['DEV', 'true']);
		let during: string | undefined = 'unset';

		await importInteractive(async () => {
			during = environment['DEV'];
		}, environment);

		expect(during).toBeUndefined();
		expect(environment).toEqual(env(['DEV', 'true']));
	});

	test('returns what the import produced, and passes a failure on', async () => {
		expect(await importInteractive(async () => 42)).toBe(42);
		let failure: unknown;
		try {
			await importInteractive(async () => {
				throw new Error('could not load');
			});
		} catch (error: unknown) {
			failure = error;
		}

		expect((failure as Error).message).toBe('could not load');
	});
});

describe('the UI is never loaded ahead of the guard', () => {
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

	test('nothing outside ui/ imports a UI module, or OpenTUI, except as a type', async () => {
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
					specifier.startsWith('@opentui/') || /(?:^|\/)ui\//.test(specifier),
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
