/**
 * Reads the keyboard and mouse for a screen. OpenTUI hands over the input one
 * sequence at a time, and every sequence is parsed here, so a paste or a held
 * key reaches the screen key by key, and a click is resolved against the lines
 * that are on screen.
 */
import process from 'node:process';
import {useEffect, useRef} from 'react';
import {useRenderer} from '@opentui/react';
import {hoverPrefix, parseInput} from './keys.js';
import type {Line} from './kit/lines.js';
import {
	clickTarget,
	mouseEnabled,
	mouseOff,
	mouseOn,
	pointOf,
	resolveClick,
} from './mouse.js';

/** Where a click landed, in 1-based screen coordinates. */
export type Point = Readonly<{column: number; row: number}>;

// DCS, OSC and APC: the terminal answering the renderer's own queries at start-up.
// eslint-disable-next-line no-control-regex -- The escape character is what marks a reply.
const terminalReply = /^\u001B[P\]_]/;

/**
 * Calls `onKey` for each key the user presses, with where it was clicked if it
 * was. `lines` returns what is on screen right now, which is how clicks find
 * their target. `onHover` hears what the pointer is over, or undefined once it
 * is over nothing.
 */
export function useKeys(
	onKey: (name: string, at?: Point) => void,
	lines: () => readonly Line[],
	onHover?: (target: string | undefined) => void,
): void {
	const renderer = useRenderer();
	// The handlers change on every render; the listener must not.
	const latest = useRef({onKey, lines, onHover});
	latest.current = {onKey, lines, onHover};

	useEffect(() => {
		// The renderer's own mouse mode would take clicks before they reach this handler.
		const useMouse = mouseEnabled() && Boolean(process.stdout.isTTY);
		const restore = () => {
			process.stdout.write(mouseOff);
		};

		if (useMouse) {
			process.stdout.write(mouseOn);
			// Leaving with the mouse still reported would print garbage in the shell.
			process.on('exit', restore);
		}

		const onSequence = (sequence: string): boolean => {
			// A reply such as `ESC P >|tmux 3.8` would otherwise be typed into a field.
			if (terminalReply.test(sequence)) {
				return false;
			}

			const keys = parseInput(sequence);
			for (const key of keys) {
				if (key.startsWith(hoverPrefix)) {
					const point = pointOf(key);
					latest.current.onHover?.(
						point === undefined
							? undefined
							: clickTarget(latest.current.lines(), point.column, point.row),
					);
					continue;
				}

				const resolved = resolveClick(key, latest.current.lines());
				if (resolved !== undefined) {
					latest.current.onKey(resolved, pointOf(key));
				}
			}

			// Anything that is not a key, such as a cursor report, stays the renderer's.
			return keys.length > 0;
		};

		renderer.prependInputHandler(onSequence);
		return () => {
			renderer.removeInputHandler(onSequence);
			if (useMouse) {
				process.off('exit', restore);
				restore();
			}
		};
	}, [renderer]);
}
