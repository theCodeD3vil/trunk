import type {CliFlags} from '../core/arguments.js';
import {badUsage, type Outcome} from '../core/result.js';

export function runNew(
	_arguments: readonly string[],
	_flags: CliFlags,
): Outcome {
	return badUsage('not implemented');
}
