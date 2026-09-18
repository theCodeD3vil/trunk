/* eslint-disable unicorn/filename-case -- Phase 3 specifies Summary.tsx. */
/** Final preview shown before a command is allowed to write wt.toml. */
import {homedir} from 'node:os';
import React from 'react';
import {Box, Text, useInput} from 'ink';
import {developmentCommand, installCommand} from '../core/generate/steps.js';
import {routeUrl} from '../core/generate/proxy.js';
import {usesCaddy, type Settings} from '../core/settings.js';

export type SummaryProperties = Readonly<{
	folder: string;
	settings: Settings;
	onConfirm: () => void;
	onBack: () => void;
	onAbort: () => void;
}>;

export type SummaryRow = Readonly<{label: string; value: string}>;

export function summaryRows(
	settings: Settings,
	folder: string,
): readonly SummaryRow[] {
	const steps = [
		settings.tmux ? 'tmux' : undefined,
		settings.copyIgnored ? 'copy-ignored' : undefined,
		'install',
		settings.server ? 'server' : undefined,
		usesCaddy(settings) ? 'proxy' : undefined,
		settings.mcAlias ? 'mc' : undefined,
	].filter((step): step is string => step !== undefined);

	return Object.freeze([
		Object.freeze({label: 'folder', value: displayPath(folder)}),
		Object.freeze({
			label: 'prefix',
			value: `${settings.prefix}    session ${
				settings.tmux ? `${settings.prefix}_<branch>` : 'off'
			}`,
		}),
		Object.freeze({label: 'install', value: installCommand(settings)}),
		Object.freeze({
			label: 'server',
			value: settings.server
				? developmentCommand(settings, '<hash of repo+branch>')
				: 'off',
		}),
		Object.freeze({
			label: 'route',
			value: usesCaddy(settings) ? routeUrl(settings, '<branch>') : 'off',
		}),
		Object.freeze({
			label: 'agents',
			value: settings.agents.length > 0 ? settings.agents.join(', ') : 'none',
		}),
		Object.freeze({label: 'steps', value: steps.join(' · ')}),
	]);
}

export default function Summary({
	folder,
	settings,
	onConfirm,
	onBack,
	onAbort,
}: SummaryProperties): React.ReactElement {
	useInput((input, key) => {
		if (key.return) {
			onConfirm();
		} else if (input === 'b') {
			onBack();
		} else if (input === 'q') {
			onAbort();
		}
	});

	return (
		<Box flexDirection="column" width="100%">
			<Text bold>Review setup</Text>
			<Box flexDirection="column" marginTop={1}>
				{summaryRows(settings, folder).map(row => (
					<Box key={row.label} width="100%">
						<Box width={10} flexShrink={0}>
							<Text dimColor>{row.label}</Text>
						</Box>
						<Box flexGrow={1}>
							<Text wrap="truncate-end">{row.value}</Text>
						</Box>
					</Box>
				))}
			</Box>
			<Box marginTop={1}>
				<Text color="cyan">[Enter]</Text>
				<Text> write · </Text>
				<Text color="cyan">[b]</Text>
				<Text> back · </Text>
				<Text color="cyan">[q]</Text>
				<Text> abort</Text>
			</Box>
		</Box>
	);
}

function displayPath(path: string): string {
	const home = homedir();
	return path === home || path.startsWith(`${home}/`)
		? `~${path.slice(home.length)}`
		: path;
}
