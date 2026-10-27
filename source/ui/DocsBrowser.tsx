/* eslint-disable unicorn/filename-case -- React components use PascalCase file names. */
/**
 * The offline documentation browser: a screen of the same shell as the setup
 * form, with every topic and section in the rail beside a scrolling page, `/`
 * to search and `c` to copy. What it looks like is `shell/docs-view.ts`, and
 * the keys and state are in `screens/docs.ts`; this file turns key presses
 * and clipboard results into state.
 */
import {performance} from 'node:perf_hooks';
import process from 'node:process';
import React, {useEffect, useReducer, useRef} from 'react';
import {useTerminalDimensions} from '@opentui/react';
import {supportsInteractiveInput} from '../core/platform.js';
import {trunkVersion} from '../core/version.js';
import {copyToClipboard, type CopyFunction} from '../docs/clipboard.js';
import {abortKey} from './keys.js';
import {createKit} from './kit/lines.js';
import {Lines, mount} from './kit/render.js';
import {resolveTheme, type Theme} from './kit/theme.js';
import {useKeys} from './use-keys.js';
import {
	documentationKey,
	initialDocumentation,
	type DocumentationState,
} from './screens/docs.js';
import {createController} from './shell/controller.js';
import {documentationLayout} from './shell/docs-view.js';
import {motionEnabled} from './shell/motion.js';
import {frameLines} from './shell/view.js';

export type DocumentationBrowserProperties = Readonly<{
	theme?: Theme;
	copy?: CopyFunction;
	onExit?: () => void;
}>;

export type DocumentationBrowserOutcome =
	| Readonly<{kind: 'closed'}>
	/** The terminal cannot take keys, so the caller explains and exits. */
	| Readonly<{kind: 'unavailable'; reason: string}>;

/** Clears the visible screen and puts the cursor at the top; the scrollback is left alone. */
const clearScreen = '\u001B[2J\u001B[H';

export default function DocumentationBrowser({
	theme = resolveTheme(),
	copy = copyToClipboard,
	onExit,
}: DocumentationBrowserProperties): React.ReactNode {
	const terminal = useTerminalDimensions();
	// Anything that changes outside a render asks for the next one.
	const [, bump] = useReducer((value: number) => value + 1, 0);

	const controller = useRef(
		createController({
			theme,
			version: trunkVersion(),
			motion: motionEnabled(),
			copy,
			wake: bump,
			clock: () => performance.now(),
		}),
	).current;
	// Several keys can arrive before the next render, so each is applied to the latest state.
	const current = useRef<DocumentationState>(initialDocumentation);
	const closed = useRef(false);
	const apply = (next: DocumentationState): void => {
		current.current = next;
		controller.show({kind: 'docs', state: next}, performance.now());
		bump();
	};

	if (controller.screen.kind !== 'docs') {
		controller.show({kind: 'docs', state: current.current}, performance.now());
	}

	const columns = terminal.width || 80;
	const rows = terminal.height || 40;
	const now = performance.now();
	controller.resize(columns, rows, now);
	const frame = controller.frame(now);
	const lines = frameLines(frame);

	// Hover fades and the search caret schedule their own next frame; a still page schedules none.
	useEffect(() => {
		const wait = controller.delay(now);
		if (wait === undefined) {
			return undefined;
		}

		const timer = setTimeout(bump, wait);
		return () => {
			clearTimeout(timer);
		};
	});

	const close = (): void => {
		if (!closed.current) {
			closed.current = true;
			onExit?.();
		}
	};

	// Clicks are resolved against exactly what render drew.
	const drawn = useRef(lines);
	drawn.current = lines;
	useKeys(
		name => {
			if (name === abortKey) {
				close();
				return;
			}

			const layout = documentationLayout(columns, rows);
			const step = documentationKey(current.current, name, {
				kit: createKit(theme.glyphs, layout.width + 4),
				width: layout.width,
				height: layout.height,
			});
			let next = step.state;
			if (next.notice !== undefined) {
				controller.toast(
					next.notice.text,
					performance.now(),
					next.notice.ok ? 'info' : 'warn',
				);
				next = {...next, notice: undefined};
			}

			apply(next);
			if (step.effect?.kind === 'quit') {
				close();
			} else if (step.effect?.kind === 'copy') {
				const {label, code} = step.effect.block;
				void (async () => {
					const result = await copy(code);
					controller.toast(
						result.ok
							? `Copied "${label}" to the clipboard (${result.via}).`
							: result.message,
						performance.now(),
						result.ok ? 'info' : 'warn',
					);
					bump();
				})();
			}
		},
		() => drawn.current,
		target => {
			if (controller.hover(target, performance.now())) {
				bump();
			}
		},
	);

	return <Lines lines={lines} theme={frame.theme} width={columns} />;
}

/** Mounts the browser, with Ctrl+C routed through the normal close. */
export async function runDocumentationBrowser(): Promise<DocumentationBrowserOutcome> {
	if (!supportsInteractiveInput()) {
		return {
			kind: 'unavailable',
			reason: 'stdin is not an interactive terminal',
		};
	}

	try {
		let close: () => void = () => undefined;
		const closed = new Promise<void>(resolve => {
			close = resolve;
		});
		const app = await mount(<DocumentationBrowser onExit={close} />);
		await closed;
		await app.unmount();
		// There is nothing to keep: leave the terminal as it was before.
		if (process.stdout.isTTY) {
			process.stdout.write(clearScreen);
		}
	} catch (error: unknown) {
		// The renderer fails when the terminal or its native library is unusable,
		// which would otherwise reach the user as a stack trace.
		return {
			kind: 'unavailable',
			reason: error instanceof Error ? error.message : String(error),
		};
	}

	return {kind: 'closed'};
}
