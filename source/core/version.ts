/**
 * Trunk's own version, for the header of every generated config.
 *
 * Read from package.json rather than generated into the source: npm always
 * includes package.json in the published tarball, so it is there at run time,
 * and a generated file would have to be either committed and kept in sync or
 * gitignored — and a gitignored file is invisible to type-aware linting, which
 * is exactly how this broke before.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

let cached: string | undefined;

/** The package version, or `0.0.0` when package.json cannot be read. */
export function trunkVersion(): string {
	cached ??= readVersion();
	return cached;
}

function readVersion(): string {
	// `source/core/` and the built `dist/core/` both sit two levels below the
	// package root, so one path serves the tests and the published CLI.
	const packagePath = fileURLToPath(
		new URL('../../package.json', import.meta.url),
	);
	try {
		const parsed: unknown = JSON.parse(readFileSync(packagePath, 'utf8'));
		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			'version' in parsed &&
			typeof parsed.version === 'string'
		) {
			return parsed.version;
		}
	} catch {
		// Falls through to the placeholder below.
	}

	return '0.0.0';
}
