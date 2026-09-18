import type {CliFlags} from '../core/arguments.js';
import type {ToolProbe} from '../core/env.js';
import {badUsage, type Outcome} from '../core/result.js';

export function runClone(
	_arguments: readonly string[],
	_flags: CliFlags,
	_tools: ToolProbe,
): Outcome {
	return badUsage('not implemented');
}
