/**
 * Trunk has no network of its own. `clone` reaches a remote only by running
 * git, and everything else, `trunk-cli docs` included, works from what is on disk.
 * This guards that by refusing any network API in the source.
 */
import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, test} from 'bun:test';

const sourceRoot = fileURLToPath(new URL('../source/', import.meta.url));

async function sourceFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, {withFileTypes: true});
	const nested = await Promise.all(
		entries.map(async entry =>
			entry.isDirectory()
				? sourceFiles(join(directory, entry.name))
				: [join(directory, entry.name)],
		),
	);
	return nested.flat();
}

describe('offline', () => {
	test('no source file uses a network API', async () => {
		const files = await sourceFiles(sourceRoot);
		expect(files.length).toBeGreaterThan(30);

		for (const file of files) {
			// eslint-disable-next-line no-await-in-loop
			const contents = await readFile(file, 'utf8');
			expect(contents, file).not.toMatch(
				/from 'node:(?:http|https|http2|net|dns|tls|dgram)'|\bfetch\(|XMLHttpRequest|new WebSocket/,
			);
		}
	});

	test('the package has no runtime dependency that speaks to a network', async () => {
		const packageJson = JSON.parse(
			await readFile(join(sourceRoot, '..', 'package.json'), 'utf8'),
		) as {dependencies: Record<string, string>};

		expect(Object.keys(packageJson.dependencies).sort()).toEqual([
			'ink',
			'meow',
			'react',
		]);
	});
});
