/**
 * The layout toolkit behind every screen. A screen is a list of `Line`s, each a
 * list of styled segments, built by pure functions from state, a width and a
 * glyph set. Nothing here touches Ink or the terminal, so each screen can be
 * checked by reading its lines, and one renderer draws them all.
 *
 * Styles are class names such as `c-acc b` or `pill`; the renderer maps them to
 * the theme. Every glyph is single-width, which is what lets widths be counted
 * as characters.
 */
import type {Glyphs} from './glyphs.js';

/** A run of text with a style, and optionally the key a click on it presses. */
export type Seg = Readonly<{t: string; c: string; k?: string}>;
type Tuple = readonly [text: string, style?: string, key?: string];
export type Part = string | Tuple | Seg;

/** Whole-line highlight: the selected row, an added line or a removed one. */
export type LineBackground = 'sel' | 'add' | 'del';

export type Line = Readonly<{
	segs: readonly Seg[];
	bg?: LineBackground;
	/** Identifies a clickable row, for terminals that report the mouse. */
	row?: string;
	/**
	 * A command to copy: it is never clipped, and the terminal may wrap it. Every
	 * other line is cut at the screen edge so the frame's height stays exact.
	 */
	soft?: boolean;
}>;

export type KeyHint = readonly [label: string, text: string, key?: string];

/** The left and right margin every screen keeps. */
export const margin = 2;

const isTuple = (part: Part): part is Tuple => Array.isArray(part);

function normalize(part: Part): Seg {
	if (typeof part === 'string') {
		return {t: part, c: ''};
	}

	if (isTuple(part)) {
		const [t, c, k] = part;
		return k === undefined ? {t, c: c ?? ''} : {t, c: c ?? '', k};
	}

	return part;
}

export type BoxOptions = Readonly<{
	title?: string;
	titleStyle?: string;
	tag?: string;
	tagStyle?: string;
	borderStyle?: string;
}>;

export function createKit(g: Glyphs, cols: number) {
	const line = (...parts: Part[]): Line => ({
		segs: parts.map(part => normalize(part)),
	});
	const width = (l: Line): number =>
		l.segs.reduce((total, segment) => total + [...segment.t].length, 0);
	const spaces = (count: number): string => ' '.repeat(Math.max(0, count));
	const withBg = (l: Line, bg: LineBackground): Line => ({...l, bg});
	const withRow = (l: Line, row: string): Line => ({...l, row});
	const soft = (l: Line): Line => ({...l, soft: true});
	const padTo = (l: Line, w: number): Line => ({
		...l,
		segs: [...l.segs, {t: spaces(w - width(l)), c: ''}],
	});

	/** Cuts a line to at most `w` characters, keeping its styling. */
	function clip(l: Line, w: number): Line {
		const segs: Seg[] = [];
		let left = w;
		for (const segment of l.segs) {
			if (left <= 0) {
				break;
			}

			const chars = [...segment.t];
			segs.push(
				chars.length <= left
					? segment
					: {...segment, t: chars.slice(0, left).join('')},
			);
			left -= chars.length;
		}

		return {...l, segs};
	}

	/** Left content, right content, and the gap between them filled with spaces. */
	function justify(left: Line, right: Line, w: number): Line {
		const gap = w - width(left) - width(right);
		if (gap < 1) {
			const cut = clip(left, Math.max(0, w - width(right) - 1));
			return {...cut, segs: [...cut.segs, {t: ' ', c: ''}, ...right.segs]};
		}

		return {
			...left,
			segs: [...left.segs, {t: spaces(gap), c: ''}, ...right.segs],
		};
	}

	const rule = (w: number, style = 'c-faint'): Line =>
		line([g.h.repeat(Math.max(0, w)), style]);
	const indent = (lines: readonly Line[], count: number): Line[] =>
		lines.map(l => ({...l, segs: [{t: spaces(count), c: ''}, ...l.segs]}));

	/** Greedy word wrap; a word longer than the width is left whole and clipped later. */
	function wrap(text: string, w: number): string[] {
		const lines: string[] = [];
		let current = '';
		for (const word of text.split(/\s+/).filter(Boolean)) {
			if (current === '') {
				current = word;
			} else if (current.length + 1 + word.length <= w) {
				current += ` ${word}`;
			} else {
				lines.push(current);
				current = word;
			}
		}

		if (current !== '') {
			lines.push(current);
		}

		return lines.length > 0 ? lines : [''];
	}

	/**
	 * Fits text to a width. A path keeps its tail, which is the part that tells
	 * projects apart; anything else keeps its start. Either way the cut is marked.
	 */
	function fit(text: string, w: number): string {
		const chars = [...text];
		if (chars.length <= w) {
			return text;
		}

		return /^[/~]/.test(text)
			? `${g.ell}${chars.slice(chars.length - (w - 1)).join('')}`
			: `${chars.slice(0, Math.max(0, w - 1)).join('')}${g.ell}`;
	}

	const wrapLines = (text: string, w: number, style = 'c-dim'): Line[] =>
		wrap(text, w).map(t => line([t, style]));

	const keycap = (label: string, key?: string): Tuple =>
		key === undefined
			? [` ${label} `, 'keycap']
			: [` ${label} `, 'keycap', key];

	/** A rounded card. The title sits in the top border, an optional tag at its right. */
	function box(
		lines: readonly Line[],
		w: number,
		options: BoxOptions = {},
	): Line[] {
		const inner = w - 4;
		const border = options.borderStyle ?? 'c-faint';
		const {title} = options;
		// Without a title there is no label to space from, so no trailing space.
		const left = title === undefined ? `${g.tl}${g.h}` : `${g.tl}${g.h} `;
		const tag = options.tag === undefined ? undefined : ` ${options.tag} `;
		const used =
			left.length +
			(title === undefined ? 0 : [...title].length + 1) +
			(tag === undefined ? 0 : [...tag].length + 1) +
			1;
		const top = line(
			[left, border],
			...(title === undefined
				? []
				: ([
						[title, options.titleStyle ?? 'b'],
						[' ', border],
				  ] as const)),
			[g.h.repeat(Math.max(1, w - used)), border],
			...(tag === undefined
				? []
				: ([
						[tag, options.tagStyle ?? 'c-dim'],
						[g.h, border],
				  ] as const)),
			[g.tr, border],
		);
		const body = lines.map(l => {
			const cut = clip(l, inner);
			return {
				...cut,
				segs: [
					{t: `${g.v} `, c: border},
					...cut.segs,
					{t: `${spaces(inner - width(cut))} `, c: ''},
					{t: g.v, c: border},
				],
			};
		});
		return [top, ...body, line([`${g.bl}${g.h.repeat(w - 2)}${g.br}`, border])];
	}

	/** The one control for toggles and confirmations: a segmented choice. */
	function choice(
		options: readonly string[],
		selected: number,
		focus = true,
		keys?: readonly string[],
	): Part[] {
		const parts: Part[] = [];
		for (const [index, option] of options.entries()) {
			if (index > 0) {
				parts.push('  ');
			}

			const on = index === selected;
			const style = on ? (focus ? 'pill' : 'pill-dim') : 'c-dim';
			const key = keys?.[index];
			parts.push(
				key === undefined
					? [` ${option} `, style]
					: [` ${option} `, style, key],
			);
		}

		return parts;
	}

	/** The pill, the breadcrumb and a rule: the top of every full screen. */
	function header(crumbs: readonly string[], right = ''): Line[] {
		const parts: Part[] = [' ', [' trunk ', 'pill'], '  '];
		for (const [index, crumb] of crumbs.entries()) {
			if (index > 0) {
				parts.push([` ${g.arrow} `, 'c-faint']);
			}

			parts.push([crumb, index === crumbs.length - 1 ? 'b' : 'c-dim']);
		}

		return [
			justify(
				line(...parts),
				line([right === '' ? '' : `${right} `, 'c-dim']),
				cols,
			),
			rule(cols),
		];
	}

	/** The keys that work on this screen, or a one-off notice in their place. */
	function keybar(items: readonly KeyHint[], notice?: readonly Part[]): Line[] {
		if (notice !== undefined) {
			return [line('  ', ...notice)];
		}

		const parts: Part[] = ['  '];
		for (const [index, item] of items.entries()) {
			if (index > 0) {
				parts.push('   ');
			}

			parts.push(keycap(item[0], item[2]), [` ${item[1]}`, 'c-dim']);
		}

		return [line(...parts)];
	}

	/** Screen rows a line takes: one, unless it is a command the terminal wraps. */
	const rowsOf = (l: Line): number =>
		l.soft === true ? Math.max(1, Math.ceil(width(l) / cols)) : 1;
	const rowsIn = (lines: readonly Line[]): number =>
		lines.reduce((total, l) => total + rowsOf(l), 0);

	/**
	 * Body, a rule and the key bar. With `maxRows` (the terminal's height) the
	 * frame is exactly one row shorter: the key bar sits at the bottom on every
	 * screen, and the free row keeps Ink from clearing the whole screen, which it
	 * does for a frame as tall as the terminal. The `tail`, usually a question,
	 * follows the body and is never the part that gets trimmed.
	 */
	function frame(
		body: readonly Line[],
		footer: readonly Line[],
		options: {maxRows?: number; tail?: readonly Line[]} = {},
	): Line[] {
		const tail = options.tail ?? [];
		const chrome = footer.length + 1;
		if (options.maxRows === undefined) {
			return [...body, ...tail, rule(cols), ...footer];
		}

		const room = Math.max(0, options.maxRows - 1 - chrome);
		const lines: Line[] = [];
		let used = rowsIn(tail);
		for (const l of body) {
			if (used + rowsOf(l) > room) {
				break;
			}

			lines.push(l);
			used += rowsOf(l);
		}

		const padding = Array.from({length: Math.max(0, room - used)}, () =>
			line(),
		);
		return [...lines, ...tail, ...padding, rule(cols), ...footer];
	}

	return {
		g,
		cols,
		line,
		width,
		spaces,
		withBg,
		withRow,
		soft,
		padTo,
		clip,
		justify,
		rule,
		indent,
		wrap,
		fit,
		wrapLines,
		keycap,
		box,
		choice,
		header,
		keybar,
		frame,
		rowsIn,
	};
}

export type Kit = ReturnType<typeof createKit>;
