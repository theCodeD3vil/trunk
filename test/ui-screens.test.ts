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
} from '../source/ui/screens/docs.js';
import {
	buildOverwriteModel,
	initialOverwrite,
	overwriteKey,
	overwriteLines,
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
