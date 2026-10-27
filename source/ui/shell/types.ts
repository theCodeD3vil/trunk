/**
 * What the shell is told about, in one place: the screen on show, the small
 * amount of interface state that is not an answer (what the pointer is over,
 * which effects are running, the toast), and the frame that is drawn from them.
 */
import type {
	ConfigureRequest,
	FailureRequest,
	OverwriteRequest,
} from '../../core/session.js';
import type {Palette, Theme} from '../kit/theme.js';
import type {Glyphs} from '../kit/glyphs.js';
import type {FailureState} from '../screens/callouts.js';
import type {OverwriteModel, OverwriteState} from '../screens/overwrite.js';
import type {RunState} from '../screens/running.js';
import type {Fx} from './motion.js';
import type {Row} from './preview.js';
import type {Wizard} from './wizard.js';

export type Screen =
	| Readonly<{kind: 'idle'}>
	| Readonly<{kind: 'wizard'}>
	| Readonly<{kind: 'run'; run: RunState}>
	| Readonly<{
			kind: 'overwrite';
			request: OverwriteRequest;
			model: OverwriteModel;
			state: OverwriteState;
			run?: RunState;
	  }>
	| Readonly<{
			kind: 'failure';
			request: FailureRequest;
			state: FailureState;
			run?: RunState;
	  }>;

export type Toast = Readonly<{text: string; tone: 'info' | 'warn'; at: number}>;

export type Ui = Readonly<{
	/** The key of whatever the pointer is over, and what it was over before. */
	hover?: string;
	hoverPrev?: string;
	hoverAt: number;
	fx: Fx;
	toast?: Toast;
	/** Something that was copied, so its button can say so for a moment. */
	copied?: Readonly<{target: string; at: number}>;
	/** The preview's rows and the first one in view. */
	rows: readonly Row[];
	top: number;
	/** The preview fills the stage, and the first row of it in view. */
	zoom: boolean;
	zoomTop: number;
	/** Whether effects run at all; without them every frame is the settled one. */
	motion: boolean;
}>;

export type Frame = Readonly<{
	/** The terminal's width, and the height of the frame: the terminal's less one row. */
	cols: number;
	rows: number;
	now: number;
	theme: Theme;
	version: string;
	request?: ConfigureRequest;
	wizard?: Wizard;
	screen: Screen;
	ui: Ui;
	/** The session has ended: this frame stays in the scrollback, without its key bar. */
	closed?: boolean;
}>;

/** Everything a component needs to draw itself, worked out once per frame. */
export type Context = Readonly<{
	theme: Theme;
	p: Palette;
	g: Glyphs;
	now: number;
	ui: Ui;
	frame: Frame;
	/** 0 to 1: how far the pointer's arrival on, or departure from, a key has got. */
	hover: (key: string) => number;
}>;
