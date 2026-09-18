/* eslint-disable unicorn/filename-case -- Matches SetupForm.tsx and Summary.tsx. */
/**
 * The offline documentation browser: a menu of topics, a section list, pages
 * with scrolling and copyable snippets, and live search. All navigation lives
 * in `docs/navigation.ts`; this file only draws the current screen and turns
 * key presses and clipboard results into state.
 */
import React, {useRef, useState} from 'react';
import {Box, Text, render, useApp, useInput, useStdout} from 'ink';
import {supportsInteractiveInput} from '../core/platform.js';
import {copyToClipboard, type CopyFunction} from '../docs/clipboard.js';
import {topics} from '../docs/index.js';
import {codeBlocks, layoutSection, wrap} from '../docs/layout.js';
import {
	initialScreen,
	pageViewport,
	pageWidth,
	reduce,
	type PageScreen,
	type Screen,
	type SearchScreen,
	type SectionsScreen,
	type View,
} from '../docs/navigation.js';
import {search} from '../docs/search.js';
import type {CodeBlock} from '../docs/types.js';

export type DocumentationBrowserProperties = Readonly<{
	/** Overrides the terminal size, so tests render at a fixed width. */
	size?: View;
	copy?: CopyFunction;
	onExit?: () => void;
}>;

export type DocumentationBrowserOutcome =
	| Readonly<{kind: 'closed'}>
	/** The terminal cannot read keys, so the caller explains and exits. */
	| Readonly<{kind: 'unavailable'; reason: string}>;

const defaultView: View = Object.freeze({columns: 80, rows: 24});

export default function DocumentationBrowser({
	size,
	copy = copyToClipboard,
	onExit,
}: DocumentationBrowserProperties): React.ReactElement {
	const {exit} = useApp();
	const {stdout} = useStdout();
	const view: View = size ?? {
		columns: stdout.columns || defaultView.columns,
		rows: stdout.rows || defaultView.rows,
	};
	const [screen, setScreen] = useState<Screen>(initialScreen);
	const closed = useRef(false);

	/** Copies one snippet, then shows what happened on the page it came from. */
	const copySnippet = async (block: CodeBlock): Promise<void> => {
		const result = await copy(block.code);
		const notice = result.ok
			? `Copied "${block.label}" to the clipboard (${result.via}).`
			: result.message;
		setScreen(current =>
			current.name === 'page' ? {...current, notice} : current,
		);
	};

	useInput((input, key) => {
		const step = reduce(screen, input, key, view);
		setScreen(step.screen);

		const {effect} = step;
		if (effect?.kind === 'quit' && !closed.current) {
			closed.current = true;
			onExit?.();
			exit();
		} else if (effect?.kind === 'copy') {
			void copySnippet(effect.block);
		}
	});

	return (
		<Box flexDirection="column" width={view.columns}>
			{renderScreen(screen, view)}
		</Box>
	);
}

function renderScreen(screen: Screen, view: View): React.ReactElement {
	switch (screen.name) {
		case 'menu': {
			return <Menu index={screen.index} />;
		}

		case 'sections': {
			return <Sections screen={screen} />;
		}

		case 'search': {
			return <Search screen={screen} view={view} />;
		}

		case 'page': {
			return screen.picker === undefined ? (
				<Page screen={screen} view={view} />
			) : (
				<Picker screen={screen} />
			);
		}
	}
}

function Menu({index}: Readonly<{index: number}>): React.ReactElement {
	return (
		<Box flexDirection="column">
			<Text bold>trunk docs</Text>
			<Box flexDirection="column" marginTop={1}>
				{topics.map((topic, position) => (
					<Box key={topic.id} flexDirection="column">
						<Text color={position === index ? 'cyan' : undefined}>
							{position === index ? '›' : ' '} {topic.title}
						</Text>
						<Text dimColor>{`  ${topic.summary}`}</Text>
					</Box>
				))}
			</Box>
			<Hints text="↑/↓ choose · Enter open · / search · q quit" />
		</Box>
	);
}

function Sections({
	screen,
}: Readonly<{screen: SectionsScreen}>): React.ReactElement {
	const topic = topics[screen.topic]!;
	return (
		<Box flexDirection="column">
			<Text bold>{topic.title}</Text>
			<Text dimColor>{topic.summary}</Text>
			<Box flexDirection="column" marginTop={1}>
				{topic.sections.map((section, position) => (
					<Text
						key={section.id}
						color={position === screen.index ? 'cyan' : undefined}
					>
						{position === screen.index ? '›' : ' '} {section.title}
					</Text>
				))}
			</Box>
			<Hints text="↑/↓ choose · Enter open · / search · Esc back · q quit" />
		</Box>
	);
}

function Search({
	screen,
	view,
}: Readonly<{screen: SearchScreen; view: View}>): React.ReactElement {
	const results = search(screen.query);
	// Each result takes two lines; the rest of the frame is the input and hints.
	const capacity = Math.max(1, Math.floor((view.rows - 6) / 2));
	const start = Math.min(
		Math.max(0, screen.index - capacity + 1),
		Math.max(0, results.length - capacity),
	);
	const visible = results.slice(start, start + capacity);

	return (
		<Box flexDirection="column">
			<Text>
				<Text color="cyan">/ </Text>
				{screen.query}
				<Text color="cyan">▌</Text>
			</Text>
			<Box flexDirection="column" marginTop={1}>
				{screen.query.trim() === '' ? (
					<Text dimColor>Type to search titles, prose and code.</Text>
				) : results.length === 0 ? (
					<Text dimColor>No matches.</Text>
				) : (
					visible.map((result, offset) => {
						const active = start + offset === screen.index;
						return (
							<Box
								key={`${result.topicId}/${result.sectionId}`}
								flexDirection="column"
							>
								<Text color={active ? 'cyan' : undefined}>
									{active ? '›' : ' '} {result.sectionTitle}
									<Text dimColor> · {result.topicTitle}</Text>
								</Text>
								<Text dimColor wrap="truncate-end">
									{'    '}
									{result.snippet.text}
								</Text>
							</Box>
						);
					})
				)}
			</Box>
			<Hints text="type to search · ↑/↓ choose · Enter open · Esc menu" />
		</Box>
	);
}

function Page({
	screen,
	view,
}: Readonly<{screen: PageScreen; view: View}>): React.ReactElement {
	const topic = topics[screen.topic]!;
	const section = topic.sections[screen.section]!;
	const lines = layoutSection(section, pageWidth(view));
	const viewport = pageViewport(view);
	const shown = lines.slice(screen.scroll, screen.scroll + viewport);
	const snippets = codeBlocks(section).length;
	const more = lines.length - (screen.scroll + viewport);
	const notice = screen.notice
		? wrap(screen.notice, pageWidth(view)).slice(0, 2)
		: [];

	return (
		<Box flexDirection="column">
			<Text dimColor>
				{topic.title} › {section.title}
				{more > 0 ? ' · more below' : ''}
			</Text>
			<Box flexDirection="column" marginTop={1} height={viewport}>
				{shown.map((line, position) => (
					<Text
						key={`${screen.scroll + position}`}
						bold={line.kind === 'title'}
						dimColor={line.kind === 'code-label'}
						color={line.kind === 'code' ? 'cyan' : undefined}
					>
						{line.text || ' '}
					</Text>
				))}
			</Box>
			<Box flexDirection="column" marginTop={1} height={3}>
				<Text dimColor>
					{`↑/↓ scroll · ←/→ section${
						snippets > 0 ? ` · c copy (${snippets})` : ''
					} · / search · Esc back`}
				</Text>
				{notice.map(line => (
					<Text key={line} color="yellow">
						{line}
					</Text>
				))}
			</Box>
		</Box>
	);
}

function Picker({screen}: Readonly<{screen: PageScreen}>): React.ReactElement {
	const section = topics[screen.topic]!.sections[screen.section]!;
	return (
		<Box flexDirection="column">
			<Text bold>Copy which snippet?</Text>
			<Box flexDirection="column" marginTop={1}>
				{codeBlocks(section).map((block, position) => (
					<Text
						key={block.label}
						color={position === screen.picker ? 'cyan' : undefined}
					>
						{position === screen.picker ? '›' : ' '} {block.label}
					</Text>
				))}
			</Box>
			<Hints text="↑/↓ choose · Enter copy · Esc cancel" />
		</Box>
	);
}

function Hints({text}: Readonly<{text: string}>): React.ReactElement {
	return (
		<Box marginTop={1}>
			<Text dimColor>{text}</Text>
		</Box>
	);
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
