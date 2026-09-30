import { type ParseWarning } from './ParseWarning.js';
/** A member file (or folder) of the project. */
export interface ProjectFile {
    /** POSIX path relative to the project ROOT, not to the parent entity. */
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
    /**
     * Whether MATLAB owns this label. The seven Classification labels ship with
     * every project and are marked read-only in the store; a label the project
     * itself added is not, which is the only thing distinguishing the two.
     */
    readOnly: boolean;
}
/** A project-to-project reference. */
export interface ProjectReference {
    id: string;
    name: string | null;
}
/**
 * A registered entry point: a shortcut, or a file MATLAB runs on open/close.
 *
 * One store collection covers all three, separated only by `kind`, which is why
 * they are one type here. `prev` is deliberately NOT exposed: the store encodes run
 * order as a linked list over these entries, and `entryPoints` is already in that
 * order (see `orderEntryPoints`), so a consumer never has to know the mechanism.
 */
export interface ProjectEntryPoint {
    /** The entry point's own UUID (its pointer `location`). */
    id: string;
    name: string;
    /** Project-root-relative path. May name a FOLDER — a shortcut can open one. */
    file: string;
    /** 'Basic' (a shortcut), 'StartUp', 'Shutdown', or whatever a newer release writes. */
    kind: string;
    /** Whether MATLAB shows this in its Shortcuts gallery. Startup/shutdown files are hidden. */
    visible: boolean;
    /** The EntryPointGroup id; '' when ungrouped (the store spells that 'default'). */
    groupId: string;
}
/** A named group in the Shortcuts gallery. */
export interface ProjectEntryPointGroup {
    id: string;
    name: string;
}
/**
 * A folder (or file) the project designates for a particular purpose — simulation
 * cache, code generation, startup folder, dependency cache.
 *
 * `key` is the store's own name for the purpose (`SimulinkCacheFolder`,
 * `SimulinkCodeGenFolder`, `ProjectStartupFolder`, `DependencyCacheFile`) and is
 * NOT translated here: a newer release may designate something this version has no
 * label for, and passing the raw key on lets a host show it rather than drop it.
 * Note the last of those four names a FILE, so these are not all folders.
 */
export interface ProjectWorkingFolder {
    key: string;
    /** Project-root-relative path. */
    ref: string;
}
export interface ParsedProject {
    name: string;
    /**
     * The store's declared `MetadataType` — how the project's metadata is laid out on
     * disk. '' when the store declares none and the layout could not be inferred.
     * Two are read: `fixedPathV2` and `distributed`. Anything else is reported through
     * `warnings` rather than read, because guessing at a layout produces a project
     * that looks complete and is not.
     */
    format: string;
    files: ProjectFile[];
    /**
     * Folders added to the MATLAB path, project-root-relative. The project ROOT
     * itself is spelled '' — the store records it as `Ref=""`, and it is a real entry
     * (usually the first one MATLAB adds), so dropping it would under-report the path.
     */
    pathFolders: string[];
    /** The catalog of labels defined in the project. */
    labels: ProjectLabel[];
    references: ProjectReference[];
    /**
     * Shortcuts and startup/shutdown files, in this order: startup files in RUN
     * order, then shutdown files in run order, then everything else (shortcuts) in
     * store order. Run order is the store's, which is meaningful — MATLAB runs the
     * files top-down — and is not recoverable from any other field.
     */
    entryPoints: ProjectEntryPoint[];
    entryPointGroups: ProjectEntryPointGroup[];
    workingFolders: ProjectWorkingFolder[];
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