import {constants, type Stats} from 'node:fs';
import {access, stat} from 'node:fs/promises';
import {delimiter, resolve} from 'node:path';
import process from 'node:process';
import {runCommand, type CommandRunner} from './process.js';
import {unsupportedEnvironment, type Outcome} from './result.js';

export const agentCommands = Object.freeze({
	claude: 'claude',
	codex: 'codex',
	opencode: 'opencode',
	copilot: 'copilot',
	antigravity: 'agy',
	pi: 'pi',
});

export type AgentId = keyof typeof agentCommands;

export type Tool = Readonly<{
	name: string;
	path?: string;
	version?: string;
}>;

export type ToolProbe = Readonly<{
	git: Tool;
	wt: Tool;
	tmux: Tool;
	caddy: Tool;
	brew: Tool;
	gh: Tool;
	agents: Readonly<Record<AgentId, Tool>>;
}>;

export type SemanticVersion = Readonly<{
	major: number;
	minor: number;
	patch: number;
}>;

export type ProbeOptions = Readonly<{
	path?: string;
	access?: (path: string, mode: number) => Promise<void>;
	stat?: (path: string) => Promise<Pick<Stats, 'isFile'>>;
	run?: CommandRunner;
}>;

type ProbeContext = Readonly<{
	pathValue: string;
	accessExecutable: (path: string, mode: number) => Promise<void>;
	statPath: (path: string) => Promise<Pick<Stats, 'isFile'>>;
	run: CommandRunner;
}>;

export const minimumWtVersion = Object.freeze({major: 0, minor: 77, patch: 0});

const versionArguments = Object.freeze({
	git: ['--version'],
	wt: ['--version'],
	tmux: ['-V'],
	caddy: ['version'],
	gh: ['--version'],
} satisfies Readonly<Record<string, readonly string[]>>);

export async function probe(options: ProbeOptions = {}): Promise<ToolProbe> {
	const pathValue = options.path ?? process.env['PATH'] ?? '';
	const accessExecutable = options.access ?? access;
	const statPath = options.stat ?? stat;
	const run = options.run ?? runCommand;
	const context = {pathValue, accessExecutable, statPath, run};
	const toolNames = ['git', 'wt', 'tmux', 'caddy', 'brew', 'gh'] as const;
	const toolEntries = await Promise.all(
		toolNames.map(
			async name =>
				[
					name,
					await probeTool(
						name,
						versionArguments[name as keyof typeof versionArguments],
						context,
					),
				] as const,
		),
	);
	const tools = Object.fromEntries(toolEntries) as Record<
		(typeof toolNames)[number],
		Tool
	>;
	const agentEntries = await Promise.all(
		(Object.entries(agentCommands) as Array<[AgentId, string]>).map(
			async ([id, command]) =>
				[id, await probeTool(command, undefined, context)] as const,
		),
	);
	const agents = Object.freeze(
		Object.fromEntries(agentEntries) as Record<AgentId, Tool>,
	);

	return Object.freeze({...tools, agents});
}

export async function resolveExecutable(
	command: string,
	pathValue: string = process.env['PATH'] ?? '',
	accessExecutable: (path: string, mode: number) => Promise<void> = access,
	statPath: (path: string) => Promise<Pick<Stats, 'isFile'>> = stat,
): Promise<string | undefined> {
	const directories = pathValue.split(delimiter);
	const visit = async (index: number): Promise<string | undefined> => {
		if (index >= directories.length) {
			return undefined;
		}

		const directory = directories[index] ?? '';
		const candidate = resolve(directory || '.', command);
		try {
			await accessExecutable(candidate, constants.X_OK);
			const status = await statPath(candidate);
			if (status.isFile()) {
				return candidate;
			}

			return await visit(index + 1);
		} catch {
			return visit(index + 1);
		}
	};

	return visit(0);
}

export function checkRequiredTools(tools: ToolProbe): Outcome | undefined {
	const missing = [tools.git, tools.wt]
		.filter(tool => tool.path === undefined)
		.map(tool => tool.name);
	if (missing.length === 0) {
		return undefined;
	}

	return unsupportedEnvironment(
		`Missing required ${
			missing.length === 1 ? 'tool' : 'tools'
		}: ${missing.join(
			', ',
		)}. Install Git and Worktrunk before continuing: https://worktrunk.dev`,
	);
}

export function parseWtVersion(
	version: string | undefined,
): SemanticVersion | undefined {
	const match = /\b(?:wt\s+)?v?(\d+)\.(\d+)(?:\.(\d+))?\b/i.exec(version ?? '');
	if (!match) {
		return undefined;
	}

	return Object.freeze({
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3] ?? 0),
	});
}

export function wtVersionWarning(
	version: string | undefined,
): string | undefined {
	const parsed = parseWtVersion(version);
	if (!parsed) {
		return undefined;
	}

	if (
		parsed.major > minimumWtVersion.major ||
		(parsed.major === minimumWtVersion.major &&
			parsed.minor >= minimumWtVersion.minor)
	) {
		return undefined;
	}

	return `Worktrunk ${version} is older than the tested ${formatVersion(
		minimumWtVersion,
	)}; generated templates may need adjustment.`;
}

async function probeTool(
	name: string,
	arguments_: readonly string[] | undefined,
	context: ProbeContext,
): Promise<Tool> {
	const path = await resolveExecutable(
		name,
		context.pathValue,
		context.accessExecutable,
		context.statPath,
	);
	if (!path) {
		return Object.freeze({name});
	}

	if (!arguments_) {
		return Object.freeze({name, path});
	}

	try {
		const result = await context.run(path, arguments_);
		const version = firstLine(result.stdout) ?? firstLine(result.stderr);
		return Object.freeze({name, path, version});
	} catch {
		return Object.freeze({name, path});
	}
}

function firstLine(value: string): string | undefined {
	return value
		.split(/\r?\n/)
		.map(line => line.trim())
		.find(Boolean);
}

function formatVersion(version: SemanticVersion): string {
	return `v${version.major}.${version.minor}.${version.patch}`;
}
