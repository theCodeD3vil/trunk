/**
 * The bundled documentation against the real Worktrunk. Every TOML fragment is
 * placed in a generated config exactly where its page tells a reader to put it,
 * and `wt` has to accept the result. That is what keeps copyable text from
 * going stale.
 */
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import * as TOML from '@iarna/toml';
import {afterAll, describe, expect, test} from 'bun:test';
import {resolveExecutable} from '../source/core/env.js';
import {compose} from '../source/core/generate/index.js';
import {hasDiagnostic} from '../source/core/validate.js';
import {runCommand} from '../source/core/process.js';
import {topics} from '../source/docs/index.js';
import type {CodeBlock, Placement, Topic} from '../source/docs/types.js';
import {testSettings} from './helpers/settings.js';

const sourceRoot = fileURLToPath(new URL('../source/', import.meta.url));

/** Names that would turn the stack-neutral topic into a framework recipe. */
const stackWords =
	/\b(npm|pnpm|yarn|bun|node|nodejs|caddy|package\.json|express|next)\b/i;

const hookTypes = new Set([
	'pre-switch',
	'post-switch',
	'pre-start',
	'post-start',
	'pre-commit',
	'post-commit',
	'pre-merge',
	'post-merge',
	'pre-remove',
	'post-remove',
]);

type Snippet = Readonly<{
	topic: Topic;
	sectionId: string;
	block: CodeBlock & {placement: Placement};
}>;

const snippets: readonly Snippet[] = topics.flatMap(topic =>
	topic.sections.flatMap(section =>
		section.blocks.flatMap(block =>
			block.kind === 'code' && block.language === 'toml' && block.placement
				? [
						{
							topic,
							sectionId: section.id,
							block: {...block, placement: block.placement},
						},
				  ]
				: [],
		),
	),
);

describe('bundled documentation', () => {
	test('offers exactly the two topics, Config Basics and Node', () => {
		expect(topics.map(topic => topic.title)).toEqual(['Config Basics', 'Node']);
	});

	test('gives every section a unique id and every snippet a unique label', () => {
		for (const topic of topics) {
			const ids = topic.sections.map(section => section.id);
			expect(new Set(ids).size).toBe(ids.length);
			for (const section of topic.sections) {
				const labels = section.blocks.flatMap(block =>
					block.kind === 'code' ? [block.label] : [],
				);
				expect(
					new Set(labels).size,
					`${section.id}: ${labels.join(', ')}`,
				).toBe(labels.length);
			}
		}
	});

	test('declares a placement for every TOML fragment and none for shell', () => {
		for (const topic of topics) {
			for (const section of topic.sections) {
				for (const block of section.blocks) {
					if (block.kind !== 'code') {
						continue;
					}

					if (block.language === 'toml') {
						expect(
							block.placement,
							`${section.id}: ${block.label}`,
						).toBeDefined();
					} else {
						expect(block.placement).toBeUndefined();
					}
				}
			}
		}
	});

	test('keeps Config Basics free of any language or tool recipe', () => {
		const basics = topics.find(topic => topic.id === 'config-basics')!;
		const everything = JSON.stringify(basics);

		expect(everything).not.toMatch(stackWords);
	});

	test('covers the Node recipes the plan calls for', () => {
		const node = topics.find(topic => topic.id === 'node')!;
		const code = (sectionId: string) =>
			node.sections
				.find(section => section.id === sectionId)!
				.blocks.flatMap(block => (block.kind === 'code' ? [block] : []));

		const install = code('install-dependencies');
		expect(install.map(block => block.label)).toEqual(['npm', 'pnpm', 'Bun']);
		for (const block of [...install, ...code('monorepo')]) {
			// Installs finish before the tmux session opens.
			expect(block.placement).toBe('before-tmux');
		}

		expect(code('monorepo').map(block => block.label)).toEqual([
			'npm, app in apps/web',
			'pnpm, app in apps/web',
			'Bun, app in apps/web',
		]);
		const server = code('dev-server').map(block => block.code);
		expect(
			server.filter(fragment => fragment.includes('wt step tether')),
		).toHaveLength(7);
		expect(server.join('\n')).toContain('hash_port');
		expect(server.join('\n')).toContain('post-start');
	});

	test('teaches Caddy as an optional recipe with Caddy and curl as prerequisites', () => {
		const node = topics.find(topic => topic.id === 'node')!;
		const caddy = node.sections.find(section => section.id === 'caddy')!;
		const prose = caddy.blocks
			.flatMap(block => (block.kind === 'text' ? [block.text] : []))
			.join('\n');
		const code = caddy.blocks
			.flatMap(block => (block.kind === 'code' ? [block.code] : []))
			.join('\n');

		expect(prose).toContain('http://<branch>.<repo>.localhost:8080');
		expect(prose).toContain('Caddy and curl');
		expect(prose).toContain('https://caddyserver.com/docs/install');
		// The route ID names repository and branch, and a post-remove hook drops it.
		expect(code).toContain(
			'ID=wt:{{ remote_repo | lower }}:{{ branch | sanitize }}',
		);
		expect(
			caddy.blocks.some(
				block =>
					block.kind === 'code' &&
					typeof block.placement === 'object' &&
					block.placement.table === 'post-remove',
			),
		).toBe(true);
		// The docs name no system package manager to install it with.
		expect(`${prose}\n${code}`).not.toMatch(
			/\b(brew|apt|apt-get|dnf|pacman|yum)\b/,
		);
	});

	test('links to Worktrunk for personal and global configuration', () => {
		const basics = JSON.stringify(
			topics.find(topic => topic.id === 'config-basics'),
		);

		expect(basics).toContain('https://worktrunk.dev/config/');
	});
});

describe('Trunk itself stays stack-neutral', () => {
	test('no generator, probe, form or default mentions Caddy', async () => {
		for (const file of [
			'core/generate/aliases.ts',
			'core/generate/header.ts',
			'core/generate/index.ts',
			'core/generate/tmux.ts',
			'core/generate/toml.ts',
			'core/env.ts',
			'core/resolve.ts',
			'core/settings.ts',
			'ui/SetupForm.tsx',
			'ui/Summary.tsx',
		]) {
			// eslint-disable-next-line no-await-in-loop
			const contents = await readFile(join(sourceRoot, file), 'utf8');
			expect(contents, file).not.toMatch(/caddy/i);
		}
	});

	test('the docs browser reads no project files and detects nothing', async () => {
		const bundledFiles = await readdir(join(sourceRoot, 'docs'));
		const files = [
			...bundledFiles.map(name => `docs/${name}`),
			'ui/DocsBrowser.tsx',
			'commands/docs.ts',
		];
		for (const file of files) {
			// eslint-disable-next-line no-await-in-loop
			const contents = await readFile(join(sourceRoot, file), 'utf8');
			// Docs are data: no filesystem access, so nothing to detect with.
			expect(contents, file).not.toMatch(/from 'node:fs/);
			expect(contents, file).not.toMatch(
				/\b(readFile|readdir|existsSync|statSync)\b/,
			);
		}
	});
});

describe('every TOML fragment is accepted by Worktrunk', () => {
	const fixture = createFixture();

	afterAll(async () => {
		const {root} = await fixture;
		await rm(root, {recursive: true, force: true});
	});

	for (const snippet of snippets) {
		test(`${snippet.topic.id}/${snippet.sectionId}: ${snippet.block.label}`, async () => {
			const {wtPath, worktree, environment} = await fixture;
			const generated = compose(testSettings());
			const config = assemble(generated, snippet.block);
			await writeFile(join(worktree, '.config', 'wt.toml'), config);

			const shown = await wt(wtPath, worktree, environment, ['config', 'show']);
			expect(shown.code, shown.output).toBe(0);
			expect(hasDiagnostic(shown.output), shown.output).toBe(false);

			const expanded = await wt(wtPath, worktree, environment, [
				'hook',
				'show',
				'--expanded',
				'--format',
				'json',
			]);
			expect(expanded.code, expanded.output).toBe(0);
			expect(hasDiagnostic(expanded.output), expanded.output).toBe(false);
			const hooks = JSON.parse(expanded.stdout) as Array<{
				type: string;
				name: string;
				expanded: string;
			}>;

			// Templates were filled in, not passed through.
			for (const hook of hooks) {
				expect(hook.expanded, `${hook.type}:${hook.name}`).not.toContain('{{');
			}

			// Every hook the fragment defines is one Worktrunk now knows about.
			const defined = definedHooks(snippet.block.code, snippet.block.placement);
			for (const {type, name} of defined) {
				expect(
					hooks.some(hook => hook.type === type && hook.name === name),
					`${type}:${name} missing from ${JSON.stringify(
						hooks.map(hook => `${hook.type}:${hook.name}`),
					)}`,
				).toBe(true);
			}

			if (snippet.block.placement === 'before-tmux') {
				// The point of the placement: it must run before the session opens.
				const order = hooks
					.filter(hook => hook.type === 'pre-start')
					.map(hook => hook.name);
				for (const {name} of defined) {
					expect(order.indexOf(name), order.join(', ')).toBeGreaterThanOrEqual(
						0,
					);
					expect(order.indexOf(name), order.join(', ')).toBeLessThan(
						order.indexOf('tmux'),
					);
					// Below the copy step, so cached files arrive before the install.
					expect(order.indexOf(name), order.join(', ')).toBeGreaterThan(
						order.indexOf('copy'),
					);
				}
			}

			for (const alias of definedAliases(
				snippet.block.code,
				snippet.block.placement,
			)) {
				// eslint-disable-next-line no-await-in-loop
				const dryRun = await wt(wtPath, worktree, environment, [
					'config',
					'alias',
					'dry-run',
					alias,
				]);
				expect(dryRun.code, dryRun.output).toBe(0);
			}
		}, 30_000);
	}
});

/** Puts a fragment where its page says it belongs. */
function assemble(
	generated: string,
	block: CodeBlock & {placement: Placement},
): string {
	const {placement, code} = block;
	if (placement === 'standalone') {
		return `${code}\n`;
	}

	if (placement === 'append') {
		return `${generated}\n${code}\n`;
	}

	if (placement === 'before-tmux') {
		const marker = "[[pre-start]]\ntmux = '''";
		const at = generated.indexOf(marker);
		expect(at).toBeGreaterThan(-1);
		return `${generated.slice(0, at)}${code}\n\n${generated.slice(at)}`;
	}

	// Keys go straight under an existing table header, the only place a second
	// declaration of that table is not needed.
	const header = `[${placement.table}]\n`;
	const at = generated.indexOf(header);
	expect(
		at,
		`no [${placement.table}] table in the generated config`,
	).toBeGreaterThan(-1);
	const after = at + header.length;
	return `${generated.slice(0, after)}${code}\n${generated.slice(after)}`;
}

/** The `type` and `name` of every named hook a fragment declares. */
function definedHooks(
	code: string,
	placement: Placement,
): Array<{type: string; name: string}> {
	const parsed =
		typeof placement === 'object'
			? (TOML.parse(`[${placement.table}]\n${code}`) as Record<string, unknown>)
			: (TOML.parse(code) as Record<string, unknown>);
	const found: Array<{type: string; name: string}> = [];
	for (const [type, value] of Object.entries(parsed)) {
		if (!hookTypes.has(type)) {
			continue;
		}

		const tables = Array.isArray(value) ? value : [value];
		for (const table of tables) {
			if (typeof table === 'object' && table !== null) {
				for (const name of Object.keys(table as Record<string, unknown>)) {
					found.push({type, name});
				}
			}
		}
	}

	return found;
}

/** Alias names a fragment adds, so each can be checked with `wt config alias`. */
function definedAliases(code: string, placement: Placement): string[] {
	const parsed =
		typeof placement === 'object' && placement.table === 'aliases'
			? (TOML.parse(`[aliases]\n${code}`) as Record<string, unknown>)
			: (TOML.parse(code) as Record<string, unknown>);
	const {aliases} = parsed;
	return typeof aliases === 'object' && aliases !== null
		? Object.keys(aliases as Record<string, unknown>)
		: [];
}

type Fixture = Readonly<{
	root: string;
	worktree: string;
	wtPath: string;
	environment: NodeJS.ProcessEnv;
}>;

async function wt(
	wtPath: string,
	worktree: string,
	environment: NodeJS.ProcessEnv,
	arguments_: readonly string[],
): Promise<{code: number | undefined; stdout: string; output: string}> {
	const result = await runCommand(wtPath, ['-C', worktree, ...arguments_], {
		env: environment,
	});
	return {
		code: result.code,
		stdout: result.stdout,
		output: [result.stdout.trimEnd(), result.stderr.trimEnd()]
			.filter(Boolean)
			.join('\n'),
	};
}

/** A repository with an origin, because `remote_repo` needs one to expand. */
async function createFixture(): Promise<Fixture> {
	const wtPath = await resolveExecutable('wt');
	expect(wtPath).toBeDefined();

	const root = await mkdtemp(join(tmpdir(), 'trunk-docs-'));
	const worktree = join(root, 'project');
	const home = join(root, 'home');
	const configPath = join(root, 'config', 'worktrunk.toml');
	await Promise.all([
		mkdir(join(worktree, '.config'), {recursive: true}),
		mkdir(home),
		mkdir(dirname(configPath), {recursive: true}),
	]);
	const git = async (arguments_: readonly string[]) => {
		const result = await runCommand('git', arguments_, {
			env: Object.fromEntries([
				['HOME', tmpdir()],
				['PATH', process.env['PATH'] ?? ''],
				['GIT_CONFIG_NOSYSTEM', '1'],
			]),
		});
		expect(result.code, result.stderr).toBe(0);
	};

	await git(['init', '--initial-branch', 'main', worktree]);
	await writeFile(join(worktree, 'README.md'), '# fixture\n');
	await git(['-C', worktree, 'add', 'README.md']);
	await git([
		'-C',
		worktree,
		'-c',
		'user.name=Trunk Tests',
		'-c',
		'user.email=trunk@example.com',
		'commit',
		'-m',
		'Initial commit',
	]);
	await git(['-C', worktree, 'config', 'worktrunk.default-branch', 'main']);
	await git([
		'-C',
		worktree,
		'remote',
		'add',
		'origin',
		'git@example.com:example/Web-shop--portal.git',
	]);

	return {
		root,
		worktree,
		wtPath: wtPath!,
		environment: Object.fromEntries([
			['HOME', home],
			['NO_COLOR', '1'],
			['PATH', process.env['PATH'] ?? ''],
			['TERM', 'dumb'],
			['WORKTRUNK_CONFIG_PATH', configPath],
			['WORKTRUNK_SYSTEM_CONFIG_PATH', join(root, 'config', 'system.toml')],
			['XDG_CONFIG_HOME', join(home, '.config')],
		]),
	};
}
