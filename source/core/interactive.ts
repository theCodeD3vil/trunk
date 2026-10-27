/**
 * Loading the terminal UI, and what a terminal can show.
 *
 * The UI draws through OpenTUI, whose native core Node loads with `node:ffi`.
 * Node marks that module experimental and prints a warning the first time it
 * loads, which would land on the user's screen beside the UI on every run.
 * Every module that imports the UI is therefore loaded through this wrapper,
 * never with a static import, which also keeps scripts and `--yes` runs from
 * loading native code at all.
 *
 * OpenTUI's React layer also reads `DEV` as it loads, and with `DEV=true` it
 * connects to React DevTools over a WebSocket. A `DEV` in the user's shell is
 * about their own project, never trunk, so it is hidden for the import.
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

const ffiWarning = 'FFI is an experimental feature';

/**
 * Silences Node's one experimental-FFI warning, and only that one, then runs
 * the import with `DEV` hidden. The filter stays: Node prints the warning after
 * the import settles, and it is the only warning OpenTUI causes.
 */
export async function importInteractive<T>(
	load: () => Promise<T>,
	environment: NodeJS.ProcessEnv = process.env,
): Promise<T> {
	const {emitWarning} = process;
	process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
		const message = typeof warning === 'string' ? warning : warning.message;
		if (!message.startsWith(ffiWarning)) {
			Reflect.apply(emitWarning, process, [warning, ...rest]);
		}
	}) as typeof process.emitWarning;

	const development = environment['DEV'];
	delete environment['DEV'];
	try {
		return await load();
	} finally {
		if (development !== undefined) {
			environment['DEV'] = development;
		}
	}
}
