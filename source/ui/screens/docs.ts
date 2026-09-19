/**
 * The docs browser: a sidebar of every topic and section beside a scrolling
 * reader, a search palette that opens on `/`, and a picker when a page has
 * several snippets. Below 100 columns the sidebar folds away and the side arrows
 * step through sections. State and keys are pure; copying is an effect the
 * component performs.
 */
import {findTopic, topics} from '../../docs/index.js';
import {search} from '../../docs/search.js';
import type {CodeBlock} from '../../docs/types.js';
import {
	margin,
	type Kit,
	type KeyHint,
	type Line,
	type Part,
} from '../kit/lines.js';

export type Notice = Readonly<{ok: boolean; text: string}>;

export type DocumentationState = Readonly<{
	topic: number;
	section: number;
	scroll: number;
	search?: Readonly<{query: string; sel: number}>;
	picker?: number;
	notice?: Notice;
}>;

export const initialDocumentation: DocumentationState = {
	topic: 0,
	section: 0,
	scroll: 0,
};

export type DocumentationEffect =
	| Readonly<{kind: 'quit'}>
	| Readonly<{kind: 'copy'; block: CodeBlock}>;

export type DocumentationStep = Readonly<{
	state: DocumentationState;
	effect?: DocumentationEffect;
}>;

const flat = topics.flatMap((topic, topicIndex) =>
	topic.sections.map((_section, sectionIndex) => ({topicIndex, sectionIndex})),
);

const sidebarWidth = 28;

/**
 * Lines the reader may show: the frame is one row shorter than the terminal,
 * and the header, its blank line, the rule and the key bar take the rest.
 */
export function readerHeight(rows: number): number {
	return Math.max(6, rows - 6);
}

/** Splits a long code line into pieces that fit the card, so nothing is cut off. */
function chunk(text: string, width: number): string[] {
	if (text.length <= width) {
		return [text];
	}

	const pieces: string[] = [];
	for (let start = 0; start < text.length; start += width) {
		pieces.push(text.slice(start, start + width));
	}

	return pieces;
}

export function readerContent(
	kit: Kit,
	topicIndex: number,
	sectionIndex: number,
	width: number,
): {lines: Line[]; blocks: CodeBlock[]} {
	const section = topics[topicIndex]?.sections[sectionIndex];
	if (section === undefined) {
		return {lines: [], blocks: []};
	}

	const {g, line} = kit;
	const lines: Line[] = [
		line([section.title, 'b']),
		line([g.h.repeat(Math.min(width, section.title.length + 2)), 'c-acc']),
	];
	const blocks: CodeBlock[] = [];
	for (const block of section.blocks) {
		lines.push(line());
		if (block.kind === 'text') {
			lines.push(...kit.wrapLines(block.text, width, 'c-fg'));
		} else if (block.kind === 'list') {
			for (const item of block.items) {
				const numbered = /^(\d+\.)\s+/.exec(item);
				const marker = numbered ? `${numbered[1] ?? ''} ` : `${g.bullet} `;
				const text = numbered ? item.slice(numbered[0].length) : item;
				for (const [index, part] of kit
					.wrap(text, Math.max(10, width - marker.length))
					.entries()) {
					lines.push(
						line(
							[index === 0 ? marker : ' '.repeat(marker.length), 'c-dim'],
							[part, 'c-fg'],
						),
					);
				}
			}
		} else {
			blocks.push(block);
			const code = block.code
				.split('\n')
				.flatMap(text => chunk(text, width - 4))
				.map(text => line([text, 'c-fg']));
			lines.push(
				...kit.box(code, width, {
					title: block.label,
					titleStyle: 'c-acc b',
					tag: `${block.language}${g.mid}${
						blocks.length === 1 ? 'c copy' : 'c'
					}`,
				}),
			);
		}
	}

	return {lines, blocks};
}

export type DocumentationView = Readonly<{kit: Kit; rows: number}>;

function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value));
}

/** The width of the text column; two more columns are kept for the scrollbar and its gap. */
function readerWidth(kit: Kit): number {
	const wide = kit.cols >= 100;
	return (
		(wide
			? kit.cols - margin - sidebarWidth - 4 - margin
			: kit.cols - margin * 2) - 3
	);
}

/** Cuts a sidebar title to the column, marking the cut so it does not read as the whole name. */
function fitTitle(title: string, width: number, ellipsis: string): string {
	return [...title].length <= width
		? title
		: `${[...title].slice(0, width - 1).join('')}${ellipsis}`;
}

export function documentationKey(
	state: DocumentationState,
	key: string,
	view: DocumentationView,
): DocumentationStep {
	const {kit, rows} = view;
	if (state.search !== undefined) {
		return searchKey(state, state.search, key);
	}

	const content = readerContent(
		kit,
		state.topic,
		state.section,
		readerWidth(kit),
	);
	if (state.picker !== undefined) {
		const count = content.blocks.length;
		if (key === 'esc') {
			return {state: {...state, picker: undefined}};
		}

		if (key === 'up' || key === 'down') {
			return {
				state: {
					...state,
					picker: (state.picker + count + (key === 'up' ? -1 : 1)) % count,
				},
			};
		}

		if (key === 'enter' || key.startsWith('picker:')) {
			const chosen = key.startsWith('picker:')
				? Number(key.slice('picker:'.length))
				: state.picker;
			const block = content.blocks[chosen];
			return {
				state: {...state, picker: undefined},
				effect: block === undefined ? undefined : {kind: 'copy', block},
			};
		}

		return {state};
	}

	const cleared: DocumentationState = {...state, notice: undefined};
	const height = readerHeight(rows);
	const maximum = Math.max(0, content.lines.length - height);
	const current = flat.findIndex(
		item =>
			item.topicIndex === state.topic && item.sectionIndex === state.section,
	);
	const jump = (index: number): DocumentationStep => {
		const target = flat[clamp(index, 0, flat.length - 1)];
		return {
			state: {
				...cleared,
				topic: target?.topicIndex ?? 0,
				section: target?.sectionIndex ?? 0,
				scroll: 0,
			},
		};
	};

	if (key.startsWith('docs-s:')) {
		const [, topicIndex, sectionIndex] = key.split(':').map(Number);
		return {
			state: {
				...cleared,
				topic: topicIndex ?? 0,
				section: sectionIndex ?? 0,
				scroll: 0,
			},
		};
	}

	switch (key) {
		case 'up':
		case 'k': {
			return {state: {...cleared, scroll: clamp(state.scroll - 1, 0, maximum)}};
		}

		case 'down':
		case 'j': {
			return {state: {...cleared, scroll: clamp(state.scroll + 1, 0, maximum)}};
		}

		case 'space': {
			return {
				state: {...cleared, scroll: clamp(state.scroll + height, 0, maximum)},
			};
		}

		case 'b': {
			return {
				state: {...cleared, scroll: clamp(state.scroll - height, 0, maximum)},
			};
		}

		case 'left': {
			return jump(current - 1);
		}

		case 'right': {
			return jump(current + 1);
		}

		case '/': {
			return {state: {...cleared, search: {query: '', sel: 0}}};
		}

		case 'q': {
			return {state, effect: {kind: 'quit'}};
		}

		case 'c': {
			if (content.blocks.length === 0) {
				return {
					state: {
						...cleared,
						notice: {ok: false, text: 'This page has no code to copy.'},
					},
				};
			}

			const only = content.blocks[0];
			return content.blocks.length === 1 && only !== undefined
				? {state: cleared, effect: {kind: 'copy', block: only}}
				: {state: {...cleared, picker: 0}};
		}

		default: {
			return {state};
		}
	}
}

function searchKey(
	state: DocumentationState,
	current: NonNullable<DocumentationState['search']>,
	key: string,
): DocumentationStep {
	const results = search(current.query);
	const set = (
		next: Partial<NonNullable<DocumentationState['search']>>,
	): DocumentationStep => ({
		state: {...state, search: {...current, ...next}},
	});
	if (key === 'esc') {
		return {state: {...state, search: undefined}};
	}

	if (key === 'up') {
		return set({sel: Math.max(0, current.sel - 1)});
	}

	if (key === 'down') {
		return set({
			sel: Math.min(Math.max(0, results.length - 1), current.sel + 1),
		});
	}

	if (key === 'enter' || key.startsWith('docs-r:')) {
		const chosen =
			results[
				key.startsWith('docs-r:')
					? Number(key.slice('docs-r:'.length))
					: current.sel
			];
		if (chosen === undefined) {
			return {state};
		}

		const topicIndex = topics.findIndex(topic => topic.id === chosen.topicId);
		const sectionIndex =
			findTopic(chosen.topicId)?.sections.findIndex(
				section => section.id === chosen.sectionId,
			) ?? 0;
		return {
			state: {
				topic: Math.max(0, topicIndex),
				section: Math.max(0, sectionIndex),
				scroll: 0,
			},
		};
	}

	if (key === 'backspace') {
		return set({query: current.query.slice(0, -1), sel: 0});
	}

	if (key === 'space') {
		return set({query: `${current.query} `, sel: 0});
	}

	return [...key].length === 1 && key >= ' '
		? set({query: current.query + key, sel: 0})
		: {state};
}

/** Marks the first match of the query so the eye lands on it. */
function highlight(text: string, query: string, base: string): Part[] {
	const token = query.toLowerCase().split(/\s+/).find(Boolean);
	const at = token === undefined ? -1 : text.toLowerCase().indexOf(token);
	if (token === undefined || at < 0) {
		return [[text, base]];
	}

	return [
		[text.slice(0, at), base],
		[text.slice(at, at + token.length), 'c-acc b u'],
		[text.slice(at + token.length), base],
	];
}

export function documentationLines(
	kit: Kit,
	state: DocumentationState,
	options: {caret: boolean; rows: number},
): Line[] {
	const {g, line, cols, justify, clip, padTo} = kit;
	const contentWidth = cols - margin * 2;
	const current = flat.findIndex(
		item =>
			item.topicIndex === state.topic && item.sectionIndex === state.section,
	);
	const topic = topics[state.topic];
	const section = topic?.sections[state.section];
	if (state.search !== undefined) {
		const results = search(state.search.query);
		const sel = Math.min(state.search.sel, Math.max(0, results.length - 1));
		const capacity = Math.max(2, Math.floor((options.rows - 10) / 2));
		const start = Math.min(
			Math.max(0, sel - capacity + 1),
			Math.max(0, results.length - capacity),
		);
		const status =
			results.length > 0
				? `${results.length} result${results.length > 1 ? 's' : ''}`
				: state.search.query === ''
				? 'titles, prose and code'
				: 'no matches';
		const body: Line[] = [
			...kit.header(['docs', 'search']),
			line(),
			...kit.indent(
				kit.box(
					[
						justify(
							line(
								['/  ', 'c-acc b'],
								[state.search.query, 'b'],
								[options.caret ? g.caret : ' ', 'c-acc'],
							),
							line([status, 'c-dim']),
							contentWidth - 4,
						),
					],
					contentWidth,
					{borderStyle: 'c-acc'},
				),
				margin,
			),
			line(),
		];
		for (const [offset, result] of results
			.slice(start, start + capacity)
			.entries()) {
			const on = start + offset === sel;
			const title = justify(
				line(
					'  ',
					[on ? `${g.arrow} ` : '  ', 'c-acc b'],
					[result.sectionTitle, on ? 'b c-acc' : 'b'],
				),
				line([`${result.topicTitle}  `, 'c-dim']),
				cols,
			);
			const snippet = clip(
				line(
					'      ',
					...highlight(result.snippet.text, state.search.query, 'c-dim'),
				),
				cols,
			);
			const target = `docs-r:${start + offset}`;
			body.push(
				kit.withRow(on ? kit.withBg(title, 'sel') : title, target),
				kit.withRow(on ? kit.withBg(snippet, 'sel') : snippet, target),
			);
		}

		return kit.frame(
			body,
			kit.keybar([
				['type', 'search'],
				[g.updown, 'choose'],
				[g.enter, 'open', 'enter'],
				['Esc', 'close', 'esc'],
			]),
			{maxRows: options.rows},
		);
	}

	if (state.picker !== undefined) {
		const {blocks} = readerContent(
			kit,
			state.topic,
			state.section,
			readerWidth(kit),
		);
		const body: Line[] = [
			...kit.header(['docs', 'copy'], `${current + 1} of ${flat.length}`),
			line(),
			line('  ', ['Copy which snippet?', 'b']),
			line(),
		];
		for (const [index, block] of blocks.entries()) {
			const row = line(
				'  ',
				[index === state.picker ? `${g.arrow} ` : '  ', 'c-acc b'],
				[block.label, index === state.picker ? 'b c-acc' : 'c-fg'],
				[`   ${block.language}`, 'c-faint'],
			);
			body.push(
				kit.withRow(
					index === state.picker ? kit.withBg(row, 'sel') : row,
					`picker:${index}`,
				),
			);
		}

		return kit.frame(
			body,
			kit.keybar([
				[g.updown, 'choose'],
				[g.enter, 'copy', 'enter'],
				['Esc', 'cancel', 'esc'],
			]),
			{maxRows: options.rows},
		);
	}

	const wide = cols >= 100;
	// A notice replaces the key bar for one keypress; a long one wraps to a few lines.
	const noticeLines = state.notice
		? kit
				.wrap(state.notice.text, cols - 6)
				.slice(0, 3)
				.map((text, index) =>
					line(
						'  ',
						[
							index === 0
								? state.notice?.ok
									? `${g.tick} `
									: `${g.warn} `
								: '  ',
							state.notice?.ok ? 'c-ok' : 'c-warn',
						],
						[text, state.notice?.ok ? 'c-fg' : 'c-warn'],
					),
				)
		: undefined;
	// A wrapped notice takes rows from the key bar's neighbours, so the reader gives them up.
	const height =
		readerHeight(options.rows) - Math.max(0, (noticeLines?.length ?? 1) - 1);
	const readerCols = readerWidth(kit) + 3;
	const {lines: readerLines, blocks} = readerContent(
		kit,
		state.topic,
		state.section,
		readerWidth(kit),
	);
	const maximum = Math.max(0, readerLines.length - height);
	const scroll = clamp(state.scroll, 0, maximum);
	const shown = readerLines.slice(scroll, scroll + height);
	const thumbAt =
		maximum === 0 ? 0 : Math.round((scroll / maximum) * (height - 3));
	const sidebar: Line[] = [];
	for (const [topicIndex, entry] of topics.entries()) {
		sidebar.push(line([entry.title, 'c-acc b']));
		for (const [sectionIndex, entrySection] of entry.sections.entries()) {
			const on = topicIndex === state.topic && sectionIndex === state.section;
			const title = fitTitle(entrySection.title, sidebarWidth - 3, g.ell);
			const target = `docs-s:${topicIndex}:${sectionIndex}`;
			sidebar.push(
				line(
					[on ? `${g.tri} ` : '  ', 'c-acc', target],
					[on ? `${title} ` : title, on ? 'b chip' : 'c-dim', target],
				),
			);
		}

		sidebar.push(line());
	}

	const body: Line[] = [
		...kit.header(
			['docs', topic?.title ?? '', section?.title ?? ''],
			`${current + 1} of ${flat.length}`,
		),
		line(),
	];
	for (let index = 0; index < height; index++) {
		const row = shown[index] ?? line();
		const bar: Part =
			maximum === 0
				? ' '
				: index >= thumbAt && index < thumbAt + 3
				? [g.thumb, 'c-dim']
				: [g.track, 'c-faint'];
		if (wide) {
			const left = sidebar[index];
			body.push(
				line(
					'  ',
					...(left === undefined
						? [' '.repeat(sidebarWidth)]
						: padTo(clip(left, sidebarWidth), sidebarWidth).segs),
					[` ${g.v} `, 'c-faint'],
					...padTo(clip(row, readerCols - 3), readerCols - 3).segs,
					' ',
					bar,
				),
			);
		} else {
			body.push(
				line(
					'  ',
					...padTo(clip(row, readerCols - 2), readerCols - 2).segs,
					' ',
					bar,
				),
			);
		}
	}

	const hints: KeyHint[] = [
		[g.updown, 'scroll'],
		[g.leftright, 'section'],
		...(blocks.length > 0
			? ([
					['c', blocks.length > 1 ? `copy (${blocks.length})` : 'copy', 'c'],
			  ] as const)
			: []),
		['/', 'search', '/'],
		['q', 'quit', 'q'],
	];
	return kit.frame(body, noticeLines ?? kit.keybar(hints), {
		maxRows: options.rows,
	});
}
