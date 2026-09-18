import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, test} from 'bun:test';
import {detectPackageManager} from '../source/core/detect.js';

describe('package-manager detection', () => {
	const temporaryDirectories: string[] = [];

	afterEach(async () => {
		await Promise.all(
			temporaryDirectories
				.splice(0)
				.map(async directory => rm(directory, {recursive: true, force: true})),
		);
	});

	test.each([
		['package-lock.json', 'npm'],
		['pnpm-lock.yaml', 'pnpm'],
		['bun.lock', 'bun'],
		['bun.lockb', 'bun'],
	] as const)('detects %s as %s', async (lockfile, expected) => {
		const root = await createFixture();
		await writeFile(join(root, lockfile), '');

		const detection = await detectPackageManager(root);

		expect(detection.packageManager).toBe(expected);
		expect(detection.matches).toEqual([
			{file: lockfile, packageManager: expected},
		]);
		expect(detection.needsConfirmation).toBe(false);
		expect(detection.scripts).toEqual(['build', 'dev']);
	});

	test('reports ambiguity and uses bun before pnpm and npm', async () => {
		const root = await createFixture();
		await Promise.all([
			writeFile(join(root, 'package-lock.json'), ''),
			writeFile(join(root, 'pnpm-lock.yaml'), ''),
			writeFile(join(root, 'bun.lock'), ''),
		]);

		const detection = await detectPackageManager(root);

		expect(detection.packageManager).toBe('bun');
		expect(detection.matches.map(match => match.packageManager)).toEqual([
			'bun',
			'pnpm',
			'npm',
		]);
		expect(detection.ambiguous).toBe(true);
		expect(detection.needsConfirmation).toBe(true);
		expect(detection.warnings[0]).toContain('Multiple lockfiles');
	});

	test('finds an app one level below the root', async () => {
		const root = await createFixture(false);
		const backend = join(root, 'backend');
		await mkdir(backend);
		await writePackageJson(backend);
		await writeFile(join(backend, 'pnpm-lock.yaml'), '');

		const detection = await detectPackageManager(root);

		expect(detection.packageManager).toBe('pnpm');
		expect(detection.appDir).toBe('backend');
		expect(detection.packageJson).toBe('backend/package.json');
		expect(detection.matches[0]?.file).toBe('backend/pnpm-lock.yaml');
	});

	test('uses a root lockfile when the app is one level below it', async () => {
		const root = await createFixture(false);
		const backend = join(root, 'backend');
		await mkdir(backend);
		await writePackageJson(backend);
		await writeFile(join(root, 'pnpm-lock.yaml'), '');

		const detection = await detectPackageManager(root);

		expect(detection.packageManager).toBe('pnpm');
		expect(detection.appDir).toBe('backend');
		expect(detection.matches).toEqual([
			{file: 'pnpm-lock.yaml', packageManager: 'pnpm'},
		]);
		expect(detection.needsConfirmation).toBe(false);
		expect(detection.warnings.join('\n')).toContain(
			'sits at the repository root',
		);
	});

	test('prefers the app lockfile over the one at the root', async () => {
		const root = await createFixture(false);
		const backend = join(root, 'backend');
		await mkdir(backend);
		await writePackageJson(backend);
		await Promise.all([
			writeFile(join(root, 'package-lock.json'), ''),
			writeFile(join(backend, 'bun.lock'), ''),
		]);

		const detection = await detectPackageManager(root);

		expect(detection.packageManager).toBe('bun');
		expect(detection.matches.map(match => match.file)).toEqual([
			'backend/bun.lock',
			'package-lock.json',
		]);
		expect(detection.ambiguous).toBe(false);
		expect(detection.needsConfirmation).toBe(false);
	});

	test('does not treat two bun lockfiles as ambiguous', async () => {
		const root = await createFixture();
		await Promise.all([
			writeFile(join(root, 'bun.lock'), ''),
			writeFile(join(root, 'bun.lockb'), ''),
		]);

		const detection = await detectPackageManager(root);

		expect(detection.packageManager).toBe('bun');
		expect(detection.ambiguous).toBe(false);
	});

	test('ignores node_modules and dot directories when looking for the app', async () => {
		const root = await createFixture(false);
		await Promise.all([
			mkdir(join(root, 'node_modules')),
			mkdir(join(root, '.tooling')),
			mkdir(join(root, 'web')),
		]);
		await Promise.all([
			writePackageJson(join(root, 'node_modules')),
			writePackageJson(join(root, '.tooling')),
			writePackageJson(join(root, 'web')),
		]);

		const detection = await detectPackageManager(root);

		expect(detection.appDir).toBe('web');
		expect(detection.needsConfirmation).toBe(true);
	});

	test('falls back from yarn to npm with a warning', async () => {
		const root = await createFixture();
		await writeFile(join(root, 'yarn.lock'), '');

		const detection = await detectPackageManager(root);

		expect(detection.packageManager).toBe('npm');
		expect(detection.needsConfirmation).toBe(true);
		expect(detection.warnings.join('\n')).toContain('Yarn is unsupported');
	});

	test('defaults to npm and asks for confirmation without a lockfile', async () => {
		const root = await createFixture();

		const detection = await detectPackageManager(root);

		expect(detection.packageManager).toBe('npm');
		expect(detection.matches).toEqual([]);
		expect(detection.needsConfirmation).toBe(true);
		expect(detection.warnings).toContain(
			'No lockfile found; defaulting to npm.',
		);
	});

	test('chooses a deterministic app directory and requests confirmation', async () => {
		const root = await createFixture(false);
		await Promise.all([mkdir(join(root, 'web')), mkdir(join(root, 'api'))]);
		await Promise.all([
			writePackageJson(join(root, 'web')),
			writePackageJson(join(root, 'api')),
			writeFile(join(root, 'api', 'bun.lock'), ''),
		]);

		const detection = await detectPackageManager(root);

		expect(detection.appDir).toBe('api');
		expect(detection.packageManager).toBe('bun');
		expect(detection.needsConfirmation).toBe(true);
		expect(detection.warnings[0]).toContain('Multiple package directories');
	});

	async function createFixture(withPackage = true): Promise<string> {
		const root = await mkdtemp(join(tmpdir(), 'trunk-detect-'));
		temporaryDirectories.push(root);
		if (withPackage) {
			await writePackageJson(root);
		}

		return root;
	}
});

async function writePackageJson(directory: string): Promise<void> {
	await writeFile(
		join(directory, 'package.json'),
		JSON.stringify({scripts: {dev: 'next dev', build: 'next build'}}),
	);
}
