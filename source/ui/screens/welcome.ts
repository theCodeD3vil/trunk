/**
 * The screen for `trunk-cli` and `trunk-cli --help` in a terminal: the three commands
 * first, an example to copy, and the options as a reference rather than the
 * headline. It is printed once and left in the scrollback, so it has no keys.
 * These are the lines for the body of the shell's printed sheet; the version
 * and the frame are the sheet's.
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

/**
 * `summary` is what plain `trunk-cli` shows: the options collapse to one dim line,
 * because they are a reference and not the headline. `full` is `trunk-cli --help`,
 * where the reference is the point, so every option is listed with its meaning.
 */
export type WelcomeDetail = 'summary' | 'full';

export function welcomeLines(
	kit: Kit,
	detail: WelcomeDetail = 'summary',
): {body: Line[]; foot: string} {
	const {g, line, cols, clip} = kit;
	const heading = (text: string): Line => line('  ', [text, 'c-faint']);
	const body: Line[] = [
		line(),
		line('  ', ['Set up a repository for parallel work.', 'b']),
		line('  ', [
			'Every worktree gets its own tmux workspace. No project-specific config.',
			'c-dim',
		]),
		line(),
		heading('COMMANDS'),
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
		heading('TRY IT'),
		line(
			'  ',
			'  ',
			[`${g.prompt} `, 'c-acc'],
			['trunk-cli clone git@github.com:acme/storefront.git', 'b'],
		),
		line(),
		heading('OPTIONS FOR CLONE AND INIT'),
		...(detail === 'full'
			? options.map(([flag, text]) =>
					line('  ', '  ', [flag.padEnd(20), 'c-fg'], [text, 'c-dim']),
			  )
			: [
					clip(
						line('  ', '  ', [
							options.map(([flag]) => flag.split(' ')[0]!).join(` ${g.mid} `),
							'c-dim',
						]),
						cols - margin,
					),
			  ]),
		line(),
	];
	return {
		body,
		foot: 'Nothing is written until you review it. Add --yes to skip every question.',
	};
}
