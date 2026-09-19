/**
 * The one renderer: turns a list of `Line`s into Ink text. Style class names
 * are mapped to the theme here and nowhere else, so a screen never mentions a
 * colour. Without colour (NO_COLOR) emphasis is written as raw SGR codes,
 * because Ink's own colour library switches every style off in that case, and
 * bold, dim and underline are exactly what keeps such a screen readable.
 */
/* eslint-disable react/no-array-index-key -- Lines and their segments are positional and never reorder, so an index is the only stable key. */
import React from 'react';
import {Box, Text} from 'ink';
import type {Line, LineBackground, Seg} from './lines.js';
import type {Palette, Theme} from './theme.js';

export type Style = Readonly<{
	color?: string;
	backgroundColor?: string;
	bold?: boolean;
	underline?: boolean;
	italic?: boolean;
	inverse?: boolean;
	dim?: boolean;
}>;

/** Maps a segment's class names, and its line's highlight, to a style. */
export function styleOf(
	classes: string,
	theme: Theme,
	lineBackground?: LineBackground,
): Style {
	const {palette} = theme;
	const names = classes.split(/\s+/).filter(Boolean);
	const style: {-readonly [K in keyof Style]: Style[K]} = {};
	for (const name of names) {
		applyClass(name, style, palette, theme.mono);
	}

	if (lineBackground !== undefined) {
		if (theme.mono) {
			// Nothing to tint, so the selected row is simply bold.
			if (lineBackground === 'sel') {
				style.bold = true;
			}
		} else if (style.backgroundColor === undefined) {
			style.backgroundColor =
				palette[lineBackground === 'sel' ? 'sel' : lineBackground];
		}
	}

	return style;
}

function applyClass(
	name: string,
	style: {-readonly [K in keyof Style]: Style[K]},
	palette: Palette,
	mono: boolean,
): void {
	switch (name) {
		case 'b': {
			style.bold = true;
			return;
		}

		case 'u': {
			style.underline = true;
			return;
		}

		case 'i': {
			style.italic = true;
			return;
		}

		case 'c-dim':
		case 'c-faint': {
			if (mono) {
				style.dim = true;
			} else {
				style.color = name === 'c-dim' ? palette.dim : palette.faint;
			}

			return;
		}

		case 'pill':
		case 'pill-ok':
		case 'pill-err': {
			if (mono) {
				style.inverse = true;
			} else {
				style.backgroundColor =
					name === 'pill'
						? palette.acc
						: name === 'pill-ok'
						? palette.ok
						: palette.err;
				style.color = name === 'pill' ? palette.accInk : palette.bg;
			}

			style.bold = true;
			return;
		}

		case 'pill-dim':
		case 'keycap': {
			if (mono) {
				style.underline = true;
			} else {
				style.backgroundColor = palette.line;
				style.color = palette.fg;
			}

			style.bold = true;
			return;
		}

		case 'chip':
		case 'chip-on': {
			if (mono) {
				style.underline = true;
			} else {
				style.backgroundColor = palette.sel;
				style.color = name === 'chip' ? palette.fg : palette.acc;
			}

			if (name === 'chip-on') {
				style.bold = true;
			}

			return;
		}

		default: {
			if (mono || !name.startsWith('c-')) {
				return;
			}

			const key = name.slice(2);
			const colours: Record<string, string> = {
				fg: palette.fg,
				acc: palette.acc,
				ok: palette.ok,
				warn: palette.warn,
				err: palette.err,
				info: palette.info,
			};
			const colour = colours[key];
			if (colour !== undefined) {
				style.color = colour;
			}
		}
	}
}

/** Raw SGR for the colourless theme; empty when the style asks for nothing. */
function sgr(style: Style, text: string): string {
	const codes = [
		style.bold ? 1 : undefined,
		style.dim ? 2 : undefined,
		style.italic ? 3 : undefined,
		style.underline ? 4 : undefined,
		style.inverse ? 7 : undefined,
	].filter((code): code is number => code !== undefined);
	return codes.length === 0
		? text
		: `\u001B[${codes.join(';')}m${text}\u001B[0m`;
}

type SegmentProperties = Readonly<{
	segment: Seg;
	theme: Theme;
	background?: LineBackground;
	caret: boolean;
}>;

function Segment({
	segment,
	theme,
	background,
	caret,
}: SegmentProperties): React.ReactElement {
	const style = styleOf(segment.c, theme, background);
	// A blinking caret is drawn as a space during its off phase, keeping the width.
	const text =
		segment.c.split(/\s+/).includes('blink') && !caret
			? ' '.repeat([...segment.t].length)
			: segment.t;
	if (theme.mono) {
		return <Text>{sgr(style, text)}</Text>;
	}

	return (
		<Text
			color={style.color}
			backgroundColor={style.backgroundColor}
			bold={style.bold}
			underline={style.underline}
			italic={style.italic}
			inverse={style.inverse}
		>
			{text}
		</Text>
	);
}

export type LinesProperties = Readonly<{
	lines: readonly Line[];
	theme: Theme;
	/** Highlighted lines are padded to this width so the tint spans the row. */
	width: number;
	caret?: boolean;
}>;

/** Draws lines top to bottom. Keys are positional because lines have no identity. */
export function Lines({
	lines,
	theme,
	width,
	caret = true,
}: LinesProperties): React.ReactElement {
	return (
		<Box flexDirection="column">
			{lines.map((line, index) => {
				const used = line.segs.reduce((total, s) => total + [...s.t].length, 0);
				const segments: Seg[] =
					line.bg === undefined || used >= width
						? [...line.segs]
						: [...line.segs, {t: ' '.repeat(width - used), c: ''}];
				return (
					<Text key={index} wrap="truncate-end">
						{segments.length === 0
							? ' '
							: segments.map((segment, position) => (
									<Segment
										key={position}
										segment={segment}
										theme={theme}
										background={line.bg}
										caret={caret}
									/>
							  ))}
					</Text>
				);
			})}
		</Box>
	);
}
