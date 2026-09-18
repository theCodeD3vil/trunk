/**
 * Turns one documentation section into terminal lines for a given width. Doing
 * this ahead of rendering gives the viewer exact line counts, which is what
 * makes scrolling and the page footer deterministic.
 */
import type {CodeBlock, Section} from './types.js';

export type PageLine = Readonly<{
	kind: 'title' | 'blank' | 'text' | 'bullet' | 'code-label' | 'code';
	text: string;
}>;

export function layoutSection(
	section: Section,
	width: number,
): readonly PageLine[] {
	const lines: PageLine[] = [{kind: 'title', text: section.title}];
	for (const block of section.blocks) {
		lines.push({kind: 'blank', text: ''});
		switch (block.kind) {
			case 'text': {
				lines.push(...wrap(block.text, width).map(line => plain('text', line)));
				break;
			}

			case 'list': {
				for (const item of block.items) {
					lines.push(...bullet(item, width));
				}

				break;
			}

			case 'code': {
				lines.push(
					{kind: 'code-label', text: `${block.label} (${block.language})`},
					...block.code
						.split('\n')
						.flatMap(line => chunk(line, width))
						.map(line => plain('code', line)),
				);
				break;
			}
		}
	}

	return Object.freeze(lines);
}

/** The snippets on a page, in reading order, for the copy command. */
export function codeBlocks(section: Section): readonly CodeBlock[] {
	return section.blocks.filter(
		(block): block is CodeBlock => block.kind === 'code',
	);
}

function plain(kind: PageLine['kind'], text: string): PageLine {
	return {kind, text};
}

/** `• ` bullets, or the item's own `1.` marker, with a hanging indent. */
function bullet(item: string, width: number): PageLine[] {
	const numbered = /^(\d+\.)\s+/.exec(item);
	const marker = numbered ? `${numbered[1]!} ` : '• ';
	const body = numbered ? item.slice(numbered[0].length) : item;
	return wrap(body, Math.max(10, width - marker.length)).map((line, index) => ({
		kind: 'bullet',
		text: `${index === 0 ? marker : ' '.repeat(marker.length)}${line}`,
	}));
}

/** Greedy word wrap; a word longer than the width is split rather than lost. */
export function wrap(value: string, width: number): string[] {
	const lines: string[] = [];
	let current = '';
	for (const word of value.split(/\s+/).filter(Boolean)) {
		for (const piece of chunk(word, width)) {
			if (current === '') {
				current = piece;
			} else if (current.length + 1 + piece.length <= width) {
				current = `${current} ${piece}`;
			} else {
				lines.push(current);
				current = piece;
			}
		}
	}

	if (current !== '') {
		lines.push(current);
	}

	return lines;
}

/** Cuts a line into pieces no wider than the terminal; empty stays one line. */
function chunk(line: string, width: number): string[] {
	if (line.length <= width) {
		return [line];
	}

	const pieces: string[] = [];
	for (let start = 0; start < line.length; start += width) {
		pieces.push(line.slice(start, start + width));
	}

	return pieces;
}
