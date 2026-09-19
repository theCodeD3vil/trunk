/**
 * Colour and glyph choices for the terminal UI, decided once from the
 * environment: the "Heartwood" palette in a dark or light variant, no colour at
 * all under NO_COLOR, and ASCII glyphs where Unicode cannot be trusted.
 */
import process from 'node:process';
import {asciiGlyphs, unicodeGlyphs, type Glyphs} from './glyphs.js';

export type Palette = Readonly<{
	bg: string;
	line: string;
	sel: string;
	fg: string;
	dim: string;
	faint: string;
	acc: string;
	accInk: string;
	ok: string;
	warn: string;
	err: string;
	info: string;
	add: string;
	del: string;
}>;

export const darkPalette: Palette = Object.freeze({
	bg: '#0F1412',
	line: '#27312C',
	sel: '#1B2521',
	fg: '#D9E2DC',
	dim: '#84928A',
	faint: '#5F6D65',
	acc: '#6FD3C0',
	accInk: '#07231E',
	ok: '#8CD67A',
	warn: '#EDB35E',
	err: '#F0837A',
	info: '#8AA7F0',
	add: '#12301F',
	del: '#3A1C1F',
});

export const lightPalette: Palette = Object.freeze({
	bg: '#FBFAF6',
	line: '#DAD8CE',
	sel: '#EAF0EA',
	fg: '#1E2A24',
	dim: '#66746B',
	faint: '#87938B',
	acc: '#0B7566',
	accInk: '#FFFFFF',
	ok: '#2C7B2F',
	warn: '#96600A',
	err: '#B3261E',
	info: '#3557C7',
	add: '#DDF1DF',
	del: '#FBE2DF',
});

export type Theme = Readonly<{
	name: 'dark' | 'light';
	palette: Palette;
	glyphs: Glyphs;
	/** No colour at all: emphasis comes from bold, dim, underline and inverse. */
	mono: boolean;
	ascii: boolean;
}>;

/**
 * A light background is reported by some terminals as `COLORFGBG=fg;bg` with a
 * bright bg. Anything else, including no answer, is treated as dark.
 */
function prefersLight(environment: NodeJS.ProcessEnv): boolean {
	const override = environment['TRUNK_THEME'];
	if (override === 'light' || override === 'dark') {
		return override === 'light';
	}

	const background = environment['COLORFGBG']?.split(';').at(-1);
	return background === '15' || background === '7';
}

/** Box drawing needs a UTF-8 terminal; a Linux console or dumb TTY cannot show it. */
function needsAscii(environment: NodeJS.ProcessEnv): boolean {
	if (environment['TRUNK_ASCII'] === '1') {
		return true;
	}

	if (environment['TERM'] === 'linux' || environment['TERM'] === 'dumb') {
		return true;
	}

	const locale =
		environment['LC_ALL'] ?? environment['LC_CTYPE'] ?? environment['LANG'];
	return locale !== undefined && locale !== '' && !/utf-?8/i.test(locale);
}

export function resolveTheme(
	environment: NodeJS.ProcessEnv = process.env,
): Theme {
	const ascii = needsAscii(environment);
	const light = prefersLight(environment);
	return Object.freeze({
		name: light ? 'light' : 'dark',
		palette: light ? lightPalette : darkPalette,
		glyphs: ascii ? asciiGlyphs : unicodeGlyphs,
		// NO_COLOR only counts when it is set to something, as the convention says.
		mono: Boolean(environment['NO_COLOR']),
		ascii,
	});
}
