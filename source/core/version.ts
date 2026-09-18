/**
 * Trunk's own version. The build generates the imported constant from
 * package.json, so the packed CLI does not need package metadata at runtime.
 */
import {version} from '../version.js';

/** The package version stamped into the source immediately before compilation. */
export function trunkVersion(): string {
	return version;
}
