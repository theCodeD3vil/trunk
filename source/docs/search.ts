/**
 * Full-text search over the bundled documentation. It indexes section titles,
 * snippet labels, prose and code, and ranks a match in a title far above one in
 * a code block so a search for a topic lands on the page about it.
 */
import type {CodeBlock, Section, Topic} from './types.js';
import {topics} from './index.js';

export type MatchLocation = 'title' | 'text' | 'code';

export type SearchResult = Readonly<{
	topicId: string;
	topicTitle: string;
	sectionId: string;
	sectionTitle: string;
	score: number;
	snippet: Readonly<{text: string; location: MatchLocation}>;
}>;

/** Weights per match; a repeated term counts a few times, never unboundedly. */
const weights = Object.freeze({title: 50, label: 20, text: 3, code: 4});
const occurrenceCap = 5;
const snippetWidth = 72;

/** Every section that contains all the words of the query, best first. */
export function search(
	query: string,
	source: readonly Topic[] = topics,
): readonly SearchResult[] {
	const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) {
		return Object.freeze([]);
	}

	const results: SearchResult[] = [];
	for (const topic of source) {
		for (const section of topic.sections) {
			const result = matchSection(topic, section, tokens);
			if (result) {
				results.push(result);
			}
		}
	}

	// Array#sort is stable, so equal scores keep the order of the documentation.
	return Object.freeze(results.sort((a, b) => b.score - a.score));
}

function matchSection(
	topic: Topic,
	section: Section,
	tokens: readonly string[],
): SearchResult | undefined {
	const proseLines = section.blocks.flatMap(block =>
		block.kind === 'text'
			? [block.text]
			: block.kind === 'list'
			? [...block.items]
			: [],
	);
	const codeBlocks = section.blocks.filter(
		(block): block is CodeBlock => block.kind === 'code',
	);
	const codeLines = codeBlocks.flatMap(block => block.code.split('\n'));

	const keywords = section.keywords ?? [];
	const haystack = [
		section.title,
		...keywords,
		...codeBlocks.map(block => block.label),
		...proseLines,
		...codeLines,
	]
		.join('\n')
		.toLowerCase();
	if (!tokens.every(token => haystack.includes(token))) {
		return undefined;
	}

	let score = 0;
	for (const token of tokens) {
		if (
			[section.title, ...keywords].some(word =>
				word.toLowerCase().includes(token),
			)
		) {
			score += weights.title;
		}

		if (codeBlocks.some(block => block.label.toLowerCase().includes(token))) {
			score += weights.label;
		}

		score += weights.text * capped(count(proseLines.join('\n'), token));
		score += weights.code * capped(count(codeLines.join('\n'), token));
	}

	return Object.freeze({
		topicId: topic.id,
		topicTitle: topic.title,
		sectionId: section.id,
		sectionTitle: section.title,
		score,
		snippet: snippetFor(section, proseLines, codeLines, tokens[0]!),
	});
}

/** A line that shows the term in context; prose first, then code, then the title. */
function snippetFor(
	section: Section,
	proseLines: readonly string[],
	codeLines: readonly string[],
	token: string,
): SearchResult['snippet'] {
	const prose = proseLines.find(line => line.toLowerCase().includes(token));
	if (prose) {
		return {text: excerpt(prose, token), location: 'text'};
	}

	const code = codeLines.find(line => line.toLowerCase().includes(token));
	if (code) {
		return {text: excerpt(code.trim(), token), location: 'code'};
	}

	return {text: section.title, location: 'title'};
}

/**
 * A window of the line around the first match, cut at word boundaries and
 * marked with ellipses where text was left out.
 */
function excerpt(line: string, token: string): string {
	if (line.length <= snippetWidth) {
		return line;
	}

	const at = line.toLowerCase().indexOf(token);
	let start = Math.max(0, Math.min(at - 24, line.length - snippetWidth));
	let end = Math.min(line.length, start + snippetWidth);
	// Move inwards to the nearest space so no word is cut in half.
	if (start > 0) {
		const space = line.indexOf(' ', start);
		start = space === -1 || space > at ? start : space + 1;
	}

	if (end < line.length) {
		const space = line.lastIndexOf(' ', end);
		end = space > at + token.length ? space : end;
	}

	return `${start > 0 ? '…' : ''}${line.slice(start, end).trim()}${
		end < line.length ? '…' : ''
	}`;
}

function count(value: string, token: string): number {
	return value.toLowerCase().split(token).length - 1;
}

function capped(occurrences: number): number {
	return Math.min(occurrences, occurrenceCap);
}
