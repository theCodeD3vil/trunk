/**
 * The setup form: five questions, one open at a time, with a live preview of
 * what the answers generate. State and key handling are pure; the layout is a
 * two-pane view from 100 columns up and a single column with a one-line
 * preview below that.
 */
import {maximumAgents, type AgentId} from '../../core/agents.js';
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
	/** Which agent chip the cursor is on. */
	cursor: number;
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
	agents: `Each starts in its own pane of an Agents window, up to ${maximumAgents}. Only agents installed on this machine are offered.`,
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

export function setupKey(
	request: ConfigureRequest,
	state: SetupState,
	key: string,
): SetupStep {
	const fields = focusableFields(request, state.values);
	const index = Math.min(state.field, Math.max(0, fields.length - 1));
	const current = fields[index];
	const same = (next: Partial<SetupState>): SetupStep => ({
		state: {...state, field: index, ...next},
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

	if (current === 'agents') {
		const count = request.installedAgents.length;
		// A click on a chip moves the cursor there and toggles it.
		if (key.startsWith('agent:')) {
			const target = Number(key.slice('agent:'.length));
			const agent = request.installedAgents[target];
			return agent === undefined
				? same({})
				: same({
						cursor: target,
						values: {
							...state.values,
							agents: withAgents(request, state.values, agent),
						},
				  });
		}

		if (key === 'left') {
			return same({cursor: (state.cursor + count - 1) % count});
		}

		if (key === 'right') {
			return same({cursor: (state.cursor + 1) % count});
		}

		if (key === 'space') {
			const agent = request.installedAgents[state.cursor];
			return agent === undefined
				? same({})
				: same({
						values: {
							...state.values,
							agents: withAgents(request, state.values, agent),
						},
				  });
		}

		return {state, done: false, handled: false};
	}

	if (
		current !== 'prefix' &&
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
		const chips: Part[] = [];
		for (const [index, agent] of request.installedAgents.entries()) {
			const on = values.agents.includes(agent);
			const cursor = index === state.cursor;
			chips.push(
				[
					` ${on ? g.chk : g.unchk} ${agent} `,
					cursor ? (on ? 'pill' : 'pill-dim') : on ? 'chip-on' : 'c-dim',
					`agent:${index}`,
				],
				' ',
			);
		}

		out.push(rail(...chips));
		if (request.missingAgents.length > 0) {
			out.push(
				...railed(
					wrapLines(
						`${request.missingAgents.join(', ')} not found on PATH.`,
						width - 3,
					),
				),
			);
		}

		out.push(...railed(wrapLines(help.agents, width - 3)));
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

/** The right-hand panel: exactly the hooks the current answers produce. */
/** Makes every part of a line that has no key of its own send `key` when clicked. */
function clickable(l: Line, key: string): Line {
	return {
		...l,
		segs: l.segs.map(seg => (seg.k === undefined ? {...seg, k: key} : seg)),
	};
}

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
			out.push(
				line(['      ', ''], [`${g.tee}${g.h} `, 'c-faint'], 'Agents ', [
					values.agents.join(' '),
					'c-acc',
				]),
			);
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
	const compact = options.rows < 30;
	const left: Line[] = [
		line(['Configure worktree automation', 'b']),
		line(['Five choices. You can edit the file later.', 'c-dim']),
		line(),
	];
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
		);
		// The header row of a field is a click target that opens it.
		left.push(
			...(position !== -1 && rows[0] !== undefined
				? [clickable(rows[0], `setup:${position}`), ...rows.slice(1)]
				: rows),
		);
		if (!compact) {
			left.push(
				line([index === visible.length - 1 ? g.end : g.rail, 'c-faint']),
			);
		}
	}

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

		const size = generatedSize(request, values);
		const aliases = [
			values.tmux || values.copyIgnored ? 'wt up' : undefined,
			values.mcAlias ? 'wt mc' : undefined,
		].filter((alias): alias is string => alias !== undefined);
		const summary = values.tmux
			? `${
					validatePrefix(values.prefix).valid ? values.prefix : g.ell
			  }_<branch> ${g.mid} ${size?.hooks ?? 0} hooks${
					aliases.length > 0 ? ` ${g.mid} ${aliases.join(', ')}` : ''
			  }`
			: 'no tmux workspace';
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
					[g.leftright, 'move'],
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
