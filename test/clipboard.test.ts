import {chmod, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, describe, expect, test} from 'bun:test';
import {
	clipboardCandidates,
	copyToClipboard,
	noClipboardMessage,
	type ClipboardWriter,
} from '../source/docs/clipboard.js';

describe('clipboard', () => {
	test('uses the first command that is installed and stops there', async () => {
		const calls: string[] = [];
		const result = await copyToClipboard('snippet', {
			find: async command =>
				command === 'wl-copy' || command === 'xclip'
					? `/bin/${command}`
					: undefined,
			async write(executable, arguments_, text) {
				calls.push(`${executable} ${arguments_.join(' ')} <- ${text}`);
				return 0;
			},
		});

		expect(result).toEqual({ok: true, via: 'wl-copy'});
		expect(calls).toEqual(['/bin/wl-copy  <- snippet']);
	});

	test('asks xclip and xsel for the clipboard, not the primary selection', () => {
		const flags = Object.fromEntries(
			clipboardCandidates.map(candidate => [
				candidate.command,
				candidate.arguments.join(' '),
			]),
		);

		expect(flags['xclip']).toBe('-selection clipboard');
		expect(flags['xsel']).toBe('--clipboard --input');
	});

	test('moves on when a command fails, such as xclip without a display', async () => {
		const write: ClipboardWriter = async executable => {
			if (executable.endsWith('xclip')) {
				return 1;
			}

			if (executable.endsWith('wl-copy')) {
				throw new Error('no compositor');
			}

			return 0;
		};

		const result = await copyToClipboard('snippet', {
			find: async command => `/bin/${command}`,
			async write(executable, arguments_, text) {
				if (executable.endsWith('pbcopy')) {
					return 1;
				}

				return write(executable, arguments_, text);
			},
		});

		expect(result).toEqual({ok: true, via: 'xsel'});
	});

	test('reports unavailable, with copy instructions, when no command exists', async () => {
		const result = await copyToClipboard('snippet', {
			find: async () => undefined,
		});

		expect(result).toEqual({
			ok: false,
			reason: 'unavailable',
			message: noClipboardMessage,
		});
		expect(noClipboardMessage).toContain('Select the snippet');
		expect(noClipboardMessage).toContain('terminal');
	});

	test('reports failed when commands exist but none accepts the text', async () => {
		const result = await copyToClipboard('snippet', {
			find: async command => (command === 'xsel' ? '/bin/xsel' : undefined),
			write: async () => 1,
		});

		expect(result).toMatchObject({ok: false, reason: 'failed'});
	});

	describe('with a real command', () => {
		const directory = mkdtemp(join(tmpdir(), 'trunk-clipboard-'));

		afterAll(async () => {
			await rm(await directory, {recursive: true, force: true});
		});

		test('pipes the exact text, newlines included, to its stdin', async () => {
			const root = await directory;
			const output = join(root, 'copied.txt');
			const fake = join(root, 'pbcopy');
			await writeFile(fake, `#!/bin/sh\ncat > "${output}"\n`);
			await chmod(fake, 0o755);
			const text =
				'[[pre-start]]\ninstall = "npm install"\n{{ branch | sanitize }}';

			const result = await copyToClipboard(text, {
				find: async command => (command === 'pbcopy' ? fake : undefined),
			});

			expect(result).toEqual({ok: true, via: 'pbcopy'});
			expect(await readFile(output, 'utf8')).toBe(text);
		});
	});
});
