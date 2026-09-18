/**
 * The docs browser's navigation as a pure function: given the current screen
 * and a key press, what screen comes next and what side effect (quit, copy) is
 * wanted. Keeping it apart from Ink makes every path through the browser
 * testable without a terminal.
 */
import type {Key} from 'ink';
import {codeBlocks, layoutSection} from './layout.js';
import {search} from './search.js';
import type {CodeBlock} from './types.js';
import {topics} from './index.js';

export type MenuScreen = Readonly<{name: 'menu'; index: number}>;
export type SectionsScreen = Readonly<{
	name: 'sections';
	topic: number;
	index: number;
}>;
export type SearchScreen = Readonly<{
	name: 'search';
	query: string;
	index: number;
}>;
export type PageScreen = Readonly<{
	name: 'page';
	topic: number;
	section: number;
	scroll: number;
	/** Where Esc returns to: the section list or the search that opened it. */
	back: SectionsScreen | SearchScreen;
	/** Index into the page's snippets while the copy picker is open. */
	picker?: number;
	/** The result of the last copy, shown until the next key press. */
	notice?: string;
}>;
export type Screen = MenuScreen | SectionsScreen | SearchScreen | PageScreen;

export type Effect =
	| Readonly<{kind: 'quit'}>
	| Readonly<{kind: 'copy'; block: CodeBlock}>;

export type Step = Readonly<{screen: Screen; effect?: Effect}>;

export type View = Readonly<{columns: number; rows: number}>;

export const initialScreen: Screen = Object.freeze({name: 'menu', index: 0});

/** Lines a page's text may occupy: the frame minus header, footer and notice. */
export function pageViewport(view: View): number {
	return Math.max(3, view.rows - 7);
}

/** The width page text is wrapped to, leaving a margin on each side. */
export function pageWidth(view: View): number {
	return Math.max(30, view.columns - 2);
}

export function reduce(
	screen: Screen,
	input: string,
	key: Key,
	view: View,
): Step {
	if (key.ctrl && input === 'c') {
		return {screen, effect: {kind: 'quit'}};
	}

	switch (screen.name) {
		case 'menu': {
			return menu(screen, input, key);
		}

		case 'sections': {
			return sections(screen, input, key);
		}

		case 'search': {
			return searching(screen, input, key);
		}

		case 'page': {
			return page(screen, input, key, view);
		}
	}
}

function menu(screen: MenuScreen, input: string, key: Key): Step {
	const move = direction(input, key);
	if (move !== 0) {
		return {
			screen: {...screen, index: cycle(screen.index + move, topics.length)},
		};
	}

	if (key.return) {
		return {screen: {name: 'sections', topic: screen.index, index: 0}};
	}

	if (input === '/') {
		return {screen: {name: 'search', query: '', index: 0}};
	}

	return input === 'q' || key.escape
		? {screen, effect: {kind: 'quit'}}
		: {screen};
}

function sections(screen: SectionsScreen, input: string, key: Key): Step {
	const topic = topics[screen.topic]!;
	const move = direction(input, key);
	if (move !== 0) {
		return {
			screen: {
				...screen,
				index: cycle(screen.index + move, topic.sections.length),
			},
		};
	}

	if (key.return) {
		return {screen: openPage(screen.topic, screen.index, screen)};
	}

	if (key.escape) {
		return {screen: {name: 'menu', index: screen.topic}};
	}

	if (input === '/') {
		return {screen: {name: 'search', query: '', index: 0}};
	}

	return input === 'q' ? {screen, effect: {kind: 'quit'}} : {screen};
}

/** Typing edits the query, so letters like `q` and `j` are text here. */
function searching(screen: SearchScreen, input: string, key: Key): Step {
	if (key.escape) {
		return {screen: {name: 'menu', index: 0}};
	}

	const results = search(screen.query);
	if (key.upArrow) {
		return {screen: {...screen, index: Math.max(0, screen.index - 1)}};
	}

	if (key.downArrow) {
		return {
			screen: {
				...screen,
				index: Math.min(Math.max(0, results.length - 1), screen.index + 1),
			},
		};
	}

	if (key.return) {
		const chosen = results[screen.index];
		if (!chosen) {
			return {screen};
		}

		const topic = topics.findIndex(
			candidate => candidate.id === chosen.topicId,
		);
		const section = topics[topic]!.sections.findIndex(
			candidate => candidate.id === chosen.sectionId,
		);
		return {screen: openPage(topic, section, screen)};
	}

	if (key.backspace || key.delete) {
		return {screen: {...screen, query: screen.query.slice(0, -1), index: 0}};
	}

	const typed = key.ctrl || key.meta || key.tab ? '' : printable(input);
	return typed
		? {screen: {...screen, query: screen.query + typed, index: 0}}
		: {screen};
}

function page(screen: PageScreen, input: string, key: Key, view: View): Step {
	const topic = topics[screen.topic]!;
	const section = topic.sections[screen.section]!;
	const blocks = codeBlocks(section);
	const current: PageScreen = {...screen, notice: undefined};

	if (screen.picker !== undefined) {
		return picker(current, blocks, input, key);
	}

	const viewport = pageViewport(view);
	const maximum = Math.max(
		0,
		layoutSection(section, pageWidth(view)).length - viewport,
	);
	const scrollTo = (value: number): Step => ({
		screen: {...current, scroll: Math.min(maximum, Math.max(0, value))},
	});
	const move = direction(input, key);
	if (move !== 0) {
		return scrollTo(screen.scroll + move);
	}

	if (key.pageDown || input === ' ') {
		return scrollTo(screen.scroll + viewport);
	}

	if (key.pageUp || input === 'b') {
		return scrollTo(screen.scroll - viewport);
	}

	if (key.leftArrow || key.rightArrow) {
		const target = screen.section + (key.rightArrow ? 1 : -1);
		return target >= 0 && target < topic.sections.length
			? {screen: {...current, section: target, scroll: 0}}
			: {screen: current};
	}

	if (key.escape) {
		return {screen: screen.back};
	}

	if (input === '/') {
		return {screen: {name: 'search', query: '', index: 0}};
	}

	if (input === 'q') {
		return {screen: current, effect: {kind: 'quit'}};
	}

	if (input === 'c') {
		return copy(current, blocks);
	}

	return {screen: current};
}

/** One snippet copies at once; several open a labelled list to choose from. */
function copy(screen: PageScreen, blocks: readonly CodeBlock[]): Step {
	if (blocks.length === 0) {
		return {screen: {...screen, notice: 'This page has no code to copy.'}};
	}

	return blocks.length === 1
		? {screen, effect: {kind: 'copy', block: blocks[0]!}}
		: {screen: {...screen, picker: 0}};
}

function picker(
	screen: PageScreen,
	blocks: readonly CodeBlock[],
	input: string,
	key: Key,
): Step {
	const selected = screen.picker ?? 0;
	const move = direction(input, key);
	if (move !== 0) {
		return {screen: {...screen, picker: cycle(selected + move, blocks.length)}};
	}

	if (key.return) {
		return {
			screen: {...screen, picker: undefined},
			effect: {kind: 'copy', block: blocks[selected]!},
		};
	}

	return key.escape
		? {screen: {...screen, picker: undefined}}
		: {screen: {...screen, picker: selected}};
}

function openPage(
	topic: number,
	section: number,
	back: SectionsScreen | SearchScreen,
): PageScreen {
	return {name: 'page', topic, section, scroll: 0, back};
}

function direction(input: string, key: Key): -1 | 0 | 1 {
	if (key.upArrow || input === 'k') {
		return -1;
	}

	return key.downArrow || input === 'j' ? 1 : 0;
}

function cycle(index: number, length: number): number {
	return (index + length) % length;
}

/** Drops control characters so a stray escape sequence never lands in the query. */
function printable(input: string): string {
	return [...input].filter(character => character >= ' ').join('');
}
