/**
 * The existing-config screen: a summary bar, then a scrollable diff with line
 * numbers, hunk titles and collapsed unchanged runs, and the decision. Keeping
 * is preselected and Esc keeps, so pressing keys without reading changes nothing.
 * Nothing here parses the old file; hunk titles only borrow the nearest TOML
 * table header for orientation.
 */
import {diffLines} from '../../core/diff.js';
import type {OverwriteRequest} from '../../core/session.js';
import {margin, type Kit, type Line} from '../kit/lines.js';

export type DiffRow =
	| Readonly<{kind: 'hunk'; text: string}>
	| Readonly<{kind: 'skip'; count: number}>
	| Readonly<{
			kind: 'context' | 'added' | 'removed';
			old: number | undefined;
			next: number | undefined;
			text: string;
	  }>;

export type OverwriteModel = Readonly<{
	rows: readonly DiffRow[];
	added: number;
	removed: number;
	hunks: number;
	existingLines: number;
}>;

const context = 2;
const header = /^\s*\[{1,2}([\w.-]+)]{1,2}\s*$/;

/** Numbers the diff, collapses long unchanged runs, and titles each change. */
export function buildOverwriteModel(
	existing: string,
	generated: string,
): OverwriteModel {
	const diff = diffLines(existing, generated);
	let old = 0;
	let next = 0;
	const numbered = diff.lines.map(entry => {
		if (entry.kind !== 'added') {
			old++;
		}

		if (entry.kind !== 'removed') {
			next++;
		}

		return {
			kind: entry.kind,
			old: entry.kind === 'added' ? undefined : old,
			next: entry.kind === 'removed' ? undefined : next,
			text: entry.text,
		};
	});

	// A line is kept when it is a change or within `context` lines of one.
	const keep = new Set<number>();
	for (const [index, entry] of numbered.entries()) {
		if (entry.kind === 'context') {
			continue;
		}

		for (
			let near = Math.max(0, index - context);
			near <= Math.min(numbered.length - 1, index + context);
			near++
		) {
			keep.add(near);
		}
	}

	const rows: DiffRow[] = [];
	let skipped = 0;
	let hunks = 0;
	let inChange = false;
	for (const [index, entry] of numbered.entries()) {
		if (!keep.has(index)) {
			skipped++;
			continue;
		}

		if (skipped > 0) {
			rows.push({kind: 'skip', count: skipped});
			skipped = 0;
			inChange = false;
		}

		if (entry.kind !== 'context' && !inChange) {
			inChange = true;
			hunks++;
			const title = nearestTitle(
				numbered.slice(0, index + 1).map(item => item.text),
			);
			rows.push({kind: 'hunk', text: title});
		}

		rows.push({
			kind: entry.kind,
			old: entry.old,
			next: entry.next,
			text: entry.text,
		});
	}

	if (skipped > 0) {
		rows.push({kind: 'skip', count: skipped});
	}

	return {
		rows,
		added: diff.added,
		removed: diff.removed,
		hunks,
		existingLines:
			existing.split(/\r?\n/).length - (existing.endsWith('\n') ? 1 : 0),
	};
}

function nearestTitle(before: readonly string[]): string {
	for (let index = before.length - 1; index >= 0; index--) {
		const found = header.exec(before[index] ?? '');
		if (found?.[1] !== undefined) {
			return found[1];
		}
	}

	return 'top of file';
}

export type OverwriteState = Readonly<{
	scroll: number;
	sel: number;
	onlyRemoved: boolean;
}>;

export const initialOverwrite: OverwriteState = {
	scroll: 0,
	sel: 0,
	onlyRemoved: false,
};

export type OverwriteStep = Readonly<{
	state: OverwriteState;
	answer?: 'keep' | 'replace';
}>;

export function overwriteKey(
	state: OverwriteState,
	key: string,
): OverwriteStep {
	if (key === 'up' || key === 'k') {
		return {state: {...state, scroll: Math.max(0, state.scroll - 1)}};
	}

	if (key === 'down' || key === 'j') {
		return {state: {...state, scroll: state.scroll + 1}};
	}

	if (key === 'r') {
		return {state: {...state, onlyRemoved: !state.onlyRemoved, scroll: 0}};
	}

	if (key === 'left' || key === 'right') {
		return {state: {...state, sel: 1 - state.sel}};
	}

	if (key === 'esc') {
		return {state, answer: 'keep'};
	}

	if (key === 'enter') {
		return {state, answer: state.sel === 0 ? 'keep' : 'replace'};
	}

	return {state};
}

function shownRows(
	model: OverwriteModel,
	onlyRemoved: boolean,
): readonly DiffRow[] {
	return onlyRemoved
		? model.rows.filter(row => row.kind === 'removed' || row.kind === 'hunk')
		: model.rows;
}

export function overwriteLines(
	kit: Kit,
	request: OverwriteRequest,
	model: OverwriteModel,
	state: OverwriteState,
	rows: number,
): Line[] {
	const {g, line, cols} = kit;
	const contentWidth = cols - margin * 2;
	const total = Math.max(1, model.added + model.removed);
	const bar = 12;
	const addBlocks =
		model.added === 0
			? 0
			: Math.max(1, Math.round((model.added / total) * bar));
	const body: Line[] = [
		...kit.header([request.command, 'existing config'], request.project),
		line(),
		line('  ', [`${request.path} already exists`, 'b']),
		line('  ', [
			`It has ${model.existingLines} lines. Replacing it drops ${model.removed} of yours and adds ${model.added}.`,
			'c-dim',
		]),
		line(
			'  ',
			[g.barOn.repeat(addBlocks), 'c-ok'],
			[g.barOn.repeat(bar - addBlocks), 'c-err'],
			'  ',
			[`${g.plus}${model.added}`, 'c-ok b'],
			'  ',
			[`${g.minus}${model.removed}`, 'c-err b'],
			[
				`   ${g.mid} ${model.hunks} hunk${model.hunks === 1 ? '' : 's'}${
					state.onlyRemoved ? `  ${g.mid} showing removed lines only` : ''
				}`,
				'c-dim',
			],
		),
		line(),
	];
	const visible = shownRows(model, state.onlyRemoved);
	const view = Math.max(5, Math.min(12, rows - 17));
	const scroll = Math.min(state.scroll, Math.max(0, visible.length - view));
	const textWidth = Math.max(10, contentWidth - 12);
	const window = visible.slice(scroll, scroll + view);
	for (const row of window) {
		if (row.kind === 'hunk') {
			body.push(
				line(
					'  ',
					[`${g.h}${g.h} ${row.text} `, 'c-acc'],
					[
						g.h.repeat(Math.max(1, contentWidth - row.text.length - 4)),
						'c-faint',
					],
				),
			);
		} else if (row.kind === 'skip') {
			body.push(
				line('  ', [
					`${' '.repeat(13)}${g.dots} ${row.count} unchanged line${
						row.count === 1 ? '' : 's'
					}`,
					'c-faint',
				]),
			);
		} else {
			const mark =
				row.kind === 'added' ? '+' : row.kind === 'removed' ? '-' : ' ';
			const entry = line(
				'  ',
				[String(row.old ?? '').padStart(4), 'c-faint'],
				' ',
				[String(row.next ?? '').padStart(4), 'c-faint'],
				[
					` ${mark} `,
					row.kind === 'added'
						? 'c-ok b'
						: row.kind === 'removed'
						? 'c-err b'
						: 'c-faint',
				],
				[
					[...row.text].slice(0, textWidth).join(''),
					row.kind === 'context' ? 'c-dim' : '',
				],
			);
			body.push(
				row.kind === 'added'
					? kit.withBg(entry, 'add')
					: row.kind === 'removed'
					? kit.withBg(entry, 'del')
					: entry,
			);
		}
	}

	for (let index = window.length; index < view; index++) {
		body.push(line());
	}

	body.push(
		line('  ', [
			`lines ${visible.length === 0 ? 0 : scroll + 1}${g.dash}${Math.min(
				visible.length,
				scroll + view,
			)} of ${visible.length}`,
			'c-faint',
		]),
		line(),
		line('  ', ["Replace it with Trunk's version?", 'b']),
		line('  ', ...kit.choice(['Keep mine', 'Replace'], state.sel), [
			'   Keeping is the default and changes nothing.',
			'c-dim',
		]),
	);
	return kit.frame(
		body,
		kit.keybar([
			[g.updown, 'scroll'],
			['r', state.onlyRemoved ? 'show all' : 'only removals'],
			[g.leftright, 'choose'],
			[g.enter, 'confirm'],
		]),
		{maxRows: rows},
	);
}
