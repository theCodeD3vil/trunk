/** The bundled documentation, in the order the menu lists it. */
import {configBasics} from './config-basics.js';
import {node} from './node.js';
import type {Section, Topic} from './types.js';

export const topics: readonly Topic[] = Object.freeze([configBasics, node]);

export function findTopic(id: string): Topic | undefined {
	return topics.find(topic => topic.id === id);
}

export function findSection(
	topicId: string,
	sectionId: string,
): Readonly<{topic: Topic; section: Section}> | undefined {
	const topic = findTopic(topicId);
	const section = topic?.sections.find(candidate => candidate.id === sectionId);
	return topic && section ? {topic, section} : undefined;
}

export type {Block, CodeBlock, Section, Topic} from './types.js';
