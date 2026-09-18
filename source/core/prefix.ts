export type PrefixValidation =
	| Readonly<{valid: true}>
	| Readonly<{valid: false; reason: string}>;

export function initials(name: string): string {
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
