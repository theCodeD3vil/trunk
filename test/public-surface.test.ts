/**
 * The public surface has to agree with itself: the README, `trunk-cli --help`,
 * the package metadata, the release checklist and CI must all describe the same
 * three commands and the same language-agnostic scope. These tests read the
 * real files, so a change to one that forgets the others fails here.
 */
import {access, readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, expect, test} from 'bun:test';
import {flagDefinitions, helpText} from '../source/core/arguments.js';

const root = (path: string) =>
	fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = async (path: string) => readFile(root(path), 'utf8');

const commands = ['clone', 'init', 'docs'];

/** What the removed features were called, which no current document may teach. */
const removed = [
	'trunk new',
	'trunk-cli new',
	'--pm',
	'--server',
	'--caddy',
	'--remote',
	'--owner',
	'--public',
];

const stackWords = /\b(npm|pnpm|yarn|caddy|brew|localhost|hash_port)\b/i;

/** The README without its upgrade notes, which name what was removed. */
function withoutUpgrading(readme: string): string {
	return readme.replace(/## Upgrading From[\s\S]*?(?=\n## )/, '');
}

describe('commands', () => {
	test('the help text lists exactly clone, init and docs', () => {
		const listed = [...helpText.matchAll(/^\s*\$ trunk-cli (\w+)/gm)].map(
			match => match[1],
		);

		expect(listed).toEqual(commands);
	});

	test('the README documents the same three commands', async () => {
		const readme = await read('readme.md');
		const headings = [...readme.matchAll(/^### (\w+)$/gm)].map(match =>
			match[1]!.toLowerCase(),
		);
		const examples = [...readme.matchAll(/^trunk-cli (\w+)/gm)].map(
			match => match[1],
		);

		expect(headings.filter(heading => commands.includes(heading))).toEqual(
			commands,
		);
		expect(new Set(examples)).toEqual(new Set(commands));
	});
});

describe('options', () => {
	/** Meow spells `copyIgnored` as `--copy`; the other names match. */
	const flags = Object.keys(flagDefinitions).map(name =>
		name === 'copyIgnored' ? 'copy' : name,
	);

	test('the README documents every flag the CLI accepts and no more', async () => {
		const readme = await read('readme.md');
		const table = readme.slice(
			readme.indexOf('## Options'),
			readme.indexOf('## What It Generates'),
		);
		const documented = new Set(
			[...table.matchAll(/`--([a-z-]+)/g)].map(match => match[1]!),
		);

		for (const flag of flags) {
			expect(documented.has(flag), `--${flag}`).toBe(true);
		}

		// Every documented flag is either a real one or the `--no-` form of one.
		for (const flag of documented) {
			expect(
				flags.includes(flag) || flags.includes(flag.replace(/^no-/, '')),
				`--${flag}`,
			).toBe(true);
		}
	});

	test('the help text documents every flag too', () => {
		for (const flag of flags) {
			expect(helpText, `--${flag}`).toContain(`--${flag}`);
		}
	});
});

describe('scope', () => {
	test('no current document teaches a removed command or flag', async () => {
		const documents = [
			withoutUpgrading(await read('readme.md')),
			await read('docs/generated-config.md'),
			await read('docs/releasing.md'),
			helpText,
		];

		for (const document of documents) {
			for (const name of removed) {
				expect(document, name).not.toContain(name);
			}
		}
	});

	test('the README and package metadata state the language-agnostic scope', async () => {
		const readme = await read('readme.md');
		const packageJson = JSON.parse(await read('package.json')) as {
			description: string;
			keywords: string[];
		};

		expect(readme).toContain('language-agnostic');
		expect(readme).toContain('## What It Does Not Do');
		for (const nonGoal of [
			'detect package managers',
			'install dependencies',
			'create projects',
			'create GitHub repositories',
			'global Worktrunk configuration',
		]) {
			expect(readme, nonGoal).toContain(nonGoal);
		}

		expect(packageJson.description).toContain('language-agnostic');
		expect(packageJson.description).not.toMatch(stackWords);
		expect(packageJson.keywords.join(' ')).not.toMatch(stackWords);
	});

	test('the changelog records the removals and how to upgrade', async () => {
		const changelog = await read('changelog.md');
		const unreleased = changelog.slice(
			changelog.indexOf('## Unreleased'),
			changelog.indexOf('## 0.1.0'),
		);

		for (const name of [
			'`trunk new`',
			'`--pm`',
			'`--caddy`',
			'### Upgrading',
		]) {
			expect(unreleased, name).toContain(name);
		}
	});
});

describe('packaging and release', () => {
	test('the package ships only dist and runs on Node 20 or newer', async () => {
		const packageJson = JSON.parse(await read('package.json')) as {
			files: string[];
			bin: Record<string, string>;
			engines: {node: string};
			scripts: Record<string, string>;
			np: {branch: string};
		};

		expect(packageJson.files).toEqual(['dist']);
		expect(packageJson.bin).toEqual({'trunk-cli': 'dist/cli.js'});
		expect(packageJson.engines.node).toBe('>=20');
		expect(await read('readme.md')).toMatch(/Node\.js\s*\|\s*20 or newer/);
		// Releases stay manual and on main.
		expect(packageJson.scripts['release']).toBe('np');
		expect(packageJson.np.branch).toBe('main');
	});

	test('the smoke script exists, is executable and is what CI and the checklist run', async () => {
		await access(root('scripts/smoke.sh'), constants.X_OK);
		const packageJson = JSON.parse(await read('package.json')) as {
			scripts: Record<string, string>;
		};

		expect(packageJson.scripts['smoke']).toBe('bash scripts/smoke.sh');
		expect(await read('.github/workflows/ci.yml')).toContain('bun run smoke');
		expect(await read('docs/releasing.md')).toContain('bun run smoke');
	});

	test('the release checklist covers the dry run and the four acceptance flows', async () => {
		const checklist = await read('docs/releasing.md');

		expect(checklist).toContain('bun run release -- --dry-run');
		expect(checklist).toContain('`main`');
		for (const flow of [
			'A generic clone',
			'An originless init',
			'A reviewed overwrite',
			'The Node docs recipes',
		]) {
			expect(checklist, flow).toContain(flow);
		}

		expect(await read('readme.md')).toContain('docs/releasing.md');
	});

	test('CI installs only the retained toolchain and never publishes', async () => {
		const workflow = await read('.github/workflows/ci.yml');

		expect(workflow).not.toMatch(/caddy|homebrew/i);
		expect(workflow).not.toMatch(
			/npm publish|np\b.*release|npm_token|secrets\./i,
		);
		expect(workflow).toContain('contents: read');
		// The only packages installed are the ones the tests drive.
		const installs = [
			...workflow.matchAll(/(?:apt-get install --yes|brew install) ([\w -]+)/g),
		].flatMap(match => match[1]!.trim().split(/\s+/));
		expect(new Set(installs)).toEqual(new Set(['shellcheck', 'tmux']));
		expect(workflow).toContain('worktrunk-installer.sh');
		// Both supported Node lines are exercised.
		expect(workflow).toMatch(/node:\s*\n\s*- 20\s*\n\s*- 22/);
	});
});
