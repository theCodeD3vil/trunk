/**
 * The screens as data. Each one is a pure function from state, a width and a
 * glyph set to lines, and each key handler is a pure reducer, so this file
 * checks them without a terminal: what a screen says, what a key does, and,
 * for every screen at every supported width, that nothing is laid out wider
 * than the terminal or as tall as it.
 */
import {describe, expect, test} from 'bun:test';
import {agentIds} from '../source/core/agents.js';
import type {SetupValues} from '../source/core/resolve.js';
import type {
	ConfigureRequest,
	FailureRequest,
	FinishRequest,
} from '../source/core/session.js';
import {asciiGlyphs, unicodeGlyphs} from '../source/ui/kit/glyphs.js';
import {createKit, type Kit, type Line} from '../source/ui/kit/lines.js';
import {
	emptyRepositoryLines,
	failureKey,
	failureLines,
	missingToolLines,
	normalCloneLines,
} from '../source/ui/screens/callouts.js';
import {
	documentationKey,
	initialDocumentation,
} from '../source/ui/screens/docs.js';
import {
	buildOverwriteModel,
	diffRows,
	initialOverwrite,
	overwriteKey,
	overwriteLines,
	scrollLimit,
} from '../source/ui/screens/overwrite.js';
import {
	appendLog,
	progressOf,
	askPublish,
	endPublish,
	initialRun,
	runKey,
	startPublish,
	updatePublish,
	updateStep,
	type RunState,
} from '../source/ui/screens/running.js';
import {doneLines, outcomeOf} from '../source/ui/screens/done.js';
import {welcomeLines} from '../source/ui/screens/welcome.js';

const text = (line: Line): string =>
	line.segs.map(segment => segment.t).join('');
const screenText = (lines: readonly Line[]): string =>
	lines.map(line => text(line)).join('\n');

/** What a printed screen draws: its body, and whatever is printed below the frame. */
const asLines = (parts: {
	body: readonly Line[];
	after?: readonly Line[];
}): Line[] => [...parts.body, ...(parts.after ?? [])];

const values: SetupValues = {
	prefix: 'acme',
	tmux: true,
	agents: [],
	copyIgnored: false,
	mcAlias: true,
};

function request(overrides: Partial<ConfigureRequest> = {}): ConfigureRequest {
	return {
		command: 'init',
		project: 'acme/admin',
		rootName: 'acme-admin',
		destination: '~/Projects/acme-admin',
		defaultBranch: 'main',
		direct: false,
		values,
		fromFlags: {},
		installedAgents: ['claude', 'codex'],
		missingAgents: agentIds.filter(id => id !== 'claude' && id !== 'codex'),
		tmuxInstalled: true,
		toSettings: answers => ({
			trunkVersion: '0.1.1',
			generatedOn: '2026-09-18',
			...answers,
		}),
		...overrides,
	};
}

const finish: FinishRequest = {
	command: 'init',
	project: 'acme/admin',
	title: 'Cloned acme-admin',
	next: [
		{command: 'cd ~/Projects/acme-admin/chore-trunk-setup'},
		{command: 'wt config approvals add', note: 'review the hooks once'},
	],
	notes: ['tmux is not installed, so the workspace was left out.'],
	push: {
		branch: 'chore/trunk-setup',
		label: 'Push chore/trunk-setup to origin',
	},
};

const failure: FailureRequest = {
	command: 'clone',
	project: 'acme/admin',
	title: 'Validation failed',
	detail: 'wt config show: unknown key `post-start.edit`',
	created: [
		{path: 'acme-admin/', description: 'project folder'},
		{path: 'chore-trunk-setup/', description: 'worktree + branch'},
	],
	resume: 'trunk-cli clone https://example.com/acme/admin.git acme-admin',
	rollback: true,
};

/** Every screen at every size the UI supports, keyed by a name for failures. */
function screens(kit: Kit, rows: number): Array<[string, Line[]]> {
	const existing = '# mine\n[post-start]\nedit = "true"\n';
	return [
		['welcome', asLines(welcomeLines(kit))],
		[
			'overwrite',
			overwriteLines(
				kit,
				{
					command: 'init',
					project: 'acme/admin',
					path: '.config/wt.toml',
					existing,
					generated: '# generated\n[post-start]\ntmux = "x"\n',
				},
				buildOverwriteModel(
					existing,
					'# generated\n[post-start]\ntmux = "x"\n',
				),
				initialOverwrite,
				rows,
			),
		],
		['failure', failureLines(kit, failure, {sel: 0}, rows)],
		[
			'missing tools',
			asLines(missingToolLines(kit, ['git', 'wt'], 'trunk-cli init')),
		],
		[
			'normal clone',
			asLines(
				normalCloneLines(kit, {
					name: 'acme-admin',
					url: 'https://example.com/acme/admin.git',
					unsaved: ['3 uncommitted files'],
				}),
			),
		],
		[
			'empty repository',
			asLines(emptyRepositoryLines(kit, 'acme-admin', 'trunk-cli init')),
		],
	];
}

describe('every screen fits the terminal', () => {
	for (const columns of [80, 104]) {
		for (const [name, glyphs] of [
			['unicode', unicodeGlyphs],
			['ascii', asciiGlyphs],
		] as const) {
			test(`at ${columns} columns with ${name} glyphs`, () => {
				const kit = createKit(glyphs, columns);

				for (const [screen, lines] of screens(kit, 36)) {
					for (const line of lines) {
						expect(
							[...text(line)].length,
							`${screen}: "${text(line)}"`,
						).toBeLessThanOrEqual(columns);
					}

					// Ink clears the whole screen for a frame as tall as the terminal.
					expect(lines.length, screen).toBeLessThan(36);
				}
			});
		}
	}

	test('ASCII mode draws nothing outside ASCII', () => {
		const kit = createKit(asciiGlyphs, 80);

		for (const [screen, lines] of screens(kit, 36)) {
			// The welcome and docs contain words that are ours to keep ASCII too.
			for (const line of lines) {
				expect(text(line), screen).toMatch(/^[ -~]*$/);
			}
		}
	});

	test('a short terminal trims the frame instead of overflowing it', () => {
		const kit = createKit(unicodeGlyphs, 80);

		for (const [screen, lines] of screens(kit, 24)) {
			if (['overwrite', 'failure', 'docs'].includes(screen)) {
				expect(lines.length, screen).toBeLessThan(24);
			}
		}
	});
});

describe('running screen and result card', () => {
	const kit = createKit(unicodeGlyphs, 104);
	const definitions = [
		{id: 'clone', label: 'Clone repository', detail: 'file:///a/b.git'},
		{id: 'commit', label: 'Commit', detail: 'Add worktree automation'},
	];

	test('steps move from pending to active to done, and the clock restarts on reactivation', () => {
		let state = initialRun(definitions, 'init', 'acme/admin');
		expect(state.steps.map(step => step.status)).toEqual([
			'pending',
			'pending',
		]);

		state = updateStep(state, 'clone', 'active', 1000);
		state = updateStep(state, 'clone', 'done', 2500, 'cloned');
		expect(state.steps[0]).toMatchObject({
			status: 'done',
			startedAt: 1000,
			endedAt: 2500,
			detail: 'cloned',
		});

		// A question interrupted the step: time spent deciding is not work.
		state = updateStep(state, 'commit', 'active', 3000);
		state = updateStep(state, 'commit', 'active', 9000);
		expect(state.steps[1]?.startedAt).toBe(9000);
	});

	test('git progress on the newest row becomes a phrase for the step row', () => {
		const out = (text: string) => ({
			kind: 'output' as const,
			text,
			stream: 'stderr' as const,
		});
		const phrase = (...events: Array<ReturnType<typeof out>>) => {
			let state = initialRun(definitions, 'init', 'acme/admin');
			for (const event of events) {
				state = appendLog(state, event);
			}

			return progressOf(state.log);
		};

		expect(
			phrase(
				out('Receiving objects:  72% (2713/3765), 6.82 MiB | 37.00 KiB/s'),
			),
		).toBe('Receiving objects 72% \u00B7 6.82 MiB \u00B7 37.00 KiB/s');
		expect(
			phrase(out('remote: Compressing objects: 100% (71/71), done.\n')),
		).toBe('Compressing objects 100% \u00B7 done.');
		// Nothing to show for ordinary output, or once a newer command has started.
		expect(phrase(out('Cloning into bare repository'))).toBeUndefined();
		expect(
			phrase(out('Receiving objects: 100% (3/3)\n'), {
				kind: 'command',
				text: 'git fetch',
			} as never),
		).toBeUndefined();
	});

	test('the log keeps a row open until its newline, and a carriage return redraws it', () => {
		const out = (text: string) => ({
			kind: 'output' as const,
			text,
			stream: 'stderr' as const,
		});
		let state = initialRun(definitions, 'init', 'acme/admin');
		state = appendLog(state, {kind: 'command', text: 'git clone --bare u d'});
		state = appendLog(state, out('Receiving objects:  10%\r'));
		state = appendLog(state, out('Receiving objects: 20%\r'));
		state = appendLog(state, out('Receiving objects: 100%\u001B[K\ndone'));
		state = appendLog(state, out('.\n'));
		state = appendLog(state, {kind: 'exit', code: 0});
		expect(state.log?.map(row => row.text)).toEqual([
			'$ git clone --bare u d',
			'Receiving objects: 100%',
			'done.',
		]);

		// Only a failure is worth a row of its own.
		state = appendLog(state, {kind: 'exit', code: 128});
		expect(state.log?.at(-1)).toEqual({text: 'exit 128', tone: 'fail'});
	});
});

describe('existing-config screen', () => {
	const kit = createKit(unicodeGlyphs, 104);
	const existing =
		['# mine', '[post-start]', 'edit = "true"', 'lint = "x"'].join('\n') + '\n';
	const generated =
		['# generated', '[post-start]', 'tmux = "x"'].join('\n') + '\n';

	test('counts what replacing would drop and add, and numbers the diff', () => {
		const model = buildOverwriteModel(existing, generated);

		expect(model.removed).toBeGreaterThan(0);
		expect(model.added).toBeGreaterThan(0);
		expect(model.existingLines).toBe(4);
		expect(model.rows.some(row => row.kind === 'hunk')).toBe(true);
	});

	test('defaults to keeping the user file, and r narrows the view to removals', () => {
		expect(overwriteKey(initialOverwrite, 'enter').answer).toBe('keep');
		expect(overwriteKey(initialOverwrite, 'esc').answer).toBe('keep');

		const replace = overwriteKey(initialOverwrite, 'right').state;
		expect(overwriteKey(replace, 'enter').answer).toBe('replace');

		const narrowed = overwriteKey(initialOverwrite, 'r').state;
		expect(narrowed.onlyRemoved).toBe(true);
		const request_ = {
			command: 'init' as const,
			project: 'acme/admin',
			path: '.config/wt.toml',
			existing,
			generated,
		};
		const model = buildOverwriteModel(existing, generated);
		const screen = screenText(
			overwriteLines(kit, request_, model, narrowed, 40),
		);
		expect(screen).toContain('edit = "true"');
		expect(screen).not.toContain('tmux = "x"');
	});

	test('scrolling never goes above the top', () => {
		expect(overwriteKey(initialOverwrite, 'up').state.scroll).toBe(0);
		expect(overwriteKey(initialOverwrite, 'down').state.scroll).toBe(1);
	});
});

describe('docs screen', () => {
	const kit = createKit(unicodeGlyphs, 104);
	const view = {kit, width: 80, height: 28};

	test('the side arrows step through every section and stop at the ends', () => {
		let state = initialDocumentation;
		state = documentationKey(state, 'right', view).state;
		expect(state).toMatchObject({topic: 0, section: 1});

		expect(documentationKey(initialDocumentation, 'left', view).state).toEqual(
			initialDocumentation,
		);

		for (let index = 0; index < 20; index += 1) {
			state = documentationKey(state, 'right', view).state;
		}

		// The last of the thirteen sections: the fifth of the second topic.
		expect(state).toMatchObject({topic: 1, section: 4});
	});

	test('q quits, and c on a page with several snippets asks which to copy', () => {
		expect(documentationKey(initialDocumentation, 'q', view).effect).toEqual({
			kind: 'quit',
		});

		let found = false;
		let state = initialDocumentation;
		for (let index = 0; index < 13 && !found; index += 1) {
			const step = documentationKey(state, 'c', view);
			found = step.state.picker !== undefined;
			state = documentationKey(state, 'right', view).state;
		}

		expect(found).toBe(true);
	});

	test('search finds a page, Enter opens it and Esc leaves search alone', () => {
		let {state} = documentationKey(initialDocumentation, '/', view);
		expect(state.search).toEqual({query: '', sel: 0});

		for (const key of ['t', 'm', 'u', 'x']) {
			state = documentationKey(state, key, view).state;
		}

		expect(state.search?.query).toBe('tmux');
		const opened = documentationKey(state, 'enter', view).state;
		expect(opened.search).toBeUndefined();

		expect(documentationKey(state, 'esc', view).state.search).toBeUndefined();
	});
});

describe('failure and refusal cards', () => {
	const kit = createKit(unicodeGlyphs, 104);

	test('the failure card says what went wrong, what exists, and how to resume', () => {
		const screen = screenText(failureLines(kit, failure, {sel: 0}, 40));

		expect(screen).toContain('Validation failed');
		expect(screen).toContain('unknown key');
		expect(screen).toContain('chore-trunk-setup/');
		expect(screen).toContain('worktree + branch');
		expect(screen).toContain('Roll back');
		expect(screen).toContain(failure.resume);
		expect(screen).toContain('exit 1');
	});

	test('Keep is the default, and rolling back needs a deliberate choice', () => {
		expect(failureKey(failure, {sel: 0}, 'enter').answer).toBe('keep');
		const moved = failureKey(failure, {sel: 0}, 'right').state;
		expect(moved.sel).toBe(1);
		expect(failureKey(failure, moved, 'enter').answer).toBe('rollback');
	});

	test('with nothing to roll back there is nothing to choose', () => {
		const plain = {...failure, rollback: false};

		expect(screenText(failureLines(kit, plain, {sel: 0}, 40))).not.toContain(
			'Roll back',
		);
		expect(failureKey(plain, {sel: 0}, 'enter').answer).toBe('keep');
		expect(failureKey(plain, {sel: 0}, 'x').answer).toBeUndefined();
	});

	test('a missing tool names it, links the fix and shows the command to re-run', () => {
		const parts = missingToolLines(kit, ['wt'], 'trunk-cli clone x');
		const screen = screenText(parts.body);

		expect(screen).toContain('Worktrunk');
		expect(screen).toContain('https://worktrunk.dev');
		expect(screen).toContain('trunk-cli clone x');
		expect(parts.exit).toBe(3);
		expect(parts.foot).toBe('Nothing was created.');
	});

	test('a normal clone is left alone and the steps to move it across are listed', () => {
		const screen = screenText(
			asLines(
				normalCloneLines(kit, {
					name: 'acme-admin',
					url: 'https://example.com/a.git',
					unsaved: [],
				}),
			),
		);

		expect(screen).toContain('acme-admin is a normal clone');
		expect(screen).toContain(
			'trunk-cli clone https://example.com/a.git acme-admin-wt',
		);
	});
});

describe('welcome screen', () => {
	test('leads with the three commands, then an example and the options', () => {
		const screen = screenText(
			asLines(welcomeLines(createKit(unicodeGlyphs, 104))),
		);

		expect(screen).toContain('Set up a repository for parallel work.');
		for (const command of ['clone', 'init', 'docs']) {
			expect(screen).toContain(command);
		}

		expect(screen.indexOf('clone')).toBeLessThan(screen.indexOf('--yes'));
	});
});

/** Screens that live inside a frame with a key bar, by the name `screens` gives them. */
const framed = new Set([
	'setup',
	'review',
	'running',
	'result',
	'overwrite',
	'failure',
	'docs',
]);

describe('the key bar is pinned to the bottom', () => {
	test('the key bar is on the same row from screen to screen', () => {
		const kit = createKit(unicodeGlyphs, 104);
		const rows = screens(kit, 30)
			.filter(([screen]) => framed.has(screen))
			.map(([, lines]) => lines.length);

		expect(new Set(rows).size).toBe(1);
	});
});

describe('a short terminal never hides a question', () => {
	const kit = createKit(unicodeGlyphs, 80);
	const long = {
		...finish,
		next: [
			{command: 'cd ~/Projects/acme-admin/chore-trunk-setup'},
			{
				command: 'wt config approvals add',
				note: 'review and approve the hooks',
			},
			{command: 'wt up', note: 'start the tmux workspace'},
		],
	};
	const steps = [
		'clone',
		'branch',
		'worktree',
		'generate',
		'validate',
		'commit',
	].map(id => ({id, label: `Step ${id}`, detail: 'ok'}));

	test('the failure question, and the diff question, survive 24 rows', () => {
		const many = {
			...failure,
			detail: Array.from(
				{length: 6},
				(_, index) => `line ${index} of detail`,
			).join('\n'),
			created: Array.from({length: 6}, (_, index) => ({
				path: `folder-${index}/`,
				description: 'made by this run',
			})),
		};
		const failed = screenText(failureLines(kit, many, {sel: 0}, 24));
		const existing = Array.from(
			{length: 40},
			(_, index) => `key${index} = 1`,
		).join('\n');
		const diff = screenText(
			overwriteLines(
				kit,
				{
					command: 'init',
					project: 'a/b',
					path: '.config/wt.toml',
					existing,
					generated: 'x = 1\n',
				},
				buildOverwriteModel(existing, 'x = 1\n'),
				initialOverwrite,
				24,
			),
		);

		expect(failed).toContain('Keep it to inspect, or roll back');
		expect(failed).toContain('Roll back');
		expect(diff).toContain("Replace it with Trunk's version?");
		expect(diff).toContain('Keep mine');
	});
});

describe('cards stop at 76 columns', () => {
	const kit = createKit(unicodeGlyphs, 104);

	/** The width of every rounded box that starts a line. */
	function boxWidths(lines: readonly Line[]): number[] {
		return lines
			.map(line => text(line))
			.filter(row => row.startsWith('  ╭'))
			.map(row => row.trimEnd().length - 2);
	}
});

describe('next steps keep their notes', () => {
	const kit = createKit(unicodeGlyphs, 104);
	const deep = `cd ~/${'nested/'.repeat(12)}acme-admin/chore-trunk-setup`;
});

describe('commands are never cut off', () => {
	const kit = createKit(unicodeGlyphs, 104);
	const url = `https://example.com/${'organisation/'.repeat(5)}storefront.git`;

	test('a normal clone with a long URL shows the whole command below its card', () => {
		const lines = asLines(
			normalCloneLines(kit, {name: 'storefront', url, unsaved: []}),
		);
		const command = `trunk-cli clone ${url} storefront-wt`;
		const soft = lines
			.filter(line => line.soft === true)
			.map(line => text(line).trim());

		expect(soft).toEqual([command]);
		// The card row that would have held it points there instead of being cut.
		expect(screenText(lines)).toContain('command in full below');
	});

	test('a short URL stays inside the card, as designed', () => {
		const lines = asLines(
			normalCloneLines(kit, {
				name: 'storefront',
				url: 'git@github.com:acme/storefront.git',
				unsaved: [],
			}),
		);

		expect(lines.some(line => line.soft === true)).toBe(false);
		expect(screenText(lines)).toContain(
			'trunk-cli clone git@github.com:acme/storefront.git storefront-wt',
		);
	});

	test('the same holds for the missing-tool and empty-repository re-run commands', () => {
		const rerun = `trunk-cli clone ${url} some-directory`;
		const missing = asLines(missingToolLines(kit, ['wt'], rerun));
		const empty = asLines(emptyRepositoryLines(kit, 'storefront', rerun));

		for (const lines of [missing, empty]) {
			expect(
				lines.filter(line => line.soft === true).map(line => text(line).trim()),
			).toEqual([rerun]);
		}
	});

	test('the resume command sits beside the choice when it fits and below it when it does not', () => {
		const beside = screenText(failureLines(kit, failure, {sel: 0}, 40));
		const longResume = `trunk-cli clone ${url} storefront`;
		const below = failureLines(
			kit,
			{...failure, resume: longResume},
			{sel: 0},
			40,
		);

		expect(beside).toMatch(
			/Keep {4}Roll back {4}Resume later with trunk-cli clone /,
		);
		expect(
			below.filter(line => line.soft === true).map(line => text(line).trim()),
		).toEqual([longResume]);
		expect(screenText(below)).not.toMatch(/Roll back {4}Resume later/);
	});
});

describe('welcome', () => {
	const kit = createKit(unicodeGlyphs, 104);

	test('plain trunk keeps the options to one dim line and says how to skip the questions', () => {
		const screen = screenText(asLines(welcomeLines(kit, 'summary')));

		expect(screen).toContain(
			'--yes · --prefix · --agents · --tmux · --copy · --mc · --direct',
		);
		expect(welcomeLines(kit, 'summary').foot).toBe(
			'Nothing is written until you review it. Add --yes to skip every question.',
		);
		expect(screen).not.toContain('tmux session prefix');
		expect(screen).toContain(
			'❯ trunk-cli clone git@github.com:acme/storefront.git',
		);
	});

	test('trunk-cli --help lists what every option means', () => {
		const screen = screenText(asLines(welcomeLines(kit, 'full')));

		for (const meaning of [
			'accept the defaults, no questions',
			'tmux session prefix',
			'up to 4 installed agents',
			'wt step copy-ignored',
			'commit on this branch',
		]) {
			expect(screen).toContain(meaning);
		}
	});

	test('the summary is the default', () => {
		expect(screenText(asLines(welcomeLines(kit)))).toBe(
			screenText(asLines(welcomeLines(kit, 'summary'))),
		);
	});
});

describe('clicks reach the screens', () => {
	const kit = createKit(unicodeGlyphs, 104);
	const wide = request({values: {...values, agents: []}});

	test('the push, keep and roll back buttons answer at once', () => {
		let state: RunState = {
			...initialRun([], 'init', 'acme/admin'),
			finish: {request: finish, sel: 1, outcome: [], answered: false},
		};

		expect(runKey(state, 'push').answer).toBe('push');
		expect(runKey(state, 'skip').answer).toBe('skip');
		state = runKey(state, 'push').state;
		expect(runKey(state, 'skip').answer).toBeUndefined();

		expect(failureKey(failure, {sel: 0}, 'rollback').answer).toBe('rollback');
		expect(failureKey(failure, {sel: 1}, 'keep').answer).toBe('keep');
		expect(overwriteKey(initialOverwrite, 'replace').answer).toBe('replace');
		expect(overwriteKey(initialOverwrite, 'keep').answer).toBe('keep');
	});
});

describe('the existing-config diff', () => {
	const existing = Array.from(
		{length: 40},
		(_, index) => `key${index} = 1`,
	).join('\n');
	const model = buildOverwriteModel(existing, 'x = 1\n');

	test('scrolling stops at the end, so one key press always undoes it', () => {
		const limit = scrollLimit(model, initialOverwrite, 30);
		let state = initialOverwrite;
		for (let index = 0; index < limit + 20; index++) {
			state = overwriteKey(state, 'down', limit).state;
		}

		expect(state.scroll).toBe(limit);
		expect(overwriteKey(state, 'up', limit).state.scroll).toBe(limit - 1);
	});

	test('shows the same 12 rows as the proposal', () => {
		expect(diffRows(30)).toBe(12);
		expect(diffRows(50)).toBe(12);
		expect(diffRows(24)).toBe(10);
	});
});

describe('wording follows the proposal', () => {
	const kit = createKit(unicodeGlyphs, 104);

	test('a missing wt says what Trunk does through it, and a missing git the same for git', () => {
		expect(
			screenText(asLines(missingToolLines(kit, ['wt'], 'trunk-cli clone x'))),
		).toContain(
			'Trunk needs `wt` to create worktrees. It was not found on your PATH.',
		);
		expect(
			screenText(asLines(missingToolLines(kit, ['git'], 'trunk-cli clone x'))),
		).toContain('Trunk needs `git` to read and clone repositories.');
		expect(
			screenText(
				asLines(missingToolLines(kit, ['git', 'wt'], 'trunk-cli clone x')),
			),
		).toContain(
			'Trunk needs `git` and `wt` on your PATH, and neither was found.',
		);
	});

	test('a normal clone names the branch to copy into when it knows it', () => {
		const named = screenText(
			asLines(
				normalCloneLines(kit, {
					name: 'storefront',
					url: 'u',
					unsaved: [],
					branch: 'main',
				}),
			),
		);
		const unnamed = screenText(
			asLines(
				normalCloneLines(kit, {name: 'storefront', url: 'u', unsaved: []}),
			),
		);

		expect(named).toContain(
			'copy any local-only files into storefront-wt/main/',
		);
		expect(unnamed).toContain('storefront-wt/<default branch>/');
	});

	test('what wt reported sits under its lead-in, indented, as in the proposal', () => {
		const screen = failureLines(
			kit,
			{
				...failure,
				title: 'Worktrunk rejected the generated config',
				detail:
					'wt config show reported:\n▲ .config/wt.toml: unknown field `pre_start`',
			},
			{sel: 0},
			40,
		);
		const rows = screen.map(row => text(row));
		const lead = rows.findIndex(row =>
			row.includes('wt config show reported:'),
		);

		expect(rows[lead]).toMatch(/│ wt config show reported: +│/);
		expect(rows[lead + 1]).toMatch(/│ {3}▲ \.config\/wt\.toml: unknown field/);
		// The lead-in is dim and the warning is not.
		const styles = screen[lead]!.segs.map(segment => segment.c);
		expect(styles).toContain('c-dim');
		expect(screen[lead + 1]!.segs.some(segment => segment.c === 'c-warn')).toBe(
			true,
		);
	});
});

describe('pushing the setup branch', () => {
	const kit = createKit(unicodeGlyphs, 104);
	const destination = 'github.com:acme/storefront';
	const request = {
		branch: 'chore/trunk-setup',
		destination,
		withPullRequest: true,
	};
	/** The result screen after the question was answered, ready to publish. */
	const answered = (): RunState => ({
		...initialRun([], 'clone', 'acme/storefront'),
		finish: {request: finish, sel: 0, outcome: [], answered: true},
	});
	const started = (withPullRequest = true): RunState =>
		startPublish(answered(), {...request, withPullRequest});

	describe('when the push fails', () => {
		const problem = {
			tone: 'error' as const,
			title: 'Push failed',
			said: [
				'To github.com:acme/storefront.git',
				' ! [remote rejected] chore/trunk-setup (permission denied)',
			],
			fix: 'Check that you can write to acme/storefront, then try again.',
			after: 'git push -u origin chore/trunk-setup',
			question: 'Try again, or leave it local?',
			note: 'Nothing was changed on origin.',
		};
		const failed = (): RunState => {
			let state = updatePublish(started(), 'push', 'active', 0);
			state = updatePublish(state, 'push', 'failed', 2000);
			return askPublish(state, problem);
		};

		test('Retry is selected first, arrows change it, Enter and the buttons answer', () => {
			const state = failed();

			expect(runKey(state, 'enter').answer).toBe('retry');
			const moved = runKey(state, 'right').state;
			expect(runKey(moved, 'enter').answer).toBe('later');
			expect(runKey(moved, 'left').state.publish?.problem?.sel).toBe(0);
			expect(runKey(state, 'later').answer).toBe('later');
			expect(runKey(state, 'retry').answer).toBe('retry');
			expect(runKey(state, 'x').answer).toBeUndefined();
		});
	});

	describe('when the pull request fails after a good push', () => {
		const problem = {
			tone: 'warning' as const,
			title: 'Pushed, but no pull request',
			said: ['To get started with GitHub CLI, please run:  gh auth login'],
			fix: 'Sign in to GitHub, then try again.',
			after: 'gh auth login',
			link: 'https://github.com/acme/storefront/compare/chore%2Ftrunk-setup?expand=1',
			question: 'Try opening it again?',
		};
		const warned = (link = problem.link): RunState => {
			let state = updatePublish(started(), 'push', 'done', 2400);
			state = updatePublish(state, 'pr', 'warned', 3800);
			return askPublish(state, {...problem, link});
		};
	});
});

describe('the summary left after a finished run', () => {
	const kit = createKit(unicodeGlyphs, 104);
	const finished = (): RunState => ({
		...initialRun([], 'init', 'acme/admin'),
		finish: {
			request: finish,
			sel: 0,
			outcome: [{ok: true, text: 'Kept it local.'}],
			answered: true,
		},
	});

	test('names the result, numbers the next steps and keeps the notes', () => {
		const lines = doneLines(kit, finish, outcomeOf(finished()));
		const shown = screenText(lines);

		expect(shown).toContain('✓ Cloned acme-admin');
		expect(shown).toContain('Kept it local.');
		expect(shown).toContain('Next steps');
		expect(shown).toMatch(/1\s+cd ~\/Projects\/acme-admin\/chore-trunk-setup/);
		// The note lines up after the command that has one, not after the long `cd`.
		expect(shown).toMatch(
			/2\s+wt config approvals add {3}review the hooks once/,
		);
		expect(shown).toContain(
			'▲ tmux is not installed, so the workspace was left out.',
		);
		// A command is copied by hand, so it is never cut to fit.
		expect(lines.filter(line => line.soft)).toHaveLength(2);
	});

	test('adds what the publish did, one line per step, then what to do next', () => {
		let state = startPublish(finished(), {
			branch: 'chore/trunk-setup',
			destination: 'github.com:acme/admin',
			withPullRequest: true,
		});
		state = updatePublish(state, 'push', 'done', 2400);
		state = updatePublish(state, 'pr', 'warned', 3800);

		const items = outcomeOf(state);
		expect(items[0]!.text).toBe('Kept it local.');
		expect(items[1]).toMatchObject({ok: true});
		expect(items[1]!.text).toStartWith('Push to origin');
		expect(items[2]).toMatchObject({ok: true, tone: 'warning'});
		expect(items[2]!.text).toStartWith('Open pull request');
	});
});
