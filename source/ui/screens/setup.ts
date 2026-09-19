/**
 * The setup form: five questions, one open at a time, with a live preview of
 * what the answers generate. State and key handling are pure; the layout is a
 * two-pane view from 100 columns up and a single column with a one-line
 * preview below that.
 */
import {agentIds, maximumAgents, type AgentId} from '../../core/agents.js';
import {compose, expectedHooks} from '../../core/generate/index.js';
import {validatePrefix} from '../../core/prefix.js';
import type {SetupField, SetupValues} from '../../core/resolve.js';
import type {ConfigureRequest} from '../../core/session.js';
import {
	margin,
	type Kit,
	type KeyHint,
	type Line,
	type Part,
} from '../kit/lines.js';

export type SetupState = Readonly<{
	/** Index into the focusable fields. */
	field: number;
	values: SetupValues;
	/** Which installed agent the cursor is on, as an index into `installedAgents`. */
	cursor: number;
	/** Why the last key did nothing, shown under the agents list until the next key. */
	notice?: string;
}>;

const order: readonly SetupField[] = [
	'prefix',
	'tmux',
	'agents',
	'copyIgnored',
	'mcAlias',
];

const labels: Readonly<Record<SetupField, string>> = {
	prefix: 'Session prefix',
	tmux: 'tmux workspace',
	agents: 'Agents',
	copyIgnored: 'Copy ignored files',
	mcAlias: 'wt mc alias',
};

const help: Readonly<Record<Exclude<SetupField, 'prefix'>, string>> = {
	tmux: 'An Editor window and a two-pane Terminal window for every worktree.',
	agents: `Pick up to ${maximumAgents}. Each starts in its own pane of an Agents window.`,
	copyIgnored:
		'Runs wt step copy-ignored first, so caches arrive before the session opens.',
	mcAlias: 'wt mc merges with a commit message you write in $EDITOR.',
};

/** Every field the form shows. Agents need a session and something to pick. */
export function visibleFields(
	request: ConfigureRequest,
	values: SetupValues,
): SetupField[] {
	return order.filter(
		field =>
			field !== 'agents' || (values.tmux && request.installedAgents.length > 0),
	);
}

/** The fields the user can still change: a flag has already settled the rest. */
export function focusableFields(
	request: ConfigureRequest,
	values: SetupValues,
): SetupField[] {
	return visibleFields(request, values).filter(
		field => request.fromFlags[field] === undefined,
	);
}

export function initialSetup(request: ConfigureRequest): SetupState {
	return {field: 0, values: request.values, cursor: 0};
}

export type SetupStep = Readonly<{
	state: SetupState;
	done: boolean;
	handled: boolean;
}>;

function withAgents(
	request: ConfigureRequest,
	values: SetupValues,
	toggled: AgentId,
): readonly AgentId[] {
	const chosen = new Set(values.agents);
	if (chosen.has(toggled)) {
		chosen.delete(toggled);
	} else if (chosen.size < maximumAgents) {
		chosen.add(toggled);
	}

	// Canonical order, so the same selection always generates the same file.
	return request.installedAgents.filter(agent => chosen.has(agent));
}

/**
 * Keys inside the agents list. Up and down move the cursor through the
 * installed agents and cross into the neighbouring field at either end, so the
 * list never traps the keyboard. Space toggles; at the limit it says why it did
 * not. Returns undefined for keys the list leaves to the form.
 */
function agentsKey(
	request: ConfigureRequest,
	state: SetupState,
	key: string,
	same: (next: Partial<SetupState>) => SetupStep,
): SetupStep | undefined {
	const installed = request.installedAgents;
	const at = Math.min(state.cursor, Math.max(0, installed.length - 1));
	const toggle = (index: number): SetupStep => {
		const name = installed[index];
		if (name === undefined) {
			return same({});
		}

		if (
			!state.values.agents.includes(name) &&
			state.values.agents.length >= maximumAgents
		) {
			return same({
				cursor: index,
				notice: `${maximumAgents} is the most. Turn one off first.`,
			});
		}

		return same({
			cursor: index,
			values: {
				...state.values,
				agents: withAgents(request, state.values, name),
			},
		});
	};

	if (key.startsWith('agent:')) {
		// A click names the row by its place among every known agent.
		const name = agentIds[Number(key.slice('agent:'.length))];
		if (name === undefined) {
			return same({});
		}

		const index = installed.indexOf(name);
		return index === -1
			? same({notice: `${name} is not installed on this machine.`})
			: toggle(index);
	}

	if (key === 'up' && at > 0) {
		return same({cursor: at - 1});
	}

	if (key === 'down' && at < installed.length - 1) {
		return same({cursor: at + 1});
	}

	return key === 'space' ? toggle(at) : undefined;
}

export function setupKey(
	request: ConfigureRequest,
	state: SetupState,
	key: string,
): SetupStep {
	const fields = focusableFields(request, state.values);
	const index = Math.min(state.field, Math.max(0, fields.length - 1));
	const current = fields[index];
	const same = (next: Partial<SetupState>): SetupStep => ({
		// A notice explains the key before it; the next key clears it.
		state: {...state, field: index, notice: undefined, ...next},
		done: false,
		handled: true,
	});
	if (current === undefined) {
		return {state, done: key === 'enter', handled: key === 'enter'};
	}

	if (current === 'prefix') {
		if (key === 'backspace') {
			return same({
				values: {...state.values, prefix: state.values.prefix.slice(0, -1)},
			});
		}

		if ([...key].length === 1 && key >= ' ') {
			return state.values.prefix.length < 30
				? same({values: {...state.values, prefix: state.values.prefix + key}})
				: same({});
		}
	}

	// A click on a field's row opens it.
	if (key.startsWith('setup:')) {
		const target = Number(key.slice('setup:'.length));
		return same({field: Math.min(fields.length - 1, Math.max(0, target))});
	}

	if (current === 'agents') {
		const step = agentsKey(request, state, key, same);
		if (step !== undefined) {
			return step;
		}
	}

	if (key === 'up') {
		return same({field: Math.max(0, index - 1)});
	}

	if (key === 'down') {
		return same({field: Math.min(fields.length - 1, index + 1)});
	}

	if (key === 'enter') {
		if (current === 'prefix' && !validatePrefix(state.values.prefix).valid) {
			return same({});
		}

		return index === fields.length - 1
			? {state: {...state, field: index}, done: true, handled: true}
			: same({field: index + 1});
	}

	if (
		current !== 'prefix' &&
		current !== 'agents' &&
		['left', 'right', 'space', 'on', 'off'].includes(key)
	) {
		// `on` and `off` are clicks on the two options; the rest flip the value.
		const flipped =
			key === 'on' || key === 'off' ? key === 'on' : !state.values[current];
		const values: SetupValues = {...state.values, [current]: flipped};
		// Agents live in the tmux session, so turning it off turns them off.
		return same({
			values: current === 'tmux' && !flipped ? {...values, agents: []} : values,
		});
	}

	return {state, done: false, handled: false};
}

/** How many lines the generated file will have, or undefined when it cannot be built. */
export function generatedSize(
	request: ConfigureRequest,
	values: SetupValues,
): {lines: number; hooks: number} | undefined {
	try {
		const settings = request.toSettings(values);
		return {
			lines: compose(settings).split('\n').length - 1,
			hooks: expectedHooks(settings).length,
		};
	} catch {
		return undefined;
	}
}

function valueParts(values: SetupValues, field: SetupField): Part[] {
	if (field === 'prefix') {
		return validatePrefix(values.prefix).valid
			? [[values.prefix, 'c-fg']]
			: [[values.prefix === '' ? 'empty' : values.prefix, 'c-err']];
	}

	if (field === 'agents') {
		return values.agents.length > 0
			? [[values.agents.join(' '), 'c-acc']]
			: [['none', 'c-dim']];
	}

	return values[field] ? [['on', 'c-acc']] : [['off', 'c-dim']];
}

/** How much room the form has: rows of the agents list, and how many spacers it can afford. */
type Layout = Readonly<{
	agentRows: number;
	/** 0 keeps every spacer, 1 drops the ones between collapsed fields, 2 drops the subtitle too. */
	level: 0 | 1 | 2;
}>;

/** One agent: cursor, checkbox, name, and why it cannot be picked. */
function agentRow(
	kit: Kit,
	request: ConfigureRequest,
	state: SetupState,
	name: AgentId,
	width: number,
	more: string,
): Line {
	const {g, line} = kit;
	const installed = request.installedAgents.includes(name);
	const on = state.values.agents.includes(name);
	const cursor = installed && request.installedAgents[state.cursor] === name;
	const full = state.values.agents.length >= maximumAgents && !on;
	const key = `agent:${agentIds.indexOf(name)}`;
	// The cursor row is tinted to the edge of its column, so focus and choice differ.
	const tint = cursor ? ' tint' : '';
	const box: Part = installed
		? on
			? [g.boxOn, `c-acc b${tint}`, key]
			: [g.boxOff, `${cursor ? 'c-fg' : 'c-dim'}${tint}`, key]
		: [g.boxNo, 'c-faint', key];
	const status = installed ? (full ? 'limit reached' : '') : 'not installed';
	const row = line(
		[cursor ? `${g.tri} ` : '  ', `c-acc b${tint}`, key],
		box,
		[' ', tint, key],
		[
			name.padEnd(14),
			`${installed ? (on || cursor ? 'b' : 'c-fg') : 'c-faint'}${tint}`,
			key,
		],
		[status, `c-faint${tint}`, key],
	);
	const padded =
		more === ''
			? kit.padTo(row, width - 3)
			: kit.justify(row, line([more, `c-faint${tint}`, key]), width - 3);
	return cursor
		? {
				...padded,
				segs: padded.segs.map(seg =>
					seg.c.includes('tint')
						? seg
						: {...seg, c: `${seg.c} tint`.trim(), k: key},
				),
		  }
		: padded;
}

/** The open agents field: a hint, a window onto the list, and a live count. */
function agentsBlock(
	kit: Kit,
	request: ConfigureRequest,
	state: SetupState,
	width: number,
	layout: Layout,
): Line[] {
	const {g, line} = kit;
	const rail = (...parts: Part[]): Line =>
		line([`${g.rail}  `, 'c-faint'], ...parts);
	const chosen = state.values.agents.length;
	const out: Line[] = kit
		.wrapLines(help.agents, width - 3)
		.map(l => line([`${g.rail}  `, 'c-faint'], ...l.segs));
	if (layout.level === 0) {
		out.push(rail());
	}

	// A short terminal gets a window that follows the cursor; what lies above
	// and below it is counted on its first and last row.
	const shown = Math.min(layout.agentRows, agentIds.length);
	const at = Math.max(
		0,
		agentIds.indexOf(request.installedAgents[state.cursor] ?? agentIds[0]!),
	);
	const start = Math.max(
		0,
		Math.min(agentIds.length - shown, at - Math.floor(shown / 2)),
	);
	for (const [index, name] of agentIds.slice(start, start + shown).entries()) {
		const more =
			index === 0 && start > 0
				? `${g.less} ${start} more`
				: index === shown - 1 && start + shown < agentIds.length
				? `${g.more} ${agentIds.length - start - shown} more`
				: '';
		const row = agentRow(kit, request, state, name, width, more);
		out.push({...row, segs: [{t: `${g.rail}  `, c: 'c-faint'}, ...row.segs]});
	}

	if (state.notice !== undefined) {
		out.push(rail([`${g.warn} `, 'c-warn'], [state.notice, 'c-warn']));
	} else if (chosen >= maximumAgents) {
		out.push(
			rail(
				[`${chosen} of ${maximumAgents} selected`, 'c-acc'],
				[`  ${g.mid} turn one off to pick another`, 'c-dim'],
			),
		);
	} else {
		out.push(
			rail([
				`${chosen} of ${maximumAgents} selected`,
				chosen > 0 ? 'c-acc' : 'c-dim',
			]),
		);
	}

	return out;
}

function fieldLines(
	kit: Kit,
	request: ConfigureRequest,
	state: SetupState,
	field: SetupField,
	active: boolean,
	position: number,
	total: number,
	width: number,
	caret: boolean,
	layout: Layout,
): Line[] {
	const {g, line, justify, wrapLines} = kit;
	const {values} = state;
	const marker: Part = active ? [g.diaF, 'c-acc'] : [g.diaO, 'c-dim'];
	const flag = request.fromFlags[field];
	if (!active) {
		const value = valueParts(values, field);
		const tag: Part[] = flag === undefined ? [] : [[`${flag} `, 'c-faint']];
		return [
			justify(
				line(marker, ' ', [labels[field], 'c-fg']),
				line(...tag, ...value, ' '),
				width,
			),
		];
	}

	const rail = (...parts: Part[]): Line =>
		line([`${g.rail}  `, 'c-faint'], ...parts);
	const railed = (lines: readonly Line[]): Line[] =>
		lines.map(l => line([`${g.rail}  `, 'c-faint'], ...l.segs));
	const out: Line[] = [
		justify(
			line(marker, ' ', [labels[field], 'b c-acc']),
			line([`${position + 1} of ${total} `, 'c-dim']),
			width,
		),
	];
	if (field === 'prefix') {
		const check = validatePrefix(values.prefix);
		out.push(
			rail(
				[values.prefix, check.valid ? 'b u' : 'b c-err u'],
				[caret ? g.caret : ' ', 'c-acc'],
			),
		);
		if (check.valid) {
			out.push(
				...railed(
					wrapLines(
						`Sessions are named ${values.prefix}_<branch>. Keep it unique across your repos.`,
						width - 3,
					),
				),
			);
		} else {
			const [first = '', ...rest] = kit.wrap(check.reason, width - 5);
			out.push(rail([`${g.cross} ${first}`, 'c-err']));
			for (const extra of rest) {
				out.push(rail(['  ', ''], [extra, 'c-err']));
			}
		}
	} else if (field === 'agents') {
		out.push(...agentsBlock(kit, request, state, width, layout));
	} else {
		out.push(
			rail(
				...kit.choice(['on', 'off'], values[field] ? 0 : 1, true, [
					'on',
					'off',
				]),
			),
			...railed(wrapLines(help[field], width - 3)),
		);
	}

	return out;
}

/** Makes every part of a line that has no key of its own send `key` when clicked. */
function clickable(l: Line, key: string): Line {
	return {
		...l,
		segs: l.segs.map(seg => (seg.k === undefined ? {...seg, k: key} : seg)),
	};
}

/** The right-hand panel: exactly the hooks the current answers produce. */
export function previewLines(
	kit: Kit,
	request: ConfigureRequest,
	values: SetupValues,
	width: number,
): Line[] {
	const {g, line} = kit;
	const {valid} = validatePrefix(values.prefix);
	const tone = valid ? 'c-dim' : 'c-faint';
	const out: Line[] = [
		line(
			['Session  ', tone],
			[
				valid ? `${values.prefix}_<branch>` : 'fix the prefix',
				valid ? 'b' : 'c-err',
			],
		),
		line(),
		line(['When a worktree starts', 'c-acc b']),
	];
	let count = 0;
	if (values.copyIgnored) {
		out.push(line([` ${++count}  `, 'c-dim'], 'copy ignored files'));
	}

	if (values.tmux) {
		out.push(
			line([` ${++count}  `, 'c-dim'], 'open the tmux workspace'),
			line(['      ', ''], [`${g.tee}${g.h} `, 'c-faint'], 'Editor'),
		);
		if (values.agents.length > 0) {
			// Four long names would overflow the panel, so they wrap under the first.
			const room = Math.max(12, width - 4 - 6 - 3 - 8);
			for (const [index, names] of kit
				.wrap(values.agents.join(', '), room)
				.entries()) {
				out.push(
					line(
						['      ', ''],
						[index === 0 ? `${g.tee}${g.h} ` : `${g.rail}  `, 'c-faint'],
						index === 0 ? 'Agents  ' : ' '.repeat(8),
						[names, 'c-acc'],
					),
				);
			}
		}

		out.push(
			line(['      ', ''], [`${g.end}${g.h} `, 'c-faint'], 'Terminal ', [
				'two panes',
				'c-dim',
			]),
		);
	}

	if (count === 0) {
		out.push(line([' nothing to run', 'c-dim']));
	}

	out.push(line(), line(['When it is removed', 'c-acc b']));
	if (values.tmux) {
		out.push(
			line([' 1  ', 'c-dim'], 'stop what runs in the session'),
			line([' 2  ', 'c-dim'], 'close ', [
				`${valid ? values.prefix : g.ell}_<branch>`,
				'c-fg',
			]),
		);
	} else {
		out.push(line([' nothing to clean up', 'c-dim']));
	}

	const aliases = [
		values.tmux || values.copyIgnored ? 'wt up' : undefined,
		values.mcAlias ? 'wt mc' : undefined,
	].filter((alias): alias is string => alias !== undefined);
	out.push(
		line(),
		line(
			['Aliases  ', 'c-dim'],
			[
				aliases.length > 0 ? aliases.join('  ') : 'none',
				aliases.length > 0 ? 'c-fg' : 'c-dim',
			],
		),
	);
	const size = generatedSize(request, values);
	out.push(
		line(),
		line([
			size === undefined
				? 'fix the prefix to see the file'
				: `${size.lines} lines ${g.mid} ${size.hooks} hooks ${g.mid} no project stack`,
			'c-dim',
		]),
	);
	return kit.box(out, width, {
		title: 'Preview',
		tag: '.config/wt.toml',
		titleStyle: 'c-acc b',
	});
}

/**
 * The first layout that fits `area` rows: the most agent rows first, and for
 * each count the roomiest spacing. Undefined when nothing fits.
 */
function fitLayout(
	area: number,
	build: (layout: Layout) => Line[],
	most: number,
): Line[] | undefined {
	for (let agentRows = most; agentRows >= 3; agentRows--) {
		for (const level of [0, 1, 2] as const) {
			const candidate = build({agentRows, level});
			if (candidate.length <= area) {
				return candidate;
			}
		}
	}

	return undefined;
}

export type SetupViewOptions = Readonly<{caret: boolean; rows: number}>;

export function setupLines(
	kit: Kit,
	request: ConfigureRequest,
	state: SetupState,
	options: SetupViewOptions,
): Line[] {
	const {cols, g, line, padTo, clip, indent, box} = kit;
	const {values} = state;
	const visible = visibleFields(request, values);
	const focusable = focusableFields(request, values);
	const active =
		focusable[Math.min(state.field, Math.max(0, focusable.length - 1))];
	const wide = cols >= 100;
	const leftWidth = wide ? 52 : cols - 4;
	const size = generatedSize(request, values);
	const aliases = [
		values.tmux || values.copyIgnored ? 'wt up' : undefined,
		values.mcAlias ? 'wt mc' : undefined,
	].filter((alias): alias is string => alias !== undefined);
	const agentCount = values.agents.length;
	const summary = values.tmux
		? `${
				validatePrefix(values.prefix).valid ? values.prefix : g.ell
		  }_<branch> ${g.mid} ${size?.hooks ?? 0} hooks${
				agentCount > 0
					? ` ${g.mid} ${agentCount} agent${agentCount === 1 ? '' : 's'}`
					: ''
		  }${aliases.length > 0 ? ` ${g.mid} ${aliases.join(', ')}` : ''}`
		: 'no tmux workspace';
	// One row is left free, then the header with its rule and blank line, the
	// key bar with its rule, and below 100 columns the one-line preview box.
	const area = options.rows - 1 - 3 - 2 - (wide ? 0 : 4);
	const build = (layout: Layout): Line[] => {
		const left: Line[] =
			layout.level < 2
				? [
						line(['Configure worktree automation', 'b']),
						line(['Five choices. You can edit the file later.', 'c-dim']),
						line(),
				  ]
				: [line(['Configure worktree automation', 'b'])];
		for (const [index, field] of visible.entries()) {
			const position = focusable.indexOf(field);
			const rows = fieldLines(
				kit,
				request,
				state,
				field,
				field === active,
				position,
				focusable.length,
				leftWidth,
				options.caret,
				layout,
			);
			// The header row of a field is a click target that opens it.
			left.push(
				...(position !== -1 && rows[0] !== undefined
					? [clickable(rows[0], `setup:${position}`), ...rows.slice(1)]
					: rows),
			);
			const last = index === visible.length - 1;
			if (layout.level === 0) {
				left.push(line([last ? g.end : g.rail, 'c-faint']));
			} else if (field === active && !last) {
				left.push(line([g.rail, 'c-faint']));
			}
		}

		return left;
	};

	// Keep as many agents on screen as fit, giving up spacers before list rows.
	const fitted = fitLayout(area, build, Math.max(6, agentIds.length));
	const left = fitted ?? build({agentRows: 3, level: 2});

	const body: Line[] = [
		...kit.header([request.command, 'configure'], request.project),
		line(),
	];
	if (wide) {
		const right = previewLines(
			kit,
			request,
			values,
			cols - margin * 2 - leftWidth - 3,
		);
		for (let index = 0; index < Math.max(left.length, right.length); index++) {
			const l = left[index];
			const r = right[index];
			body.push(
				line(
					'  ',
					...(l === undefined
						? [' '.repeat(leftWidth)]
						: padTo(clip(l, leftWidth), leftWidth).segs),
					'   ',
					...(r === undefined ? [] : r.segs),
				),
			);
		}
	} else {
		for (const l of left) {
			body.push(line('  ', ...clip(l, leftWidth).segs));
		}

		body.push(
			line(),
			...indent(
				box([line([summary, ''])], cols - 4, {
					title: 'Preview',
					tag: size === undefined ? '' : `${size.lines} lines`,
					titleStyle: 'c-acc b',
				}),
				margin,
			),
		);
	}

	const last = focusable.at(-1);
	const hints: KeyHint[] =
		active === 'prefix'
			? [
					['type', 'edit'],
					[g.updown, 'field', 'down'],
					[g.enter, 'next', 'enter'],
			  ]
			: active === 'agents'
			? [
					[g.updown, 'move'],
					['Space', 'toggle', 'space'],
					[g.enter, 'next', 'enter'],
			  ]
			: [
					[g.leftright, 'change'],
					['Space', 'toggle', 'space'],
					[g.enter, active === last ? 'review' : 'next', 'enter'],
			  ];
	return kit.frame(body, kit.keybar(hints), {
		maxRows: options.rows,
	});
}
