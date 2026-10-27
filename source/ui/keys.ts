/**
 * One vocabulary for input, shared by every screen: the key names the pure key
 * handlers understand, and the parser that turns what a terminal sends into
 * them.
 *
 * A paste, or a key held down while the screen redraws, can arrive as one
 * string that no handler recognises. Parsing the bytes here lets each key in
 * the burst count.
 */

export const abortKey = 'ctrl-c';

/** A left click at a 1-based screen position, as `click:<column>:<row>`. */
export const clickPrefix = 'click:';

/** The pointer moving over a 1-based screen position, as `hover:<column>:<row>`. */
export const hoverPrefix = 'hover:';

/** The arrow a final letter names, in either of the two forms terminals use. */
const arrows = new Map([
	['A', 'up'],
	['B', 'down'],
	['C', 'right'],
	['D', 'left'],
	['H', 'home'],
	['F', 'end'],
]);

// A wheel notch is one line, and the keyboard already scrolls by lines.
const wheel = new Map([
	['64', 'up'],
	['65', 'down'],
]);

// These patterns are about the control character that starts every sequence.
/* eslint-disable no-control-regex */
const mouse = /\u001B\[<(\d+);(\d+);(\d+)([Mm])/y;
const csi = /\u001B\[([\d;?]*)[ -/]*([@-~])/y;
const ss3 = /\u001BO([A-DHF])/y;
/* eslint-enable no-control-regex */

/** Control characters that are keys of their own: Ctrl+C, Ctrl+P, Ctrl+A and Ctrl+E, Backspace. */
const controls = new Map([
	[0x03, abortKey],
	[0x10, 'ctrl-p'],
	[0x01, 'home'],
	[0x05, 'end'],
	[0x7f, 'backspace'],
	[0x08, 'backspace'],
]);

/** Reports with bit 32 set are the pointer moving, with or without a button held. */
const isMotion = (button: number): boolean =>
	// eslint-disable-next-line no-bitwise -- The button code is a bit field.
	(button & 32) !== 0 && (button & 64) === 0;

/** Where a matcher ends when it matches at `index`, or undefined. */
function matchAt(pattern: RegExp, text: string, index: number) {
	pattern.lastIndex = index;
	return pattern.exec(text) ?? undefined;
}

/** The key a CSI sequence stands for, or undefined for ones no screen uses. */
function csiKey(parameters: string, final: string): string | undefined {
	if (final === '~') {
		// Page keys scroll the way Space and b do.
		return new Map([
			['1', 'home'],
			['3', 'delete'],
			['4', 'end'],
			['5', 'b'],
			['6', 'space'],
			['7', 'home'],
			['8', 'end'],
		]).get(parameters);
	}

	return arrows.get(final);
}

/**
 * Splits raw terminal input into key names: arrows, Enter, Esc, Backspace,
 * Space, printable characters one by one, `ctrl-c`, clicks and pointer moves. Anything else,
 * such as Tab, Alt combinations and unknown sequences, is dropped.
 */
export function parseInput(chunk: string): string[] {
	const keys: string[] = [];
	let index = 0;
	while (index < chunk.length) {
		const char = chunk[index]!;
		if (char === '\u001B') {
			const click = matchAt(mouse, chunk, index);
			if (click !== undefined) {
				const [whole, button, column, row, kind] = click;
				index += whole.length;
				if (kind === 'M' && button === '0') {
					keys.push(`${clickPrefix}${column}:${row}`);
				} else if (kind === 'M' && wheel.has(button!)) {
					keys.push(wheel.get(button!)!);
				} else if (kind === 'M' && isMotion(Number(button))) {
					keys.push(`${hoverPrefix}${column}:${row}`);
				}

				continue;
			}

			const sequence = matchAt(csi, chunk, index) ?? matchAt(ss3, chunk, index);
			if (sequence !== undefined) {
				index += sequence[0].length;
				const key =
					sequence.length === 3
						? csiKey(sequence[1]!, sequence[2]!)
						: arrows.get(sequence[1]!);
				if (key !== undefined) {
					keys.push(key);
				}

				continue;
			}

			// A lone Escape; when something follows it is an Alt combination.
			const next = chunk[index + 1];
			if (next === undefined || next === '\u001B') {
				keys.push('esc');
				index += 1;
			} else {
				index += 2;
			}

			continue;
		}

		const code = char.codePointAt(0)!;
		const width = code > 0xff_ff ? 2 : 1;
		if (char === '\r' || char === '\n') {
			keys.push('enter');
			// A CRLF pair is one Enter.
			index += chunk[index + 1] === '\n' && char === '\r' ? 2 : 1;
			continue;
		}

		const control = controls.get(code);
		if (control !== undefined) {
			keys.push(control);
		} else if (char === ' ') {
			keys.push('space');
		} else if (code >= 0x20) {
			keys.push(chunk.slice(index, index + width));
		}

		index += width;
	}

	return keys;
}
