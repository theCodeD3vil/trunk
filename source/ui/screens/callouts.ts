/**
 * Errors and refusals as cards. Every one has the same shape: what happened, how
 * to fix it, what was left behind, and the exit code, so a failure reads the
 * same whichever way it happens and the next command is always visible.
 */
import type {FailureRequest} from '../../core/session.js';
import {margin, type Kit, type Line, type Part} from '../kit/lines.js';

function cardWidth(kit: Kit): number {
	return Math.min(kit.cols - margin * 2, 84);
}

/**
 * Commands that did not fit inside a card. They are shown below it, whole and
 * unclipped, so they can be copied and run; a command cut at the card's edge
 * would run against the wrong URL.
 */
type Overflow = string[];

/**
 * A card row that ends in a command. When the command fits, it sits in the row;
 * when it does not, the row says where to find it and the command goes below.
 */
function commandRow(
	kit: Kit,
	prefix: readonly Part[],
	command: string,
	inner: number,
	overflow: Overflow,
	placeholder: string,
): Line {
	const {line} = kit;
	const prefixWidth = kit.width(line(...prefix));
	if (prefixWidth + [...command].length <= inner) {
		return line(...prefix, [command, 'b']);
	}

	overflow.push(command);
	return line(...prefix, [placeholder, 'c-dim']);
}

/** A card in a tone, followed by a dim footer line and the exit code. */
function card(
	kit: Kit,
	tone: 'c-err' | 'c-warn',
	title: string,
	lines: readonly Line[],
	footer: string,
	exit: number,
	overflow: Overflow = [],
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
		...(overflow.length > 0
			? [
					line(),
					line('  ', ['In full, to copy', 'c-acc b']),
					...overflow.map(command => kit.soft(line('  ', [command, 'b']))),
			  ]
			: []),
		line(),
		line('  ', [footer, 'c-dim'], `   exit ${exit}`),
		line(),
	];
}

/** Why the tool matters, in the words of the proposal: what Trunk does through it. */
function missingReason(missing: readonly string[]): string {
	if (missing.length > 1) {
		return `Trunk needs ${missing
			.map(name => `\`${name}\``)
			.join(' and ')} on your PATH, and neither was found.`;
	}

	return missing[0] === 'git'
		? 'Trunk reads and clones repositories through the `git` command, and it was not found on your PATH.'
		: `Trunk creates worktrees through the \`${
				missing[0] ?? 'wt'
		  }\` command, and it was not found on your PATH.`;
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
	const overflow: Overflow = [];
	return card(
		kit,
		'c-err',
		`${g.cross} ${names.join(' and ')} ${
			names.length > 1 ? "aren't" : "isn't"
		} installed`,
		[
			...kit.wrapLines(missingReason(missing), width, 'c-fg'),
			line(),
			line(
				['Fix   ', 'c-acc b'],
				`Install ${names.join(' and ')}, then run this command again.`,
			),
			line(['      ', ''], ['https://worktrunk.dev', 'c-info u']),
			commandRow(
				kit,
				[['Then  ', 'c-acc b']],
				command,
				width,
				overflow,
				'run it again, in full below',
			),
		],
		'Nothing was created.',
		3,
		overflow,
	);
}

export type NormalCloneInput = Readonly<{
	name: string;
	url: string;
	unsaved: readonly string[];
	/** Named in the second step when known; otherwise the step says `<default branch>`. */
	branch?: string;
}>;

export function normalCloneLines(kit: Kit, input: NormalCloneInput): Line[] {
	const {g, line} = kit;
	const width = cardWidth(kit) - 4;
	const overflow: Overflow = [];
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
			commandRow(
				kit,
				[[' 1  ', 'c-dim']],
				`trunk clone ${input.url} ${input.name}-wt`,
				width,
				overflow,
				`clone it as ${input.name}-wt, command in full below`,
			),
			line(
				[' 2  ', 'c-dim'],
				`copy any local-only files into ${input.name}-wt/${
					input.branch ?? '<default branch>'
				}/`,
			),
			line(
				[' 3  ', 'c-dim'],
				`check nothing uncommitted or unpushed is left in ${input.name}`,
			),
			commandRow(
				kit,
				[[' 4  ', 'c-dim']],
				`rm -rf ${input.name} && mv ${input.name}-wt ${input.name}`,
				width,
				overflow,
				'swap the folders, command in full below',
			),
		],
		'Nothing was changed.',
		3,
		overflow,
	);
}

export function emptyRepositoryLines(
	kit: Kit,
	name: string,
	rerun: string,
): Line[] {
	const {g, line} = kit;
	const overflow: Overflow = [];
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
			commandRow(
				kit,
				[['Then  ', 'c-acc b']],
				rerun,
				cardWidth(kit) - 4,
				overflow,
				'run it again, in full below',
			),
		],
		'No branch, commit or worktree was created.',
		2,
		overflow,
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

	// A click on one of the two buttons answers at once.
	if (key === 'keep' || key === 'rollback') {
		return {state, answer: key};
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
		.flatMap((text, position, all) => {
			// `wt config show reported:` introduces what it said, which is indented.
			const lead = text.endsWith(':');
			const indented = position > 0 && all[position - 1]!.endsWith(':');
			return kit
				.wrap(text, width - 2)
				.map((piece, index) =>
					line(
						[index === 0 && !indented ? '' : '  ', ''],
						[piece, lead ? 'c-dim' : 'c-warn'],
					),
				);
		});
	// Room for the tree glyphs in front of the longest path, plus a gap.
	// The proposal's column is 26 wide; a longer path moves it out, to 34 at most.
	const nameWidth = Math.max(
		26,
		Math.min(
			34,
			Math.max(...request.created.map(item => item.path.length + 3), 8) + 2,
		),
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
	// The question is what the user must answer, so it is the one part of this
	// screen that is never trimmed when the terminal is short.
	const tail: Line[] = [];
	if (request.rollback) {
		const choice = kit.choice(['Keep', 'Roll back'], state.sel, true, [
			'keep',
			'rollback',
		]);
		const resumeLabel = '   Resume later with ';
		const choiceWidth = kit.width(kit.line(...choice));
		const fitsBeside =
			margin + choiceWidth + resumeLabel.length + [...request.resume].length <=
			kit.cols;
		// The card above already ends with a blank line.
		tail.push(
			line('  ', [
				'Keep it to inspect, or roll back what this run created?',
				'b',
			]),
			fitsBeside
				? line(
						'  ',
						...choice,
						[resumeLabel, 'c-dim'],
						[request.resume, 'c-dim'],
				  )
				: line('  ', ...choice),
			...(fitsBeside
				? []
				: [
						line(),
						line('  ', ['Resume later with', 'c-dim']),
						// The command is never clipped: it is meant to be copied.
						kit.soft(line('  ', [request.resume, 'c-fg'])),
				  ]),
		);
	}

	return kit.frame(
		[...kit.header([request.command, 'stopped'], request.project), ...body],
		kit.keybar(
			request.rollback
				? [
						[g.leftright, 'choose'],
						[g.enter, 'confirm', 'enter'],
				  ]
				: [[g.enter, 'close', 'enter']],
		),
		{maxRows: rows, tail},
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
