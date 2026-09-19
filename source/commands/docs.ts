/**
 * `trunk-cli docs`: the offline documentation browser. Everything it shows is
 * bundled into the package, so it needs no checkout, browser or network. It is
 * interactive only; without a terminal that can read keys it explains that and
 * exits with a usage error instead of dumping the pages as text.
 */
import {importInteractive} from '../core/interactive.js';
import {badUsage, succeed, type Outcome} from '../core/result.js';
import type {DocumentationBrowserOutcome} from '../ui/DocsBrowser.js';

export type DocumentationDependencies = Readonly<{
	/** Injectable so the exit paths are testable without a terminal. */
	browse?: () => Promise<DocumentationBrowserOutcome>;
}>;

/** Loads the browser lazily, so Ink is never imported before it is needed. */
async function browseInteractively(): Promise<DocumentationBrowserOutcome> {
	const {runDocumentationBrowser} = await importInteractive(
		async () => import('../ui/DocsBrowser.js'),
	);
	return runDocumentationBrowser();
}

export async function runDocumentation(
	arguments_: readonly string[],
	dependencies: DocumentationDependencies = {},
): Promise<Outcome> {
	if (arguments_.length > 0) {
		return badUsage(`unexpected argument: ${arguments_[0]!}`);
	}

	const outcome = await (dependencies.browse ?? browseInteractively)();
	return outcome.kind === 'unavailable'
		? badUsage(
				`trunk-cli docs is interactive and needs a terminal that can read keys (${outcome.reason}). Run it directly in a terminal; Worktrunk's own documentation is at https://worktrunk.dev.`,
		  )
		: succeed();
}
