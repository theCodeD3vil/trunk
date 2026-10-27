/**
 * The rail down the left: every step of the setup, where you are, and what you
 * answered. A marker slides to the step in hand; a step you finish ticks over,
 * a value that changes fades in, and a step you point at brightens.
 */
import type {ConfigureRequest} from '../../core/session.js';
import type {RunState} from '../screens/running.js';
import {mix} from './motion.js';
import type {Surface} from './canvas.js';
import type {Context, Screen} from './types.js';
import {
	labels,
	stageOrder,
	stepStatus,
	summary,
	availability,
	type Wizard,
} from './wizard.js';

export type RailStatus =
	| 'todo'
	| 'active'
	| 'done'
	| 'skipped'
	| 'running'
	| 'failed';

export type RailItem = Readonly<{
	id: string;
	group: 'Configure' | 'Ship';
	label: string;
	status: RailStatus;
	value: string;
}>;

export type RailModel = Readonly<{
	items: readonly RailItem[];
	/** The step in hand, or -1 when none is. */
	active: number;
}>;

/** The run behind whichever screen is on show, if one has started. */
export function runOf(screen: Screen): RunState | undefined {
	return screen.kind === 'run' ||
		screen.kind === 'overwrite' ||
		screen.kind === 'failure'
		? screen.run
		: undefined;
}

function applyItem(run: RunState | undefined): RailItem {
	const base = {id: 'apply', group: 'Ship', label: 'Apply'} as const;
	const steps = run?.steps ?? [];
	if (steps.length === 0) {
		return {...base, status: 'todo', value: ''};
	}

	const failed = steps.some(step => step.status === 'failed');
	const active = steps.find(step => step.status === 'active');
	const finished = steps.every(
		step => step.status === 'done' || step.status === 'skipped',
	);
	return failed
		? {...base, status: 'failed', value: 'stopped'}
		: active === undefined
		? finished
			? {...base, status: 'done', value: `${steps.length} steps`}
			: {...base, status: 'todo', value: ''}
		: {...base, status: 'running', value: active.label};
}

function publishItem(run: RunState | undefined): RailItem {
	const base = {id: 'publish', group: 'Ship', label: 'Publish'} as const;
	const publish = run?.publish;
	if (publish !== undefined) {
		const stopped = publish.rows.some(
			row => row.status === 'failed' || row.status === 'cancelled',
		);
		// Only the pull request failed: the push is on origin.
		const partial = publish.rows.some(row => row.status === 'warned');
		const active = publish.rows.find(row => row.status === 'active');
		return stopped || partial
			? {
					...base,
					status: 'failed',
					value: stopped ? 'stopped' : 'pushed, no PR',
			  }
			: publish.ended
			? {
					...base,
					status: 'done',
					value: publish.rows.some(row => row.id === 'pr')
						? 'pull request opened'
						: 'pushed',
			  }
			: {...base, status: 'running', value: active?.label ?? 'waiting'};
	}

	const {finish} = run ?? {};
	if (finish === undefined) {
		return {...base, status: 'todo', value: ''};
	}

	return finish.request.push === undefined
		? {...base, status: 'skipped', value: 'nothing to push'}
		: finish.answered
		? {...base, status: 'skipped', value: 'not now'}
		: {...base, status: 'active', value: 'push now?'};
}

export function railModel(
	request: ConfigureRequest | undefined,
	wizard: Wizard | undefined,
	screen: Screen,
): RailModel {
	const asking = screen.kind === 'wizard' || screen.kind === 'idle';
	const items: RailItem[] = [];
	for (const stage of stageOrder) {
		if (stage === 'review') {
			items.push({
				id: 'review',
				group: 'Ship',
				label: 'Review',
				status:
					request === undefined || wizard === undefined
						? 'todo'
						: asking
						? stepStatus(request, wizard, 'review')
						: 'done',
				value: '',
			});
			continue;
		}

		const label = labels[stage];
		if (request === undefined || wizard === undefined) {
			items.push({
				id: stage,
				group: 'Configure',
				label,
				status: 'todo',
				value: '',
			});
			continue;
		}

		const where = availability(request, wizard.values, stage);
		const status: RailStatus =
			where === 'skipped'
				? 'skipped'
				: asking
				? stepStatus(request, wizard, stage)
				: 'done';
		const flag = request.fromFlags[stage];
		items.push({
			id: stage,
			group: 'Configure',
			label,
			status,
			value:
				status === 'skipped'
					? request.installedAgents.length === 0 && stage === 'agents'
						? 'none installed'
						: 'needs tmux'
					: status === 'todo'
					? ''
					: `${summary(wizard.values, stage)}${
							flag === undefined ? '' : `  ${flag}`
					  }`,
		});
	}

	const run = runOf(screen);
	items.splice(
		items.findIndex(item => item.id === 'review') + 1,
		0,
		applyItem(run),
		publishItem(run),
	);
	// The review is confirmed once the work has started.
	const review = items.find(item => item.id === 'review');
	if (review !== undefined && review.status === 'done') {
		items[items.indexOf(review)] = {...review, value: 'confirmed'};
	}

	return {
		items,
		active: items.findIndex(
			item => item.status === 'active' || item.status === 'running',
		),
	};
}

/** How tall a step is, for the room there is: a name, its answer, and a gap. */
export function stepHeight(rows: number): 1 | 2 | 3 {
	return rows >= 29 ? 3 : rows >= 20 ? 2 : 1;
}

/** The row each item starts on, and where the headings go. */
export function railLayout(
	items: readonly RailItem[],
	stepH: number,
): {steps: number[]; headings: Array<{label: string; y: number}>} {
	const steps: number[] = [];
	const headings: Array<{label: string; y: number}> = [];
	let y = 1;
	let group = '';
	for (const item of items) {
		if (item.group !== group) {
			if (group !== '') {
				y += 1;
			}

			group = item.group;
			headings.push({label: group, y});
			y += 1;
		}

		steps.push(y);
		y += stepH;
	}

	return {steps, headings};
}

// Columns inside the sidebar: the marker hugs its edge, the rest sits two in.
const markerX = 0;
const headX = 2;
const nodeX = 3;
const nameX = 5;

export function drawRail(s: Surface, context: Context, model: RailModel): void {
	const {p, g, now} = context;
	const stepH = stepHeight(s.h);
	const layout = railLayout(model.items, stepH);
	for (const heading of layout.headings) {
		s.put(headX, heading.y, heading.label.toUpperCase(), {c: 'c-faint'});
	}

	for (const [index, item] of model.items.entries()) {
		const y = layout.steps[index]!;
		const last =
			index === model.items.length - 1 ||
			model.items[index + 1]!.group !== item.group;
		const hover = context.hover(`step:${item.id}`);
		const clickable = item.id !== 'apply' && item.id !== 'publish';
		if (clickable) {
			s.hit(0, y, s.w, stepH, `step:${item.id}`);
		}

		const spinner = g.spin[Math.floor(now / 80) % g.spin.length] ?? g.spin[0]!;
		const glyph =
			item.status === 'running'
				? spinner
				: item.status === 'failed'
				? g.cross
				: g.node[item.status];
		const nodeColour =
			item.status === 'active' || item.status === 'running'
				? p.acc
				: item.status === 'done'
				? p.ok
				: item.status === 'failed'
				? p.err
				: p.faint;
		s.put(nodeX, y, glyph, {
			c:
				item.status === 'active' || item.status === 'running'
					? 'c-acc'
					: item.status === 'done'
					? 'c-ok'
					: item.status === 'failed'
					? 'c-err'
					: 'c-faint',
			fg: nodeColour,
		});
		const nameColour =
			item.status === 'skipped'
				? p.faint
				: item.status === 'active' ||
				  item.status === 'running' ||
				  item.status === 'done' ||
				  item.status === 'failed'
				? p.fg
				: mix(p.dim, p.fg, hover);
		const nameWidth = s.w - nameX - 2;
		const name =
			[...item.label].length > nameWidth
				? `${[...item.label].slice(0, nameWidth - 1).join('')}${g.ell}`
				: item.label;
		s.put(nameX, y, name, {
			c: `${
				item.status === 'skipped'
					? 's c-faint'
					: item.status === 'todo'
					? 'c-dim'
					: 'c-fg'
			}${item.status === 'active' || item.status === 'running' ? ' b' : ''}`,
			fg: nameColour,
		});
		if (stepH > 1 && item.value !== '') {
			const valueWidth = nameWidth;
			const value =
				[...item.value].length > valueWidth
					? `${[...item.value].slice(0, valueWidth - 1).join('')}${g.ell}`
					: item.value;
			const target =
				item.status === 'active' || item.status === 'running'
					? p.acc
					: item.status === 'todo' || item.status === 'skipped'
					? p.faint
					: p.dim;
			s.put(nameX, y + 1, value, {
				c:
					item.status === 'active' || item.status === 'running'
						? 'c-acc'
						: item.status === 'todo' || item.status === 'skipped'
						? 'c-faint'
						: 'c-dim',
				fg: target,
			});
		}

		if (!last) {
			const connector =
				item.status === 'done' ? mix(p.line, p.ok, 0.45) : p.line;
			for (let row = 1; row < stepH; row++) {
				s.put(nodeX, y + row, g.rail, {c: 'c-faint', fg: connector});
			}
		}
	}

	// The marker sits against the open step.
	const open = layout.steps[model.active];
	if (open !== undefined) {
		// The name and its answer; the gap under them is not part of the step.
		for (let row = 0; row < Math.min(stepH, 2); row++) {
			s.put(markerX, open + row, g.marker, {c: 'c-acc', fg: p.acc});
		}
	}
}
