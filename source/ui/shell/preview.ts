/**
 * The generated `.config/wt.toml`, as the preview under the form shows it: the
 * real file for the current answers, with the lines the open step is
 * responsible for lit. Which lines those are is not written down anywhere; it
 * is found by generating the file again with that answer flipped and taking
 * the lines that only the current file has. That keeps the preview honest
 * however the generator changes.
 */
import {diffLines} from '../../core/diff.js';
import {compose} from '../../core/generate/index.js';
import {validatePrefix} from '../../core/prefix.js';
import type {SetupValues} from '../../core/resolve.js';
import type {ConfigureRequest} from '../../core/session.js';
import type {Stage} from './wizard.js';

export type Preview = Readonly<{
	lines: readonly string[];
	/** Parallel to `lines`: which ones the open step produces. */
	hot: readonly boolean[];
}>;

const empty: Preview = {lines: [], hot: []};

// Valid prefixes that no real one will be, standing in while the form is open.
const standIn = 'trunk-preview-a';
const other = 'trunk-preview-b';

/** The same answers with the open step's answer turned the other way. */
function flipped(
	request: ConfigureRequest,
	values: SetupValues,
	stage: Stage,
): SetupValues | undefined {
	switch (stage) {
		case 'prefix': {
			return {...values, prefix: other};
		}

		case 'tmux': {
			return {...values, tmux: !values.tmux, agents: []};
		}

		case 'agents': {
			const first = request.installedAgents[0];
			return {
				...values,
				agents: values.agents.length > 0 || first === undefined ? [] : [first],
			};
		}

		case 'copyIgnored': {
			return {...values, copyIgnored: !values.copyIgnored};
		}

		case 'mcAlias': {
			return {...values, mcAlias: !values.mcAlias};
		}

		default: {
			return undefined;
		}
	}
}

export function buildPreview(
	request: ConfigureRequest,
	values: SetupValues,
	stage: Stage,
): Preview {
	try {
		const render = (answers: SetupValues): string =>
			compose(request.toSettings({...answers, prefix: answers.prefix}));
		// A prefix that is not valid yet cannot be composed, so a valid stand-in
		// is composed and swapped for what was typed.
		const shown = validatePrefix(values.prefix).valid;
		const current = render(shown ? values : {...values, prefix: standIn});
		const alternate = flipped(
			request,
			shown ? values : {...values, prefix: standIn},
			stage,
		);
		const text = shown
			? current
			: current.replaceAll(standIn, values.prefix === '' ? '…' : values.prefix);
		const lines = text.replace(/\n$/, '').split('\n');
		if (alternate === undefined) {
			return {lines, hot: lines.map(() => false)};
		}

		const hot: boolean[] = [];
		for (const entry of diffLines(render(alternate), current).lines) {
			if (entry.kind !== 'removed') {
				hot.push(entry.kind === 'added');
			}
		}

		return {lines, hot};
	} catch {
		return empty;
	}
}

/** A line as coloured runs: a comment, a table header, a key and its value, or shell. */
export function highlight(
	lines: readonly string[],
): ReadonlyArray<ReadonlyArray<Readonly<{t: string; c: string}>>> {
	let inBlock = false;
	return lines.map(line => {
		if (inBlock) {
			if (line.trim() === "'''") {
				inBlock = false;
				return [{t: line, c: 'c-ok'}];
			}

			return [{t: line, c: line.trimStart().startsWith('#') ? 'c-faint' : ''}];
		}

		if (line.startsWith('#')) {
			return [{t: line, c: 'c-faint'}];
		}

		if (line.startsWith('[')) {
			return [{t: line, c: 'c-info'}];
		}

		const pair = /^([\w-]+) = (.*)$/.exec(line);
		if (pair !== null) {
			if (pair[2] === "'''") {
				inBlock = true;
			}

			return [
				{t: pair[1]!, c: 'c-acc'},
				{t: ' = ', c: ''},
				{t: pair[2]!, c: 'c-ok'},
			];
		}

		return [{t: line, c: ''}];
	});
}

/** A line on screen, and whether the open step is responsible for it. */
export type Row = Readonly<{
	text: string;
	hot: boolean;
}>;

/** The rows for a preview. */
export function settle(next: Preview): Row[] {
	return next.lines.map((text, index) => ({
		text,
		hot: next.hot[index] ?? false,
	}));
}

/**
 * Where the window onto the file starts so the first lit line is inside it,
 * moving as little as it can.
 */
export function followTop(
	rows: readonly Row[],
	top: number,
	height: number,
): number {
	const first = rows.findIndex(row => row.hot);
	const limit = Math.max(0, rows.length - height);
	if (first === -1) {
		return Math.min(top, limit);
	}

	if (first < top) {
		return first;
	}

	return Math.min(limit, first >= top + height ? first - height + 1 : top);
}
