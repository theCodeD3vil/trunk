/**
 * The docs browser's state and keys: which section is open and how far it is
 * scrolled, the search palette that opens on `/`, and the picker for pages
 * with several snippets. Left and Right step through the sections. State and
 * keys are pure; copying is an effect the component performs. What it looks
 * like is `shell/docs-view.ts`.
 */
import {findTopic, topics} from '../../docs/index.js';
import {search} from '../../docs/search.js';
import type {CodeBlock} from '../../docs/types.js';
import type {Kit, Line, Part} from '../kit/lines.js';

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

export const flat = topics.flatMap((topic, topicIndex) =>
	topic.sections.map((_section, sectionIndex) => ({topicIndex, sectionIndex})),
);

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

/** The reader's size, which the shell works out from the window: its text width and the rows it shows. */
export type DocumentationView = Readonly<{
	kit: Kit;
	width: number;
	height: number;
}>;

function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value));
}

export function documentationKey(
	state: DocumentationState,
	key: string,
	view: DocumentationView,
): DocumentationStep {
	const {kit, width, height} = view;
	if (state.search !== undefined) {
		return searchKey(state, state.search, key);
	}

	const content = readerContent(kit, state.topic, state.section, width);
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
export function highlight(text: string, query: string, base: string): Part[] {
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
