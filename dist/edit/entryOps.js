// Copyright 2026 The MathWorks, Inc.
//
// Copied from data-explorer-vscode src/host/entryOps.ts at c73da3c, which keeps its own until it adopts
// this (view-split step 6b): for now its types alone, which the JSON view's sync planners
// (jsonEntrySync.ts) speak in. The ops themselves come in with entryOps' functions (step 6a C3).
//
// Entry-level model ops: the one applier for every change to a binary .sldd's model that does NOT come
// from mutating a node in place — undo, redo, and the forward halves of delete/paste/drop. An op is a
// snapshot, not an action: `replace` and `insert` carry the entry's serialized record and re-parse it.
export {};
//# sourceMappingURL=entryOps.js.map