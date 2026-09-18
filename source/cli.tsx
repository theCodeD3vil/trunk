#!/usr/bin/env node
import process from 'node:process';
import {parseArguments} from './core/arguments.js';
import {reportOutcome} from './core/log.js';
import {guardPlatform} from './core/platform.js';
import {badUsage, succeed, type Outcome} from './core/result.js';
import {runClone} from './commands/clone.js';
import {runInit} from './commands/init.js';
import {runNew} from './commands/new.js';

const cli = parseArguments();

function dispatch(): Outcome {
	const unsupportedPlatform = guardPlatform();
	if (unsupportedPlatform) {
		return unsupportedPlatform;
	}

	const [command, ...rest] = cli.input;

	switch (command) {
		case 'clone': {
			return runClone(rest, cli.flags);
		}

		case 'init': {
			return runInit(rest, cli.flags);
		}

		case 'new': {
			return runNew(rest, cli.flags);
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

const outcome = dispatch();
reportOutcome(outcome);
process.exit(outcome.code);
