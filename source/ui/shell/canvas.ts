/**
 * A grid of styled cells that the shell draws on. Components draw into a
 * `Surface`, which is a window onto the grid with its own origin and clip, so a
 * component never needs to know where on the screen it sits. When the frame is
 * done the grid becomes the same `Line`s every other screen is made of, which is
 * what lets one renderer, and one way of resolving a click, serve them all.
 */
import type {Line, Seg} from '../kit/lines.js';

export type Cell = {
	ch: string;
	/** Class names, as everywhere else; they carry the emphasis and the theme's colours. */
	c: string;
	/** Exact colours, for a tint or a fade. They win over the classes. */
	fg?: string;
	bg?: string;
	/** What a click or a hover on this cell is aimed at. */
	k?: string;
};

export type Style = Readonly<{
	c?: string;
	fg?: string;
	bg?: string;
	k?: string;
}>;

const blank = (): Cell => ({ch: ' ', c: ''});

export class Surface {
	constructor(
		private readonly cells: Cell[][],
		readonly x0: number,
		readonly y0: number,
		readonly w: number,
		readonly h: number,
	) {}

	/** A window onto part of this one, in this one's coordinates, clipped to it. */
	view(x: number, y: number, w: number, h: number): Surface {
		const left = Math.max(0, x);
		const top = Math.max(0, y);
		const right = Math.min(this.w, x + w);
		const bottom = Math.min(this.h, y + h);
		return new Surface(
			this.cells,
			this.x0 + left,
			this.y0 + top,
			Math.max(0, right - left),
			Math.max(0, bottom - top),
		);
	}

	/** The cell at a position of this surface, if it is inside it. */
	get(x: number, y: number): Cell | undefined {
		return x < 0 || y < 0 || x >= this.w || y >= this.h
			? undefined
			: this.cells[this.y0 + y]?.[this.x0 + x];
	}

	/**
	 * Writes text from (x, y) and returns the column after it. A background that
	 * is already there stays unless the style brings its own, so a tint can be
	 * laid down first and the text drawn over it.
	 */
	put(x: number, y: number, text: string, style: Style = {}): number {
		let column = x;
		for (const ch of text) {
			const cell = this.get(column, y);
			if (cell !== undefined) {
				cell.ch = ch;
				cell.c = style.c ?? '';
				cell.fg = style.fg;
				cell.bg = style.bg ?? cell.bg;
				cell.k = style.k ?? cell.k;
			}

			column += 1;
		}

		return column;
	}

	/** Paints a background over a rectangle and keeps what is written on it. */
	paint(
		x: number,
		y: number,
		w: number,
		h: number,
		bg: string,
		extra = '',
	): void {
		for (let row = y; row < y + h; row++) {
			for (let column = x; column < x + w; column++) {
				const cell = this.get(column, row);
				if (cell !== undefined) {
					cell.bg = bg;
					if (extra !== '' && !cell.c.split(' ').includes(extra)) {
						cell.c = `${cell.c} ${extra}`.trim();
					}
				}
			}
		}
	}

	/** Marks a rectangle as the target of a click, without taking cells that already have one. */
	hit(x: number, y: number, w: number, h: number, key: string): void {
		for (let row = y; row < y + h; row++) {
			for (let column = x; column < x + w; column++) {
				const cell = this.get(column, row);
				if (cell !== undefined) {
					cell.k ??= key;
				}
			}
		}
	}

	/** Clears a rectangle: no text, no background, no key. */
	clear(x: number, y: number, w: number, h: number): void {
		for (let row = y; row < y + h; row++) {
			for (let column = x; column < x + w; column++) {
				const cell = this.get(column, row);
				if (cell !== undefined) {
					Object.assign(cell, blank(), {
						fg: undefined,
						bg: undefined,
						k: undefined,
					});
				}
			}
		}
	}

	/** Runs `change` on every cell of a rectangle, for fades and tints that depend on the cell. */
	each(
		x: number,
		y: number,
		w: number,
		h: number,
		change: (cell: Cell, column: number, row: number) => void,
	): void {
		for (let row = y; row < y + h; row++) {
			for (let column = x; column < x + w; column++) {
				const cell = this.get(column, row);
				if (cell !== undefined) {
					change(cell, column - x, row - y);
				}
			}
		}
	}

	/**
	 * Copies another surface onto this one with its corner at (x, y). Cells of
	 * the source that are empty leave what is underneath alone.
	 */
	blit(source: Surface, x: number, y: number): void {
		for (let row = 0; row < source.h; row++) {
			for (let column = 0; column < source.w; column++) {
				const from = source.get(column, row);
				const to = this.get(x + column, y + row);
				if (
					from === undefined ||
					to === undefined ||
					(from.ch === ' ' && from.bg === undefined && from.k === undefined)
				) {
					continue;
				}

				Object.assign(to, from);
			}
		}
	}

	/** An independent copy of this window, drawn on its own grid. */
	detach(): Surface {
		const cells = Array.from({length: this.h}, (_, row) =>
			Array.from({length: this.w}, (_, column) => ({
				...(this.get(column, row) ?? blank()),
			})),
		);
		return new Surface(cells, 0, 0, this.w, this.h);
	}
}

export type Canvas = Readonly<{
	surface: Surface;
	lines: () => Line[];
}>;

const same = (a: Cell, b: Cell): boolean =>
	a.c === b.c && a.fg === b.fg && a.bg === b.bg && a.k === b.k;

export function createCanvas(width: number, height: number): Canvas {
	const cells = Array.from({length: height}, () =>
		Array.from({length: width}, blank),
	);
	return {
		surface: new Surface(cells, 0, 0, width, height),
		lines: () =>
			cells.map(row => {
				const segs: Seg[] = [];
				let end = row.length;
				// Trailing cells that say nothing are not worth a column of spaces.
				while (end > 0) {
					const last = row[end - 1]!;
					if (
						last.ch !== ' ' ||
						last.c !== '' ||
						last.bg !== undefined ||
						last.k !== undefined
					) {
						break;
					}

					end -= 1;
				}

				let from = 0;
				for (let column = 1; column <= end; column++) {
					if (column === end || !same(row[column]!, row[from]!)) {
						const first = row[from]!;
						segs.push({
							t: row
								.slice(from, column)
								.map(cell => cell.ch)
								.join(''),
							c: first.c,
							...(first.k === undefined ? {} : {k: first.k}),
							...(first.fg === undefined ? {} : {fg: first.fg}),
							...(first.bg === undefined ? {} : {bg: first.bg}),
						});
						from = column;
					}
				}

				return {segs};
			}),
	};
}
