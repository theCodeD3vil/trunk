/**
 * Reads what it can out of a `wt.toml` that already exists, so overwriting a
 * configured repository starts from that repository's own choices instead of
 * from trunk's defaults.
 *
 * Adoption is best-effort by design: a file trunk cannot parse, or a value it
 * does not recognise, is simply not adopted. Nothing here ever fails a run —
 * the caller falls back to detection and says so.
 */
import * as TOML from '@iarna/toml';
import {isAgentId, maximumAgents, type AgentId} from './agents.js';
import type {PackageManager} from './detect.js';
import type {SetupValues} from './resolve.js';

export type AdoptionNote = Readonly<{
	field?: keyof SetupValues;
	message: string;
}>;

export type Adoption = Readonly<{
	values: Partial<SetupValues>;
	/** `[step.copy-ignored] exclude`, carried over rather than regenerated. */
	copyIgnoredExclude?: readonly string[];
	/** What could not be read, for the report before the diff. */
	notes: readonly AdoptionNote[];
}>;

const packageManagers: readonly PackageManager[] = ['bun', 'pnpm', 'npm'];

/** SetupValues is readonly for its consumers; adoption fills it in field by field. */
type DraftValues = {
	-readonly [Field in keyof SetupValues]?: SetupValues[Field];
};

/** Values recovered from an existing config, plus what could not be recovered. */
export function adoptConfig(source: string): Adoption {
	const notes: AdoptionNote[] = [];
	let document: Record<string, unknown>;
	try {
		document = TOML.parse(source) as Record<string, unknown>;
	} catch (error: unknown) {
		return Object.freeze({
			values: Object.freeze({}),
			notes: Object.freeze([
				Object.freeze({
					message: `the existing config could not be parsed, so nothing was adopted: ${
						error instanceof Error ? error.message : String(error)
					}`,
				}),
			]),
		});
	}

	const hooks = collectCommands(document);
	const values: DraftValues = {};

	const tmuxBody = hooks.get('pre-start:tmux');
	values.tmux = tmuxBody !== undefined;
	if (tmuxBody) {
		const prefix = readPrefix(tmuxBody);
		if (prefix) {
			values.prefix = prefix;
		} else {
			notes.push({field: 'prefix', message: 'could not read the tmux prefix'});
		}

		values.agents = readAgents(tmuxBody, notes);
	}

	const install = hooks.get('post-start:install');
	const packageManager = install ? readPackageManager(install) : undefined;
	if (packageManager) {
		values.pm = packageManager;
	} else if (install) {
		notes.push({
			field: 'pm',
			message: `could not tell which package manager ${JSON.stringify(
				install,
			)} uses`,
		});
	}

	values.copyIgnored = hooks.has('post-start:copy');
	values.server = hooks.has('post-start:server');
	values.caddy = hooks.has('post-start:proxy');
	values.mcAlias = hooks.has('alias:mc');

	const excludes = readExcludes(document);

	return Object.freeze({
		values: Object.freeze(values),
		copyIgnoredExclude: excludes,
		notes: Object.freeze(notes),
	});
}

/** `P=<prefix>` in the tmux hook, with or without shell quoting. */
function readPrefix(body: string): string | undefined {
	const match = /^P=(.+)$/m.exec(body);
	if (!match) {
		return undefined;
	}

	return unquote(match[1]!.trim()) || undefined;
}

/** The default list in `for a in ${WT_AGENTS-claude codex}`. */
function readAgents(body: string, notes: AdoptionNote[]): readonly AgentId[] {
	const match = /\${WT_AGENTS-([^}]*)}/.exec(body);
	if (!match) {
		return Object.freeze([]);
	}

	const found: AgentId[] = [];
	for (const name of match[1]!.trim().split(/\s+/).filter(Boolean)) {
		if (isAgentId(name)) {
			found.push(name);
		} else {
			notes.push({field: 'agents', message: `unknown agent ${name}, skipped`});
		}
	}

	if (found.length > maximumAgents) {
		notes.push({
			field: 'agents',
			message: `the existing config starts ${found.length} agents; keeping the first ${maximumAgents}`,
		});
	}

	return Object.freeze(found.slice(0, maximumAgents));
}

/**
 * The install command names its package manager. Matched on a word boundary so
 * a path such as `./node_modules/.bin/npm` does not turn pnpm into npm.
 */
function readPackageManager(command: string): PackageManager | undefined {
	return packageManagers.find(name =>
		new RegExp(String.raw`(?:^|[\s/])${name}(?:\s|$)`).test(command),
	);
}

function readExcludes(
	document: Record<string, unknown>,
): readonly string[] | undefined {
	const {step} = document;
	if (typeof step !== 'object' || step === null) {
		return undefined;
	}

	const {'copy-ignored': copyIgnored} = step as Record<string, unknown>;
	if (typeof copyIgnored !== 'object' || copyIgnored === null) {
		return undefined;
	}

	const {exclude} = copyIgnored as Record<string, unknown>;
	if (!Array.isArray(exclude)) {
		return undefined;
	}

	const values = exclude.filter(
		(value): value is string => typeof value === 'string',
	);
	return values.length > 0 ? Object.freeze(values) : undefined;
}

/**
 * Every command body in the file, keyed `<table>:<name>`, so the presence of a
 * step and the text of its command are one lookup.
 */
function collectCommands(
	document: Record<string, unknown>,
): ReadonlyMap<string, string> {
	const commands = new Map<string, string>();
	for (const table of ['pre-start', 'post-start', 'pre-remove']) {
		for (const [name, body] of tableEntries(document[table])) {
			commands.set(`${table}:${name}`, body);
		}
	}

	for (const [name, body] of tableEntries(document['aliases'])) {
		commands.set(`alias:${name}`, body);
	}

	return commands;
}

function tableEntries(value: unknown): Array<[string, string]> {
	const tables = Array.isArray(value) ? value : [value];
	const entries: Array<[string, string]> = [];
	for (const table of tables) {
		if (typeof table !== 'object' || table === null) {
			continue;
		}

		for (const [name, body] of Object.entries(
			table as Record<string, unknown>,
		)) {
			if (typeof body === 'string') {
				entries.push([name, body]);
			}
		}
	}

	return entries;
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
