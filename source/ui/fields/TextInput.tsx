/* eslint-disable unicorn/filename-case -- Phase 3 specifies TextInput.tsx. */
/** Prefix entry with random/custom shortcuts and live validation. */
import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';

export type TextInputProperties = Readonly<{
	label: string;
	value: string;
	isActive: boolean;
	help: string;
	validationError?: string;
	randomValue: () => string;
	onChange: (value: string) => void;
	onSubmit: () => void;
}>;

export default function TextInput({
	label,
	value,
	isActive,
	help,
	validationError,
	randomValue,
	onChange,
	onSubmit,
}: TextInputProperties): React.ReactElement {
	const [custom, setCustom] = useState(false);

	useInput(
		(input, key) => {
			if (key.ctrl || key.meta) {
				return;
			}

			if (key.return) {
				if (!validationError) {
					onSubmit();
				}

				return;
			}

			if (key.backspace || key.delete) {
				setCustom(true);
				onChange(value.slice(0, -1));
				return;
			}

			if (!custom && input === 'r') {
				onChange(randomValue());
				return;
			}

			if (!custom && input === 'c') {
				setCustom(true);
				onChange('');
				return;
			}

			if (
				input &&
				!key.upArrow &&
				!key.downArrow &&
				!key.leftArrow &&
				!key.rightArrow
			) {
				setCustom(true);
				onChange(`${value}${input}`);
			}
		},
		{isActive},
	);

	return (
		<Box flexDirection="column">
			<Box>
				<Text color={isActive ? 'cyan' : undefined}>
					{isActive ? '›' : ' '} {label.padEnd(17)}
				</Text>
				<Text bold={isActive}>{value}</Text>
				{isActive ? <Text color="cyan">▌</Text> : null}
			</Box>
			<Box marginLeft={20}>
				<Text
					color={validationError ? 'red' : undefined}
					dimColor={!validationError}
				>
					{validationError ?? `[r] random · [c] custom · ${help}`}
				</Text>
			</Box>
		</Box>
	);
}
