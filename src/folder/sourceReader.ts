// src/folder/sourceReader.ts
// Copyright 2026 The MathWorks, Inc.
//
// What a host's reader of folder files is, apart from the cache that reads through it.
//
// Its own module, and one that imports nothing, because the two sides of it are different
// weights: the cache (sourceCache.ts) reaches every reader and summariser in the data model, and
// a reader — `nodeSourceReader` on the ./node/folder entry, or a host's own over its filesystem —
// is a `stat` and a read. A reader defined in the cache's module would make naming its type load
// the data model's declarations as well; here it loads two interfaces.

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
