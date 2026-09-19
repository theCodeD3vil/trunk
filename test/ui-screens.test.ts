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
	documentationLines,
	initialDocumentation,
	readerHeight,
} from '../source/ui/screens/docs.js';
import {
	buildOverwriteModel,
	diffRows,
	initialOverwrite,
	overwriteKey,
	overwriteLines,
	scrollLimit,
} from '../source/ui/screens/overwrite.js';
import {reviewKey, reviewLines} from '../source/ui/screens/review.js';
import {
	initialRun,
	runKey,
	runningLines,
	updateStep,
	type RunState,
} from '../source/ui/screens/running.js';
import {
	focusableFields,
	generatedSize,
	initialSetup,
	setupKey,
	setupLines,
} from '../source/ui/screens/setup.js';
import {welcomeLines} from '../source/ui/screens/welcome.js';

const text = (line: Line): string =>
	line.segs.map(segment => segment.t).join('');
const screenText = (lines: readonly Line[]): string =>
	lines.map(line => text(line)).join('\n');

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
	title: 'acme-admin is ready',
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
	resume: 'trunk clone https://example.com/acme/admin.git acme-admin',
	rollback: true,
};

/** Every screen at every size the UI supports, keyed by a name for failures. */
function screens(kit: Kit, rows: number): Array<[string, Line[]]> {
	const now = 5000;
	let run: RunState = initialRun(
		[
			{id: 'clone', label: 'Clone repository', detail: 'file:///a/b.git'},
			{
				id: 'commit',
				label: 'Commit on chore/trunk-setup',
				detail: 'Add worktree automation',
			},
		],
		'init',
		'acme/admin',
	);
	run = updateStep(run, 'clone', 'active', 1000);
	const existing = '# mine\n[post-start]\nedit = "true"\n';
	return [
		['welcome', welcomeLines(kit, '0.1.1')],
		[
			'setup',
			setupLines(kit, request(), initialSetup(request()), {caret: true, rows}),
		],
		[
			'review',
			reviewLines(kit, request(), request().toSettings(values), {sel: 0}, rows),
		],
		['running', runningLines(kit, run, now, rows)],
		[
			'result',
			runningLines(
				kit,
				{
					...run,
					finish: {request: finish, sel: 1, outcome: [], answered: false},
				},
				now,
				rows,
			),
		],
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
			'docs',
			documentationLines(kit, initialDocumentation, {caret: true, rows}),
		],
		['missing tools', missingToolLines(kit, ['git', 'wt'], 'trunk init')],
		[
			'normal clone',
			normalCloneLines(kit, {
				name: 'acme-admin',
				url: 'https://example.com/acme/admin.git',
				unsaved: ['3 uncommitted files'],
			}),
		],
		['empty repository', emptyRepositoryLines(kit, 'acme-admin', 'trunk init')],
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
			if (
				[
					'setup',
					'review',
					'running',
					'result',
					'overwrite',
					'failure',
					'docs',
				].includes(screen)
			) {
				expect(lines.length, screen).toBeLessThan(24);
			}
		}
	});
});

describe('setup screen', () => {
	test('shows the five choices and a preview that follows them', () => {
		const wide = createKit(unicodeGlyphs, 104);
		const start = initialSetup(request());
		const screen = screenText(
			setupLines(wide, request(), start, {caret: true, rows: 40}),
		);

		expect(screen).toContain('Configure worktree automation');
		for (const label of [
			'Session prefix',
			'tmux workspace',
			'Copy ignored files',
			'wt mc alias',
		]) {
			expect(screen).toContain(label);
		}

		expect(screen).toContain('Preview');
		expect(screen).toContain('.config/wt.toml');

		const off = {...start, values: {...values, tmux: false, mcAlias: false}};
		const plain = screenText(
			setupLines(wide, request(), off, {caret: true, rows: 40}),
		);
		expect(plain).not.toContain('open the tmux workspace');
	});

	test('folds the preview under 100 columns', () => {
		const narrow = createKit(unicodeGlyphs, 80);
		const screen = screenText(
			setupLines(narrow, request(), initialSetup(request()), {
				caret: true,
				rows: 40,
			}),
		);

		expect(screen).toContain('Configure worktree automation');
		expect(screen).toContain('Preview');
	});

	test('typing edits the prefix, and Enter on an invalid one goes nowhere', () => {
		const r = request();
		let state = initialSetup(r);
		for (const key of ['backspace', 'backspace', 'backspace', 'backspace']) {
			state = setupKey(r, state, key).state;
		}

		expect(state.values.prefix).toBe('');
		expect(setupKey(r, state, 'enter').done).toBe(false);
		expect(setupKey(r, state, 'enter').state.field).toBe(0);

		for (const key of ['w', 'e', 'b']) {
			state = setupKey(r, state, key).state;
		}

		expect(state.values.prefix).toBe('web');
		expect(setupKey(r, state, 'enter').state.field).toBe(1);
	});

	test('turning tmux off turns the agents off with it', () => {
		const r = request({values: {...values, agents: ['claude']}});
		let {state} = setupKey(r, initialSetup(r), 'down');
		expect(focusableFields(r, state.values)[state.field]).toBe('tmux');

		state = setupKey(r, state, 'space').state;
		expect(state.values.tmux).toBe(false);
		expect(state.values.agents).toEqual([]);
	});

	test('agents are picked one at a time, in the installed order, at most four', () => {
		const r = request({values: {...values, agents: []}});
		let state = initialSetup(r);
		state = setupKey(r, state, 'down').state;
		state = setupKey(r, state, 'down').state;
		expect(focusableFields(r, state.values)[state.field]).toBe('agents');

		state = setupKey(r, state, 'right').state;
		state = setupKey(r, state, 'space').state;
		expect(state.values.agents).toEqual(['codex']);
		state = setupKey(r, state, 'left').state;
		state = setupKey(r, state, 'space').state;
		// Canonical order, whichever was picked first.
		expect(state.values.agents).toEqual(['claude', 'codex']);
	});

	test('a field a flag already settled is not asked again', () => {
		const r = request({fromFlags: {prefix: '--prefix', tmux: '--tmux'}});

		expect(focusableFields(r, values)).not.toContain('prefix');
		expect(focusableFields(r, values)).not.toContain('tmux');
	});

	test('Enter on the last field finishes the form', () => {
		const r = request();
		const fields = focusableFields(r, values);
		let state = initialSetup(r);
		for (let index = 0; index < fields.length - 1; index += 1) {
			state = setupKey(r, state, 'enter').state;
		}

		const last = setupKey(r, state, 'enter');
		expect(last.done).toBe(true);
	});

	test('reports how big the generated file is, from the real generator', () => {
		const on = generatedSize(request(), values);
		const off = generatedSize(request(), {
			...values,
			tmux: false,
			mcAlias: false,
		});

		expect(on?.lines).toBeGreaterThan(off?.lines ?? 0);
		expect(
			generatedSize(request(), {...values, prefix: 'not valid!'}),
		).toBeUndefined();
	});
});

describe('review screen', () => {
	const kit = createKit(unicodeGlyphs, 104);
	const settings = request().toSettings(values);

	test('lists the choices and shows where the file will land', () => {
		const screen = screenText(
			reviewLines(kit, request(), settings, {sel: 0}, 40),
		);

		expect(screen).toContain('Ready to set up acme-admin');
		expect(screen).toContain('Your choices');
		expect(screen).toContain('acme_<branch>');
		expect(screen).toContain('chore-trunk-setup/');
		expect(screen).toContain('Create setup branch');
	});

	test('a direct commit says so and has no setup branch', () => {
		const screen = screenText(
			reviewLines(kit, request({direct: true}), settings, {sel: 0}, 40),
		);

		expect(screen).toContain('Write and commit');
		expect(screen).not.toContain('chore-trunk-setup/');
	});

	test('arrows cycle the actions, b and Esc go back, Enter picks', () => {
		expect(reviewKey({sel: 0}, 'enter').action).toBe('create');
		expect(reviewKey({sel: 0}, 'right').state.sel).toBe(1);
		expect(reviewKey({sel: 0}, 'left').state.sel).toBe(2);
		expect(reviewKey({sel: 1}, 'enter').action).toBe('back');
		expect(reviewKey({sel: 2}, 'enter').action).toBe('cancel');
		expect(reviewKey({sel: 0}, 'b').action).toBe('back');
		expect(reviewKey({sel: 0}, 'esc').action).toBe('back');
		expect(reviewKey({sel: 0}, 'x').action).toBeUndefined();
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

	test('shows each step with its detail and duration', () => {
		let state = initialRun(definitions, 'init', 'acme/admin');
		state = updateStep(state, 'clone', 'active', 1000);
		state = updateStep(state, 'clone', 'done', 2500);
		const screen = screenText(runningLines(kit, state, 3000, 40));

		expect(screen).toContain('Clone repository');
		expect(screen).toContain('file:///a/b.git');
		expect(screen).toContain('1.5s');
		expect(screen).toContain('Ctrl+C');
	});

	test('the push question starts on Not now and only Enter answers it', () => {
		let state: RunState = {
			...initialRun([], 'init', 'acme/admin'),
			finish: {request: finish, sel: 1, outcome: [], answered: false},
		};
		const screen = screenText(runningLines(kit, state, 0, 40));
		expect(screen).toContain('acme-admin is ready');
		expect(screen).toContain('cd ~/Projects/acme-admin/chore-trunk-setup');
		expect(screen).toContain('wt config approvals add');
		expect(screen).toContain('Not now');

		expect(runKey(state, 'enter').answer).toBe('skip');
		state = runKey(state, 'left').state;
		expect(runKey(state, 'enter').answer).toBe('push');
		expect(runKey(state, 'x').answer).toBeUndefined();

		// Once answered, further keys do nothing.
		const answered = runKey(state, 'enter').state;
		expect(runKey(answered, 'enter').answer).toBeUndefined();
	});

	test('a closed frame drops its key bar, and a cancelling run says it will stop', () => {
		const base = initialRun(definitions, 'init', 'acme/admin');

		expect(
			screenText(runningLines(kit, {...base, cancelling: true}, 0, 40)),
		).toContain('Stopping after this step');
		expect(
			screenText(runningLines(kit, {...base, closed: true}, 0, 40)),
		).not.toContain('Ctrl+C');
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
	const view = {kit, rows: 36};

	test('a wide terminal shows the sidebar beside the page, a narrow one folds it', () => {
		const wide = screenText(
			documentationLines(kit, initialDocumentation, {caret: true, rows: 36}),
		);
		expect(wide).toContain('Config Basics');
		expect(wide).toContain('Hook lifecycle');
		expect(wide).toContain('1 of 13');

		const narrow = screenText(
			documentationLines(createKit(unicodeGlyphs, 80), initialDocumentation, {
				caret: true,
				rows: 36,
			}),
		);
		expect(narrow).not.toContain('Hook lifecycle');
		expect(narrow).toContain('1 of 13');
	});

	test('the side arrows step through every section and stop at the ends', () => {
		let state = initialDocumentation;
		state = documentationKey(state, 'right', view).state;
		expect(
			screenText(documentationLines(kit, state, {caret: true, rows: 36})),
		).toContain('2 of 13');

		expect(documentationKey(initialDocumentation, 'left', view).state).toEqual(
			initialDocumentation,
		);

		for (let index = 0; index < 20; index += 1) {
			state = documentationKey(state, 'right', view).state;
		}

		expect(
			screenText(documentationLines(kit, state, {caret: true, rows: 36})),
		).toContain('13 of 13');
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
		const screen = screenText(missingToolLines(kit, ['wt'], 'trunk clone x'));

		expect(screen).toContain('Worktrunk');
		expect(screen).toContain('https://worktrunk.dev');
		expect(screen).toContain('trunk clone x');
		expect(screen).toContain('exit 3');
	});

	test('a normal clone is left alone and the steps to move it across are listed', () => {
		const screen = screenText(
			normalCloneLines(kit, {
				name: 'acme-admin',
				url: 'https://example.com/a.git',
				unsaved: [],
			}),
		);

		expect(screen).toContain('acme-admin is a normal clone');
		expect(screen).toContain(
			'trunk clone https://example.com/a.git acme-admin-wt',
		);
	});
});

describe('welcome screen', () => {
	test('leads with the three commands, then an example and the options', () => {
		const screen = screenText(
			welcomeLines(createKit(unicodeGlyphs, 104), '0.1.1'),
		);

		expect(screen).toContain('0.1.1');
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
	for (const rows of [24, 30, 50]) {
		test(`every framed screen fills ${
			rows - 1
		} of ${rows} rows and ends on its key bar`, () => {
			const kit = createKit(unicodeGlyphs, 104);

			for (const [screen, lines] of screens(kit, rows)) {
				if (!framed.has(screen)) {
					continue;
				}

				expect(lines, `${screen} at ${rows} rows`).toHaveLength(rows - 1);
				expect(lines.at(-2) && text(lines.at(-2)!), screen).toMatch(/^─+$/);
				expect(text(lines.at(-1)!).trim(), screen).not.toBe('');
			}
		});
	}

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

	test('at 80 by 24 the result card still asks whether to push', () => {
		let state = initialRun(steps, 'clone', 'acme/admin');
		for (const step of steps) {
			state = updateStep(state, step.id, 'active', 0);
			state = updateStep(state, step.id, 'done', 100);
		}

		state = {
			...state,
			finish: {request: long, sel: 1, outcome: [], answered: false},
		};
		const screen = screenText(runningLines(kit, state, 0, 24));

		expect(screen).toContain('Push chore/trunk-setup and open a pull request?');
		expect(screen).toContain('Push chore/trunk-setup to origin');
		expect(screen).toContain('Not now');
		expect(screen).toContain('acme-admin is ready');
		// The steps gave way, to a single line, before the question did.
		expect(screen).toContain('6 steps done');
	});

	test('with room to spare the steps are all listed', () => {
		let state = initialRun(steps, 'clone', 'acme/admin');
		for (const step of steps) {
			state = updateStep(state, step.id, 'done', 100);
		}

		state = {
			...state,
			finish: {request: long, sel: 1, outcome: [], answered: false},
		};
		const screen = screenText(
			runningLines(createKit(unicodeGlyphs, 104), state, 0, 40),
		);

		expect(screen).toContain('Step validate');
		expect(screen).not.toContain('6 steps done');
	});

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

	test('the choices card and the result card', () => {
		const review = reviewLines(
			kit,
			request(),
			request().toSettings(values),
			{sel: 0},
			30,
		);
		let state = initialRun([], 'init', 'acme/admin');
		state = {
			...state,
			finish: {request: finish, sel: 1, outcome: [], answered: false},
		};

		expect(boxWidths(review)).toEqual([76]);
		expect(boxWidths(runningLines(kit, state, 0, 30))).toEqual([76]);
	});

	test('a narrow terminal shrinks them to fit instead', () => {
		const narrow = createKit(unicodeGlyphs, 80);
		const review = reviewLines(
			narrow,
			request(),
			request().toSettings(values),
			{sel: 0},
			30,
		);

		expect(boxWidths(review)).toEqual([76]);
		expect(
			Math.max(...review.map(line => text(line).length)),
		).toBeLessThanOrEqual(80);
	});
});

describe('next steps keep their notes', () => {
	const kit = createKit(unicodeGlyphs, 104);
	const deep = `cd ~/${'nested/'.repeat(12)}acme-admin/chore-trunk-setup`;

	test('even when the path is far longer than the card', () => {
		let state = initialRun([], 'init', 'acme/admin');
		state = {
			...state,
			finish: {
				request: {...finish, next: [{command: deep}, ...finish.next.slice(1)]},
				sel: 1,
				outcome: [],
				answered: false,
			},
		};
		const screen = screenText(runningLines(kit, state, 0, 30));

		expect(screen).toContain('review the hooks once');
		// The path was shortened from its front, so the project's name is intact.
		expect(screen).toContain('acme-admin/chore-trunk-setup');
		for (const row of screen.split('\n')) {
			expect([...row].length).toBeLessThanOrEqual(104);
		}
	});
});

describe('commands are never cut off', () => {
	const kit = createKit(unicodeGlyphs, 104);
	const url = `https://example.com/${'organisation/'.repeat(5)}storefront.git`;

	test('a normal clone with a long URL shows the whole command below its card', () => {
		const lines = normalCloneLines(kit, {name: 'storefront', url, unsaved: []});
		const command = `trunk clone ${url} storefront-wt`;
		const soft = lines
			.filter(line => line.soft === true)
			.map(line => text(line).trim());

		expect(soft).toEqual([command]);
		// The card row that would have held it points there instead of being cut.
		expect(screenText(lines)).toContain('command in full below');
	});

	test('a short URL stays inside the card, as designed', () => {
		const lines = normalCloneLines(kit, {
			name: 'storefront',
			url: 'git@github.com:acme/storefront.git',
			unsaved: [],
		});

		expect(lines.some(line => line.soft === true)).toBe(false);
		expect(screenText(lines)).toContain(
			'trunk clone git@github.com:acme/storefront.git storefront-wt',
		);
	});

	test('the same holds for the missing-tool and empty-repository re-run commands', () => {
		const rerun = `trunk clone ${url} some-directory`;
		const missing = missingToolLines(kit, ['wt'], rerun);
		const empty = emptyRepositoryLines(kit, 'storefront', rerun);

		for (const lines of [missing, empty]) {
			expect(
				lines.filter(line => line.soft === true).map(line => text(line).trim()),
			).toEqual([rerun]);
		}
	});

	test('the resume command sits beside the choice when it fits and below it when it does not', () => {
		const beside = screenText(failureLines(kit, failure, {sel: 0}, 40));
		const longResume = `trunk clone ${url} storefront`;
		const below = failureLines(
			kit,
			{...failure, resume: longResume},
			{sel: 0},
			40,
		);

		expect(beside).toMatch(
			/Keep {4}Roll back {4}Resume later with trunk clone /,
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
		const screen = screenText(welcomeLines(kit, '0.3.0', 'summary'));

		expect(screen).toContain(
			'--yes · --prefix · --agents · --tmux · --copy · --mc · --direct',
		);
		expect(screen).toContain(
			'Nothing is written until you review it. Add --yes to skip every question.',
		);
		expect(screen).not.toContain('tmux session prefix');
		expect(screen).toContain(
			'❯ trunk clone git@github.com:acme/storefront.git',
		);
	});

	test('trunk --help lists what every option means', () => {
		const screen = screenText(welcomeLines(kit, '0.3.0', 'full'));

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
		expect(screenText(welcomeLines(kit, '0.3.0'))).toBe(
			screenText(welcomeLines(kit, '0.3.0', 'summary')),
		);
	});
});

describe('clicks reach the screens', () => {
	const kit = createKit(unicodeGlyphs, 104);
	const wide = request({values: {...values, agents: []}});

	test('a field row in the setup form carries the click that opens it', () => {
		const lines = setupLines(kit, wide, initialSetup(wide), {
			caret: true,
			rows: 40,
		});
		const row = lines.find(line => text(line).includes('◇ tmux workspace'));

		expect(row?.segs.some(segment => segment.k === 'setup:1')).toBe(true);
		// The preview panel beside it is not part of the click.
		expect(row?.segs.at(-1)?.k).toBeUndefined();
	});

	test('on, off, agent chips and rows change the answers', () => {
		let state = initialSetup(wide);
		state = setupKey(wide, state, 'setup:1').state;
		expect(focusableFields(wide, state.values)[state.field]).toBe('tmux');

		state = setupKey(wide, state, 'off').state;
		expect(state.values.tmux).toBe(false);
		state = setupKey(wide, state, 'on').state;
		expect(state.values.tmux).toBe(true);

		state = setupKey(wide, state, 'setup:2').state;
		expect(focusableFields(wide, state.values)[state.field]).toBe('agents');
		state = setupKey(wide, state, 'agent:1').state;
		expect(state.values.agents).toEqual(['codex']);
		expect(state.cursor).toBe(1);
		state = setupKey(wide, state, 'agent:1').state;
		expect(state.values.agents).toEqual([]);
	});

	test('every key cap on the setup key bar sends a key, except typing', () => {
		const lines = setupLines(kit, wide, initialSetup(wide), {
			caret: true,
			rows: 30,
		});
		const bar = lines.at(-1)!;
		const keys = bar.segs
			.filter(segment => segment.k !== undefined)
			.map(segment => segment.k);

		expect(keys).toEqual(['down', 'enter']);
	});

	test('the review actions are buttons', () => {
		const review = reviewLines(
			kit,
			request(),
			request().toSettings(values),
			{sel: 0},
			30,
		);
		const keys = review
			.flatMap(line => line.segs.map(segment => segment.k))
			.filter(Boolean);

		for (const key of ['go', 'back', 'cancel', 'enter', 'b']) {
			expect(keys, key).toContain(key);
		}

		expect(reviewKey({sel: 1}, 'go')).toMatchObject({action: 'create'});
		expect(reviewKey({sel: 0}, 'cancel')).toMatchObject({action: 'cancel'});
		expect(reviewKey({sel: 0}, 'back')).toMatchObject({action: 'back'});
	});

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

	test('the docs sidebar, search results and snippet picker are clickable', () => {
		const lines = documentationLines(kit, initialDocumentation, {
			caret: true,
			rows: 36,
		});
		const view = {kit, rows: 36};
		const hook = lines.find(line => text(line).includes('Hook lifecycle'));
		expect(hook?.segs.some(segment => segment.k === 'docs-s:0:1')).toBe(true);

		const moved = documentationKey(
			initialDocumentation,
			'docs-s:1:2',
			view,
		).state;
		expect([moved.topic, moved.section]).toEqual([1, 2]);

		let {state} = documentationKey(initialDocumentation, '/', view);
		for (const key of 'tmux') {
			state = documentationKey(state, key, view).state;
		}

		const results = documentationLines(kit, state, {caret: true, rows: 36});
		expect(results.some(line => line.row === 'docs-r:1')).toBe(true);
		const opened = documentationKey(state, 'docs-r:1', view).state;
		expect(opened.search).toBeUndefined();

		let picker = initialDocumentation;
		for (let index = 0; index < 13; index++) {
			const next = documentationKey(picker, 'c', view);
			if (next.state.picker !== undefined) {
				const chosen = documentationKey(next.state, 'picker:1', view);
				expect(chosen.effect?.kind).toBe('copy');
				return;
			}

			picker = documentationKey(picker, 'right', view).state;
		}

		throw new Error('no page has two snippets');
	});

	test('the docs reader uses the whole height of the terminal', () => {
		expect(readerHeight(30)).toBe(24);
		expect(readerHeight(50)).toBe(44);
		expect(readerHeight(10)).toBe(6);
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

describe('a stopped run', () => {
	test('says what was rolled back under the steps', () => {
		const kit = createKit(unicodeGlyphs, 104);
		let state = initialRun(
			[
				{
					id: 'validate',
					label: 'Validate with Worktrunk',
					detail: 'wt config show',
				},
			],
			'clone',
			'acme/admin',
		);
		state = updateStep(state, 'validate', 'failed', 100);
		state = {
			...state,
			outcome: [
				{ok: true, text: 'Removed the chore-trunk-setup worktree and branch.'},
				{ok: false, text: 'Could not remove the folder.'},
			],
		};
		const screen = screenText(runningLines(kit, state, 0, 30));

		expect(screen).toContain('Stopped');
		expect(screen).toContain('✗ Validate with Worktrunk');
		expect(screen).toContain(
			'✓ Removed the chore-trunk-setup worktree and branch.',
		);
		expect(screen).toContain('✗ Could not remove the folder.');
	});
});

describe('wording follows the proposal', () => {
	const kit = createKit(unicodeGlyphs, 104);

	test('a missing wt says what Trunk does through it, and a missing git the same for git', () => {
		expect(
			screenText(missingToolLines(kit, ['wt'], 'trunk clone x')),
		).toContain(
			'Trunk creates worktrees through the `wt` command, and it was not found on your',
		);
		expect(
			screenText(missingToolLines(kit, ['git'], 'trunk clone x')),
		).toContain(
			'Trunk reads and clones repositories through the `git` command',
		);
		expect(
			screenText(missingToolLines(kit, ['git', 'wt'], 'trunk clone x')),
		).toContain(
			'Trunk needs `git` and `wt` on your PATH, and neither was found.',
		);
	});

	test('a normal clone names the branch to copy into when it knows it', () => {
		const named = screenText(
			normalCloneLines(kit, {
				name: 'storefront',
				url: 'u',
				unsaved: [],
				branch: 'main',
			}),
		);
		const unnamed = screenText(
			normalCloneLines(kit, {name: 'storefront', url: 'u', unsaved: []}),
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

describe('the 80-column form', () => {
	test('folds the preview to one line that names the aliases, as the proposal does', () => {
		const narrow = createKit(unicodeGlyphs, 80);
		const screen = screenText(
			setupLines(narrow, request(), initialSetup(request()), {
				caret: true,
				rows: 30,
			}),
		);

		expect(screen).toContain('acme_<branch> · 3 hooks · wt up, wt mc');
	});

	test('leaves an alias out when its switch is off', () => {
		const narrow = createKit(unicodeGlyphs, 80);
		const state = {
			...initialSetup(request()),
			values: {...values, mcAlias: false},
		};
		const screen = screenText(
			setupLines(narrow, request(), state, {caret: true, rows: 30}),
		);

		expect(screen).toContain('acme_<branch> · 3 hooks · wt up');
		expect(screen).not.toContain('wt up, wt mc');
	});
});
