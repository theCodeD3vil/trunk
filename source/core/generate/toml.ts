/** TOML and shell escaping shared by every generated fragment. */
import type {Settings} from '../settings.js';

/**
 * What stands in for the repository name in a generated template. With an
 * origin this is Worktrunk's own variable; without one it is the name written
 * out, because `remote_repo` would render empty.
 */
export function repoExpression(settings: Settings): string {
	return settings.noRemote ? settings.hostLabel : '{{ remote_repo | lower }}';
}

/** The port hashes repo and branch together; the repo half follows the same rule. */
export function portExpression(settings: Settings): string {
	return settings.noRemote
		? `{{ ('${settings.hostLabel}/' ~ branch) | hash_port }}`
		: "{{ (remote_repo ~ '/' ~ branch) | hash_port }}";
}

const allowedTemplates = Object.freeze([
	'{{ branch | sanitize }}',
	'{{ worktree_path }}',
	'{{ remote_repo | lower }}',
	"{{ (remote_repo ~ '/' ~ branch) | hash_port }}",
	'{{ args }}',
	'{{ args[0] | sanitize }}',
	'{% if args %}',
	'{% else %}',
	'{% endif %}',
]);

export function tomlString(value: string): string {
	return JSON.stringify(value);
}

export function inlineCommand(body: string): string {
	assertShellTemplate(body);
	return tomlString(body);
}

export function multilineCommand(body: string): string {
	assertShellTemplate(body);
	if (body.includes("'''")) {
		throw new TypeError("Generated command contains the TOML delimiter '''.");
	}

	return `'''\n${body.trim()}\n'''`;
}

export function shellQuote(value: string): string {
	if (/^[\w@%+=:,./-]+$/i.test(value)) {
		return value;
	}

	return `'${value.split("'").join(`'"'"'`)}'`;
}

export function commentText(value: string): string {
	return value
		.split(/\0|\r?\n/)
		.join(' ')
		.trim();
}

export function assertShellTemplate(body: string): void {
	if (body.includes('${#') || body.includes('{#')) {
		throw new TypeError(
			'Generated shell collides with Worktrunk template syntax.',
		);
	}

	// The no-remote port form carries a literal project name, so it is matched
	// by shape rather than listed.
	let remainder = body.replaceAll(
		/{{ \('[^'{}]*\/' ~ branch\) \| hash_port }}/g,
		'',
	);
	for (const template of allowedTemplates) {
		remainder = remainder.split(template).join('');
	}

	if (remainder.includes('{{') || remainder.includes('{%')) {
		const line = remainder
			.split(/\r?\n/)
			.find(value => value.includes('{{') || value.includes('{%'));
		throw new TypeError(`Unexpected Worktrunk template expression: ${line}`);
	}
}
