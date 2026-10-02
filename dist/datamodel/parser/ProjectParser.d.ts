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
    /**
     * The files or patterns this label was declared AGAINST, as written.
     *
     * Empty on every XML layout, and that is a fact about those layouts rather than a
     * gap: a store assigns labels the other way round, per member file
     * (`ProjectFile.labels`), so the catalog entry has nothing to point back at. The
     * `matlab.toml` format inverts it — the label declares its files, and the format
     * records no member list for them to have been declared on — which is why this
     * field exists at all and why it is the only place those paths can live.
     */
    declaredFiles: string[];
}
/** A project-to-project reference. */
export interface ProjectReference {
    id: string;
    name: string | null;
    /**
     * Where the referenced project lives, as the store spells it — relative to THIS
     * project's root, so typically `../OtherProject/other.prj`. Null when the store
     * recorded no path, which leaves `id` (a UUID) as all that is known about it.
     *
     * Kept alongside `name` rather than folded into it: `name` is the basename, which
     * is what a user reads, and this is what a host needs to actually open the thing.
     * Deriving one from the other only works in that direction.
     */
    path: string | null;
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
     * Three are read: `fixedPathV2`, `distributed` and `monolithic`. Anything else is
     * reported through `warnings` rather than read, because guessing at a layout
     * produces a project that looks complete and is not.
     *
     * Plus `toml`, which is the one value here that is NOT a declared `MetadataType`:
     * a `matlab.toml` project has no store and nothing in it to declare, so the value
     * is this package's own name for the format (see TomlProject.ts). It is in the same
     * field because what a consumer does with it is the same — a page titles the view
     * with it, a host decides what it can write back — and a second field would make
     * every one of them ask twice.
     */
    format: string;
    /**
     * Whether this FORMAT records a member list — not whether any members were found.
     *
     * The distinction is the whole point of the field. `files: []` from an XML store is a
     * claim about the project: the store enumerates its members and enumerated none, so
     * "0 files" is true. `files: []` from a `matlab.toml` is a claim about the format:
     * it records no member list at all (MATLAB's rule is that the project root's files
     * ARE the members, which is about the filesystem and not about the document), so "0
     * files" would be a sentence the reader is not entitled to say. A host showing a
     * count or an empty-state message needs to tell those two apart, and nothing else in
     * this result does.
     *
     * True on every XML path, `emptyResult` included: a damaged store enumerated nothing,
     * which is a different thing from a format that enumerates nothing, and the
     * `memberCount: 0` a host already shows for a damaged store is correct and must not
     * change.
     */
    membersEnumerated: boolean;
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
 * Parse a MATLAB/Simulink Project definition.
 *
 * `files` maps POSIX relpaths (relative to the project root) to file text. Of an XML
 * store only entries under `resources/project/` are read; a `matlab.toml` is read
 * wherever in the map it is, and is the whole definition when present. Never throws: on
 * any failure it returns a minimally-populated result with the fallback name — and says
 * so in `result.warnings`, which is the only thing separating that result from a project
 * which genuinely holds nothing.
 *
 * `projectName` is the name for a definition that records none, and should come from
 * `projectFallbackName` rather than from a reduction of the caller's own: for a
 * `matlab.toml` the answer is the parent FOLDER, and stripping an extension there names
 * every such project "matlab".
 */
export declare function parseProject(files: Record<string, string>, projectName: string): ParsedProject;
//# sourceMappingURL=ProjectParser.d.ts.map