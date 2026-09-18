/** Small constructors that keep the content files readable as prose. */
import type {
	CodeBlock,
	CodeLanguage,
	ListBlock,
	Placement,
	TextBlock,
} from './types.js';

export function text(value: string): TextBlock {
	return Object.freeze({kind: 'text', text: value});
}

export function list(...items: readonly string[]): ListBlock {
	return Object.freeze({kind: 'list', items: Object.freeze([...items])});
}

/** TOML fragments must say where they go so the tests can place them. */
export function toml(
	label: string,
	code: string,
	placement: Placement,
): CodeBlock {
	return block(label, 'toml', code, placement);
}

export function shell(label: string, code: string): CodeBlock {
	return block(label, 'sh', code);
}

function block(
	label: string,
	language: CodeLanguage,
	code: string,
	placement?: Placement,
): CodeBlock {
	return Object.freeze({
		kind: 'code',
		label,
		language,
		code,
		...(placement ? {placement} : {}),
	});
}
