/** Shared access to the bundled documentation's snippets, for the docs tests. */
import * as TOML from '@iarna/toml';
import {topics} from '../../source/docs/index.js';
import type {CodeBlock, Placement, Topic} from '../../source/docs/types.js';

export type Snippet = Readonly<{
	topic: Topic;
	sectionId: string;
	block: CodeBlock;
}>;

/** Every code block in the bundled documentation, in reading order. */
export const allSnippets: readonly Snippet[] = topics.flatMap(topic =>
	topic.sections.flatMap(section =>
		section.blocks.flatMap(block =>
			block.kind === 'code' ? [{topic, sectionId: section.id, block}] : [],
		),
	),
);

/**
 * A TOML fragment as a document. Fragments that add keys to a table Trunk
 * already generated have no header of their own, so the header is supplied.
 */
export function parseFragment(
	code: string,
	placement: Placement | undefined,
): Record<string, unknown> {
	const source =
		typeof placement === 'object' ? `[${placement.table}]\n${code}` : code;
	return TOML.parse(source) as Record<string, unknown>;
}

/** Every string value in a parsed fragment, which is what a hook or alias runs. */
export function commandStrings(value: unknown): string[] {
	if (typeof value === 'string') {
		return [value];
	}

	if (Array.isArray(value)) {
		return value.flatMap(item => commandStrings(item));
	}

	return typeof value === 'object' && value !== null
		? Object.values(value).flatMap(item => commandStrings(item))
		: [];
}
