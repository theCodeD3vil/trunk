import process from 'node:process';
import {exitCodes, type Outcome} from './result.js';

export function guardPlatform(
	platform: NodeJS.Platform = process.platform,
): Outcome | undefined {
	if (platform !== 'win32') {
		return undefined;
	}

	return {
		code: exitCodes.unsupportedEnvironment,
		message: 'trunk supports macOS and Linux (including WSL).',
	};
}
