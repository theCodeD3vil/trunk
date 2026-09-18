/**
 * The tmux session prefix. Sessions are named `<prefix>_<branch>`, so the prefix
 * is what keeps one repository's sessions apart from another's, and it has to
 * survive tmux's own naming rules.
 */

export type PrefixValidation =
	| Readonly<{valid: true}>
	| Readonly<{valid: false; reason: string}>;

/**
 * Suggests a prefix from a repository name: the first word in full, then the
 * initial of each word after it (`acme-web-backend` becomes `acme-wb`). Short
 * enough to read in a tmux status line, and stable for a given name.
 *
 * Two repositories can suggest the same prefix; the setup form shows the value
 * so the user can change it.
 */
export function initials(name: string): string {
	// Any run of punctuation separates words, which also absorbs doubled and
	// trailing hyphens.
	const parts = name
		.toLowerCase()
		.split(/[^a-z\d]+/)
		.filter(Boolean);

	if (parts.length < 2) {
		return parts[0] ?? '';
	}

	return `${parts[0]}-${parts
		.slice(1)
		.map(part => part[0])
		.join('')}`;
}

/**
 * Checks a prefix the user typed. Each rule explains itself, and nothing is
 * silently rewritten: a surprising prefix is worse than an error message.
 */
export function validatePrefix(prefix: string): PrefixValidation {
	if (prefix.length === 0) {
		return invalid('Prefix cannot be empty.');
	}

	if (prefix.length > 24) {
		return invalid('Prefix must be at most 24 characters.');
	}

	if (prefix.startsWith('-')) {
		return invalid('Prefix cannot start with a hyphen.');
	}

	if (prefix.includes('_')) {
		return invalid(
			'Prefix cannot contain underscores because "_" separates it from the branch.',
		);
	}

	if (prefix.includes('.') || prefix.includes(':')) {
		return invalid(
			'Prefix cannot contain "." or ":" because tmux rewrites them.',
		);
	}

	if (/[A-Z]/.test(prefix)) {
		return invalid('Prefix must use lowercase letters.');
	}

	if (!/^[a-z\d][a-z\d-]*$/.test(prefix)) {
		return invalid(
			'Prefix may contain only lowercase letters, digits, and hyphens.',
		);
	}

	return Object.freeze({valid: true});
}

function invalid(reason: string): PrefixValidation {
	return Object.freeze({valid: false, reason});
}
