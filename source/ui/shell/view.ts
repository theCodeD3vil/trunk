/**
 * The shell as one pure function: `frameLines(frame)` turns what the controller
 * knows (the screen, the answers, the pointer, the clock) into the lines the
 * renderer draws. Nothing here keeps state, so the same frame at the same
 * `now` is always the same picture, which is how it is tested.
 */
import type {KeyHint, Line} from '../kit/lines.js';
import {createCanvas, type Canvas, type Surface} from './canvas.js';
import {
	cap,
	drawFrame,
	drawKeys,
	drawTopBar,
	drawPreview,
	drawToast,
	geometry,
	sideWidth,
	type Cap,
	type Geo,
} from './chrome.js';
import {along, duration, ease} from './motion.js';
import {documentationLines} from './docs-view.js';
import {drawPanel} from './panels.js';
import {drawFailure, drawIdle, drawOverwrite, drawRun} from './run-panels.js';
import {drawRail, railModel} from './rail.js';
import {openStages} from './wizard.js';
import type {Context, Frame} from './types.js';

/** Smaller than this and the shell asks for a bigger window instead of drawing badly. */
export const minimum = Object.freeze({cols: 64, rows: 14});

export function makeContext(frame: Frame): Context {
	const {theme, ui, now} = frame;
	return {
		theme,
		p: theme.palette,
		g: theme.glyphs,
		now,
		ui,
		frame,
		hover(key) {
			if (!ui.motion) {
				return ui.hover === key ? 1 : 0;
			}

			// The pointer's arrival brightens a thing, its departure lets it fade.
			const t = along(ui.hoverAt, now, duration.hover);
			const reached = t === undefined ? 1 : ease.out(t);
			return ui.hover === key
				? reached
				: ui.hoverPrev === key
				? 1 - reached
				: 0;
		},
	};
}

export type Layout = Readonly<{
	geo: Geo;
	/** False when the window is too small to draw in. */
	fits: boolean;
	/** The stage's rows, and how many of them the preview takes (0 hides it). */
	stageRows: number;
	previewLines: number;
	/** The stage drawn once, how tall it is, and the keys its screen answers to. */
	stage: Canvas;
	height: number;
	hints: readonly KeyHint[];
}>;

/** The stage is drawn inside 3 columns of padding, less the one a shake needs. */
export const stageInset = 2;

const maximumPreview = 11;

/** How tall the preview is for the room left under a stage of `height` rows. */
export function previewHeight(
	rows: number,
	bodyH: number,
	height: number,
): number {
	const room = bodyH - (1 + height) - 2;
	const wanted = Math.min(maximumPreview, Math.max(3, Math.floor(rows * 0.27)));
	const lines = Math.min(wanted, room);
	return lines >= 3 ? lines : 0;
}

/** Draws the open screen's stage, folding it up if the room is short. */
export function layoutOf(frame: Frame): Layout {
	const context = makeContext(frame);
	const geo = geometry(frame.cols, frame.rows);
	const fits = frame.cols >= minimum.cols && frame.rows >= minimum.rows;
	const width = Math.max(20, geo.mainW - stageInset * 2);
	const {screen, wizard, request} = frame;
	let stage = createCanvas(width, 80);
	let height = 0;
	let hints: readonly KeyHint[] = [];
	const room = Math.max(1, geo.bodyH - 1);
	const attempt = (draw: (s: Surface) => number): boolean => {
		stage = createCanvas(width, 80);
		height = draw(stage.surface);
		return height <= room;
	};

	switch (screen.kind) {
		case 'wizard': {
			if (wizard !== undefined && request !== undefined) {
				// Keep the preview if the stage fits with it, else lose the blank rows, else lose the preview.
				const roomy = attempt(s =>
					drawPanel(s, context, wizard.stage, {compact: false}),
				);
				const tight =
					!roomy || previewHeight(frame.rows, geo.bodyH, height) === 0;
				if (tight) {
					attempt(s => drawPanel(s, context, wizard.stage, {compact: true}));
				}
			}

			break;
		}

		case 'run': {
			for (const level of [0, 1, 2, 3] as const) {
				if (attempt(s => drawRun(s, context, screen.run, level))) {
					break;
				}
			}

			break;
		}

		case 'overwrite': {
			attempt(s => {
				const drawn = drawOverwrite(s, context, screen, room);
				hints = drawn.hints;
				return drawn.height;
			});
			break;
		}

		case 'failure': {
			attempt(s => {
				const drawn = drawFailure(s, context, screen);
				hints = drawn.hints;
				return drawn.height;
			});
			break;
		}

		case 'idle': {
			attempt(s => drawIdle(s, context));
			break;
		}

		case 'docs': {
			// Drawn by `documentationLines`, before any layout is worked out.
			break;
		}
	}

	const previewLines =
		screen.kind === 'wizard' && fits
			? previewHeight(frame.rows, geo.bodyH, height)
			: 0;
	return {
		geo,
		fits,
		stageRows: geo.bodyH - (previewLines === 0 ? 0 : previewLines + 2),
		previewLines,
		stage,
		height,
		hints,
	};
}

/** The key bar for the open screen: its caps, and the word at the right. */
function keyBar(
	context: Context,
	layout: Layout,
): {caps: Cap[]; right: string} {
	const {g, frame} = context;
	const {screen, wizard, request} = frame;
	const turned = (hint: KeyHint): Cap => {
		const [glyph, label, key] = hint;
		const keys =
			glyph === g.updown
				? ['up', 'down']
				: glyph === g.leftright
				? ['left', 'right']
				: glyph === g.enter
				? ['enter']
				: [key ?? glyph];
		return cap(glyph, label, keys);
	};

	switch (screen.kind) {
		case 'wizard': {
			if (wizard === undefined || request === undefined) {
				return {caps: [], right: ''};
			}

			if (frame.ui.zoom) {
				return {
					caps: [
						cap(g.updown, 'scroll', ['up', 'down']),
						cap(g.space, 'page', ['space']),
						cap('p', 'close', ['preview']),
						cap('esc', 'close', ['esc'], false, true),
					],
					right: 'preview',
				};
			}

			const open = openStages(request, wizard.values);
			const first = open.indexOf(wizard.stage) <= 0;
			const back = cap('esc', 'back', ['esc'], first);
			const {stage} = wizard;
			// On the prefix step `p` is a letter, so the preview is Ctrl+P there.
			const preview = cap(
				stage === 'prefix' ? '^P' : 'p',
				'preview',
				['preview'],
				false,
				true,
			);
			const caps =
				stage === 'prefix'
					? [cap(g.enter, 'continue', ['enter']), preview, back]
					: stage === 'agents'
					? [
							cap(g.updown, 'move', ['up', 'down']),
							cap(g.space, 'pick', ['space']),
							cap(g.enter, 'continue', ['enter']),
							preview,
							back,
					  ]
					: stage === 'review'
					? [
							cap(g.enter, 'create project', ['enter']),
							cap('c', 'copy command', ['c']),
							preview,
							back,
					  ]
					: [
							cap(g.leftright, 'choose', ['left', 'right']),
							cap(g.space, 'toggle', ['space']),
							cap(g.enter, 'continue', ['enter']),
							preview,
							back,
					  ];
			const steps = open.filter(entry => entry !== 'review');
			return {
				caps,
				right:
					stage === 'review'
						? 'ready'
						: `step ${steps.indexOf(stage) + 1}/${steps.length}`,
			};
		}

		case 'run': {
			const {run} = screen;
			const asking =
				(run.finish?.request.push !== undefined && !run.finish.answered) ||
				run.publish?.problem !== undefined;
			const done =
				run.finish !== undefined &&
				(run.publish === undefined || run.publish.ended);
			return {
				caps: asking
					? [
							cap(g.leftright, 'choose', ['left', 'right']),
							cap(g.enter, 'confirm', ['enter']),
					  ]
					: done
					? [cap('c', 'copy next step', ['c']), cap('^C', 'close', ['ctrl-c'])]
					: [cap('^C', 'cancel', ['ctrl-c'])],
				right: asking ? 'waiting' : done ? 'done' : 'running',
			};
		}

		case 'overwrite':
		case 'failure': {
			return {
				caps: layout.hints.map(hint => turned(hint)),
				right: '',
			};
		}

		default: {
			return {caps: [cap('^C', 'cancel', ['ctrl-c'])], right: ''};
		}
	}
}

/** The message in place of a shell that would not fit. */
function tooSmall(s: Surface, context: Context): void {
	const lines = [
		'This window is too small for trunk-cli.',
		`Make it at least ${minimum.cols} columns by ${minimum.rows} rows.`,
	];
	for (const [index, line] of lines.entries()) {
		s.put(2, 1 + index, line, {c: index === 0 ? 'b' : 'c-dim'});
	}

	void context;
}

export function frameLines(frame: Frame): Line[] {
	if (frame.screen.kind === 'docs') {
		if (frame.cols < minimum.cols || frame.rows < minimum.rows) {
			const canvas = createCanvas(frame.cols, frame.rows);
			tooSmall(canvas.surface, makeContext(frame));
			return canvas.lines();
		}

		return documentationLines(frame, makeContext(frame));
	}

	const context = makeContext(frame);
	const {screen} = frame;
	const layout = layoutOf(frame);
	const {geo} = layout;
	const canvas = createCanvas(frame.cols, frame.rows);
	const app = canvas.surface.view(0, 0, geo.cols, geo.rows);
	if (!layout.fits) {
		tooSmall(app, context);
		return canvas.lines();
	}

	const zoomed = frame.ui.zoom && screen.kind === 'wizard';
	const previewY =
		zoomed || layout.previewLines === 0
			? undefined
			: geo.bodyY + layout.stageRows;
	drawFrame(app, context, geo, previewY);
	drawTopBar(app.view(0, 0, geo.cols, 1), context);

	const closed = frame.closed === true;
	const side = app.view(1, geo.bodyY, sideWidth - 1, geo.bodyH);
	drawRail(side, context, railModel(frame.request, frame.wizard, screen));

	if (zoomed) {
		// The preview takes the whole stage, a window onto the file you scroll.
		const lines = Math.max(1, geo.bodyH - 1);
		const total = frame.ui.rows.length;
		const top = Math.max(0, Math.min(frame.ui.zoomTop, total - lines));
		drawPreview(
			app.view(geo.mainX, geo.bodyY, geo.mainW, geo.bodyH),
			context,
			lines,
			{
				top,
				note: `${top + 1}-${Math.min(total, top + lines)} of ${total}`,
			},
		);
	} else {
		const main = app.view(geo.mainX, geo.bodyY, geo.mainW, layout.stageRows);
		const overflow = Math.max(0, layout.height - (layout.stageRows - 1));
		main.blit(layout.stage.surface, stageInset, 1 - overflow);
	}

	if (!zoomed && layout.previewLines > 0) {
		drawPreview(
			app.view(
				geo.mainX,
				geo.bodyY + layout.stageRows + 1,
				geo.mainW,
				layout.previewLines + 1,
			),
			context,
			layout.previewLines,
		);
	}

	const keys = keyBar(context, layout);
	drawKeys(
		app.view(0, geo.rows - 1, geo.cols, 1),
		context,
		closed ? [] : keys.caps,
		closed ? '' : keys.right,
	);
	if (!closed) {
		drawToast(app, context, geo);
	}

	return canvas.lines();
}
