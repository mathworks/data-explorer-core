// src/folder/projectStore.ts
// Copyright 2026 The MathWorks, Inc.
//
// Where a project's DEFINITION lives on disk, and reading it into the map `parseProject` takes.
//
// A MATLAB/Simulink Project's structure lives in a sibling `resources/project/` store next to
// the .prj marker file. Read every *.xml under that store into a map keyed by POSIX relpath
// relative to the project ROOT (the directory containing the .prj), e.g.
// "resources/project/root/x.xml". These keys are what ProjectParser expects (it only reads
// entries under "resources/project/").
//
// R2026b's TOML format has no store to walk at all: `matlab.project.DefinitionFiles.Toml` puts
// the whole definition in one `matlab.toml` at the project root and deletes both `resources/`
// and the `<name>.prj` marker. So that case reads ONE file — and still hands back a map, keyed
// by the marker's own name, because the map is the interface `parseProject` dispatches on:
// finding a `matlab.toml` entry is how it knows to run the TOML reader rather than
// ProjectParser. One shape in, four formats read, and no caller of this function has to know
// which it got.
//
// The walk is this package's and the filesystem is the host's, behind `StoreFs`: the vscode
// extension reads through `workspace.fs`, a Node host through `node:fs`
// (`readProjectStoreFromDisk` in the ./node entry), a browser host through whatever handle it
// was given. The rules a host must not have to re-derive — which marker means which layout,
// which files are store documents, what a missing store answers — are the ones kept here.
import { isTomlProjectFile, TOML_PROJECT_FILE } from '../datamodel/fileKinds.js';

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

/** The directory part of a path, on either separator, so a Windows path needs no cleanup. */
function parentOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut < 0 ? '.' : path.slice(0, cut);
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
export async function readProjectStore(
  markerPath: string,
  fs: StoreFs,
): Promise<Record<string, string>> {
  if (isTomlProjectFile(markerPath)) {
    // Keyed with the constant rather than with the basename as it was found on disk. Either
    // would be read — `parseProject` matches the entry by basename, case-insensitively,
    // precisely so a host keying by a longer path or a `MATLAB.TOML` is not punished for it —
    // but the constant is the one spelling of this name, and a map whose key came off the
    // filesystem is a map a test has to be told the case of.
    const text = await readTextIfPresent(fs, markerPath);
    return text === undefined ? {} : { [TOML_PROJECT_FILE]: text };
  }
  const files: Record<string, string> = {};
  await readDirInto(fs, `${parentOf(markerPath)}/resources/project`, 'resources/project', files);
  return files;
}

/** One file's text, or undefined when it cannot be read — see readProjectStore. */
async function readTextIfPresent(fs: StoreFs, path: string): Promise<string | undefined> {
  try {
    return await fs.readText(path);
  } catch {
    return undefined; // marker gone between the glob and the read, or unreadable
  }
}

async function readDirInto(
  fs: StoreFs,
  dir: string,
  relDir: string,
  out: Record<string, string>,
): Promise<void> {
  let entries: readonly StoreEntry[];
  try {
    entries = await fs.list(dir);
  } catch {
    return; // directory absent/unreadable
  }
  for (const { name, type } of entries) {
    const child = `${dir}/${name}`;
    const childRel = `${relDir}/${name}`;
    if (type === 'directory') {
      await readDirInto(fs, child, childRel, out);
    } else if (type === 'file' && /\.xml$/i.test(name)) {
      // Case-insensitive for the same reason as the kind tests in datamodel/fileKinds.ts: these
      // names come off a case-insensitive filesystem, so an `.XML` store document would be
      // silently skipped and cost whatever entity it described. Not shared with that module —
      // `.xml` is a part name INSIDE a project store, not a format this package opens.
      const text = await readTextIfPresent(fs, child);
      if (text !== undefined) out[childRel] = text;
    }
  }
}
