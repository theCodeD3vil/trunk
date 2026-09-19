import {describe, expect, test} from 'bun:test';
import {initials, validatePrefix} from '../source/core/prefix.js';

describe('initials', () => {
	// Each row covers a naming style seen in the wild: plain, capitalised,
	// doubled and trailing separators, all caps, and three words.
	test.each([
		['acme-admin', 'acme-a'],
		['Acme-backend', 'acme-b'],
		['acme-website', 'acme-w'],
		['abc-frontend', 'abc-f'],
		['Web-shop--portal', 'web-sp'],
		['WebShop-backend-', 'webshop-b'],
		['XYZ-WEBSITE', 'xyz-w'],
		['open-data-backend', 'open-db'],
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
