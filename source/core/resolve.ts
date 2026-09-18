/**
 * Turns flags, adopted values, environment detection and built-in defaults into
 * the one Settings object consumed by the generator. This module is deliberately
 * synchronous and headless so scripted and interactive setup share the same path.
 */
import {
	agentCommands,
	agentIds,
	isAgentId,
	maximumAgents,
	type AgentId,
} from './agents.js';
import type {CliFlags} from './arguments.js';
import type {PackageDetection, PackageManager} from './detect.js';
import type {ToolProbe} from './env.js';
import {initials, validatePrefix} from './prefix.js';
import {assertSettings, settingsDefaults, type Settings} from './settings.js';

export const setupFieldOrder = Object.freeze([
	'prefix',
	'pm',
	'tmux',
	'agents',
	'copyIgnored',
	'server',
	'caddy',
	'mcAlias',
] as const);

export type SetupField = (typeof setupFieldOrder)[number];

export type SetupValues = Readonly<{
	prefix: string;
	pm: PackageManager;
	tmux: boolean;
	agents: readonly AgentId[];
	copyIgnored: boolean;
	server: boolean;
	caddy: boolean;
	mcAlias: boolean;
}>;

export type SetupFlags = Readonly<{
	prefix?: string;
	pm?: string;
	tmux?: boolean;
	agents?: string;
	copyIgnored?: boolean;
	server?: boolean;
	caddy?: boolean;
	mcAlias?: boolean;
}>;

export type FixedSettings = Readonly<
	Pick<Settings, 'trunkVersion' | 'generatedOn' | 'repoName' | 'hostLabel'> &
		Partial<Pick<Settings, 'appDir' | 'devScript' | 'scripts'>>
>;

export type ResolveOptions = Readonly<{
	fixed: FixedSettings;
	flags?: SetupFlags;
	/** Values entered by the form. Flags still take precedence over them. */
	answers?: Partial<SetupValues>;
	/** Best-effort values read from an existing wt.toml during overwrite. */
	existing?: Partial<SetupValues>;
	packageDetection?: PackageDetection;
	tools?: Pick<ToolProbe, 'tmux' | 'caddy' | 'brew' | 'agents'>;
	/** Overrides for callers with a command-specific built-in default. */
	defaults?: Partial<SetupValues>;
	/** `--yes`: accept every proposed value without opening the form. */
	acceptDefaults?: boolean;
}>;

export type ValueSource =
	| 'flag'
	| 'answer'
	| 'existing'
	| 'detection'
	| 'built-in'
	| 'dependency';

export type ResolutionWarning = Readonly<{
	field?: SetupField;
	message: string;
}>;

export type AgentOption = Readonly<{
	id: AgentId;
	command: string;
	installed: boolean;
}>;

export type CaddyAvailability =
	| Readonly<{kind: 'installed'}>
	| Readonly<{
			kind: 'brew-installable';
			executable: string;
			arguments: readonly ['install', 'caddy'];
	  }>
	| Readonly<{
			kind: 'missing';
			installUrl: 'https://caddyserver.com/docs/install';
	  }>;

type QuestionBase<Field extends SetupField, Value> = Readonly<{
	field: Field;
	label: string;
	flag: string;
	defaultValue: Value;
	source: Exclude<ValueSource, 'flag' | 'answer' | 'dependency'>;
}>;

export type OpenQuestion =
	| (QuestionBase<'prefix', string> &
			Readonly<{
				kind: 'text';
				help: 'keep it unique across your repos';
			}>)
	| (QuestionBase<'pm', PackageManager> &
			Readonly<{
				kind: 'select';
				options: readonly PackageManager[];
				needsConfirmation: boolean;
			}>)
	| (QuestionBase<'tmux', boolean> &
			Readonly<{kind: 'boolean'; installed: boolean}>)
	| (QuestionBase<'agents', readonly AgentId[]> &
			Readonly<{
				kind: 'multi-select';
				maximum: typeof maximumAgents;
				options: readonly AgentOption[];
			}>)
	| (QuestionBase<'copyIgnored', boolean> & Readonly<{kind: 'boolean'}>)
	| (QuestionBase<'server', boolean> & Readonly<{kind: 'boolean'}>)
	| (QuestionBase<'caddy', boolean> &
			Readonly<{kind: 'boolean'; availability: CaddyAvailability}>)
	| (QuestionBase<'mcAlias', boolean> & Readonly<{kind: 'boolean'}>);

type ResolutionDetails = Readonly<{
	draft: Settings;
	questions: readonly OpenQuestion[];
	sources: Readonly<Record<SetupField, ValueSource>>;
	warnings: readonly ResolutionWarning[];
}>;

export type CompleteResolution = ResolutionDetails &
	Readonly<{
		kind: 'complete';
		settings: Settings;
	}>;

export type NeedsInputResolution = ResolutionDetails &
	Readonly<{
		kind: 'questions';
		questions: readonly OpenQuestion[];
	}>;

export type Resolution = CompleteResolution | NeedsInputResolution;

type Values = {
	-readonly [Field in keyof SetupValues]: SetupValues[Field];
};

type MutablePartialValues = {
	-readonly [Field in keyof SetupValues]?: SetupValues[Field];
};

type Sources = Record<SetupField, ValueSource>;

type SelectedValues = Readonly<{
	values: Values;
	sources: Sources;
	answered: Record<SetupField, boolean>;
}>;

const packageManagers = Object.freeze(['npm', 'pnpm', 'bun'] as const);
const caddyInstallUrl = 'https://caddyserver.com/docs/install';

/** Resolve a setup without reading the terminal or filesystem. */
export function resolve(options: ResolveOptions): Resolution {
	const warnings: ResolutionWarning[] = (
		options.packageDetection?.warnings ?? []
	).map(message => Object.freeze({message}));
	const flags = parseFlags(options.flags ?? {});
	const answers = validateValues(options.answers ?? {}, 'answer');
	const existing = sanitizeExisting(options.existing ?? {}, warnings);
	const detected = detectionValues(options);
	const defaults = builtInValues(options);
	const selected = selectValues({
		flags,
		answers,
		existing,
		detected,
		defaults,
	});

	normalizeDependencies(selected, flags);
	warnAboutPackageManagerMismatch(existing, options.packageDetection, warnings);

	const questions = options.acceptDefaults
		? []
		: setupFieldOrder
				.filter(field => shouldAsk(field, selected))
				.map(field => questionFor(field, selected, options));
	const draft = createSettings(options, selected.values);
	const sources = Object.freeze({...selected.sources});
	const frozenWarnings = Object.freeze(warnings);

	if (questions.length > 0) {
		return Object.freeze({
			kind: 'questions',
			draft,
			questions: Object.freeze(questions),
			sources,
			warnings: frozenWarnings,
		});
	}

	assertSettings(draft);
	return Object.freeze({
		kind: 'complete',
		settings: draft,
		draft,
		questions: Object.freeze([]),
		sources,
		warnings: frozenWarnings,
	});
}

/** Maps Meow's names onto the names used by Settings. */
export function setupFlagsFromCli(flags: CliFlags): SetupFlags {
	return Object.freeze({
		prefix: flags.prefix,
		pm: flags.pm,
		tmux: flags.tmux,
		agents: flags.agents,
		copyIgnored: flags.copyIgnored,
		server: flags.server,
		caddy: flags.caddy,
		mcAlias: flags.mc,
	});
}

export type RerunCommand = Readonly<{
	arguments: readonly string[];
	display: string;
}>;

/**
 * Makes a non-interactive rerun explicit and reproducible instead of merely
 * suggesting `--yes`, whose defaults could change with the machine.
 */
export function buildRerunCommand(
	executable: string,
	originalArguments: readonly string[],
	resolution: NeedsInputResolution,
): RerunCommand {
	const separator = originalArguments.indexOf('--');
	const beforeSeparator =
		separator === -1
			? [...originalArguments]
			: originalArguments.slice(0, separator);
	const afterSeparator =
		separator === -1 ? [] : originalArguments.slice(separator);
	const added = resolution.questions.map(question =>
		questionArgument(question),
	);
	const arguments_ = Object.freeze([
		...beforeSeparator,
		...added,
		...afterSeparator,
	]);

	return Object.freeze({
		arguments: arguments_,
		display: [executable, ...arguments_]
			.map(argument => shellQuote(argument))
			.join(' '),
	});
}

function builtInValues(options: ResolveOptions): Values {
	const values: Values = {
		prefix: initials(options.fixed.repoName),
		pm: 'npm',
		tmux: settingsDefaults.tmux,
		agents: settingsDefaults.agents,
		copyIgnored: settingsDefaults.copyIgnored,
		server: settingsDefaults.server,
		caddy: settingsDefaults.caddy,
		mcAlias: settingsDefaults.mcAlias,
		...options.defaults,
	};
	return {
		...values,
		pm: parsePackageManager(values.pm, 'default package manager'),
		agents: validateAgents(values.agents),
	};
}

function detectionValues(options: ResolveOptions): MutablePartialValues {
	const detected: MutablePartialValues = {};
	if (options.packageDetection) {
		detected.pm = options.packageDetection.packageManager;
	}

	if (options.tools) {
		detected.agents = Object.freeze(
			agentIds
				.filter(id => options.tools?.agents[id].path !== undefined)
				.slice(0, maximumAgents),
		);
		detected.caddy = options.tools.caddy.path !== undefined;
	}

	return detected;
}

function selectValues({
	flags,
	answers,
	existing,
	detected,
	defaults,
}: Readonly<{
	flags: Partial<SetupValues>;
	answers: Partial<SetupValues>;
	existing: Partial<SetupValues>;
	detected: Partial<SetupValues>;
	defaults: Values;
}>): SelectedValues {
	const values: Values = {...defaults};
	const sources: Sources = {
		prefix: 'built-in',
		pm: 'built-in',
		tmux: 'built-in',
		agents: 'built-in',
		copyIgnored: 'built-in',
		server: 'built-in',
		caddy: 'built-in',
		mcAlias: 'built-in',
	};
	const answered: Record<SetupField, boolean> = {
		prefix: false,
		pm: false,
		tmux: false,
		agents: false,
		copyIgnored: false,
		server: false,
		caddy: false,
		mcAlias: false,
	};

	for (const field of setupFieldOrder) {
		if (hasValue(flags, field)) {
			setSelected(field, flags[field]!, 'flag', true);
		} else if (hasValue(answers, field)) {
			setSelected(field, answers[field]!, 'answer', true);
		} else if (hasValue(existing, field)) {
			setSelected(field, existing[field]!, 'existing', false);
		} else if (hasValue(detected, field)) {
			setSelected(field, detected[field]!, 'detection', false);
		} else {
			setSelected(field, defaults[field], 'built-in', false);
		}
	}

	return {values, sources, answered};

	function setSelected<Field extends SetupField>(
		field: Field,
		value: SetupValues[Field],
		source: ValueSource,
		isAnswered: boolean,
	): void {
		values[field] = value;
		sources[field] = source;
		answered[field] = isAnswered;
	}
}

function normalizeDependencies(
	selected: SelectedValues,
	flags: Partial<SetupValues>,
): void {
	if (!selected.values.tmux) {
		if (hasValue(flags, 'agents') && flags.agents!.length > 0) {
			throw new TypeError(
				'Agents require --tmux; remove --no-tmux or use --agents=.',
			);
		}

		selected.values.agents = Object.freeze([]);
		selected.sources.agents = 'dependency';
		selected.answered.agents = true;
	}

	if (!selected.values.server) {
		if (hasValue(flags, 'caddy') && flags.caddy) {
			throw new TypeError(
				'Caddy requires --server; remove --no-server or use --no-caddy.',
			);
		}

		selected.values.caddy = false;
		selected.sources.caddy = 'dependency';
		selected.answered.caddy = true;
	}
}

function shouldAsk(field: SetupField, selected: SelectedValues): boolean {
	if (selected.answered[field]) {
		return false;
	}

	if (field === 'agents') {
		return selected.values.tmux;
	}

	if (field === 'caddy') {
		return selected.values.server;
	}

	return true;
}

function questionFor(
	field: SetupField,
	selected: SelectedValues,
	options: ResolveOptions,
): OpenQuestion {
	const source = selected.sources[field] as Exclude<
		ValueSource,
		'flag' | 'answer' | 'dependency'
	>;
	switch (field) {
		case 'prefix': {
			return Object.freeze({
				field,
				kind: 'text',
				label: 'prefix',
				flag: '--prefix',
				defaultValue: selected.values.prefix,
				source,
				help: 'keep it unique across your repos',
			});
		}

		case 'pm': {
			return Object.freeze({
				field,
				kind: 'select',
				label: 'package manager',
				flag: '--pm',
				defaultValue: selected.values.pm,
				source,
				options: packageManagers,
				needsConfirmation: options.packageDetection?.needsConfirmation ?? false,
			});
		}

		case 'tmux': {
			return Object.freeze({
				field,
				kind: 'boolean',
				label: 'tmux session',
				flag: '--tmux/--no-tmux',
				defaultValue: selected.values.tmux,
				source,
				installed: options.tools?.tmux.path !== undefined,
			});
		}

		case 'agents': {
			return Object.freeze({
				field,
				kind: 'multi-select',
				label: 'agents',
				flag: '--agents',
				defaultValue: Object.freeze([...selected.values.agents]),
				source,
				maximum: maximumAgents,
				options: Object.freeze(
					agentIds.map(id =>
						Object.freeze({
							id,
							command: agentCommands[id],
							installed: options.tools?.agents[id].path !== undefined,
						}),
					),
				),
			});
		}

		case 'copyIgnored': {
			return booleanQuestion({
				field,
				label: 'copy-ignored',
				flag: '--copy/--no-copy',
				defaultValue: selected.values.copyIgnored,
				source,
			});
		}

		case 'server': {
			return booleanQuestion({
				field,
				label: 'dev server',
				flag: '--server/--no-server',
				defaultValue: selected.values.server,
				source,
			});
		}

		case 'caddy': {
			return Object.freeze({
				field,
				kind: 'boolean',
				label:
					options.tools?.caddy.path === undefined
						? 'include Caddy anyway'
						: 'Caddy route',
				flag: '--caddy/--no-caddy',
				defaultValue: selected.values.caddy,
				source,
				availability: caddyAvailability(options.tools),
			});
		}

		case 'mcAlias': {
			return booleanQuestion({
				field,
				label: 'mc alias',
				flag: '--mc/--no-mc',
				defaultValue: selected.values.mcAlias,
				source,
			});
		}
	}
}

function booleanQuestion<Field extends 'copyIgnored' | 'server' | 'mcAlias'>(
	properties: Readonly<{
		field: Field;
		label: string;
		flag: string;
		defaultValue: boolean;
		source: Exclude<ValueSource, 'flag' | 'answer' | 'dependency'>;
	}>,
): Extract<OpenQuestion, {field: Field}> {
	return Object.freeze({
		...properties,
		kind: 'boolean',
	}) as Extract<OpenQuestion, {field: Field}>;
}

function caddyAvailability(tools: ResolveOptions['tools']): CaddyAvailability {
	if (tools?.caddy.path) {
		return Object.freeze({kind: 'installed'});
	}

	if (tools?.brew.path) {
		return Object.freeze({
			kind: 'brew-installable',
			executable: tools.brew.path,
			arguments: Object.freeze(['install', 'caddy'] as const),
		});
	}

	return Object.freeze({kind: 'missing', installUrl: caddyInstallUrl});
}

function createSettings(options: ResolveOptions, values: Values): Settings {
	const appDirectory = options.fixed.appDir ?? options.packageDetection?.appDir;
	return Object.freeze({
		trunkVersion: options.fixed.trunkVersion,
		generatedOn: options.fixed.generatedOn,
		repoName: options.fixed.repoName,
		hostLabel: options.fixed.hostLabel,
		prefix: values.prefix,
		pm: values.pm,
		...(appDirectory ? {appDir: appDirectory} : {}),
		tmux: values.tmux,
		agents: Object.freeze([...values.agents]),
		editorWindow: true,
		copyIgnored: values.copyIgnored,
		server: values.server,
		caddy: values.caddy,
		mcAlias: values.mcAlias,
		devScript: options.fixed.devScript ?? settingsDefaults.devScript,
		scripts: Object.freeze([
			...(options.fixed.scripts ?? options.packageDetection?.scripts ?? []),
		]),
	});
}

function parseFlags(flags: SetupFlags): Partial<SetupValues> {
	const values: MutablePartialValues = {};
	if (flags.prefix !== undefined) {
		values.prefix = flags.prefix;
	}

	if (flags.pm !== undefined) {
		values.pm = parsePackageManager(flags.pm, '--pm');
	}

	if (flags.tmux !== undefined) {
		values.tmux = flags.tmux;
	}

	if (flags.agents !== undefined) {
		values.agents = parseAgents(flags.agents);
	}

	if (flags.copyIgnored !== undefined) {
		values.copyIgnored = flags.copyIgnored;
	}

	if (flags.server !== undefined) {
		values.server = flags.server;
	}

	if (flags.caddy !== undefined) {
		values.caddy = flags.caddy;
	}

	if (flags.mcAlias !== undefined) {
		values.mcAlias = flags.mcAlias;
	}

	return validateValues(values, 'flag');
}

function validateValues(
	values: Partial<SetupValues>,
	source: 'flag' | 'answer' | 'default',
): Partial<SetupValues> {
	const validated: MutablePartialValues = {...values};
	if (values.prefix !== undefined) {
		const result = validatePrefix(values.prefix);
		if (!result.valid) {
			throw new TypeError(result.reason);
		}
	}

	if (values.pm !== undefined) {
		validated.pm = parsePackageManager(values.pm, `${source} package manager`);
	}

	if (values.agents !== undefined) {
		validated.agents = validateAgents(values.agents);
	}

	return validated;
}

function sanitizeExisting(
	values: Partial<SetupValues>,
	warnings: ResolutionWarning[],
): Partial<SetupValues> {
	const valid: MutablePartialValues = {};
	for (const field of setupFieldOrder) {
		if (!hasValue(values, field)) {
			continue;
		}

		try {
			Object.assign(
				valid,
				validateValues(
					{[field]: values[field]} as Partial<SetupValues>,
					'default',
				),
			);
		} catch (error: unknown) {
			warnings.push(
				Object.freeze({
					field,
					message: `Ignoring invalid existing ${field}: ${errorMessage(error)}`,
				}),
			);
		}
	}

	return valid;
}

function parsePackageManager(value: string, name: string): PackageManager {
	if ((packageManagers as readonly string[]).includes(value)) {
		return value as PackageManager;
	}

	throw new TypeError(`${name} must be npm, pnpm, or bun.`);
}

function parseAgents(value: string): readonly AgentId[] {
	if (value === '') {
		return Object.freeze([]);
	}

	const values = value.split(',').map(agent => agent.trim());
	if (values.some(agent => agent.length === 0)) {
		throw new TypeError(
			'--agents must be a comma-separated list without empty entries.',
		);
	}

	return validateAgents(values);
}

function validateAgents(values: readonly string[]): readonly AgentId[] {
	for (const value of values) {
		if (!isAgentId(value)) {
			throw new TypeError(
				`Unknown agent "${value}"; choose from ${agentIds.join(',')}.`,
			);
		}
	}

	if (new Set(values).size !== values.length) {
		throw new TypeError('Agents must not contain duplicates.');
	}

	if (values.length > maximumAgents) {
		throw new TypeError(`max ${maximumAgents} (2×2 grid)`);
	}

	const selected = new Set(values);
	return Object.freeze(agentIds.filter(id => selected.has(id)));
}

function warnAboutPackageManagerMismatch(
	existing: Partial<SetupValues>,
	detection: PackageDetection | undefined,
	warnings: ResolutionWarning[],
): void {
	if (existing.pm && detection && existing.pm !== detection.packageManager) {
		warnings.push(
			Object.freeze({
				field: 'pm',
				message: `Existing config uses ${existing.pm}, but lockfile detection found ${detection.packageManager}.`,
			}),
		);
	}
}

function questionArgument(question: OpenQuestion): string {
	switch (question.field) {
		case 'prefix': {
			return `--prefix=${question.defaultValue}`;
		}

		case 'pm': {
			return `--pm=${question.defaultValue}`;
		}

		case 'agents': {
			return `--agents=${question.defaultValue.join(',')}`;
		}

		case 'tmux': {
			return question.defaultValue ? '--tmux' : '--no-tmux';
		}

		case 'copyIgnored': {
			return question.defaultValue ? '--copy' : '--no-copy';
		}

		case 'server': {
			return question.defaultValue ? '--server' : '--no-server';
		}

		case 'caddy': {
			return question.defaultValue ? '--caddy' : '--no-caddy';
		}

		case 'mcAlias': {
			return question.defaultValue ? '--mc' : '--no-mc';
		}
	}
}

function shellQuote(value: string): string {
	return /^[\w@%+=:,./-]+$/.test(value)
		? value
		: `'${value.replaceAll("'", `'\\''`)}'`;
}

function hasValue(value: unknown, key: PropertyKey): boolean {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	return (
		Object.hasOwn(value, key) &&
		(value as Record<PropertyKey, unknown>)[key] !== undefined
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
