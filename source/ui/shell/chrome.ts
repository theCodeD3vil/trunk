/**
 * The parts of the shell that stay put while the step in the middle changes:
 * the frame and its rules, the bar along the top, the key bar along the foot,
 * the toast that floats above it, and the preview of the file being made.
 *
 * Everything here draws on a surface that is the app itself, so a column of 0 is
 * the app's left border however wide the terminal is.
 */
import {cellSlice, width as textWidth} from '../width.js';
import type {Surface} from './canvas.js';
import {duration, mix} from './motion.js';
import {highlight} from './preview.js';
import {centre, cut, wrap} from './text.js';
import type {Context} from './types.js';

/** Columns of padding either side of a toast's text. */
const toastPadX = 2;

/** Columns from the app's left border to the divider between rail and stage. */
export const sideWidth = 30;

export type Geo = Readonly<{
	/** The app's size, which is the window's. */
	cols: number;
	rows: number;
	/** The rows between the rule under the top bar and the one over the keys. */
	bodyY: number;
	bodyH: number;
	/** The stage's column and width, inside the app. */
	mainX: number;
	mainW: number;
	/** Columns from the left border to the rail's divider; 0 when the rail is folded away. */
	side: number;
}>;

/** The app fills the window; the rail keeps its width (or is folded away) and the stage takes the rest. */
export function geometry(width: number, rows: number, side = sideWidth): Geo {
	const cols = width;
	const mainX = side === 0 ? 1 : side + 1;
	return {
		cols,
		rows,
		bodyY: 2,
		bodyH: Math.max(0, rows - 4),
		mainX,
		mainW: Math.max(0, cols - mainX - 1),
		side,
	};
}

/** The border, the rule under the bar and over the keys, the rail's divider and where they meet. */
export function drawFrame(
	s: Surface,
	context: Context,
	geo: Geo,
	previewY: number | undefined,
): void {
	const {g, p} = context;
	const style = {c: 'c-faint', fg: p.line};
	const right = geo.cols - 1;
	for (let y = 0; y < geo.rows; y++) {
		s.put(0, y, g.v, style);
		s.put(right, y, g.v, style);
	}

	if (geo.side > 0) {
		for (let y = geo.bodyY; y < geo.rows - 2; y++) {
			s.put(geo.side, y, g.v, style);
		}
	}

	const across = (y: number, junction: string): void => {
		s.put(0, y, g.tee, style);
		s.put(1, y, g.h.repeat(geo.cols - 2), style);
		s.put(right, y, g.teeL, style);
		if (geo.side > 0) {
			s.put(geo.side, y, junction, style);
		}
	};

	across(1, g.teeD);
	across(geo.rows - 2, g.teeU);
	if (previewY !== undefined) {
		s.put(geo.side, previewY, g.tee, style);
		s.put(geo.side + 1, previewY, g.h.repeat(geo.mainW), style);
		s.put(right, previewY, g.teeL, style);
	}
}

/** The top bar: Trunk on the left; what is being set up on the right. */
export function drawTopBar(s: Surface, context: Context): void {
	const {p, g, frame} = context;
	s.put(2, 0, g.hot, {c: 'c-acc', fg: p.acc});
	let x = s.put(4, 0, 'trunk-cli', {c: 'b'});
	x = s.put(x + 1, 0, `v${frame.version}`, {c: 'c-dim'});

	// The right: the mode it runs in, the project, and where that came from.
	const {request} = frame;
	if (request === undefined) {
		return;
	}

	const mode = ` ${request.command} `;
	const source =
		request.identifier ??
		(request.command === 'init' ? request.destination : request.project);
	const room = s.w - 2 - (x + 2);
	const name = cut(
		request.rootName,
		Math.max(8, room - mode.length - 2),
		g.ell,
	);
	const after = room - mode.length - 2 - textWidth(name) - 2;
	const where = after >= 8 ? cut(source, after, g.ell) : '';
	const width =
		mode.length +
		2 +
		textWidth(name) +
		(where === '' ? 0 : 2 + textWidth(where));
	let at = s.w - 2 - width;
	at = s.put(at, 0, mode, {c: 'pill'});
	at = s.put(at + 2, 0, name, {c: 'b'});
	if (where !== '') {
		s.put(at + 2, 0, where, {c: 'c-faint'});
	}
}

export type Cap = Readonly<{
	/** What the cap shows and says. */
	glyph: string;
	label: string;
	/** The keys that press it; a click on it sends the first. */
	keys: readonly string[];
	off?: boolean;
	/** Left out when the bar is too narrow for every cap. */
	optional?: boolean;
}>;

export const cap = (
	glyph: string,
	label: string,
	keys: readonly string[],
	off = false,
	optional = false,
): Cap => ({glyph, label, keys, off, optional});

/** The key bar: a cap per key, which brightens under the pointer, and a status on the right. */
export function drawKeys(
	s: Surface,
	context: Context,
	caps: readonly Cap[],
	right: string,
): void {
	const {p} = context;
	const widthOf = (cap: Cap): number =>
		Math.max(3, [...cap.glyph].length + 2) + 1 + [...cap.label].length + 3;
	const room = s.w - 4 - (right === '' ? 0 : [...right].length + 2);
	const fits = caps.reduce((sum, cap) => sum + widthOf(cap), 0) <= room;
	let x = 2;
	for (const cap of fits ? caps : caps.filter(entry => !entry.optional)) {
		const key = cap.keys[0]!;
		const off = cap.off === true;
		const hover = off ? 0 : context.hover(key);
		const aim = off ? {} : {k: key};
		const face = centre(cap.glyph, Math.max(3, [...cap.glyph].length + 2));
		x = s.put(x, 0, face, {
			c: off ? 'c-faint' : 'keycap',
			fg: off ? mix(p.bg, p.fg, 0.38) : p.fg,
			bg: mix(p.line, p.faint, 0.4 * hover),
			...aim,
		});
		x = s.put(x, 0, ` ${cap.label}`, {
			c: off ? 'c-faint' : 'c-dim',
			fg: off ? mix(p.bg, p.dim, 0.38) : mix(p.dim, p.fg, hover),
			...aim,
		});
		x += 3;
	}

	if (right !== '') {
		s.put(s.w - 2 - [...right].length, 0, right, {c: 'c-faint'});
	}
}

/** A padded note at the top right, over the corner of the stage, for a moment after something happens. */
export function drawToast(s: Surface, context: Context, geo: Geo): void {
	const {p, now, ui} = context;
	const {toast} = ui;
	if (toast === undefined || now - toast.at >= duration.toastHold) {
		return;
	}

	const warn = toast.tone === 'warn';
	const lines = wrap(toast.text, Math.max(8, Math.min(44, geo.cols - 16)));
	const inner = Math.max(...lines.map(line => textWidth(line)));
	const width = inner + toastPadX * 2;
	const x = geo.cols - 2 - width;
	const y = geo.bodyY;
	const style = {c: warn ? 'chip c-warn' : 'chip', bg: p.sel};
	const blank = ' '.repeat(width);
	s.put(x, y, blank, style);
	for (const [index, line] of lines.entries()) {
		s.put(x, y + 1 + index, blank, style);
		s.put(x + toastPadX, y + 1 + index, line, {
			...style,
			fg: warn ? p.warn : p.fg,
		});
	}

	s.put(x, y + 1 + lines.length, blank, style);
}

/** A colour for a run of the file: a comment, a table, a key, a string, or plain. */
function colourOf(context: Context, tone: string, hot: boolean): string {
	const {p} = context;
	switch (tone) {
		case 'c-faint': {
			return p.faint;
		}

		case 'c-info': {
			return p.info;
		}

		case 'c-acc': {
			return p.acc;
		}

		case 'c-ok': {
			return p.ok;
		}

		default: {
			return hot ? p.fg : p.dim;
		}
	}
}

/** The preview: a header, then a window onto the generated file, the lines your choice lands on lit. */
export function drawPreview(
	s: Surface,
	context: Context,
	height: number,
	zoomed?: {top: number; note: string},
): void {
	const {p, g, ui} = context;
	const window = zoomed ?? {top: ui.top, note: 'highlighted: set by this step'};
	const title = '.CONFIG/WT.TOML';
	const {note} = window;
	s.hit(0, 0, s.w, 1, 'preview');
	s.put(3, 0, title, {
		c: 'c-faint',
		fg: mix(p.faint, p.fg, context.hover('preview')),
		k: 'preview',
	});
	// On a narrow stage the note would run into the title, so it goes.
	if (3 + title.length + 2 + note.length <= s.w - 3) {
		s.put(s.w - 3 - note.length, 0, note, {c: 'c-dim'});
	}

	const colours = highlight(ui.rows.map(row => row.text));
	const right = s.w - 3;
	let y = 1;
	for (let index = window.top; index < ui.rows.length && y <= height; index++) {
		const row = ui.rows[index]!;
		const base = row.hot ? p.sel : p.bg;
		if (row.hot) {
			s.paint(5, y, right - 5, 1, base);
		}

		s.put(3, y, row.hot ? g.hot : g.v, {
			c: row.hot ? 'c-acc' : 'c-faint',
			fg: row.hot ? p.acc : p.line,
		});
		let x = 5;
		for (const run of colours[index] ?? []) {
			const text = cellSlice(run.t, Math.max(0, right - x));
			x = s.put(x, y, text, {
				c: run.c === '' ? (row.hot ? 'c-fg' : 'c-dim') : run.c,
				fg: colourOf(context, run.c, row.hot),
			});
		}

		y += 1;
	}
}
