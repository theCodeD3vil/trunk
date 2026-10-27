/**
 * The run screen: named steps with timings and a progress bar while the work
 * happens, then a result card with numbered next steps and, when it applies, a
 * question about pushing. The state is plain data the session updates as the
 * setup code reports progress.
 */
import type {
	FinishRequest,
	PublishProblem,
	PublishRequest,
	PublishStatus,
	PublishStep,
	ResultLine,
	StepDefinition,
	StepStatus,
} from '../../core/session.js';
import {margin, type Kit, type Line, type Part} from '../kit/lines.js';

export type StepView = Readonly<{
	id: string;
	label: string;
	detail: string;
	status: 'pending' | StepStatus;
	startedAt?: number;
	endedAt?: number;
}>;

export type FinishView = Readonly<{
	request: FinishRequest;
	/** 0 pushes, 1 keeps it local. It starts on the safe answer. */
	sel: number;
	outcome: readonly ResultLine[];
	answered: boolean;
}>;

/** One line of the publish block: the push, or the pull request. */
export type PublishRow = Readonly<{
	id: PublishStep;
	label: string;
	detail: string;
	status: 'pending' | PublishStatus;
	startedAt?: number;
	endedAt?: number;
}>;

/** Pushing the setup branch, drawn under the result card in place of the question. */
export type PublishView = Readonly<{
	branch: string;
	/** Where it goes, such as `github.com:acme/storefront`. */
	destination: string;
	rows: readonly PublishRow[];
	/** A failure card with its question, until the user answers. */
	problem?: Readonly<{problem: PublishProblem; sel: number}>;
	/** What to do next, once the publish is over. */
	lines: readonly ResultLine[];
	ended: boolean;
	/** Ctrl+C was pressed and the command is being stopped. */
	stopping?: boolean;
}>;

export type RunState = Readonly<{
	command: 'clone' | 'init';
	project: string;
	steps: readonly StepView[];
	finish?: FinishView;
	publish?: PublishView;
	/** What happened after a failed run was kept or rolled back, shown under the steps. */
	outcome?: readonly ResultLine[];
	/** Ctrl+C was pressed: the run stops after the step in progress. */
	cancelling?: boolean;
}>;

export function initialRun(
	definitions: readonly StepDefinition[],
	command: 'clone' | 'init',
	project: string,
): RunState {
	return {
		command,
		project,
		steps: definitions.map(definition => ({...definition, status: 'pending'})),
	};
}

export function updateStep(
	state: RunState,
	id: string,
	status: StepStatus,
	now: number,
	detail?: string,
): RunState {
	return {
		...state,
		steps: state.steps.map(step => {
			if (step.id !== id) {
				return step;
			}

			return {
				...step,
				status,
				detail: detail ?? step.detail,
				// Marking a step active again restarts its clock, so time spent waiting
				// for an answer is not counted as work.
				startedAt: status === 'active' ? now : step.startedAt ?? now,
				endedAt: status === 'active' ? undefined : now,
			};
		}),
	};
}

export function startPublish(
	state: RunState,
	request: PublishRequest,
): RunState {
	const rows: PublishRow[] = [
		{
			id: 'push',
			label: 'Push to origin',
			detail: `${request.branch} \u2192 ${request.destination}`,
			status: 'pending',
		},
		...(request.withPullRequest
			? ([
					{
						id: 'pr',
						label: 'Open pull request',
						detail: 'gh pr create --fill',
						status: 'pending',
					},
			  ] as const)
			: []),
	];
	return {
		...state,
		publish: {
			branch: request.branch,
			destination: request.destination,
			rows,
			lines: [],
			ended: false,
		},
	};
}

export function updatePublish(
	state: RunState,
	step: PublishStep,
	status: PublishStatus,
	now: number,
	detail?: string,
): RunState {
	const {publish} = state;
	if (publish === undefined) {
		return state;
	}

	return {
		...state,
		publish: {
			...publish,
			// A retry clears the card the last failure left behind.
			problem: undefined,
			rows: publish.rows.map(row =>
				row.id === step
					? {
							...row,
							status,
							detail: detail ?? row.detail,
							startedAt: status === 'active' ? now : row.startedAt ?? now,
							endedAt: status === 'active' ? undefined : now,
					  }
					: row,
			),
		},
	};
}

export function askPublish(state: RunState, problem: PublishProblem): RunState {
	return state.publish === undefined
		? state
		: {...state, publish: {...state.publish, problem: {problem, sel: 0}}};
}

export function endPublish(
	state: RunState,
	lines: readonly ResultLine[],
): RunState {
	return state.publish === undefined
		? state
		: {
				...state,
				publish: {
					...state.publish,
					problem: undefined,
					stopping: undefined,
					lines,
					ended: true,
				},
		  };
}

export type RunStep = Readonly<{
	state: RunState;
	answer?: 'push' | 'skip' | 'retry' | 'later';
}>;

/** Keys for the push question, once the result card is showing. */
export function runKey(state: RunState, key: string): RunStep {
	const asked = state.publish?.problem;
	if (state.publish !== undefined && asked !== undefined) {
		if (key === 'left' || key === 'right') {
			return {
				state: {
					...state,
					publish: {...state.publish, problem: {...asked, sel: 1 - asked.sel}},
				},
			};
		}

		if (key === 'enter' || key === 'retry' || key === 'later') {
			return {
				state,
				answer: key === 'enter' ? (asked.sel === 0 ? 'retry' : 'later') : key,
			};
		}

		return {state};
	}

	const {finish} = state;
	if (finish?.request.push === undefined || finish.answered) {
		return {state};
	}

	if (key === 'left' || key === 'right') {
		return {state: {...state, finish: {...finish, sel: 1 - finish.sel}}};
	}

	if (key === 'enter' || key === 'push' || key === 'skip') {
		const answer = key === 'enter' ? (finish.sel === 0 ? 'push' : 'skip') : key;
		return {
			state: {...state, finish: {...finish, answered: true}},
			answer,
		};
	}

	return {state};
}

/** A line of what happened or what to do next, under the steps. */
export function resultLine(kit: Kit, item: ResultLine): Line {
	const {g, line} = kit;
	const tail: Part[] = [
		...(item.command === undefined ? [] : ([[item.command, 'b']] as const)),
		...(item.link === undefined ? [] : ([[item.link, 'c-info u']] as const)),
	];
	// A command or a link is meant to be copied, so it is never cut to fit.
	const finish = (l: Line): Line =>
		item.command === undefined && item.link === undefined ? l : kit.soft(l);
	if (item.tone === 'warning') {
		return finish(
			line('  ', [`${g.warn} `, 'c-warn'], [item.text, 'c-dim'], ...tail),
		);
	}

	if (item.plain) {
		return finish(line('  ', '  ', [item.text, 'c-dim'], ...tail));
	}

	return finish(
		line(
			'  ',
			[`${item.ok ? g.tick : g.cross} `, item.ok ? 'c-ok' : 'c-err'],
			item.text,
			...tail,
		),
	);
}

/** The card for a failed publish step, with its one question. */
export function problemLines(
	kit: Kit,
	problem: PublishProblem,
	sel: number,
	/** A short terminal: what the tool printed goes, and the fix stays. */
	compact = false,
): Line[] {
	const {g, line} = kit;
	const cardWidth = Math.min(kit.cols - margin * 2, 76);
	const inner = cardWidth - 4;
	const tone = problem.tone === 'error' ? 'c-err' : 'c-warn';
	const card: Line[] = [];
	for (const said of compact ? [] : problem.said) {
		for (const piece of kit.wrap(said, inner)) {
			card.push(
				line([piece, /^\s*(!|error|fatal)/i.test(said) ? 'c-warn' : 'c-dim']),
			);
		}
	}

	if (card.length > 0) {
		card.push(line());
	}

	for (const [index, piece] of kit.wrap(problem.fix, inner - 6).entries()) {
		card.push(line([index === 0 ? 'Fix   ' : '      ', 'c-acc b'], piece));
	}

	const below: string[] = [];
	if (problem.after !== undefined) {
		if ([...problem.after].length <= inner - 6) {
			card.push(line(['Then  ', 'c-acc b'], [problem.after, 'b']));
		} else {
			// A command cut at the card's edge would run the wrong thing.
			card.push(line(['Then  ', 'c-acc b'], 'run the command below'));
			below.push(problem.after);
		}
	}

	if (problem.link !== undefined) {
		if ([...problem.link].length <= inner - 6) {
			card.push(
				line(['Or    ', 'c-acc b'], 'open it yourself:'),
				line(['      ', ''], [problem.link, 'c-info u']),
			);
		} else {
			// A link cut at the card's edge would open the wrong page.
			card.push(line(['Or    ', 'c-acc b'], 'open it yourself, link below'));
			below.push(problem.link);
		}
	}

	return [
		line(),
		...kit.indent(
			kit.box(card, cardWidth, {
				title: `${problem.tone === 'error' ? g.cross : g.warn} ${
					problem.title
				}`,
				titleStyle: `${tone} b`,
				borderStyle: tone,
			}),
			margin,
		),
		...(below.length > 0
			? [
					line(),
					line('  ', ['In full, to copy', 'c-acc b']),
					...below.map(link => kit.soft(line('  ', [link, 'c-info u']))),
			  ]
			: []),
		line(),
		line('  ', [problem.question, 'b']),
		line(
			'  ',
			...kit.choice(['Retry', 'Not now'], sel, true, ['retry', 'later']),
			...(problem.note === undefined
				? []
				: ([[`   ${problem.note}`, 'c-dim']] as const)),
		),
	];
}
