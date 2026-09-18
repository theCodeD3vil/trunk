import * as TOML from '@iarna/toml';

export type GeneratedCommand = Readonly<{
	label: string;
	body: string;
}>;

export function generatedCommands(source: string): GeneratedCommand[] {
	const document = TOML.parse(source) as Record<string, unknown>;
	const commands: GeneratedCommand[] = [];

	for (const hookType of ['pre-start', 'pre-remove', 'post-remove']) {
		const hook = document[hookType];
		for (const [name, body] of tableEntries(hook)) {
			commands.push({label: `${hookType}:${name}`, body});
		}
	}

	for (const [name, body] of tableEntries(document['aliases'])) {
		commands.push({label: `alias:${name}`, body});
	}

	return commands;
}

export function parseGenerated(source: string): Record<string, unknown> {
	return TOML.parse(source) as Record<string, unknown>;
}

function tableEntries(value: unknown): Array<[string, string]> {
	const tables = Array.isArray(value) ? value : [value];
	const entries: Array<[string, string]> = [];
	for (const table of tables) {
		if (typeof table !== 'object' || table === null) {
			continue;
		}

		const record = table as Record<string, unknown>;
		for (const [name, body] of Object.entries(record)) {
			if (typeof body === 'string') {
				entries.push([name, body]);
			}
		}
	}

	return entries;
}
