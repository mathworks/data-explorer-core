// Copyright 2026 The MathWorks, Inc.

import { XMLParser } from 'fast-xml-parser';
import { reasonOf, type ParseWarning } from './ParseWarning.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

/** A member file (or folder) of the project. */
export interface ProjectFile {
  path: string;
  isFolder: boolean;
  /** Label UUIDs assigned to this file (e.g. 'design'). */
  labels: string[];
}

/** An entry in the project's label catalog (category + display name). */
export interface ProjectLabel {
  /** The label id (its pointer `location`), used to resolve file assignments. */
  id: string;
  category: string;
  name: string;
}

/** A project-to-project reference. */
export interface ProjectReference {
  id: string;
  name: string | null;
}

export interface ParsedProject {
  name: string;
  files: ProjectFile[];
  pathFolders: string[];
  /** The catalog of labels defined in the project. */
  labels: ProjectLabel[];
  references: ProjectReference[];
  /**
   * What could not be read, empty when everything could. ALWAYS an array: this
   * reader has the channel, so a caller may read `.length` without guarding, and
   * an empty one is a positive statement that the store was read whole.
   */
  warnings: ParseWarning[];
}

const PROJECT_PREFIX = 'resources/project/';

interface XmlInfo {
  '@_Name'?: string;
  '@_location'?: string;
  '@_type'?: string;
  '@_Ref'?: string;
  '@_Type'?: string;
  '@_DataType'?: string;
  '@_UUID'?: string;
  Category?: XmlCategory | XmlCategory[];
}

interface XmlCategory {
  '@_UUID'?: string;
  Label?: XmlLabel | XmlLabel[];
}

interface XmlLabel {
  '@_UUID'?: string;
}

/** A resolved pointer/def pair within a directory. */
interface Entity {
  /** The hash/stem: names this entity's own child directory. */
  hash: string;
  /** The pointer <Info> (location + type). */
  pointer: XmlInfo | null;
  /** The definition <Info> (attributes / nested Category). */
  def: XmlInfo | null;
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) {
    return [];
  }
  return Array.isArray(v) ? v : [v];
}

/**
 * Parse a MATLAB/Simulink Project content store.
 *
 * `files` maps POSIX relpaths (relative to the project root) to file text.
 * Only entries under `resources/project/` are read. Never throws: on any
 * failure it returns a minimally-populated result with the fallback name — and
 * says so in `result.warnings`, which is the only thing separating that result
 * from a project which genuinely holds nothing.
 */
export function parseProject(files: Record<string, string>, projectName: string): ParsedProject {
  const warnings: ParseWarning[] = [];
  const result: ParsedProject = {
    name: projectName,
    files: [],
    pathFolders: [],
    labels: [],
    references: [],
    warnings,
  };

  try {
    // Index every parseable Info doc by its relpath (project-relative).
    const index = new Map<string, XmlInfo>();
    for (const [relPath, content] of Object.entries(files)) {
      if (!relPath.startsWith(PROJECT_PREFIX)) {
        continue;
      }
      if (!relPath.endsWith('.xml')) {
        continue;
      }
      const info = parseInfo(content, relPath, warnings);
      if (info) {
        // Store keyed relative to resources/project/ for simpler dir math.
        index.set(relPath.slice(PROJECT_PREFIX.length), info);
      }
    }

    if (index.size === 0) {
      // Every collection below reads out of this index, so an empty one means the
      // whole result is empty — and a `.prj` always has a store, so reaching here
      // is either the wrong kind of file or a store that did not survive its trip.
      warnings.push({
        code: 'source-empty',
        message:
          'No readable project entries were found under resources/project/, ' +
          'so this project reads as empty.',
      });
      return result;
    }

    // The `root/` directory holds the top-level entry pointers.
    const rootEntities = readDir(index, 'root');

    // Project name: the def whose pointer has location="ProjectData" type="Info".
    for (const ent of rootEntities) {
      if (ent.pointer?.['@_location'] === 'ProjectData' && ent.pointer?.['@_type'] === 'Info') {
        const name = ent.def?.['@_Name'];
        if (name) {
          result.name = name;
        }
      }
    }
    // Some stores also carry the name on a bare def <Info Name="MyProj"/> whose
    // pointer has no matching location; take it if we still have the fallback.
    if (result.name === projectName) {
      for (const ent of rootEntities) {
        const name = ent.def?.['@_Name'];
        if (name && !ent.pointer?.['@_type']) {
          result.name = name;
          break;
        }
      }
    }

    for (const ent of rootEntities) {
      const type = ent.pointer?.['@_type'];
      if (type === 'Files') {
        result.files = readFiles(index, ent.hash);
      } else if (type === 'ProjectPath') {
        result.pathFolders = readPathFolders(index, ent.hash);
      } else if (type === 'Categories') {
        result.labels = readCategories(index, ent.hash);
      } else if (type === 'Reference') {
        // A genuine project->project reference living directly in root.
        const ref = resolveReference(ent);
        if (ref) {
          result.references.push(ref);
        }
      }
    }

    // References may also live in their own top-level collection outside the
    // ProjectPath collection. Scan any root entry whose dir contains
    // type="Reference" children (but skip the ProjectPath collection itself).
    for (const ent of rootEntities) {
      if (ent.pointer?.['@_type'] === 'ProjectPath') {
        continue;
      }
      const children = readDir(index, ent.hash);
      for (const child of children) {
        if (child.pointer?.['@_type'] === 'Reference') {
          const ref = resolveReference(child);
          if (ref) {
            result.references.push(ref);
          }
        }
      }
    }

    result.files.sort((a, b) => a.path.localeCompare(b.path));
    result.pathFolders.sort((a, b) => a.localeCompare(b));

    return result;
  } catch (err) {
    // Still every collection empty rather than however far the walk got: a store is
    // read by convention with no schema to validate against, so a tree abandoned
    // mid-walk is a plausible-looking project missing arbitrary parts of itself,
    // which is harder for a host to present honestly than nothing at all. The
    // warnings survive — they are what says this is that case.
    warnings.push({
      code: 'source-unreadable',
      message: `The project store could not be read (${reasonOf(err)}), so this project reads as empty.`,
    });
    return {
      name: projectName,
      files: [],
      pathFolders: [],
      labels: [],
      references: [],
      warnings,
    };
  }
}

/**
 * One `<Info>` document, or null when there is nothing here to index.
 *
 * Null covers two cases that must NOT be reported alike. A document that fails to
 * parse, or that yields no elements at all, is CORRUPT — truncated, wrongly
 * encoded, half-written — and the entity it described is lost, so it warns. A
 * document that parses into elements but has no `<Info>` root is a sidecar this
 * version does not model; newer releases add them, and warning on one would put a
 * count on every project written by a release newer than this reader.
 */
function parseInfo(content: string, relPath: string, warnings: ParseWarning[]): XmlInfo | null {
  let doc: Record<string, unknown>;
  try {
    doc = xmlParser.parse(content) as Record<string, unknown>;
  } catch (err) {
    warnings.push({
      code: 'part-unreadable',
      message: `Skipped an unreadable project entry (${reasonOf(err)}).`,
      part: relPath,
    });
    return null;
  }

  // The parser is lenient and answers with an EMPTY object for input carrying no
  // markup at all (plain text, an empty file, binary). That is the same loss as a
  // throw — an entity the store said was here and is not — and it is the shape a
  // truncated or mis-encoded write actually takes, so it cannot be silent.
  if (doc === null || typeof doc !== 'object' || Object.keys(doc).length === 0) {
    warnings.push({
      code: 'part-unreadable',
      message: 'Skipped a project entry that contains no XML.',
      part: relPath,
    });
    return null;
  }

  const info = doc.Info;
  if (info === undefined || info === null) {
    return null;
  }
  // An empty element parses to '' — normalize to an empty object.
  if (typeof info !== 'object') {
    return {};
  }
  return info as XmlInfo;
}

/**
 * Read all pointer/def entities in a directory (relative to resources/project/).
 * Groups files by hash/stem, treating `p`/`_sp` as pointers and `d`/`_sd` as defs.
 */
function readDir(index: Map<string, XmlInfo>, dir: string): Entity[] {
  if (!dir) {
    return [];
  }
  const prefix = dir + '/';
  const byHash = new Map<string, Entity>();

  for (const [relPath, info] of index.entries()) {
    if (!relPath.startsWith(prefix)) {
      continue;
    }
    const rest = relPath.slice(prefix.length);
    // Only immediate children (no further nesting).
    if (rest.includes('/')) {
      continue;
    }
    const parsed = parseChildName(rest);
    if (!parsed) {
      continue;
    }
    const { hash, isPointer } = parsed;
    let ent = byHash.get(hash);
    if (!ent) {
      ent = { hash, pointer: null, def: null };
      byHash.set(hash, ent);
    }
    if (isPointer) {
      ent.pointer = info;
    } else {
      ent.def = info;
    }
  }

  return [...byHash.values()];
}

/**
 * Given a child filename like `8AEH..._sp.xml` or `qaw0...p.xml`, return the
 * hash (stem before the suffix) and whether it is a pointer. Null when the stem
 * carries none of the four recognized suffixes — a file in the store that is not
 * half of a pointer/def pair, which readDir skips.
 *
 * PRECONDITION: `name` ends in `.xml`. parseProject's index only admits `.xml`
 * paths, and readDir only asks about entries of that index, so re-checking here
 * would be a branch no input can take.
 */
function parseChildName(name: string): { hash: string; isPointer: boolean } | null {
  const stem = name.slice(0, -'.xml'.length);
  if (stem.endsWith('_sp')) {
    return { hash: stem.slice(0, -'_sp'.length), isPointer: true };
  }
  if (stem.endsWith('_sd')) {
    return { hash: stem.slice(0, -'_sd'.length), isPointer: false };
  }
  if (stem.endsWith('p')) {
    return { hash: stem.slice(0, -1), isPointer: true };
  }
  if (stem.endsWith('d')) {
    return { hash: stem.slice(0, -1), isPointer: false };
  }
  return null;
}

/**
 * Read the Files collection. Members are File entities; each File entity's own
 * dir holds its children as pointer/def pairs: a DIR_SIGNIFIER marks a folder,
 * and any nested type="File" children are themselves project files (recurse).
 */
function readFiles(index: Map<string, XmlInfo>, filesHash: string): ProjectFile[] {
  const out: ProjectFile[] = [];
  const seen = new Set<string>();
  const members = readDir(index, filesHash);
  for (const member of members) {
    collectFile(index, member, out, seen);
  }
  return out;
}

function collectFile(
  index: Map<string, XmlInfo>,
  entity: Entity,
  out: ProjectFile[],
  seen: Set<string>,
): void {
  if (entity.pointer?.['@_type'] !== 'File') {
    return;
  }
  const path = entity.pointer['@_location'];
  if (!path) {
    return;
  }
  // Guard against cycles / repeated hashes.
  if (seen.has(entity.hash)) {
    return;
  }
  seen.add(entity.hash);

  const children = readDir(index, entity.hash);
  let isFolder = false;
  const labels: string[] = [];
  const fileChildren: Entity[] = [];
  for (const child of children) {
    const ctype = child.pointer?.['@_type'];
    if (ctype === 'DIR_SIGNIFIER') {
      isFolder = true;
    } else if (ctype === 'File') {
      fileChildren.push(child);
    }
  }
  // Labels for this file live on the File entity's own def.
  if (entity.def) {
    collectLabels(entity.def, labels);
  }
  out.push({ path, isFolder, labels: dedupe(labels) });

  // Recurse into nested File children (folder contents).
  for (const child of fileChildren) {
    collectFile(index, child, out, seen);
  }
}

/** Collect all Label UUIDs from an Info def's nested <Category><Label/> nodes. */
function collectLabels(def: XmlInfo, into: string[]): void {
  for (const category of toArray(def.Category)) {
    for (const label of toArray(category.Label)) {
      const uuid = label['@_UUID'];
      if (uuid) {
        into.push(uuid);
      }
    }
  }
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * Read the ProjectPath collection. Each entry is a type="Reference" pointer
 * whose def carries `Ref="<folder>"`; that Ref is the path folder name.
 */
function readPathFolders(index: Map<string, XmlInfo>, hash: string): string[] {
  const out: string[] = [];
  const entries = readDir(index, hash);
  for (const ent of entries) {
    if (ent.pointer?.['@_type'] !== 'Reference') {
      continue;
    }
    const ref = ent.def?.['@_Ref'];
    if (ref) {
      out.push(ref);
    }
  }
  return out;
}

/**
 * Read the Categories collection into a flat label catalog. Each Category dir
 * holds type="Label" entries; the label display name is the def's Name.
 */
function readCategories(index: Map<string, XmlInfo>, hash: string): ProjectLabel[] {
  const out: ProjectLabel[] = [];
  const categories = readDir(index, hash);
  for (const cat of categories) {
    if (cat.pointer?.['@_type'] !== 'Category') {
      continue;
    }
    // Category display name: def Name, else the pointer location (the id).
    const categoryName = cat.def?.['@_Name'] || cat.pointer?.['@_location'] || '';
    const labelEntries = readDir(index, cat.hash);
    for (const labelEnt of labelEntries) {
      if (labelEnt.pointer?.['@_type'] !== 'Label') {
        continue;
      }
      const id = labelEnt.pointer?.['@_location'] || '';
      const name = labelEnt.def?.['@_Name'] || id || '';
      if (name) {
        out.push({ id, category: categoryName, name });
      }
    }
  }
  return out;
}

/**
 * Resolve a genuine project->project reference. Name is the basename of the
 * Ref path when present, else the UUID location.
 */
function resolveReference(ent: Entity): ProjectReference | null {
  const ref = ent.def?.['@_Ref'];
  const location = ent.pointer?.['@_location'] || '';
  const id = location || ref || '';
  if (!id) {
    return null;
  }
  let name: string | null = null;
  if (ref) {
    const parts = ref.split(/[/\\]/).filter((p) => p.length > 0);
    name = parts.length > 0 ? parts[parts.length - 1] : ref;
  }
  return { id, name };
}
