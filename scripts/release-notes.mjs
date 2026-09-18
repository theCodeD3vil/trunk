import {readFile} from 'node:fs/promises';
import process from 'node:process';

const [tag] = process.argv.slice(2);
const packageJson = JSON.parse(
	await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const {version} = packageJson;

if (tag !== `v${version}`) {
	throw new Error(`Release tag ${tag ?? '<missing>'} must match v${version}.`);
}

const changelog = await readFile(
	new URL('../changelog.md', import.meta.url),
	'utf8',
);
const heading = `## ${version} -`;
const start = changelog.indexOf(heading);
if (start === -1) {
	throw new Error(`changelog.md has no entry for ${version}.`);
}

const next = changelog.indexOf('\n## ', start + heading.length);
const entry = changelog.slice(start, next === -1 ? undefined : next).trim();
process.stdout.write(`${entry}\n`);
