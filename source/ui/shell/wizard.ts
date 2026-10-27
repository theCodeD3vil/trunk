/**
 * The setup wizard as plain data: which step is open, what has been answered,
 * and what a key does. One step is open at a time; the rail on the left shows
 * them all. Nothing here draws or reads the clock, so each rule can be checked
 * by feeding it keys. A rule that deserves a flourish, such as a shake or a
 * toast, says so with an event and leaves how it looks to the view.
 */
import {agentIds, maximumAgents, type AgentId} from '../../core/agents.js';
import {validatePrefix} from '../../core/prefix.js';
import type {SetupField, SetupValues} from '../../core/resolve.js';
import type {ConfigureRequest} from '../../core/session.js';

export type Stage = SetupField | 'review';

/** Every stage in the order they come, whether or not this run asks for it. */
export const stageOrder: readonly Stage[] = [
	'prefix',
	'tmux',
	'agents',
	'copyIgnored',
	'mcAlias',
	'review',
];

export const labels: Readonly<Record<SetupField, string>> = {
	prefix: 'Session prefix',
	tmux: 'tmux workspace',
	agents: 'Agents',
	copyIgnored: 'Copy ignored files',
	mcAlias: 'wt mc alias',
};

export const help: Readonly<Record<SetupField, string>> = {
	prefix:
		'Names tmux sessions prefix_branch. It must be unique across your repositories.',
	tmux: 'Opens each worktree in a tmux session with an Editor and a Terminal window.',
	agents: `Pick up to ${maximumAgents}. Each gets a pane in an Agents window.`,
	copyIgnored:
		'Copies git-ignored files, such as caches and local config, into new worktrees.',
	mcAlias:
		'Adds wt mc, which merges with a commit message you write in $EDITOR.',
};

/** What each of the two answers to a yes-or-no question means. */
export const answers: Readonly<
	Record<Exclude<SetupField, 'prefix' | 'agents'>, readonly [string, string]>
> = {
	tmux: [
		'Each worktree gets a tmux session with an Editor and a Terminal window.',
		'No tmux session. Worktrees are plain directories.',
	],
	copyIgnored: [
		'Copy git-ignored files into each new worktree.',
		'Copy nothing. New worktrees start clean.',
	],
	mcAlias: ['Add the alias.', 'No alias. Use wt merge.'],
};

/** `open` is asked, `fixed` was settled by a flag, `skipped` has nothing to ask. */
export type Availability = 'open' | 'fixed' | 'skipped';

export function availability(
	request: ConfigureRequest,
	values: SetupValues,
	field: SetupField,
): Availability {
	if (
		field === 'agents' &&
		!(values.tmux && request.installedAgents.length > 0)
	) {
		return 'skipped';
	}

	return request.fromFlags[field] === undefined ? 'open' : 'fixed';
}

/** The stages the user walks through now, ending with the review. */
export function openStages(
	request: ConfigureRequest,
	values: SetupValues,
): Stage[] {
	return stageOrder.filter(
		stage =>
			stage === 'review' || availability(request, values, stage) === 'open',
	);
}

export type Wizard = Readonly<{
	stage: Stage;
	/** The furthest stage reached, as an index into `stageOrder`. */
	furthest: number;
	values: SetupValues;
	/** Where the caret sits in the prefix. */
	caret: number;
	/** The agent under the cursor, as an index into `agentIds`. */
	agent: number;
}>;

export function initialWizard(request: ConfigureRequest): Wizard {
	const stage = openStages(request, request.values)[0] ?? 'review';
	return {
		stage,
		furthest: stageOrder.indexOf(stage),
		values: request.values,
		caret: request.values.prefix.length,
		agent: 0,
	};
}

export type StepStatus = 'todo' | 'active' | 'done' | 'skipped';

export function stepStatus(
	request: ConfigureRequest,
	wizard: Wizard,
	stage: Stage,
): StepStatus {
	if (stage !== 'review') {
		const where = availability(request, wizard.values, stage);
		if (where === 'skipped') {
			return 'skipped';
		}

		if (where === 'fixed') {
			return 'done';
		}
	}

	const index = stageOrder.indexOf(stage);
	return stage === wizard.stage
		? 'active'
		: index <= wizard.furthest
		? 'done'
		: 'todo';
}

/** The one-line answer shown under a step in the rail and in the review. */
export function summary(values: SetupValues, field: SetupField): string {
	if (field === 'prefix') {
		return values.prefix === '' ? '(empty)' : values.prefix;
	}

	if (field === 'agents') {
		return values.agents.length > 0 ? values.agents.join(', ') : 'none';
	}

	return values[field] ? 'on' : 'off';
}

/** Whether an answer is still what the run started with. */
export function isDefault(
	request: ConfigureRequest,
	values: SetupValues,
	field: SetupField,
): boolean {
	return field === 'agents'
		? values.agents.join(',') === request.values.agents.join(',')
		: values[field] === request.values[field];
}

/** What a stage says it is, above its title: `Step 2 of 5`, or where the run stands. */
export function eyebrow(
	request: ConfigureRequest,
	wizard: Wizard,
	stage: Stage = wizard.stage,
): string {
	if (stage === 'review') {
		return 'Ready';
	}

	const open = openStages(request, wizard.values).filter(
		entry => entry !== 'review',
	);
	return `Step ${open.indexOf(stage) + 1} of ${open.length}`;
}

/** The command that does the same thing without the form, as the review shows it. */
export function scriptCommand(
	request: ConfigureRequest,
	values: SetupValues,
): string {
	const quote = (value: string): string =>
		/^[\w@%+=:,./-]+$/.test(value)
			? value
			: `'${value.replaceAll("'", "'\\''")}'`;
	const destination = request.commandDestination ?? request.destination;
	const parts = ['trunk-cli', request.command];
	if (request.command === 'clone' && request.source !== undefined) {
		parts.push(request.source);
	}

	parts.push(
		destination,
		'--yes',
		'--prefix',
		values.prefix === '' ? '…' : values.prefix,
	);
	if (!values.tmux) {
		parts.push('--no-tmux');
	}

	if (values.agents.length > 0) {
		parts.push('--agents', values.agents.join(','));
	}

	if (values.copyIgnored) {
		parts.push('--copy');
	}

	if (!values.mcAlias) {
		parts.push('--no-mc');
	}

	if (request.direct) {
		parts.push('--direct');
	}

	return parts.map(part => quote(part)).join(' ');
}

/** What the view should make a fuss of. The rules decide when; the view decides how. */
export type Event =
	| Readonly<{kind: 'shake'; target: string}>
	| Readonly<{kind: 'toast'; text: string; tone?: 'warn'}>
	| Readonly<{kind: 'pop'; target: string}>
	| Readonly<{kind: 'copy'; text: string; target: string}>;

export type WizardStep = Readonly<{
	state: Wizard;
	events: readonly Event[];
	/** The review was confirmed: the answers are final. */
	create?: boolean;
}>;

const typed = (key: string): boolean => [...key].length === 1 && key >= ' ';

/** Most characters the prefix field takes; validation says when it is too long. */
const prefixRoom = 30;

/** The prefix the form started from, which is the one it suggests. */
export const suggestedPrefix = (request: ConfigureRequest): string =>
	request.values.prefix;

export function wizardKey(
	request: ConfigureRequest,
	wizard: Wizard,
	key: string,
): WizardStep {
	const {values, stage} = wizard;
	const events: Event[] = [];
	const move = (to: Partial<Wizard>): WizardStep => ({
		state: {...wizard, ...to},
		events,
	});
	const set = (
		next: Partial<SetupValues>,
		to: Partial<Wizard> = {},
	): WizardStep => move({values: {...values, ...next}, ...to});
	const shake = (target: string, text?: string, tone?: 'warn'): WizardStep => {
		events.push({kind: 'shake', target});
		if (text !== undefined) {
			events.push({kind: 'toast', text, tone});
		}

		return move({});
	};

	/** Opens a stage, and counts it as reached. */
	const show = (target: Stage): WizardStep =>
		move({
			stage: target,
			furthest: Math.max(wizard.furthest, stageOrder.indexOf(target)),
			caret: values.prefix.length,
		});

	const open = openStages(request, values);
	const at = open.indexOf(stage);

	const next = (): WizardStep => {
		if (stage === 'prefix' && !validatePrefix(values.prefix).valid) {
			return shake('field', 'Fix the session prefix first.', 'warn');
		}

		if (stage === 'review') {
			return {state: wizard, events, create: true};
		}

		return show(open[at + 1] ?? 'review');
	};

	const previous = (): WizardStep => {
		const before = open[at - 1];
		return before === undefined ? move({}) : show(before);
	};

	const jump = (target: Stage): WizardStep => {
		const rail = `step:${target}`;
		if (target !== 'review') {
			const where = availability(request, values, target);
			if (where === 'skipped') {
				return shake(
					rail,
					request.installedAgents.length === 0
						? 'No agents are installed on this machine.'
						: 'Agents need tmux. Turn it on first.',
					'warn',
				);
			}

			if (where === 'fixed') {
				return shake(
					rail,
					`${labels[target]} was set by ${
						request.fromFlags[target] ?? 'a flag'
					}.`,
					'warn',
				);
			}
		}

		if (stageOrder.indexOf(target) > wizard.furthest) {
			return shake(rail, 'Finish the earlier steps first.', 'warn');
		}

		if (target !== open[0] && !validatePrefix(values.prefix).valid) {
			return shake(rail, 'Fix the session prefix first.', 'warn');
		}

		return show(target);
	};

	if (key === 'enter' || key === 'go') {
		return next();
	}

	if (key === 'esc') {
		return previous();
	}

	if (key.startsWith('step:')) {
		return jump(key.slice('step:'.length) as Stage);
	}

	if (key.startsWith('edit:')) {
		return jump(key.slice('edit:'.length) as Stage);
	}

	if (key === 'suggest') {
		events.push({kind: 'toast', text: 'Back to the suggestion.'});
		return set(
			{prefix: suggestedPrefix(request)},
			{caret: suggestedPrefix(request).length},
		);
	}

	if (stage === 'prefix') {
		const {prefix} = values;
		const {caret} = wizard;
		if (key === 'left' || key === 'right') {
			return move({
				caret: Math.max(
					0,
					Math.min(prefix.length, caret + (key === 'left' ? -1 : 1)),
				),
			});
		}

		if (key === 'home' || key === 'end') {
			return move({caret: key === 'home' ? 0 : prefix.length});
		}

		if (key === 'backspace' && caret > 0) {
			return set(
				{prefix: prefix.slice(0, caret - 1) + prefix.slice(caret)},
				{caret: caret - 1},
			);
		}

		if (key === 'delete' && caret < prefix.length) {
			return set({prefix: prefix.slice(0, caret) + prefix.slice(caret + 1)});
		}

		if (typed(key) && prefix.length < prefixRoom) {
			return set(
				{prefix: prefix.slice(0, caret) + key + prefix.slice(caret)},
				{caret: caret + 1},
			);
		}

		return move({});
	}

	if (stage === 'agents') {
		const toggle = (index: number): WizardStep => {
			const name = agentIds[index];
			if (name === undefined) {
				return move({});
			}

			const row = `agent:${index}`;
			if (!request.installedAgents.includes(name)) {
				return shake(row, `${name} is not installed on this machine.`, 'warn');
			}

			if (values.agents.includes(name)) {
				return set({agents: values.agents.filter(entry => entry !== name)});
			}

			if (values.agents.length >= maximumAgents) {
				return shake(
					row,
					`You can pick up to ${maximumAgents} agents.`,
					'warn',
				);
			}

			// The same selection always generates the same file, so keep a fixed order.
			const chosen: readonly AgentId[] = agentIds.filter(
				entry => entry === name || values.agents.includes(entry),
			);
			events.push({kind: 'pop', target: row});
			return set({agents: chosen});
		};

		if (key === 'down' || key === 'up') {
			const to = wizard.agent + (key === 'down' ? 1 : -1);
			return move({agent: Math.max(0, Math.min(agentIds.length - 1, to))});
		}

		if (key === 'space') {
			return toggle(wizard.agent);
		}

		if (key.startsWith('agent:')) {
			const index = Number(key.slice('agent:'.length));
			const step = toggle(index);
			return {...step, state: {...step.state, agent: index}};
		}

		return move({});
	}

	if (stage === 'review') {
		if (key === 'c' || key === 'copy') {
			events.push({
				kind: 'copy',
				text: scriptCommand(request, values),
				target: 'copy',
			});
		}

		return move({});
	}

	// A yes-or-no step: left is on, right is off, space flips it.
	const field = stage;
	const to =
		key === 'left'
			? true
			: key === 'right'
			? false
			: key === 'space'
			? !values[field]
			: key.startsWith(`choice:${field}:`)
			? key.endsWith(':on')
			: undefined;
	if (to === undefined || values[field] === to) {
		return move({});
	}

	if (field === 'tmux' && !to && values.agents.length > 0) {
		events.push({
			kind: 'toast',
			text: 'Agents cleared. They need tmux.',
		});
	}

	// Agents live in the tmux session, so turning it off turns them off.
	return set(
		field === 'tmux' && !to ? {tmux: false, agents: []} : {[field]: to},
	);
}
