/**
 * Turns flags, form answers and built-in defaults into the one Settings object
 * consumed by the generator. This module is deliberately synchronous and
 * headless so scripted and interactive setup share the same path.
 *
 * Precedence is flag, then form answer, then built-in default. Nothing is
 * inferred from the project itself: trunk does not know what stack it holds.
 */
import {
	agentCommands,
	agentIds,
	isAgentId,
	maximumAgents,
	type AgentId,
} from './agents.js';
import type {CliFlags} from './arguments.js';
import type {ToolProbe} from './env.js';
import {initials, validatePrefix} from './prefix.js';
import {assertSettings, settingsDefaults, type Settings} from './settings.js';

export const setupFieldOrder = Object.freeze([
	'prefix',
	'tmux',
	'agents',
	'copyIgnored',
	'mcAlias',
] as const);

export type SetupField = (typeof setupFieldOrder)[number];

export type SetupValues = Readonly<{
	prefix: string;
	tmux: boolean;
	agents: readonly AgentId[];
	copyIgnored: boolean;
	mcAlias: boolean;
}>;

export type SetupFlags = Readonly<{
	prefix?: string;
	tmux?: boolean;
	agents?: string;
	copyIgnored?: boolean;
	mcAlias?: boolean;
}>;

/** Facts about this run that no question can change. */
export type FixedSettings = Readonly<
	Pick<Settings, 'trunkVersion' | 'generatedOn'> & {
		/** Only feeds the suggested prefix; it is not written to the config. */
		repoName: string;
	}
>;

export type ResolveOptions = Readonly<{
	fixed: FixedSettings;
	flags?: SetupFlags;
	/** Values entered by the form. Flags still take precedence over them. */
	answers?: Partial<SetupValues>;
	/** What is installed here: only installed agents can be chosen. */
	tools: Pick<ToolProbe, 'tmux' | 'agents'>;
	/** `--yes`: accept every proposed value without opening the form. */
	acceptDefaults?: boolean;
}>;

export type ValueSource = 'flag' | 'answer' | 'built-in' | 'dependency';

export type AgentOption = Readonly<{
	id: AgentId;
	command: string;
}>;

type QuestionBase<Field extends SetupField, Value> = Readonly<{
	field: Field;
	label: string;
	flag: string;
	defaultValue: Value;
}>;

export type OpenQuestion =
	| (QuestionBase<'prefix', string> &
			Readonly<{
				kind: 'text';
				help: 'keep it unique across your repos';
			}>)
	| (QuestionBase<'tmux', boolean> &
			Readonly<{kind: 'boolean'; installed: boolean}>)
	| (QuestionBase<'agents', readonly AgentId[]> &
			Readonly<{
				kind: 'multi-select';
				maximum: typeof maximumAgents;
				/** Installed agents only; an uninstalled one cannot be chosen. */
				options: readonly AgentOption[];
			}>)
	| (QuestionBase<'copyIgnored', boolean> & Readonly<{kind: 'boolean'}>)
	| (QuestionBase<'mcAlias', boolean> & Readonly<{kind: 'boolean'}>);

type ResolutionDetails = Readonly<{
	draft: Settings;
	questions: readonly OpenQuestion[];
	sources: Readonly<Record<SetupField, ValueSource>>;
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

type Sources = Record<SetupField, ValueSource>;

type SelectedValues = Readonly<{
	values: Values;
	sources: Sources;
	/** Fields whose value is settled, so the form must not ask about them. */
	answered: Record<SetupField, boolean>;
}>;

/** Agents that are installed here, in the order they are offered. */
export function installedAgents(
	tools: Pick<ToolProbe, 'agents'>,
): readonly AgentId[] {
	return Object.freeze(
		agentIds.filter(id => tools.agents[id].path !== undefined),
	);
}

/** Resolve a setup without reading the terminal or filesystem. */
export function resolve(options: ResolveOptions): Resolution {
	const installed = installedAgents(options.tools);
	const flags = parseFlags(options.flags ?? {}, installed);
	const answers = validateValues(options.answers ?? {}, installed);
	const selected = selectValues(flags, answers, builtInValues(options));

	normalizeDependencies(selected, flags);

	const questions = options.acceptDefaults
		? []
		: setupFieldOrder
				.filter(field => shouldAsk(field, selected, installed))
				.map(field => questionFor(field, selected, options, installed));
	const draft = createSettings(options, selected.values);
	const sources = Object.freeze({...selected.sources});

	if (questions.length > 0) {
		return Object.freeze({
			kind: 'questions',
			draft,
			questions: Object.freeze(questions),
			sources,
		});
	}

	assertSettings(draft);
	return Object.freeze({
		kind: 'complete',
		settings: draft,
		draft,
		questions: Object.freeze([]),
		sources,
	});
}

/** Maps Meow's names onto the names used by Settings. */
export function setupFlagsFromCli(flags: CliFlags): SetupFlags {
	return Object.freeze({
		prefix: flags.prefix,
		tmux: flags.tmux,
		agents: flags.agents,
		copyIgnored: flags.copyIgnored,
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
	return {
		prefix: initials(options.fixed.repoName),
		tmux: settingsDefaults.tmux,
		agents: settingsDefaults.agents,
		copyIgnored: settingsDefaults.copyIgnored,
		mcAlias: settingsDefaults.mcAlias,
	};
}

function selectValues(
	flags: Partial<SetupValues>,
	answers: Partial<SetupValues>,
	defaults: Values,
): SelectedValues {
	const values: Values = {...defaults};
	const sources = Object.fromEntries(
		setupFieldOrder.map(field => [field, 'built-in']),
	) as Sources;
	const answered = Object.fromEntries(
		setupFieldOrder.map(field => [field, false]),
	) as Record<SetupField, boolean>;

	for (const field of setupFieldOrder) {
		if (hasValue(flags, field)) {
			setSelected(field, flags[field]!, 'flag', true);
		} else if (hasValue(answers, field)) {
			setSelected(field, answers[field]!, 'answer', true);
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

/** Agents live inside the tmux session, so turning tmux off turns them off. */
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
}

function shouldAsk(
	field: SetupField,
	selected: SelectedValues,
	installed: readonly AgentId[],
): boolean {
	if (selected.answered[field]) {
		return false;
	}

	// With no installed agent there is nothing to choose from.
	if (field === 'agents') {
		return selected.values.tmux && installed.length > 0;
	}

	return true;
}

function questionFor(
	field: SetupField,
	selected: SelectedValues,
	options: ResolveOptions,
	installed: readonly AgentId[],
): OpenQuestion {
	switch (field) {
		case 'prefix': {
			return Object.freeze({
				field,
				kind: 'text',
				label: 'prefix',
				flag: '--prefix',
				defaultValue: selected.values.prefix,
				help: 'keep it unique across your repos',
			});
		}

		case 'tmux': {
			return Object.freeze({
				field,
				kind: 'boolean',
				label: 'tmux session',
				flag: '--tmux/--no-tmux',
				defaultValue: selected.values.tmux,
				installed: options.tools.tmux.path !== undefined,
			});
		}

		case 'agents': {
			return Object.freeze({
				field,
				kind: 'multi-select',
				label: 'agents',
				flag: '--agents',
				defaultValue: Object.freeze([...selected.values.agents]),
				maximum: maximumAgents,
				options: Object.freeze(
					installed.map(id => Object.freeze({id, command: agentCommands[id]})),
				),
			});
		}

		case 'copyIgnored': {
			return Object.freeze({
				field,
				kind: 'boolean',
				label: 'copy-ignored',
				flag: '--copy/--no-copy',
				defaultValue: selected.values.copyIgnored,
			});
		}

		case 'mcAlias': {
			return Object.freeze({
				field,
				kind: 'boolean',
				label: 'mc alias',
				flag: '--mc/--no-mc',
				defaultValue: selected.values.mcAlias,
			});
		}
	}
}

function createSettings(options: ResolveOptions, values: Values): Settings {
	return Object.freeze({
		trunkVersion: options.fixed.trunkVersion,
		generatedOn: options.fixed.generatedOn,
		prefix: values.prefix,
		tmux: values.tmux,
		agents: Object.freeze([...values.agents]),
		copyIgnored: values.copyIgnored,
		mcAlias: values.mcAlias,
	});
}

function parseFlags(
	flags: SetupFlags,
	installed: readonly AgentId[],
): Partial<SetupValues> {
	const values: {-readonly [Field in keyof SetupValues]?: SetupValues[Field]} =
		{};
	if (flags.prefix !== undefined) {
		values.prefix = flags.prefix;
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

	if (flags.mcAlias !== undefined) {
		values.mcAlias = flags.mcAlias;
	}

	return validateValues(values, installed);
}

function validateValues(
	values: Partial<SetupValues>,
	installed: readonly AgentId[],
): Partial<SetupValues> {
	if (values.prefix !== undefined) {
		const result = validatePrefix(values.prefix);
		if (!result.valid) {
			throw new TypeError(result.reason);
		}
	}

	if (values.agents === undefined) {
		return values;
	}

	const agents = validateAgents(values.agents);
	const missing = agents.filter(id => !installed.includes(id));
	if (missing.length > 0) {
		throw new TypeError(
			`${missing.map(id => `${id} (${agentCommands[id]})`).join(', ')} ${
				missing.length === 1 ? 'is' : 'are'
			} not installed; only installed agents can be chosen.`,
		);
	}

	return {...values, agents};
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

	// Canonical order, so the same selection always generates the same file.
	const selected = new Set(values);
	return Object.freeze(agentIds.filter(id => selected.has(id)));
}

function questionArgument(question: OpenQuestion): string {
	switch (question.field) {
		case 'prefix': {
			return `--prefix=${question.defaultValue}`;
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
