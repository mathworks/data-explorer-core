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
export function extOf(filename) {
    const dot = filename.lastIndexOf('.');
    return dot < 0 ? '' : filename.slice(dot).toLowerCase();
}
/** Last path segment, splitting on both separators so a Windows path needs no cleanup. */
export function basenameOf(text) {
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
export function refBasename(text) {
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
export function modelNameOf(name) {
    const match = /^(.*)\.(slx|mdl)$/i.exec(name);
    return match ? match[1] : null;
}
/** True if `filename` names a Simulink model, in either container. */
export function isModelFile(filename) {
    const ext = extOf(filename);
    return ext === '.slx' || ext === '.mdl';
}
/** True if `filename` names a data dictionary. */
export function isSlddFile(filename) {
    return extOf(filename) === '.sldd';
}
/** True if `filename` names a MAT-file. */
export function isMatFile(filename) {
    return extOf(filename) === '.mat';
}
/** True if `filename` names a MATLAB project. */
export function isProjectFile(filename) {
    return extOf(filename) === '.prj';
}
//# sourceMappingURL=fileKinds.js.map