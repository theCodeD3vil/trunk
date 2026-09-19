/**
 * The shape of the bundled documentation. Content is plain data compiled into
 * the package, so `trunk docs` never reads a file, a checkout or the network.
 */

export type CodeLanguage = 'toml' | 'sh';

/**
 * Where a TOML fragment goes in a project's `.config/wt.toml`. The browser
 * never uses this; the tests do, to drop each fragment into a real generated
 * config exactly as a reader would and ask Worktrunk to parse the result.
 *
 * - `standalone`: a complete file on its own.
 * - `append`: added after everything Trunk generated.
 * - `before-tmux`: a `[[pre-start]]` block placed above Trunk's tmux block, so
 *   it finishes before the session opens.
 * - `{table}`: keys added inside a table Trunk already generated, because a
 *   TOML table cannot be declared twice.
 */
export type Placement =
	| 'standalone'
	| 'append'
	| 'before-tmux'
	| Readonly<{table: string}>;

export type TextBlock = Readonly<{kind: 'text'; text: string}>;

export type ListBlock = Readonly<{kind: 'list'; items: readonly string[]}>;

export type CodeBlock = Readonly<{
	kind: 'code';
	/** Names the snippet in the copy picker and on the page. */
	label: string;
	language: CodeLanguage;
	code: string;
	/** Required for TOML, so every fragment can be checked against Worktrunk. */
	placement?: Placement;
}>;

export type Block = TextBlock | ListBlock | CodeBlock;

export type Section = Readonly<{
	id: string;
	/** Short enough for the browser's sidebar; longer names go in `keywords`. */
	title: string;
	/** Words search treats like the title's, for what the short title leaves out. */
	keywords?: readonly string[];
	blocks: readonly Block[];
}>;

export type Topic = Readonly<{
	id: string;
	title: string;
	summary: string;
	sections: readonly Section[];
}>;
