import {describe, expect, test} from 'bun:test';
import {diffLines, formatDiff} from '../source/core/diff.js';

describe('line diff', () => {
	test('reports nothing to change for identical text', () => {
		const diff = diffLines('a\nb\n', 'a\nb\n');

		expect(diff.unchanged).toBe(true);
		expect(diff.added).toBe(0);
		expect(diff.removed).toBe(0);
	});

	test('keeps a removed line visible, which is the point of the screen', () => {
		const before = 'keep\n[aliases]\nmine = "echo hand written"\nkeep too\n';
		const after = 'keep\n[aliases]\nkeep too\n';

		const diff = diffLines(before, after);

		expect(diff.removed).toBe(1);
		expect(diff.added).toBe(0);
		expect(formatDiff(diff)).toContain('- mine = "echo hand written"');
	});

	test('counts additions and removals separately', () => {
		const diff = diffLines('one\ntwo\nthree\n', 'one\ntwo point five\nthree\n');

		expect(diff.added).toBe(1);
		expect(diff.removed).toBe(1);
	});

	test('treats a trailing newline as a terminator, not a line', () => {
		expect(diffLines('a\n', 'a').unchanged).toBe(true);
	});

	test('collapses long runs of unchanged lines', () => {
		const before = Array.from({length: 30}, (_, index) => `line ${index}`).join(
			'\n',
		);
		const after = `${before}\nadded`;

		const formatted = formatDiff(diffLines(before, after));

		expect(formatted.at(-1)).toBe('+ added');
		expect(formatted.join('\n')).toContain('unchanged lines');
		// The whole file is not reprinted for a one-line change.
		expect(formatted.length).toBeLessThan(10);
	});

	test('handles a file that was empty before', () => {
		const diff = diffLines('', 'first\nsecond\n');

		expect(diff.added).toBe(2);
		expect(diff.removed).toBe(0);
	});
});
