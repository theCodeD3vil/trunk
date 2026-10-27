/**
 * The clock behind every micro-interaction. An effect is only a start time
 * under a name; a view asks how far along it is at the moment it draws, so a
 * frame is a pure function of state and `now` and can be checked at any instant.
 */
import process from 'node:process';

/** Effect name to the time, in milliseconds, it started. */
export type Fx = Readonly<Record<string, number>>;

/** How long each effect lasts. Only choosing and moving about are animated. */
export const duration = Object.freeze({
	/** A choice settling, and a glyph popping. */
	select: 150,
	pop: 320,
	shake: 340,
	/** The pointer arriving on, or leaving, a thing. */
	hover: 150,
	/** How long a toast stays, and how long a copy button says so. */
	toastHold: 2400,
	copied: 1500,
});

/** `cubic-bezier(x1, y1, x2, y2)` as CSS defines it, solved by Newton's method. */
function bezier(x1: number, y1: number, x2: number, y2: number) {
	const axis = (a: number, b: number, s: number): number =>
		3 * a * (1 - s) ** 2 * s + 3 * b * (1 - s) * s ** 2 + s ** 3;
	const slope = (a: number, b: number, s: number): number =>
		3 * a * (1 - s) ** 2 + 6 * (b - a) * (1 - s) * s + 3 * (1 - b) * s ** 2;
	return (x: number): number => {
		if (x <= 0 || x >= 1) {
			return Math.max(0, Math.min(1, x));
		}

		let s = x;
		for (let step = 0; step < 8; step++) {
			const error = axis(x1, x2, s) - x;
			const derivative = slope(x1, x2, s);
			if (Math.abs(error) < 1e-5 || derivative === 0) {
				break;
			}

			s -= error / derivative;
		}

		return axis(y1, y2, Math.max(0, Math.min(1, s)));
	};
}

export const ease = Object.freeze({
	/** The default entrance: fast, then settling. */
	out: bezier(0.2, 0.8, 0.2, 1),
});

/** How far along a moment that started at `start` is, from 0 to 1; undefined before it starts or once it is over. */
export function along(
	start: number | undefined,
	now: number,
	length: number,
	delay = 0,
): number | undefined {
	if (start === undefined) {
		return undefined;
	}

	const t = (now - start - delay) / length;
	return t >= 1 ? undefined : Math.max(0, t);
}

/** `along`, for an effect kept by name. */
export function running(
	fx: Fx,
	name: string,
	now: number,
	length: number,
	delay = 0,
): number | undefined {
	return along(fx[name], now, length, delay);
}

/** The sideways step of a shake `t` of the way through it, in cells: left, right, left, right, still. */
export function shakeX(t: number | undefined): number {
	if (t === undefined) {
		return 0;
	}

	return [0, -1, 1, -1, 0][Math.min(4, Math.floor(t * 5))]!;
}

const channel = (hex: string, at: number): number =>
	Number.parseInt(hex.slice(at, at + 2), 16);

/** A colour between two `#rrggbb` colours, `t` of the way from `from` to `to`. */
export function mix(from: string, to: string, t: number): string {
	const amount = Math.max(0, Math.min(1, t));
	const part = (at: number): string =>
		Math.round(
			channel(from, at) + (channel(to, at) - channel(from, at)) * amount,
		)
			.toString(16)
			.padStart(2, '0');
	return `#${part(1)}${part(3)}${part(5)}`;
}

/** Whether effects are drawn at all: `TRUNK_MOTION=0` turns them off. */
export function motionEnabled(
	environment: NodeJS.ProcessEnv = process.env,
): boolean {
	return environment['TRUNK_MOTION'] !== '0';
}
