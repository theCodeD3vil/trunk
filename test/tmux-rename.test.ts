import {afterAll, describe, expect, test} from 'bun:test';
import {resolveExecutable} from '../source/core/env.js';
import {runCommand} from '../source/core/process.js';
import {
	listSessions,
	manualKillCommands,
	planRenames,
	renameSessions,
} from '../source/core/tmuxRename.js';

/** An isolated tmux server, so the test can never touch a real session. */
const socketName = 'trunk-test';

describe('planning a prefix change', () => {
	test('renames only the sessions the old prefix owns', () => {
		const sessions = [
			'acme_main',
			'acme_feature-ui',
			'acme',
			'acme-api_main',
			'other_main',
		];

		expect(planRenames(sessions, 'acme', 'acme-a')).toEqual([
			{from: 'acme_main', to: 'acme-a_main'},
			{from: 'acme_feature-ui', to: 'acme-a_feature-ui'},
		]);
	});

	test('does nothing when the prefix did not change', () => {
		expect(planRenames(['acme_main'], 'acme', 'acme')).toEqual([]);
		expect(planRenames(['acme_main'], '', 'acme')).toEqual([]);
	});

	test('names the commands for a session it could not rename', () => {
		expect(
			manualKillCommands([{from: 'acme_main', to: 'acme-a_main'}]),
		).toEqual(["tmux kill-session -t '=acme_main'"]);
	});
});

describe('renaming live sessions', () => {
	afterAll(async () => {
		await tmux(['kill-server']);
	});

	test('renames what it planned and leaves the rest alone', async () => {
		const tmuxPath = await resolveExecutable('tmux');
		expect(tmuxPath).toBeDefined();
		if (!tmuxPath) {
			return;
		}

		await tmux(['kill-server']);
		for (const name of ['acme_main', 'acme_feature-ui', 'other_main']) {
			// Sessions must exist before the rename, so these cannot run together.
			// eslint-disable-next-line no-await-in-loop
			await tmux(['new-session', '-d', '-s', name]);
		}

		const before = await listSessions({tmuxPath, socketName});
		expect([...before].sort()).toEqual([
			'acme_feature-ui',
			'acme_main',
			'other_main',
		]);

		const result = await renameSessions(
			planRenames([...before], 'acme', 'acme-a'),
			{tmuxPath, socketName},
		);

		expect(result.failed).toEqual([]);
		expect([...(await listSessions({tmuxPath, socketName}))].sort()).toEqual([
			'acme-a_feature-ui',
			'acme-a_main',
			'other_main',
		]);
	}, 20_000);

	test('reports a session that is no longer there', async () => {
		const tmuxPath = await resolveExecutable('tmux');
		if (!tmuxPath) {
			return;
		}

		const result = await renameSessions(
			[{from: 'acme_gone', to: 'acme-a_gone'}],
			{tmuxPath, socketName},
		);

		expect(result.renamed).toEqual([]);
		expect(result.failed).toEqual([{from: 'acme_gone', to: 'acme-a_gone'}]);
	});
});

async function tmux(arguments_: readonly string[]): Promise<void> {
	const tmuxPath = await resolveExecutable('tmux');
	if (!tmuxPath) {
		return;
	}

	await runCommand(tmuxPath, ['-L', socketName, ...arguments_]);
}
