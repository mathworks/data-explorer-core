/** How long a burst of events must be quiet before it is reported, unless told otherwise. */
export declare const WATCH_DEBOUNCE_MS = 300;
export interface WatchFolderOptions {
    /** Milliseconds of quiet that end a burst. Defaults to `WATCH_DEBOUNCE_MS`. */
    debounceMs?: number;
    /**
     * Which directories, by name, are not followed. Defaults to `skipDirectory`, the same rule
     * `listFolder` uses — pass the same function to both if you change it.
     */
    skipDirectory?: (name: string) => boolean;
}
export interface FolderWatch {
    /**
     * True while the folder is being followed. False when watching it could not start (a root
     * that is missing or not a directory, a platform without recursive `fs.watch` — Linux before
     * Node 20) or stopped on an error; `error` says why. A host that is not watching still has the
     * folder; it just has to read it again some other way to see a change.
     */
    readonly watching: boolean;
    /** Why `watching` is false, if it is for a reason other than `dispose`. */
    readonly error: Error | undefined;
    /** Stop: the pending burst is dropped, the watcher closed, and `onChange` never called again. */
    dispose(): void;
}
/**
 * Watch the folder at `root`, recursively, and call `onChange` once per burst of changes.
 *
 * `onChange(paths)` names the supported files the burst touched — created, written, deleted or
 * renamed — as absolute paths with `/` between segments, once each, in code-unit order. Files
 * `listFolder` would not list are left out, and a burst touching only those is not reported.
 *
 * `onChange()`, with NO argument, means anything under `root` may have changed: the burst held an
 * event with no file name, or a directory was created, removed or renamed (a removed name with no
 * extension is taken for a directory, since nothing is left to ask). A host re-lists the folder.
 * The same is sent once if the watcher stops on an error.
 *
 * Never throws: a folder that cannot be watched gives a handle with `watching: false`.
 */
export declare function watchFolder(root: string, onChange: (paths?: string[]) => void, options?: WatchFolderOptions): FolderWatch;
//# sourceMappingURL=watchFolder.d.ts.map