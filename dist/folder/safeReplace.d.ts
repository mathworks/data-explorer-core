/** What `replaceFile` reads of a file: Node's `Stats`, as much of it as is used. */
export interface SaveStat {
    readonly mode: number;
    readonly uid: number;
    readonly gid: number;
    readonly nlink: number;
    readonly size: number;
    readonly mtime: Date;
    readonly mtimeMs: number;
    readonly dev: number;
    readonly ino: number;
    isSymbolicLink(): boolean;
}
/** An open file, as `SaveFs.open` hands it back: Node's `FileHandle`, as much of it as is used. */
export interface SaveFileHandle {
    write(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{
        bytesWritten: number;
    }>;
    writeFile(data: Uint8Array): Promise<void>;
    truncate(length: number): Promise<void>;
    chmod(mode: number): Promise<void>;
    chown(uid: number, gid: number): Promise<void>;
    sync(): Promise<void>;
    stat(): Promise<SaveStat>;
    close(): Promise<void>;
}
/**
 * The file system a save writes through: the calls `replaceFile` makes, in the shapes Node's
 * `fs/promises` has, so that module is one as it stands. Spelled out rather than taken from
 * Node's types, so that the main barrel names no `node:` module, not even for a type.
 */
export interface SaveFs {
    lstat(path: string): Promise<SaveStat>;
    stat(path: string): Promise<SaveStat>;
    realpath(path: string): Promise<string>;
    readlink(path: string): Promise<string>;
    access(path: string, mode: number): Promise<void>;
    readonly constants: {
        readonly W_OK: number;
    };
    readdir(path: string): Promise<string[]>;
    unlink(path: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    open(path: string, flags: string, mode?: number): Promise<SaveFileHandle>;
}
/** How the bytes got there, and the file's mtime+size as the write left them. */
export interface Written {
    mode: 'replaced' | 'in-place';
    /**
     * Read off the written file itself before it took the name (a replace) or before it was closed
     * (in place), so an outside write that lands just after cannot be taken for this one. In whole
     * milliseconds (`mtime.getTime()`), the units VS Code's `workspace.fs.stat` reports, which a host
     * compares stamps in. Absent for a write handed to the caller's own write (`provider`).
     */
    stamp?: {
        mtime: number;
        size: number;
    };
}
/**
 * Whether two paths name one file (one path, or two hard links to it): what tells a Save As onto
 * the file itself from a Save As elsewhere. False where it cannot be told — either path not there.
 */
export declare function sameFile(fs: SaveFs, a: string, b: string): Promise<boolean>;
/**
 * The replace itself, on Node's fs: exported for the unit tests, which run it against a real
 * temporary directory. `provider` is the provider's write, for a file whose folder is gone.
 */
export declare function replaceFile(fs: SaveFs, path: string, bytes: Uint8Array, provider?: () => PromiseLike<void>): Promise<Written>;
//# sourceMappingURL=safeReplace.d.ts.map