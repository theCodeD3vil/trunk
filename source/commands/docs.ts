/**
 * `trunk docs`: the offline documentation browser. The command is part of the
 * public surface and named in every generated config, so it exists from the
 * start; until the browser ships it says so instead of failing as unknown.
 */
import {operationFailed, type Outcome} from '../core/result.js';

export function runDocumentation(): Outcome {
	return operationFailed(
		'the offline docs browser is not included in this build yet',
	);
}
