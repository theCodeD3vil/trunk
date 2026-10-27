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
	/** A checkbox in its three states, each three cells wide in both glyph sets. */
	boxOn: string;
	boxOff: string;
	boxNo: string;
	more: string;
	less: string;
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
	/** The shell's frame: tees where a rule meets a border, and the bars drawn at an edge. */
	teeL: string;
	teeD: string;
	teeU: string;
	marker: string;
	capL: string;
	capR: string;
	hot: string;
	dashH: string;
	dashV: string;
	node: Readonly<{todo: string; active: string; done: string; skipped: string}>;
	radioOn: string;
	radioOff: string;
	/** The agents list's boxes, picked, empty and unavailable, each three cells wide. */
	pickOn: string;
	pickOff: string;
	pickNo: string;
	redo: string;
	quoteL: string;
	quoteR: string;
	/** The space bar, for a key cap. */
	space: string;
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
	boxOn: ' ◼ ',
	boxOff: ' ◻ ',
	boxNo: ' – ',
	more: '▾',
	less: '▴',
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
	teeL: '┤',
	teeD: '┬',
	teeU: '┴',
	marker: '▍',
	capL: '▐',
	capR: '▌',
	hot: '▌',
	dashH: '╌',
	dashV: '┆',
	node: Object.freeze({todo: '○', active: '◉', done: '●', skipped: '–'}),
	radioOn: '●',
	radioOff: '○',
	pickOn: '[✓]',
	pickOff: '[ ]',
	pickNo: '[–]',
	redo: '↻',
	quoteL: '“',
	quoteR: '”',
	space: '␣',
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
	boxOn: '[x]',
	boxOff: '[ ]',
	boxNo: '[-]',
	more: 'v',
	less: '^',
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
	teeL: '+',
	teeD: '+',
	teeU: '+',
	marker: '|',
	capL: '[',
	capR: ']',
	hot: '|',
	dashH: '-',
	dashV: ':',
	node: Object.freeze({todo: 'o', active: '@', done: '*', skipped: '-'}),
	radioOn: '*',
	radioOff: 'o',
	pickOn: '[x]',
	pickOff: '[ ]',
	pickNo: '[-]',
	redo: '~',
	quoteL: '"',
	quoteR: '"',
	space: 'spc',
});
