import React from 'react';
import {describe, expect, test} from 'bun:test';
import {createTestRenderer} from '@opentui/core/testing';
import {createRoot, flushSync} from '@opentui/react';
import type {ConfigureRequest} from '../source/core/session.js';
import {unicodeGlyphs} from '../source/ui/kit/glyphs.js';
import {createKit} from '../source/ui/kit/lines.js';
import {
	documentationKey,
	initialDocumentation,
} from '../source/ui/screens/docs.js';
import {initialWizard, wizardKey} from '../source/ui/shell/wizard.js';
import {useKeys} from '../source/ui/use-keys.js';

describe('terminal input events', () => {
	test('Kitty shortcuts and bracketed paste reach the screen', async () => {
		const setup = await createTestRenderer({
			width: 80,
			height: 24,
			kittyKeyboard: true,
		});
		const keys: string[] = [];
		// eslint-disable-next-line @typescript-eslint/naming-convention -- React components start with a capital.
		function Screen() {
			useKeys(
				key => keys.push(key),
				() => [],
			);
			return null;
		}

		const root = createRoot(setup.renderer);
		try {
			flushSync(() => {
				root.render(React.createElement(Screen));
			});
			await setup.renderOnce();
			setup.mockInput.pressKey('c', {ctrl: true});
			setup.mockInput.pressKey('p', {ctrl: true});
			await setup.mockInput.pasteBracketedText('a b界');
			expect(keys).toEqual(['ctrl-c', 'ctrl-p', 'a', 'space', 'b', '界']);
		} finally {
			root.unmount();
			setup.renderer.destroy();
		}
	});

	test('bracketed paste edits the wizard prefix and documentation search', async () => {
		const values = {
			prefix: '',
			tmux: false,
			agents: [],
			copyIgnored: false,
			mcAlias: false,
		};
		const request: ConfigureRequest = {
			command: 'init',
			project: 'test',
			rootName: 'test',
			destination: '/test',
			direct: false,
			values,
			fromFlags: {},
			installedAgents: [],
			missingAgents: [],
			tmuxInstalled: false,
			toSettings: answers => ({
				trunkVersion: '1',
				generatedOn: '2026-01-01',
				...answers,
			}),
		};
		let wizard = initialWizard(request);
		let documentation = {...initialDocumentation, search: {query: '', sel: 0}};
		let mode = 'wizard';
		const view = {kit: createKit(unicodeGlyphs, 80), width: 80, height: 20};
		const setup = await createTestRenderer({width: 80, height: 24});
		// eslint-disable-next-line @typescript-eslint/naming-convention -- React component.
		function Screen() {
			useKeys(
				key => {
					if (mode === 'wizard') wizard = wizardKey(request, wizard, key).state;
					else
						documentation = documentationKey(documentation, key, view)
							.state as typeof documentation;
				},
				() => [],
			);
			return null;
		}

		const root = createRoot(setup.renderer);
		try {
			flushSync(() => {
				root.render(React.createElement(Screen));
			});
			await setup.renderOnce();
			await setup.mockInput.pasteBracketedText('my-project');
			expect(wizard.values.prefix).toBe('my-project');
			mode = 'docs';
			await setup.mockInput.pasteBracketedText('work tree');
			expect(documentation.search?.query).toBe('work tree');
		} finally {
			root.unmount();
			setup.renderer.destroy();
		}
	});
});
