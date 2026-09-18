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
	checkRequiredTools,
	probe,
	wtVersionWarning,
	type ToolProbe,
} from './core/env.js';
import {reportOutcome, step} from './core/log.js';
import {guardPlatform} from './core/platform.js';
import {badUsage, succeed, type Outcome} from './core/result.js';
import {runClone} from './commands/clone.js';
import {runInit} from './commands/init.js';
import {runNew} from './commands/new.js';

const cli = parseArguments();

async function dispatch(): Promise<Outcome> {
	const unsupportedPlatform = guardPlatform();
	if (unsupportedPlatform) {
		return unsupportedPlatform;
	}

	const [command, ...rest] = cli.input;

	// Only the real commands need tools, so printing usage stays instant and
	// works on a machine that has neither git nor wt installed.
	let tools: ToolProbe | undefined;
	if (command === 'clone' || command === 'init' || command === 'new') {
		tools = await probe();
		const missingTools = checkRequiredTools(tools);
		if (missingTools) {
			return missingTools;
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
			});
		}

		case 'init': {
			return runInit(rest, cli.flags, tools!);
		}

		case 'new': {
			return runNew(rest, cli.flags, tools!);
		}

		case undefined: {
			// Printed here rather than through `cli.showHelp`, which exits inside
			// meow; `process.exit` stays a single call site at the bottom of this file.
			process.stdout.write(`${cli.help}\n`);
			return succeed();
		}

		default: {
			return badUsage(`unknown command: ${command}`);
		}
	}
}

const outcome = await dispatch();
reportOutcome(outcome);
process.exit(outcome.code);
