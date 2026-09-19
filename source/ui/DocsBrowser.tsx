/* eslint-disable unicorn/filename-case -- React components use PascalCase file names. */
/**
 * The offline documentation browser: a sidebar of every topic and section beside
 * a scrolling reader, with `/` search and `c` copy. All layout and navigation
 * live in `screens/docs.ts`; this file draws the current state and turns key
 * presses and clipboard results into state.
 */
import React, {useEffect, useRef, useState} from 'react';
import {render, useApp, useStdout} from 'ink';
import {supportsInteractiveInput} from '../core/platform.js';
import {copyToClipboard, type CopyFunction} from '../docs/clipboard.js';
import {abortKey} from './keys.js';
import {createKit, type Line} from './kit/lines.js';
import {Lines} from './kit/render.js';
import {resolveTheme, type Theme} from './kit/theme.js';
import {useKeys} from './use-keys.js';
import {
	documentationKey,
	documentationLines,
	initialDocumentation,
	type DocumentationState,
} from './screens/docs.js';

export type DocumentationBrowserProperties = Readonly<{
	/** Overrides the terminal size, so tests render at a fixed width. */
	size?: Readonly<{columns: number; rows: number}>;
	theme?: Theme;
	copy?: CopyFunction;
	onExit?: () => void;
}>;

export type DocumentationBrowserOutcome =
	| Readonly<{kind: 'closed'}>
	/** The terminal cannot read keys, so the caller explains and exits. */
	| Readonly<{kind: 'unavailable'; reason: string}>;

const maximumColumns = 104;

export default function DocumentationBrowser({
	size,
	theme = resolveTheme(),
	copy = copyToClipboard,
	onExit,
}: DocumentationBrowserProperties): React.ReactElement {
	const {exit} = useApp();
	const {stdout} = useStdout();
	const [state, setState] = useState<DocumentationState>(initialDocumentation);
	// Several keys can arrive in one read, and React applies their state updates
	// later, so the newest state is kept here for the next key to start from.
	const current = useRef(state);
	const apply = (next: DocumentationState) => {
		current.current = next;
		setState(next);
	};

	const [caret, setCaret] = useState(true);
	const closed = useRef(false);
	const columns = Math.min(
		size?.columns ?? (stdout.columns || 80),
		maximumColumns,
	);
	const rows = size?.rows ?? (stdout.rows || 40);
	const kit = createKit(theme.glyphs, columns);
	const searching = state.search !== undefined;

	const close = () => {
		if (!closed.current) {
			closed.current = true;
			onExit?.();
			exit();
		}
	};

	useEffect(() => {
		if (!searching) {
			return undefined;
		}

		const timer = setInterval(() => {
			setCaret(value => !value);
		}, 530);
		return () => {
			clearInterval(timer);
		};
	}, [searching]);

	const lines = documentationLines(kit, state, {caret, rows});
	// Clicks are resolved against exactly what this render drew.
	const drawn = useRef<readonly Line[]>(lines);
	drawn.current = lines;
	useKeys(
		name => {
			if (name === abortKey) {
				close();
				return;
			}

			const step = documentationKey(current.current, name, {kit, rows});
			apply(step.state);
			if (step.effect?.kind === 'quit') {
				close();
			} else if (step.effect?.kind === 'copy') {
				const {label, code} = step.effect.block;
				void (async () => {
					const result = await copy(code);
					const notice = {
						ok: result.ok,
						text: result.ok
							? `Copied "${label}" to the clipboard (${result.via}).`
							: result.message,
					};
					apply({...current.current, notice});
				})();
			}
		},
		() => drawn.current,
	);

	return <Lines lines={lines} theme={theme} width={columns} caret={caret} />;
}

/** Mounts the browser, with Ctrl+C routed through its normal close. */
export async function runDocumentationBrowser(): Promise<DocumentationBrowserOutcome> {
	if (!supportsInteractiveInput()) {
		return {
			kind: 'unavailable',
			reason: 'stdin is not an interactive terminal',
		};
	}

	try {
		const app = render(<DocumentationBrowser />, {exitOnCtrlC: false});
		await app.waitUntilExit();
		app.cleanup();
	} catch (error: unknown) {
		// Ink throws from inside React when raw mode turns out to be unusable,
		// which would otherwise reach the user as a component stack.
		return {
			kind: 'unavailable',
			reason: error instanceof Error ? error.message : String(error),
		};
	}

	return {kind: 'closed'};
}
