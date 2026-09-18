/**
 * A line diff for the one screen that shows one: the confirmation before an
 * existing `wt.toml` is overwritten.
 *
 * Anything trunk cannot model is lost on overwrite — a repo-specific hook, a
 * second alias, a comment someone wrote for their team. This is the user's only
 * chance to notice, so removed lines have to be visible and countable.
 */

export type DiffLineKind = 'added' | 'removed' | 'context';

export type DiffLine = Readonly<{
	kind: DiffLineKind;
	text: string;
}>;

export type Diff = Readonly<{
	lines: readonly DiffLine[];
	added: number;
	removed: number;
	/** True when the two texts are identical, so the screen can be skipped. */
	unchanged: boolean;
}>;

/**
 * Longest-common-subsequence diff. The files involved are a few hundred lines
 * at most, so the quadratic table costs nothing and the output is minimal,
 * which matters more here than speed.
 */
export function diffLines(before: string, after: string): Diff {
	const source = splitLines(before);
	const target = splitLines(after);
	const common = longestCommonSubsequence(source, target);

	const lines: DiffLine[] = [];
	let added = 0;
	let removed = 0;
	let sourceIndex = 0;
	let targetIndex = 0;

	for (const anchor of common) {
		while (sourceIndex < anchor.source) {
			lines.push({kind: 'removed', text: source[sourceIndex]!});
			removed += 1;
			sourceIndex += 1;
		}

		while (targetIndex < anchor.target) {
			lines.push({kind: 'added', text: target[targetIndex]!});
			added += 1;
			targetIndex += 1;
		}

		lines.push({kind: 'context', text: source[sourceIndex]!});
		sourceIndex += 1;
		targetIndex += 1;
	}

	while (sourceIndex < source.length) {
		lines.push({kind: 'removed', text: source[sourceIndex]!});
		removed += 1;
		sourceIndex += 1;
	}

	while (targetIndex < target.length) {
		lines.push({kind: 'added', text: target[targetIndex]!});
		added += 1;
		targetIndex += 1;
	}

	return Object.freeze({
		lines: Object.freeze(lines.map(line => Object.freeze(line))),
		added,
		removed,
		unchanged: added === 0 && removed === 0,
	});
}

/**
 * The changed lines with a little surrounding context, so a long file does not
 * bury what actually changed. Runs of unchanged lines longer than twice the
 * context collapse to a single marker.
 */
export function collapseContext(
	diff: Diff,
	context = 2,
): ReadonlyArray<DiffLine | Readonly<{kind: 'skipped'; count: number}>> {
	const keep = new Set<number>();
	for (const [index, line] of diff.lines.entries()) {
		if (line.kind === 'context') {
			continue;
		}

		for (
			let nearby = Math.max(0, index - context);
			nearby <= Math.min(diff.lines.length - 1, index + context);
			nearby += 1
		) {
			keep.add(nearby);
		}
	}

	const output: Array<DiffLine | Readonly<{kind: 'skipped'; count: number}>> =
		[];
	let skipped = 0;
	for (const [index, line] of diff.lines.entries()) {
		if (keep.has(index)) {
			if (skipped > 0) {
				output.push(Object.freeze({kind: 'skipped' as const, count: skipped}));
				skipped = 0;
			}

			output.push(line);
		} else {
			skipped += 1;
		}
	}

	if (skipped > 0) {
		output.push(Object.freeze({kind: 'skipped' as const, count: skipped}));
	}

	return Object.freeze(output);
}

/**
 * `+`/`-`/space prefixes. With `color`, added lines are green and removed lines
 * red, so what is about to be lost stands out from the context around it.
 */
export function formatDiff(
	diff: Diff,
	options: Readonly<{context?: number; color?: boolean}> = {},
): readonly string[] {
	const {context = 2, color = false} = options;
	return Object.freeze(
		collapseContext(diff, context).map(line => {
			switch (line.kind) {
				case 'added': {
					return paint(`+ ${line.text}`, 32, color);
				}

				case 'removed': {
					return paint(`- ${line.text}`, 31, color);
				}

				case 'skipped': {
					return paint(
						`  … ${line.count} unchanged ${
							line.count === 1 ? 'line' : 'lines'
						}`,
						2,
						color,
					);
				}

				default: {
					return `  ${line.text}`;
				}
			}
		}),
	);
}

/** Wraps a line in an SGR code, resetting only what it set. */
function paint(text: string, code: number, enabled: boolean): string {
	if (!enabled) {
		return text;
	}

	const reset = code === 2 ? 22 : 39;
	return `\u001B[${code}m${text}\u001B[${reset}m`;
}

function splitLines(value: string): readonly string[] {
	const lines = value.split(/\r?\n/);
	// A trailing newline is a line terminator, not an empty final line.
	return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}

type Anchor = Readonly<{source: number; target: number}>;

function longestCommonSubsequence(
	source: readonly string[],
	target: readonly string[],
): readonly Anchor[] {
	const lengths: number[][] = Array.from({length: source.length + 1}, () =>
		Array.from({length: target.length + 1}, () => 0),
	);

	for (let row = source.length - 1; row >= 0; row -= 1) {
		for (let column = target.length - 1; column >= 0; column -= 1) {
			lengths[row]![column] =
				source[row] === target[column]
					? lengths[row + 1]![column + 1]! + 1
					: Math.max(lengths[row + 1]![column]!, lengths[row]![column + 1]!);
		}
	}

	const anchors: Anchor[] = [];
	let row = 0;
	let column = 0;
	while (row < source.length && column < target.length) {
		if (source[row] === target[column]) {
			anchors.push(Object.freeze({source: row, target: column}));
			row += 1;
			column += 1;
		} else if (lengths[row + 1]![column]! >= lengths[row]![column + 1]!) {
			row += 1;
		} else {
			column += 1;
		}
	}

	return Object.freeze(anchors);
}
