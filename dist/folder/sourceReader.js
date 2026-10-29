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
export {};
//# sourceMappingURL=sourceReader.js.map