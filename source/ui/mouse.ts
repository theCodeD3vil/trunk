/**
 * Turns a click into the key or row it lands on. Every screen is a list of
 * lines whose segments may carry the key a click presses, and whose rows may
 * carry an id, so the lines that were drawn are all that is needed to know
 * what was clicked; nothing is registered separately.
 *
 * Positions are 1-based screen coordinates. Screens are as tall as the
 * terminal minus one row, so the first line is always on the first row.
 */
import process from 'node:process';
import {clickPrefix} from './keys.js';
import type {Line} from './kit/lines.js';

/** Enables press and wheel reporting in SGR form; the reverse turns it off. */
export const mouseOn = '\u001B[?1000h\u001B[?1006h';
export const mouseOff = '\u001B[?1006l\u001B[?1000l';

/** `TRUNK_MOUSE=0` opts out, for people who select text in the terminal often. */
export function mouseEnabled(
	environment: NodeJS.ProcessEnv = process.env,
): boolean {
	return environment['TRUNK_MOUSE'] !== '0';
}

/** The key a segment sends, else the row's id, else nothing. */
export function clickTarget(
	lines: readonly Line[],
	column: number,
	row: number,
): string | undefined {
	const line = lines[row - 1];
	if (line === undefined) {
		return undefined;
	}

	let start = 0;
	for (const segment of line.segs) {
		const end = start + [...segment.t].length;
		if (column - 1 < end) {
			return segment.k ?? line.row;
		}

		start = end;
	}

	return line.row;
}

/** Resolves a `click:<column>:<row>` key against the lines on screen. */
export function resolveClick(
	key: string,
	lines: readonly Line[],
): string | undefined {
	if (!key.startsWith(clickPrefix)) {
		return key;
	}

	const [column, row] = key.slice(clickPrefix.length).split(':').map(Number);
	return column === undefined || row === undefined
		? undefined
		: clickTarget(lines, column, row);
}
