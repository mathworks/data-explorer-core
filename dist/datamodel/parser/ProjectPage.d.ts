import type { ParsedProject } from './ProjectParser.js';
import type { ParseWarning } from './ParseWarning.js';
/** One file MATLAB runs for a hook. Position in the list IS the run order. */
export interface ProjectPageRun {
    name: string;
    /** Project-root-relative path. */
    file: string;
}
/** One entry in the Shortcuts gallery. */
export interface ProjectPageShortcut {
    name: string;
    /** Project-root-relative path. May name a FOLDER. */
    file: string;
    /** The group's display name, '' when ungrouped. */
    group: string;
}
/** One label, with how much of the project carries it. */
export interface ProjectPageLabel {
    id: string;
    name: string;
    /** Members carrying this label. 0 is meaningful — a defined but unused label. */
    count: number;
    /** Defined by this project rather than shipped by MATLAB. */
    custom: boolean;
}
export interface ProjectPageCategory {
    name: string;
    labels: ProjectPageLabel[];
}
/** A folder — or file — the project designates for a purpose. */
export interface ProjectPageLocation {
    /** The store's own key, e.g. 'SimulinkCacheFolder'. */
    key: string;
    /** English for `key`, falling back to `key` itself when unrecognized. */
    label: string;
    /** Project-root-relative path. */
    ref: string;
}
export interface ProjectPageReference {
    name: string;
    /** The reference id; a path when the store recorded one. */
    path: string;
}
export interface ProjectPage {
    name: string;
    /** The raw `MetadataType`, for a host that wants to report it exactly. */
    format: string;
    /** English for `format` — what a MATLAB user sees in Project Settings. */
    formatLabel: string;
    /** Every member, folders included: what the project "contains". */
    memberCount: number;
    /** Members carrying at least one label — the numerator of label coverage. */
    labelledCount: number;
    /** In run order. */
    startup: ProjectPageRun[];
    /** In run order. */
    shutdown: ProjectPageRun[];
    shortcuts: ProjectPageShortcut[];
    /** Project-root-relative; '' is the project root itself. */
    pathFolders: string[];
    locations: ProjectPageLocation[];
    categories: ProjectPageCategory[];
    references: ProjectPageReference[];
    warnings: ParseWarning[];
}
/**
 * Project a parsed project into its page.
 *
 * Pure and total: every field is derived from `parsed`, and a project that holds
 * nothing yields a page of empty sections rather than a missing one — the sections
 * are what tell a user "this project defines no shortcuts", which is a fact worth
 * showing and not the same as a page that failed to render.
 */
export declare function buildProjectPage(parsed: ParsedProject): ProjectPage;
//# sourceMappingURL=ProjectPage.d.ts.map