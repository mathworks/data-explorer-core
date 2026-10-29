// src/fileKinds.ts
// Copyright 2026 The MathWorks, Inc.
//
// The `data-explorer-core/fileKinds` entry: which files this package reads, and nothing
// else of it.
//
// A host asks "is this a file Data Explorer opens?" in places that have no business
// loading a parser: an Electron main process guarding a read or filtering an Open dialog,
// a command line deciding what to hand on. Through the barrel that question costs the
// whole package — every reader, the session, the node classes — because a bundler cannot
// split one module's worth of string tests out of an entry that reaches everything. This
// entry reaches one module, which imports nothing (test/fileKindsEntry.test.ts holds both
// halves of that, and that every name here is the barrel's own value, not a copy).
//
// The list is written out rather than `export *`, so that a helper added to
// datamodel/fileKinds.ts for this package's own use does not become public here by
// accident. Every name below is also on the barrel; a host importing from both gets the
// same functions.
export {
  extOf,
  basenameOf,
  refBasename,
  modelNameOf,
  refModelExt,
  projectNameOf,
  projectFallbackName,
  isModelFile,
  isSlddFile,
  isMatFile,
  isProjectFile,
  isTomlProjectFile,
  TOML_PROJECT_FILE,
  MODEL_EXTS,
  SUPPORTED_EXTS,
  SUPPORTED_NAMES,
  GRAPH_EXTS,
  isSupportedPath,
  isGraphPath,
} from './datamodel/fileKinds.js';
