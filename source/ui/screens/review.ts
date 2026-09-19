/**
 * The review screen: what will be written, where each file lands, and the one
 * decision that starts the work. It is the consent for everything that follows,
 * so the run itself never asks again before committing.
 */
import type {ConfigureRequest} from '../../core/session.js';
import type {Settings} from '../../core/settings.js';
import {margin, type Kit, type Line} from '../kit/lines.js';

export type ReviewAction = 'create' | 'back' | 'cancel';

export type ReviewState = Readonly<{sel: number}>;

export type ReviewStep = Readonly<{state: ReviewState; action?: ReviewAction}>;

const actions: readonly ReviewAction[] = ['create', 'back', 'cancel'];

export function reviewKey(state: ReviewState, key: string): ReviewStep {
	if (key === 'left') {
		return {state: {sel: (state.sel + actions.length - 1) % actions.length}};
	}

	if (key === 'right') {
		return {state: {sel: (state.sel + 1) % actions.length}};
	}

	if (key === 'b' || key === 'esc' || key === 'back') {
		return {state, action: 'back'};
	}

	// Clicking an action runs it at once.
	if (key === 'go') {
		return {state: {sel: 0}, action: 'create'};
	}

	if (key === 'cancel') {
		return {state: {sel: 2}, action: 'cancel'};
	}

	if (key === 'enter') {
		return {state, action: actions[state.sel]};
	}

	return {state};
}

export function reviewLines(
	kit: Kit,
	request: ConfigureRequest,
	settings: Settings,
	state: ReviewState,
	rows: number,
): Line[] {
	const {g, line, box, indent, cols} = kit;
	// Cards stop at 76 columns, so a label and its value never sit far apart.
	const cardWidth = Math.min(cols - margin * 2, 76);
	const {agents} = settings;
	const start = [
		settings.copyIgnored ? 'copy ignored files' : undefined,
		settings.tmux ? 'tmux' : undefined,
	].filter((part): part is string => part !== undefined);
	const aliases = [
		settings.tmux || settings.copyIgnored ? 'wt up' : undefined,
		settings.mcAlias ? 'wt mc' : undefined,
	].filter((part): part is string => part !== undefined);
	const details: ReadonlyArray<readonly [string, string]> = [
		[
			'Project',
			request.command === 'clone'
				? `${request.project}  ${g.right}  ${request.destination}`
				: request.destination,
		],
		[
			'Session',
			settings.tmux ? `${settings.prefix}_<branch>` : 'no tmux workspace',
		],
		[
			'Workspace',
			settings.tmux
				? `tmux${
						agents.length > 0
							? ` ${g.mid} ${agents.join(' ')}`
							: ` ${g.mid} no agents`
				  }`
				: 'off',
		],
		['Start', start.length > 0 ? start.join(`  ${g.right}  `) : 'nothing'],
		['Aliases', aliases.length > 0 ? aliases.join(`  ${g.mid}  `) : 'none'],
	];
	// A clone learns the branch while the questions are being answered.
	const branch =
		request.probedDefaultBranch?.() ??
		request.defaultBranch ??
		'default branch';
	const setupDirectory = 'chore-trunk-setup';
	const tree: ReadonlyArray<readonly [string, string, string]> = [
		[`${request.rootName}/`, '', 'b'],
		[`${g.tee}${g.h} .git/`, 'bare repository', 'c-dim'],
		request.direct
			? [
					`${g.end}${g.h} ${branch}/`,
					'gets .config/wt.toml, committed on this branch',
					'c-ok',
			  ]
			: [`${g.tee}${g.h} ${branch}/`, 'default branch worktree', 'c-dim'],
		...(request.direct
			? []
			: ([
					[
						`${g.end}${g.h} ${setupDirectory}/`,
						'adds .config/wt.toml, committed for review',
						'c-ok',
					],
			  ] as const)),
	];
	const body: Line[] = [
		...kit.header([request.command, 'review'], request.project),
		line(),
		line('  ', [`Ready to set up ${request.rootName}`, 'b']),
		line('  ', [
			'Review what Trunk will write. Nothing leaves your machine yet.',
			'c-dim',
		]),
		line(),
		...indent(
			box(
				details.map(([name, value]) =>
					line(
						[name.padEnd(10), 'c-dim'],
						[kit.fit(value, cardWidth - 14), ''],
					),
				),
				cardWidth,
				{title: 'Your choices', titleStyle: 'c-acc b', tag: 'edit: b'},
			),
			margin,
		),
		line(),
		line('  ', ['Your project will look like', 'c-acc b']),
		...tree.map(([name, note, style]) =>
			line(
				'  ',
				[name.padEnd(30), name.endsWith('/') && note === '' ? 'b' : 'c-fg'],
				[note, style],
			),
		),
		line(),
		line(
			'  ',
			...kit.choice(
				[
					request.direct ? 'Write and commit' : 'Create setup branch',
					'Back',
					'Cancel',
				],
				state.sel,
				true,
				['go', 'back', 'cancel'],
			),
		),
	];
	return kit.frame(
		body,
		kit.keybar([
			[g.leftright, 'choose'],
			[g.enter, 'confirm', 'enter'],
			['b', 'edit choices', 'b'],
		]),
		{
			maxRows: rows,
		},
	);
}
