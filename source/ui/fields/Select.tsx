/* eslint-disable unicorn/filename-case -- Phase 3 specifies Select.tsx. */
/** A compact single-choice field controlled with either pair of arrow keys. */
import React from 'react';
import {Box, Text, useInput} from 'ink';

export type SelectOption<Value extends string> = Readonly<{
	value: Value;
	label: string;
	note?: string;
}>;

export type SelectProperties<Value extends string> = Readonly<{
	label: string;
	options: ReadonlyArray<SelectOption<Value>>;
	value: Value;
	isActive: boolean;
	note?: string;
	onChange: (value: Value) => void;
	onSubmit: () => void;
}>;

export default function Select<Value extends string>({
	label,
	options,
	value,
	isActive,
	note,
	onChange,
	onSubmit,
}: SelectProperties<Value>): React.ReactElement {
	useInput(
		(_input, key) => {
			if (key.return) {
				onSubmit();
				return;
			}

			const offset =
				key.leftArrow || key.upArrow
					? -1
					: key.rightArrow || key.downArrow
					? 1
					: 0;
			if (offset === 0 || options.length === 0) {
				return;
			}

			const current = options.findIndex(option => option.value === value);
			const index = (current + offset + options.length) % options.length;
			onChange(options[index]!.value);
		},
		{isActive},
	);

	const selected = options.find(option => option.value === value) ?? options[0];
	return (
		<Box>
			<Text color={isActive ? 'cyan' : undefined}>
				{isActive ? '›' : ' '} {label.padEnd(17)}
			</Text>
			<Text bold={isActive}>{selected?.label ?? value}</Text>
			{selected?.note ? <Text dimColor> ({selected.note})</Text> : null}
			{note ? <Text color="yellow"> {note}</Text> : null}
		</Box>
	);
}
