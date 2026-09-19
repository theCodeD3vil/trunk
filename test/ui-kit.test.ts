/**
 * The terminal UI's foundations: the theme that reads the environment, the
 * glyph sets, the layout kit and the one renderer. Screens are checked in
 * `ui-screens.test.ts`; here it is the rules every screen relies on, mainly
 * that a glyph is one cell wide and that nothing is ever laid out wider than
 * the width it was given.
 */
import React from 'react';
import {describe, expect, test} from 'bun:test';
import {render} from 'ink-testing-library';
import {
	asciiGlyphs,
	unicodeGlyphs,
	type Glyphs,
} from '../source/ui/kit/glyphs.js';
import {createKit, type Line} from '../source/ui/kit/lines.js';
import {Lines, styleOf} from '../source/ui/kit/render.js';
import {darkPalette, resolveTheme} from '../source/ui/kit/theme.js';

/** An environment from name/value pairs, so the names can stay upper case. */
const env = (...pairs: Array<[string, string]>): NodeJS.ProcessEnv =>
	Object.fromEntries(pairs);

const text = (line: Line): string =>
	line.segs.map(segment => segment.t).join('');
const widthOf = (line: Line): number => [...text(line)].length;

/** Names that are short labels, or a checkbox that is three cells in both sets, not one cell of layout. */
const labels = new Set([
	'updown',
	'leftright',
	'dots',
	'enter',
	'boxOn',
	'boxOff',
	'boxNo',
]);

function glyphValues(glyphs: Glyphs): string[] {
	return Object.entries(glyphs)
		.filter(([name]) => !labels.has(name))
		.flatMap(([, value]) =>
			Array.isArray(value) ? (value as string[]) : [value as string],
		);
}

describe('theme', () => {
	test('defaults to the dark palette with colour and unicode glyphs', () => {
		const theme = resolveTheme(env(['LANG', 'en_US.UTF-8']));

		expect(theme.name).toBe('dark');
		expect(theme.mono).toBe(false);
		expect(theme.ascii).toBe(false);
		expect(theme.glyphs).toBe(unicodeGlyphs);
	});

	test('TRUNK_THEME and COLORFGBG choose the light palette', () => {
		expect(resolveTheme(env(['TRUNK_THEME', 'light'])).name).toBe('light');
		expect(resolveTheme(env(['COLORFGBG', '0;15'])).name).toBe('light');
		expect(resolveTheme(env(['COLORFGBG', '15;0'])).name).toBe('dark');
		// An explicit choice beats the terminal's guess.
		expect(
			resolveTheme(env(['TRUNK_THEME', 'dark'], ['COLORFGBG', '0;15'])).name,
		).toBe('dark');
	});

	test('NO_COLOR removes colour only when it is set to something', () => {
		expect(resolveTheme(env(['NO_COLOR', '1'])).mono).toBe(true);
		expect(resolveTheme(env(['NO_COLOR', ''])).mono).toBe(false);
		expect(resolveTheme(env()).mono).toBe(false);
	});

	test('falls back to ASCII glyphs on a terminal that cannot draw boxes', () => {
		expect(resolveTheme(env(['TRUNK_ASCII', '1'])).glyphs).toBe(asciiGlyphs);
		expect(resolveTheme(env(['TERM', 'linux'])).ascii).toBe(true);
		expect(resolveTheme(env(['TERM', 'dumb'])).ascii).toBe(true);
		expect(resolveTheme(env(['LANG', 'C'])).ascii).toBe(true);
		expect(
			resolveTheme(env(['LC_ALL', 'en_US.UTF-8'], ['LANG', 'C'])).ascii,
		).toBe(false);
	});
});

describe('glyphs', () => {
	test('every unicode glyph is a single cell, so widths can be counted as characters', () => {
		for (const glyph of glyphValues(unicodeGlyphs)) {
			expect([...glyph].length, glyph).toBe(1);
			// Nothing in the CJK, emoji or variation-selector ranges, which draw two cells.
			expect(glyph.codePointAt(0), glyph).toBeLessThan(0x30_00);
		}
	});

	test('the ASCII set is pure ASCII, one cell each, and has the same names', () => {
		expect(Object.keys(asciiGlyphs).sort()).toEqual(
			Object.keys(unicodeGlyphs).sort(),
		);
		for (const glyph of glyphValues(asciiGlyphs)) {
			expect([...glyph].length, glyph).toBe(1);
			expect(glyph.codePointAt(0), glyph).toBeLessThan(128);
		}
	});
});

describe('layout kit', () => {
	const kit = createKit(unicodeGlyphs, 80);

	test('a box is exactly as wide as asked, whatever its content', () => {
		const lines = kit.box(
			[
				kit.line('short'),
				kit.line(
					'a line that is far too long for the card it sits in, by a wide margin',
				),
			],
			30,
			{title: 'Title', tag: 'tag'},
		);

		for (const line of lines) {
			expect(widthOf(line)).toBe(30);
		}

		expect(text(lines[0]!)).toStartWith('╭─ Title ');
		expect(text(lines[0]!)).toEndWith(' tag ─╮');
		expect(text(lines.at(-1)!)).toBe(`╰${'─'.repeat(28)}╯`);
	});

	test('an untitled box has no stray space after its corner', () => {
		const [top] = kit.box([kit.line('x')], 12);

		expect(text(top!)).toBe(`╭${'─'.repeat(10)}╮`);
	});

	test('fit keeps the tail of a path and the head of anything else', () => {
		expect(kit.fit('/Users/someone/Projects/acme/main', 16)).toBe(
			'…jects/acme/main',
		);
		expect(kit.fit('Generate configuration for everyone', 12)).toBe(
			'Generate co…',
		);
		expect(kit.fit('short', 12)).toBe('short');
	});

	test('wrap breaks on words and leaves an over-long word whole', () => {
		expect(kit.wrap('one two three four', 9)).toEqual([
			'one two',
			'three',
			'four',
		]);
		expect(kit.wrap('unbreakable', 4)).toEqual(['unbreakable']);
		expect(kit.wrap('   ', 10)).toEqual(['']);
	});

	test('justify puts the right side at the edge, and never overlaps', () => {
		const joined = kit.justify(kit.line('left'), kit.line('right'), 20);
		expect(text(joined)).toBe(`left${' '.repeat(11)}right`);

		const crowded = kit.justify(
			kit.line('a very long left side'),
			kit.line('right'),
			12,
		);
		expect(widthOf(crowded)).toBeLessThanOrEqual(12);
		expect(text(crowded)).toEndWith(' right');
	});

	test('the header spans the width and carries the breadcrumb', () => {
		const [top, rule] = kit.header(['init', 'review'], 'acme/admin');

		expect(widthOf(top!)).toBe(80);
		expect(widthOf(rule!)).toBe(80);
		expect(text(top!)).toContain(' trunk ');
		expect(text(top!)).toContain('init');
		expect(text(top!)).toContain('acme/admin');
	});

	test('a frame is one row shorter than the terminal, with the key bar on the last of them', () => {
		const footer = kit.keybar([['q', 'quit']]);
		const short = kit.frame([kit.line('a')], footer, {maxRows: 20});

		// Ink clears the whole screen for a frame as tall as the terminal.
		expect(short).toHaveLength(19);
		expect(text(short.at(-1)!)).toContain('quit');
		expect(text(short.at(-2)!)).toMatch(/^─+$/);

		const tall = kit.frame(
			Array.from({length: 50}, (_, index) => kit.line(`line ${index}`)),
			footer,
			{maxRows: 20},
		);
		expect(tall).toHaveLength(19);
		expect(text(tall.at(-1)!)).toContain('quit');
	});

	test('the same body lands its key bar on the same row in any terminal height', () => {
		const footer = kit.keybar([['q', 'quit']]);
		for (const rows of [24, 30, 50]) {
			const lines = kit.frame([kit.line('a')], footer, {maxRows: rows});
			expect(lines, `${rows} rows`).toHaveLength(rows - 1);
		}
	});

	test('a tail, such as a question, survives when the body is trimmed', () => {
		const footer = kit.keybar([['q', 'quit']]);
		const question = [kit.line('Push it?'), kit.line('Yes  No')];
		const lines = kit.frame(
			Array.from({length: 50}, (_, index) => kit.line(`line ${index}`)),
			footer,
			{maxRows: 12, tail: question},
		);

		expect(lines).toHaveLength(11);
		expect(lines.map(l => text(l))).toContain('Push it?');
		expect(lines.map(l => text(l))).toContain('Yes  No');
		// The body gave way instead, from its end.
		expect(lines.map(l => text(l))).toContain('line 0');
		expect(lines.map(l => text(l))).not.toContain('line 49');
	});

	test('a soft line counts the rows the terminal will wrap it onto', () => {
		const command = kit.soft(kit.line('x'.repeat(200)));

		expect(kit.rowsIn([command])).toBe(3);
		expect(kit.rowsIn([kit.line('x'.repeat(200))])).toBe(1);
		const lines = kit.frame([command, command, command], [], {maxRows: 8});
		// 8 rows minus the free one and the rule leaves 6: two commands fit.
		expect(lines.filter(l => l.soft === true)).toHaveLength(2);
	});

	test('a choice marks exactly one option as selected', () => {
		const parts = kit.choice(['Yes', 'No'], 1);
		const line = kit.line(...parts);
		const selected = line.segs.filter(segment => segment.c === 'pill');

		expect(selected.map(segment => segment.t)).toEqual([' No ']);
	});
});

describe('renderer', () => {
	test('maps class names to the theme, and highlights a line without repainting the text', () => {
		const theme = resolveTheme(env());

		expect(styleOf('b c-acc', theme)).toMatchObject({
			bold: true,
			color: darkPalette.acc,
		});
		expect(styleOf('c-dim', theme).color).toBe(darkPalette.dim);
		expect(styleOf('', theme, 'sel').backgroundColor).toBe(darkPalette.sel);
		expect(styleOf('pill', theme).backgroundColor).toBeDefined();
	});

	test('the colourless theme keeps emphasis and drops every colour', () => {
		const theme = resolveTheme(env(['NO_COLOR', '1']));

		expect(styleOf('c-err', theme).color).toBeUndefined();
		expect(styleOf('b', theme).bold).toBe(true);
		expect(styleOf('c-dim', theme).dim).toBe(true);
		// With nothing to tint, the selected row is simply bold.
		expect(styleOf('', theme, 'sel').bold).toBe(true);
	});

	test('draws every line, and NO_COLOR emphasis arrives as raw SGR', () => {
		const kit = createKit(asciiGlyphs, 40);
		const {lastFrame} = render(
			React.createElement(Lines, {
				lines: [kit.line(['bold', 'b'], ' plain'), kit.line(['dim', 'c-dim'])],
				theme: resolveTheme(env(['NO_COLOR', '1'], ['TRUNK_ASCII', '1'])),
				width: 40,
			}),
		);
		const frame = lastFrame() ?? '';

		expect(frame).toContain('\u001B[1mbold\u001B[22m plain');
		expect(frame).toContain('\u001B[2mdim\u001B[22m');
	});

	test('a blinking caret keeps its width while it is off', () => {
		const theme = resolveTheme(env());
		const lines = [
			createKit(unicodeGlyphs, 20).line('ab', ['▏', 'blink'], 'cd'),
		];
		const on = render(
			React.createElement(Lines, {lines, theme, width: 20, caret: true}),
		);
		const off = render(
			React.createElement(Lines, {lines, theme, width: 20, caret: false}),
		);

		expect(on.lastFrame()).toContain('ab▏cd');
		expect(off.lastFrame()).toContain('ab cd');
	});
});
