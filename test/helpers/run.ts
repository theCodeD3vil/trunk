import {execFile, spawn} from 'node:child_process';
import {copyFile, mkdir, mkdtemp, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const executeFile = promisify(execFile);

export type CliBuild = {
	cliPath: string;
	temporaryDirectory: string;
	cleanup: () => Promise<void>;
};

export type CliRun = {
	exitCode: number | undefined;
	stdout: string;
	stderr: string;
	temporaryDirectory: string;
	configPath: string;
	environment: Readonly<Record<string, string>>;
	cleanup: () => Promise<void>;
};

export async function buildCli(): Promise<CliBuild> {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), 'trunk-build-'));
	const outputDirectory = join(temporaryDirectory, 'dist');
	const typescript = join(
		projectRoot,
		'node_modules',
		'typescript',
		'bin',
		'tsc',
	);

	await Promise.all([
		copyFile(
			join(projectRoot, 'package.json'),
			join(temporaryDirectory, 'package.json'),
		),
		symlink(
			join(projectRoot, 'node_modules'),
			join(temporaryDirectory, 'node_modules'),
			'dir',
		),
	]);

	try {
		await executeFile(
			process.execPath,
			[typescript, '--outDir', outputDirectory],
			{
				cwd: projectRoot,
			},
		);
	} catch (error: unknown) {
		await rm(temporaryDirectory, {recursive: true, force: true});
		throw error;
	}

	return {
		cliPath: join(outputDirectory, 'cli.js'),
		temporaryDirectory,
		cleanup: async () => rm(temporaryDirectory, {recursive: true, force: true}),
	};
}

export async function runCli(
	cliPath: string,
	arguments_: readonly string[] = [],
): Promise<CliRun> {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), 'trunk-test-'));
	const workingDirectory = join(temporaryDirectory, 'project');
	const homeDirectory = join(temporaryDirectory, 'home');
	const temporaryFiles = join(temporaryDirectory, 'tmp');
	const configPath = join(temporaryDirectory, 'config', 'worktrunk.toml');

	await Promise.all([
		mkdir(workingDirectory),
		mkdir(homeDirectory),
		mkdir(temporaryFiles),
		mkdir(dirname(configPath)),
	]);

	const environment = Object.fromEntries([
		['HOME', homeDirectory],
		['NO_COLOR', '1'],
		['PATH', process.env['PATH'] ?? ''],
		['TERM', 'dumb'],
		['TMPDIR', temporaryFiles],
		['WORKTRUNK_CONFIG_PATH', configPath],
		['XDG_CONFIG_HOME', join(homeDirectory, '.config')],
	]);
	const child = spawn(process.execPath, [cliPath, ...arguments_], {
		cwd: workingDirectory,
		env: environment,
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	child.stdout.setEncoding('utf8');
	child.stderr.setEncoding('utf8');

	let stdout = '';
	let stderr = '';
	child.stdout.on('data', (chunk: string) => {
		stdout += chunk;
	});
	child.stderr.on('data', (chunk: string) => {
		stderr += chunk;
	});

	const exitCode = await new Promise<number | undefined>((resolve, reject) => {
		child.once('error', reject);
		child.once('close', code => {
			resolve(code ?? undefined);
		});
	});

	return {
		exitCode,
		stdout,
		stderr,
		temporaryDirectory,
		configPath,
		environment,
		cleanup: async () => rm(temporaryDirectory, {recursive: true, force: true}),
	};
}
