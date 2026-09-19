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
import {margin, type Kit, type Line} from '../kit/lines.js';

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

	if (key === 'enter') {
		return {
			state: {...state, finish: {...finish, answered: true}},
			answer: finish.sel === 0 ? 'push' : 'skip',
		};
	}

	return {state};
}

const seconds = (milliseconds: number): string =>
	`${(Math.max(0, milliseconds) / 1000).toFixed(1)}s`;

export function runningLines(
	kit: Kit,
	state: RunState,
	now: number,
	rows: number,
): Line[] {
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
		line(
			'  ',
			[g.barOn.repeat(filled), 'c-acc'],
			[g.barOff.repeat(bar - filled), 'c-faint'],
			[`  ${label}`, 'c-dim'],
		),
		line(),
	];
	const nameWidth = 32;
	const timeWidth = 6;
	const detailWidth = Math.max(
		10,
		contentWidth - 2 - nameWidth - timeWidth - 1,
	);
	for (const step of state.steps) {
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
	if (finish !== undefined) {
		const {request} = finish;
		const numberWidth =
			Math.max(...request.next.map(item => item.command.length), 10) + 2;
		const cardInner = contentWidth - 4;
		const card = [
			line(['Next', 'c-acc b']),
			...request.next.map((item, index) => {
				// A long path keeps its tail, which is what tells projects apart.
				const command = item.command.startsWith('cd ')
					? `cd ${kit.fit(item.command.slice(3), cardInner - 8)}`
					: item.command;
				return line(
					[` ${index + 1}  `, 'c-dim'],
					[command.padEnd(item.note === undefined ? 0 : numberWidth), 'b'],
					[item.note ?? '', 'c-dim'],
				);
			}),
		];
		body.push(
			...indent(
				box(card, contentWidth, {
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

		body.push(line());
		if (request.push !== undefined && !finish.answered) {
			body.push(
				line('  ', [
					`Push ${request.push.branch} and open a pull request?`,
					'b',
				]),
				line('  ', ...kit.choice([request.push.label, 'Not now'], finish.sel)),
			);
		}

		for (const outcome of finish.outcome) {
			body.push(
				outcome.plain
					? line('  ', '  ', [outcome.text, 'c-dim'])
					: line(
							'  ',
							[
								`${outcome.ok ? g.tick : g.cross} `,
								outcome.ok ? 'c-ok' : 'c-err',
							],
							outcome.text,
					  ),
			);
		}
	}

	if (state.cancelling) {
		body.push(
			line(
				'  ',
				[`${g.warn} `, 'c-warn'],
				['Stopping after this step. Press Ctrl+C again to quit now.', 'c-dim'],
			),
		);
	}

	if (state.closed) {
		return body;
	}

	const asking = finish?.request.push !== undefined && !finish.answered;
	const hints: ReadonlyArray<readonly [string, string]> = asking
		? [
				[g.leftright, 'choose'],
				[g.enter, 'confirm'],
		  ]
		: finish === undefined
		? [['Ctrl+C', 'cancel']]
		: [['Ctrl+C', 'close']];
	return kit.frame(body, kit.keybar(hints), {maxRows: rows});
}
