/**
 * The stages that come after the form: the run itself, with the question about
 * pushing and the publish steps under it, and the two screens that interrupt a
 * run, the existing config and the failure. The run is drawn the way the form
 * is. The others are built by the same functions as before and drawn in here.
 */
import {failureParts} from '../screens/callouts.js';
import {overwriteParts} from '../screens/overwrite.js';
import {
	problemLines,
	resultLine,
	type PublishRow,
	type PublishView,
	type RunState,
	type StepView,
} from '../screens/running.js';
import {createKit, type Kit} from '../kit/lines.js';
import type {Surface} from './canvas.js';
import {lead, heading, panelWidth, type Spacing} from './panels.js';
import {duration, mix} from './motion.js';
import {cut, wrap} from './text.js';
import type {Context, Screen} from './types.js';
import {box, drawLines, link} from './widgets.js';

const seconds = (milliseconds: number): string =>
	`${(Math.max(0, milliseconds) / 1000).toFixed(1)}s`;

/** After ten seconds a push that is still going gets a word, so it is not mistaken for a hang. */
const slowAfter = 10_000;

type Tone = 'pending' | 'active' | 'done' | 'skipped' | 'failed' | 'warned';

type Item = Readonly<{
	tone: Tone;
	glyph: string;
	label: string;
	detail: string;
	clock: string;
}>;

/** The kit the other screens are built with, sized so their margin falls outside the stage. */
function kitFor(context: Context, width: number): Kit {
	return createKit(context.g, width + 4);
}

function colours(
	context: Context,
	tone: Tone,
): {glyph: string; label: string; detail: string; c: string} {
	const {p} = context;
	switch (tone) {
		case 'active': {
			return {glyph: p.acc, label: p.fg, detail: p.dim, c: 'c-acc'};
		}

		case 'done': {
			return {glyph: p.ok, label: p.dim, detail: p.faint, c: 'c-ok'};
		}

		case 'skipped': {
			return {glyph: p.dim, label: p.dim, detail: p.faint, c: 'c-dim'};
		}

		case 'failed': {
			return {glyph: p.err, label: p.err, detail: p.dim, c: 'c-err'};
		}

		case 'warned': {
			return {glyph: p.warn, label: p.warn, detail: p.dim, c: 'c-warn'};
		}

		default: {
			return {glyph: p.faint, label: p.faint, detail: p.faint, c: 'c-faint'};
		}
	}
}

/** The rows of a group: a glyph, a label, what it is doing, and a clock. */
function drawItems(
	s: Surface,
	context: Context,
	y: number,
	width: number,
	items: readonly Item[],
): number {
	const labelWidth = Math.min(30, Math.max(18, Math.floor(width * 0.42)));
	for (const [index, item] of items.entries()) {
		const row = y + index;
		const tint = colours(context, item.tone);
		s.put(lead + 1, row, item.glyph, {c: tint.c, fg: tint.glyph});
		s.put(lead + 4, row, cut(item.label, labelWidth - 1, context.g.ell), {
			c:
				item.tone === 'failed' || item.tone === 'warned'
					? `${tint.c} b`
					: item.tone === 'active'
					? 'c-fg'
					: tint.c === 'c-ok'
					? 'c-dim'
					: tint.c,
			fg: tint.label,
		});
		const clockX = lead + width - item.clock.length;
		const detailRoom = clockX - (lead + 4 + labelWidth) - 1;
		if (detailRoom > 3) {
			s.put(
				lead + 4 + labelWidth,
				row,
				cut(item.detail, detailRoom, context.g.ell),
				{
					c: 'c-faint',
					fg: tint.detail,
				},
			);
		}

		s.put(clockX, row, item.clock, {c: 'c-faint'});
	}

	return y + items.length;
}

function stepItem(context: Context, step: StepView): Item {
	const {g, now} = context;
	const spent =
		step.startedAt === undefined ? 0 : (step.endedAt ?? now) - step.startedAt;
	const base = {label: step.label, detail: step.detail};
	switch (step.status) {
		case 'active': {
			const frame = Math.floor(spent / 80) % g.spin.length;
			return {
				...base,
				tone: 'active',
				glyph: g.spin[frame] ?? g.pend,
				clock: seconds(spent),
			};
		}

		case 'done': {
			return {...base, tone: 'done', glyph: g.tick, clock: seconds(spent)};
		}

		case 'skipped': {
			return {...base, tone: 'skipped', glyph: g.dash, clock: seconds(spent)};
		}

		case 'failed': {
			return {...base, tone: 'failed', glyph: g.cross, clock: seconds(spent)};
		}

		default: {
			return {...base, tone: 'pending', glyph: g.pend, clock: ''};
		}
	}
}

function publishItem(
	context: Context,
	row: PublishRow,
	stopped: boolean,
	pushedOnly: boolean,
): Item {
	const {g, now} = context;
	const spent =
		row.startedAt === undefined ? 0 : (row.endedAt ?? now) - row.startedAt;
	const base = {label: row.label, detail: row.detail};
	switch (row.status) {
		case 'active': {
			const frame = Math.floor(spent / 80) % g.spin.length;
			return {
				...base,
				tone: 'active',
				glyph: g.spin[frame] ?? g.pend,
				clock: seconds(spent),
			};
		}

		case 'done': {
			return {...base, tone: 'done', glyph: g.tick, clock: seconds(spent)};
		}

		case 'failed': {
			return {
				...base,
				tone: 'failed',
				glyph: g.cross,
				detail: 'did not go through',
				clock: seconds(spent),
			};
		}

		case 'warned': {
			return {
				...base,
				tone: 'warned',
				glyph: g.warn,
				detail: 'no pull request',
				clock: seconds(spent),
			};
		}

		case 'cancelled': {
			return {
				...base,
				tone: 'warned',
				glyph: g.dash,
				detail: 'cancelled',
				clock: seconds(spent),
			};
		}

		default: {
			// A step that never got its turn is skipped, not still waiting.
			return stopped || pushedOnly
				? {
						...base,
						tone: 'skipped',
						glyph: g.dash,
						detail: 'skipped',
						clock: '',
				  }
				: {...base, tone: 'pending', glyph: g.pend, clock: ''};
		}
	}
}

/** A small caps heading over a group of rows. */
function group(s: Surface, context: Context, y: number, label: string): number {
	s.put(lead, y, label.toUpperCase(), {c: 'c-faint', fg: context.p.faint});
	return y + 1;
}

/** A long path keeps its tail, which is what tells projects apart. */
function fitCommand(command: string, room: number, ellipsis: string): string {
	if (!command.startsWith('cd ') || [...command].length <= room) {
		return command;
	}

	const chars = command.slice(3);
	return `cd ${ellipsis}${chars.slice(chars.length - (room - 4))}`;
}

/** The green card: what was made, and what to do next. */
function drawDone(
	s: Surface,
	context: Context,
	y: number,
	width: number,
	run: RunState,
	level: number,
): number {
	const {p, g, now, ui} = context;
	const request = run.finish?.request;
	if (request === undefined) {
		return y;
	}

	const w = Math.min(width, 68);
	if (level >= 2) {
		// No room for the card: its commands on one line.
		s.put(lead, y, 'Next', {c: 'c-acc b', fg: p.acc});
		s.put(
			lead + 6,
			y,
			cut(
				request.next.map(item => item.command).join(`  ${g.mid}  `),
				w - 6,
				g.ell,
			),
			{c: 'b'},
		);
		return y + 1;
	}

	const inner = w - 4;
	const notes =
		level >= 1 ? [] : request.notes.flatMap(note => wrap(note, inner - 2));
	if (request.next.length === 0 && notes.length === 0) {
		return y;
	}

	const height = 3 + request.next.length + notes.length;
	box(s, context, lead, y, w, height, {
		edge: p.ok,
		fill: mix(p.bg, p.ok, 0.08),
	});
	s.put(lead + 2, y + 1, `${g.tick} Next steps`, {c: 'c-ok b', fg: p.ok});
	// Notes line up after the longest command that has one; a command without
	// a note, such as a long `cd`, does not push them out of the card.
	const numberWidth =
		Math.max(
			0,
			...request.next
				.filter(item => item.note !== undefined)
				.map(item => [...item.command].length),
		) + 2;
	for (const [index, item] of request.next.entries()) {
		const row = y + 2 + index;
		const key = `copy:${index}`;
		const copied =
			ui.copied?.target === key && now - ui.copied.at < duration.copied;
		const label = copied ? `copied ${g.tick}` : 'copy';
		s.put(lead + 2, row, ` ${index + 1}  `, {c: 'c-dim'});
		const room = inner - 4 - 'copied  '.length - 1;
		const {note} = item;
		const noted = note !== undefined && numberWidth + [...note].length <= room;
		s.put(
			lead + 6,
			row,
			fitCommand(item.command, noted ? numberWidth - 2 : room, g.ell),
			{c: 'b'},
		);
		if (noted) {
			s.put(lead + 6 + numberWidth, row, note, {c: 'c-dim'});
		}

		if (copied) {
			s.put(lead + w - 2 - label.length, row, label, {c: 'c-ok', fg: p.ok});
		} else {
			link(s, context, lead + w - 2 - label.length, row, label, key);
		}
	}

	for (const [index, text] of notes.entries()) {
		const row = y + 2 + request.next.length + index;
		if (index === 0) {
			s.put(lead + 2, row, g.warn, {c: 'c-warn', fg: p.warn});
		}

		s.put(lead + 4, row, text, {c: 'c-dim'});
	}

	return y + height;
}

/** The push block: its rows, a note if it is slow or being stopped, and what follows. */
function drawPublish(
	s: Surface,
	context: Context,
	y: number,
	width: number,
	view: PublishView,
	kit: Kit,
	compact: boolean,
): number {
	const {g, now} = context;
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
	// The branch name keeps its case, so this heading is not a small-caps one.
	s.put(lead, y, cut(title, width, g.ell), {c: 'c-dim'});
	let row = y + 1;
	row = drawItems(
		s,
		context,
		row,
		width,
		view.rows.map(item => publishItem(context, item, stopped, pushedOnly)),
	);
	let waiting = 0;
	for (const item of view.rows) {
		if (item.status === 'active' && item.startedAt !== undefined) {
			waiting = Math.max(waiting, now - item.startedAt);
		}
	}

	if (view.stopping === true) {
		s.put(lead + 1, row, g.warn, {c: 'c-warn', fg: context.p.warn});
		s.put(lead + 4, row, `Stopping${g.ell}`, {c: 'c-dim'});
		row += 1;
	} else if (waiting >= slowAfter) {
		const host = view.destination.split(':')[0] ?? view.destination;
		s.put(lead + 1, row, g.warn, {c: 'c-warn', fg: context.p.warn});
		s.put(
			lead + 4,
			row,
			cut(
				`Still waiting for ${host} (${Math.floor(
					waiting / 1000,
				)}s). Ctrl+C stops waiting.`,
				width - 4,
				g.ell,
			),
			{c: 'c-dim'},
		);
		row += 1;
	}

	if (view.lines.length > 0) {
		row += drawLines(
			s,
			context,
			view.lines.map(item => resultLine(kit, item)),
			lead,
			row,
			2,
		);
	}

	if (view.problem !== undefined) {
		row += drawLines(
			s,
			context,
			problemLines(kit, view.problem.problem, view.problem.sel, compact),
			lead,
			row,
			2,
		);
	}

	return row;
}

/**
 * The run, from the first step to the last line. `level` folds it when the
 * terminal is short: 0 lists every step, 1 folds them to a line, 2 also folds
 * the card, 3 also drops what a failed command printed.
 */
export function drawRun(
	s: Surface,
	context: Context,
	run: RunState,
	level: 0 | 1 | 2 | 3,
): number {
	const {p, g, frame} = context;
	const width = Math.min(panelWidth, s.w - lead * 2);
	const kit = kitFor(context, width);
	const failed = run.steps.some(step => step.status === 'failed');
	const complete =
		run.steps.length > 0 &&
		run.steps.every(
			step => step.status === 'done' || step.status === 'skipped',
		);
	const name = frame.request?.rootName ?? run.project;
	const published =
		run.publish?.ended === true &&
		!run.publish.rows.some(
			row => row.status !== 'done' && row.status !== 'pending',
		);
	let top = heading(
		s,
		context,
		{
			eyebrow: failed ? 'Stopped' : complete ? 'Done' : 'Applying',
			title:
				run.finish === undefined
					? `${run.command === 'clone' ? 'Setting up' : 'Configuring'} ${name}`
					: run.finish.request.title,
			help: failed
				? 'Nothing after the failed step was run.'
				: published
				? 'Setup branch pushed.'
				: complete
				? 'Everything is in place.'
				: 'Stops cleanly between steps. Nothing is half-written.',
		},
		{compact: level > 0} satisfies Spacing,
	);

	top = group(s, context, top, 'Apply');
	if (level === 0) {
		top = drawItems(
			s,
			context,
			top,
			width,
			run.steps.map(step => stepItem(context, step)),
		);
	} else {
		const done = run.steps.filter(
			step => step.status === 'done' || step.status === 'skipped',
		).length;
		const spent = run.steps.reduce(
			(total, step) =>
				total +
				(step.startedAt === undefined || step.endedAt === undefined
					? 0
					: step.endedAt - step.startedAt),
			0,
		);
		s.put(lead + 1, top, g.tick, {c: 'c-ok', fg: p.ok});
		s.put(lead + 4, top, `${done} steps done`, {c: 'c-dim'});
		s.put(lead + width - seconds(spent).length, top, seconds(spent), {
			c: 'c-faint',
		});
		top += 1;
	}

	const {finish} = run;
	if (finish !== undefined) {
		top = drawDone(s, context, top + 1, width, run, level);
		if (finish.request.push !== undefined && !finish.answered) {
			top += drawLines(
				s,
				context,
				[
					kit.line(),
					// A question is never cut, so on a narrow stage it takes a second row.
					...kit
						.wrap(
							`Push ${finish.request.push.branch} and open a pull request?`,
							width - 2,
						)
						.map(piece => kit.line('  ', [piece, 'b'])),
					kit.line(
						'  ',
						...kit.choice(
							[finish.request.push.label, 'Not now'],
							finish.sel,
							true,
							['push', 'skip'],
						),
					),
				],
				lead,
				top,
				2,
			);
		}

		if (finish.outcome.length > 0) {
			top += drawLines(
				s,
				context,
				finish.outcome.map(item => resultLine(kit, item)),
				lead,
				top,
				2,
			);
		}

		if (run.publish !== undefined) {
			top = drawPublish(
				s,
				context,
				top + 1,
				width,
				run.publish,
				kit,
				level === 3,
			);
		}
	}

	if (run.outcome !== undefined && run.outcome.length > 0) {
		top += drawLines(
			s,
			context,
			[kit.line(), ...run.outcome.map(item => resultLine(kit, item))],
			lead,
			top,
			2,
		);
	}

	if (run.cancelling === true) {
		s.put(lead + 1, top, g.warn, {c: 'c-warn', fg: p.warn});
		s.put(
			lead + 4,
			top,
			cut(
				'Stopping after this step. Press Ctrl+C again to quit now.',
				width - 4,
				g.ell,
			),
			{c: 'c-dim'},
		);
		top += 1;
	}

	return top;
}

/** The existing-config screen, in the stage: its diff scrolls inside it. */
export function drawOverwrite(
	s: Surface,
	context: Context,
	screen: Extract<Screen, {kind: 'overwrite'}>,
	room: number,
): {height: number; hints: ReturnType<typeof overwriteParts>['hints']} {
	const width = Math.min(panelWidth, s.w - lead * 2);
	const kit = kitFor(context, width);
	s.put(lead, 0, 'EXISTING CONFIG', {c: 'c-acc', fg: context.p.acc});
	// The diff shows what the room allows; 14 rows are everything else on the old screen.
	const parts = overwriteParts(
		kit,
		screen.model,
		screen.request,
		screen.state,
		room + 5,
	);
	let y = 1;
	y += drawLines(s, context, parts.body, lead, y, 2);
	y += drawLines(s, context, parts.tail, lead, y, 2);
	return {height: y, hints: parts.hints};
}

/** The failure card, in the stage. */
export function drawFailure(
	s: Surface,
	context: Context,
	screen: Extract<Screen, {kind: 'failure'}>,
): {height: number; hints: ReturnType<typeof failureParts>['hints']} {
	const width = Math.min(panelWidth, s.w - lead * 2);
	const kit = kitFor(context, width);
	s.put(lead, 0, 'STOPPED', {c: 'c-err', fg: context.p.err});
	const parts = failureParts(kit, screen.request, screen.state);
	let y = 1;
	y += drawLines(s, context, parts.body, lead, y, 2);
	y += drawLines(s, context, parts.tail, lead, y, 2);
	return {height: y, hints: parts.hints};
}

/** Before the first question is ready: a spinner while the tools and the remote are looked at. */
export function drawIdle(s: Surface, context: Context): number {
	const {g, now} = context;
	const top = heading(
		s,
		context,
		{
			eyebrow: 'Starting',
			title: 'Getting ready',
			help: 'Looking at the repository and the tools on this machine.',
		},
		{compact: false},
	);
	s.put(lead + 1, top, g.spin[Math.floor(now / 80) % g.spin.length] ?? g.pend, {
		c: 'c-acc',
		fg: context.p.acc,
	});
	return top + 1;
}
