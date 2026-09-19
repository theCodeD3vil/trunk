/**
 * Loading the terminal UI without letting the environment silence it.
 *
 * Ink decides once, when its module is first evaluated, whether it is running
 * in CI, and in CI it draws nothing until the program exits. The check reads
 * variables such as `CI` and any hosting vendor's marker (`VERCEL`, for
 * example), which plenty of developers have exported in their shell profile. The
 * result is a blank terminal until Ctrl+C, when the final frame appears and the
 * program is already gone.
 *
 * Trunk only mounts a UI after confirming stdin is a real terminal that can
 * read keys, so CI detection has nothing to offer it. Ink itself honours
 * `CI=false` as an override, but only if that is set while it loads, hence this
 * wrapper: every module that imports Ink must be loaded through it, never with
 * a static import.
 */
import process from 'node:process';

/**
 * Runs an import with CI detection switched off and puts the environment back
 * afterwards, so git, wt and gh still see exactly what the user exported.
 */
export async function importInteractive<T>(load: () => Promise<T>): Promise<T> {
	const original = process.env['CI'];
	process.env['CI'] = 'false';
	try {
		return await load();
	} finally {
		if (original === undefined) {
			delete process.env['CI'];
		} else {
			process.env['CI'] = original;
		}
	}
}
