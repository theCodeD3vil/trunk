/**
 * Reads the keyboard and mouse for a screen. It replaces Ink's `useInput`,
 * which reports a burst of bytes as one key press: here every byte is parsed,
 * so a paste or a held key reaches the screen key by key, and a click is
 * resolved against the lines that are on screen.
 */
import process from 'node:process';
import {useEffect, useRef} from 'react';
import {useStdin, useStdout} from 'ink';
import {parseInput} from './keys.js';
import type {Line} from './kit/lines.js';
import {mouseEnabled, mouseOff, mouseOn, resolveClick} from './mouse.js';

/**
 * Calls `onKey` for each key the user presses. `lines` returns what is on
 * screen right now, which is how clicks find their target.
 */
export function useKeys(
	onKey: (name: string) => void,
	lines: () => readonly Line[],
): void {
	const {stdin, setRawMode} = useStdin();
	const {stdout} = useStdout();
	// The handlers change on every render; the listener must not.
	const latest = useRef({onKey, lines});
	latest.current = {onKey, lines};

	useEffect(() => {
		setRawMode(true);
		const useMouse = mouseEnabled() && Boolean(stdout.isTTY);
		const restore = () => {
			stdout.write(mouseOff);
		};

		if (useMouse) {
			stdout.write(mouseOn);
			// Leaving with the mouse still reported would print garbage in the shell.
			process.on('exit', restore);
		}

		const onData = (data: Uint8Array | string) => {
			const text =
				typeof data === 'string' ? data : new TextDecoder().decode(data);
			for (const key of parseInput(text)) {
				const resolved = resolveClick(key, latest.current.lines());
				if (resolved !== undefined) {
					latest.current.onKey(resolved);
				}
			}
		};

		stdin.on('data', onData);
		return () => {
			stdin.off('data', onData);
			if (useMouse) {
				process.off('exit', restore);
				restore();
			}

			setRawMode(false);
		};
	}, [stdin, stdout, setRawMode]);
}
