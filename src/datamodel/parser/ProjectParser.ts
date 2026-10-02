// Copyright 2026 The MathWorks, Inc.

import { readProjectXml, ATTRIBUTE_PREFIX, TEXT_KEY } from './XmlReader.js';
import { reasonOf, type ParseWarning } from './ParseWarning.js';

/** A member file (or folder) of the project. */
export interface ProjectFile {
  /** POSIX path relative to the project ROOT, not to the parent entity. */
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
  /**
   * Whether MATLAB owns this label. The seven Classification labels ship with
   * every project and are marked read-only in the store; a label the project
   * itself added is not, which is the only thing distinguishing the two.
   */
  readOnly: boolean;
}

/** A project-to-project reference. */
export interface ProjectReference {
  id: string;
  name: string | null;
  /**
   * Where the referenced project lives, as the store spells it — relative to THIS
   * project's root, so typically `../OtherProject/other.prj`. Null when the store
   * recorded no path, which leaves `id` (a UUID) as all that is known about it.
   *
   * Kept alongside `name` rather than folded into it: `name` is the basename, which
   * is what a user reads, and this is what a host needs to actually open the thing.
   * Deriving one from the other only works in that direction.
   */
  path: string | null;
}

/**
 * A registered entry point: a shortcut, or a file MATLAB runs on open/close.
 *
 * One store collection covers all three, separated only by `kind`, which is why
 * they are one type here. `prev` is deliberately NOT exposed: the store encodes run
 * order as a linked list over these entries, and `entryPoints` is already in that
 * order (see `orderEntryPoints`), so a consumer never has to know the mechanism.
 */
export interface ProjectEntryPoint {
  /** The entry point's own UUID (its pointer `location`). */
  id: string;
  name: string;
  /** Project-root-relative path. May name a FOLDER — a shortcut can open one. */
  file: string;
  /** 'Basic' (a shortcut), 'StartUp', 'Shutdown', or whatever a newer release writes. */
  kind: string;
  /** Whether MATLAB shows this in its Shortcuts gallery. Startup/shutdown files are hidden. */
  visible: boolean;
  /** The EntryPointGroup id; '' when ungrouped (the store spells that 'default'). */
  groupId: string;
}

/** A named group in the Shortcuts gallery. */
export interface ProjectEntryPointGroup {
  id: string;
  name: string;
}

/**
 * A folder (or file) the project designates for a particular purpose — simulation
 * cache, code generation, startup folder, dependency cache.
 *
 * `key` is the store's own name for the purpose (`SimulinkCacheFolder`,
 * `SimulinkCodeGenFolder`, `ProjectStartupFolder`, `DependencyCacheFile`) and is
 * NOT translated here: a newer release may designate something this version has no
 * label for, and passing the raw key on lets a host show it rather than drop it.
 * Note the last of those four names a FILE, so these are not all folders.
 */
export interface ProjectWorkingFolder {
  key: string;
  /** Project-root-relative path. */
  ref: string;
}

export interface ParsedProject {
  name: string;
  /**
   * The store's declared `MetadataType` — how the project's metadata is laid out on
   * disk. '' when the store declares none and the layout could not be inferred.
   * Three are read: `fixedPathV2`, `distributed` and `monolithic`. Anything else is
   * reported through `warnings` rather than read, because guessing at a layout
   * produces a project that looks complete and is not.
   */
  format: string;
  files: ProjectFile[];
  /**
   * Folders added to the MATLAB path, project-root-relative. The project ROOT
   * itself is spelled '' — the store records it as `Ref=""`, and it is a real entry
   * (usually the first one MATLAB adds), so dropping it would under-report the path.
   */
  pathFolders: string[];
  /** The catalog of labels defined in the project. */
  labels: ProjectLabel[];
  references: ProjectReference[];
  /**
   * Shortcuts and startup/shutdown files, in this order: startup files in RUN
   * order, then shutdown files in run order, then everything else (shortcuts) in
   * store order. Run order is the store's, which is meaningful — MATLAB runs the
   * files top-down — and is not recoverable from any other field.
   */
  entryPoints: ProjectEntryPoint[];
  entryPointGroups: ProjectEntryPointGroup[];
  workingFolders: ProjectWorkingFolder[];
  /**
   * What could not be read, empty when everything could. ALWAYS an array: this
   * reader has the channel, so a caller may read `.length` without guarding, and
   * an empty one is a positive statement that the store was read whole.
   */
  warnings: ParseWarning[];
}

const PROJECT_PREFIX = 'resources/project/';

/** The store manifest, which declares the layout the rest of the store is in. */
const MANIFEST = 'Project.xml';

/** The layouts this reader walks. See `ParsedProject.format`. */
const FIXED_PATH_V2 = 'fixedPathV2';
const DISTRIBUTED = 'distributed';
const MONOLITHIC = 'monolithic';

/**
 * The root element of a `monolithic` store's single document.
 *
 * Lowercase, and the only root element in any layout that is not `<Info>` — which is
 * what makes it the structural signal for "this one document is the whole store".
 */
const MONOLITHIC_ROOT = 'project';

/**
 * Collection types whose `type="Reference"` children are NOT project references.
 *
 * A project->project reference and a path folder and a working folder are all
 * spelled `type="Reference"`, distinguished only by which collection they sit in.
 * So this is a DENY-list rather than an allow-list of reference collections, and
 * deliberately: the collection holding real references is spelled differently
 * across releases, and an allow-list missing a spelling silently drops references,
 * whereas this list — the collections whose meaning we positively model — cannot.
 * Before it existed, every WorkingFolders entry was reported as a project
 * reference, which INVENTED references a project does not have.
 */
const NOT_REFERENCE_COLLECTIONS = new Set([
  'ProjectPath',
  'WorkingFolders',
  'Categories',
  'Files',
  'EntryPoints',
  'EntryPointGroups',
  'Info',
]);

interface XmlExtension {
  '@_Name'?: string;
  '@_Value'?: string;
}

interface XmlInfo {
  '@_Name'?: string;
  '@_location'?: string;
  '@_type'?: string;
  '@_Ref'?: string;
  '@_Type'?: string;
  '@_DataType'?: string;
  '@_ReadOnly'?: string;
  '@_UUID'?: string;
  '@_MetadataType'?: string;
  '@_File'?: string;
  '@_Visible'?: string;
  '@_GroupUUID'?: string;
  Category?: XmlCategory | XmlCategory[];
  Extension?: XmlExtension | XmlExtension[];
}

/**
 * One element of a `monolithic` store's document tree.
 *
 * `XmlInfo` cannot stand in for this. A def is a closed set of attributes this reader
 * reads, which is what `XmlInfo` spells; an element of the monolithic tree carries
 * element CHILDREN named by their entity type, so its key set is open — `Files`,
 * `Categories`, `File`, `DIR_SIGNIFIER`, whatever a newer release adds. It extends
 * `XmlInfo` because the same element is both: an entity's node, and (one level down)
 * the `<Info>` def every collection reader below already knows how to read.
 */
interface XmlElement extends XmlInfo {
  /**
   * The entity's location. Capital `L` — `fixedPathV2` spells the same thing
   * `location` in a pointer document, and both spellings are live in one store.
   */
  '@_Location'?: string;
  [child: string]: unknown;
}

interface XmlCategory {
  '@_UUID'?: string;
  Label?: XmlLabel | XmlLabel[];
}

interface XmlLabel {
  '@_UUID'?: string;
}

/**
 * One entity in the store, normalized across layouts.
 *
 * The three layouts differ ONLY in how these three fields are found. `fixedPathV2`
 * puts `location`/`type` in a pointer document beside the def and names the child
 * directory by an opaque hash; `distributed` encodes all three in the filename
 * (`<location>.type.<Type>`) and nests the child directory under its parent;
 * `monolithic` has no files to name at all and encodes them in the element itself.
 * Once all three are read into this shape, every collection reader below is
 * layout-blind.
 */
interface Entity {
  /**
   * Where this entity's children are, and also its identity.
   *
   * A store-relative directory path in the two file-tree layouts. `monolithic` has
   * no directories, so it is the element's path within the document — same role,
   * same uniqueness, and it is the uniqueness that `collectFile`'s guard needs.
   */
  dir: string;
  location: string;
  type: string;
  /** The definition `<Info>` (attributes / nested Category). */
  def: XmlInfo | null;
}

/** Reads the children of an entity, and the top-level entities, for one layout. */
interface Layout {
  roots(): Entity[];
  children(entity: Entity): Entity[];
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) {
    return [];
  }
  return Array.isArray(v) ? v : [v];
}

function emptyResult(name: string, warnings: ParseWarning[]): ParsedProject {
  return {
    name,
    format: '',
    files: [],
    pathFolders: [],
    labels: [],
    references: [],
    entryPoints: [],
    entryPointGroups: [],
    workingFolders: [],
    warnings,
  };
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
  const result = emptyResult(projectName, warnings);

  try {
    // Index every parseable Info doc by its relpath (project-relative).
    const index = new Map<string, XmlInfo>();
    // The one document of a `monolithic` store, when this store is one. A store holds
    // either this or the index and never both: the monolithic document IS the store,
    // so there are no sidecars left to index.
    let monolith: XmlElement | null = null;

    for (const [relPath, content] of Object.entries(files)) {
      if (!relPath.startsWith(PROJECT_PREFIX)) {
        continue;
      }
      if (!relPath.endsWith('.xml')) {
        continue;
      }
      const doc = readStoreDoc(content, relPath, warnings);
      if (!doc) {
        continue;
      }
      const info = infoRootOf(doc);
      if (info) {
        // Store keyed relative to resources/project/ for simpler dir math.
        index.set(relPath.slice(PROJECT_PREFIX.length), info);
        continue;
      }
      // A `<project>` root rather than an `<Info>` one: a whole store in one nested
      // document. First one wins — a store has exactly one, and preferring the first
      // keeps the choice from depending on `files`' iteration order.
      if (!monolith) {
        const root = doc[MONOLITHIC_ROOT];
        if (root !== null && typeof root === 'object') {
          monolith = root as XmlElement;
        }
      }
    }

    if (!monolith && index.size === 0) {
      // Every collection below reads out of this index, so an empty one means the
      // whole result is empty — and a `.prj` always has a store, so reaching here
      // is either the wrong kind of file or a store that did not survive its trip.
      //
      // Except for one case worth naming separately: a store MATLAB wrote in its
      // `matlab.toml` format holds no XML at all, so it lands here looking exactly
      // like damage. It is not damaged, it is a format this reader does not read,
      // and a user told "nothing readable" would go looking for a corrupt file.
      const toml = Object.keys(files).find(
        (k) => k.startsWith(PROJECT_PREFIX) && k.slice(PROJECT_PREFIX.length).endsWith('matlab.toml'),
      );
      warnings.push(
        toml
          ? {
              // 'source-empty' rather than a code of its own: the code is the kind of
              // loss (the source opened and held nothing this reader recognizes) and
              // the message is which, per ParseWarningCode's note that the codes are
              // about containers and parts and not about any one format.
              code: 'source-empty',
              message:
                'This project stores its metadata as matlab.toml, which this viewer cannot read yet, ' +
                'so this project reads as empty. In MATLAB, Project Settings can save it as XML instead.',
              part: toml,
            }
          : {
              code: 'source-empty',
              message:
                'No readable project entries were found under resources/project/, ' +
                'so this project reads as empty.',
            },
      );
      return result;
    }

    // Which layout the store is in. The KIND of store is settled structurally, by
    // the root element, before the declared `MetadataType` is consulted at all: a
    // monolithic store's manifest IS the store, so there is no separate document to
    // ask, and a `<project>` root is the only root that is not `<Info>`.
    //
    // A store that declares a layout we cannot walk is reported and NOT guessed at:
    // the collection readers below would find nothing in it and return a project
    // that looks complete and empty, which is the one outcome a user cannot tell
    // from a fact about their own project.
    const declared = (monolith ?? index.get(MANIFEST))?.['@_MetadataType'] ?? '';
    const layoutName = declared || (monolith ? MONOLITHIC : inferLayout(index));
    const layout = layoutFor(layoutName, monolith, index);
    if (!layout) {
      // The name is still worth salvaging — it is what a host titles the view with,
      // and it reads out of the index without knowing the layout. A monolithic store
      // has no index to salvage from, and needs none: its document is named after
      // the project, so `projectName` is already the name a user would expect.
      result.name = salvageName(index) ?? projectName;
      warnings.push({
        code: 'source-empty',
        message: declared
          ? `This project's metadata is stored as "${declared}", which this viewer cannot read yet, ` +
            'so this project reads as empty. In MATLAB, Project Settings can save it as multiple XML files instead.'
          : 'The layout of this project store was not recognized, so this project reads as empty.',
        part: PROJECT_PREFIX + MANIFEST,
      });
      return result;
    }
    result.format = layoutName;

    const rootEntities = layout.roots();

    result.name = resolveNameFrom(rootEntities) ?? projectName;

    // Collections are matched on type AND location. Two collections of one type can
    // coexist — a real project carries both `location="Root" type="Files"` (its
    // members) and `location="ALM" type="Files"` (artifact tracking) — so matching
    // on type alone assigned the field twice and let store iteration order pick the
    // winner. `Root` is the project's own; anything else belongs to a feature we do
    // not model, and reading it as the member list is simply wrong.
    for (const ent of rootEntities) {
      if (ent.location !== 'Root') {
        continue;
      }
      if (ent.type === 'Files') {
        result.files = readFiles(layout, ent);
      } else if (ent.type === 'ProjectPath') {
        result.pathFolders = readPathFolders(layout, ent);
      } else if (ent.type === 'Categories') {
        result.labels = readCategories(layout, ent);
      } else if (ent.type === 'EntryPoints') {
        result.entryPoints = orderEntryPoints(readEntryPoints(layout, ent));
      } else if (ent.type === 'EntryPointGroups') {
        result.entryPointGroups = readEntryPointGroups(layout, ent);
      } else if (ent.type === 'WorkingFolders') {
        result.workingFolders = readWorkingFolders(layout, ent);
      }
    }

    for (const ent of rootEntities) {
      // A genuine project->project reference living directly in root.
      if (ent.type === 'Reference') {
        const ref = resolveReference(ent);
        if (ref) {
          result.references.push(ref);
        }
        continue;
      }
      // …or in its own collection. See NOT_REFERENCE_COLLECTIONS for why the set of
      // collections to skip is spelled out rather than the set to read.
      if (NOT_REFERENCE_COLLECTIONS.has(ent.type)) {
        continue;
      }
      for (const child of layout.children(ent)) {
        if (child.type === 'Reference') {
          const ref = resolveReference(child);
          if (ref) {
            result.references.push(ref);
          }
        }
      }
    }

    result.files.sort((a, b) => a.path.localeCompare(b.path));
    result.pathFolders.sort((a, b) => a.localeCompare(b));
    // The same reason as those two, reached by the parity corpus rather than by a
    // customer: a store's order is its DIRECTORY order, so one project converted
    // between metadata layouts handed the page its label catalog and its working
    // folders in two different orders. Neither carries an order worth keeping — the
    // catalog is a set, which the page re-sorts by use anyway, and the working
    // folders are keyed by purpose — so they are made deterministic here, where the
    // layouts meet, instead of in each consumer.
    //
    // NOT the entry points, which are in run order (`orderEntryPoints`), and not
    // the references, whose store order has not been measured against the order
    // MATLAB reports; sorting either would be inventing an order rather than
    // settling one.
    result.labels.sort(
      (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
    );
    result.workingFolders.sort((a, b) => a.key.localeCompare(b.key));

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
    return emptyResult(projectName, warnings);
  }
}

/**
 * The walker for a layout, or null for one this reader does not walk.
 *
 * `monolithic` is answered from the document and not from the name: a store that
 * DECLARES monolithic and holds no `<project>` document has nothing to walk, and
 * falling back to the sidecar index would read it under a layout it has just said it
 * is not in. That is the same refusal the other two names get for an unknown value,
 * reached by a different route.
 */
function layoutFor(
  name: string,
  monolith: XmlElement | null,
  index: Map<string, XmlInfo>,
): Layout | null {
  if (name === MONOLITHIC) {
    return monolith ? monolithicLayout(monolith) : null;
  }
  if (name === FIXED_PATH_V2) {
    return fixedPathV2Layout(index);
  }
  if (name === DISTRIBUTED) {
    return distributedLayout(index);
  }
  return null;
}

/**
 * Which layout a store with no manifest is in.
 *
 * Every store this reader has seen carries `Project.xml`, so this is the fallback
 * for one that lost it: `root/` is the entry directory `fixedPathV2` and nothing
 * else uses, and a `.type.` in a top-level name is `distributed`'s own spelling.
 * `monolithic` is not inferred here — it is settled before this is called, since its
 * document is the manifest and cannot be missing without the store being gone.
 */
function inferLayout(index: Map<string, XmlInfo>): string {
  for (const key of index.keys()) {
    if (key.startsWith('root/')) {
      return FIXED_PATH_V2;
    }
  }
  for (const key of index.keys()) {
    if (!key.includes('/') && key.includes('.type.')) {
      return DISTRIBUTED;
    }
  }
  return '';
}

/**
 * The project name, for a store whose layout could not be walked.
 *
 * Kept separate from `resolveNameFrom` because it reads the index directly rather
 * than the entity tree — there is no tree in this case — and every layout seen so
 * far spells the document holding the name recognizably enough to find it without
 * knowing which layout this is.
 */
function salvageName(index: Map<string, XmlInfo>): string | null {
  for (const [key, info] of index.entries()) {
    if (key === MANIFEST) {
      continue;
    }
    // `distributed` names it ProjectData.type.Info.xml; `fixedPathV2` puts it in a
    // hash-named def whose pointer says location="ProjectData".
    if (key.includes('ProjectData') && info['@_Name']) {
      return info['@_Name'];
    }
  }
  return null;
}

/** The project name from the root entities, or null to keep the filename fallback. */
function resolveNameFrom(rootEntities: Entity[]): string | null {
  for (const ent of rootEntities) {
    if (ent.location === 'ProjectData' && ent.type === 'Info') {
      const name = ent.def?.['@_Name'];
      if (name) {
        return name;
      }
    }
  }
  // Some stores also carry the name on a bare def <Info Name="MyProj"/> whose
  // pointer has no type at all.
  for (const ent of rootEntities) {
    const name = ent.def?.['@_Name'];
    if (name && !ent.type) {
      return name;
    }
  }
  return null;
}

/**
 * One store document parsed, or null when it is CORRUPT — truncated, wrongly
 * encoded, half-written — in which case the entities it described are lost and it
 * warns.
 *
 * Kept apart from `infoRootOf` because the two answer different questions and only
 * this one is a loss. A document that parses and is simply not an `<Info>` sidecar
 * is either the monolithic store or a sidecar this version does not model, and
 * neither is damage.
 */
function readStoreDoc(
  content: string,
  relPath: string,
  warnings: ParseWarning[],
): Record<string, unknown> | null {
  let doc: Record<string, unknown>;
  try {
    doc = readProjectXml(content) as Record<string, unknown>;
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

  return doc;
}

/**
 * The `<Info>` root of a store document, or null for a document that has none.
 *
 * Null is NOT a loss and does not warn: it is every monolithic store (whose root is
 * `<project>`) and every sidecar this version does not model. Newer releases add the
 * latter, and warning on one would put a count on every project written by a release
 * newer than this reader.
 */
function infoRootOf(doc: Record<string, unknown>): XmlInfo | null {
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

// ---------------------------------------------------------------------------------
// The two layouts.

/**
 * `fixedPathV2`: every entity is a POINTER/def pair of documents, and every child
 * directory sits at the TOP of the store named by an opaque hash — flat, however
 * deep the logical nesting goes, which is what "fixed path" means. The top-level
 * entities live in `root/`.
 */
function fixedPathV2Layout(index: Map<string, XmlInfo>): Layout {
  const readDir = (dir: string): Entity[] => {
    if (!dir) {
      return [];
    }
    const prefix = dir + '/';
    const byHash = new Map<string, { pointer: XmlInfo | null; def: XmlInfo | null }>();

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
      let pair = byHash.get(hash);
      if (!pair) {
        pair = { pointer: null, def: null };
        byHash.set(hash, pair);
      }
      if (isPointer) {
        pair.pointer = info;
      } else {
        pair.def = info;
      }
    }

    // Store order (Map preserves insertion), NOT sorted by hash: the hashes are
    // opaque, so sorting on them would impose an order that means nothing while
    // discarding the one the store was written in — which is the fallback order for
    // entry points whose run-order chain is absent.
    return [...byHash.entries()].map(([hash, pair]) => ({
      dir: hash,
      location: pair.pointer?.['@_location'] ?? '',
      type: pair.pointer?.['@_type'] ?? '',
      def: pair.def,
    }));
  };

  return { roots: () => readDir('root'), children: (e) => readDir(e.dir) };
}

/**
 * `distributed`: no pointer documents at all. An entity's location and type are its
 * FILENAME — `<location>.type.<Type>.xml` for the def, `<location>.type.<Type>/`
 * for the child directory — and directories nest the way the entities do. The
 * top-level entities sit directly in the store root.
 *
 * A collection may exist as a directory with no def document beside it
 * (`Root.type.Files/` without `Root.type.Files.xml`), so entities are discovered
 * from directory names as well as from documents, and a missing def is normal here
 * rather than a loss.
 */
function distributedLayout(index: Map<string, XmlInfo>): Layout {
  const readDir = (dir: string): Entity[] => {
    const prefix = dir ? dir + '/' : '';
    const byStem = new Map<string, XmlInfo | null>();

    for (const [relPath, info] of index.entries()) {
      if (!relPath.startsWith(prefix)) {
        continue;
      }
      const rest = relPath.slice(prefix.length);
      if (!rest) {
        continue;
      }
      const slash = rest.indexOf('/');
      if (slash === -1) {
        // An immediate document: the entity's def.
        const stem = rest.slice(0, -'.xml'.length);
        if (!byStem.has(stem)) {
          byStem.set(stem, info);
        } else if (byStem.get(stem) === null) {
          byStem.set(stem, info);
        }
      } else {
        // Something deeper: the first segment is an entity's child DIRECTORY, and
        // is how a collection with no def document of its own is found at all.
        const stem = rest.slice(0, slash);
        if (!byStem.has(stem)) {
          byStem.set(stem, null);
        }
      }
    }

    const out: Entity[] = [];
    for (const [stem, def] of byStem) {
      const split = splitTypedName(stem);
      if (!split) {
        continue;
      }
      out.push({ dir: prefix + stem, location: split.location, type: split.type, def });
    }
    return out;
  };

  return { roots: () => readDir(''), children: (e) => readDir(e.dir) };
}

/**
 * `monolithic`: the whole content store is ONE document and the entity tree IS the
 * element tree. There are no pointer documents and no filename convention, because
 * there are no filenames — an element's TAG is its type, its `Location` attribute is
 * its location, and its `<Info>` child is its def. MATLAB writes this layout for
 * `matlab.project.convertDefinitionFiles(root, "SingleFile")`.
 *
 * `dir` keeps its role as an entity's identity (see `Entity.dir`), but there is no
 * directory to name: it is the element's PATH within the document, `Files[1]/File[0]`,
 * built as the walk descends. Unique by construction, and the `nodes` map is what
 * turns one back into the element it names — the two file-tree layouts re-scan their
 * index for that, which this layout has no index to do.
 */
function monolithicLayout(root: XmlElement): Layout {
  const nodes = new Map<string, XmlElement>([['', root]]);

  const readChildren = (dir: string): Entity[] => {
    const node = nodes.get(dir);
    if (!node) {
      return [];
    }
    const def = defOf(node);
    const out: Entity[] = [];

    for (const [tag, value] of Object.entries(node)) {
      // Element children only. The engine's shape puts attributes under a prefix and
      // text under one reserved key, so these two are every key that is not a child.
      if (tag.startsWith(ATTRIBUTE_PREFIX) || tag === TEXT_KEY) {
        continue;
      }
      const children = toArray(value);
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        // An entity's def is not also one of its children. Compared by IDENTITY and
        // not by tag, because `<Info>` is BOTH things in this layout: the def of
        // every entity that has one, and the type of the entity holding the
        // project's name. See `defOf`.
        if (child === def) {
          continue;
        }
        const childDir = dir ? `${dir}/${tag}[${i}]` : `${tag}[${i}]`;
        const element = asElement(child);
        nodes.set(childDir, element);
        out.push({
          dir: childDir,
          location: element['@_Location'] ?? '',
          type: tag,
          def: defOf(element),
        });
      }
    }
    return out;
  };

  return { roots: () => readChildren(''), children: (e) => readChildren(e.dir) };
}

/**
 * A child node of the monolithic tree as an element.
 *
 * An element carrying neither attributes nor children parses as the empty STRING and
 * not as an object (see XmlReader's contract). It is still an ENTITY, and one that
 * matters: a bare `<DIR_SIGNIFIER/>` is of that shape, and `DIR_SIGNIFIER` is the
 * only thing that marks a project member as a folder — so reading it as nothing
 * would turn a folder into a file. Answering with an empty element instead keeps it
 * in the walk with no location and no def, which is a state the two file-tree
 * layouts already produce for an entity whose def is missing.
 */
function asElement(node: unknown): XmlElement {
  return node !== null && typeof node === 'object' ? (node as XmlElement) : {};
}

/**
 * The def of a monolithic entity: its `<Info>` child, or null when it has none.
 *
 * `<Info>` means two things here and only `Location` separates them. Every entity's
 * def is an `<Info>` child with attributes and no `Location`; the entity holding the
 * project's NAME is itself an `<Info Location="ProjectData">`, whose def is the
 * `<Info Name="..."/>` nested one level inside it. Taking the first `<Info>` child
 * blindly would make that entity the def of `<project>` itself, which both loses the
 * name and drops the entity `resolveNameFrom` looks for.
 */
function defOf(node: XmlElement): XmlInfo | null {
  for (const child of toArray(node.Info)) {
    const info = asElement(child);
    if (info['@_Location'] === undefined) {
      return info;
    }
  }
  return null;
}

/**
 * Split a `distributed` stem into its location and type.
 *
 * The LAST `.type.` is the separator, not the first: a location is a filename and
 * may contain the marker itself (a project file called `foo.type.File` yields the
 * stem `foo.type.File.type.File`), and splitting on the first would truncate it.
 * Null for a stem carrying no marker — `Project.xml` and the store's own uuid
 * document are both of that shape, and neither is an entity.
 */
function splitTypedName(stem: string): { location: string; type: string } | null {
  const marker = '.type.';
  const at = stem.lastIndexOf(marker);
  if (at <= 0) {
    return null;
  }
  const type = stem.slice(at + marker.length);
  if (!type || type.includes('.')) {
    return null;
  }
  return { location: stem.slice(0, at), type };
}

/**
 * Given a `fixedPathV2` child filename like `8AEH..._sp.xml` or `qaw0...p.xml`,
 * return the hash (stem before the suffix) and whether it is a pointer. Null when
 * the stem carries none of the four recognized suffixes — a file in the store that
 * is not half of a pointer/def pair, which readDir skips.
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

// ---------------------------------------------------------------------------------
// The collections.

/**
 * Read the Files collection. Members are File entities; each File entity's own
 * dir holds its children as entities: a DIR_SIGNIFIER marks a folder, and any
 * nested type="File" children are themselves project files (recurse).
 */
function readFiles(layout: Layout, collection: Entity): ProjectFile[] {
  const out: ProjectFile[] = [];
  const seen = new Set<string>();
  for (const member of layout.children(collection)) {
    collectFile(layout, member, '', out, seen);
  }
  return out;
}

function collectFile(
  layout: Layout,
  entity: Entity,
  parentPath: string,
  out: ProjectFile[],
  seen: Set<string>,
): void {
  if (entity.type !== 'File') {
    return;
  }
  // A file entity's location is relative to its PARENT, not to the project root —
  // the store nests them the way the filesystem does. Read verbatim, every file
  // inside a folder reported the bare name that a sibling at the root would, so
  // `utils/helper.m` and a root-level `helper.m` were indistinguishable.
  const name = entity.location;
  if (!name) {
    return;
  }
  const path = parentPath ? `${parentPath}/${name}` : name;
  // Guard against cycles / repeated hashes.
  if (seen.has(entity.dir)) {
    return;
  }
  seen.add(entity.dir);

  const children = layout.children(entity);
  let isFolder = false;
  const labels: string[] = [];
  const fileChildren: Entity[] = [];
  for (const child of children) {
    if (child.type === 'DIR_SIGNIFIER') {
      isFolder = true;
    } else if (child.type === 'File') {
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
    collectFile(layout, child, path, out, seen);
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
 * Read the ProjectPath collection. Each entry is a type="Reference" whose def
 * carries `Ref="<folder>"`; that Ref is the path folder, relative to the project
 * root, and `Ref=""` is the project root itself.
 */
function readPathFolders(layout: Layout, collection: Entity): string[] {
  const out: string[] = [];
  for (const ent of layout.children(collection)) {
    if (ent.type !== 'Reference') {
      continue;
    }
    const ref = ent.def?.['@_Ref'];
    // `!== undefined`, not truthiness: the project ROOT is on the path as `Ref=""`,
    // and it is usually the first folder MATLAB adds, so testing for a non-empty
    // string dropped a real entry from every project that has one.
    if (ref !== undefined) {
      out.push(ref);
    }
  }
  return out;
}

/**
 * Read the Categories collection into a flat label catalog. Each Category dir
 * holds type="Label" entries; the label display name is the def's Name.
 */
function readCategories(layout: Layout, collection: Entity): ProjectLabel[] {
  const out: ProjectLabel[] = [];
  for (const cat of layout.children(collection)) {
    if (cat.type !== 'Category') {
      continue;
    }
    // Category display name: def Name, else the location (the id).
    const categoryName = cat.def?.['@_Name'] || cat.location || '';
    for (const labelEnt of layout.children(cat)) {
      if (labelEnt.type !== 'Label') {
        continue;
      }
      const id = labelEnt.location || '';
      const name = labelEnt.def?.['@_Name'] || id || '';
      if (name) {
        // The attribute has its own vocabulary per element — 'READ_ONLY'/'WRITABLE'
        // on a label, '1'/'0' on a category — so test the AFFIRMATIVE values, not
        // presence. Presence was the old rule, and a real project's `WRITABLE`
        // disproved it: the label a user added read back as one of MATLAB's own,
        // which the project page draws as a built-in. A missing attribute is
        // writable, which is how a hand-made label in an older store spells it.
        const ro = labelEnt.def?.['@_ReadOnly'];
        out.push({ id, category: categoryName, name, readOnly: ro === 'READ_ONLY' || ro === '1' });
      }
    }
  }
  return out;
}

/**
 * An entry point plus the store's link to its predecessor.
 *
 * `prev` stays internal to this module: it is the MECHANISM by which the store
 * records run order, and `orderEntryPoints` resolves it into the order itself
 * before anything outside sees an entry point, so no consumer has to walk a linked
 * list to answer "which startup file runs first".
 */
interface ChainedEntryPoint extends ProjectEntryPoint {
  /** The id of the entry that runs BEFORE this one; 'HEAD' when first, '' when unchained. */
  prev: string;
}

/** Read the EntryPoints collection (shortcuts + startup/shutdown files). */
function readEntryPoints(layout: Layout, collection: Entity): ChainedEntryPoint[] {
  const out: ChainedEntryPoint[] = [];
  for (const ent of layout.children(collection)) {
    if (ent.type !== 'EntryPoint') {
      continue;
    }
    const def = ent.def;
    const file = def?.['@_File'] ?? '';
    const name = def?.['@_Name'] ?? '';
    if (!file && !name) {
      continue;
    }
    const group = def?.['@_GroupUUID'] ?? '';
    out.push({
      id: ent.location,
      name: name || file,
      file,
      kind: def?.['@_Type'] ?? '',
      // Attribute values are never coerced by the reader, so this is the string
      // '1' or '0' (see XmlReader's contract) — not a number and not a boolean.
      visible: def?.['@_Visible'] !== '0',
      // 'default' is the store's spelling for "no group"; a caller grouping by this
      // field would otherwise render a group literally called default.
      groupId: group === 'default' ? '' : group,
      prev: readPrev(def),
    });
  }
  return out;
}

/**
 * The predecessor link from an entry point's def.
 *
 * It arrives as a nested `<Extension Name="StartUpPrev"|"ShutdownPrev"
 * Value="<uuid>|HEAD"/>`. `toArray` is required, not defensive: the XML reader's
 * `isArray` is configured per-dictionary and does not cover this element, so a def
 * with one Extension yields an object and a def with two yields an array.
 */
function readPrev(def: XmlInfo | null | undefined): string {
  for (const ext of toArray(def?.Extension)) {
    const name = ext['@_Name'];
    if (name === 'StartUpPrev' || name === 'ShutdownPrev') {
      return ext['@_Value'] ?? '';
    }
  }
  return '';
}

/** Read the EntryPointGroups collection (the named groups of the Shortcuts gallery). */
function readEntryPointGroups(layout: Layout, collection: Entity): ProjectEntryPointGroup[] {
  const out: ProjectEntryPointGroup[] = [];
  for (const ent of layout.children(collection)) {
    if (ent.type !== 'EntryPointGroup') {
      continue;
    }
    const name = ent.def?.['@_Name'];
    if (name) {
      out.push({ id: ent.location, name });
    }
  }
  return out;
}

/** Read the WorkingFolders collection (cache, code generation, startup folder, …). */
function readWorkingFolders(layout: Layout, collection: Entity): ProjectWorkingFolder[] {
  const out: ProjectWorkingFolder[] = [];
  for (const ent of layout.children(collection)) {
    if (ent.type !== 'Reference') {
      continue;
    }
    const ref = ent.def?.['@_Ref'];
    if (!ent.location || ref === undefined) {
      continue;
    }
    out.push({ key: ent.location, ref });
  }
  return out;
}

/**
 * Put the startup and shutdown files in RUN order.
 *
 * The store encodes the order as a linked list, and only as one: each entry names
 * its PREDECESSOR in a nested `<Extension Name="StartUpPrev"/"ShutdownPrev"
 * Value="<uuid>"/>`. MATLAB runs the files top-down, so this order is meaningful
 * and no other field recovers it — sorting these by name would silently reorder a
 * shutdown sequence.
 *
 * THE FIRST ENTRY IS SPELLED TWO WAYS, and that is the whole difficulty. A
 * long-lived project says `Value="HEAD"` explicitly; a project that just added two
 * startup files and never reordered them writes no Extension on the first one at
 * all, and only the SECOND entry carries a link. So "first" is not a value to look
 * for, it is a position: an entry no other entry of its kind points at. Reading
 * `HEAD` as the only head left every project of the second shape in document
 * order, which is the order the store happens to serialize UUIDs in — reversed, in
 * the parity fixture, against the order MATLAB reports running them.
 *
 * Everything the chains do not reach keeps its store order and follows, so a
 * broken chain (a missing predecessor, a cycle) still yields every entry exactly
 * once.
 */
function orderEntryPoints(entries: ChainedEntryPoint[]): ProjectEntryPoint[] {
  const out: ChainedEntryPoint[] = [];
  const taken = new Set<ChainedEntryPoint>();

  for (const kind of ['StartUp', 'Shutdown']) {
    const hook = entries.filter((e) => e.kind === kind);

    // Index by predecessor so the walk is a lookup per step rather than a scan, and
    // so a store with two entries claiming the same predecessor (which nothing
    // prevents) still yields both instead of looping on one.
    const byPrev = new Map<string, ChainedEntryPoint[]>();
    for (const e of hook) {
      const list = byPrev.get(e.prev);
      if (list) {
        list.push(e);
      } else {
        byPrev.set(e.prev, [e]);
      }
    }

    const take = (e: ChainedEntryPoint): boolean => {
      if (taken.has(e)) {
        return false;
      }
      taken.add(e);
      out.push(e);
      return true;
    };

    // Every head, in store order, each followed to the end of its chain. A head is
    // an entry whose `prev` names no entry of this kind: `HEAD`, the empty string,
    // and a dangling UUID all say the same thing about where it sits. `taken` is
    // what makes this terminate on a cycle, which nothing in the store prevents.
    const ids = new Set(hook.map((e) => e.id));
    for (const head of hook) {
      if (ids.has(head.prev)) {
        continue;
      }
      let cursor: ChainedEntryPoint | undefined = head;
      while (cursor && take(cursor)) {
        cursor = (byPrev.get(cursor.id) ?? []).find((e) => !taken.has(e));
      }
    }

    // Whatever is left is in a cycle: no head reaches it. Store order, so it is
    // reported rather than dropped.
    for (const e of hook) {
      take(e);
    }
  }

  // Then the shortcuts, which have no order to preserve beyond the store's.
  for (const e of entries) {
    if (!taken.has(e)) {
      out.push(e);
    }
  }

  // Drop `prev` on the way out: see ChainedEntryPoint.
  return out.map(({ prev: _prev, ...rest }) => rest);
}

/**
 * Resolve a genuine project->project reference. Name is the basename of the
 * Ref path when present, else the UUID location.
 */
function resolveReference(ent: Entity): ProjectReference | null {
  const ref = ent.def?.['@_Ref'];
  const id = ent.location || ref || '';
  if (!id) {
    return null;
  }
  let name: string | null = null;
  if (ref) {
    const parts = ref.split(/[/\\]/).filter((p) => p.length > 0);
    name = parts.length > 0 ? parts[parts.length - 1] : ref;
  }
  return { id, name, path: ref ?? null };
}
