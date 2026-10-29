/** One entry of a directory listing, as a host's filesystem reports it. */
export interface StoreEntry {
    name: string;
    /**
     * What the entry IS, with any symbolic link already followed: a link to a directory is a
     * `'directory'`. A host whose filesystem reports types as a bitmask (VS Code's `FileType`, where
     * a linked directory is `Directory | SymbolicLink`) tests the bits rather than comparing for
     * equality — an equality test matches neither, and the store document is skipped in silence,
     * leaving the project looking as though that part of it were never written.
     */
    type: 'file' | 'directory' | 'other';
}
/**
 * The two reads the walk needs, over `/`-separated paths.
 *
 * Either may throw (or reject) for a path that is absent or unreadable; the walk treats that as
 * "not there", which is what a missing store and a marker deleted between a glob and a read both
 * are.
 */
export interface StoreFs {
    /** The text of the file at `path`, decoded as UTF-8. */
    readText(path: string): Promise<string>;
    /** The entries of the directory at `path`. */
    list(path: string): Promise<readonly StoreEntry[]>;
}
/**
 * Read the project definition for a project marker. For a `<projectRoot>/<name>.prj` the store
 * is `<projectRoot>/resources/project/`; for a `<projectRoot>/matlab.toml` the definition is that
 * file.
 *
 * Missing/unreadable definitions yield an empty map (never throws for that case) — and
 * `parseProject` turns an empty map into an empty project that says so in its warnings, which is
 * what puts an unreachable store on the page instead of behind a throw.
 *
 * The map is in the order `fs.list` reports, as the walk meets the files: a directory lists in
 * the filesystem's order, not the project's, so a host that needs the order to be stable across
 * filesystems sorts it (the ./node entry does).
 */
export declare function readProjectStore(markerPath: string, fs: StoreFs): Promise<Record<string, string>>;
//# sourceMappingURL=projectStore.d.ts.map