/**
 * What the user is told when publishing goes wrong, and the two guarantees the
 * publish leans on: a command can be stopped, and none can ask a question.
 */
import {describe, expect, test} from 'bun:test';
import {withoutPrompts} from '../source/core/git.js';
import {runCommand} from '../source/core/process.js';
import {
	describePullRequest,
	destinationLabel,
	explainPush,
	outputLines,
	pullRequestProblem,
	pushProblem,
} from '../source/core/publish.js';
import type {ParsedRemote} from '../source/core/repo.js';

const github: ParsedRemote = {
	kind: 'hosted',
	url: 'git@github.com:acme/storefront.git',
	host: 'github.com',
	realHost: 'github.com',
	owner: 'acme',
	repo: 'storefront',
	identifier: 'github.com/acme/storefront',
};

const aliased: ParsedRemote = {
	...github,
	host: 'github.com-work',
	identifier: 'github.com-work/acme/storefront',
};

const local: ParsedRemote = {
	kind: 'local',
	url: '/srv/git/storefront.git',
	path: '/srv/git/storefront.git',
	repo: 'storefront',
	identifier: 'storefront',
};

const branch = 'chore/trunk-setup';

/** An environment from name/value pairs, so the names can stay upper case. */
const env = (...pairs: Array<[string, string]>): NodeJS.ProcessEnv =>
	Object.fromEntries(pairs);

describe('where it is going', () => {
	test('a hosted remote is host, owner and repository, with an alias left as written', () => {
		expect(destinationLabel(github)).toBe('github.com:acme/storefront');
		expect(destinationLabel(aliased)).toBe('github.com-work:acme/storefront');
	});

	test('a local remote is just its name', () => {
		expect(destinationLabel(local)).toBe('storefront');
	});
});

describe('what a tool said', () => {
	test('is trimmed to a few lines, with no blanks and no repeats', () => {
		const said = outputLines(
			'To github.com:acme/storefront.git   \n\n ! [remote rejected] x (denied)\n ! [remote rejected] x (denied)\nerror: nope\nhint: one\nhint: two\n',
			4,
		);

		expect(said).toEqual([
			'To github.com:acme/storefront.git',
			' ! [remote rejected] x (denied)',
			'error: nope',
			'hint: one',
		]);
	});

	test('nothing at all is nothing to show', () => {
		expect(outputLines('  \n\n')).toEqual([]);
	});
});

describe('why a push failed', () => {
	const cases: ReadonlyArray<readonly [string, string, RegExp]> = [
		[
			'a refused SSH key',
			'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.',
			/SSH key was not accepted by github\.com.*ssh -T git@github\.com/,
		],
		[
			'a host it does not know yet',
			'Host key verification failed.\nfatal: Could not read from remote repository.',
			/cannot ask whether to trust github\.com.*ssh -T git@github\.com/,
		],
		[
			'HTTPS credentials it cannot ask for',
			"fatal: could not read Username for 'https://github.com': terminal prompts disabled",
			/needs credentials for github\.com and cannot ask here.*gh auth login/,
		],
		[
			'a branch that is behind',
			' ! [rejected]        chore/trunk-setup -> chore/trunk-setup (non-fast-forward)',
			/chore\/trunk-setup already exists on origin with other commits/,
		],
		[
			'no write access',
			' ! [remote rejected] chore/trunk-setup -> chore/trunk-setup (permission denied)',
			/Check that you can write to acme\/storefront/,
		],
		[
			'a protected branch',
			'remote: error: GH006: Protected branch update failed',
			/Check that you can write to acme\/storefront/,
		],
		[
			'no network',
			"fatal: unable to access 'https://github.com/acme/storefront.git/': Could not resolve host: github.com",
			/Could not reach github\.com\. Check your connection/,
		],
		[
			'a timeout',
			'ssh: connect to host github.com port 22: Operation timed out',
			/Could not reach github\.com/,
		],
	];

	for (const [name, output, expected] of cases) {
		test(`says so for ${name}`, () => {
			expect(explainPush(output, github, branch)).toMatch(expected);
		});
	}

	test('names the alias the user typed, since that is the host ssh was asked about', () => {
		expect(
			explainPush('Permission denied (publickey).', aliased, branch),
		).toContain('git@github.com-work');
	});

	test('a behind branch is not mistaken for a permissions problem, though both say rejected', () => {
		expect(
			explainPush(' ! [remote rejected] x (non-fast-forward)', github, branch),
		).toContain('already exists on origin');
	});

	test('something it does not recognise still points at git’s own words', () => {
		expect(explainPush('fatal: something new', github, branch)).toBe(
			"Read git's message above, fix the cause, then try again.",
		);
	});

	test('a local remote is named as the remote, not as a host', () => {
		expect(
			explainPush('Permission denied (publickey).', local, branch),
		).toContain('the remote');
		expect(explainPush('remote rejected', local, branch)).toContain(
			'storefront',
		);
	});
});

describe('the card for a failed push', () => {
	test('has git’s words, one fix and the command to run once it is fixed', () => {
		const problem = pushProblem(
			"To github.com:acme/storefront.git\n ! [remote rejected] chore/trunk-setup (permission denied)\nerror: failed to push some refs to 'github.com:acme/storefront.git'\n",
			github,
			branch,
		);

		expect(problem).toMatchObject({
			tone: 'error',
			title: 'Push failed',
			after: 'git push -u origin chore/trunk-setup',
			question: 'Try again, or leave it local?',
			note: 'Nothing was changed on origin.',
		});
		expect(problem.said).toEqual([
			'To github.com:acme/storefront.git',
			' ! [remote rejected] chore/trunk-setup (permission denied)',
		]);
		expect(problem.fix).toContain('acme/storefront');
	});

	test('never carries a raw newline, which would break the screen', () => {
		const problem = pushProblem(
			'one\r\ntwo\nthree\nfour\nfive',
			github,
			branch,
		);

		expect(problem.said).toHaveLength(3);
		for (const line of problem.said) {
			expect(line).not.toMatch(/[\r\n]/);
		}
	});
});

describe('the card for a pull request that failed after a good push', () => {
	const compare =
		'https://github.com/acme/storefront/compare/chore%2Ftrunk-setup?expand=1';

	test('when gh is signed out, says to sign in and gives the command', () => {
		const problem = pullRequestProblem(
			'To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable.',
			compare,
		);

		expect(problem).toMatchObject({
			tone: 'warning',
			title: 'Pushed, but no pull request',
			fix: 'Sign in to GitHub, then try again.',
			after: 'gh auth login',
			link: compare,
			question: 'Try opening it again?',
		});
	});

	test('for any other reason, offers the link instead of a command', () => {
		const problem = pullRequestProblem(
			'GraphQL: something else went wrong',
			compare,
		);

		expect(problem.after).toBeUndefined();
		expect(problem.fix).toContain('open it yourself');
		expect(problem.link).toBe(compare);
	});

	test('without a link to offer, offers none', () => {
		expect(pullRequestProblem('nope', undefined).link).toBeUndefined();
	});
});

describe('the pull request gh opened', () => {
	test('is its number and its address without the scheme', () => {
		expect(
			describePullRequest(
				'Creating pull request\nhttps://github.com/acme/storefront/pull/12\n',
			),
		).toBe('#12  github.com/acme/storefront/pull/12');
	});

	test('falls back to what gh printed when there is no address in it', () => {
		expect(describePullRequest('done')).toBe('done');
		expect(describePullRequest('')).toBe('opened');
	});
});

describe('a command that can be stopped', () => {
	test('ends at once when aborted, and says it was aborted', async () => {
		const controller = new AbortController();
		const started = Date.now();
		const pending = runCommand('sleep', ['30'], {signal: controller.signal});
		setTimeout(() => {
			controller.abort();
		}, 100);

		const result = await pending;

		expect(result.aborted).toBe(true);
		expect(result.code).toBeUndefined();
		expect(Date.now() - started).toBeLessThan(5000);
	});

	test('runs to the end, without the flag, when nobody aborts', async () => {
		const controller = new AbortController();

		const result = await runCommand('echo', ['done'], {
			signal: controller.signal,
		});

		expect(result).toEqual({code: 0, stdout: 'done\n', stderr: ''});
	});

	test('is not started at all when the signal is already aborted', async () => {
		const controller = new AbortController();
		controller.abort();

		const result = await runCommand('echo', ['never'], {
			signal: controller.signal,
		});

		expect(result.aborted).toBe(true);
		expect(result.stdout).toBe('');
	});
});

describe('a command that may not ask a question', () => {
	test('has git and gh prompts off and ssh in batch mode', () => {
		const environment = withoutPrompts(env(['PATH', '/bin']));

		expect(environment['GIT_TERMINAL_PROMPT']).toBe('0');
		expect(environment['GH_PROMPT_DISABLED']).toBe('1');
		expect(environment['GIT_SSH_COMMAND']).toBe('ssh -o BatchMode=yes');
		expect(environment['PATH']).toBe('/bin');
	});

	test('keeps an ssh command the user chose', () => {
		expect(
			withoutPrompts(env(['GIT_SSH_COMMAND', 'ssh -i ~/.ssh/work']))[
				'GIT_SSH_COMMAND'
			],
		).toBe('ssh -i ~/.ssh/work');
		expect(
			withoutPrompts(env(['GIT_SSH', '/usr/bin/ssh']))['GIT_SSH_COMMAND'],
		).toBeUndefined();
	});

	test('does not touch the environment it was given', () => {
		const base = env(['PATH', '/bin']);

		withoutPrompts(base);

		expect(base).toEqual(env(['PATH', '/bin']));
	});
});
