/**
 * What the setup commands need from an interactive terminal UI, and nothing
 * about how it is drawn. `clone` and `init` describe their work to a Session and
 * await its answers; the Ink implementation lives under `ui/` and is only ever
 * loaded through `importInteractive`. A method that asks the user returns
 * `undefined` when they cancel, which the caller turns into an aborted run.
 */
import type {AgentId} from './agents.js';
import type {SetupField, SetupValues} from './resolve.js';
import type {Settings} from './settings.js';

export type ConfigureRequest = Readonly<{
	command: 'clone' | 'init';
	/** The right side of the header: owner/repo when known, else the folder name. */
	project: string;
	/** Seeds nothing here; it names the project in titles and the layout tree. */
	rootName: string;
	/** Where the project lives, for display. */
	destination: string;
	/** Known for `init`; a clone only learns it after cloning. */
	defaultBranch?: string;
	/** Commit on the default branch instead of a setup branch. */
	direct: boolean;
	/** The answers to start from, with any flags already applied. */
	values: SetupValues;
	/** Fields a flag already settled, mapped to the flag that did it. */
	fromFlags: Readonly<Partial<Record<SetupField, string>>>;
	installedAgents: readonly AgentId[];
	missingAgents: readonly AgentId[];
	tmuxInstalled: boolean;
	/** Turns answers into Settings, throwing when they are not valid. */
	toSettings: (values: SetupValues) => Settings;
}>;

export type StepDefinition = Readonly<{
	id: string;
	label: string;
	detail: string;
}>;
export type StepStatus = 'active' | 'done' | 'skipped' | 'failed';

export type OverwriteRequest = Readonly<{
	command: 'clone' | 'init';
	project: string;
	path: string;
	existing: string;
	generated: string;
}>;

export type NextStep = Readonly<{command: string; note?: string}>;

export type FinishRequest = Readonly<{
	command: 'clone' | 'init';
	project: string;
	title: string;
	next: readonly NextStep[];
	/** Warnings shown under the card. */
	notes: readonly string[];
	/** When set, the user is asked whether to push this branch. */
	push?: Readonly<{branch: string; label: string}>;
}>;

export type FailureRequest = Readonly<{
	command: 'clone' | 'init';
	project: string;
	title: string;
	/** What went wrong, as wt or git said it. */
	detail: string;
	/** What this run created, so the user can decide what to keep. */
	created: ReadonlyArray<Readonly<{path: string; description: string}>>;
	resume: string;
	/** Whether there is anything to roll back. */
	rollback: boolean;
}>;

/** A line under the result card. `plain` lines are instructions, with no tick or cross. */
export type ResultLine = Readonly<{ok: boolean; text: string; plain?: boolean}>;

export type Session = Readonly<{
	/** Asks the five questions and the review. `undefined` means cancelled. */
	configure: (request: ConfigureRequest) => Promise<Settings | undefined>;
	start: (
		steps: readonly StepDefinition[],
		command: 'clone' | 'init',
		project: string,
	) => void;
	update: (id: string, status: StepStatus, detail?: string) => void;
	overwrite: (
		request: OverwriteRequest,
	) => Promise<'keep' | 'replace' | undefined>;
	finish: (request: FinishRequest) => Promise<'push' | 'skip' | undefined>;
	/** Adds outcome lines under the result card, such as a pushed branch. */
	result: (lines: readonly ResultLine[]) => void;
	fail: (request: FailureRequest) => Promise<'keep' | 'rollback' | undefined>;
	/** True once the user pressed Ctrl+C; the run should stop at its next step. */
	aborted: () => boolean;
	close: () => Promise<void>;
}>;

/** A refusal to start: shown as a card in a terminal, and as plain lines otherwise. */
export type Refusal =
	| Readonly<{
			kind: 'missing-tools';
			missing: readonly string[];
			command: string;
	  }>
	| Readonly<{
			kind: 'normal-clone';
			name: string;
			url: string;
			unsaved: readonly string[];
	  }>
	| Readonly<{kind: 'empty-repository'; name: string; rerun: string}>;

/** Everything the commands may ask of the terminal UI, loaded only in a terminal. */
export type TerminalUi = Readonly<{
	session: () => Promise<Session>;
	refuse: (refusal: Refusal) => Promise<void>;
	welcome: (version: string) => Promise<void>;
}>;

export type TerminalUiFactory = () => Promise<TerminalUi>;
