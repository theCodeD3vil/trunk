/**
 * One vocabulary for input, shared by every screen: the key names the pure key
 * handlers understand, and the parser that turns what a terminal sends into
 * them.
 *
 * Ink reports a burst of bytes as a single key press, so a paste, or a key held
 * down while the screen redraws, arrives as one string that no handler
 * recognises. Parsing the bytes here lets each key in the burst count.
 */

export const abortKey = 'ctrl-c';

/** A left click at a 1-based screen position, as `click:<column>:<row>`. */
export const clickPrefix = 'click:';

/** The arrow a final letter names, in either of the two forms terminals use. */
const arrows = new Map([
	['A', 'up'],
	['B', 'down'],
	['C', 'right'],
	['D', 'left'],
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
const ss3 = /\u001BO([A-D])/y;
/* eslint-enable no-control-regex */

/** Where a matcher ends when it matches at `index`, or undefined. */
function matchAt(pattern: RegExp, text: string, index: number) {
	pattern.lastIndex = index;
	return pattern.exec(text) ?? undefined;
}

/** The key a CSI sequence stands for, or undefined for ones no screen uses. */
function csiKey(parameters: string, final: string): string | undefined {
	if (final === '~') {
		// Forward delete acts as backspace; page keys scroll the way Space and b do.
		return new Map([
			['3', 'backspace'],
			['5', 'b'],
			['6', 'space'],
		]).get(parameters);
	}

	return arrows.get(final);
}

/**
 * Splits raw terminal input into key names: arrows, Enter, Esc, Backspace,
 * Space, printable characters one by one, `ctrl-c`, and clicks. Anything else,
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

		if (code === 0x03) {
			keys.push(abortKey);
		} else if (code === 0x7f || code === 0x08) {
			keys.push('backspace');
		} else if (char === ' ') {
			keys.push('space');
		} else if (code >= 0x20) {
			keys.push(chunk.slice(index, index + width));
		}

		index += width;
	}

	return keys;
}
