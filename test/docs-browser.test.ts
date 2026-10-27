/**
 * The docs browser and the printed sheets as screens of the shell. Each is a
 * pure picture of its state, so they are checked without a terminal: what the
 * rail, the page and the key bar say, what a click would reach, and that no
 * size draws outside its window.
 */
import {describe, expect, test} from 'bun:test';
import {createKit, type Line} from '../source/ui/kit/lines.js';
import {unicodeGlyphs} from '../source/ui/kit/glyphs.js';
import {resolveTheme} from '../source/ui/kit/theme.js';
import {
	emptyRepositoryLines,
	missingToolLines,
	normalCloneLines,
} from '../source/ui/screens/callouts.js';
import {
	documentationKey,
	initialDocumentation,
	type DocumentationState,
} from '../source/ui/screens/docs.js';
import {welcomeLines} from '../source/ui/screens/welcome.js';
import {createController} from '../source/ui/shell/controller.js';
import {documentationLayout, foldBelow} from '../source/ui/shell/docs-view.js';
import {sheetLines} from '../source/ui/shell/sheet.js';
import {frameLines} from '../source/ui/shell/view.js';

const theme = resolveTheme({});

const text = (line: Line): string =>
	line.segs.map(segment => segment.t).join('');
const plain = (lines: readonly Line[]): string =>
	lines.map(line => text(line)).join('\n');
const targets = (lines: readonly Line[]): Set<string> =>
	new Set(
		lines.flatMap(line =>
			line.segs.flatMap(segment =>
				segment.k === undefined ? [] : [segment.k],
			),
		),
	);

/** The browser showing `state` in a window of this size. */
function browser(
	state: DocumentationState,
	cols = 140,
	rows = 36,
	toast?: string,
): Line[] {
	const controller = createController({
		theme,
		version: '0.3.0',
		motion: false,
		async copy() {
			return {ok: true, via: 'test'};
		},
		wake: () => undefined,
		clock: () => 0,
	});
	controller.show({kind: 'docs', state}, 0);
	controller.resize(cols, rows, 0);
	if (toast !== undefined) {
		controller.toast(toast, 0, 'info');
	}

	return frameLines(controller.frame(10));
}

describe('the docs browser', () => {
	test('a wide window shows every topic and section in the rail, the open one lit', () => {
		const screen = plain(browser(initialDocumentation));
		expect(screen).toContain('CONFIG BASICS');
		expect(screen).toContain('NODE');
		expect(screen).toContain('Hook lifecycle');
		expect(screen).toContain('Caddy routes (advanced)');
		expect(screen).toMatch(/◉ What Trunk generates/);
		expect(screen).toMatch(/○ Hook lifecycle/);
		// The page, with its own title, beside the rail.
		expect(screen).toContain('Trunk writes one file');
		expect(screen).toMatch(/docs\s+Config Basics\s+What Trunk generates/);
		expect(screen).toMatch(/c {2}copy.*\/ {2}search.*q {2}quit/);
		expect(screen).toMatch(/1\/13\s*│\s*$/);
	});

	test('a narrow window folds the rail away, and the arrows still say where you are', () => {
		const screen = plain(browser(initialDocumentation, foldBelow - 1, 30));
		expect(screen).not.toContain('Hook lifecycle');
		expect(screen).not.toContain('CONFIG BASICS');
		expect(screen).toMatch(/docs\s+Config Basics\s+What Trunk generates/);
		expect(screen).toMatch(/←→\s+section/);
		expect(screen).toMatch(/1\/13/);
		expect(documentationLayout(foldBelow - 1, 30).folded).toBe(true);
		expect(documentationLayout(foldBelow, 30).folded).toBe(false);
	});

	test('the page takes the stage: the wider the window, the wider the text', () => {
		const narrow = documentationLayout(100, 30).width;
		const wide = documentationLayout(200, 30).width;
		expect(wide - narrow).toBe(100);
	});

	test('the position follows the section, and the rail follows the position', () => {
		const view = {kit: createKit(unicodeGlyphs, 84), width: 80, height: 28};
		let state = initialDocumentation;
		for (let index = 0; index < 9; index++) {
			state = documentationKey(state, 'right', view).state;
		}

		const screen = plain(browser(state));
		expect(screen).toMatch(/10\/13/);
		expect(screen).toMatch(/◉ Install dependencies/);
		expect(screen).toMatch(/docs\s+Node\s+Install dependencies/);
	});

	test('a long section shows a bar that moves, and a short one does not', () => {
		const top = browser(initialDocumentation, 100, 20);
		expect(plain(top)).toContain('┃');
		const scrolled = browser({...initialDocumentation, scroll: 6}, 100, 20);
		expect(plain(scrolled)).not.toBe(plain(top));
		expect(
			plain(browser({...initialDocumentation, topic: 0, section: 7})),
		).not.toContain('┃');
	});

	test('the rail, the key caps and the sections are clickable', () => {
		const reached = targets(browser(initialDocumentation));
		expect(reached.has('docs-s:0:1')).toBe(true);
		expect(reached.has('docs-s:1:4')).toBe(true);
		for (const key of ['up', 'left', 'c', '/', 'q']) {
			expect(reached.has(key), key).toBe(true);
		}
	});

	test('search shows the box, the matches two rows each, and each match is clickable', () => {
		const lines = browser({
			...initialDocumentation,
			search: {query: 'hook', sel: 1},
		});
		const screen = plain(lines);
		expect(screen).toMatch(/\/ hook/);
		expect(screen).toMatch(/\d+ results/);
		expect(screen).toMatch(/›\s+\S/);
		expect(screen).toMatch(/↑↓\s+move.*⏎\s+open.*esc\s+close/);
		const reached = targets(lines);
		expect(reached.has('docs-r:0')).toBe(true);
		expect(reached.has('docs-r:1')).toBe(true);
		const none = plain(
			browser({...initialDocumentation, search: {query: 'zzzzqqq', sel: 0}}),
		);
		expect(none).toContain('no matches');
	});

	test('the snippet picker lists every snippet of the page, and each is clickable', () => {
		const lines = browser({...initialDocumentation, section: 2, picker: 1});
		const screen = plain(lines);
		expect(screen).toContain('Copy which snippet?');
		expect(screen).toMatch(/›\s+An ordered pipeline/);
		expect(screen).toMatch(/⏎\s+copy.*esc\s+cancel/);
		for (const index of [0, 1, 2, 3]) {
			expect(targets(lines).has(`picker:${index}`)).toBe(true);
		}
	});

	test('a notice is a toast at the top right, not a replacement for the key bar', () => {
		const lines = browser(
			initialDocumentation,
			120,
			30,
			'Copied "x" to the clipboard (test).',
		);
		const row = lines
			.map(line => text(line))
			.find(line => line.includes('Copied'))!;
		expect(row.indexOf('Copied')).toBeGreaterThan(60);
		expect(plain(lines)).toMatch(/q {2}quit/);
	});

	test('every window size draws exactly the window, and nothing wider', () => {
		const states: DocumentationState[] = [
			initialDocumentation,
			{...initialDocumentation, search: {query: 'tmux', sel: 0}},
			{...initialDocumentation, section: 2, picker: 0},
			{topic: 1, section: 3, scroll: 9},
		];
		for (const [cols, rows] of [
			[64, 14],
			[80, 24],
			[99, 24],
			[100, 30],
			[140, 36],
			[220, 50],
		] as const) {
			for (const state of states) {
				const lines = browser(state, cols, rows);
				expect(lines, `${cols}x${rows}`).toHaveLength(rows);
				for (const line of lines) {
					expect([...text(line)].length, `${cols}x${rows}`).toBe(cols);
				}
			}
		}
	});

	test('a window that is too small says so instead of drawing badly', () => {
		expect(plain(browser(initialDocumentation, 40, 10))).toContain(
			'This window is too small',
		);
	});
});

describe('the printed sheets', () => {
	const sheet = (
		build: Parameters<typeof sheetLines>[0]['build'],
		cols = 100,
		crumb = 'cannot start',
	): Line[] =>
		sheetLines({
			theme,
			version: '0.3.0',
			cols,
			crumb,
			build,
		});

	test('the welcome is framed, with the brand and the foot line', () => {
		const lines = sheet(
			kit => welcomeLines(kit),
			100,
			'worktree setup for Git',
		);
		const screen = plain(lines);
		expect(text(lines[0]!)).toMatch(
			/▌ trunk-cli v0\.3\.0\s+worktree setup for Git/,
		);
		expect(screen).toContain('COMMANDS');
		expect(screen).toContain('TRY IT');
		expect(screen).toMatch(/clone\s+<url> \[dir]\s+Clone a repository/);
		expect(text(lines.at(-1)!)).toContain(
			'Nothing is written until you review it.',
		);
		expect(text(lines[1]!)).toMatch(/^├─+┤$/);
		expect(text(lines.at(-2)!)).toMatch(/^├─+┤$/);
	});

	test('every line is exactly as wide as the window, on the shell black', () => {
		const lines = sheet(kit => welcomeLines(kit, 'full'), 90);
		for (const line of lines) {
			expect([...text(line)]).toHaveLength(90);
			for (const segment of line.segs) {
				expect(segment.bg).toBe(theme.palette.bg);
			}
		}
	});

	test('a refusal names what happened, what to do, and ends on its exit status', () => {
		const lines = sheet(kit =>
			missingToolLines(kit, ['git', 'wt'], 'trunk-cli init'),
		);
		const screen = plain(lines);
		expect(screen).toContain("Git and Worktrunk aren't installed");
		expect(screen).toMatch(
			/Fix\s+Install Git and Worktrunk, then run this command again\./,
		);
		expect(screen).toMatch(/Then\s+trunk-cli init/);
		expect(text(lines.at(-1)!)).toMatch(/Nothing was created\.\s+exit 3 │$/);
	});

	test('a command too long for the frame is printed whole below it, to copy', () => {
		const url = `https://example.com/${'organisation/'.repeat(
			8,
		)}storefront.git`;
		const lines = sheet(
			kit => normalCloneLines(kit, {name: 'storefront', url, unsaved: []}),
			80,
			'init · normal clone',
		);
		const framed = lines.filter(line => text(line).startsWith('│'));
		const below = lines.filter(line => line.soft === true);
		expect(plain(framed)).not.toContain(url);
		expect(plain(framed)).toContain('command in full below');
		expect(below.map(line => text(line).trim())).toContain(
			`trunk-cli clone ${url} storefront-wt`,
		);
		expect(plain(lines)).toContain('In full, to copy');
	});

	test('a short command stays inside the frame and nothing is printed below', () => {
		const lines = sheet(kit =>
			emptyRepositoryLines(kit, 'acme-admin', 'trunk-cli init'),
		);
		expect(lines.some(line => line.soft === true)).toBe(false);
		expect(text(lines.at(-1)!)).toMatch(/^│.*exit 2 │$/);
		expect(plain(lines)).toContain('acme-admin is an empty repository');
	});
});
