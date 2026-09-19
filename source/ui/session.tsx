/**
 * The interactive setup session: one Ink app that stays mounted for the whole
 * of `clone` or `init`, so the questions, the review, the run and the result are
 * a single continuous screen. The setup code talks to it through the plain
 * `Session` interface; this file turns each call into a screen and each answer
 * into a resolved promise.
 */
import {performance} from 'node:perf_hooks';
import process from 'node:process';
import React, {
	useEffect,
	useReducer,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
import {render, useStdout} from 'ink';
import type {
	ConfigureRequest,
	FailureRequest,
	FinishRequest,
	OverwriteRequest,
	ResultLine,
	Session,
	StepDefinition,
	StepStatus,
} from '../core/session.js';
import type {Settings} from '../core/settings.js';
import {abortKey} from './keys.js';
import {createKit, type Line} from './kit/lines.js';
import {Lines} from './kit/render.js';
import {resolveTheme, type Theme} from './kit/theme.js';
import {useKeys} from './use-keys.js';
import {
	failureKey,
	failureLines,
	type FailureState,
} from './screens/callouts.js';
import {
	buildOverwriteModel,
	initialOverwrite,
	overwriteKey,
	overwriteLines,
	scrollLimit,
	type OverwriteModel,
	type OverwriteState,
} from './screens/overwrite.js';
import {reviewKey, reviewLines, type ReviewState} from './screens/review.js';
import {
	askPublish,
	endPublish,
	initialRun,
	runKey,
	runningLines,
	startPublish,
	updatePublish,
	updateStep,
	type RunState,
} from './screens/running.js';
import {
	focusableFields,
	initialSetup,
	setupKey,
	setupLines,
	type SetupState,
} from './screens/setup.js';

type ConfigureScreen = Readonly<{
	kind: 'configure';
	request: ConfigureRequest;
	stage: 'setup' | 'review';
	setup: SetupState;
	review: ReviewState;
	settings?: Settings;
}>;

type Screen =
	| Readonly<{kind: 'idle'}>
	| ConfigureScreen
	| Readonly<{kind: 'run'; run: RunState}>
	| Readonly<{
			kind: 'overwrite';
			request: OverwriteRequest;
			model: OverwriteModel;
			state: OverwriteState;
	  }>
	| Readonly<{kind: 'failure'; request: FailureRequest; state: FailureState}>;

/** The most that is ever laid out; wider terminals leave the rest blank. */
const maximumColumns = 104;

/** A tiny observable, so the imperative Session API can drive React state. */
function createStore() {
	let screen: Screen = {kind: 'idle'};
	const listeners = new Set<() => void>();
	return {
		get: () => screen,
		set(next: Screen) {
			screen = next;
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
	theme: Theme;
	onKey: (name: string) => void;
}>;

function SessionApp({store, theme, onKey}: AppProperties): React.ReactElement {
	const screen = useSyncExternalStore(store.subscribe, store.get);
	const {stdout} = useStdout();
	// Bumping a counter is the cheapest way to ask React for another frame.
	const [, redraw] = useReducer((count: number) => count + 1, 0);
	const [caret, setCaret] = useState(true);
	const columns = Math.min(stdout.columns || 80, maximumColumns);
	const rows = stdout.rows || 40;

	const spinning =
		screen.kind === 'run' &&
		(screen.run.steps.some(step => step.status === 'active') ||
			screen.run.publish?.rows.some(row => row.status === 'active') === true);
	const typing = screen.kind === 'configure' && screen.stage === 'setup';
	useEffect(() => {
		if (!spinning) {
			return undefined;
		}

		const timer = setInterval(() => {
			redraw();
		}, 80);
		return () => {
			clearInterval(timer);
		};
	}, [spinning]);
	useEffect(() => {
		if (!typing) {
			return undefined;
		}

		const timer = setInterval(() => {
			setCaret(value => !value);
		}, 530);
		return () => {
			clearInterval(timer);
		};
	}, [typing]);
	useEffect(() => {
		const onResize = () => {
			redraw();
		};

		stdout.on('resize', onResize);
		return () => {
			stdout.off('resize', onResize);
		};
	}, [stdout]);

	const kit = createKit(theme.glyphs, columns);
	let lines: readonly Line[] = [];
	switch (screen.kind) {
		case 'configure': {
			lines =
				screen.stage === 'setup' || screen.settings === undefined
					? setupLines(kit, screen.request, screen.setup, {caret, rows})
					: reviewLines(
							kit,
							screen.request,
							screen.settings,
							screen.review,
							rows,
					  );
			break;
		}

		case 'run': {
			lines = runningLines(kit, screen.run, performance.now(), rows);
			break;
		}

		case 'overwrite': {
			lines = overwriteLines(
				kit,
				screen.request,
				screen.model,
				screen.state,
				rows,
			);
			break;
		}

		case 'failure': {
			lines = failureLines(kit, screen.request, screen.state, rows);
			break;
		}

		default: {
			break;
		}
	}

	// Clicks are resolved against exactly what this render drew.
	const drawn = useRef<readonly Line[]>(lines);
	drawn.current = lines;
	useKeys(onKey, () => drawn.current);

	return <Lines lines={lines} theme={theme} width={columns} caret={caret} />;
}

/** Mounts the app and returns the imperative Session the setup code drives. */
export async function openSession(): Promise<Session> {
	const theme = resolveTheme();
	const store = createStore();
	let aborted = false;
	let run: RunState | undefined;
	/** Handles keys for whatever question is showing; a no-op between questions. */
	let onKey: (name: string) => void = () => undefined;
	/** Resolves the question on screen with undefined, when the user cancels. */
	let cancelPending: (() => void) | undefined;
	/** Set while a push or pull request runs; aborting it stops the command. */
	let publishing: AbortController | undefined;

	const showRun = () => {
		if (run !== undefined) {
			store.set({kind: 'run', run});
		}
	};

	const dispatch = (name: string) => {
		if (name !== abortKey) {
			onKey(name);
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
				app.unmount();
				// eslint-disable-next-line unicorn/no-process-exit
				process.exit(130);
			}

			publishing.abort();
			if (run?.publish !== undefined) {
				run = {...run, publish: {...run.publish, stopping: true}};
				showRun();
			}

			return;
		}

		// Nothing is being asked, so work is running: stop after the step, and
		// quit at once on a second press.
		if (aborted) {
			app.unmount();
			// A second Ctrl+C means "now": nothing is left to unwind gracefully.
			// eslint-disable-next-line unicorn/no-process-exit
			process.exit(130);
		}

		aborted = true;
		if (run !== undefined) {
			run = {...run, cancelling: true};
			showRun();
		}
	};

	const app = render(
		<SessionApp store={store} theme={theme} onKey={dispatch} />,
		{
			exitOnCtrlC: false,
		},
	);

	/** Shows a screen and waits for `onKey` to produce an answer. */
	const ask = async <T,>(
		show: () => Screen,
		handle: (name: string, answer: (value: T | undefined) => void) => void,
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

			onKey = name => {
				handle(name, answer);
			};

			store.set(show());
		});
	};

	return {
		async configure(request) {
			const everythingFixed =
				focusableFields(request, request.values).length === 0;
			let screen: ConfigureScreen = {
				kind: 'configure',
				request,
				stage: everythingFixed ? 'review' : 'setup',
				setup: initialSetup(request),
				review: {sel: 0},
				settings: everythingFixed
					? request.toSettings(request.values)
					: undefined,
			};
			return ask<Settings>(
				() => screen,
				(name, answer) => {
					const update = (next: Partial<ConfigureScreen>) => {
						screen = {...screen, ...next};
						store.set(screen);
					};

					if (screen.stage === 'setup') {
						const step = setupKey(request, screen.setup, name);
						if (step.done) {
							try {
								update({
									setup: step.state,
									stage: 'review',
									settings: request.toSettings(step.state.values),
									review: {sel: 0},
								});
							} catch {
								// The values are not valid yet; the form already says why.
								update({setup: step.state});
							}
						} else if (step.handled) {
							update({setup: step.state});
						}

						return;
					}

					const step = reviewKey(screen.review, name);
					if (step.action === 'create' && screen.settings !== undefined) {
						answer(screen.settings);
					} else if (step.action === 'cancel') {
						answer(undefined);
					} else if (step.action === 'back') {
						update({stage: 'setup'});
					} else {
						update({review: step.state});
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

		async overwrite(request: OverwriteRequest) {
			const model = buildOverwriteModel(request.existing, request.generated);
			let state = initialOverwrite;
			const answer = await ask<'keep' | 'replace'>(
				() => ({kind: 'overwrite', request, model, state}),
				(name, resolve) => {
					const step = overwriteKey(
						state,
						name,
						scrollLimit(model, state, process.stdout.rows || 40),
					);
					state = step.state;
					if (step.answer === undefined) {
						store.set({kind: 'overwrite', request, model, state});
					} else {
						resolve(step.answer);
					}
				},
			);
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

			return ask<'push' | 'skip'>(
				() => ({kind: 'run', run: state}),
				(name, resolve) => {
					const step = runKey(state, name);
					state = step.state;
					run = state;
					showRun();
					if (step.answer === 'push' || step.answer === 'skip') {
						resolve(step.answer);
					}
				},
			);
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
			return ask<'retry' | 'later'>(
				() => ({kind: 'run', run: run!}),
				(name, resolve) => {
					const step = runKey(run!, name);
					run = step.state;
					showRun();
					if (step.answer === 'retry' || step.answer === 'later') {
						resolve(step.answer);
					}
				},
			);
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
			const answer = await ask<'keep' | 'rollback'>(
				() => ({kind: 'failure', request, state}),
				(name, resolve) => {
					const step = failureKey(request, state, name);
					state = step.state;
					if (step.answer === undefined) {
						store.set({kind: 'failure', request, state});
					} else {
						resolve(step.answer);
					}
				},
			);
			// Back to the steps, which now show the cross where it stopped.
			showRun();
			return answer;
		},

		aborted: () => aborted,

		async close() {
			onKey = () => undefined;
			// Redraw once without the key bar: this frame stays in the scrollback.
			if (run !== undefined) {
				run = {...run, closed: true, cancelling: false};
				showRun();
			}

			// The exit promise must exist before unmounting, or it never settles.
			const exited = app.waitUntilExit();
			app.unmount();
			await exited;
		},
	};
}
