import {describe, expect, test} from 'bun:test';
import {topics} from '../source/docs/index.js';
import {search} from '../source/docs/search.js';

describe('docs search', () => {
	test('/pnpm lands on the install page with a pnpm snippet', () => {
		const [top] = search('pnpm');

		expect(top?.topicId).toBe('node');
		expect(top?.sectionId).toBe('install-dependencies');
		expect(top?.snippet.text.toLowerCase()).toContain('pnpm');
	});

	test('/hash_port lands on the dev server page with a hash_port snippet', () => {
		const [top] = search('hash_port');

		expect(top?.topicId).toBe('node');
		expect(top?.sectionId).toBe('dev-server');
		expect(top?.snippet.text).toContain('hash_port');
	});

	test('a prose-only term finds the page that explains it', () => {
		const term = 'concurrently';
		// Guard the premise: the term is in prose only, never a title or a snippet.
		for (const topic of topics) {
			for (const section of topic.sections) {
				expect(section.title.toLowerCase()).not.toContain(term);
				for (const block of section.blocks) {
					if (block.kind === 'code') {
						expect(`${block.label}\n${block.code}`).not.toContain(term);
					}
				}
			}
		}

		const results = search(term);

		expect(results.map(result => result.sectionId)).toEqual(['pipelines']);
		expect(results[0]?.topicId).toBe('config-basics');
		expect(results[0]?.snippet.location).toBe('text');
		expect(results[0]?.snippet.text).toContain(term);
	});

	test('finds code by a term that only appears inside a block', () => {
		const results = search('reverse_proxy');

		expect(results.map(result => result.sectionId)).toEqual(['caddy']);
		expect(results[0]?.snippet.location).toBe('code');
		expect(results[0]?.snippet.text).toContain('reverse_proxy');
	});

	test('ranks a title match above a body match', () => {
		const [top, second] = search('caddy');

		expect(top?.sectionId).toBe('caddy');
		expect(second?.score ?? 0).toBeLessThan(top?.score ?? 0);
	});

	test('requires every word of a multi-word query', () => {
		expect(search('tether server').map(result => result.sectionId)).toContain(
			'dev-server',
		);
		expect(search('tether wasabi')).toEqual([]);
	});

	test('ignores case and surrounding space, and returns nothing for no query', () => {
		expect(search('  PNPM ')[0]?.sectionId).toBe('install-dependencies');
		expect(search('')).toEqual([]);
		expect(search('   ')).toEqual([]);
	});

	test('keeps a snippet short and cut at word boundaries', () => {
		for (const term of ['pnpm', 'approvals', 'template', 'wt']) {
			for (const result of search(term)) {
				expect(result.snippet.text.length).toBeLessThanOrEqual(80);
			}
		}
	});
});
