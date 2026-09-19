/**
 * The terminal UI's front door: what the commands load, once, when they run in
 * a real terminal. It opens setup sessions and prints the screens that have no
 * keys, the welcome and the refusals, which are drawn once and left in the
 * scrollback.
 */
import process from 'node:process';
import React from 'react';
import {render} from 'ink';
import type {Refusal, TerminalUi} from '../core/session.js';
import {createKit, type Kit, type Line} from './kit/lines.js';
import {Lines} from './kit/render.js';
import {resolveTheme} from './kit/theme.js';
import {
	emptyRepositoryLines,
	missingToolLines,
	normalCloneLines,
	staticFrame,
} from './screens/callouts.js';
import {welcomeLines} from './screens/welcome.js';
import {openSession} from './session.js';

const maximumColumns = 104;

/** Draws lines once and leaves them on screen. */
async function print(
	stream: NodeJS.WriteStream,
	build: (kit: Kit) => Line[],
): Promise<void> {
	const theme = resolveTheme();
	const columns = Math.min(stream.columns || 80, maximumColumns);
	const app = render(
		<Lines
			lines={build(createKit(theme.glyphs, columns))}
			theme={theme}
			width={columns}
		/>,
		{
			stdout: stream,
			exitOnCtrlC: false,
			patchConsole: false,
		},
	);
	// The exit promise must exist before unmounting, or it never settles.
	const exited = app.waitUntilExit();
	app.unmount();
	await exited;
}

function refusalLines(kit: Kit, refusal: Refusal): Line[] {
	switch (refusal.kind) {
		case 'missing-tools': {
			return staticFrame(
				kit,
				['trunk', 'cannot start'],
				missingToolLines(kit, refusal.missing, refusal.command),
			);
		}

		case 'normal-clone': {
			return staticFrame(
				kit,
				['init', 'normal clone'],
				normalCloneLines(kit, refusal),
			);
		}

		case 'empty-repository': {
			return staticFrame(
				kit,
				['init', 'empty repository'],
				emptyRepositoryLines(kit, refusal.name, refusal.rerun),
			);
		}
	}
}

export async function openTerminalUi(): Promise<TerminalUi> {
	return {
		session: openSession,
		async refuse(refusal) {
			await print(process.stderr, kit => refusalLines(kit, refusal));
		},
		async welcome(version) {
			await print(process.stdout, kit => welcomeLines(kit, version));
		},
	};
}
