import {access, readdir, readFile} from 'node:fs/promises';
import {join, relative, sep} from 'node:path';

export type PackageManager = 'npm' | 'pnpm' | 'bun';
export type LockfilePackageManager = PackageManager | 'yarn';

export type LockfileMatch = Readonly<{
	file: string;
	packageManager: LockfilePackageManager;
}>;

export type PackageDetection = Readonly<{
	packageManager: PackageManager;
	matches: readonly LockfileMatch[];
	ambiguous: boolean;
	needsConfirmation: boolean;
	scripts: readonly string[];
	appDir?: string;
	packageJson?: string;
	warnings: readonly string[];
}>;

const lockfiles: ReadonlyArray<
	Readonly<{file: string; packageManager: LockfilePackageManager}>
> = [
	{file: 'bun.lock', packageManager: 'bun'},
	{file: 'bun.lockb', packageManager: 'bun'},
	{file: 'pnpm-lock.yaml', packageManager: 'pnpm'},
	{file: 'package-lock.json', packageManager: 'npm'},
	{file: 'yarn.lock', packageManager: 'yarn'},
];

export async function detectPackageManager(
	worktreeRoot: string,
): Promise<PackageDetection> {
	const warnings: string[] = [];
	const packageDirectories = await findPackageDirectories(worktreeRoot);
	const packageDirectory = packageDirectories[0] ?? worktreeRoot;

	if (packageDirectories.length > 1) {
		warnings.push(
			`Multiple package directories found (${packageDirectories
				.map(directory => relativePath(worktreeRoot, directory))
				.join(', ')}); using ${relativePath(worktreeRoot, packageDirectory)}.`,
		);
	}

	// The lockfile usually sits with the package.json, but a repository whose app
	// lives one level down often keeps it at the root instead. Search both, and
	// let the deeper directory win when each has one.
	const searchDirectories =
		packageDirectory === worktreeRoot
			? [packageDirectory]
			: [packageDirectory, worktreeRoot];
	const matchesByDirectory = await Promise.all(
		searchDirectories.map(async directory =>
			findLockfiles(directory, worktreeRoot),
		),
	);
	const matches = matchesByDirectory.flat();
	const chosen = matchesByDirectory.find(found => found.length > 0) ?? [];

	const supportedMatch = chosen.find(
		(match): match is LockfileMatch & {packageManager: PackageManager} =>
			match.packageManager !== 'yarn',
	);
	const yarnFound = chosen.some(match => match.packageManager === 'yarn');
	const packageManager = supportedMatch?.packageManager ?? 'npm';
	const ambiguous = new Set(chosen.map(match => match.packageManager)).size > 1;

	if (chosen.length > 1) {
		warnings.push(
			`Multiple lockfiles found (${chosen
				.map(match => match.file)
				.join(', ')}); using ${packageManager}.`,
		);
	}

	if (chosen.length > 0 && chosen !== matchesByDirectory[0]) {
		warnings.push(
			`Lockfile ${
				chosen[0]!.file
			} sits at the repository root while package.json is in ${relativePath(
				worktreeRoot,
				packageDirectory,
			)}.`,
		);
	}

	if (yarnFound) {
		warnings.push('Yarn is unsupported; falling back to npm when needed.');
	}

	if (matches.length === 0) {
		warnings.push('No lockfile found; defaulting to npm.');
	}

	const packageJsonPath = join(packageDirectory, 'package.json');
	const packageJsonFound = await pathExists(packageJsonPath);
	const scripts = packageJsonFound
		? await readScripts(packageJsonPath, warnings)
		: [];
	const appDirectory =
		packageDirectories.length > 0 && packageDirectory !== worktreeRoot
			? relativePath(worktreeRoot, packageDirectory)
			: undefined;

	return Object.freeze({
		packageManager,
		matches: Object.freeze(matches),
		ambiguous,
		needsConfirmation:
			chosen.length !== 1 || yarnFound || packageDirectories.length > 1,
		scripts: Object.freeze(scripts),
		appDir: appDirectory,
		packageJson: packageJsonFound
			? relativePath(worktreeRoot, packageJsonPath)
			: undefined,
		warnings: Object.freeze(warnings),
	});
}

async function findLockfiles(
	directory: string,
	worktreeRoot: string,
): Promise<LockfileMatch[]> {
	const found = await Promise.all(
		lockfiles.map(async lockfile => {
			const path = join(directory, lockfile.file);
			return (await pathExists(path))
				? Object.freeze({
						file: relativePath(worktreeRoot, path),
						packageManager: lockfile.packageManager,
				  })
				: undefined;
		}),
	);

	return found.filter((match): match is LockfileMatch => match !== undefined);
}

async function findPackageDirectories(root: string): Promise<string[]> {
	if (await pathExists(join(root, 'package.json'))) {
		return [root];
	}

	let entries;
	try {
		entries = await readdir(root, {withFileTypes: true});
	} catch (error: unknown) {
		if (isMissingFileError(error)) {
			return [];
		}

		throw error;
	}

	const directories = entries
		.filter(
			entry =>
				entry.isDirectory() &&
				!entry.name.startsWith('.') &&
				entry.name !== 'node_modules',
		)
		.map(entry => entry.name)
		.sort((left, right) => left.localeCompare(right));
	const candidates = await Promise.all(
		directories.map(async directory => {
			const path = join(root, directory);
			return (await pathExists(join(path, 'package.json'))) ? path : undefined;
		}),
	);

	return candidates.filter(
		(candidate): candidate is string => candidate !== undefined,
	);
}

async function readScripts(
	path: string,
	warnings: string[],
): Promise<string[]> {
	try {
		const value: unknown = JSON.parse(await readFile(path, 'utf8'));
		if (!isRecord(value) || !isRecord(value['scripts'])) {
			return [];
		}

		return Object.entries(value['scripts'])
			.filter(
				(entry): entry is [string, string] => typeof entry[1] === 'string',
			)
			.map(([name]) => name)
			.sort((left, right) => left.localeCompare(right));
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		warnings.push(`Could not read ${path}: ${message}`);
		return [];
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch (error: unknown) {
		if (isMissingFileError(error)) {
			return false;
		}

		throw error;
	}
}

function isMissingFileError(error: unknown): boolean {
	if (!(error instanceof Error) || !('code' in error)) {
		return false;
	}

	return error.code === 'ENOENT' || error.code === 'ENOTDIR';
}

function relativePath(root: string, path: string): string {
	const value = relative(root, path).split(sep).join('/');
	return value || '.';
}
