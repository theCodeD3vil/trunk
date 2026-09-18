/**
 * How every command reports back. Commands return an Outcome instead of exiting
 * themselves, so `cli.tsx` stays the one place that touches `process.exit` and
 * the exit code of any run is easy to follow.
 */

/** Scripts depend on these numbers, so treat them as part of the public API. */
export const exitCodes = {
	success: 0,
	/** An external operation failed: git, wt or gh returned an error. */
	operationFailed: 1,
	/** The command line itself was wrong: unknown command, missing argument. */
	badUsage: 2,
	/** The machine cannot run trunk: Windows, or git/wt missing. */
	unsupportedEnvironment: 3,
	/** The user declined a prompt or interrupted the run. */
	userAborted: 4,
} as const;

export type ExitCode = (typeof exitCodes)[keyof typeof exitCodes];

export type Outcome = {
	code: ExitCode;
	message?: string;
};

export function succeed(message?: string): Outcome {
	return {code: exitCodes.success, message};
}

export function operationFailed(message: string): Outcome {
	return {code: exitCodes.operationFailed, message};
}

export function badUsage(message: string): Outcome {
	return {code: exitCodes.badUsage, message};
}

export function unsupportedEnvironment(message: string): Outcome {
	return {code: exitCodes.unsupportedEnvironment, message};
}

export function userAborted(message = 'setup aborted'): Outcome {
	return {code: exitCodes.userAborted, message};
}
