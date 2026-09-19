/**
 * One vocabulary for key presses, shared by every screen: the same names the
 * pure key handlers understand, whatever Ink reports.
 */
import type {Key} from 'ink';

export const abortKey = 'ctrl-c';

/** Returns undefined for presses no screen uses, such as bare modifiers. */
export function keyName(input: string, key: Key): string | undefined {
	if (key.ctrl) {
		return input === 'c' ? abortKey : undefined;
	}

	if (key.upArrow) {
		return 'up';
	}

	if (key.downArrow) {
		return 'down';
	}

	if (key.leftArrow) {
		return 'left';
	}

	if (key.rightArrow) {
		return 'right';
	}

	if (key.return) {
		return 'enter';
	}

	if (key.escape) {
		return 'esc';
	}

	// Terminals disagree on whether Backspace sends backspace or delete.
	if (key.backspace || key.delete) {
		return 'backspace';
	}

	if (key.pageDown) {
		return 'space';
	}

	if (key.pageUp) {
		return 'b';
	}

	if (key.tab || key.meta) {
		return undefined;
	}

	if (input === ' ') {
		return 'space';
	}

	return input === '' ? undefined : input;
}
