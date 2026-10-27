/**
 * The interactive setup session: one React app that stays mounted for the whole
 * of `clone` or `init`, so the questions, the review, the run and the result are
 * a single continuous screen. The setup code talks to it through the plain
 * `Session` interface; this file turns each call into a screen and each answer
 * into a resolved promise. What the screen looks like, and everything that
 * moves on it, is the shell's (`./shell`).
 */
import {performance} from 'node:perf_hooks';
import process from 'node:process';
import React, {useEffect, useRef, useSyncExternalStore} from 'react';
import {flushSync, useTerminalDimensions} from '@opentui/react';
import {colourLevel} from '../core/interactive.js';
import {trunkVersion} from '../core/version.js';
import type {
	FailureRequest,
	FinishRequest,
	OverwriteRequest,
	ResultLine,
	Session,
	StepDefinition,
	StepStatus,
} from '../core/session.js';
import type {Settings} from '../core/settings.js';
import {copyToClipboard} from '../docs/clipboard.js';
import {abortKey} from './keys.js';
import {createKit} from './kit/lines.js';
import {ansiLines, Lines, mount} from './kit/render.js';
import {resolveTheme} from './kit/theme.js';
import {useKeys, type Point} from './use-keys.js';
import {failureKey, type FailureState} from './screens/callouts.js';
import {doneLines, outcomeOf} from './screens/done.js';
import {
	buildOverwriteModel,
	initialOverwrite,
	overwriteKey,
	scrollLimit,
} from './screens/overwrite.js';
import {
	appendLog,
	askPublish,
	endPublish,
	initialRun,
	runKey,
	startPublish,
	updatePublish,
	updateStep,
	type RunState,
} from './screens/running.js';
import {createController, type Controller} from './shell/controller.js';
import {motionEnabled} from './shell/motion.js';
import {frameLines} from './shell/view.js';

/** A tiny observable, so the imperative Session API can drive React state. */
function createStore() {
	let version = 0;
	const listeners = new Set<() => void>();
	return {
		get: () => version,
		bump() {
			version += 1;
			for (const listener of listeners) {
				listener();
			}
		},
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

type Store = ReturnType<typeof createStore>;

type AppProperties = Readonly<{
	store: Store;
	controller: Controller;
	onKey: (name: string, at?: Point) => void;
}>;

function SessionApp({
	store,
	controller,
	onKey,
}: AppProperties): React.ReactNode {
	useSyncExternalStore(store.subscribe, store.get);
	const terminal = useTerminalDimensions();
	const now = performance.now();
	controller.resize(terminal.width || 80, terminal.height || 40, now);
	const frame = controller.frame(now);
	const lines = frameLines(frame);

	// Effects and the spinner schedule their own next frame; a still screen schedules none.
	useEffect(() => {
		const wait = controller.delay(now);
		if (wait === undefined) {
			return undefined;
		}

		const timer = setTimeout(() => {
			store.bump();
		}, wait);
		return () => {
			clearTimeout(timer);
		};
	});

	// Clicks and hovers are resolved against exactly what this render drew.
	const drawn = useRef(lines);
	drawn.current = lines;
	useKeys(
		onKey,
		() => drawn.current,
		target => {
			if (controller.hover(target, performance.now())) {
				store.bump();
			}
		},
	);

	return (
		<Lines lines={lines} theme={frame.theme} width={terminal.width || 80} />
	);
}

/** Clears the visible screen and puts the cursor at the top; the scrollback is left alone. */
const clearScreen = '\u001B[2J\u001B[H';

/** The width the last lines are drawn to: the window's, up to a readable line. */
const columns = (): number => Math.min(process.stdout.columns || 80, 104);

/** Writes to a stream and waits until it has been flushed. */
const writeAll = async (
	stream: NodeJS.WriteStream,
	text: string,
): Promise<void> =>
	new Promise(resolve => {
		stream.write(text, () => {
			resolve();
		});
	});

/** Mounts the app and returns the imperative Session the setup code drives. */
export async function openSession(): Promise<Session> {
	const store = createStore();
	const controller = createController({
		theme: resolveTheme(),
		version: trunkVersion(),
		motion: motionEnabled(),
		copy: copyToClipboard,
		wake() {
			store.bump();
		},
		clock: () => performance.now(),
	});
	let aborted = false;
	/** Aborted by the first Ctrl+C during work, which stops the command in progress. */
	const stopWork = new AbortController();
	let run: RunState | undefined;
	/** Handles keys for whatever question is showing; a no-op between questions. */
	let onKey: (name: string, at?: Point) => void = () => undefined;
	/** Resolves the question on screen with undefined, when the user cancels. */
	let cancelPending: (() => void) | undefined;
	/** Set while a push or pull request runs; aborting it stops the command. */
	let publishing: AbortController | undefined;

	const showRun = () => {
		if (run !== undefined) {
			controller.show({kind: 'run', run}, performance.now());
			store.bump();
		}
	};

	const dispatch = (name: string, at?: Point) => {
		if (name !== abortKey) {
			if (name === 'c' || name.startsWith('copy:')) {
				const index = name === 'c' ? undefined : Number(name.slice(5));
				controller.copyNext(index);
			}

			onKey(name, at);
			store.bump();
			return;
		}

		if (cancelPending !== undefined) {
			aborted = true;
			cancelPending();
			return;
		}

		// A push or a pull request is running: stop that command, and quit at
		// once if it is already being stopped.
		if (publishing !== undefined) {
			if (publishing.signal.aborted) {
				void quitNow();
			}

			publishing.abort();
			if (run?.publish !== undefined) {
				run = {...run, publish: {...run.publish, stopping: true}};
				showRun();
			}

			return;
		}

		// Nothing is being asked, so work is running: stop the command in
		// progress, and quit at once on a second press.
		if (aborted) {
			// A second Ctrl+C means "now": nothing is left to unwind gracefully.
			void quitNow();
		}

		aborted = true;
		stopWork.abort();
		if (run !== undefined) {
			run = {...run, cancelling: true};
			showRun();
		}
	};

	/** Restores the terminal, then exits as an interrupted command does. */
	const quitNow = async () => {
		await app.unmount();
		// eslint-disable-next-line unicorn/no-process-exit
		process.exit(130);
	};

	const app = await mount(
		<SessionApp store={store} controller={controller} onKey={dispatch} />,
	);

	/** Shows a screen and waits for `onKey` to produce an answer. */
	const ask = async <T,>(
		show: () => void,
		handle: (
			name: string,
			answer: (value: T | undefined) => void,
			at?: Point,
		) => void,
	): Promise<T | undefined> => {
		if (aborted) {
			return undefined;
		}

		return new Promise<T | undefined>(resolve => {
			const answer = (value: T | undefined) => {
				cancelPending = undefined;
				onKey = () => undefined;
				resolve(value);
			};

			cancelPending = () => {
				answer(undefined);
			};

			onKey = (name, at) => {
				handle(name, answer, at);
			};

			show();
			store.bump();
		});
	};

	return {
		async configure(request) {
			return ask<Settings>(
				() => {
					controller.configure(request, performance.now());
				},
				(name, answer) => {
					const values = controller.key(name, performance.now());
					if (values === undefined) {
						return;
					}

					try {
						answer(request.toSettings(values));
					} catch (error) {
						// The form already says why a field is wrong; anything else is said here.
						controller.toast(
							error instanceof Error ? error.message : String(error),
							performance.now(),
							'warn',
						);
					}
				},
			);
		},

		start(steps: readonly StepDefinition[], command, project) {
			run = initialRun(steps, command, project);
			showRun();
		},

		update(id: string, status: StepStatus, detail?: string) {
			if (run !== undefined) {
				run = updateStep(run, id, status, performance.now(), detail);
				showRun();
			}
		},

		log(event) {
			if (run !== undefined) {
				run = appendLog(run, event);
				showRun();
			}
		},

		async overwrite(request: OverwriteRequest) {
			const model = buildOverwriteModel(request.existing, request.generated);
			let state = initialOverwrite;
			const show = () => {
				controller.show(
					{kind: 'overwrite', request, model, state, run},
					performance.now(),
				);
			};

			const answer = await ask<'keep' | 'replace'>(show, (name, resolve) => {
				const step = overwriteKey(
					state,
					name,
					scrollLimit(model, state, (process.stdout.rows || 40) - 1),
				);
				state = step.state;
				if (step.answer === undefined) {
					show();
				} else {
					resolve(step.answer);
				}
			});
			showRun();
			return answer;
		},

		async finish(request: FinishRequest) {
			const base = run ?? initialRun([], request.command, request.project);
			// The question starts on "Not now": pushing is never the default.
			let state: RunState = {
				...base,
				finish: {
					request,
					sel: 1,
					outcome: [],
					answered: request.push === undefined,
				},
			};
			run = state;
			if (request.push === undefined) {
				showRun();
				return 'skip';
			}

			return ask<'push' | 'skip'>(showRun, (name, resolve) => {
				const step = runKey(state, name);
				state = step.state;
				run = state;
				showRun();
				if (step.answer === 'push' || step.answer === 'skip') {
					resolve(step.answer);
				}
			});
		},

		result(lines: readonly ResultLine[]) {
			if (run?.finish !== undefined) {
				run = {
					...run,
					finish: {...run.finish, outcome: [...run.finish.outcome, ...lines]},
				};
				showRun();
			} else if (run !== undefined) {
				// A run that stopped: say what was kept or rolled back.
				run = {...run, outcome: [...(run.outcome ?? []), ...lines]};
				showRun();
			}
		},

		publishStart(request) {
			publishing = new AbortController();
			if (run !== undefined) {
				run = startPublish(run, request);
				showRun();
			}

			return publishing.signal;
		},

		publishUpdate(step, status, detail) {
			if (run !== undefined) {
				run = updatePublish(run, step, status, performance.now(), detail);
				showRun();
			}
		},

		async publishProblem(problem) {
			if (run === undefined) {
				return undefined;
			}

			run = askPublish(run, problem);
			return ask<'retry' | 'later'>(showRun, (name, resolve) => {
				const step = runKey(run!, name);
				run = step.state;
				showRun();
				if (step.answer === 'retry' || step.answer === 'later') {
					resolve(step.answer);
				}
			});
		},

		publishEnd(lines) {
			publishing = undefined;
			if (run !== undefined) {
				run = endPublish(run, lines);
				showRun();
			}
		},

		async fail(request: FailureRequest) {
			let state: FailureState = {sel: 0};
			const show = () => {
				controller.show(
					{kind: 'failure', request, state, run},
					performance.now(),
				);
			};

			const answer = await ask<'keep' | 'rollback'>(show, (name, resolve) => {
				const step = failureKey(request, state, name);
				state = step.state;
				if (step.answer === undefined) {
					show();
				} else {
					resolve(step.answer);
				}
			});
			// Back to the steps, which now show the cross where it stopped.
			showRun();
			return answer;
		},

		aborted: () => aborted,

		signal: stopWork.signal,

		async close() {
			onKey = () => undefined;
			// A finished run clears the screen and leaves the next steps, not the UI it ran in.
			if (run?.finish !== undefined && !aborted) {
				await app.unmount();
				await writeAll(
					process.stdout,
					`${clearScreen}${ansiLines(
						doneLines(
							createKit(controller.theme.glyphs, columns()),
							run.finish.request,
							outcomeOf(run),
						),
						controller.theme,
						columns(),
						colourLevel(process.stdout),
					)}`,
				);
				return true;
			}

			if (run?.cancelling === true) {
				run = {...run, cancelling: false};
				showRun();
			}

			// Redraw once without the key bar: this frame stays in the scrollback.
			controller.close();
			// Committed now, so the renderer draws it before it is torn down.
			flushSync(() => {
				store.bump();
			});

			await app.unmount();
			return false;
		},
	};
}
