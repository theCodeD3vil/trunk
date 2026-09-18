import React from 'react';
import {afterEach, describe, expect, test} from 'bun:test';
import {cleanup, render} from 'ink-testing-library';
import {
	noClipboardMessage,
	type CopyFunction,
} from '../source/docs/clipboard.js';
import {topics} from '../source/docs/index.js';
import type {View} from '../source/docs/navigation.js';
import DocumentationBrowser from '../source/ui/DocsBrowser.js';

const view: View = {columns: 80, rows: 24};

const keys = {
	up: '\u001B[A',
	down: '\u001B[B',
	right: '\u001B[C',
	left: '\u001B[D',
	enter: '\r',
	escape: '\u001B',
	backspace: '\u007F',
	ctrlC: '\u0003',
} as const;

afterEach(() => {
	cleanup();
});

describe('docs browser', () => {
	test('opens on a menu of exactly the two topics', () => {
		const {frame} = open();

		expect(frame()).toContain('trunk docs');
		expect(frame()).toContain('› Config Basics');
		expect(frame()).toContain('  Node');
		expect(frame()).toContain('/ search');
		expect(topics).toHaveLength(2);
	});

	test('opens a topic, lists its sections, and Esc goes back to the menu', async () => {
		const {frame, press} = open();

		await press(keys.down, keys.enter);
		expect(frame()).toContain('Install dependencies (npm, pnpm, Bun)');
		expect(frame()).toContain('Caddy routes (advanced)');

		await press(keys.escape);
		// Back where it started, with the topic that was open still selected.
		expect(frame()).toContain('› Node');
		expect(frame()).toContain('Config Basics');
	});

	test('opens a page, and Esc goes back to the section list', async () => {
		const {frame, press} = open();

		await press(keys.enter, keys.down, keys.down, keys.enter);
		expect(frame()).toContain('Config Basics › Ordering, pipelines');
		expect(frame()).toContain('A hook takes one of three shapes');

		await press(keys.escape);
		expect(frame()).toContain('› Ordering, pipelines and concurrency');
	});

	test('scrolls a long page and stops at both ends', async () => {
		const {frame, press} = open();
		await press(
			keys.down,
			keys.enter,
			keys.down,
			keys.down,
			keys.down,
			keys.enter,
		);
		const top = frame();
		expect(top).toContain('more below');

		await press(keys.up);
		expect(frame()).toBe(top);

		await press(keys.down, keys.down, keys.down);
		expect(frame()).not.toBe(top);
		expect(frame()).not.toContain('post-start runs in the background');

		// Page down until the end: the marker disappears and it stays put.
		for (let index = 0; index < 20; index += 1) {
			// eslint-disable-next-line no-await-in-loop
			await press(' ');
		}

		const bottom = frame();
		expect(bottom).not.toContain('more below');
		await press(keys.down);
		expect(frame()).toBe(bottom);
	});

	test('moves between the sections of a topic with the side arrows', async () => {
		const {frame, press} = open();
		await press(keys.enter, keys.enter);
		expect(frame()).toContain('Config Basics › What Trunk generates');

		await press(keys.right);
		expect(frame()).toContain('Config Basics › Hook lifecycle');
		await press(keys.left, keys.left);
		// The first section has nothing before it.
		expect(frame()).toContain('Config Basics › What Trunk generates');
	});

	test('keeps every page inside an 80 by 24 terminal', async () => {
		for (const [topicIndex, topic] of topics.entries()) {
			for (let section = 0; section < topic.sections.length; section += 1) {
				const {frame, press} = open();
				// eslint-disable-next-line no-await-in-loop
				await press(
					...Array.from({length: topicIndex}, () => keys.down),
					keys.enter,
					...Array.from({length: section}, () => keys.down),
					keys.enter,
				);
				const lines = frame().split('\n');

				expect(lines.length, `${topic.id}/${section}`).toBeLessThanOrEqual(
					view.rows,
				);
				for (const line of lines) {
					expect(line.length).toBeLessThanOrEqual(view.columns);
				}

				cleanup();
			}
		}
	});

	describe('search', () => {
		test('/ opens a live search that updates as you type', async () => {
			const {frame, press} = open();

			await press('/');
			expect(frame()).toContain('Type to search');

			await press(...'hash_port');
			expect(frame()).toContain('/ hash_port');
			expect(frame()).toContain('› Dev server (tethered) · Node');
			expect(frame()).toContain('hash_port');

			await press(...Array.from({length: 5}, () => keys.backspace));
			expect(frame()).toContain('/ hash');
			await press(...'zzz');
			expect(frame()).toContain('No matches.');
		});

		test('Enter opens the selected result; Esc returns to the search, then the menu', async () => {
			const {frame, press} = open();
			await press('/', ...'pnpm');
			expect(frame()).toContain('› Install dependencies (npm, pnpm, Bun)');

			await press(keys.down);
			expect(frame()).toContain('› Dev server (tethered)');
			await press(keys.enter);
			expect(frame()).toContain('Node › Dev server (tethered)');

			// Back to the results, with the query and the selection kept.
			await press(keys.escape);
			expect(frame()).toContain('/ pnpm');
			expect(frame()).toContain('› Dev server (tethered)');

			await press(keys.escape);
			expect(frame()).toContain('trunk docs');
			expect(frame()).toContain('› Config Basics');
		});

		test('typing q, j or k edits the query instead of quitting or moving', async () => {
			const {frame, press, exits} = open();

			await press('/', 'q', 'j', 'k');

			expect(frame()).toContain('/ qjk');
			expect(exits()).toBe(0);
		});

		test('Enter on an empty result list does nothing', async () => {
			const {frame, press} = open();

			await press('/', 'x', 'y', 'z', 'z', 'y', keys.enter);

			expect(frame()).toContain('No matches.');
		});

		test('opens from a page too', async () => {
			const {frame, press} = open();
			await press(keys.enter, keys.enter);

			await press('/', ...'approvals');

			expect(frame()).toContain('/ approvals');
			expect(frame()).toContain('› Approvals · Config Basics');
		});
	});

	describe('Ctrl+C', () => {
		const screens: ReadonlyArray<readonly [string, readonly string[]]> = [
			['the menu', []],
			['a section list', [keys.enter]],
			['a page', [keys.enter, keys.enter]],
			['a search', ['/']],
			['the copy picker', [keys.down, keys.enter, keys.down, keys.enter, 'c']],
		];

		for (const [name, path] of screens) {
			test(`quits from ${name}`, async () => {
				const {press, exits} = open();
				await press(...path);

				await press(keys.ctrlC);

				expect(exits()).toBe(1);
			});
		}
	});

	describe('q', () => {
		test('quits from the menu and from a section list, but not from a search', async () => {
			for (const path of [[], [keys.enter]]) {
				const {press, exits} = open();
				// eslint-disable-next-line no-await-in-loop
				await press(...path, 'q');
				expect(exits()).toBe(1);
				cleanup();
			}
		});

		test('Esc on the menu quits too', async () => {
			const {press, exits} = open();

			await press(keys.escape);

			expect(exits()).toBe(1);
		});
	});

	describe('copying', () => {
		test('c copies the only snippet on a page at once', async () => {
			const copies: string[] = [];
			const {frame, press} = open({copy: recorder(copies)});
			// Config Basics, Hook lifecycle: one shell block.
			await press(keys.enter, keys.down, keys.enter, 'c');
			await settle();

			expect(copies).toHaveLength(1);
			expect(copies[0]).toStartWith('wt hook show');
			expect(frame()).toContain(
				'Copied "Inspect and run hooks" to the clipboard',
			);
			expect(frame()).not.toContain('Copy which snippet?');
		});

		test('c opens a labelled picker when a page has several snippets', async () => {
			const copies: string[] = [];
			const {frame, press} = open({copy: recorder(copies)});
			// Node, Install dependencies: npm, pnpm and Bun.
			await press(keys.down, keys.enter, keys.down, keys.enter, 'c');

			expect(frame()).toContain('Copy which snippet?');
			for (const label of ['npm', 'pnpm', 'Bun']) {
				expect(frame()).toContain(label);
			}

			expect(copies).toEqual([]);
			await press(keys.down, keys.enter);
			await settle();

			expect(copies).toEqual([
				'[[pre-start]]\ninstall = "pnpm install --prefer-offline"',
			]);
			expect(frame()).toContain('Copied "pnpm" to the clipboard');
		});

		test('Esc closes the picker without copying', async () => {
			const copies: string[] = [];
			const {frame, press} = open({copy: recorder(copies)});
			await press(
				keys.down,
				keys.enter,
				keys.down,
				keys.enter,
				'c',
				keys.escape,
			);

			expect(copies).toEqual([]);
			expect(frame()).not.toContain('Copy which snippet?');
			expect(frame()).toContain('Node › Install dependencies');
		});

		test('says so when a page has nothing to copy', async () => {
			const copies: string[] = [];
			const {frame, press} = open({copy: recorder(copies)});
			// Config Basics, Further reading: links only.
			await press(
				keys.enter,
				...Array.from({length: 7}, () => keys.down),
				keys.enter,
				'c',
			);

			expect(copies).toEqual([]);
			expect(frame()).toContain('This page has no code to copy.');
		});

		test('falls back to copy instructions when no clipboard command works', async () => {
			const {frame, press} = open({
				async copy() {
					return {
						ok: false,
						reason: 'unavailable',
						message: noClipboardMessage,
					};
				},
			});
			await press(keys.enter, keys.down, keys.enter, 'c');
			await settle();

			expect(frame()).toContain('No clipboard command found');
			expect(frame()).toContain('Select the snippet');
			expect(frame()).not.toContain('Copied');
		});

		test('the notice disappears on the next key press', async () => {
			const {frame, press} = open({copy: recorder([])});
			await press(keys.enter, keys.down, keys.enter, 'c');
			await settle();
			expect(frame()).toContain('Copied');

			await press(keys.down);

			expect(frame()).not.toContain('Copied');
		});
	});
});

type Options = Readonly<{copy?: CopyFunction}>;

/** Renders the browser at a fixed size and gives back key-press helpers. */
function open(options: Options = {}) {
	let exits = 0;
	const app = render(
		<DocumentationBrowser
			size={view}
			copy={options.copy ?? recorder([])}
			onExit={() => {
				exits += 1;
			}}
		/>,
	);
	return {
		frame: () => app.lastFrame() ?? '',
		exits: () => exits,
		async press(...sequence: string[]) {
			for (const key of sequence) {
				// Each key has to be handled before the next one is written.
				// eslint-disable-next-line no-await-in-loop
				await settle();
				app.stdin.write(key);
			}

			await settle();
		},
	};
}

function recorder(copies: string[]): CopyFunction {
	return async text => {
		copies.push(text);
		return {ok: true, via: 'test-clipboard'};
	};
}

async function settle(): Promise<void> {
	await new Promise(resolve => {
		setTimeout(resolve, 0);
	});
}
