/**
 * The shell's memory. The view is a pure function of a `Frame`, so everything
 * that is not an answer lives here: what the pointer is over, which effects
 * started when, the toast, the rows of the preview, the theme. Each change goes
 * through `commit`, which compares what was with what is and starts the effect
 * that tells the user it happened. Only choosing and moving about are animated:
 * a choice slides, a glyph pops, the agents cursor travels.
 *
 * Every method takes `now`, so a test can step the clock by hand.
 */
import type {SetupValues} from '../../core/resolve.js';
import type {ConfigureRequest} from '../../core/session.js';
import type {CopyFunction} from '../../docs/clipboard.js';
import type {Theme} from '../kit/theme.js';
import {along, duration} from './motion.js';
import {buildPreview, followTop, settle} from './preview.js';
import {runOf} from './rail.js';
import type {Frame, Screen, Ui} from './types.js';
import {geometry} from './chrome.js';
import {layoutOf} from './view.js';
import {
	initialWizard,
	openStages,
	wizardKey,
	type Event,
	type Wizard,
} from './wizard.js';

export type ControllerOptions = Readonly<{
	theme: Theme;
	version: string;
	/** False draws every frame settled: no fades, slides or flashes. */
	motion: boolean;
	copy: CopyFunction;
	/** Called when something changed outside a key press, such as a copy finishing. */
	wake: () => void;
	clock: () => number;
}>;

type Snapshot = Readonly<{
	screen: Screen;
	request?: ConfigureRequest;
	wizard?: Wizard;
}>;

/** A screen nothing has happened on yet: no pointer, no effects, no toast. */
export const blankUi = (motion: boolean): Ui => ({
	hoverAt: 0,
	fx: {},
	rows: [],
	top: 0,
	zoom: false,
	zoomTop: 0,
	motion,
});

/** Longest any one effect runs, so a frame can tell when nothing is moving. */
const longest = Math.max(duration.pop, duration.select);

export function createController(options: ControllerOptions) {
	const {theme} = options;
	let size = {cols: 80, rows: 24};
	let screen: Screen = {kind: 'idle'};
	let request: ConfigureRequest | undefined;
	let wizard: Wizard | undefined;
	let closed = false;
	let ui: Ui = blankUi(options.motion);

	const snapshot = (): Snapshot => ({screen, request, wizard});

	const frameAt = (now: number): Frame => ({
		...size,
		now,
		theme,
		version: options.version,
		request,
		wizard,
		screen,
		ui,
		closed,
	});

	const patch = (changes: Partial<Ui>): void => {
		ui = {...ui, ...changes};
	};

	/** Starts the effect `name` now, unless effects are off. */
	const mark = (names: readonly string[], now: number): void => {
		if (!options.motion) {
			return;
		}

		patch({
			fx: {...ui.fx, ...Object.fromEntries(names.map(name => [name, now]))},
		});
	};

	const toast = (
		text: string,
		now: number,
		tone: 'info' | 'warn' = 'info',
	): void => {
		patch({toast: {text, tone, at: now}});
	};

	/** Starts the effects a change of choice calls for: only selecting and moving about are animated. */
	const observe = (before: Snapshot, now: number): void => {
		const started: string[] = [];
		const a = before.wizard?.values;
		const b = wizard?.values;
		if (a !== undefined && b !== undefined) {
			for (const field of ['tmux', 'copyIgnored', 'mcAlias'] as const) {
				if (a[field] !== b[field]) {
					started.push(`sel:${field}`, `pop:choice:${field}`);
				}
			}

			if (a.agents.join(',') !== b.agents.join(',')) {
				started.push('pop:agents:count');
			}
		}

		if (
			before.wizard !== undefined &&
			wizard !== undefined &&
			before.wizard.agent !== wizard.agent
		) {
			started.push(`cursor:${wizard.agent}`);
		}

		mark(started, now);
	};

	/** The preview follows the answers: changed lines animate, and the lit ones come into view. */
	const follow = (now: number): void => {
		if (
			screen.kind !== 'wizard' ||
			request === undefined ||
			wizard === undefined
		) {
			return;
		}

		const next = buildPreview(request, wizard.values, wizard.stage);
		const same =
			ui.rows.length === next.lines.length &&
			ui.rows.every(
				(row, index) =>
					row.text === next.lines[index] && row.hot === next.hot[index],
			);
		if (!same) {
			patch({rows: settle(next)});
		}

		const height = layoutOf(frameAt(now)).previewLines;
		patch({top: followTop(ui.rows, ui.top, height)});
	};

	/** How many lines of the file the zoomed preview shows: the stage's rows less its header. */
	const zoomRows = (): number =>
		Math.max(1, geometry(size.cols, size.rows).bodyH - 1);

	const scrollTo = (top: number): void => {
		patch({
			zoomTop: Math.max(0, Math.min(top, ui.rows.length - zoomRows())),
		});
	};

	/** Keys while the preview fills the stage: it scrolls, and `p` or Esc puts it back. */
	const zoomKey = (name: string): void => {
		const page = Math.max(1, zoomRows() - 1);
		switch (name) {
			case 'p':
			case 'ctrl-p':
			case 'preview':
			case 'esc': {
				patch({zoom: false});
				break;
			}

			case 'up': {
				scrollTo(ui.zoomTop - 1);
				break;
			}

			case 'down': {
				scrollTo(ui.zoomTop + 1);
				break;
			}

			case 'b': {
				scrollTo(ui.zoomTop - page);
				break;
			}

			case 'space': {
				scrollTo(ui.zoomTop + page);
				break;
			}

			case 'home': {
				scrollTo(0);
				break;
			}

			case 'end': {
				scrollTo(ui.rows.length);
				break;
			}

			default: {
				break;
			}
		}
	};

	const commit = (changes: Partial<Snapshot>, now: number): void => {
		const before = snapshot();
		screen = changes.screen ?? screen;
		request = 'request' in changes ? changes.request : request;
		wizard = 'wizard' in changes ? changes.wizard : wizard;
		observe(before, now);
		follow(now);
	};

	const events = (list: readonly Event[], now: number): void => {
		for (const event of list) {
			switch (event.kind) {
				// Only the agents picker moves: a pick pops, a refused pick shakes.
				case 'shake': {
					if (event.target.startsWith('agent:')) {
						mark([`shake:${event.target}`], now);
					}

					break;
				}

				case 'pop': {
					mark([`pop:${event.target}`], now);
					break;
				}

				case 'toast': {
					toast(event.text, now, event.tone ?? 'info');
					break;
				}

				case 'copy': {
					void copy(event.text, event.target);
					break;
				}
			}
		}
	};

	const copy = async (text: string, target: string): Promise<void> => {
		const result = await options.copy(text);
		const later = options.clock();
		if (result.ok) {
			patch({copied: {target, at: later}});
		} else {
			toast(result.message, later, 'warn');
		}

		options.wake();
	};

	return {
		get screen() {
			return screen;
		},
		get request() {
			return request;
		},
		get wizard() {
			return wizard;
		},
		get theme() {
			return theme;
		},

		resize(cols: number, rows: number, now: number): void {
			if (cols !== size.cols || rows !== size.rows) {
				size = {cols, rows};
				follow(now);
			}
		},

		/** The session is over: the next frame is the one left behind. */
		close(): void {
			closed = true;
			// What is left behind is the settled picture, not an effect caught half way.
			patch({
				motion: false,
				fx: {},
				toast: undefined,
				zoom: false,
				copied: undefined,
				hover: undefined,
				hoverPrev: undefined,
			});
		},

		/** Shows a screen other than the form. */
		show(next: Screen, now: number): void {
			patch({zoom: false});
			commit({screen: next}, now);
		},

		/** Opens the form for these questions. */
		configure(next: ConfigureRequest, now: number): void {
			const first = initialWizard(next);
			patch({zoom: false});
			commit({screen: {kind: 'wizard'}, request: next, wizard: first}, now);
			// A first picture of the file, with nothing animating.
			const preview = buildPreview(next, first.values, first.stage);
			patch({rows: settle(preview)});
			follow(now);
		},

		/** A key for the form. Returns the answers once the review is confirmed. */
		key(name: string, now: number): SetupValues | undefined {
			if (
				screen.kind !== 'wizard' ||
				request === undefined ||
				wizard === undefined
			) {
				return undefined;
			}

			if (ui.zoom) {
				zoomKey(name);
				return undefined;
			}

			// On the prefix step `p` is a letter, so only Ctrl+P opens the preview there.
			if (
				name === 'preview' ||
				name === 'ctrl-p' ||
				(name === 'p' && wizard.stage !== 'prefix')
			) {
				const first = ui.rows.findIndex(row => row.hot);
				patch({zoom: true});
				scrollTo(first - 2);
				return undefined;
			}

			const step = wizardKey(request, wizard, name);
			commit({wizard: step.state}, now);
			events(step.events, now);
			return step.create === true ? step.state.values : undefined;
		},

		hover(target: string | undefined, now: number): boolean {
			if (target === ui.hover) {
				return false;
			}

			patch({hover: target, hoverPrev: ui.hover, hoverAt: now});
			return true;
		},

		/** Copies the first next step that is not a `cd`, or the one numbered `index`. */
		copyNext(index: number | undefined): void {
			const next = runOf(screen)?.finish?.request.next;
			if (next === undefined || next.length === 0) {
				return;
			}

			const chosen =
				index ??
				Math.max(
					0,
					next.findIndex(item => !item.command.startsWith('cd ')),
				);
			void copy(next[chosen]!.command, `copy:${chosen}`);
		},

		toast,

		frame(now: number): Frame {
			return frameAt(now);
		},

		/**
		 * How long until the next frame is wanted, or undefined when nothing is
		 * moving: effects at 30 frames a second, a spinner at 12, the caret as it
		 * blinks.
		 */
		delay(now: number): number | undefined {
			let wait: number | undefined;
			const need = (ms: number): void => {
				wait = wait === undefined ? ms : Math.min(wait, ms);
			};

			if (Object.values(ui.fx).some(start => now - start < longest)) {
				need(33);
			}

			const quick = (since: number | undefined, length: number): boolean =>
				along(since, now, length) !== undefined;
			if (
				quick(ui.toast?.at, duration.toastHold) ||
				quick(ui.copied?.at, duration.copied) ||
				quick(ui.hoverAt, duration.hover)
			) {
				need(33);
			}

			const run = runOf(screen);
			if (
				run?.steps.some(step => step.status === 'active') === true ||
				run?.publish?.rows.some(row => row.status === 'active') === true ||
				screen.kind === 'idle'
			) {
				need(80);
			}

			if (
				(screen.kind === 'wizard' && wizard?.stage === 'prefix') ||
				(screen.kind === 'docs' && screen.state.search !== undefined)
			) {
				need(Math.max(16, 530 - (now % 530)));
			}

			return wait;
		},

		openStages: () =>
			request === undefined || wizard === undefined
				? []
				: openStages(request, wizard.values),
	};
}

export type Controller = ReturnType<typeof createController>;
