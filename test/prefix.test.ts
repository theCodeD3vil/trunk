import {describe, expect, test} from 'bun:test';
import {initials, validatePrefix} from '../source/core/prefix.js';
import {randomWord, reservedWords, words} from '../source/core/words.js';

describe('initials', () => {
	test.each([
		['djulah-admin', 'djulah-a'],
		['Djulah-backend', 'djulah-b'],
		['djulah-website', 'djulah-w'],
		['hcs-frontend', 'hcs-f'],
		['Now-tech--website', 'now-tw'],
		['NowTech-backend-', 'nowtech-b'],
		['NVC-WEBSITE', 'nvc-w'],
		['aze-farm-backend', 'aze-fb'],
		['trunk', 'trunk'],
		['--', ''],
	])('%s becomes %s', (name, expected) => {
		expect(initials(name)).toBe(expected);
	});
});

describe('prefix validation', () => {
	test('accepts the documented format boundaries', () => {
		expect(validatePrefix('a')).toEqual({valid: true});
		expect(validatePrefix(`a${'b'.repeat(23)}`)).toEqual({valid: true});
		expect(validatePrefix('repo-42')).toEqual({valid: true});
	});

	test.each([
		['', 'empty'],
		[`a${'b'.repeat(24)}`, '24'],
		['-repo', 'start'],
		['repo_name', 'underscores'],
		['repo.name', 'tmux'],
		['repo:name', 'tmux'],
		['Repo', 'lowercase'],
		['repo name', 'only'],
	])('rejects %p with a useful reason', (prefix, reason) => {
		const result = validatePrefix(prefix);
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.reason.toLowerCase()).toContain(reason);
		}
	});
});

describe('word list', () => {
	test('contains 120-200 unique, safe nouns', () => {
		expect(words.length).toBeGreaterThanOrEqual(120);
		expect(words.length).toBeLessThanOrEqual(200);
		expect(new Set(words).size).toBe(words.length);

		for (const word of words) {
			expect(word).toMatch(/^[a-z]{3,7}$/);
			expect(reservedWords).not.toContain(word);
		}
	});

	test('uses an injected random source and honors exclusions', () => {
		expect(randomWord(new Set(), () => 0)).toBe(words[0]);
		expect(randomWord(new Set([words[0]!]), () => 0)).toBe(words[1]);
		expect(randomWord(new Set(), () => 0.999_999)).toBe(words.at(-1));
	});

	test('is stable with a seeded random source', () => {
		const first = seededRandom(42);
		const second = seededRandom(42);
		const firstSequence = Array.from({length: 5}, () =>
			randomWord(new Set(), first),
		);
		const secondSequence = Array.from({length: 5}, () =>
			randomWord(new Set(), second),
		);

		expect(firstSequence).toEqual(secondSequence);
	});

	test('rejects an exhausted list or invalid random source', () => {
		expect(() => randomWord(new Set(words))).toThrow('No words remain');
		expect(() => randomWord(new Set(), () => 1)).toThrow('random source');
	});
});

function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 16_807) % 2_147_483_647;
		return (state - 1) / 2_147_483_646;
	};
}
