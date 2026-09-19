/**
 * Errors and refusals as cards. Every one has the same shape: what happened, how
 * to fix it, what was left behind, and the exit code, so a failure reads the
 * same whichever way it happens and the next command is always visible.
 */
import type {FailureRequest} from '../../core/session.js';
import {margin, type Kit, type Line} from '../kit/lines.js';

function cardWidth(kit: Kit): number {
	return Math.min(kit.cols - margin * 2, 84);
}

/** A card in a tone, followed by a dim footer line and the exit code. */
function card(
	kit: Kit,
	tone: 'c-err' | 'c-warn',
	title: string,
	lines: readonly Line[],
	footer: string,
	exit: number,
): Line[] {
	const {line} = kit;
	return [
		line(),
		...kit.indent(
			kit.box(lines, cardWidth(kit), {
				title,
				titleStyle: `${tone} b`,
				borderStyle: tone,
			}),
			margin,
		),
		line(),
		line('  ', [footer, 'c-dim'], `   exit ${exit}`),
		line(),
	];
}

export function missingToolLines(
	kit: Kit,
	missing: readonly string[],
	command: string,
): Line[] {
	const {g, line} = kit;
	const names = missing.map(name =>
		name === 'wt' ? 'Worktrunk' : name === 'git' ? 'Git' : name,
	);
	const width = cardWidth(kit) - 4;
	return card(
		kit,
		'c-err',
		`${g.cross} ${names.join(' and ')} ${
			names.length > 1 ? "aren't" : "isn't"
		} installed`,
		[
			...kit.wrapLines(
				`Trunk needs ${missing
					.map(name => `\`${name}\``)
					.join(' and ')} on your PATH to set up worktrees, and ${
					missing.length > 1 ? 'they were' : 'it was'
				} not found.`,
				width,
				'c-fg',
			),
			line(),
			line(
				['Fix   ', 'c-acc b'],
				`Install ${names.join(' and ')}, then run this command again.`,
			),
			line(['      ', ''], ['https://worktrunk.dev', 'c-info u']),
			line(['Then  ', 'c-acc b'], [command, 'b']),
		],
		'Nothing was created.',
		3,
	);
}

export type NormalCloneInput = Readonly<{
	name: string;
	url: string;
	unsaved: readonly string[];
}>;

export function normalCloneLines(kit: Kit, input: NormalCloneInput): Line[] {
	const {g, line} = kit;
	const width = cardWidth(kit) - 4;
	const unsaved =
		input.unsaved.length > 0
			? ` It still holds ${input.unsaved.join(
					' and ',
			  )}, so it left everything alone.`
			: ' It left everything alone.';
	return card(
		kit,
		'c-warn',
		`${g.warn} ${input.name} is a normal clone`,
		[
			...kit.wrapLines(
				`Trunk sets up projects in Worktrunk's bare layout and never converts a checkout in place.${unsaved}`,
				width,
				'c-fg',
			),
			line(),
			line(['To move it across', 'c-acc b']),
			line(
				[' 1  ', 'c-dim'],
				[`trunk clone ${input.url} ${input.name}-wt`, 'b'],
			),
			line(
				[' 2  ', 'c-dim'],
				`copy any local-only files into ${input.name}-wt/<default branch>/`,
			),
			line(
				[' 3  ', 'c-dim'],
				`check nothing uncommitted or unpushed is left in ${input.name}`,
			),
			line(
				[' 4  ', 'c-dim'],
				[`rm -rf ${input.name} && mv ${input.name}-wt ${input.name}`, 'b'],
			),
		],
		'Nothing was changed.',
		3,
	);
}

export function emptyRepositoryLines(
	kit: Kit,
	name: string,
	rerun: string,
): Line[] {
	const {g, line} = kit;
	return card(
		kit,
		'c-err',
		`${g.cross} ${name} is an empty repository`,
		[
			...kit.wrapLines(
				'There is no commit to check out, and Trunk never creates history for you.',
				cardWidth(kit) - 4,
				'c-fg',
			),
			line(),
			line(
				['Fix   ', 'c-acc b'],
				'Make the first commit on your default branch,',
			),
			line(['Then  ', 'c-acc b'], [rerun, 'b']),
		],
		'No branch, commit or worktree was created.',
		2,
	);
}

export type FailureState = Readonly<{sel: number}>;

export type FailureStep = Readonly<{
	state: FailureState;
	answer?: 'keep' | 'rollback';
}>;

export function failureKey(
	request: FailureRequest,
	state: FailureState,
	key: string,
): FailureStep {
	if (!request.rollback) {
		return {
			state,
			answer: key === 'enter' || key === 'esc' ? 'keep' : undefined,
		};
	}

	if (key === 'left' || key === 'right') {
		return {state: {sel: 1 - state.sel}};
	}

	if (key === 'enter') {
		return {state, answer: state.sel === 1 ? 'rollback' : 'keep'};
	}

	return {state};
}

/** The interrupted-run card: the reason, what exists now, and keep or roll back. */
export function failureLines(
	kit: Kit,
	request: FailureRequest,
	state: FailureState,
	rows: number,
): Line[] {
	const {g, line} = kit;
	const width = cardWidth(kit) - 4;
	const detail = request.detail
		.split(/\r?\n/)
		.map(text => text.trim())
		.filter(Boolean)
		.slice(0, 6)
		.flatMap(text =>
			kit
				.wrap(text, width - 2)
				.map((piece, index) =>
					line([index === 0 ? '' : '  ', ''], [piece, 'c-warn']),
				),
		);
	// Room for the tree glyphs in front of the longest path, plus a gap.
	const nameWidth = Math.min(
		34,
		Math.max(...request.created.map(item => item.path.length + 3), 8) + 2,
	);
	const created = request.created.map((item, index) => {
		const last = index === request.created.length - 1;
		const prefix = index === 0 ? '' : `${last ? g.end : g.tee}${g.h} `;
		return line(
			[`${prefix}${item.path}`.padEnd(nameWidth), index === 0 ? 'b' : ''],
			[item.description, 'c-dim'],
		);
	});
	const body: Line[] = [
		...card(
			kit,
			'c-err',
			`${g.cross} ${request.title}`,
			[
				...detail,
				...(created.length > 0
					? [line(), line(['Created by this run', 'c-acc b']), ...created]
					: []),
			],
			request.rollback
				? 'Your work so far is kept unless you roll it back.'
				: 'Nothing was left behind.',
			1,
		),
	];
	if (request.rollback) {
		body.push(
			line('  ', [
				'Keep it to inspect, or roll back what this run created?',
				'b',
			]),
			line('  ', ...kit.choice(['Keep', 'Roll back'], state.sel)),
			line(),
			// On its own line: a clone URL makes this too long to share a row.
			line('  ', ['Resume later with', 'c-dim']),
			line('  ', [kit.fit(request.resume, kit.cols - margin * 2), 'c-fg']),
		);
	}

	return kit.frame(
		[...kit.header([request.command, 'stopped'], request.project), ...body],
		kit.keybar(
			request.rollback
				? [
						[g.leftright, 'choose'],
						[g.enter, 'confirm'],
				  ]
				: [[g.enter, 'close']],
		),
		{maxRows: rows},
	);
}

/** A refusal or error printed once and left in the scrollback. */
export function staticFrame(
	kit: Kit,
	crumbs: readonly string[],
	body: readonly Line[],
): Line[] {
	return [...kit.header(crumbs), ...body];
}
