/**
 * The one renderer: turns a list of `Line`s into OpenTUI text, or into SGR text
 * for screens drawn once. Style class names are mapped to the theme here and
 * nowhere else, so a screen never mentions a colour. Without colour (NO_COLOR)
 * a style carries only bold, dim, underline and inverse, which are exactly what
 * keeps such a screen readable.
 */
/* eslint-disable react/no-array-index-key -- Lines and their segments are positional and never reorder, so an index is the only stable key. */
/* eslint-disable @typescript-eslint/promise-function-async -- OpenTUI types JSX as ReactNode, which in React 19 includes a promise, so every element looks like one. */
import process from 'node:process';
import React from 'react';
import {
	createCliRenderer,
	RGBA,
	TextAttributes,
	type CliRenderer,
} from '@opentui/core';
import {createRoot} from '@opentui/react';
import type {ColourLevel} from '../../core/interactive.js';
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

		// The row under a cursor: tinted, or bold when there is no colour to tint with.
		case 'tint': {
			if (mono) {
				style.bold = true;
			} else {
				style.backgroundColor = palette.sel;
			}

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

/** OpenTUI's attribute bits for a style's emphasis. */
/* eslint-disable no-bitwise -- Text attributes are bit flags. */
function attributesOf(style: Style): number {
	return (
		(style.bold ? TextAttributes.BOLD : 0) |
		(style.dim ? TextAttributes.DIM : 0) |
		(style.italic ? TextAttributes.ITALIC : 0) |
		(style.underline ? TextAttributes.UNDERLINE : 0) |
		(style.inverse ? TextAttributes.INVERSE : 0)
	);
}
/* eslint-enable no-bitwise */

/** A blinking caret is drawn as spaces during its off phase, keeping the width. */
function visibleText(segment: Seg, caret: boolean): string {
	return segment.c.split(/\s+/).includes('blink') && !caret
		? ' '.repeat([...segment.t].length)
		: segment.t;
}

/** A highlighted line's segments, padded so the tint spans the whole row. */
function paddedSegments(line: Line, width: number): Seg[] {
	const used = line.segs.reduce((total, s) => total + [...s.t].length, 0);
	return line.bg === undefined || used >= width
		? [...line.segs]
		: [...line.segs, {t: ' '.repeat(width - used), c: ''}];
}

const terminalForeground = RGBA.defaultForeground();

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
}: LinesProperties): React.ReactNode {
	return (
		<box flexDirection="column">
			{lines.map((line, index) => {
				const segments = paddedSegments(line, width);
				return (
					<text
						key={index}
						// Uncoloured text is the terminal's own colour, never OpenTUI's white.
						fg={terminalForeground}
						wrapMode={line.soft === true ? 'word' : 'none'}
					>
						{segments.length === 0
							? ' '
							: segments.map((segment, position) => {
									const style = styleOf(segment.c, theme, line.bg);
									return (
										<span
											key={position}
											fg={style.color ?? terminalForeground}
											bg={style.backgroundColor}
											attributes={attributesOf(style)}
										>
											{visibleText(segment, caret)}
										</span>
									);
							  })}
					</text>
				);
			})}
		</box>
	);
}

export type Mounted = Readonly<{
	renderer: CliRenderer;
	/** Leaves the last frame on screen, restores the terminal and unmounts. */
	unmount: () => Promise<void>;
}>;

/**
 * Mounts an app on the terminal's normal screen, not the alternate one, so the
 * last frame stays in the scrollback the way a command's output does. Ctrl+C
 * is a key like any other here; each app decides what it means.
 */
export async function mount(element: React.ReactNode): Promise<Mounted> {
	const renderer = await createCliRenderer({
		screenMode: 'main-screen',
		// The last frame stays where it was drawn, with the shell prompt under it.
		clearOnShutdown: false,
		exitOnCtrlC: false,
		// `useKeys` turns mouse reporting on itself, and only when TRUNK_MOUSE allows.
		useMouse: false,
	});
	const root = createRoot(renderer);
	root.render(element);
	return {
		renderer,
		async unmount() {
			await renderer.idle();
			// Destroyed first, so unmounting the tree cannot draw an empty frame over the last one.
			renderer.destroy();
			await renderer.closed;
			// The cursor is left at the end of the last row; the shell continues below it.
			process.stdout.write('\n');
			root.unmount();
		},
	};
}

/** A 24-bit colour as the nearest entry of the 6×6×6 cube in the 256-colour palette. */
function cubeIndex(hex: string): number {
	const [r = 0, g = 0, b = 0] = [1, 3, 5].map(at =>
		Math.round((Number.parseInt(hex.slice(at, at + 2), 16) / 255) * 5),
	);
	return 16 + 36 * r + 6 * g + b;
}

function colourCode(layer: 38 | 48, hex: string, level: ColourLevel): string {
	if (level >= 3) {
		const [r, g, b] = [1, 3, 5].map(at =>
			Number.parseInt(hex.slice(at, at + 2), 16),
		);
		return `${layer};2;${r};${g};${b}`;
	}

	return `${layer};5;${cubeIndex(hex)}`;
}

/**
 * The same lines as text with SGR codes, for screens that are drawn once and
 * have no keys: they never need a renderer, and so never load native code.
 * Below 256 colours only the emphasis is kept, as with NO_COLOR.
 */
export function ansiLines(
	lines: readonly Line[],
	theme: Theme,
	width: number,
	level: ColourLevel,
): string {
	return lines
		.map(line =>
			paddedSegments(line, width)
				.map(segment => {
					const style = styleOf(segment.c, theme, line.bg);
					const codes = [
						style.bold ? '1' : undefined,
						style.dim ? '2' : undefined,
						style.italic ? '3' : undefined,
						style.underline ? '4' : undefined,
						style.inverse ? '7' : undefined,
						style.color !== undefined && level >= 2
							? colourCode(38, style.color, level)
							: undefined,
						style.backgroundColor !== undefined && level >= 2
							? colourCode(48, style.backgroundColor, level)
							: undefined,
					].filter((code): code is string => code !== undefined);
					return codes.length === 0
						? segment.t
						: `\u001B[${codes.join(';')}m${segment.t}\u001B[0m`;
				})
				.join(''),
		)
		.map(text => `${text}\n`)
		.join('');
}
