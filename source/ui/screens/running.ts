/**
 * The run screen: named steps with timings and a progress bar while the work
 * happens, then a result card with numbered next steps and, when it applies, a
 * question about pushing. The state is plain data the session updates as the
 * setup code reports progress.
 */
import type {
	FinishRequest,
	ResultLine,
	StepDefinition,
	StepStatus,
} from '../../core/session.js';
import {margin, type KeyHint, type Kit, type Line} from '../kit/lines.js';

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

export type RunState = Readonly<{
	command: 'clone' | 'init';
	project: string;
	steps: readonly StepView[];
	finish?: FinishView;
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

export type RunStep = Readonly<{state: RunState; answer?: 'push' | 'skip'}>;

/** Keys for the push question, once the result card is showing. */
export function runKey(state: RunState, key: string): RunStep {
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

type Composed = Readonly<{body: Line[]; tail: Line[]}>;

/** The screen as a body and the tail that must stay visible: the question, or its answer. */
function compose(
	kit: Kit,
	state: RunState,
	now: number,
	compact: boolean,
): Composed {
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
	const outcomeLine = (outcome: ResultLine): Line =>
		outcome.plain
			? line('  ', '  ', [outcome.text, 'c-dim'])
			: line(
					'  ',
					[`${outcome.ok ? g.tick : g.cross} `, outcome.ok ? 'c-ok' : 'c-err'],
					outcome.text,
			  );
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
			for (const [index, text] of kit.wrap(note, contentWidth - 3).entries()) {
				body.push(
					line(
						'  ',
						[index === 0 ? `${g.warn} ` : '  ', 'c-warn'],
						[text, 'c-dim'],
					),
				);
			}
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
	let composed = compose(kit, state, now, false);
	if (
		finish !== undefined &&
		kit.rowsIn(composed.body) + kit.rowsIn(composed.tail) > room
	) {
		composed = compose(kit, state, now, true);
	}

	if (state.closed) {
		return [...composed.body, ...composed.tail];
	}

	const asking = finish?.request.push !== undefined && !finish.answered;
	const hints: KeyHint[] = asking
		? [
				[g.leftright, 'choose'],
				[g.enter, 'confirm', 'enter'],
		  ]
		: finish === undefined
		? [['Ctrl+C', 'cancel']]
		: [['Ctrl+C', 'close']];
	return kit.frame(composed.body, kit.keybar(hints), {
		maxRows: rows,
		tail: composed.tail,
	});
}
