/** Dependency-copy, install, and development-server pipeline fragments. */
import type {Settings} from '../settings.js';
import {
	commentText,
	inlineCommand,
	multilineCommand,
	shellQuote,
} from './toml.js';

const portTemplate = "{{ (remote_repo ~ '/' ~ branch) | hash_port }}";

export function generatePostStart(
	settings: Settings,
	proxyBody: string | undefined,
): string {
	const blocks: string[] = [];
	if (settings.copyIgnored) {
		blocks.push(
			`[[post-start]]\ncopy = ${inlineCommand('wt step copy-ignored')}`,
		);
	}

	blocks.push(
		`[[post-start]]\ninstall = ${inlineCommand(installCommand(settings))}`,
	);

	if (settings.server) {
		const commands = [`server = ${inlineCommand(serverCommand(settings))}`];
		if (proxyBody) {
			commands.push(`proxy = ${multilineCommand(proxyBody)}`);
		}

		blocks.push(
			`${serverNotes(settings)}\n[[post-start]]\n${commands.join('\n')}`,
		);
	}

	return blocks.join('\n\n');
}

export function installCommand(settings: Settings): string {
	const directory = settings.appDir ? shellQuote(settings.appDir) : undefined;
	switch (settings.pm) {
		case 'npm': {
			return directory
				? `npm --prefix ${directory} install --prefer-offline --no-audit --no-fund`
				: 'npm install --prefer-offline --no-audit --no-fund';
		}

		case 'pnpm': {
			return directory
				? `pnpm --dir ${directory} install --prefer-offline`
				: 'pnpm install --prefer-offline';
		}

		case 'bun': {
			return directory ? `bun install --cwd=${directory}` : 'bun install';
		}
	}
}

export function serverCommand(settings: Settings): string {
	const script = shellQuote(settings.devScript);
	const directory = settings.appDir ? shellQuote(settings.appDir) : undefined;
	let command: string;
	switch (settings.pm) {
		case 'npm': {
			command = `npm${
				directory ? ` --prefix ${directory}` : ''
			} run ${script} -- --port ${portTemplate}`;
			break;
		}

		case 'pnpm': {
			command = `pnpm${
				directory ? ` --dir ${directory}` : ''
			} run ${script} --port ${portTemplate}`;
			break;
		}

		case 'bun': {
			// `--cwd` rather than `cd <dir> &&`: the whole command is one argument
			// list after `tether --`, and a `&&` there would end the tethered
			// command, leaving the server running loose in the wrong directory.
			command = `bun${
				directory ? ` --cwd=${directory}` : ''
			} run ${script} --port ${portTemplate}`;
			break;
		}
	}

	return `wt step tether -- ${command}`;
}

function serverNotes(settings: Settings): string {
	const lines = [
		'# Dev server; `wt step tether` stops it when the worktree is removed, however it is',
		'# removed. The port hashes repo + branch, so the same branch in two repos gets two ports.',
		'# Adjust the command if this project needs something else:',
		`#   port from the environment (Nest, Express):  PORT=<port> ${settings.pm} run start:dev`,
		`#   another script:                             ${settings.pm} run <script> --port <port>`,
	];
	if (settings.appDir) {
		// Each package manager spells "run in this directory" differently.
		const directoryFlag = {
			npm: `--prefix ${commentText(settings.appDir)}`,
			pnpm: `--dir ${commentText(settings.appDir)}`,
			bun: `--cwd=${commentText(settings.appDir)}`,
		}[settings.pm];
		lines.push(
			`#   app in a subfolder:                         ${
				settings.pm
			} ${directoryFlag} run ${commentText(settings.devScript)} --port <port>`,
		);
	}

	if (settings.pm === 'pnpm') {
		lines.push(
			'# (pnpm passes a literal "--" through, so do not write `pnpm run dev -- --port`.)',
		);
	}

	if (settings.scripts.length > 0) {
		lines.push(
			`# Detected package scripts: ${settings.scripts
				.map(script => commentText(script))
				.join(', ')}`,
		);
	}

	return lines.join('\n');
}
