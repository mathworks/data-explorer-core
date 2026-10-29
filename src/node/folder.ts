// src/node/folder.ts
// Copyright 2026 The MathWorks, Inc.
//
// The `data-explorer-core/node/folder` entry: a host's folder reads over `node:fs`, and nothing of
// the data model.
//
// For the process that holds the files and parses none of them — an Electron main process
// serving a sandboxed page, which cannot read the disk itself. It lists the folder, versions and
// reads files, and walks a project's store; the page parses. Through `data-explorer-core/node`
// the same three functions cost the whole package (that entry registers the node classes and
// carries the session), a main bundle of 857 KB against 7 KB with only `./fileKinds`. This entry
// reaches the file-kind tests, the scan version rule, the project-store walk and `node:` builtins,
// and test/nodeFolderEntry.test.ts fails if it reaches anything else.
//
// The same functions are on `data-explorer-core/node` too, as the same values.
export {
  nodeSourceReader,
  nodeStoreFs,
  readProjectStoreFromDisk,
  type NodeSourceReaderOptions,
} from './folderReads.js';
export {
  listFolder,
  skipDirectory,
  FOLDER_FILE_LIMIT,
  type ListFolderOptions,
  type FolderListing,
} from './listFolder.js';
// The types those take and give, so a host can name them without the barrel's declarations.
export type { SourceFile, SourceReader } from '../folder/sourceReader.js';
export type { StoreFs, StoreEntry } from '../folder/projectStore.js';
