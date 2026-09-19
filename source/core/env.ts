/**
 * Which tools this machine has. Nothing here is assumed to exist: every tool is
 * looked up on PATH at run time, git and wt are the only hard requirements, and
 * the rest merely shape the defaults trunk offers.
 */
import {constants, type Stats} from 'node:fs';
import {access, stat} from 'node:fs/promises';
import {delimiter, resolve} from 'node:path';
import process from 'node:process';
import {agentCommands, type AgentId} from './agents.js';
import {runCommand, type CommandRunner} from './process.js';
import {unsupportedEnvironment, type Outcome} from './result.js';

export type Tool = Readonly<{
	name: string;
	path?: string;
	version?: string;
}>;

export type ToolProbe = Readonly<{
	git: Tool;
	wt: Tool;
	tmux: Tool;
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

/** The wt release trunk's templates were written against. Older only warns. */
export const minimumWtVersion = Object.freeze({major: 0, minor: 77, patch: 0});

/** Each tool spells its version query differently. */
const versionArguments = Object.freeze({
	git: ['--version'],
	wt: ['--version'],
	tmux: ['-V'],
	gh: ['--version'],
} satisfies Readonly<Record<string, readonly string[]>>);

/**
 * Looks up every tool trunk cares about in one pass. The options exist so tests
 * can supply their own PATH, filesystem and command runner.
 */
export async function probe(options: ProbeOptions = {}): Promise<ToolProbe> {
	const pathValue = options.path ?? process.env['PATH'] ?? '';
	const accessExecutable = options.access ?? access;
	const statPath = options.stat ?? stat;
	const run = options.run ?? runCommand;
	const context = {pathValue, accessExecutable, statPath, run};
	const toolNames = ['git', 'wt', 'tmux', 'gh'] as const;
	const toolEntries = await Promise.all(
		toolNames.map(
			async name =>
				[name, await probeTool(name, versionArguments[name], context)] as const,
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

/**
 * `which`, done in-process. Walking PATH ourselves rather than shelling out
 * means the answer does not depend on the user's shell, its aliases or its
 * startup files, and it behaves the same when no shell exists at all.
 */
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
		// An empty PATH entry means the working directory, as in a POSIX shell.
		const candidate = resolve(directory || '.', command);
		try {
			await accessExecutable(candidate, constants.X_OK);
			const status = await statPath(candidate);
			// Directories are executable too, so the file check is what matters.
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

/**
 * Git and wt are the two tools trunk cannot work around. Everything else is
 * optional and only turns a step off or softens a default.
 */
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

/** The names of the required tools this machine lacks, in a stable order. */
export function missingTools(tools: ToolProbe): string[] {
	return [tools.git, tools.wt]
		.filter(tool => tool.path === undefined)
		.map(tool => tool.name);
}

/** Reads a version out of a line like `wt v0.77.0`. */
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

/**
 * Warns when wt is older than the templates expect. Patch releases are ignored,
 * and a version that cannot be parsed is left alone rather than guessed at.
 */
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
		// Some tools print their version on stderr, and a version is never
		// required, so a tool that fails this call still counts as present.
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
