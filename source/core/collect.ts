/**
 * Turning flags into settings without a terminal. Anything still unanswered is
 * an error that names the exact command to re-run, because a script has nobody
 * to ask. The interactive path never comes through here: it asks its questions
 * in the terminal UI, before any work starts.
 */
import {
	buildRerunCommand,
	resolve,
	type NeedsInputResolution,
	type ResolveOptions,
} from './resolve.js';
import {badUsage, type Outcome} from './result.js';
import type {Settings} from './settings.js';

export type CollectSettingsOptions = Readonly<{
	folder?: string;
	resolveOptions: ResolveOptions;
	invocation: Readonly<{executable: string; arguments: readonly string[]}>;
	yes?: boolean;
	interactive?: boolean;
}>;

export type CollectSettingsResult =
	| Readonly<{kind: 'settings'; settings: Settings}>
	| Readonly<{kind: 'outcome'; outcome: Outcome}>;

export async function collectSettings({
	resolveOptions,
	invocation,
	yes = false,
}: CollectSettingsOptions): Promise<CollectSettingsResult> {
	let resolution;
	try {
		resolution = resolve({...resolveOptions, acceptDefaults: yes});
	} catch (error: unknown) {
		return {
			kind: 'outcome',
			outcome: badUsage(error instanceof Error ? error.message : String(error)),
		};
	}

	if (resolution.kind === 'complete') {
		return {kind: 'settings', settings: resolution.settings};
	}

	return {
		kind: 'outcome',
		outcome: badUsage(missingInputMessage(resolution, invocation)),
	};
}

/** The exact command that answers the open questions, not a complaint about the terminal. */
function missingInputMessage(
	resolution: NeedsInputResolution,
	invocation: CollectSettingsOptions['invocation'],
): string {
	const rerun = buildRerunCommand(
		invocation.executable,
		invocation.arguments,
		resolution,
	);
	return `Interactive setup requires a TTY. Re-run with --yes, or specify the missing flags:\n  ${rerun.display}`;
}
