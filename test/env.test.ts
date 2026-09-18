import {delimiter, join, resolve} from 'node:path';
import {describe, expect, test} from 'bun:test';
import {agentCommands} from '../source/core/agents.js';
import {
	checkRequiredTools,
	parseWtVersion,
	probe,
	resolveExecutable,
	wtVersionWarning,
} from '../source/core/env.js';
import type {CommandRunner} from '../source/core/process.js';
import {exitCodes} from '../source/core/result.js';

describe('environment probing', () => {
	test('resolves the first executable on PATH', async () => {
		const attempted: string[] = [];
		const executable = await resolveExecutable(
			'git',
			['/first', '/second'].join(delimiter),
			async path => {
				attempted.push(path);
				if (path !== join('/second', 'git')) {
					throw new Error('not executable');
				}
			},
			async () => ({isFile: () => true}),
		);

		expect(executable).toBe(join('/second', 'git'));
		expect(attempted).toEqual([join('/first', 'git'), join('/second', 'git')]);
	});

	test('returns a deeply frozen record with every agent', async () => {
		const commands: Array<{command: string; arguments: readonly string[]}> = [];
		const path = '/tools';
		const run: CommandRunner = async (command, arguments_) => {
			commands.push({command, arguments: arguments_});
			return {code: 0, stdout: `${command} version\n`, stderr: ''};
		};

		const tools = await probe({
			path,
			async access() {
				await Promise.resolve();
			},
			async stat() {
				return {isFile: () => true};
			},
			run,
		});

		expect(Object.isFrozen(tools)).toBe(true);
		expect(Object.isFrozen(tools.agents)).toBe(true);
		expect(Object.isFrozen(tools.git)).toBe(true);
		expect(Object.keys(tools.agents)).toEqual(Object.keys(agentCommands));
		expect(tools.agents.antigravity).toEqual({
			name: 'agy',
			path: join(path, 'agy'),
		});
		expect(commands).toContainEqual({
			command: join(path, 'tmux'),
			arguments: ['-V'],
		});
		expect(commands.some(command => command.command.endsWith('/brew'))).toBe(
			false,
		);
	});

	test('keeps optional tools missing and identifies hard requirements', async () => {
		const tools = await probe({
			path: '/tools',
			async access(path) {
				if (path.endsWith('/wt')) {
					throw new Error('missing');
				}
			},
			async stat() {
				return {isFile: () => true};
			},
			run: async () => ({code: 0, stdout: '', stderr: ''}),
		});

		expect(tools.wt.path).toBeUndefined();
		const outcome = checkRequiredTools(tools);
		expect(outcome?.code).toBe(exitCodes.unsupportedEnvironment);
		expect(outcome?.message).toContain('https://worktrunk.dev');
	});

	test('does not fail when optional tools and agents are missing', async () => {
		const tools = await probe({
			path: '/tools',
			async access(path) {
				if (!path.endsWith('/git') && !path.endsWith('/wt')) {
					throw new Error('missing');
				}
			},
			async stat() {
				return {isFile: () => true};
			},
			run: async () => ({code: 0, stdout: '', stderr: ''}),
		});

		expect(checkRequiredTools(tools)).toBeUndefined();
		expect(tools.tmux.path).toBeUndefined();
		expect(tools.caddy.path).toBeUndefined();
		expect(tools.agents.claude.path).toBeUndefined();
	});

	test('parses and checks the Worktrunk version', () => {
		expect(parseWtVersion('wt v0.77.0')).toEqual({
			major: 0,
			minor: 77,
			patch: 0,
		});
		expect(parseWtVersion('not a version')).toBeUndefined();
		expect(wtVersionWarning('wt v0.76.9')).toContain('older');
		expect(wtVersionWarning('wt v0.77.0')).toBeUndefined();
		expect(wtVersionWarning('wt v1.0.0')).toBeUndefined();
	});

	test('searches empty PATH entries and ignores executable directories', async () => {
		const currentCandidate = resolve('tool');
		const attempted: string[] = [];
		const executable = await resolveExecutable(
			'tool',
			['', '/tools'].join(delimiter),
			async () => {
				await Promise.resolve();
			},
			async path => {
				attempted.push(path);
				return {isFile: () => path !== currentCandidate};
			},
		);

		expect(attempted).toEqual([currentCandidate, '/tools/tool']);
		expect(executable).toBe('/tools/tool');
	});
});
