/**
 * Plain-text progress reporting. Human-readable step lines go to stderr and
 * machine-readable results to stdout, so a caller can pipe trunk's output
 * somewhere useful while the person still sees what happened. It deliberately
 * avoids Ink: `--yes` runs never mount a UI.
 */
import process from 'node:process';
import {exitCodes, type Outcome} from './result.js';

type StepKind = 'success' | 'error' | 'info' | 'warning';

/** ANSI colour numbers, applied only when the terminal will render them. */

const stepStyles: Record<StepKind, {symbol: string; color: number}> = {
	success: {symbol: '✓', color: 32},
	error: {symbol: '✗', color: 31},
	info: {symbol: '→', color: 36},
	warning: {symbol: '⚠', color: 33},
};

export function step(kind: StepKind, message: string): void {
	const {symbol, color} = stepStyles[kind];
	const decoratedSymbol = shouldUseColor()
		? `\u001B[${color}m${symbol}\u001B[39m`
		: symbol;
	process.stderr.write(`${decoratedSymbol} ${message}\n`);
}

/** One JSON line on stdout, for callers that parse trunk's output. */
export function result(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}

/** Prints a command's closing line. A message-less Outcome stays silent. */
export function reportOutcome(outcome: Outcome): void {
	if (!outcome.message) {
		return;
	}

	step(
		outcome.code === exitCodes.success ? 'success' : 'error',
		outcome.message,
	);
}

function shouldUseColor(): boolean {
	// Step lines go to stderr, so that is the stream whose TTY state matters.
	// NO_COLOR only counts when it is set to a non-empty value.
	return !process.env['NO_COLOR'] && Boolean(process.stderr.isTTY);
}
