/**
 * The panels of the setup form: the stage's header, then whatever the open step
 * asks. Each draws on a scratch surface from the top left and returns how many
 * rows it used, so the view can decide how much room is left for the preview.
 *
 * A panel keeps one cell free on each side (`lead`) so a shake has somewhere to go.
 */
import {agentCommands, agentIds, maximumAgents} from '../../core/agents.js';
import {validatePrefix} from '../../core/prefix.js';
import type {SetupField} from '../../core/resolve.js';
import type {Surface} from './canvas.js';
import {duration, ease, mix, running} from './motion.js';
import {cut, flow, wrap} from './text.js';
import type {Context} from './types.js';
import {
	answers,
	eyebrow,
	availability,
	help,
	isDefault,
	labels,
	scriptCommand,
	suggestedPrefix,
	type Stage,
} from './wizard.js';
import {box, link, popped, shakeOf} from './widgets.js';

export const lead = 1;

export type Spacing = Readonly<{
	/** A short terminal drops the blank rows and the help text. */
	compact: boolean;
}>;

type Heading = Readonly<{eyebrow: string; title: string; help: string}>;

/** The eyebrow, the title and the help under it. Returns the row to start on. */
export function heading(
	s: Surface,
	context: Context,
	text: Heading,
	space: Spacing,
): number {
	const {p} = context;
	s.put(lead, 0, text.eyebrow.toUpperCase(), {c: 'c-acc', fg: p.acc});
	s.put(lead, 1, text.title, {c: 'b'});
	if (space.compact) {
		return 2;
	}

	const lines = wrap(text.help, Math.min(62, s.w - lead * 2));
	for (const [index, line] of lines.entries()) {
		s.put(lead, 2 + index, line, {c: 'c-dim'});
	}

	return 2 + lines.length + 1;
}

function drawPrefix(s: Surface, context: Context, top: number): number {
	const {p, g, frame} = context;
	const {wizard, request} = frame;
	if (wizard === undefined || request === undefined) {
		return top;
	}

	const text = wizard.values.prefix;
	const check = validatePrefix(text);
	const bad = !check.valid;
	const width = s.w - lead * 2;
	const x = lead;
	box(s, context, x, top, width, 3, {
		edge: bad ? p.err : p.acc,
		fill: mix(p.bg, bad ? p.err : p.acc, 0.07),
		k: 'field',
	});
	s.put(x + 2, top + 1, g.prompt, {c: 'c-acc', fg: p.acc});

	const count = `${[...text].length}/24`;
	const near = [...text].length >= 20;
	const countX = x + width - 2 - count.length;
	s.put(countX, top + 1, count, {c: near ? 'c-warn' : 'c-faint'});

	// The text, with the caret drawn as an inverted cell.
	const room = Math.max(1, countX - 1 - (x + 4));
	const start = Math.max(0, wizard.caret - room + 1);
	const shown = [...text].slice(start, start + room).join('');
	s.put(x + 4, top + 1, shown, {c: 'c-fg', fg: p.fg});
	const at = wizard.caret - start;
	const under = [...text][wizard.caret] ?? ' ';
	s.put(x + 4 + at, top + 1, under, {
		c: 'pill',
		fg: p.accInk,
		bg: bad ? p.err : p.acc,
	});

	// What the answer means: how sessions will be named, or why it will not do.
	const y = top + 3;
	s.put(lead + 1, y, bad ? g.cross : g.tick, {c: bad ? 'c-err b' : 'c-ok b'});
	const room2 = Math.max(10, width - 3);
	if (check.valid) {
		let at = s.put(lead + 3, y, 'Sessions will be named ', {c: 'c-dim'});
		at = s.put(at, y, `${text}_main`, {c: 'c-fg', fg: p.fg});
		at = s.put(at, y, ' and ', {c: 'c-dim'});
		s.put(at, y, `${text}_feat-login`, {c: 'c-fg', fg: p.fg});
	} else {
		for (const [index, line] of wrap(check.reason, room2).entries()) {
			s.put(lead + 3, y + index, line, {c: 'c-err'});
		}
	}

	// A row is kept for the suggestion even when it is hidden, so nothing below jumps.
	const suggested = suggestedPrefix(request);
	const after = y + (check.valid ? 1 : wrap(check.reason, room2).length);
	if (text !== suggested) {
		link(
			s,
			context,
			lead,
			after,
			`${g.redo} use suggested ${g.quoteL}${suggested}${g.quoteR}`,
			'suggest',
		);
	}

	return after + 1;
}

function drawChoices(
	s: Surface,
	context: Context,
	top: number,
	field: Exclude<SetupField, 'prefix' | 'agents'>,
): number {
	const {p, g, frame} = context;
	const {wizard} = frame;
	if (wizard === undefined) {
		return top;
	}

	const total = s.w - lead * 2;
	const stacked = total < 56;
	const each = stacked ? total : Math.floor((total - 2) / 2);
	const options = [
		{on: true, title: 'On', small: answers[field][0]},
		{on: false, title: 'Off', small: answers[field][1]},
	];
	const lines = options.map(option => wrap(option.small, each - 6));
	const tall = Math.max(...lines.map(entry => entry.length)) + 3;
	let y = top;
	for (const [index, option] of options.entries()) {
		const key = `choice:${field}:${option.on ? 'on' : 'off'}`;
		const x = lead + (stacked ? 0 : index * (each + 2));
		const checked = wizard.values[field] === option.on;
		const hover = context.hover(key);
		const settle = running(
			context.ui.fx,
			`sel:${field}`,
			context.now,
			duration.select,
		);
		const t = settle === undefined ? 1 : ease.out(settle);
		const edge = checked
			? mix(p.line, p.acc, t)
			: settle === undefined
			? mix(p.line, p.faint, hover)
			: mix(p.acc, p.line, t);
		const fill = checked ? mix(p.bg, p.acc, 0.08 * t) : mix(p.bg, p.sel, hover);
		const height = stacked ? lines[index]!.length + 3 : tall;
		box(s, context, x, y, each, height, {edge, fill, k: key});
		const tint = popped(context, `choice:${field}`, p.acc);
		s.put(x + 2, y + 1, checked ? g.radioOn : g.radioOff, {
			c: checked ? 'c-acc' : 'c-faint',
			fg: checked ? (tint.hot ? tint.fg : p.acc) : p.faint,
		});
		s.put(x + 4, y + 1, option.title, {c: 'b'});
		for (const [row, line] of lines[index]!.entries()) {
			s.put(x + 4, y + 2 + row, line, {c: 'c-dim'});
		}

		if (stacked) {
			y += height + 1;
		}
	}

	return stacked ? y : y + tall;
}

function drawAgents(s: Surface, context: Context, top: number): number {
	const {p, g, frame} = context;
	const {wizard, request} = frame;
	if (wizard === undefined || request === undefined) {
		return top;
	}

	const width = s.w - lead * 2;
	const picked = wizard.values.agents;
	const full = picked.length >= maximumAgents;
	const count = `${picked.length} of ${maximumAgents} picked`;
	s.put(lead, top, cut('Installed agents', width - count.length - 2, g.ell), {
		c: 'c-dim',
	});
	const counted = popped(context, 'agents:count', p.acc);
	s.put(lead + width - count.length, top, count, {c: 'c-dim'});
	s.put(lead + width - count.length, top, String(picked.length), {
		c: 'c-acc',
		fg: counted.fg,
	});

	const y0 = top + 1;
	box(s, context, lead, y0, width, agentIds.length + 2, {edge: p.line});
	for (const [index, id] of agentIds.entries()) {
		const y = y0 + 1 + index;
		const key = `agent:${index}`;
		const installed = request.installedAgents.includes(id);
		const on = picked.includes(id);
		const current = wizard.agent === index;
		const limited = full && !on && installed;
		const hover = installed ? context.hover(key) : 0;
		const dx = shakeOf(context, key);
		s.hit(lead + 1, y, width - 2, 1, key);
		if (current || hover > 0) {
			s.paint(
				lead + 1,
				y,
				width - 2,
				1,
				current ? p.sel : mix(p.bg, p.sel, hover),
			);
		}

		// The cursor fades in from the left when the row becomes the current one.
		const moved = running(
			context.ui.fx,
			`cursor:${index}`,
			context.now,
			duration.hover,
		);
		const seen = current ? (moved === undefined ? 1 : ease.out(moved)) : 0;
		if (seen > 0) {
			s.put(lead + 2 + (seen < 0.5 ? -1 : 0) + 1, y, g.tri, {
				c: 'c-acc',
				fg: mix(p.bg, p.acc, seen),
			});
		}

		const dim = limited ? 0.5 : 1;
		const faint = (colour: string): string =>
			mix(current ? p.sel : p.bg, colour, dim);
		const pop = popped(context, key, p.acc);
		const glyph = installed ? (on ? g.pickOn : g.pickOff) : g.pickNo;
		s.put(lead + 4 + dx, y, glyph, {
			c: on ? 'c-acc' : 'c-faint',
			fg: on ? (pop.hot ? pop.fg : p.acc) : faint(p.faint),
		});
		s.put(lead + 9 + dx, y, id, {
			c: installed ? (on ? 'b' : 'c-fg') : 'c-faint',
			fg: installed ? faint(p.fg) : p.faint,
		});
		const command = agentCommands[id];
		const meta = installed
			? limited
				? 'limit reached'
				: command === id
				? ''
				: command
			: 'not installed';
		const metaAt = lead + width - 3 - [...meta].length;
		// A hint that would touch the name is left out; the name is what matters.
		if (metaAt - (lead + 9 + [...id].length) >= 2) {
			s.put(metaAt + dx, y, meta, {c: 'c-faint', fg: faint(p.faint)});
		}
	}

	return y0 + agentIds.length + 2;
}

function drawReview(
	s: Surface,
	context: Context,
	top: number,
	space: Spacing,
): number {
	const {p, g, now, ui, frame} = context;
	const {wizard, request} = frame;
	if (wizard === undefined || request === undefined) {
		return top;
	}

	const width = s.w - lead * 2;
	const fields = (
		['prefix', 'tmux', 'agents', 'copyIgnored', 'mcAlias'] as const
	).filter(field => availability(request, wizard.values, field) !== 'skipped');
	box(s, context, lead, top, width, fields.length + 2, {edge: p.line});
	for (const [index, field] of fields.entries()) {
		const y = top + 1 + index;
		const key = `row:${field}`;
		const hover = context.hover(key) || context.hover(`edit:${field}`);
		s.hit(lead + 1, y, width - 2, 1, key);
		if (hover > 0) {
			s.paint(lead + 1, y, width - 2, 1, mix(p.bg, p.sel, hover));
		}

		s.put(lead + 2, y, labels[field], {c: 'c-dim'});
		const value =
			field === 'prefix'
				? wizard.values.prefix
				: field === 'agents'
				? wizard.values.agents.length > 0
					? wizard.values.agents.join(', ')
					: 'none'
				: wizard.values[field]
				? 'on'
				: 'off';
		const tagged = !isDefault(request, wizard.values, field);
		const flag = request.fromFlags[field];
		const tail = flag === undefined ? 4 : [...flag].length;
		const room = width - 2 - 22 - 2 - tail - 1 - (tagged ? 10 : 0);
		let at = s.put(lead + 2 + 22, y, cut(value, Math.max(4, room), g.ell), {
			c: 'b',
		});
		if (tagged) {
			const edge = mix(p.bg, p.acc, 0.5);
			s.put(at + 1, y, g.capL, {c: 'c-faint', fg: edge});
			at = s.put(at + 2, y, 'CHANGED', {c: 'c-acc', fg: p.acc});
			s.put(at, y, g.capR, {c: 'c-faint', fg: edge});
		}

		if (flag === undefined) {
			link(s, context, lead + width - 2 - 4, y, 'edit', `edit:${field}`);
		} else {
			s.put(lead + width - 2 - [...flag].length, y, flag, {c: 'c-faint'});
		}
	}

	// The same thing as a command, with each flag kept whole when it wraps.
	let y = top + fields.length + 2 + (space.compact ? 0 : 1);
	const units = scriptCommand(request, wizard.values)
		.split(/ (?=--)/)
		.flatMap(part => {
			const [first, ...rest] = part.split(' ');
			return part.startsWith('trunk-cli')
				? [{text: first!}, ...rest.map(word => ({text: word}))]
				: [{text: part}];
		});
	const inner = width - 4 - 2;
	const lines = flow(units, inner);
	const boxH = lines.length + 3;
	box(s, context, lead, y, width, boxH, {edge: p.line, dashed: true});
	s.put(lead + 2, y + 1, 'SAME AS A COMMAND', {c: 'c-faint'});
	const copied =
		ui.copied !== undefined && now - ui.copied.at < duration.copied;
	const label = copied ? `copied ${g.tick}` : 'copy';
	if (copied) {
		s.put(lead + width - 2 - label.length, y + 1, label, {c: 'c-ok', fg: p.ok});
	} else {
		link(s, context, lead + width - 2 - label.length, y + 1, label, 'copy');
	}

	for (const [index, line] of lines.entries()) {
		let at = lead + 2;
		if (index === 0) {
			at = s.put(at, y + 2, '$ ', {c: 'c-dim'});
		} else {
			at += 2;
		}

		for (const unit of line) {
			at = s.put(at, y + 2 + index, `${unit.text} `, {c: 'c-fg', fg: p.fg});
		}
	}

	y += boxH + (space.compact ? 0 : 1);

	// The button: one row, as bright as the accent, with the key it answers to.
	const hover = context.hover('go');
	const face = ` Create project  ${g.enter} `;
	s.put(lead, y, face, {
		c: 'pill',
		fg: p.accInk,
		bg: mix(p.acc, p.fg, 0.14 * hover),
		k: 'go',
	});
	return y + 1;
}

/** Where a stage's panel starts, below its heading. */
export function drawPanel(
	s: Surface,
	context: Context,
	stage: Stage,
	space: Spacing,
): number {
	const {request, wizard} = context.frame;
	if (request === undefined || wizard === undefined) {
		return 0;
	}

	const top = heading(
		s,
		context,
		{
			eyebrow: eyebrow(request, wizard, stage),
			title: stage === 'review' ? 'Review' : labels[stage],
			help:
				stage === 'review'
					? 'Nothing is written until you create the project. Each choice is also a flag.'
					: help[stage],
		},
		space,
	);
	switch (stage) {
		case 'prefix': {
			return drawPrefix(s, context, top);
		}

		case 'agents': {
			return drawAgents(s, context, top);
		}

		case 'review': {
			return drawReview(s, context, top, space);
		}

		default: {
			return drawChoices(s, context, top, stage);
		}
	}
}
