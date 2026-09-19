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
 *
 * The override has a side effect that must be undone. Ink's colour library
 * reads the same variable when it loads and treats the mere presence of `CI`,
 * whatever its value, as a terminal without colour, so every screen would be
 * drawn in plain text. The colour level is therefore worked out here, from the
 * real environment, and handed to the library through `FORCE_COLOR` for the
 * duration of the import.
 */
import process from 'node:process';

/** What a terminal can show, in chalk's terms: 0 none, 1 basic, 2 256, 3 truecolor. */
export type ColourLevel = 0 | 1 | 2 | 3;

type ColourStream = Readonly<{
	getColorDepth?: (environment?: NodeJS.ProcessEnv) => number;
}>;

/**
 * The colour level of a stream as the terminal itself reports it, ignoring
 * `CI`: Node applies the same "CI means no colour" rule and would otherwise
 * answer for a machine the user is sitting at.
 */
export function colourLevel(
	stream: ColourStream = process.stdout,
	environment: NodeJS.ProcessEnv = process.env,
): ColourLevel {
	if (stream.getColorDepth === undefined) {
		return 0;
	}

	const real = {...environment};
	delete real['CI'];
	const depth = stream.getColorDepth(real);
	if (depth >= 24) {
		return 3;
	}

	if (depth >= 8) {
		return 2;
	}

	return depth >= 4 ? 1 : 0;
}

/**
 * Runs an import with CI detection switched off and the colour level pinned,
 * then puts the environment back so git, wt and gh still see exactly what the
 * user exported.
 */
export async function importInteractive<T>(
	load: () => Promise<T>,
	stream: ColourStream = process.stdout,
	environment: NodeJS.ProcessEnv = process.env,
): Promise<T> {
	const originalCi = environment['CI'];
	const originalColour = environment['FORCE_COLOR'];
	// Someone who set FORCE_COLOR meant it; only fill in when they did not.
	const level =
		originalColour === undefined ? colourLevel(stream, environment) : 0;
	environment['CI'] = 'false';
	if (level > 0) {
		environment['FORCE_COLOR'] = String(level);
	}

	try {
		return await load();
	} finally {
		if (originalCi === undefined) {
			delete environment['CI'];
		} else {
			environment['CI'] = originalCi;
		}

		if (originalColour === undefined) {
			delete environment['FORCE_COLOR'];
		} else {
			environment['FORCE_COLOR'] = originalColour;
		}
	}
}
