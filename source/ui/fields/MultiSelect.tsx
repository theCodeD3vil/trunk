/* eslint-disable unicorn/filename-case -- Phase 3 specifies MultiSelect.tsx. */
/** Fixed-order checkboxes with an enforced selection limit. */
import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';

export type MultiSelectOption<Value extends string> = Readonly<{
	value: Value;
	label: string;
	note?: string;
}>;

export type MultiSelectProperties<Value extends string> = Readonly<{
	label: string;
	options: ReadonlyArray<MultiSelectOption<Value>>;
	value: readonly Value[];
	maximum: number;
	isActive: boolean;
	onChange: (value: readonly Value[]) => void;
	onSubmit: () => void;
}>;

export default function MultiSelect<Value extends string>({
	label,
	options,
	value,
	maximum,
	isActive,
	onChange,
	onSubmit,
}: MultiSelectProperties<Value>): React.ReactElement {
	const [cursor, setCursor] = useState(0);
	const [error, setError] = useState<string>();

	useInput(
		(input, key) => {
			if (key.return) {
				onSubmit();
				return;
			}

			if (key.upArrow || key.leftArrow) {
				setCursor(current => (current - 1 + options.length) % options.length);
				setError(undefined);
				return;
			}

			if (key.downArrow || key.rightArrow) {
				setCursor(current => (current + 1) % options.length);
				setError(undefined);
				return;
			}

			if (input !== ' ' || options.length === 0) {
				return;
			}

			const selected = options[cursor]!.value;
			if (value.includes(selected)) {
				onChange(value.filter(item => item !== selected));
				setError(undefined);
				return;
			}

			if (value.length >= maximum) {
				setError(`max ${maximum} (2×2 grid)`);
				return;
			}

			const next = new Set([...value, selected]);
			onChange(
				options.map(option => option.value).filter(item => next.has(item)),
			);
			setError(undefined);
		},
		{isActive},
	);

	return (
		<Box flexDirection="column">
			<Box>
				<Text color={isActive ? 'cyan' : undefined}>
					{isActive ? '›' : ' '} {label}
				</Text>
				{error ? <Text color="red"> {error}</Text> : null}
			</Box>
			<Box flexDirection="column" marginLeft={2}>
				{Array.from({length: Math.ceil(options.length / 2)}, (_, row) => (
					<Box key={row}>
						{[options[row * 2], options[row * 2 + 1]]
							.filter(
								(option): option is MultiSelectOption<Value> =>
									option !== undefined,
							)
							.map(option => {
								const index = options.indexOf(option);
								const checked = value.includes(option.value);
								return (
									<Box key={option.value} width={36}>
										<Text
											color={isActive && cursor === index ? 'cyan' : undefined}
										>
											{isActive && cursor === index ? '›' : ' '}{' '}
											{checked ? '[x]' : '[ ]'} {option.label}
										</Text>
										{option.note ? (
											<Text dimColor> ({option.note})</Text>
										) : null}
									</Box>
								);
							})}
					</Box>
				))}
			</Box>
		</Box>
	);
}
