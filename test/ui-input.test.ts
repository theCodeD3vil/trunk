/**
 * Input, as the terminal sends it. Ink reports a burst of bytes as one key
 * press, which made a paste, or a key held down during a redraw, vanish. The
 * parser splits a burst into keys, and a click is resolved against the lines
 * that were drawn, so both are plain functions worth checking byte by byte.
 */
import {describe, expect, test} from 'bun:test';
import {abortKey, parseInput} from '../source/ui/keys.js';
import {createKit} from '../source/ui/kit/lines.js';
import {unicodeGlyphs} from '../source/ui/kit/glyphs.js';
import {
	clickTarget,
	mouseEnabled,
	mouseOff,
	mouseOn,
	resolveClick,
} from '../source/ui/mouse.js';

const escape = '\u001B';

/** An environment from name/value pairs, so the names can stay upper case. */
const env = (...pairs: Array<[string, string]>): NodeJS.ProcessEnv =>
	Object.fromEntries(pairs);

describe('parseInput', () => {
	test('names the keys every screen understands', () => {
		expect(parseInput(`${escape}[A`)).toEqual(['up']);
		expect(parseInput(`${escape}[B`)).toEqual(['down']);
		expect(parseInput(`${escape}[C`)).toEqual(['right']);
		expect(parseInput(`${escape}[D`)).toEqual(['left']);
		expect(parseInput('\r')).toEqual(['enter']);
		expect(parseInput(escape)).toEqual(['esc']);
		expect(parseInput(' ')).toEqual(['space']);
		expect(parseInput('\u007F')).toEqual(['backspace']);
		expect(parseInput('\b')).toEqual(['backspace']);
		expect(parseInput('\u0003')).toEqual([abortKey]);
		expect(parseInput('q')).toEqual(['q']);
	});

	test('a terminal in application mode sends the same arrows another way', () => {
		expect(parseInput(`${escape}OA${escape}OD`)).toEqual(['up', 'left']);
	});

	test('a paste arrives as one key per character, spaces included', () => {
		expect(parseInput('tmux')).toEqual(['t', 'm', 'u', 'x']);
		expect(parseInput('a b')).toEqual(['a', 'space', 'b']);
		expect(parseInput('naïve ✓')).toEqual([
			'n',
			'a',
			'ï',
			'v',
			'e',
			'space',
			'✓',
		]);
	});

	test('a key held down while the screen redraws is not lost', () => {
		expect(parseInput('\u007F\u007F\u007F')).toEqual([
			'backspace',
			'backspace',
			'backspace',
		]);
		expect(parseInput(`${escape}[B${escape}[B${escape}[B`)).toEqual([
			'down',
			'down',
			'down',
		]);
	});

	test('keeps the order of mixed keys', () => {
		expect(parseInput(`ab\r${escape}[C\u007F`)).toEqual([
			'a',
			'b',
			'enter',
			'right',
			'backspace',
		]);
	});

	test('a CRLF pair is one Enter', () => {
		expect(parseInput('\r\n')).toEqual(['enter']);
		expect(parseInput('\n')).toEqual(['enter']);
	});

	test('delete and the page keys act as backspace and scrolling', () => {
		expect(parseInput(`${escape}[3~`)).toEqual(['backspace']);
		expect(parseInput(`${escape}[5~`)).toEqual(['b']);
		expect(parseInput(`${escape}[6~`)).toEqual(['space']);
	});

	test('drops what no screen uses: Tab, Alt combinations and unknown sequences', () => {
		expect(parseInput('\t')).toEqual([]);
		expect(parseInput(`${escape}[Z`)).toEqual([]);
		expect(parseInput(`${escape}x`)).toEqual([]);
		expect(parseInput(`${escape}[15~`)).toEqual([]);
		expect(parseInput('\u0001')).toEqual([]);
		// A lone Escape followed by more input is still an Escape.
		expect(parseInput(`${escape}${escape}[A`)).toEqual(['esc', 'up']);
	});

	test('reads a left click and the wheel from SGR mouse reports', () => {
		expect(parseInput(`${escape}[<0;12;5M`)).toEqual(['click:12:5']);
		// A release, a right click and a drag are not clicks.
		expect(parseInput(`${escape}[<0;12;5m`)).toEqual([]);
		expect(parseInput(`${escape}[<2;12;5M`)).toEqual([]);
		expect(parseInput(`${escape}[<32;12;5M`)).toEqual([]);
		expect(parseInput(`${escape}[<64;1;1M${escape}[<65;1;1M`)).toEqual([
			'up',
			'down',
		]);
	});

	test('a click between keys keeps its place in the order', () => {
		expect(parseInput(`a${escape}[<0;3;4Mb`)).toEqual(['a', 'click:3:4', 'b']);
	});
});

describe('clicks', () => {
	const kit = createKit(unicodeGlyphs, 40);
	const lines = [
		kit.line('plain line'),
		kit.withRow(kit.line('  a row'), 'setup:2'),
		kit.line(['ab', '', 'left'], ['cd', '', 'right'], ' tail'),
		kit.line(...kit.keybar([['q', 'quit', 'q']])[0]!.segs),
	];

	test('a segment sends its own key', () => {
		expect(clickTarget(lines, 1, 3)).toBe('left');
		expect(clickTarget(lines, 2, 3)).toBe('left');
		expect(clickTarget(lines, 3, 3)).toBe('right');
		expect(clickTarget(lines, 4, 3)).toBe('right');
	});

	test('text without a key falls back to its row, or to nothing', () => {
		expect(clickTarget(lines, 5, 3)).toBeUndefined();
		expect(clickTarget(lines, 4, 2)).toBe('setup:2');
		expect(clickTarget(lines, 30, 2)).toBe('setup:2');
		expect(clickTarget(lines, 1, 1)).toBeUndefined();
	});

	test('a click off the screen does nothing', () => {
		expect(clickTarget(lines, 1, 99)).toBeUndefined();
		expect(clickTarget(lines, 1, 0)).toBeUndefined();
	});

	test('a key cap on the key bar sends its key', () => {
		const column = lines[3]!.segs.findIndex(segment => segment.k === 'q');

		expect(column).toBeGreaterThan(-1);
		expect(clickTarget(lines, 4, 4)).toBe('q');
	});

	test('resolveClick passes keys through and turns clicks into targets', () => {
		expect(resolveClick('down', lines)).toBe('down');
		expect(resolveClick('click:1:3', lines)).toBe('left');
		expect(resolveClick('click:1:1', lines)).toBeUndefined();
	});
});

describe('mouse reporting', () => {
	test('is on unless TRUNK_MOUSE=0, for people who select text a lot', () => {
		expect(mouseEnabled(env())).toBe(true);
		expect(mouseEnabled(env(['TRUNK_MOUSE', '1']))).toBe(true);
		expect(mouseEnabled(env(['TRUNK_MOUSE', '0']))).toBe(false);
	});

	test('turns off exactly what it turned on', () => {
		expect(mouseOn).toBe(`${escape}[?1000h${escape}[?1006h`);
		expect(mouseOff).toBe(`${escape}[?1006l${escape}[?1000l`);
	});
});
