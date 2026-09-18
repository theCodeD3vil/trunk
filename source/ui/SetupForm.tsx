/* eslint-disable unicorn/filename-case -- Phase 3 specifies SetupForm.tsx. */
/** The only interactive surface in trunk: setup fields followed by a preview. */
import {spawn} from 'node:child_process';
import process from 'node:process';
import React, {useRef, useState} from 'react';
import {Box, Text, render, useApp, useInput} from 'ink';
import {agentIds, maximumAgents, type AgentId} from '../core/agents.js';
import {
	buildRerunCommand,
	resolve,
	setupFieldOrder,
	type ResolveOptions,
	type SetupField,
	type SetupValues,
} from '../core/resolve.js';
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
	| Readonly<{kind: 'aborted'}>;

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
	installCaddy?: (
		executable: string,
		arguments_: readonly string[],
	) => Promise<boolean>;
	report?: (line: string) => void;
	/** Injectable so the abort and submit paths are testable without a TTY. */
	runForm?: (
		properties: Omit<SetupFormProperties, 'onSubmit' | 'onAbort'>,
	) => Promise<SetupFormOutcome>;
	/** Injectable for the same reason as {@link CollectSettingsOptions.runForm}. */
	askInstall?: () => Promise<InstallAnswer>;
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

			case 'pm': {
				return (
					<Select
						key={field}
						label="package manager"
						options={[
							{value: 'npm', label: 'npm'},
							{value: 'pnpm', label: 'pnpm'},
							{value: 'bun', label: 'bun'},
						]}
						value={values.pm}
						isActive={active}
						note={
							options.packageDetection?.needsConfirmation
								? 'confirm'
								: undefined
						}
						onChange={value => {
							update('pm', value);
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
					options.tools?.tmux.path ? undefined : 'not installed',
				);
			}

			case 'agents': {
				return (
					<MultiSelect<AgentId>
						key={field}
						label="agents"
						options={agentIds.map(id => ({
							value: id,
							label: id,
							note: options.tools?.agents[id].path
								? undefined
								: 'not installed',
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

			case 'server': {
				return booleanField(field, 'dev server', values.server);
			}

			case 'caddy': {
				const missing = options.tools?.caddy.path === undefined;
				return booleanField(
					field,
					missing ? 'include anyway' : 'Caddy route',
					values.caddy,
					missing ? '(teammates may have it)' : undefined,
				);
			}

			case 'mcAlias': {
				return booleanField(field, 'mc alias', values.mcAlias);
			}
		}
	}

	function booleanField(
		field: 'tmux' | 'copyIgnored' | 'server' | 'caddy' | 'mcAlias',
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
	return outcome ?? {kind: 'aborted'};
}

/** Chooses the headless path or mounts the form, including the Caddy branch. */
export async function collectSettings({
	folder,
	resolveOptions,
	invocation,
	yes = false,
	interactive = Boolean(process.stdin.isTTY),
	randomPrefix,
	installCaddy = streamCaddyInstall,
	report = line => {
		process.stderr.write(`${line}\n`);
	},
	runForm = runSetupForm,
	askInstall = askToInstallCaddy,
}: CollectSettingsOptions): Promise<CollectSettingsResult> {
	let options: ResolveOptions = {...resolveOptions, acceptDefaults: yes};
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
		const rerun = buildRerunCommand(
			invocation.executable,
			invocation.arguments,
			resolution,
		);
		return {
			kind: 'outcome',
			outcome: badUsage(
				`Interactive setup requires a TTY. Re-run with --yes, or specify the missing flags:\n  ${rerun.display}`,
			),
		};
	}

	const caddy = resolution.questions.find(
		(question): question is Extract<typeof question, {field: 'caddy'}> =>
			question.field === 'caddy',
	);
	if (caddy?.availability.kind === 'brew-installable') {
		const answer = await askInstall();
		if (answer === 'abort') {
			return {kind: 'outcome', outcome: userAborted()};
		}

		if (answer === 'yes') {
			let installed = false;
			try {
				installed = await installCaddy(
					caddy.availability.executable,
					caddy.availability.arguments,
				);
			} catch {
				// A missing/broken Brew process is the same as a non-zero install.
			}

			if (installed) {
				options = withCaddyInstalled(options);
				resolution = resolve(options);
			} else {
				report('brew install caddy failed; continuing without it.');
				report(caddyInstallUrl());
			}
		} else {
			report(caddyInstallUrl());
		}
	} else if (caddy?.availability.kind === 'missing') {
		report(caddy.availability.installUrl);
	}

	if (resolution.kind === 'complete') {
		return {kind: 'settings', settings: resolution.settings};
	}

	const form = await runForm({folder, options, randomPrefix});
	return form.kind === 'settings'
		? form
		: {kind: 'outcome', outcome: userAborted()};
}

export type InstallAnswer = 'yes' | 'no' | 'abort';

function CaddyInstallPrompt({
	onAnswer,
}: Readonly<{onAnswer: (answer: InstallAnswer) => void}>): React.ReactElement {
	const {exit} = useApp();
	const answered = useRef(false);
	useInput((input, key) => {
		let answer: InstallAnswer | undefined;
		if (key.ctrl && input === 'c') {
			answer = 'abort';
		} else if (key.return || input.toLowerCase() === 'y') {
			answer = 'yes';
		} else if (input.toLowerCase() === 'n') {
			answer = 'no';
		}

		if (!answer || answered.current) {
			return;
		}

		answered.current = true;
		onAnswer(answer);
		exit();
	});

	return (
		<Text>
			? caddy not found. Install with &apos;brew install caddy&apos;? (Y/n)
		</Text>
	);
}

async function askToInstallCaddy(): Promise<InstallAnswer> {
	let answer: InstallAnswer = 'abort';
	const app = render(
		<CaddyInstallPrompt
			onAnswer={value => {
				answer = value;
			}}
		/>,
		{exitOnCtrlC: false},
	);
	await app.waitUntilExit();
	app.cleanup();
	return answer;
}

async function streamCaddyInstall(
	executable: string,
	arguments_: readonly string[],
): Promise<boolean> {
	return new Promise(resolve => {
		// Inherited stdio: the user watches Brew's own progress output.
		const child = spawn(executable, [...arguments_], {stdio: 'inherit'});
		child.once('error', () => {
			resolve(false);
		});
		child.once('close', code => {
			resolve(code === 0);
		});
	});
}

function withCaddyInstalled(options: ResolveOptions): ResolveOptions {
	if (!options.tools) {
		return options;
	}

	return {
		...options,
		tools: {
			...options.tools,
			caddy: Object.freeze({name: 'caddy', path: 'caddy'}),
		},
	};
}

function visibleSetupFields(
	values: SetupValues,
	options: ResolveOptions,
): SetupField[] {
	return setupFieldOrder.filter(field => {
		if (provided(field, options)) {
			return false;
		}

		return !(
			(field === 'agents' && !values.tmux) ||
			(field === 'caddy' && !values.server)
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
		pm: settings.pm,
		tmux: settings.tmux,
		agents: settings.agents,
		copyIgnored: settings.copyIgnored,
		server: settings.server,
		caddy: settings.caddy,
		mcAlias: settings.mcAlias,
	};
}

function caddyInstallUrl(): string {
	return 'https://caddyserver.com/docs/install';
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
