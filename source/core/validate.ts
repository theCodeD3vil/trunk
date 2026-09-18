/**
 * Read-only validation of a generated project config through Worktrunk itself.
 * The raw diagnostics stay attached to failures because they are usually the
 * fastest way for a user to fix a local version or template mismatch.
 */
import {expectedHooks} from './generate/index.js';
import {runCommand, type CommandRunner} from './process.js';
import type {Settings} from './settings.js';

export type ValidationPreview = Readonly<{
	session?: string;
}>;

export type ValidationResult = Readonly<{
	preview: ValidationPreview;
	configOutput: string;
	hookOutput: string;
}>;

export type ValidationOptions = Readonly<{
	wtPath?: string;
	run?: CommandRunner;
	env?: NodeJS.ProcessEnv;
}>;

type ExpandedHook = Readonly<{
	expanded: string;
	name: string;
	source: string;
	type: string;
}>;

export class GeneratedConfigError extends Error {
	readonly output: string;

	constructor(message: string, output: string) {
		super(`${message}${output.trim() ? `\n${output.trim()}` : ''}`);
		this.name = 'GeneratedConfigError';
		this.output = output;
	}
}

export async function validateGeneratedConfig(
	worktreePath: string,
	settings: Settings,
	options: ValidationOptions = {},
): Promise<ValidationResult> {
	const run = options.run ?? runCommand;
	const wtPath = options.wtPath ?? 'wt';
	const commandOptions = {env: options.env};
	const config = await run(
		wtPath,
		['-C', worktreePath, 'config', 'show'],
		commandOptions,
	);
	const configOutput = joinOutput(config.stdout, config.stderr);
	if (config.code !== 0 || hasDiagnostic(configOutput)) {
		throw new GeneratedConfigError(
			'Worktrunk rejected the generated config.',
			configOutput,
		);
	}

	const hooks = await run(
		wtPath,
		['-C', worktreePath, 'hook', 'show', '--expanded', '--format', 'json'],
		commandOptions,
	);
	const hookOutput = joinOutput(hooks.stdout, hooks.stderr);
	if (hooks.code !== 0 || hasDiagnostic(hookOutput)) {
		throw new GeneratedConfigError(
			'Worktrunk could not expand the generated hooks.',
			hookOutput,
		);
	}

	const records = parseExpandedHooks(hooks.stdout, hookOutput);
	assertExpectedHooks(records, settings, hookOutput);

	return Object.freeze({
		preview: Object.freeze(extractPreview(records)),
		configOutput,
		hookOutput,
	});
}

function parseExpandedHooks(stdout: string, rawOutput: string): ExpandedHook[] {
	let value: unknown;
	try {
		value = JSON.parse(stdout);
	} catch {
		throw new GeneratedConfigError(
			'Worktrunk returned invalid hook JSON.',
			rawOutput,
		);
	}

	if (!Array.isArray(value) || !value.every(entry => isExpandedHook(entry))) {
		throw new GeneratedConfigError(
			'Worktrunk returned unexpected hook data.',
			rawOutput,
		);
	}

	return value;
}

function isExpandedHook(value: unknown): value is ExpandedHook {
	return (
		typeof value === 'object' &&
		value !== null &&
		'expanded' in value &&
		typeof value.expanded === 'string' &&
		'name' in value &&
		typeof value.name === 'string' &&
		'source' in value &&
		typeof value.source === 'string' &&
		'type' in value &&
		typeof value.type === 'string'
	);
}

function assertExpectedHooks(
	records: readonly ExpandedHook[],
	settings: Settings,
	rawOutput: string,
): void {
	const configured = new Set(
		records
			.filter(record => record.source === 'project')
			.map(record => `${record.type}:${record.name}`),
	);
	const missing = expectedHooks(settings)
		.map(hook => `${hook.type}:${hook.name}`)
		.filter(hook => !configured.has(hook));
	if (missing.length > 0) {
		throw new GeneratedConfigError(
			`Worktrunk omitted generated hooks: ${missing.join(', ')}.`,
			rawOutput,
		);
	}
}

/** The session name the tmux hook will create, read back from its expansion. */
function extractPreview(records: readonly ExpandedHook[]): ValidationPreview {
	const tmux = findHook(records, 'pre-start', 'tmux');
	const prefix = tmux ? assignment(tmux, 'P') : undefined;
	const branch = tmux ? assignment(tmux, 'B') : undefined;

	return {session: prefix && branch ? `${prefix}_${branch}` : undefined};
}

function findHook(
	records: readonly ExpandedHook[],
	type: string,
	name: string,
): string | undefined {
	return records.find(
		record =>
			record.source === 'project' &&
			record.type === type &&
			record.name === name,
	)?.expanded;
}

function assignment(body: string, name: string): string | undefined {
	const match = new RegExp(`^${name}=(.+)$`, 'm').exec(body);
	return match ? unquote(match[1]!.trim()) : undefined;
}

function unquote(value: string): string {
	if (
		(value.startsWith("'") && value.endsWith("'")) ||
		(value.startsWith('"') && value.endsWith('"'))
	) {
		return value.slice(1, -1);
	}

	return value;
}

function hasDiagnostic(output: string): boolean {
	return output
		.split(/\r?\n/)
		.some(
			line =>
				/^\s*[▲⚠✗]\s+.*(?:unknown field|invalid|error|warning|failed|rejected)/i.test(
					line,
				) || /^\s*(?:warning|error)(?:\b|:)/i.test(line),
		);
}

function joinOutput(stdout: string, stderr: string): string {
	return [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join('\n');
}
