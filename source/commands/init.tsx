/**
 * `trunk init [dir]`: set up a project that is already in trunk's layout.
 * Not implemented yet; the CLI wiring and exit code are in place.
 */
import type {CliFlags} from '../core/arguments.js';
import type {ToolProbe} from '../core/env.js';
import {badUsage, type Outcome} from '../core/result.js';

export function runInit(
	_arguments: readonly string[],
	_flags: CliFlags,
	_tools: ToolProbe,
): Outcome {
	return badUsage('not implemented');
}
