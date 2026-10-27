/**
 * The setup shell without a terminal. The form's rules are a pure reducer, the
 * preview is a diff, every effect is a start time read against `now`, and the
 * view is a function from a frame to lines, so each is checked here: what a key
 * does, what the preview lights, how far along an effect is at a given moment,
 * and that no frame is wider or taller than the terminal it is drawn for.
 */
import {describe, expect, test} from 'bun:test';
import {agentIds, maximumAgents} from '../source/core/agents.js';
import type {SetupValues} from '../source/core/resolve.js';
import type {
	ConfigureRequest,
	FinishRequest,
	PublishProblem,
} from '../source/core/session.js';
import {createKit, type Line} from '../source/ui/kit/lines.js';
import {unicodeGlyphs} from '../source/ui/kit/glyphs.js';
import {
	askPublish,
	endPublish,
	initialRun,
	startPublish,
	updatePublish,
	updateStep,
	type RunState,
} from '../source/ui/screens/running.js';
import {resolveTheme} from '../source/ui/kit/theme.js';
import {createCanvas} from '../source/ui/shell/canvas.js';
import {createController} from '../source/ui/shell/controller.js';
import {
	along,
	ease,
	mix,
	motionEnabled,
	shakeX,
} from '../source/ui/shell/motion.js';
import {
	buildPreview,
	followTop,
	settle,
	type Row,
} from '../source/ui/shell/preview.js';
import {centre, cut, flow, wrap} from '../source/ui/shell/text.js';
import {frameLines, makeContext} from '../source/ui/shell/view.js';
import {drawLines} from '../source/ui/shell/widgets.js';
import {
	initialWizard,
	openStages,
	scriptCommand,
	wizardKey,
	type Wizard,
} from '../source/ui/shell/wizard.js';

const text = (line: Line): string =>
	line.segs.map(segment => segment.t).join('');
const plain = (lines: readonly Line[]): string =>
	lines.map(line => text(line)).join('\n');
/** The stage column alone, rows joined, so a wrapped link reads as one. */
const stageOf = (lines: readonly Line[]): string =>
	lines.map(line => [...text(line)].slice(31, -1).join('').trim()).join('');

const values: SetupValues = {
	prefix: 'acme',
	tmux: true,
	agents: [],
	copyIgnored: false,
	mcAlias: true,
};

function request(overrides: Partial<ConfigureRequest> = {}): ConfigureRequest {
	return {
		command: 'clone',
		project: 'acme/admin',
		rootName: 'acme-admin',
		destination: '~/Projects/acme-admin',
		source: 'https://github.com/acme/admin.git',
		identifier: 'github.com/acme/admin',
		defaultBranch: 'main',
		direct: false,
		values,
		fromFlags: {},
		installedAgents: ['claude', 'codex', 'opencode', 'copilot', 'antigravity'],
		missingAgents: agentIds.filter(
			id =>
				!['claude', 'codex', 'opencode', 'copilot', 'antigravity'].includes(id),
		),
		tmuxInstalled: true,
		toSettings: answers => ({
			trunkVersion: '0.1.1',
			generatedOn: '2026-09-18',
			...answers,
		}),
		...overrides,
	};
}

/** The form after these keys, in order. */
function typed(
	over: Partial<ConfigureRequest>,
	...keys: string[]
): {wizard: Wizard; events: string[]} {
	const asked = request(over);
	let wizard = initialWizard(asked);
	const events: string[] = [];
	for (const key of keys) {
		const step = wizardKey(asked, wizard, key);
		wizard = step.state;
		events.push(...step.events.map(event => event.kind));
	}

	return {wizard, events};
}

describe('the form', () => {
	test('opens on the first question, and skips the ones a flag settled or that have nothing to ask', () => {
		expect(initialWizard(request()).stage).toBe('prefix');
		const flagged = request({
			fromFlags: {tmux: '--no-tmux'},
			values: {...values, tmux: false},
		});
		expect(openStages(flagged, flagged.values)).toEqual([
			'prefix',
			'copyIgnored',
			'mcAlias',
			'review',
		]);
		expect(
			openStages(request({installedAgents: []}), values).includes('agents'),
		).toBe(false);
	});

	test('typing edits the prefix at the caret, and Enter on an invalid one stays and says why', () => {
		const edited = typed({}, 'left', 'left', 'X');
		expect(edited.wizard.values.prefix).toBe('acXme');
		expect(edited.wizard.caret).toBe(3);
		expect(typed({}, 'home', 'delete').wizard.values.prefix).toBe('cme');
		expect(typed({}, 'backspace').wizard.values.prefix).toBe('acm');

		const empty = typed({}, 'backspace', 'backspace', 'backspace', 'backspace');
		const stuck = typed(
			{},
			'backspace',
			'backspace',
			'backspace',
			'backspace',
			'enter',
		);
		expect(empty.wizard.values.prefix).toBe('');
		expect(stuck.wizard.stage).toBe('prefix');
		expect(stuck.events).toEqual(['shake', 'toast']);
	});

	test('Enter moves on, Esc goes back, and the review is where Enter confirms', () => {
		expect(typed({}, 'enter').wizard.stage).toBe('tmux');
		expect(typed({}, 'enter', 'esc').wizard.stage).toBe('prefix');

		const asked = request();
		let wizard = initialWizard(asked);
		for (let step = 0; step < 5; step++) {
			wizard = wizardKey(asked, wizard, 'enter').state;
		}

		expect(wizard.stage).toBe('review');
		expect(wizardKey(asked, wizard, 'enter').create).toBe(true);
	});

	test('turning tmux off turns agents off with it, and says so only if there were any', () => {
		const picked = request({values: {...values, agents: ['claude']}});
		let wizard = wizardKey(picked, initialWizard(picked), 'enter').state;
		const off = wizardKey(picked, wizard, 'right');
		expect(off.state.values.tmux).toBe(false);
		expect(off.state.values.agents).toEqual([]);
		expect(off.events).toEqual([
			{
				kind: 'toast',
				text: 'Agents cleared. They need tmux.',
			},
		]);

		wizard = wizardKey(request(), initialWizard(request()), 'enter').state;
		expect(wizardKey(request(), wizard, 'right').events).toEqual([]);
		expect(wizardKey(request(), wizard, 'space').state.values.tmux).toBe(false);
	});

	test('agents are picked under the cursor in the same order whichever comes first, and only installed ones', () => {
		const asked = request({installedAgents: ['claude', 'codex']});
		const atAgents = typed(
			{installedAgents: ['claude', 'codex']},
			'enter',
			'enter',
		).wizard;
		expect(atAgents.stage).toBe('agents');

		const second = wizardKey(asked, atAgents, 'down').state;
		const both = wizardKey(
			asked,
			wizardKey(asked, second, 'space').state,
			'up',
		).state;
		expect(wizardKey(asked, both, 'space').state.values.agents).toEqual([
			'claude',
			'codex',
		]);

		// A missing agent refuses with its name, and the cursor stays on the list.
		const missing = wizardKey(asked, atAgents, `agent:${agentIds.length - 1}`);
		expect(missing.state.values.agents).toEqual([]);
		expect(missing.events.map(event => event.kind)).toEqual(['shake', 'toast']);
	});

	test('a fifth agent is refused', () => {
		const asked = request();
		const picked = agentIds
			.slice(0, maximumAgents)
			.filter(id => asked.installedAgents.includes(id));
		const wizard: Wizard = {
			...typed({}, 'enter', 'enter').wizard,
			values: {...values, agents: picked},
		};
		const index = agentIds.findIndex(
			id => asked.installedAgents.includes(id) && !picked.includes(id),
		);
		const refused = wizardKey(asked, wizard, `agent:${index}`);
		expect(refused.state.values.agents).toEqual(picked);
		expect(refused.events.map(event => event.kind)).toEqual(['shake', 'toast']);
	});

	test('the rail does not jump ahead of what was reached, or past a prefix that is wrong', () => {
		const ahead = typed({}, 'step:review');
		expect(ahead.wizard.stage).toBe('prefix');
		expect(ahead.events).toEqual(['shake', 'toast']);

		const back = typed({}, 'enter', 'enter', 'step:prefix');
		expect(back.wizard.stage).toBe('prefix');
		expect(back.events).toEqual([]);

		const broken = typed({}, 'enter', 'enter', 'step:prefix', 'backspace');
		const stuck = wizardKey(
			request(),
			{...broken.wizard, values: {...values, prefix: ''}},
			'step:tmux',
		);
		expect(stuck.state.stage).toBe('prefix');
	});

	test('a step a flag fixed shakes and names the flag', () => {
		const step = wizardKey(
			request({fromFlags: {copyIgnored: '--copy'}}),
			initialWizard(request()),
			'step:copyIgnored',
		);
		expect(step.state.stage).toBe('prefix');
		expect(step.events).toContainEqual({
			kind: 'toast',
			text: 'Copy ignored files was set by --copy.',
			tone: 'warn',
		});
	});

	test('the review copies the command that does the same without the form', () => {
		const asked = request();
		const review: Wizard = {
			...initialWizard(asked),
			stage: 'review',
			furthest: 5,
		};
		const [event] = wizardKey(asked, review, 'c').events;
		expect(event).toEqual({
			kind: 'copy',
			text: scriptCommand(asked, values),
			target: 'copy',
		});
		expect(scriptCommand(asked, {...values, tmux: false, mcAlias: false})).toBe(
			'trunk-cli clone https://github.com/acme/admin.git --yes --prefix acme --no-tmux --no-mc',
		);
	});
});

describe('the preview', () => {
	test('is the real file, with the lines the open step produces lit', () => {
		const prefix = buildPreview(request(), values, 'prefix');
		const lit = prefix.lines.filter((_, index) => prefix.hot[index]);

		expect(prefix.hot).toHaveLength(prefix.lines.length);
		expect(lit.some(line => line.includes('P=acme'))).toBe(true);
		expect(lit.length).toBeLessThan(prefix.lines.length);
		expect(prefix.lines.join('\n')).toContain('[[pre-start]]');
		expect(buildPreview(request(), values, 'review').hot.some(Boolean)).toBe(
			false,
		);
	});

	test('follows the answers, and shows a prefix that is not valid yet as typed', () => {
		const on = buildPreview(request(), values, 'tmux').lines.join('\n');
		const off = buildPreview(
			request(),
			{...values, tmux: false},
			'tmux',
		).lines.join('\n');
		expect(off).not.toBe(on);

		const typing = buildPreview(request(), {...values, prefix: ''}, 'prefix');
		expect(typing.lines.join('\n')).toContain('P=…');
		expect(typing.lines.join('\n')).not.toContain('trunk-preview');
	});

	test('the preview is drawn as it is: one row per line, lit where the step lands', () => {
		const rows = settle({lines: ['a', 'b', 'c'], hot: [false, true, false]});
		expect(rows).toEqual([
			{text: 'a', hot: false},
			{text: 'b', hot: true},
			{text: 'c', hot: false},
		]);
	});

	test('the window follows the first lit line by moving as little as it can', () => {
		const rows = (hot: number | undefined): Row[] =>
			Array.from({length: 20}, (_, index) => ({
				text: String(index),
				hot: index === hot,
			}));

		expect(followTop(rows(12), 0, 5)).toBe(8);
		expect(followTop(rows(2), 6, 5)).toBe(2);
		expect(followTop(rows(7), 6, 5)).toBe(6);
		expect(followTop(rows(undefined), 40, 5)).toBe(15);
	});
});

describe('motion', () => {
	test('an ease starts at 0, ends at 1, and never steps back', () => {
		expect(ease.out(0)).toBe(0);
		expect(ease.out(1)).toBe(1);
		let last = 0;
		for (let step = 1; step <= 20; step++) {
			const value = ease.out(step / 20);
			expect(value).toBeGreaterThanOrEqual(last);
			last = value;
		}
	});

	test('an effect is a start time read against now', () => {
		expect(along(undefined, 100, 200)).toBeUndefined();
		expect(along(0, 100, 200)).toBe(0.5);
		expect(along(0, 200, 200)).toBeUndefined();
		expect(along(0, 50, 200, 100)).toBe(0);
	});

	test('a shake steps left, right, left, right and is still', () => {
		expect([0, 0.25, 0.45, 0.65, 0.85].map(step => shakeX(step))).toEqual([
			0, -1, 1, -1, 0,
		]);
		expect(shakeX(undefined)).toBe(0);
	});

	test('colours mix between two ends and clamp', () => {
		expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
		expect(mix('#102030', '#ffffff', 0)).toBe('#102030');
		expect(mix('#102030', '#ffffff', 2)).toBe('#ffffff');
	});

	test('TRUNK_MOTION=0 turns it off', () => {
		expect(motionEnabled(Object.fromEntries([['TRUNK_MOTION', '0']]))).toBe(
			false,
		);
		expect(motionEnabled({})).toBe(true);
	});
});

describe('text', () => {
	test('cut, centre and wrap', () => {
		expect(cut('hello', 3)).toBe('he…');
		expect(cut('hello', 9)).toBe('hello');
		expect(centre('ab', 6)).toBe('  ab  ');
		expect(wrap('aa bb cc', 5)).toEqual(['aa bb', 'cc']);
		expect(wrap('abcdefghij', 4)).toEqual(['abc…']);
	});

	test('flow keeps a flag with its value, and breaks only what cannot fit alone', () => {
		const units = [
			{text: '--prefix acme'},
			{text: '--no-tmux'},
			{text: '--copy'},
		];
		expect(flow(units, 24).map(line => line.map(unit => unit.text))).toEqual([
			['--prefix acme', '--no-tmux'],
			['--copy'],
		]);
		expect(flow([{text: 'abcdefghij'}], 4).map(line => line[0]!.text)).toEqual([
			'abcd',
			'efgh',
			'ij',
		]);
	});
});

const finish: FinishRequest = {
	command: 'clone',
	project: 'acme/storefront',
	title: 'Cloned acme-admin',
	next: [
		{command: 'cd ~/Projects/acme-admin/chore-trunk-setup'},
		{command: 'wt config approvals add', note: 'review the hooks once'},
	],
	notes: [],
	push: {
		branch: 'chore/trunk-setup',
		label: 'Push chore/trunk-setup to origin',
	},
};

function shell(options: {motion?: boolean; env?: NodeJS.ProcessEnv} = {}) {
	const copied: string[] = [];
	const controller = createController({
		theme: resolveTheme(options.env ?? {}),
		version: '0.1.1',
		motion: options.motion ?? true,
		async copy(copy) {
			copied.push(copy);
			return {ok: true, via: 'test'};
		},
		wake: () => undefined,
		clock: () => 0,
	});
	return {controller, copied};
}

type Shell = ReturnType<typeof shell>['controller'];

function draw(controller: Shell, now: number, cols = 104, rows = 30): Line[] {
	controller.resize(cols, rows, now);
	return frameLines(controller.frame(now));
}

describe('the frame', () => {
	test('is settled once the effects are over, and caught part way before', () => {
		const {controller} = shell();
		controller.configure(request(), 0);
		controller.key('enter', 0);
		// Choosing is what moves: the card eases to its new state.
		controller.key('space', 0);

		const during = JSON.stringify(draw(controller, 120));
		const after = JSON.stringify(draw(controller, 3000));
		expect(during).not.toBe(after);
		expect(JSON.stringify(draw(controller, 9000))).toBe(after);
	});

	test('with effects off every moment is the settled one', () => {
		const {controller} = shell({motion: false});
		controller.configure(request(), 0);
		controller.key('enter', 0);

		expect(JSON.stringify(draw(controller, 10))).toBe(
			JSON.stringify(draw(controller, 5000)),
		);
	});

	test('only choosing and moving about are animated: a wrong prefix just says so', () => {
		const {controller} = shell();
		controller.configure(request(), 0);
		for (const key of ['backspace', 'backspace', 'backspace', 'backspace']) {
			controller.key(key, 10);
		}

		controller.key('enter', 20);
		const {ui} = controller.frame(30);
		expect(ui.fx).toEqual({});
		expect(ui.toast?.text).toBe('Fix the session prefix first.');

		// A choice, by contrast, starts its effects.
		controller.key('a', 50);
		controller.key('enter', 60);
		controller.key('space', 70);
		expect(Object.keys(controller.frame(80).ui.fx)).toContain('sel:tmux');
	});

	test('hover is a change only when the pointer moves onto something else', () => {
		const {controller} = shell();
		expect(controller.hover('step:tmux', 0)).toBe(true);
		expect(controller.hover('step:tmux', 5)).toBe(false);
		expect(controller.hover(undefined, 9)).toBe(true);
		expect(controller.frame(10).ui.hoverPrev).toBe('step:tmux');
	});

	test('asks for the next frame only while something moves', () => {
		const {controller} = shell();
		controller.configure(request(), 0);
		expect(controller.delay(100)).toBe(33);
		// The caret blinks on the prefix, but nothing else moves.
		expect(controller.delay(10_000)).toBeLessThanOrEqual(530);

		controller.key('enter', 10_000);
		expect(controller.delay(20_000)).toBeUndefined();
	});

	test('fits every terminal it supports, on every step', () => {
		for (const [cols, rows] of [
			[64, 14],
			[80, 24],
			[104, 30],
			[140, 44],
		] as const) {
			const {controller} = shell();
			controller.configure(request(), 0);
			for (let step = 0; step < 6; step++) {
				const lines = draw(controller, 9000, cols, rows);
				expect(lines, `${cols}x${rows} step ${step}`).toHaveLength(rows);
				for (const line of lines) {
					expect([...text(line)].length, text(line)).toBeLessThanOrEqual(cols);
				}

				controller.key('enter', 9000);
			}
		}
	});

	test('says so when the window is too small, and never draws outside it', () => {
		const {controller} = shell();
		controller.configure(request(), 0);
		const lines = draw(controller, 0, 60, 13);

		expect(plain(lines)).toContain('too small');
		expect(lines).toHaveLength(13);
	});

	test('in ASCII nothing but ASCII is drawn, on the form and on the run', () => {
		const {controller} = shell({
			env: Object.fromEntries([['TRUNK_ASCII', '1']]),
		});
		controller.configure(request(), 0);
		const seen: string[] = [];
		for (let step = 0; step < 6; step++) {
			seen.push(plain(draw(controller, 9000)));
			controller.key('enter', 9000);
		}

		controller.show(
			{
				kind: 'run',
				run: {
					...initialRun([], 'clone', 'acme/storefront'),
					finish: {request: finish, sel: 0, outcome: [], answered: false},
				},
			},
			9000,
		);
		seen.push(plain(draw(controller, 9000)));
		for (const frame of seen) {
			expect(frame).toMatch(/^[\n -~]*$/);
		}
	});

	test('a closed frame keeps its picture but drops the key bar', () => {
		const {controller} = shell();
		controller.configure(request(), 0);
		controller.key('enter', 0);
		expect(plain(draw(controller, 3000))).toContain('esc');

		controller.close();
		const left = plain(draw(controller, 3100));
		expect(left).toContain('tmux workspace');
		expect(left).not.toContain('esc  back');
	});

	test('lines a user is meant to copy wrap instead of being cut', () => {
		const {controller} = shell();
		controller.configure(request(), 0);
		const kit = createKit(unicodeGlyphs, 30);
		const link = 'https://example.com/a-long-link-that-wraps';
		const canvas = createCanvas(30, 6);

		const used = drawLines(
			canvas.surface,
			makeContext(controller.frame(0)),
			[kit.soft(kit.line('  ', [link, 'c-info u']))],
			0,
			0,
			2,
		);

		expect(used).toBe(2);
		expect(
			canvas
				.lines()
				.slice(0, 2)
				.map(line => text(line).trimEnd())
				.join(''),
		).toBe(link);
	});
});

describe('the zoomed preview', () => {
	/** A form on its second step, drawn once so the stage has a size. */
	const second = (): Shell => {
		const {controller} = shell();
		controller.configure(request(), 0);
		controller.key('enter', 0);
		draw(controller, 0, 100, 28);
		return controller;
	};

	test('P opens it, arrows and pages scroll it, and Esc closes it where it was', () => {
		const controller = second();
		const stage = controller.frame(0).wizard?.stage;
		controller.key('p', 0);
		expect(controller.frame(0).ui.zoom).toBe(true);
		expect(plain(draw(controller, 0, 100, 28))).toMatch(/\d+-\d+ of \d+/);

		controller.key('end', 0);
		expect(controller.frame(0).ui.zoomTop).toBeGreaterThan(0);
		controller.key('home', 0);
		expect(controller.frame(0).ui.zoomTop).toBe(0);
		controller.key('space', 0);
		expect(controller.frame(0).ui.zoomTop).toBeGreaterThan(0);
		controller.key('b', 0);
		expect(controller.frame(0).ui.zoomTop).toBe(0);

		// Esc closes the preview, not the step.
		controller.key('esc', 0);
		expect(controller.frame(0).ui.zoom).toBe(false);
		expect(controller.frame(0).wizard?.stage).toBe(stage);
	});

	test('a click on its header opens it and P closes it', () => {
		const controller = second();
		controller.key('preview', 0);
		expect(controller.frame(0).ui.zoom).toBe(true);
		controller.key('p', 0);
		expect(controller.frame(0).ui.zoom).toBe(false);
	});

	test('on the prefix step P is a letter, so only Ctrl+P opens it', () => {
		const {controller} = shell();
		controller.configure(request(), 0);
		controller.key('p', 0);
		expect(controller.frame(0).ui.zoom).toBe(false);
		expect(controller.frame(0).wizard?.values.prefix).toEndWith('p');
		controller.key('ctrl-p', 0);
		expect(controller.frame(0).ui.zoom).toBe(true);
	});

	test('the key bar offers it, and drops it first when the window is narrow', () => {
		const controller = second();
		const bar = (cols: number, rows: number): string =>
			plain(draw(controller, 0, cols, rows)).split('\n').at(-1)!;
		expect(bar(140, 36)).toContain('preview');
		expect(bar(80, 24)).not.toContain('preview');
		expect(bar(80, 24)).toContain('continue');
	});
});

describe('the toast', () => {
	test('sits at the top right, padded, and goes after a moment', () => {
		const {controller} = shell();
		controller.configure(request(), 0);
		for (let index = 0; index < 4; index++) {
			controller.key('backspace', 10);
		}

		controller.key('enter', 20);
		const row = draw(controller, 30)
			.map(line => text(line))
			.find(line => line.includes('Fix the session prefix first.'))!;
		expect(row.indexOf('Fix the session prefix first.')).toBeGreaterThan(60);
		expect(plain(draw(controller, 30_000))).not.toContain(
			'Fix the session prefix first.',
		);
	});
});

describe('the run and the publish steps', () => {
	const destination = 'github.com:acme/storefront';
	const asked = {
		branch: 'chore/trunk-setup',
		destination,
		withPullRequest: true,
	};
	const answered = (): RunState => ({
		...initialRun([], 'clone', 'acme/storefront'),
		finish: {request: finish, sel: 0, outcome: [], answered: true},
	});
	const started = (withPullRequest = true): RunState =>
		startPublish(answered(), {...asked, withPullRequest});
	const at = (run: RunState, now: number, cols = 104, rows = 30): Line[] => {
		const {controller} = shell();
		controller.configure(request(), 0);
		// Shown long before it is drawn, so the panel has finished arriving.
		controller.show({kind: 'run', run}, now - 10_000);
		return draw(controller, now, cols, rows);
	};

	const screenAt = (run: RunState, now: number, cols?: number, rows?: number) =>
		plain(at(run, now, cols, rows));

	test('the question gives way to two named steps, the first waiting to start', () => {
		const screen = screenAt(started(), 0);

		expect(screen).toContain('Publishing chore/trunk-setup');
		expect(screen).toMatch(/○\s+Push to origin\s+chore\/trunk-setup/);
		expect(screen).toMatch(/○\s+Open pull request\s+gh pr create --fill/);
		expect(screen).not.toContain('open a pull request?');
		expect(screen).toContain('^C  cancel');
	});

	test('the push turns and counts up while it runs, and the pull request waits', () => {
		const state = updatePublish(started(), 'push', 'active', 1000);
		const early = screenAt(state, 2400);

		expect(early).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+Push to origin.*1\.4s/);
		expect(early).toMatch(/○\s+Open pull request/);
		expect(early).not.toBe(screenAt(state, 2480));
	});

	test('a push still going after ten seconds says so, and how to stop waiting', () => {
		const state = updatePublish(started(), 'push', 'active', 0);

		expect(screenAt(state, 9900)).not.toContain('Still waiting');
		expect(screenAt(state, 12_400)).toContain(
			'Still waiting for github.com (12s). Ctrl+C stops waiting.',
		);
	});

	test('a good push and pull request end with both ticked and the way to open it', () => {
		let state = updatePublish(started(), 'push', 'active', 0);
		state = updatePublish(state, 'push', 'done', 2600);
		state = updatePublish(state, 'pr', 'active', 2600);
		state = updatePublish(
			state,
			'pr',
			'done',
			4000,
			'#12  github.com/acme/storefront/pull/12',
		);
		state = endPublish(state, [
			{
				ok: true,
				plain: true,
				text: 'Open it with  ',
				command: 'gh pr view --web',
			},
		]);
		const screen = screenAt(state, 9000);

		expect(screen).toContain('Published chore/trunk-setup');
		expect(screen).toMatch(/✓\s+Push to origin.*2\.6s/);
		expect(screen).toMatch(/✓\s+Open pull request\s+#12.*1\.4s/);
		expect(screen).toContain('Open it with  gh pr view --web');
		expect(screen).toContain('^C  close');
	});

	test('without a pull request there is one step, and the compare link follows whole', () => {
		const link =
			'https://github.com/acme/storefront/compare/chore%2Ftrunk-setup?expand=1';
		let state = startPublish(answered(), {...asked, withPullRequest: false});
		state = updatePublish(state, 'push', 'done', 1000);
		state = endPublish(state, [
			{ok: true, plain: true, text: 'Open a pull request  ', link},
		]);
		const lines = at(state, 9000);
		const screen = plain(lines);

		expect(screen).not.toContain('Open pull request');
		expect(screen).toContain('Published chore/trunk-setup');
		// At this width the link wraps, but every character of it is there.
		expect(stageOf(lines)).toContain(link);
	});

	describe('when the push fails', () => {
		const problem: PublishProblem = {
			tone: 'error',
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

		test('the step is crossed, the next one is skipped, and a card says what to do', () => {
			const screen = screenAt(failed(), 9000);

			expect(screen).toContain('Publishing chore/trunk-setup stopped');
			expect(screen).toMatch(/✗\s+Push to origin\s+failed\s+2\.0s/);
			expect(screen).toMatch(/—\s+Open pull request\s+skipped/);
			expect(screen).toContain('✗ Push failed');
			expect(screen).toContain('To github.com:acme/storefront.git');
			expect(screen).toContain('permission denied');
			expect(screen).toMatch(
				/Fix\s+Check that you can write to acme\/storefront, then try/,
			);
			expect(screen).toContain('Then  git push -u origin chore/trunk-setup');
			expect(screen).toContain('Try again, or leave it local?');
			expect(screen).toMatch(
				/Retry\s+Not now\s+Nothing was changed on origin\./,
			);
			expect(screen).toMatch(/←→\s+choose\s+⏎\s+confirm/);
		});

		test('the buttons carry their clicks', () => {
			const keys = new Set(
				at(failed(), 9000).flatMap(line => line.segs.map(segment => segment.k)),
			);

			expect(keys.has('retry')).toBe(true);
			expect(keys.has('later')).toBe(true);
		});

		test('retrying clears the card and starts the step again', () => {
			const state = updatePublish(failed(), 'push', 'active', 5000);

			expect(state.publish?.problem).toBeUndefined();
			expect(screenAt(state, 5500)).not.toContain('Push failed');
			expect(screenAt(state, 5500)).toMatch(
				/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+Push to origin.*0\.5s/,
			);
		});

		test('leaving it local ends with how to push later', () => {
			const state = endPublish(failed(), [
				{ok: true, text: 'Kept it local.'},
				{
					ok: true,
					plain: true,
					text: 'When you are ready: ',
					command: 'git push -u origin chore/trunk-setup',
				},
			]);
			const screen = screenAt(state, 9000);

			expect(screen).toContain('✓ Kept it local.');
			expect(screen).toContain(
				'When you are ready: git push -u origin chore/trunk-setup',
			);
			expect(screen).not.toContain('Try again');
			expect(screen).toContain('^C  close');
		});

		test('the question and the whole command survive an 80 by 24 terminal', () => {
			const lines = at(failed(), 9000, 80, 24);
			const screen = plain(lines);

			expect(lines).toHaveLength(24);
			expect(screen).toContain('Try again, or leave it local?');
			expect(screen).toContain('Retry');
			// The command does not fit the card, so it goes below it, uncut.
			expect(screen).toContain('run the command below');
			expect(screen).toContain('git push -u origin chore/trunk-setup');
		});
	});

	describe('when the pull request fails after a good push', () => {
		const problem: PublishProblem = {
			tone: 'warning',
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

		test('the push stays ticked, the problem is amber, and the title says what did happen', () => {
			const screen = screenAt(warned(), 9000);

			expect(screen).toContain('Pushed chore/trunk-setup');
			expect(screen).not.toContain('stopped');
			expect(screen).toMatch(/✓\s+Push to origin/);
			expect(screen).toMatch(/▲\s+Open pull request\s+no pull request/);
			expect(screen).toContain('▲ Pushed, but no pull request');
			expect(screen).toContain('Then  gh auth login');
			expect(screen).toContain('Try opening it again?');
		});

		test('a short link is inside the card, and a long one goes below it, whole', () => {
			const inside = screenAt(warned('https://example.com/short'), 9000);
			expect(inside).toContain('Or    open it yourself:');
			expect(inside).toContain('https://example.com/short');
			expect(inside).not.toContain('In full, to copy');

			const long =
				'https://github.com/an-organisation-with-a-long-name/a-repository-with-an-equally-long-name/compare/chore%2Ftrunk-setup?expand=1';
			const lines = at(warned(long), 9000, 104, 40);
			expect(plain(lines)).toContain('open it yourself, link below');
			expect(stageOf(lines)).toContain(long);
		});
	});

	describe('when Ctrl+C stops it', () => {
		test('the line says it is stopping until the command has gone', () => {
			const running = updatePublish(started(), 'push', 'active', 0);
			const stopping: RunState = {
				...running,
				publish: {...running.publish!, stopping: true},
			};

			expect(screenAt(stopping, 1000)).toContain('Stopping…');
			expect(screenAt(running, 1000)).not.toContain('Stopping…');
		});

		test('the step reads cancelled, the next one skipped, and the way to finish is on screen', () => {
			let state = updatePublish(started(), 'push', 'active', 0);
			state = updatePublish(state, 'push', 'cancelled', 1800);
			state = endPublish(state, [
				{
					ok: false,
					tone: 'warning',
					text: 'Stopped waiting. Check with git status -sb, or run it later:',
				},
				{
					ok: true,
					plain: true,
					text: '',
					command: 'git push -u origin chore/trunk-setup',
				},
			]);
			const screen = screenAt(state, 9000);

			expect(screen).toContain('Publishing chore/trunk-setup stopped');
			expect(screen).toMatch(/—\s+Push to origin\s+cancelled\s+1\.8s/);
			expect(screen).toMatch(/—\s+Open pull request\s+skipped/);
			expect(screen).toContain(
				'▲ Stopped waiting. Check with git status -sb, or run it later:',
			);
			expect(screen).toContain('git push -u origin chore/trunk-setup');
		});

		test('while it runs, the key bar offers Ctrl+C as something to click', () => {
			const lines = at(updatePublish(started(), 'push', 'active', 0), 500);
			const bar = lines.at(-1)!;

			expect(text(bar)).toContain('^C');
			expect(bar.segs.some(segment => segment.k === 'ctrl-c')).toBe(true);
		});
	});

	test('every publish state fits 80 and 104 columns, and is as tall as the frame', () => {
		const states: RunState[] = [
			started(),
			updatePublish(started(), 'push', 'active', 0),
			endPublish(updatePublish(started(), 'push', 'done', 900), []),
		];
		for (const [cols, rows] of [
			[80, 24],
			[104, 30],
		] as const) {
			for (const state of states) {
				const lines = at(state, 12_000, cols, rows);

				expect(lines).toHaveLength(rows);
				for (const line of lines) {
					expect([...text(line)].length).toBeLessThanOrEqual(cols);
				}
			}
		}
	});

	test('the first next step that is not a cd is what c copies', () => {
		const {controller, copied} = shell();
		controller.configure(request(), 0);
		controller.show({kind: 'run', run: answered()}, 0);

		controller.copyNext(undefined);
		controller.copyNext(0);
		expect(copied).toEqual([
			'wt config approvals add',
			'cd ~/Projects/acme-admin/chore-trunk-setup',
		]);
	});
});
