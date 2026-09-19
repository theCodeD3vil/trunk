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
import {abortKey} from '../keys.js';
import {
	margin,
	type KeyHint,
	type Kit,
	type Line,
	type Part,
} from '../kit/lines.js';

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
	/** The session has ended, so the frame is left in the scrollback without its key bar. */
	closed?: boolean;
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

const seconds = (milliseconds: number): string =>
	`${(Math.max(0, milliseconds) / 1000).toFixed(1)}s`;

/** A line of what happened or what to do next, under the steps. */
function resultLine(kit: Kit, item: ResultLine): Line {
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

/** After ten seconds a push that is still going gets a word, so it is not mistaken for a hang. */
const slowAfter = 10_000;

/** The card for a failed publish step, with its one question. */
function problemLines(kit: Kit, problem: PublishProblem, sel: number): Line[] {
	const {g, line} = kit;
	const cardWidth = Math.min(kit.cols - margin * 2, 76);
	const inner = cardWidth - 4;
	const tone = problem.tone === 'error' ? 'c-err' : 'c-warn';
	const card: Line[] = [];
	for (const said of problem.said) {
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

	if (problem.after !== undefined) {
		card.push(line(['Then  ', 'c-acc b'], [problem.after, 'b']));
	}

	const below: string[] = [];
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

/** The publish steps, then whatever follows: a card, a hint, or what to do next. */
function publishLines(kit: Kit, view: PublishView, now: number): Line[] {
	const {g, line} = kit;
	const contentWidth = kit.cols - margin * 2;
	const stopped = view.rows.some(
		row => row.status === 'failed' || row.status === 'cancelled',
	);
	const pushedOnly = view.rows.some(row => row.status === 'warned');
	const title = pushedOnly
		? `Pushed ${view.branch}`
		: stopped
		? `Publishing ${view.branch} stopped`
		: view.ended
		? `Published ${view.branch}`
		: `Publishing ${view.branch}`;
	const out: Line[] = [line('  ', [title, 'b'])];
	const nameWidth = 30;
	const timeWidth = 6;
	const detailWidth = Math.max(
		10,
		contentWidth - 2 - 2 - nameWidth - timeWidth - 1,
	);
	let waiting = 0;
	for (const row of view.rows) {
		let icon = g.pend;
		let iconStyle = 'c-faint';
		let nameStyle = 'c-faint';
		let detailStyle = 'c-faint';
		let time = '';
		let {detail} = row;
		const spent =
			row.startedAt === undefined ? 0 : (row.endedAt ?? now) - row.startedAt;
		switch (row.status) {
			case 'done': {
				[icon, iconStyle, nameStyle, detailStyle] = [
					g.tick,
					'c-ok',
					'c-fg',
					'c-dim',
				];
				time = seconds(spent);
				break;
			}

			case 'active': {
				const frame = Math.floor(spent / 80) % g.spin.length;
				icon = g.spin[frame] ?? g.pend;
				[iconStyle, nameStyle, detailStyle] = ['c-acc', 'b', 'c-dim'];
				time = seconds(spent);
				waiting = Math.max(waiting, spent);
				break;
			}

			case 'failed': {
				[icon, iconStyle, nameStyle, detailStyle] = [
					g.cross,
					'c-err',
					'b c-err',
					'c-dim',
				];
				time = seconds(spent);
				detail = 'did not go through';
				break;
			}

			case 'warned': {
				[icon, iconStyle, nameStyle, detailStyle] = [
					g.warn,
					'c-warn',
					'b c-warn',
					'c-dim',
				];
				time = seconds(spent);
				detail = 'no pull request';
				break;
			}

			case 'cancelled': {
				[icon, iconStyle, nameStyle, detailStyle] = [
					g.dash,
					'c-warn',
					'c-fg',
					'c-dim',
				];
				time = seconds(spent);
				detail = 'cancelled';
				break;
			}

			case 'pending': {
				// A step that never got its turn is skipped, not still waiting.
				if (stopped || pushedOnly) {
					icon = g.dash;
					detail = 'skipped';
				}

				break;
			}
			// No default
		}

		out.push(
			line(
				'  ',
				[`${icon} `, iconStyle],
				[row.label.padEnd(nameWidth), nameStyle],
				[kit.fit(detail, detailWidth).padEnd(detailWidth), detailStyle],
				[time.padStart(timeWidth), 'c-dim'],
			),
		);
	}

	if (view.stopping === true) {
		out.push(line('  ', [`${g.warn} `, 'c-warn'], ['Stopping\u2026', 'c-dim']));
	} else if (waiting >= slowAfter) {
		const host = view.destination.split(':')[0] ?? view.destination;
		out.push(
			line(
				'  ',
				[`${g.warn} `, 'c-warn'],
				[
					`Still waiting for ${host} (${Math.floor(
						waiting / 1000,
					)}s). Ctrl+C stops waiting.`,
					'c-dim',
				],
			),
		);
	}

	if (view.lines.length > 0) {
		out.push(line(), ...view.lines.map(item => resultLine(kit, item)));
	}

	if (view.problem !== undefined) {
		out.push(...problemLines(kit, view.problem.problem, view.problem.sel));
	}

	return out;
}

type Composed = Readonly<{body: Line[]; tail: Line[]}>;

/** The screen as a body and the tail that must stay visible: the question, or its answer. */
function compose(
	kit: Kit,
	state: RunState,
	now: number,
	/** 0 lists every step, 1 folds them to a line, 2 also folds the next-steps card. */
	level: 0 | 1 | 2,
): Composed {
	const compact = level > 0;
	const {g, line, cols, box, indent} = kit;
	const contentWidth = cols - margin * 2;
	const finishedSteps = state.steps.filter(
		step => step.status === 'done' || step.status === 'skipped',
	).length;
	const failed = state.steps.some(step => step.status === 'failed');
	const complete = finishedSteps === state.steps.length;
	const bar = 12;
	const filled = Math.round(
		(finishedSteps / Math.max(1, state.steps.length)) * bar,
	);
	const active = state.steps.findIndex(step => step.status === 'active');
	const label = complete
		? 'Done'
		: failed
		? 'Stopped'
		: `Step ${Math.min(
				state.steps.length,
				(active === -1 ? finishedSteps : active) + 1,
		  )} of ${state.steps.length}`;

	const body: Line[] = [
		...kit.header(
			[state.command, complete ? 'done' : failed ? 'stopped' : 'setting up'],
			state.project,
		),
		line(),
	];
	if (compact) {
		// A short terminal has no room for six step rows above the question.
		const spent = state.steps.reduce(
			(total, step) =>
				total +
				(step.startedAt === undefined || step.endedAt === undefined
					? 0
					: step.endedAt - step.startedAt),
			0,
		);
		body.push(
			line('  ', [`${g.tick} `, 'c-ok'], `${finishedSteps} steps done`, [
				`  ${seconds(spent)}`,
				'c-dim',
			]),
		);
	} else {
		body.push(
			line(
				'  ',
				[g.barOn.repeat(filled), 'c-acc'],
				[g.barOff.repeat(bar - filled), 'c-faint'],
				[`  ${label}`, 'c-dim'],
			),
			line(),
		);
	}

	const nameWidth = 32;
	const timeWidth = 6;
	const detailWidth = Math.max(
		10,
		contentWidth - 2 - nameWidth - timeWidth - 1,
	);
	for (const step of compact ? [] : state.steps) {
		let icon = g.pend;
		let iconStyle = 'c-faint';
		let nameStyle = 'c-faint';
		let detailStyle = 'c-faint';
		let time = '';
		switch (step.status) {
			case 'done':
			case 'skipped': {
				icon = step.status === 'done' ? g.tick : g.dash;
				iconStyle = step.status === 'done' ? 'c-ok' : 'c-dim';
				nameStyle = 'c-fg';
				detailStyle = 'c-dim';
				time =
					step.startedAt === undefined || step.endedAt === undefined
						? ''
						: seconds(step.endedAt - step.startedAt);

				break;
			}

			case 'active': {
				const frame =
					Math.floor((now - (step.startedAt ?? now)) / 80) % g.spin.length;
				icon = g.spin[frame] ?? g.spin[0] ?? g.pend;
				iconStyle = 'c-acc';
				nameStyle = 'b';
				detailStyle = 'c-dim';
				time = seconds(now - (step.startedAt ?? now));

				break;
			}

			case 'failed': {
				icon = g.cross;
				iconStyle = 'c-err';
				nameStyle = 'b c-err';
				detailStyle = 'c-dim';
				time =
					step.startedAt === undefined || step.endedAt === undefined
						? ''
						: seconds(step.endedAt - step.startedAt);

				break;
			}

			case 'pending': {
				// Keeps the faint defaults set above.
				break;
			}
			// No default
		}

		const detail = kit.fit(step.detail, detailWidth);
		body.push(
			line(
				'  ',
				[`${icon} `, iconStyle],
				[step.label.padEnd(nameWidth - 2), nameStyle],
				[detail.padEnd(detailWidth), detailStyle],
				[time.padStart(timeWidth), 'c-dim'],
			),
		);
	}

	body.push(line());
	const {finish} = state;
	const tail: Line[] = [];
	const outcomeLine = (outcome: ResultLine): Line => resultLine(kit, outcome);
	if (finish !== undefined) {
		const {request} = finish;
		// Cards stop at 76 columns, so a command and its note never sit far apart.
		const cardWidth = Math.min(contentWidth, 76);
		const cardInner = cardWidth - 4;
		const commands = request.next.map(item =>
			// A long path keeps its tail, which is what tells projects apart.
			item.command.startsWith('cd ')
				? `cd ${kit.fit(item.command.slice(3), cardInner - 8)}`
				: item.command,
		);
		// The notes line up after the longest command that has one. A command with
		// no note, such as a long `cd`, does not push them out of the card.
		// The proposal's column is 30 wide; a longer command moves it out.
		const numberWidth = Math.max(
			30,
			Math.max(
				...commands
					.filter((_, index) => request.next[index]?.note !== undefined)
					.map(text => text.length),
			) + 2,
		);
		const card = [
			line(['Next', 'c-acc b']),
			...request.next.map((item, index) => {
				const command = commands[index] ?? item.command;
				const note =
					item.note !== undefined &&
					4 + numberWidth + item.note.length <= cardWidth - 4
						? item.note
						: undefined;
				return line(
					[` ${index + 1}  `, 'c-dim'],
					[command.padEnd(note === undefined ? 0 : numberWidth), 'b'],
					[note ?? '', 'c-dim'],
				);
			}),
		];
		if (level < 2) {
			body.push(
				...indent(
					box(card, cardWidth, {
						title: `${g.tick} ${request.title}`,
						titleStyle: 'c-ok b',
					}),
					margin,
				),
			);
			for (const note of request.notes) {
				for (const [index, text] of kit
					.wrap(note, contentWidth - 3)
					.entries()) {
					body.push(
						line(
							'  ',
							[index === 0 ? `${g.warn} ` : '  ', 'c-warn'],
							[text, 'c-dim'],
						),
					);
				}
			}
		} else {
			// No room for the card: its commands on one line, and no notes.
			body.push(
				line(
					'  ',
					['Next  ', 'c-acc b'],
					[kit.fit(commands.join(`  ${g.mid}  `), contentWidth - 8), 'b'],
				),
			);
		}

		tail.push(line());
		if (request.push !== undefined && !finish.answered) {
			tail.push(
				line('  ', [
					`Push ${request.push.branch} and open a pull request?`,
					'b',
				]),
				line(
					'  ',
					...kit.choice([request.push.label, 'Not now'], finish.sel, true, [
						'push',
						'skip',
					]),
				),
			);
		}

		tail.push(...finish.outcome.map(item => outcomeLine(item)));
		if (state.publish !== undefined) {
			tail.push(...publishLines(kit, state.publish, now));
		}
	}

	// After a failed run was kept or rolled back, say what was done.
	if (state.outcome !== undefined && state.outcome.length > 0) {
		// The steps above already end with a blank line.
		tail.push(...state.outcome.map(item => outcomeLine(item)));
	}

	if (state.cancelling) {
		tail.push(
			line(
				'  ',
				[`${g.warn} `, 'c-warn'],
				['Stopping after this step. Press Ctrl+C again to quit now.', 'c-dim'],
			),
		);
	}

	return {body, tail};
}

export function runningLines(
	kit: Kit,
	state: RunState,
	now: number,
	rows: number,
): Line[] {
	const {g} = kit;
	const {finish} = state;
	// Two rows of chrome and the one the frame leaves free.
	const room = rows - 3;
	let composed = compose(kit, state, now, 0);
	for (const level of [1, 2] as const) {
		if (
			finish !== undefined &&
			kit.rowsIn(composed.body) + kit.rowsIn(composed.tail) > room
		) {
			composed = compose(kit, state, now, level);
		}
	}

	if (state.closed) {
		return [...composed.body, ...composed.tail];
	}

	const asking = finish?.request.push !== undefined && !finish.answered;
	const {publish} = state;
	const publishing = publish !== undefined && !publish.ended;
	const hints: KeyHint[] =
		asking || publish?.problem !== undefined
			? [
					[g.leftright, 'choose'],
					[g.enter, 'confirm', 'enter'],
			  ]
			: finish === undefined
			? [['Ctrl+C', 'cancel']]
			: publishing
			? [['Ctrl+C', 'cancel', abortKey]]
			: [['Ctrl+C', 'close']];
	return kit.frame(composed.body, kit.keybar(hints), {
		maxRows: rows,
		tail: composed.tail,
	});
}
