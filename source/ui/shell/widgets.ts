/**
 * The few shapes the stage's panels are built from: a bordered box, a link that
 * underlines under the pointer, a colour that settles after a pop, and the
 * existing screens' `Line`s drawn onto the grid.
 */
import type {Line} from '../kit/lines.js';
import type {Surface} from './canvas.js';
import {duration, ease, mix, running, shakeX} from './motion.js';
import type {Context} from './types.js';

export type BoxOptions = Readonly<{
	edge: string;
	fill?: string;
	dashed?: boolean;
	/** What a click anywhere in the box is aimed at. */
	k?: string;
}>;

/** A rounded box from (x, y), `w` by `h` cells; what is written inside is the caller's. */
export function box(
	s: Surface,
	context: Context,
	x: number,
	y: number,
	w: number,
	h: number,
	options: BoxOptions,
): void {
	const {g} = context;
	const style = {c: 'c-faint', fg: options.edge};
	const across = options.dashed === true ? g.dashH : g.h;
	const down = options.dashed === true ? g.dashV : g.v;
	if (options.fill !== undefined) {
		s.paint(x, y, w, h, options.fill);
	}

	if (options.k !== undefined) {
		s.hit(x, y, w, h, options.k);
	}

	s.put(x, y, `${g.tl}${across.repeat(Math.max(0, w - 2))}${g.tr}`, style);
	s.put(
		x,
		y + h - 1,
		`${g.bl}${across.repeat(Math.max(0, w - 2))}${g.br}`,
		style,
	);
	for (let row = 1; row < h - 1; row++) {
		s.put(x, y + row, down, style);
		s.put(x + w - 1, y + row, down, style);
	}
}

/** How far a thing that was pointed at has brightened, 0 to 1. */
export const hovered = (context: Context, key: string): number =>
	context.hover(key);

/** The sideways step a shaken thing is at, in cells. */
export function shakeOf(context: Context, target: string): number {
	return shakeX(
		running(context.ui.fx, `shake:${target}`, context.now, duration.shake),
	);
}

/**
 * A colour that was just set off: it starts bright and settles on `colour`, the
 * cell-grid form of a glyph that pops. `bold` is true while it is still bright.
 */
export function popped(
	context: Context,
	name: string,
	colour: string,
): {fg: string; hot: boolean} {
	const t = running(context.ui.fx, `pop:${name}`, context.now, duration.pop);
	return t === undefined
		? {fg: colour, hot: false}
		: {fg: mix(context.p.fg, colour, ease.out(t)), hot: t < 0.5};
}

/** Text that is a link: the colour of one, underlined while the pointer is over it. Returns the next column. */
export function link(
	s: Surface,
	context: Context,
	x: number,
	y: number,
	text: string,
	key: string,
	colour = context.p.info,
): number {
	const hover = context.hover(key);
	return s.put(x, y, text, {
		c: hover > 0.5 ? 'c-info u' : 'c-info',
		fg: mix(colour, context.p.fg, 0.25 * hover),
		k: key,
	});
}

/** A colour, dimmed toward the background by `amount`, for what is disabled or at its limit. */
export const faded = (
	context: Context,
	colour: string,
	amount: number,
): string => mix(context.p.bg, colour, 1 - amount);

/**
 * Lines built for the other screens, drawn from (x, y); returns the rows used.
 * Those lines carry the old two-column margin, which `strip` takes back.
 */
export function drawLines(
	s: Surface,
	context: Context,
	lines: readonly Line[],
	x: number,
	y: number,
	strip = 0,
): number {
	const {p} = context;
	// A command or a link is meant to be copied, so a soft line wraps instead of being cut.
	const room = Math.max(1, s.w - x - 1);
	let row = y;
	for (const line of lines) {
		const cells = line.segs
			.flatMap(seg => [...seg.t].map(char => ({char, seg})))
			.slice(strip);
		const pieces = [];
		for (let at = 0; at < Math.max(1, cells.length); at += room) {
			pieces.push(cells.slice(at, at + room));
			if (line.soft !== true) {
				break;
			}
		}

		for (const piece of pieces) {
			if (line.bg !== undefined) {
				s.paint(x, row, s.w - x, 1, p[line.bg === 'sel' ? 'sel' : line.bg]);
			}

			let column = x;
			for (let start = 0; start < piece.length; ) {
				const {seg} = piece[start]!;
				let end = start;
				while (end < piece.length && piece[end]!.seg === seg) {
					end += 1;
				}

				const key = seg.k ?? line.row;
				column = s.put(
					column,
					row,
					piece
						.slice(start, end)
						.map(cell => cell.char)
						.join(''),
					{
						c: seg.c,
						...(seg.fg === undefined ? {} : {fg: seg.fg}),
						...(seg.bg === undefined ? {} : {bg: seg.bg}),
						...(key === undefined ? {} : {k: key}),
					},
				);
				start = end;
			}

			row += 1;
		}
	}

	return row - y;
}
