import {describe, expect, test} from 'bun:test';
import {Journal, resumeCommand, undoCommands} from '../source/core/journal.js';

const project = '/work/acme-admin';

describe('run journal', () => {
	test('describes what a run created, in one column', () => {
		const journal = populated();

		expect(journal.describe('/work')).toEqual([
			'./acme-admin                    project folder',
			'./acme-admin/.git               bare repository',
			'./acme-admin/main               worktree',
			'./acme-admin/chore-trunk-setup  worktree + branch, wt.toml uncommitted',
		]);
	});

	test('undoes newest first, and only removes a folder trunk made', () => {
		const journal = populated();

		const commands = undoCommands(journal, project, '/bin/wt', '/bin/git');

		expect(
			commands.map(command =>
				[command.executable, ...command.arguments].join(' '),
			),
		).toEqual([
			`/bin/wt -C ${project} remove chore/trunk-setup --no-hooks --yes --force`,
			`/bin/git -C ${project} worktree remove ${project}/main --force`,
			`rm -rf ${project}`,
		]);
	});

	test('leaves a folder it did not create alone', () => {
		const journal = new Journal();
		journal.record({kind: 'bare-repo', path: `${project}/.git`});
		journal.record({
			kind: 'branch-worktree',
			path: `${project}/chore-trunk-setup`,
			branch: 'chore/trunk-setup',
		});

		const commands = undoCommands(journal, project);

		expect(journal.createdFolder).toBeUndefined();
		expect(commands.map(command => command.executable)).toEqual(['wt']);
	});

	test('follows a worktree that landed somewhere else', () => {
		const journal = new Journal();
		journal.record({
			kind: 'branch-worktree',
			path: `${project}/chore-trunk-setup`,
			branch: 'chore/trunk-setup',
		});
		journal.relocate(
			`${project}/chore-trunk-setup`,
			`${project}/.git.chore-trunk-setup`,
		);

		expect(journal.describe('/work')[0]).toContain('.git.chore-trunk-setup');
	});

	test('names the command that picks the run back up', () => {
		expect(resumeCommand(project, '/work')).toBe('trunk-cli init ./acme-admin');
	});
});

function populated(): Journal {
	const journal = new Journal();
	journal.record({kind: 'folder', path: project});
	journal.record({kind: 'bare-repo', path: `${project}/.git`});
	journal.record({kind: 'worktree', path: `${project}/main`, branch: 'main'});
	journal.record({
		kind: 'branch-worktree',
		path: `${project}/chore-trunk-setup`,
		branch: 'chore/trunk-setup',
		note: 'wt.toml uncommitted',
	});
	return journal;
}
