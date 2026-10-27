import stringWidth from 'string-width';

const segmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});

export const width = (text: string): number => stringWidth(text);

export function graphemes(text: string): string[] {
	return Array.from(segmenter.segment(text), part => part.segment);
}

/** Prefix that fits without splitting a grapheme or a wide cell. */
export function cellSlice(text: string, limit: number): string {
	let used = 0;
	let result = '';
	for (const part of graphemes(text)) {
		const size = width(part);
		if (used + size > limit) break;
		result += part;
		used += size;
	}

	return result;
}

/** Suffix that fits without splitting a grapheme or a wide cell. */
export function cellSuffix(text: string, limit: number): string {
	let result = '';
	for (const part of graphemes(text).reverse()) {
		if (width(part + result) > limit) break;
		result = part + result;
	}

	return result;
}
