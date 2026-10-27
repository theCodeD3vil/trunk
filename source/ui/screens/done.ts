/**
 * What is left on the screen once a run has finished. The terminal is cleared
 * and this is printed, so the next prompt sits right under the steps to take.
 */
import type {FinishRequest, ResultLine} from '../../core/session.js';
import {margin, type Kit, type Line} from '../kit/lines.js';
import {resultLine, type RunState} from './running.js';

export function doneLines(
	kit: Kit,
	request: FinishRequest,
	outcome: readonly ResultLine[],
): Line[] {
	const {g, line} = kit;
	// Notes line up after the longest command that has one; a long `cd` has none.
	const wide = Math.max(
		0,
		...request.next
			.filter(step => step.note !== undefined)
			.map(step => [...step.command].length),
	);
	// A command is meant to be copied, so it is never cut to fit.
	const steps = request.next.map((step, index) =>
		kit.soft(
			line(
				[` ${index + 1}  `, 'c-dim'],
				[step.command, 'b'],
				...(step.note === undefined
					? []
					: ([
							[' '.repeat(wide - [...step.command].length + 3), ''],
							[step.note, 'c-dim'],
					  ] as const)),
			),
		),
	);
	return kit.indent(
		[
			line(),
			line([`${g.tick} ${request.title}`, 'c-ok b']),
			...outcome.map(item => resultLine(kit, item)),
			line(),
			line(['Next steps', 'b']),
			...steps,
			...(request.notes.length === 0
				? []
				: [
						line(),
						...request.notes.flatMap(note =>
							kit
								.wrap(note, Math.max(20, kit.cols - margin * 2 - 2))
								.map((text, index) =>
									line(index === 0 ? [`${g.warn} `, 'c-warn'] : '  ', [
										text,
										'c-dim',
									]),
								),
						),
				  ]),
			line(),
		],
		margin,
	);
}

/** What a finished run has to say, as lines: its own, then each publish step that ran, then what to do next. */
export function outcomeOf(run: RunState): ResultLine[] {
	const steps = (run.publish?.rows ?? []).flatMap((row): ResultLine[] => {
		const text = `${row.label}  ${row.detail}`;
		switch (row.status) {
			case 'done': {
				return [{ok: true, text}];
			}

			case 'warned': {
				return [{ok: true, tone: 'warning', text}];
			}

			case 'failed': {
				return [{ok: false, text}];
			}

			default: {
				return [];
			}
		}
	});
	return [
		...(run.finish?.outcome ?? []),
		...steps,
		...(run.publish?.lines ?? []),
	];
}
