/**
 * The docs browser as a screen of the shell: topics and sections in the rail,
 * the page in the stage, and the same frame, key bar and toast as the setup
 * form. Below `foldBelow` columns the rail folds away and Left and Right step
 * through the sections. The page itself, the keys and the state are in
 * `screens/docs.ts`; this file only draws them.
 */
import {topics} from '../../docs/index.js';
import {search} from '../../docs/search.js';
import {createKit, type Kit, type Line} from '../kit/lines.js';
import {width as textWidth} from '../width.js';
import {
	flat,
	highlight,
	readerContent,
	type DocumentationState,
} from '../screens/docs.js';
import {createCanvas, type Surface} from './canvas.js';
import {
	cap,
	drawFrame,
	drawKeys,
	drawToast,
	drawTopBar,
	geometry,
	sideWidth,
	type Cap,
	type Geo,
} from './chrome.js';
import {mix} from './motion.js';
import {cut} from './text.js';
import type {Context, Frame} from './types.js';
import {box, drawLines} from './widgets.js';

/** Narrower than this and the rail folds away. */
export const foldBelow = 100;

/** Columns between the stage's edge and the page; the scroll bar sits in the last one. */
const inset = 3;

export type DocumentationLayout = Readonly<{
	geo: Geo;
	folded: boolean;
	/** Columns of text the page gets, and the rows it shows. */
	width: number;
	height: number;
}>;

/** Where everything goes for a window of this size; the keys use it to know how far the page scrolls. */
export function documentationLayout(
	cols: number,
	rows: number,
): DocumentationLayout {
	const folded = cols < foldBelow;
	const geo = geometry(cols, rows, folded ? 0 : sideWidth);
	return {
		geo,
		folded,
		width: Math.max(10, geo.mainW - inset * 2 - 1),
		height: Math.max(1, geo.bodyH - 2),
	};
}

type Keys = {caps: Cap[]; right: string};

const positionOf = (state: DocumentationState): number =>
	flat.findIndex(
		item =>
			item.topicIndex === state.topic && item.sectionIndex === state.section,
	);

/** After the brand: that this is the docs, and which topic and section is open. */
function drawCrumb(
	s: Surface,
	context: Context,
	state: DocumentationState,
): void {
	const {g} = context;
	const mode = ' docs ';
	// The brand takes the left of the bar.
	const room = s.w - 2 - 24 - mode.length - 2;
	const name = cut(
		topics[state.topic]?.title ?? '',
		Math.max(0, Math.min(room, 24)),
		g.ell,
	);
	const after = room - textWidth(name) - 2;
	const where =
		after >= 6
			? cut(
					topics[state.topic]?.sections[state.section]?.title ?? '',
					after,
					g.ell,
			  )
			: '';
	const width =
		mode.length +
		(name === '' ? 0 : 2 + textWidth(name)) +
		(where === '' ? 0 : 2 + textWidth(where));
	let at = s.put(s.w - 2 - width, 0, mode, {c: 'pill'});
	if (name !== '') {
		at = s.put(at + 2, 0, name, {c: 'b'});
	}

	if (where !== '') {
		s.put(at + 2, 0, where, {c: 'c-faint'});
	}
}

/** Every topic as a heading and its sections beneath, the open one lit; the open one is kept in view. */
function drawRail(
	s: Surface,
	context: Context,
	state: DocumentationState,
): void {
	const {p, g} = context;
	type Item = {y: number; heading?: string; key?: string; title?: string};
	const items: Item[] = [];
	let y = 1;
	let current = 1;
	for (const [topicIndex, topic] of topics.entries()) {
		if (topicIndex > 0) {
			y += 1;
		}

		items.push({y, heading: topic.title});
		y += 1;
		for (const [sectionIndex, section] of topic.sections.entries()) {
			if (topicIndex === state.topic && sectionIndex === state.section) {
				current = y;
			}

			items.push({
				y,
				key: `docs-s:${topicIndex}:${sectionIndex}`,
				title: section.title,
			});
			y += 1;
		}
	}

	const top = Math.max(0, Math.min(y - s.h, current - (s.h - 3)));
	for (const item of items) {
		const row = item.y - top;
		if (row < 0 || row >= s.h) {
			continue;
		}

		if (item.heading !== undefined) {
			s.put(2, row, cut(item.heading.toUpperCase(), s.w - 3, g.ell), {
				c: 'c-faint',
			});
			continue;
		}

		const key = item.key!;
		const on = item.y === current;
		const hover = context.hover(key);
		s.hit(0, row, s.w, 1, key);
		s.put(3, row, on ? g.node.active : g.node.todo, {
			c: on ? 'c-acc' : 'c-faint',
			fg: on ? p.acc : mix(p.faint, p.fg, hover),
		});
		s.put(5, row, cut(item.title!, s.w - 6, g.ell), {
			c: on ? 'b' : 'c-dim',
			fg: on ? p.fg : mix(p.dim, p.fg, hover),
		});
	}
}

/** The open section, scrolled, with a bar down the right when it is longer than the window. */
function drawReader(
	stage: Surface,
	context: Context,
	kit: Kit,
	state: DocumentationState,
	layout: DocumentationLayout,
): Keys {
	const {g} = context;
	const {lines, blocks} = readerContent(
		kit,
		state.topic,
		state.section,
		layout.width,
	);
	const maximum = Math.max(0, lines.length - layout.height);
	const scroll = Math.min(Math.max(state.scroll, 0), maximum);
	// One more column than the text, since a line is cut a column short of its view.
	drawLines(
		stage.view(inset, 1, layout.width + 1, layout.height),
		context,
		lines.slice(scroll, scroll + layout.height),
		0,
		0,
	);
	if (maximum > 0) {
		const thumbAt = Math.round((scroll / maximum) * (layout.height - 3));
		for (let row = thumbAt; row < thumbAt + 3; row++) {
			stage.put(stage.w - 2, 1 + row, g.thumb, {c: 'c-dim'});
		}
	}

	return {
		caps: [
			cap(g.updown, 'scroll', ['up', 'down'], false, true),
			cap(g.leftright, 'section', ['left', 'right']),
			...(blocks.length > 0
				? [
						cap(
							'c',
							blocks.length > 1 ? `copy (${blocks.length})` : 'copy',
							['c'],
							false,
							true,
						),
				  ]
				: []),
			cap('/', 'search', ['/']),
			cap('q', 'quit', ['q']),
		],
		right: `${positionOf(state) + 1}/${flat.length}`,
	};
}

/** The search box and the matches under it, two rows each. */
function drawSearch(
	stage: Surface,
	context: Context,
	kit: Kit,
	state: DocumentationState,
): Keys {
	const {g, p, now} = context;
	const {line, justify, withRow, withBg} = kit;
	const current = state.search!;
	const results = search(current.query);
	const sel = Math.min(current.sel, Math.max(0, results.length - 1));
	const wide = stage.w - inset * 2;
	box(stage, context, inset, 1, wide, 3, {edge: p.acc});
	const status =
		results.length > 0
			? `${results.length} result${results.length > 1 ? 's' : ''}`
			: current.query === ''
			? 'titles, prose and code'
			: 'no matches';
	const caret = Math.floor(now / 530) % 2 === 0 ? g.caret : ' ';
	let x = stage.put(inset + 2, 2, '/ ', {c: 'c-acc b'});
	x = stage.put(x, 2, current.query, {c: 'b'});
	stage.put(x, 2, caret, {c: 'c-acc'});
	stage.put(inset + wide - 2 - [...status].length, 2, status, {c: 'c-dim'});

	// Three rows a match: its title, a line of it, and a gap.
	const capacity = Math.max(1, Math.floor((stage.h - 5) / 3));
	const start = Math.min(
		Math.max(0, sel - capacity + 1),
		Math.max(0, results.length - capacity),
	);
	const rows: Line[] = [];
	for (const [offset, result] of results
		.slice(start, start + capacity)
		.entries()) {
		const index = start + offset;
		const on = index === sel;
		const title = justify(
			line(
				[on ? `${g.arrow} ` : '  ', 'c-acc b'],
				[result.sectionTitle, on ? 'b c-acc' : 'b'],
			),
			line([`${result.topicTitle} `, 'c-dim']),
			wide,
		);
		const snippet = line(
			'  ',
			...highlight(result.snippet.text, current.query, 'c-dim'),
		);
		const key = `docs-r:${index}`;
		rows.push(
			withRow(on ? withBg(title, 'sel') : title, key),
			withRow(on ? withBg(snippet, 'sel') : snippet, key),
			line(),
		);
	}

	drawLines(stage.view(inset, 5, wide + 1, stage.h - 5), context, rows, 0, 0);
	return {
		caps: [
			cap(g.updown, 'move', ['up', 'down']),
			cap(g.enter, 'open', ['enter']),
			cap('esc', 'close', ['esc']),
		],
		right: 'search',
	};
}

/** The question of which snippet to copy, when a page has more than one. */
function drawPicker(
	stage: Surface,
	context: Context,
	kit: Kit,
	state: DocumentationState,
	layout: DocumentationLayout,
): Keys {
	const {g} = context;
	const {line, withRow, withBg} = kit;
	const {blocks} = readerContent(kit, state.topic, state.section, layout.width);
	const wide = stage.w - inset * 2;
	const rows: Line[] = [
		line(['Copy which snippet?', 'b']),
		line(),
		...blocks.map((block, index) => {
			const on = index === state.picker;
			const row = line(
				[on ? `${g.arrow} ` : '  ', 'c-acc b'],
				[block.label, on ? 'b c-acc' : 'c-fg'],
				[`  ${block.language}`, 'c-faint'],
			);
			return withRow(on ? withBg(row, 'sel') : row, `picker:${index}`);
		}),
	];
	drawLines(stage.view(inset, 1, wide + 1, stage.h - 1), context, rows, 0, 0);
	return {
		caps: [
			cap(g.updown, 'choose', ['up', 'down']),
			cap(g.enter, 'copy', ['enter']),
			cap('esc', 'cancel', ['esc']),
		],
		right: 'copy',
	};
}

/** The docs browser as one picture, for this frame. */
export function documentationLines(frame: Frame, context: Context): Line[] {
	const {screen, cols, rows, theme} = frame;
	if (screen.kind !== 'docs') {
		return [];
	}

	const {state} = screen;
	const layout = documentationLayout(cols, rows);
	const {geo} = layout;
	const canvas = createCanvas(cols, rows);
	const app = canvas.surface.view(0, 0, cols, rows);
	drawFrame(app, context, geo, undefined);
	drawTopBar(app.view(0, 0, cols, 1), context);
	drawCrumb(app.view(0, 0, cols, 1), context, state);
	if (!layout.folded) {
		drawRail(app.view(1, geo.bodyY, geo.side - 1, geo.bodyH), context, state);
	}

	const stage = app.view(geo.mainX, geo.bodyY, geo.mainW, geo.bodyH);
	const kit = createKit(theme.glyphs, layout.width + 4);
	const keys =
		state.search === undefined
			? state.picker === undefined
				? drawReader(stage, context, kit, state, layout)
				: drawPicker(stage, context, kit, state, layout)
			: drawSearch(stage, context, kit, state);
	drawKeys(app.view(0, rows - 1, cols, 1), context, keys.caps, keys.right);
	drawToast(app, context, geo);
	return canvas.lines();
}
