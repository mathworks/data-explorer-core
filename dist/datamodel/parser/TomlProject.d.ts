import type { ParsedProject } from './ProjectParser.js';
/**
 * Read a project whose entire definition is one `matlab.toml`.
 *
 * `text` is the file's content and `fallbackName` the project's name for a document
 * that records none — see `projectFallbackName`, which is where a caller gets one that
 * agrees with the rest of the package. Never throws: on a document that will not parse
 * it returns an empty project that says so in `warnings`, which is the only thing
 * separating that result from a project which genuinely holds nothing.
 */
export declare function parseTomlProject(text: string, fallbackName: string): ParsedProject;
//# sourceMappingURL=TomlProject.d.ts.map