/** A candidate file, before anything has been read: what it is called and where. */
export interface SourceFile {
    uriString: string;
    path: string;
}
/**
 * How the cache reads. Two calls, and they are the whole point of it: the first is cheap
 * enough to make on every pass and the second is what that buys.
 */
export interface SourceReader {
    /**
     * An opaque token that changes when the file's content might have, or `null` for a file
     * that should not be read at all (too large, unreadable). Must not require reading the
     * file — a version that cost a read would defeat the cache it keys.
     */
    version(file: SourceFile): Promise<string | null>;
    /** The file's bytes, or `null` if it turned out to be unreadable after all. */
    bytes(file: SourceFile): Promise<ArrayBuffer | null>;
}
//# sourceMappingURL=sourceReader.d.ts.map