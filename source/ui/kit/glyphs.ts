/**
 * The two glyph sets every screen draws with. Unicode is the default; ASCII is
 * for terminals that cannot show box drawing, so every layout is built from
 * these names and never from literal symbols.
 */

export type Glyphs = Readonly<{
	tl: string;
	tr: string;
	bl: string;
	br: string;
	h: string;
	v: string;
	tee: string;
	end: string;
	rail: string;
	diaF: string;
	diaO: string;
	tick: string;
	cross: string;
	warn: string;
	arrow: string;
	bullet: string;
	caret: string;
	prompt: string;
	dots: string;
	barOn: string;
	barOff: string;
	chk: string;
	unchk: string;
	tri: string;
	mid: string;
	dash: string;
	ell: string;
	up: string;
	down: string;
	left: string;
	right: string;
	enter: string;
	updown: string;
	leftright: string;
	thumb: string;
	track: string;
	pend: string;
	minus: string;
	plus: string;
	spin: readonly string[];
}>;

export const unicodeGlyphs: Glyphs = Object.freeze({
	tl: '╭',
	tr: '╮',
	bl: '╰',
	br: '╯',
	h: '─',
	v: '│',
	tee: '├',
	end: '└',
	rail: '│',
	diaF: '◆',
	diaO: '◇',
	tick: '✓',
	cross: '✗',
	warn: '▲',
	arrow: '›',
	bullet: '•',
	caret: '▌',
	prompt: '❯',
	dots: '⋯',
	barOn: '▰',
	barOff: '▱',
	chk: '◼',
	unchk: '◻',
	tri: '▸',
	mid: '·',
	dash: '—',
	ell: '…',
	up: '↑',
	down: '↓',
	left: '←',
	right: '→',
	enter: '⏎',
	updown: '↑↓',
	leftright: '←→',
	thumb: '┃',
	track: '│',
	pend: '○',
	minus: '−',
	plus: '+',
	spin: Object.freeze(['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']),
});

export const asciiGlyphs: Glyphs = Object.freeze({
	tl: '+',
	tr: '+',
	bl: '+',
	br: '+',
	h: '-',
	v: '|',
	tee: '+',
	end: '`',
	rail: '|',
	diaF: '>',
	diaO: '-',
	tick: '+',
	cross: 'x',
	warn: '!',
	arrow: '>',
	bullet: '-',
	caret: '_',
	prompt: '>',
	dots: '..',
	barOn: '#',
	barOff: '.',
	chk: 'x',
	unchk: ' ',
	tri: '>',
	mid: '.',
	dash: '-',
	ell: '~',
	up: '^',
	down: 'v',
	left: '<',
	right: '>',
	enter: 'Enter',
	updown: '^v',
	leftright: '<>',
	thumb: '#',
	track: '|',
	pend: 'o',
	minus: '-',
	plus: '+',
	spin: Object.freeze(['|', '/', '-', '\\']),
});
