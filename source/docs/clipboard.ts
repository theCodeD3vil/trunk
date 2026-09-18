/**
 * Copying a snippet to the system clipboard, using whichever command the
 * machine happens to have. Nothing here is a dependency: every command is
 * looked up on PATH at run time, and when none works the caller gets a message
 * telling the user how to copy from their terminal instead.
 */
import {spawn} from 'node:child_process';
import {resolveExecutable} from '../core/env.js';

export type CopyResult =
	| Readonly<{ok: true; via: string}>
	| Readonly<{ok: false; reason: 'unavailable' | 'failed'; message: string}>;

export type CopyFunction = (text: string) => Promise<CopyResult>;

/** Writes text to a clipboard command's stdin; resolves to its exit code. */
export type ClipboardWriter = (
	executable: string,
	arguments_: readonly string[],
	text: string,
) => Promise<number>;

type Candidate = Readonly<{command: string; arguments: readonly string[]}>;

/**
 * In the order they are tried: macOS, Wayland, the two X11 tools, then WSL,
 * whose `clip.exe` reaches the Windows clipboard.
 */
export const clipboardCandidates: readonly Candidate[] = Object.freeze([
	{command: 'pbcopy', arguments: []},
	{command: 'wl-copy', arguments: []},
	{command: 'xclip', arguments: ['-selection', 'clipboard']},
	{command: 'xsel', arguments: ['--clipboard', '--input']},
	{command: 'clip.exe', arguments: []},
]);

export const noClipboardMessage = `No clipboard command found (tried ${clipboardCandidates
	.map(candidate => candidate.command)
	.join(
		', ',
	)}). Select the snippet on screen with your mouse and copy it with your terminal's shortcut (Cmd+C on macOS, usually Ctrl+Shift+C on Linux). Widen the window if long lines wrap.`;

export type CopyOptions = Readonly<{
	/** Overrides PATH lookup, for tests. */
	find?: (command: string) => Promise<string | undefined>;
	write?: ClipboardWriter;
}>;

export async function copyToClipboard(
	text: string,
	options: CopyOptions = {},
): Promise<CopyResult> {
	const find = options.find ?? (async command => resolveExecutable(command));
	const write = options.write ?? writeToCommand;

	let found = false;
	for (const candidate of clipboardCandidates) {
		// Candidates are tried in order and the first success stops the search.
		// eslint-disable-next-line no-await-in-loop
		const executable = await find(candidate.command);
		if (!executable) {
			continue;
		}

		found = true;
		try {
			// eslint-disable-next-line no-await-in-loop
			const code = await write(executable, candidate.arguments, text);
			if (code === 0) {
				return {ok: true, via: candidate.command};
			}
		} catch {
			// An unusable command, such as xclip without a display, is skipped.
		}
	}

	return {
		ok: false,
		reason: found ? 'failed' : 'unavailable',
		message: noClipboardMessage,
	};
}

const writeToCommand: ClipboardWriter = async (executable, arguments_, text) =>
	new Promise((resolve, reject) => {
		// Output is ignored: xclip and wl-copy keep a background process holding
		// the selection, and an open pipe would make this wait for it forever.
		const child = spawn(executable, [...arguments_], {
			stdio: ['pipe', 'ignore', 'ignore'],
		});
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error('clipboard command timed out'));
		}, 3000);
		child.once('error', error => {
			clearTimeout(timer);
			reject(error);
		});
		child.once('close', code => {
			clearTimeout(timer);
			resolve(code ?? 1);
		});
		child.stdin.on('error', () => {
			// The command may exit before reading; its exit code says what happened.
		});
		child.stdin.end(text);
	});
