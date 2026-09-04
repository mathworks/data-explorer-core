import { type ParseWarning } from './ParseWarning.js';
/** A member file (or folder) of the project. */
export interface ProjectFile {
    path: string;
    isFolder: boolean;
    /** Label UUIDs assigned to this file (e.g. 'design'). */
    labels: string[];
}
/** An entry in the project's label catalog (category + display name). */
export interface ProjectLabel {
    /** The label id (its pointer `location`), used to resolve file assignments. */
    id: string;
    category: string;
    name: string;
}
/** A project-to-project reference. */
export interface ProjectReference {
    id: string;
    name: string | null;
}
export interface ParsedProject {
    name: string;
    files: ProjectFile[];
    pathFolders: string[];
    /** The catalog of labels defined in the project. */
    labels: ProjectLabel[];
    references: ProjectReference[];
    /**
     * What could not be read, empty when everything could. ALWAYS an array: this
     * reader has the channel, so a caller may read `.length` without guarding, and
     * an empty one is a positive statement that the store was read whole.
     */
    warnings: ParseWarning[];
}
/**
 * Parse a MATLAB/Simulink Project content store.
 *
 * `files` maps POSIX relpaths (relative to the project root) to file text.
 * Only entries under `resources/project/` are read. Never throws: on any
 * failure it returns a minimally-populated result with the fallback name — and
 * says so in `result.warnings`, which is the only thing separating that result
 * from a project which genuinely holds nothing.
 */
export declare function parseProject(files: Record<string, string>, projectName: string): ParsedProject;
//# sourceMappingURL=ProjectParser.d.ts.map