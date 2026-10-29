// src/datamodel/fileKinds.ts
// Copyright 2026 The MathWorks, Inc.
//
// Which KIND of file a name refers to, and the two name reductions that go with it.
//
// This package decides that in several places — `ingest` dispatches bytes to a session
// adder by extension, `openSourceNamed` matches a reference against the open sources,
// the usage index parses a file according to what it is — and until this module each
// spelled its own test. That is the duplication this package's consumer just finished
// paying for downstream: eight independent `endsWith('.sldd')` tests, every one of them
// case-SENSITIVE while the globs and regexes that ADMITTED the file were not, so a
// dictionary MATLAB or Windows named `Params.SLDD` was found, opened, indexed, and then
// classified as nothing at all.
//
// So the kind tests live here, they are case-insensitive, and every reader in this
// package derives from them. A file name reaches this package from a filesystem, from
// inside a model, and from a host that may have typed it by hand; none of those three
// agree on case, and none of them should have to.

/** Lower-cased extension INCLUDING the dot, or '' for a name with none. */
export function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? '' : filename.slice(dot).toLowerCase();
}

/** Last path segment, splitting on both separators so a Windows path needs no cleanup. */
export function basenameOf(text: string): string {
  return text.split(/[\\/]/).pop() || text;
}

/**
 * Basename lower-cased — the key to match file names by.
 *
 * References are matched on this rather than on the name as written, because a model
 * records a linked file the way its author typed it: `Params.sldd` inside a model
 * legitimately names `params.sldd` on disk, and the file systems these live on
 * (macOS, Windows) agree with that reading. Matching exactly makes the SAME reference
 * resolve in one reader and silently not in another.
 */
export function refBasename(text: string): string {
  return basenameOf(text).toLowerCase();
}

/**
 * A model file name with its extension removed, or null when the name is not a model
 * file at all.
 *
 * `.slx` and `.mdl` are the one pair this package treats as two spellings of the same
 * thing (parseModel reads whichever the bytes are), and the reason this exists is that
 * a model reference is recorded with the PARENT's extension: ModelNode.addReferenceEntry
 * guesses, because a `.mdl` names its child without an extension, so the same child is
 * 'mdl_child.mdl' seen from a `.mdl` and 'mdl_child.slx' seen from a `.slx`. Resolving
 * that guess strictly would make the link dead for exactly the mixed hierarchy the
 * guess exists to serve, so the stem is what gets compared.
 *
 * It is also the model NAME as MATLAB uses it internally: a block path and a reference
 * record both name the model `engine`, never `engine.slx`.
 */
export function modelNameOf(name: string): string | null {
  const match = /^(.*)\.(slx|mdl)$/i.exec(name);
  return match ? match[1] : null;
}

/** True if `filename` names a Simulink model, in either container. */
export function isModelFile(filename: string): boolean {
  const ext = extOf(filename);
  return ext === '.slx' || ext === '.mdl';
}

/**
 * The extension to complete a bare model-reference name with, given the name of the
 * model that RECORDS the reference.
 *
 * A model file names its references without an extension, so the bare name has to be
 * completed before it can be used as a link target or matched against a file on disk.
 * It takes the PARENT's own extension: a reference is far likelier to be the same
 * generation of file as the model referencing it — a legacy `.mdl` hierarchy is legacy
 * throughout — and a `.mdl` model whose children were all labelled `.slx` would link to
 * nothing.
 *
 * This is published for the same reason `isModelFile` is. The guess is made TWICE for
 * every model opened, on two paths that must not disagree: this package completes it for
 * the node tree (`ModelNode.fromParsed` → `addReferenceEntry`), and a host completes it
 * again for whatever index it builds over `parseModel`'s raw `modelReferences` — a usage
 * graph resolves edges by filename, so it cannot use the bare name either. When the two
 * copies drift, the tree row and the graph edge name two different files for one
 * reference, and the row you can see stops agreeing with the link that resolves.
 */
export function refModelExt(parentFilename: string): string {
  return extOf(parentFilename) === '.mdl' ? '.mdl' : '.slx';
}

/** True if `filename` names a data dictionary. */
export function isSlddFile(filename: string): boolean {
  return extOf(filename) === '.sldd';
}

/** True if `filename` names a MAT-file. */
export function isMatFile(filename: string): boolean {
  return extOf(filename) === '.mat';
}

/**
 * The name of the one file a TOML-format project's entire definition lives in.
 *
 * The ONE place this name is spelled in the package, and it earns that because it is
 * not only a kind test: `ingest` keys the content it hands a session on it,
 * `parseProject` dispatches on finding it among a store's entries, and
 * `parseTomlProject` names it in the warnings it reports. Three independent literals
 * that must agree is the shape this module exists to prevent.
 */
export const TOML_PROJECT_FILE = 'matlab.toml';

/** True if `filename` names a TOML-format project definition. */
export function isTomlProjectFile(filename: string): boolean {
  return basenameOf(filename).toLowerCase() === TOML_PROJECT_FILE;
}

/**
 * True if `filename` names a MATLAB project.
 *
 * The only kind test here that answers from EITHER an extension or a NAME, because
 * R2026b gave a project two spellings: the long-standing `<name>.prj` marker beside a
 * `resources/project/` store, and `matlab.toml` at the project root with no marker and
 * no store at all (`matlab.project.DefinitionFiles.Toml` deletes both). Both are a
 * project to a host listing a folder, admitting a drop or labelling a tab, so both are
 * a project here.
 *
 * It is that NAME and emphatically not the `.toml` EXTENSION, which is the whole reason
 * `isTomlProjectFile` exists rather than another line beside `.prj`. TOML is the
 * configuration format of half the tooling a MATLAB repository sits beside, so admitting
 * the extension would make every `Cargo.toml`, `pyproject.toml` and `ruff.toml` in a
 * workspace a MATLAB project — offered for opening, parsed as a project definition, and
 * then reported as a project that declares nothing.
 */
export function isProjectFile(filename: string): boolean {
  return extOf(filename) === '.prj' || isTomlProjectFile(filename);
}

/**
 * A project file name with its `.prj` removed — the project's NAME, as distinct from the
 * file it is stored in.
 *
 * `parseProject` takes this rather than a filename, because it is what a project calls
 * itself: the name appears in a `.prj`'s own metadata and is the fallback when that
 * metadata is missing or unreadable. So every caller of `parseProject` has to make this
 * reduction first, and — like `refModelExt` — it is made on two paths that must not
 * disagree: this package makes it when adding a project source to a session, and a host
 * makes it again for whatever index it builds directly over `parseProject`. The name is
 * user-visible on both (a tree row and a graph group label), so a drift between the two
 * shows up as one project appearing under two names.
 *
 * Total rather than nullable, unlike `modelNameOf`: that one returns null to mean "not a
 * model, do not compare stems", whereas the answer wanted here is always a label. A name
 * with no `.prj` to strip is returned unchanged.
 */
export function projectNameOf(filename: string): string {
  return filename.replace(/\.prj$/i, '');
}

/**
 * The name to call a project whose own definition records none, given the path of the
 * marker file that definition was found through.
 *
 * `projectNameOf`'s warning is exactly why this is one function here rather than a rule
 * each host re-derives: the reduction is made on two paths that must not disagree —
 * this package makes it when adding a project source to a session, a host makes it
 * again for whatever index it builds over `parseProject` — and the result is a label a
 * user reads on both, so a drift shows up as one project appearing under two names.
 * Until R2026b the rule was small enough to be invisible and was duplicated anyway;
 * what made it worth naming is that it is no longer one rule.
 *
 * For a `matlab.toml` the name is the basename of the marker's PARENT FOLDER, because
 * the file is called `matlab.toml` in every project that has one — the stem reduction
 * that serves a marker (`MyProj.prj` -> `MyProj`) answers "matlab" for all of them, and
 * a host stripping the extension itself would title every such project identically. The
 * parent folder is what MATLAB calls a project it was handed the root of.
 *
 * Anything else delegates to `projectNameOf`, so `.prj` behaviour is bit-for-bit what
 * it was before this existed.
 *
 * Pure string work, splitting on both separators so a Windows path needs no cleanup —
 * and deliberately NOT `node:path`, because this module is reachable from the browser
 * barrel (see test/moduleBoundaries.test.ts).
 */
export function projectFallbackName(markerPath: string): string {
  if (!isTomlProjectFile(markerPath)) {
    return projectNameOf(basenameOf(markerPath));
  }
  const segments = markerPath.split(/[\\/]/).filter((segment) => segment.length > 0);
  const parent = segments.length >= 2 ? segments[segments.length - 2] : '';
  // '' when there is no parent segment to read, and the same for the two segments that
  // are a direction rather than a name: a path written relative to the cwd has `.` or
  // `..` where the folder name would be, and titling a project with either is worse
  // than admitting there is no name here to be had.
  return parent === '.' || parent === '..' ? '' : parent;
}

// The LISTS, beside the tests they have to agree with.
//
// A host needs the formats this package reads as an enumeration as well as a predicate:
// a folder search wants a glob, an Open dialog wants a filter, an editor manifest wants a
// selector, and none of those can be written with a function. So each host used to write
// the list out itself, and the list is the half of this rule that drifts — an extension in
// a host's list and in none of the tests above is discovered and then classified as
// nothing, and one in a test but absent from the list is never discovered at all. Kept
// here, the two halves are one module and test/fileKindLists.test.ts pins them against
// each other in both directions. What stays with a host is only the spelling its own platform
// wants (a glob dialect, a filter format), which this package has no concept of.

/**
 * Simulink models, in both containers.
 *
 * `.slx` is a ZIP OPC package; `.mdl` is either the same package written as text or the
 * classic nested-brace format. `parseModel` decides which from the bytes, so a host
 * listing files has no reason to tell the two `.mdl` flavours apart.
 */
export const MODEL_EXTS = ['slx', 'mdl'] as const;

/** Every format this package reads that is identified by its EXTENSION, without the dot. */
export const SUPPORTED_EXTS = ['sldd', 'mat', 'prj', ...MODEL_EXTS] as const;

/**
 * Every file this package reads that is identified by its NAME.
 *
 * One entry, and a list anyway, so that a host can treat the names as a set alongside the
 * extensions, and so that the next such marker is one string here rather than a second
 * code path in every host. `.toml` is deliberately NOT on SUPPORTED_EXTS (see
 * `isProjectFile`): the extension would admit every `Cargo.toml` in a workspace.
 */
export const SUPPORTED_NAMES = [TOML_PROJECT_FILE] as const;

/**
 * The files a usage or name graph reads: models, plus the data they reference.
 *
 * A project is excluded, in either of its formats, which is why SUPPORTED_NAMES has no
 * counterpart here: a project defines no variables and no parameter usages, so it
 * contributes nothing to either graph (`buildUsageIndex` reads these three kinds and no
 * other).
 */
export const GRAPH_EXTS = ['sldd', 'mat', ...MODEL_EXTS] as const;

/**
 * True if this package reads `path` at all — every extension on SUPPORTED_EXTS and every
 * name on SUPPORTED_NAMES, in any case.
 *
 * A union of the kind tests above rather than a regex over the lists, so that "supported"
 * means precisely "some reader here will know what this is", with the same case rule.
 */
export function isSupportedPath(path: string): boolean {
  return isGraphPath(path) || isProjectFile(path);
}

/**
 * True if `path` names a file a usage or name graph reads. The same set as
 * `isSupportedPath` minus the project — see GRAPH_EXTS.
 */
export function isGraphPath(path: string): boolean {
  return isModelFile(path) || isSlddFile(path) || isMatFile(path);
}
