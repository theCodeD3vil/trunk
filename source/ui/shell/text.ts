/** The small text jobs every panel shares: cutting to a width and breaking into lines. */

import {cellSlice, graphemes, width} from '../width.js';

/** `text` cut to `room` cells, with an ellipsis where it was cut. */
export function cut(text: string, room: number, ellipsis = '…'): string {
	if (width(text) <= room) {
		return text;
	}

	return room <= 0
		? ''
		: `${cellSlice(text, Math.max(0, room - width(ellipsis)))}${ellipsis}`;
}

/** `text` in the middle of `room` cells. */
export function centre(text: string, room: number): string {
	const spare = Math.max(0, room - width(text));
	const before = Math.floor(spare / 2);
	return `${' '.repeat(before)}${text}${' '.repeat(spare - before)}`;
}

/** Words broken into lines of at most `room` cells; a word longer than that is cut. */
export function wrap(text: string, room: number): string[] {
	const lines: string[] = [];
	let line = '';
	for (const word of text.split(' ')) {
		const next = line === '' ? word : `${line} ${word}`;
		if (width(next) <= room) {
			line = next;
			continue;
		}

		if (line !== '') {
			lines.push(line);
		}

		line = width(word) > room ? cut(word, room) : word;
	}

	if (line !== '' || lines.length === 0) {
		lines.push(line);
	}

	return lines;
}

/**
 * Units placed into lines of at most `room` cells, a space between neighbours.
 * A unit is never split, so a flag and its value stay together.
 */
export function flow<T extends {text: string}>(
	units: readonly T[],
	room: number,
): T[][] {
	const lines: T[][] = [];
	let line: T[] = [];
	let used = 0;
	const push = (): void => {
		if (line.length > 0) {
			lines.push(line);
			line = [];
			used = 0;
		}
	};

	for (const unit of units) {
		// A word longer than the room, such as a path, is the one thing that is cut.
		if (room > 0 && width(unit.text) > room) {
			push();
			const chars = graphemes(unit.text);
			while (chars.length > 0) {
				let text = '';
				while (chars.length > 0 && width(text + chars[0]!) <= room)
					text += chars.shift();
				if (text === '') {
					chars.shift();
					continue;
				}

				const piece = {...unit, text};
				if (chars.length === 0) {
					line = [piece];
					used = width(piece.text);
				} else {
					lines.push([piece]);
				}
			}

			continue;
		}

		const need = width(unit.text) + (line.length === 0 ? 0 : 1);
		if (line.length > 0 && used + need > room) {
			push();
		}

		used += width(unit.text) + (line.length === 0 ? 0 : 1);
		line.push(unit);
	}

	push();
	return lines;
}
