/**
 * The screen for `trunk` and `trunk --help` in a terminal: the three commands
 * first, an example to copy, and the options as a reference rather than the
 * headline. It is printed once and left in the scrollback, so it has no keys.
 */
import {margin, type Kit, type Line} from '../kit/lines.js';

const commands: ReadonlyArray<
	readonly [name: string, args: string, text: string]
> = [
	['clone', '<url> [dir]', 'Clone a repository into a worktree-ready project'],
	['init', '[dir]', 'Set up a project you already have on disk'],
	['docs', '', 'Browse recipes and reference, offline'],
];

const options: ReadonlyArray<readonly [flag: string, text: string]> = [
	['--yes', 'accept the defaults, no questions (needed without a TTY)'],
	['--prefix <name>', 'tmux session prefix'],
	['--agents <a,b>', 'up to 4 installed agents'],
	['--tmux / --no-tmux', 'the tmux workspace'],
	['--copy / --no-copy', 'wt step copy-ignored'],
	['--mc / --no-mc', 'the wt mc merge alias'],
	['--direct', 'commit on this branch, not chore/trunk-setup'],
];

export function welcomeLines(kit: Kit, version: string): Line[] {
	const {g, line, cols, justify, box, indent} = kit;
	const contentWidth = cols - margin * 2;
	const lines: Line[] = [
		justify(
			line(' ', [' trunk ', 'pill'], ' ', [version, 'c-dim']),
			line(['worktree setup for Git ', 'c-dim']),
			cols,
		),
		line(),
		line('  ', ['Set up a repository for parallel work.', 'b']),
		line('  ', [
			'Every worktree gets its own tmux workspace. No project-specific config.',
			'c-dim',
		]),
		line(),
		line('  ', ['Commands', 'c-acc b']),
		line('  ', [g.h.repeat(contentWidth), 'c-faint']),
		...commands.map(([name, arguments_, text]) =>
			line(
				'  ',
				'  ',
				[name.padEnd(6), 'b'],
				[arguments_.padEnd(14), 'c-dim'],
				[text, 'c-dim'],
			),
		),
		line(),
		...indent(
			box(
				[
					line(
						[`$ `, 'c-acc'],
						['trunk clone git@github.com:acme/storefront.git', 'b'],
					),
				],
				Math.min(contentWidth, 64),
				{
					title: 'Try it',
					titleStyle: 'c-acc b',
				},
			),
			margin,
		),
		line(),
		line('  ', ['Options for clone and init', 'c-acc b']),
		...options.map(([flag, text]) =>
			line('  ', '  ', [flag.padEnd(20), 'c-fg'], [text, 'c-dim']),
		),
		line(),
		line('  ', ['Nothing is written until you review it.', 'c-dim']),
	];
	return lines;
}
