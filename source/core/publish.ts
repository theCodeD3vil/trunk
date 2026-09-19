/**
 * What to tell someone when publishing the setup branch goes wrong. `git push`
 * and `gh pr create` explain themselves in their own words, which are worth
 * showing, but the reader wants one sentence on what to do, and the exact
 * command to run once it is fixed. Everything here is a pure function of the
 * tool's output, so the wording can be tested without a network.
 */
import type {PublishProblem} from './session.js';
import type {ParsedRemote} from './repo.js';

/** Where the branch is going, as a short label: `github.com:acme/storefront`. */
export function destinationLabel(remote: ParsedRemote): string {
	return remote.kind === 'hosted'
		? `${remote.host}:${remote.owner}/${remote.repo}`
		: remote.repo;
}

function hostOf(remote: ParsedRemote): string {
	return remote.kind === 'hosted' ? remote.host : 'the remote';
}

function repositoryOf(remote: ParsedRemote): string {
	return remote.kind === 'hosted'
		? `${remote.owner}/${remote.repo}`
		: remote.repo;
}

/**
 * The lines worth showing from a tool's output: no blanks, no repeats, and at
 * most `limit` of them, because the card is a summary and the full text can be
 * had by running the command again.
 */
export function outputLines(text: string, limit = 4): string[] {
	const seen = new Set<string>();
	const lines: string[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.replaceAll(/\s+$/g, '');
		if (line.trim() === '' || seen.has(line)) {
			continue;
		}

		seen.add(line);
		lines.push(line);
	}

	return lines.slice(0, limit);
}

/** One sentence on why a push failed, chosen by what git said. */
export function explainPush(
	output: string,
	remote: ParsedRemote,
	branch: string,
): string {
	const host = hostOf(remote);
	if (/host key verification failed|no matching host key/i.test(output)) {
		return `Trunk cannot ask whether to trust ${host}. Run ssh -T git@${host} once, then try again.`;
	}

	if (/permission denied \(publickey\)/i.test(output)) {
		return `Your SSH key was not accepted by ${host}. Check it with ssh -T git@${host}.`;
	}

	if (
		/could not read username|authentication failed|invalid username|terminal prompts disabled/i.test(
			output,
		)
	) {
		return `Git needs credentials for ${host} and cannot ask here. Sign in with gh auth login, or set up a credential helper.`;
	}

	if (
		/non-fast-forward|fetch first|updates were rejected|stale info/i.test(
			output,
		)
	) {
		return `${branch} already exists on origin with other commits. Pull it, or pick another branch name.`;
	}

	if (
		/remote rejected|permission to .* denied|denied to|\b403\b|protected branch|write access/i.test(
			output,
		)
	) {
		return `Check that you can write to ${repositoryOf(
			remote,
		)}, then try again.`;
	}

	if (
		/could not resolve host|unable to access|network is unreachable|connection (timed out|refused|reset)|operation timed out|no route to host/i.test(
			output,
		)
	) {
		return `Could not reach ${host}. Check your connection, then try again.`;
	}

	return "Read git's message above, fix the cause, then try again.";
}

/** The card for a push that did not go through. */
export function pushProblem(
	output: string,
	remote: ParsedRemote,
	branch: string,
): PublishProblem {
	return {
		tone: 'error',
		title: 'Push failed',
		// The closing "failed to push some refs" line repeats what the card says.
		said: outputLines(
			output.replaceAll(/^error: failed to push some refs.*$/gim, ''),
			3,
		),
		fix: explainPush(output, remote, branch),
		after: `git push -u origin ${branch}`,
		question: 'Try again, or leave it local?',
		note: 'Nothing was changed on origin.',
	};
}

/** The card for a pull request that could not be opened after a good push. */
export function pullRequestProblem(
	output: string,
	compare: string | undefined,
): PublishProblem {
	const signedOut =
		/gh auth login|not logged in|authentication|gh_token|bad credentials/i.test(
			output,
		);
	return {
		tone: 'warning',
		title: 'Pushed, but no pull request',
		said: outputLines(output, 3),
		fix: signedOut
			? 'Sign in to GitHub, then try again.'
			: 'Try again, or open it yourself from the link.',
		after: signedOut ? 'gh auth login' : undefined,
		link: compare,
		question: 'Try opening it again?',
	};
}

/** `#12  github.com/acme/storefront/pull/12`, from the URL gh prints. */
export function describePullRequest(output: string): string {
	const url = /https?:\/\/\S+\/pull\/(\d+)/.exec(output);
	if (url !== null) {
		return `#${url[1]!}  ${url[0].replace(/^https?:\/\//, '')}`;
	}

	const last = output.trim().split(/\r?\n/).at(-1);
	return last === undefined || last === '' ? 'opened' : last;
}
