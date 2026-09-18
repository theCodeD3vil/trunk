/**
 * The one hard platform rule. Everything trunk generates is POSIX shell run by
 * tmux and wt hooks, which native Windows cannot execute; WSL reports itself as
 * linux and is fine.
 */
import process from 'node:process';
import {exitCodes, type Outcome} from './result.js';

/** Returns an Outcome to stop on, or undefined when the platform is supported. */
export function guardPlatform(
	platform: NodeJS.Platform = process.platform,
): Outcome | undefined {
	if (platform !== 'win32') {
		return undefined;
	}

	return {
		code: exitCodes.unsupportedEnvironment,
		message: 'trunk supports macOS and Linux (including WSL).',
	};
}

/**
 * Whether trunk can show an interactive form. Ink puts the terminal into raw
 * mode to read keys, which needs more than a TTY: a process whose stdin is a
 * pipe, or a terminal that does not support it, throws on mount. Checking first
 * means the user gets the re-run command instead of a React stack trace.
 */
export function supportsInteractiveInput(
	stdin: NodeJS.ReadStream = process.stdin,
): boolean {
	return Boolean(stdin.isTTY) && typeof stdin.setRawMode === 'function';
}
