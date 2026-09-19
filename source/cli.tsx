#!/usr/bin/env node
/**
 * Entry point. It parses the command line, checks the machine can run trunk,
 * hands the work to one command module, and turns the returned Outcome into an
 * exit code. All the real logic lives in `core/` and `commands/`; nothing here
 * knows how a project is set up.
 */
import process from 'node:process';
import {parseArguments} from './core/arguments.js';
import {
	missingTools,
	probe,
	wtVersionWarning,
	type ToolProbe,
} from './core/env.js';
import {importInteractive} from './core/interactive.js';
import {reportOutcome, step} from './core/log.js';
import {guardPlatform} from './core/platform.js';
import {
	badUsage,
	exitCodes,
	succeed,
	unsupportedEnvironment,
	type Outcome,
} from './core/result.js';
import type {TerminalUi, TerminalUiFactory} from './core/session.js';
import {trunkVersion} from './core/version.js';
import {runClone} from './commands/clone.js';
import {runDocumentation} from './commands/docs.js';
import {runInit} from './commands/init.js';

const cli = parseArguments();

/**
 * The terminal UI exists only where there is a terminal to draw on, and is
 * loaded on first use so that scripts and `--yes` runs never import Ink.
 */
let terminalUi: Promise<TerminalUi> | undefined;
const openTerminalUi: TerminalUiFactory | undefined = process.stdout.isTTY
	? async () => {
			terminalUi ??= (async () => {
				const module = await importInteractive(
					async () => import('./ui/terminal.js'),
				);
				return module.openTerminalUi();
			})();
			return terminalUi;
	  }
	: undefined;

async function dispatch(): Promise<Outcome> {
	const unsupportedPlatform = guardPlatform();
	if (unsupportedPlatform) {
		return unsupportedPlatform;
	}

	const [command, ...rest] = cli.input;
	if (command === undefined || cli.flags.help) {
		return showHelp();
	}

	// Only the real commands need tools, so printing usage stays instant and
	// works on a machine that has neither git nor wt installed.
	let tools: ToolProbe | undefined;
	if (command === 'clone' || command === 'init') {
		tools = await probe();
		const missing = missingTools(tools);
		if (missing.length > 0) {
			if (openTerminalUi) {
				const terminal = await openTerminalUi();
				await terminal.refuse({
					kind: 'missing-tools',
					missing,
					command: `trunk ${process.argv.slice(2).join(' ')}`,
				});
				return {code: exitCodes.unsupportedEnvironment};
			}

			return unsupportedEnvironment(
				`Missing required ${
					missing.length === 1 ? 'tool' : 'tools'
				}: ${missing.join(
					', ',
				)}. Install Git and Worktrunk before continuing: https://worktrunk.dev`,
			);
		}

		// An older wt still works; its templates may just render differently, so
		// this warns and carries on rather than refusing to run.
		const versionWarning = wtVersionWarning(tools.wt.version);
		if (versionWarning) {
			step('warning', versionWarning);
		}
	}

	switch (command) {
		case 'clone': {
			return runClone(rest, cli.flags, tools!, {
				invocation: {executable: 'trunk', arguments: process.argv.slice(2)},
				terminalUi: openTerminalUi,
			});
		}

		case 'init': {
			return runInit(rest, cli.flags, tools!, {
				invocation: {executable: 'trunk', arguments: process.argv.slice(2)},
				terminalUi: openTerminalUi,
			});
		}

		case 'docs': {
			return runDocumentation(rest);
		}

		default: {
			return badUsage(`unknown command: ${command}`);
		}
	}
}

/** The styled screen in a terminal, plain text everywhere else. */
async function showHelp(): Promise<Outcome> {
	if (openTerminalUi) {
		const terminal = await openTerminalUi();
		await terminal.welcome(trunkVersion());
	} else {
		// Printed here rather than through `cli.showHelp`, which exits inside
		// meow; `process.exit` stays a single call site at the bottom of this file.
		process.stdout.write(`${cli.help}\n`);
	}

	return succeed();
}

const outcome = await dispatch();
reportOutcome(outcome);
process.exit(outcome.code);
