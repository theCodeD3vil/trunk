import process from 'node:process';
import {describe, expect, test} from 'bun:test';
import {runCommand} from '../source/core/process.js';

/** The command's own pid and its process group, as the command sees them. */
const groupOf = async (detached: boolean): Promise<[string, string]> => {
	const result = await runCommand(
		'sh',
		['-c', 'echo "$$ $(ps -o pgid= -p $$)"'],
		{detached},
	);
	const [pid = '', group = ''] = result.stdout.trim().split(/\s+/);
	return [pid, group];
};

describe('runCommand', () => {
	test('a detached command leads its own session, so it has no terminal to be stopped by', async () => {
		const [pid, group] = await groupOf(true);
		expect(group).toBe(pid);
	});

	test("an ordinary command stays in trunk's process group", async () => {
		const [pid, group] = await groupOf(false);
		const ours = await runCommand('ps', [
			'-o',
			'pgid=',
			'-p',
			`${process.pid}`,
		]);
		expect(group).not.toBe(pid);
		expect(group).toBe(ours.stdout.trim());
	});
});
