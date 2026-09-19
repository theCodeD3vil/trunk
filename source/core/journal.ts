/**
 * A record of what one run created, written before each step acts rather than
 * after it succeeds. An interrupted run can then say exactly what exists and
 * undo precisely that, without guessing from the state on disk.
 *
 * The journal only describes work; it never performs it. The command owns the
 * running, so the order and the wording stay reviewable in one place.
 */
import {relative} from 'node:path';

export type JournalEntryKind =
	/** The project folder itself, and whether trunk is the one that made it. */
	| 'folder'
	| 'bare-repo'
	| 'worktree'
	/** A worktree together with the branch created for it. */
	| 'branch-worktree';

export type JournalEntry = Readonly<{
	kind: JournalEntryKind;
	path: string;
	branch?: string;
	/** Trails the description, e.g. `wt.toml uncommitted`. */
	note?: string;
}>;

export type UndoCommand = Readonly<{
	executable: string;
	arguments: readonly string[];
	/** What the command is for, shown when the user keeps the run instead. */
	purpose: string;
}>;

const descriptions: Readonly<Record<JournalEntryKind, string>> = {
	folder: 'project folder',
	'bare-repo': 'bare repo',
	worktree: 'worktree',
	'branch-worktree': 'worktree + branch',
};

export class Journal {
	private readonly records: JournalEntry[] = [];

	/** Called before the step that creates the thing, never after. */
	record(entry: JournalEntry): void {
		this.records.push(Object.freeze({...entry}));
	}

	/**
	 * Corrects an entry after the fact, for when wt placed a worktree somewhere
	 * other than where trunk proposed. Rollback has to target the real path.
	 */
	relocate(from: string, to: string): void {
		const index = this.records.findIndex(record => record.path === from);
		if (index !== -1) {
			this.records[index] = Object.freeze({...this.records[index]!, path: to});
		}
	}

	/** Adds a trailing note to the most recent matching entry. */
	annotate(path: string, note: string): void {
		const entry = this.records.findLast(record => record.path === path);
		if (entry) {
			this.records[this.records.indexOf(entry)] = Object.freeze({
				...entry,
				note,
			});
		}
	}

	get entries(): readonly JournalEntry[] {
		return Object.freeze([...this.records]);
	}

	get isEmpty(): boolean {
		return this.records.length === 0;
	}

	/** True only when trunk created the folder, which gates removing it. */
	get createdFolder(): string | undefined {
		return this.records.find(entry => entry.kind === 'folder')?.path;
	}

	/**
	 * The `created by this run:` block, with the paths in one column. Paths are
	 * shown relative to the working directory because that is how the user typed
	 * them and how the resume command will repeat them.
	 */
	describe(workingDirectory: string): readonly string[] {
		const rows = this.rows(workingDirectory);
		const width = Math.max(0, ...rows.map(row => row.path.length));
		return Object.freeze(
			rows.map(row => `${row.path.padEnd(width)}  ${row.description}`),
		);
	}

	/** Each entry as a path and a description, for callers that lay them out themselves. */
	rows(
		workingDirectory: string,
	): ReadonlyArray<Readonly<{path: string; description: string}>> {
		return this.records.map(entry => ({
			path: displayPath(entry.path, workingDirectory),
			description: describeEntry(entry),
		}));
	}
}

/**
 * How to undo the run, newest first: a worktree cannot be removed after the
 * repository it belongs to is gone.
 */
export function undoCommands(
	journal: Journal,
	projectDirectory: string,
	wtPath = 'wt',
	gitPath = 'git',
): readonly UndoCommand[] {
	const commands: UndoCommand[] = [];
	for (const entry of [...journal.entries].reverse()) {
		switch (entry.kind) {
			case 'branch-worktree': {
				commands.push({
					executable: wtPath,
					arguments: [
						'-C',
						projectDirectory,
						'remove',
						entry.branch ?? '',
						'--no-hooks',
						'--yes',
						// The generated config may still be uncommitted in there, and wt
						// refuses to remove a worktree with uncommitted files.
						'--force',
					],
					purpose: `remove the ${entry.branch ?? 'setup'} worktree and branch`,
				});
				break;
			}

			case 'worktree': {
				commands.push({
					executable: gitPath,
					arguments: [
						'-C',
						projectDirectory,
						'worktree',
						'remove',
						entry.path,
						'--force',
					],
					purpose: 'remove the default worktree',
				});
				break;
			}

			case 'folder': {
				commands.push({
					executable: 'rm',
					arguments: ['-rf', entry.path],
					purpose: 'remove the project folder trunk created',
				});
				break;
			}

			case 'bare-repo': {
				// Removed with the folder; deleting it alone would strand the
				// worktrees that point at it.
				break;
			}
		}
	}

	return Object.freeze(commands);
}

/** How to pick the run back up after keeping what it created. */
export function resumeCommand(
	projectDirectory: string,
	workingDirectory: string,
): string {
	return `trunk init ${displayPath(projectDirectory, workingDirectory)}`;
}

function describeEntry(entry: JournalEntry): string {
	const description = descriptions[entry.kind];
	return entry.note ? `${description} (${entry.note})` : description;
}

function displayPath(path: string, workingDirectory: string): string {
	const value = relative(workingDirectory, path);
	if (!value) {
		return '.';
	}

	return value.startsWith('.') ? value : `./${value}`;
}
