/**
 * The screens that are printed once and left in the scrollback, the welcome
 * and the refusals, drawn in the shell's frame: the brand along the top, the
 * body, and a foot line where the shell has its key bar. No key works on them,
 * so nothing on them looks like a key.
 */
import {createKit, type Kit, type Line} from '../kit/lines.js';
import type {Theme} from '../kit/theme.js';
import {createCanvas} from './canvas.js';
import {drawFrame, drawTopBar, geometry} from './chrome.js';
import {blankUi} from './controller.js';
import {makeContext} from './view.js';
import {drawLines} from './widgets.js';

export type SheetParts = Readonly<{
	body: readonly Line[];
	/** Dim text at the left of the foot line. */
	foot?: string;
	/** The exit status, at the right of the foot line. */
	exit?: number;
	/** Printed below the frame: commands that are meant to be copied are never cut or boxed in. */
	after?: readonly Line[];
}>;

export type SheetOptions = Readonly<{
	theme: Theme;
	version: string;
	cols: number;
	/** At the right of the bar: what this screen is. */
	crumb: string;
	/** Builds the parts, given a kit as wide as the body. */
	build: (kit: Kit) => SheetParts;
}>;

export function sheetLines(options: SheetOptions): Line[] {
	const {theme, version, cols, crumb} = options;
	const parts = options.build(createKit(theme.glyphs, cols - 2));
	const rows = parts.body.length + 4;
	const context = makeContext({
		cols,
		rows,
		now: 0,
		theme,
		version,
		screen: {kind: 'idle'},
		ui: blankUi(false),
	});
	const {p} = context;
	const geo = geometry(cols, rows, 0);
	const canvas = createCanvas(cols, rows);
	const app = canvas.surface.view(0, 0, cols, rows);
	// Always dark: the sheet carries its own background, whatever the terminal's.
	app.paint(0, 0, cols, rows, p.bg);
	drawFrame(app, context, geo, undefined);
	drawTopBar(app.view(0, 0, cols, 1), context);
	app.put(cols - 2 - [...crumb].length, 0, crumb, {c: 'c-faint'});
	drawLines(
		app.view(1, geo.bodyY, cols - 2, geo.bodyH),
		context,
		parts.body,
		0,
		0,
	);
	if (parts.foot !== undefined) {
		app.put(3, rows - 1, parts.foot, {c: 'c-dim'});
	}

	if (parts.exit !== undefined) {
		const status = `exit ${parts.exit}`;
		app.put(cols - 2 - status.length, rows - 1, status, {c: 'c-faint'});
	}

	return [...canvas.lines(), ...(parts.after ?? [])];
}
