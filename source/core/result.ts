export const exitCodes = {
	success: 0,
	operationFailed: 1,
	badUsage: 2,
	unsupportedEnvironment: 3,
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

export function badUsage(message: string): Outcome {
	return {code: exitCodes.badUsage, message};
}
