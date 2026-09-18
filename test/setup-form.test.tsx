import React, {useState} from 'react';
import {Box} from 'ink';
import {afterEach, describe, expect, test} from 'bun:test';
import {cleanup, render} from 'ink-testing-library';
import {agentIds, type AgentId} from '../source/core/agents.js';
import type {ResolveOptions} from '../source/core/resolve.js';
import SetupForm from '../source/ui/SetupForm.js';
import MultiSelect, {
	type MultiSelectOption,
} from '../source/ui/fields/MultiSelect.js';

const fixed = Object.freeze({
	trunkVersion: '0.0.0-test',
	generatedOn: '2026-09-18',
	repoName: 'acme-admin',
	hostLabel: 'acme-admin',
});

afterEach(() => {
	cleanup();
});

describe('setup form', () => {
	test('renders cleanly in 80 columns', () => {
		const view = render(
			<Box width={80}>
				<SetupForm
					folder="/Users/example/Projects/example-org/acme-admin"
					options={{fixed, tools: tools()}}
					randomPrefix={() => 'otter'}
					onSubmit={noop}
					onAbort={noop}
				/>
			</Box>,
		);
		const frame = view.lastFrame() ?? '';

		expect(frame).toMatchSnapshot();
		for (const line of frame.split('\n')) {
			expect(line.length).toBeLessThanOrEqual(80);
		}
	});

	test('routes Ctrl+C through the abort callback', async () => {
		let submissions = 0;
		let aborts = 0;
		const view = render(
			<SetupForm
				folder="/tmp/acme-admin"
				options={{fixed, tools: tools()}}
				onSubmit={() => {
					submissions += 1;
				}}
				onAbort={() => {
					aborts += 1;
				}}
			/>,
		);

		await tick();
		view.stdin.write('\u0003');
		await tick();

		expect(aborts).toBe(1);
		expect(submissions).toBe(0);
	});

	test('refuses a fifth selected agent', async () => {
		const options: ReadonlyArray<MultiSelectOption<AgentId>> = agentIds.map(
			id => ({
				value: id,
				label: id,
			}),
		);
		const view = render(<AgentLimitFixture options={options} />);

		// Move from claude to pi, which is not among the four selected defaults.
		await tick();
		for (let index = 0; index < 5; index += 1) {
			view.stdin.write('\u001B[B');
			// Each key must be consumed before the testing stream receives the next.
			// eslint-disable-next-line no-await-in-loop
			await tick();
		}

		view.stdin.write(' ');
		await tick();

		expect(view.lastFrame()).toContain('max 4 (2×2 grid)');
		expect(view.lastFrame()).toContain('[ ] pi');
	});

	test('goes back from the summary and submits only after confirmation', async () => {
		let submittedPrefix: string | undefined;
		let aborts = 0;
		const view = render(
			<SetupForm
				folder="/tmp/acme-admin"
				options={{fixed, tools: tools()}}
				onSubmit={settings => {
					submittedPrefix = settings.prefix;
				}}
				onAbort={() => {
					aborts += 1;
				}}
			/>,
		);

		await tick();
		for (let index = 0; index < 8; index += 1) {
			view.stdin.write('\r');
			// The active field changes after each key.
			// eslint-disable-next-line no-await-in-loop
			await tick();
		}

		expect(view.lastFrame()).toContain('Review setup');
		view.stdin.write('b');
		await tick();
		expect(view.lastFrame()).toContain('Configure worktree setup');

		view.stdin.write('\r');
		await tick();
		expect(view.lastFrame()).toContain('Review setup');
		view.stdin.write('\r');
		await tick();

		expect(submittedPrefix).toBe('acme-a');
		expect(aborts).toBe(0);
	});
});

function AgentLimitFixture({
	options,
}: Readonly<{
	options: ReadonlyArray<MultiSelectOption<AgentId>>;
}>): React.ReactElement {
	const [value, setValue] = useState<readonly AgentId[]>(agentIds.slice(0, 4));
	return (
		<MultiSelect
			isActive
			label="agents"
			options={options}
			value={value}
			maximum={4}
			onChange={setValue}
			onSubmit={noop}
		/>
	);
}

function tools(): NonNullable<ResolveOptions['tools']> {
	return {
		tmux: {name: 'tmux', path: '/tools/tmux'},
		caddy: {name: 'caddy'},
		brew: {name: 'brew'},
		agents: Object.fromEntries(
			agentIds.map((id, index) => [
				id,
				index < 2 ? {name: id, path: `/tools/${id}`} : {name: id},
			]),
		) as NonNullable<ResolveOptions['tools']>['agents'],
	};
}

async function tick(): Promise<void> {
	await new Promise(resolve => {
		setTimeout(resolve, 0);
	});
}

function noop(): void {
	// Rendering-only tests intentionally have no side effect.
}
