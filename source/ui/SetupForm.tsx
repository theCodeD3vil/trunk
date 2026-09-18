/* eslint-disable unicorn/filename-case -- React components use PascalCase file names. */
/** The only interactive surface in trunk: setup fields followed by a preview. */
import React, {useRef, useState} from 'react';
import {Box, Text, render, useApp, useInput} from 'ink';
import {maximumAgents, type AgentId} from '../core/agents.js';
import {
	buildRerunCommand,
	installedAgents,
	resolve,
	setupFieldOrder,
	type NeedsInputResolution,
	type ResolveOptions,
	type SetupField,
	type SetupValues,
} from '../core/resolve.js';
import {supportsInteractiveInput} from '../core/platform.js';
import {validatePrefix} from '../core/prefix.js';
import {badUsage, userAborted, type Outcome} from '../core/result.js';
import {randomWord} from '../core/words.js';
import Summary from './Summary.js';
import MultiSelect from './fields/MultiSelect.js';
import Select from './fields/Select.js';
import TextInput from './fields/TextInput.js';

export type SetupFormProperties = Readonly<{
	folder: string;
	options: ResolveOptions;
	randomPrefix?: () => string;
	onSubmit: (settings: SetupValuesResult) => void;
	onAbort: () => void;
}>;

type SetupValuesResult = Extract<
	ReturnType<typeof resolve>,
	{kind: 'complete'}
>['settings'];

export type SetupFormOutcome =
	| Readonly<{kind: 'settings'; settings: SetupValuesResult}>
	| Readonly<{kind: 'aborted'}>
	/** The terminal could not run the form, so the caller falls back to flags. */
	| Readonly<{kind: 'unavailable'; reason: string}>;

export type CollectSettingsResult =
	| Readonly<{kind: 'settings'; settings: SetupValuesResult}>
	| Readonly<{kind: 'outcome'; outcome: Outcome}>;

export type CollectSettingsOptions = Readonly<{
	folder: string;
	resolveOptions: ResolveOptions;
	invocation: Readonly<{executable: string; arguments: readonly string[]}>;
	yes?: boolean;
	interactive?: boolean;
	randomPrefix?: () => string;
	/** Injectable so the abort and submit paths are testable without a TTY. */
	runForm?: (
		properties: Omit<SetupFormProperties, 'onSubmit' | 'onAbort'>,
	) => Promise<SetupFormOutcome>;
}>;

const onOffOptions = Object.freeze([
	Object.freeze({value: 'on', label: 'on'}),
	Object.freeze({value: 'off', label: 'off'}),
]);

export default function SetupForm({
	folder,
	options,
	randomPrefix = randomWord,
	onSubmit,
	onAbort,
}: SetupFormProperties): React.ReactElement {
	const {exit} = useApp();
	const finished = useRef(false);
	const [values, setValues] = useState<SetupValues>(() =>
		valuesFromSettings(resolve({...options, acceptDefaults: false}).draft),
	);
	const [activeField, setActiveField] = useState<SetupField>(() =>
		firstVisibleField(values, options),
	);
	const [summary, setSummary] = useState<SetupValuesResult>();
	const [formError, setFormError] = useState<string>();
	const visibleFields = visibleSetupFields(values, options);

	useInput((input, key) => {
		if (key.ctrl && input === 'c') {
			abort();
		}
	});

	if (summary) {
		return (
			<Summary
				folder={folder}
				settings={summary}
				onConfirm={() => {
					if (finished.current) {
						return;
					}

					finished.current = true;
					onSubmit(summary);
					exit();
				}}
				onBack={() => {
					setSummary(undefined);
					setActiveField(visibleFields.at(-1) ?? 'prefix');
				}}
				onAbort={abort}
			/>
		);
	}

	return (
		<Box flexDirection="column" width="100%">
			<Text bold>Configure worktree setup</Text>
			<Box marginTop={1}>
				<Text dimColor>{'  folder'.padEnd(20)}</Text>
				<Text wrap="truncate-end">{folder}</Text>
			</Box>
			<Box flexDirection="column" marginTop={1}>
				{visibleFields.map(field => renderField(field))}
			</Box>
			{formError ? (
				<Box marginTop={1}>
					<Text color="red">{formError}</Text>
				</Box>
			) : null}
			<Box marginTop={1}>
				<Text dimColor>
					arrows choose · space checks · Enter continues · Ctrl+C aborts
				</Text>
			</Box>
		</Box>
	);

	function renderField(field: SetupField): React.ReactElement {
		const active = field === activeField;
		switch (field) {
			case 'prefix': {
				const validation = validatePrefix(values.prefix);
				return (
					<TextInput
						key={field}
						label="prefix"
						value={values.prefix}
						isActive={active}
						help="keep it unique across your repos"
						validationError={validation.valid ? undefined : validation.reason}
						randomValue={randomPrefix}
						onChange={value => {
							update('prefix', value);
						}}
						onSubmit={() => {
							advance(field);
						}}
					/>
				);
			}

			case 'tmux': {
				return booleanField(
					field,
					'tmux session',
					values.tmux,
					options.tools.tmux.path ? undefined : 'not installed',
				);
			}

			case 'agents': {
				return (
					<MultiSelect<AgentId>
						key={field}
						label="agents"
						// Only installed agents are offered; an absent one cannot be picked.
						options={installedAgents(options.tools).map(id => ({
							value: id,
							label: id,
						}))}
						value={values.agents}
						maximum={maximumAgents}
						isActive={active}
						onChange={value => {
							update('agents', value);
						}}
						onSubmit={() => {
							advance(field);
						}}
					/>
				);
			}

			case 'copyIgnored': {
				return booleanField(field, 'copy-ignored', values.copyIgnored);
			}

			case 'mcAlias': {
				return booleanField(field, 'mc alias', values.mcAlias);
			}
		}
	}

	function booleanField(
		field: 'tmux' | 'copyIgnored' | 'mcAlias',
		label: string,
		value: boolean,
		note?: string,
	): React.ReactElement {
		return (
			<Select
				key={field}
				label={label}
				options={onOffOptions}
				value={value ? 'on' : 'off'}
				isActive={field === activeField}
				note={note}
				onChange={next => {
					update(field, next === 'on');
				}}
				onSubmit={() => {
					advance(field);
				}}
			/>
		);
	}

	function update<Field extends SetupField>(
		field: Field,
		value: SetupValues[Field],
	): void {
		setValues(current => ({...current, [field]: value}));
		setFormError(undefined);
	}

	function advance(field: SetupField): void {
		const fields = visibleSetupFields(values, options);
		const next = fields[fields.indexOf(field) + 1];
		if (next) {
			setActiveField(next);
			return;
		}

		try {
			const resolution = resolve({
				...options,
				acceptDefaults: false,
				answers: {...options.answers, ...values},
			});
			if (resolution.kind === 'questions') {
				setActiveField(resolution.questions[0]?.field ?? 'prefix');
				setFormError('Answer every visible field before continuing.');
				return;
			}

			setSummary(resolution.settings);
		} catch (error: unknown) {
			setFormError(errorMessage(error));
		}
	}

	function abort(): void {
		if (finished.current) {
			return;
		}

		finished.current = true;
		onAbort();
		exit();
	}
}

/** Mounts Ink with Ctrl+C routed through the form's normal abort result. */
export async function runSetupForm(
	properties: Omit<SetupFormProperties, 'onSubmit' | 'onAbort'>,
): Promise<SetupFormOutcome> {
	let outcome: SetupFormOutcome | undefined;
	if (!supportsInteractiveInput()) {
		return {
			kind: 'unavailable',
			reason: 'stdin is not an interactive terminal',
		};
	}

	try {
		const app = render(
			<SetupForm
				{...properties}
				onSubmit={settings => {
					outcome = {kind: 'settings', settings};
				}}
				onAbort={() => {
					outcome = {kind: 'aborted'};
				}}
			/>,
			{exitOnCtrlC: false},
		);
		await app.waitUntilExit();
		app.cleanup();
	} catch (error: unknown) {
		// Ink throws from inside React when raw mode turns out to be unusable,
		// which would otherwise reach the user as a component stack.
		return {kind: 'unavailable', reason: errorMessage(error)};
	}

	return outcome ?? {kind: 'aborted'};
}

/** Chooses the headless path or mounts the form. */
export async function collectSettings({
	folder,
	resolveOptions,
	invocation,
	yes = false,
	interactive = supportsInteractiveInput(),
	randomPrefix,
	runForm = runSetupForm,
}: CollectSettingsOptions): Promise<CollectSettingsResult> {
	const options: ResolveOptions = {...resolveOptions, acceptDefaults: yes};
	let resolution: ReturnType<typeof resolve>;
	try {
		resolution = resolve(options);
	} catch (error: unknown) {
		return {kind: 'outcome', outcome: badUsage(errorMessage(error))};
	}

	if (resolution.kind === 'complete') {
		return {kind: 'settings', settings: resolution.settings};
	}

	if (!interactive) {
		return {
			kind: 'outcome',
			outcome: badUsage(missingInputMessage(resolution, invocation)),
		};
	}

	const form = await runForm({folder, options, randomPrefix});
	if (form.kind === 'settings') {
		return form;
	}

	if (form.kind === 'unavailable') {
		return {
			kind: 'outcome',
			outcome: badUsage(
				missingInputMessage(resolution, invocation, form.reason),
			),
		};
	}

	return {kind: 'outcome', outcome: userAborted()};
}

/**
 * What to say when the questions cannot be asked: the exact command that
 * answers them, rather than a complaint about the terminal.
 */
function missingInputMessage(
	resolution: NeedsInputResolution,
	invocation: CollectSettingsOptions['invocation'],
	reason?: string,
): string {
	const rerun = buildRerunCommand(
		invocation.executable,
		invocation.arguments,
		resolution,
	);
	const cause = reason
		? `Interactive setup needs a terminal that can read keys (${reason}).`
		: 'Interactive setup requires a TTY.';
	return `${cause} Re-run with --yes, or specify the missing flags:\n  ${rerun.display}`;
}

function visibleSetupFields(
	values: SetupValues,
	options: ResolveOptions,
): SetupField[] {
	return setupFieldOrder.filter(field => {
		if (provided(field, options)) {
			return false;
		}

		// Agents need a tmux session and at least one installed agent to pick.
		return !(
			field === 'agents' &&
			(!values.tmux || installedAgents(options.tools).length === 0)
		);
	});
}

function firstVisibleField(
	values: SetupValues,
	options: ResolveOptions,
): SetupField {
	return visibleSetupFields(values, options)[0] ?? 'prefix';
}

function provided(field: SetupField, options: ResolveOptions): boolean {
	if (Object.hasOwn(options.answers ?? {}, field)) {
		return true;
	}

	const {flags} = options;
	if (!flags) {
		return false;
	}

	const value = flags[field];
	return value !== undefined;
}

function valuesFromSettings(settings: SetupValuesResult): SetupValues {
	return {
		prefix: settings.prefix,
		tmux: settings.tmux,
		agents: settings.agents,
		copyIgnored: settings.copyIgnored,
		mcAlias: settings.mcAlias,
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
