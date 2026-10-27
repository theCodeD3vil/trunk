/**
 * The terminal UI's front door: what the commands load, once, when they run in
 * a real terminal. It opens setup sessions and prints the screens that have no
 * keys, the welcome and the refusals, which are drawn once in the shell's frame
 * and left in the scrollback.
 */
import process from 'node:process';
import {colourLevel} from '../core/interactive.js';
import type {Refusal, TerminalUi} from '../core/session.js';
import {trunkVersion} from '../core/version.js';
import type {Kit} from './kit/lines.js';
import {ansiLines} from './kit/render.js';
import {resolveTheme} from './kit/theme.js';
import {
	emptyRepositoryLines,
	missingToolLines,
	normalCloneLines,
} from './screens/callouts.js';
import {welcomeLines} from './screens/welcome.js';
import {openSession} from './session.js';
import {sheetLines, type SheetParts} from './shell/sheet.js';

const maximumColumns = 104;

/** Draws a sheet once and leaves it on screen. */
async function print(
	stream: NodeJS.WriteStream,
	version: string,
	crumb: string,
	build: (kit: Kit) => SheetParts,
): Promise<void> {
	const theme = resolveTheme();
	const columns = Math.min(stream.columns || 80, maximumColumns);
	const text = ansiLines(
		sheetLines({theme, version, cols: columns, crumb, build}),
		theme,
		columns,
		colourLevel(stream),
	);
	await new Promise<void>(resolve => {
		stream.write(text, () => {
			resolve();
		});
	});
}

/** What a refusal is called in the bar, and what it says. */
function refusalSheet(refusal: Refusal): {
	crumb: string;
	build: (kit: Kit) => SheetParts;
} {
	switch (refusal.kind) {
		case 'missing-tools': {
			return {
				crumb: 'cannot start',
				build: kit => missingToolLines(kit, refusal.missing, refusal.command),
			};
		}

		case 'normal-clone': {
			return {
				crumb: 'init · normal clone',
				build: kit => normalCloneLines(kit, refusal),
			};
		}

		case 'empty-repository': {
			return {
				crumb: 'init · empty repository',
				build: kit => emptyRepositoryLines(kit, refusal.name, refusal.rerun),
			};
		}
	}
}

export async function openTerminalUi(): Promise<TerminalUi> {
	return {
		session: openSession,
		async refuse(refusal) {
			const {crumb, build} = refusalSheet(refusal);
			await print(process.stderr, trunkVersion(), crumb, build);
		},
		async welcome(version, detail) {
			await print(process.stdout, version, 'worktree setup for Git', kit =>
				welcomeLines(kit, detail),
			);
		},
	};
}
