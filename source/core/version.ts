/**
 * Trunk's own version, read from the package it ships in. The generated config
 * records which version wrote it, so this has to be the real published number
 * rather than a constant that can drift.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

let cached: string | undefined;

/** The version from package.json, or `0.0.0` when it cannot be read. */
export function trunkVersion(): string {
	cached ??= readVersion();
	return cached;
}

function readVersion(): string {
	// Both `source/core/` and the built `dist/core/` sit two levels below the
	// package root, so one path works for tests and for the published CLI.
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
