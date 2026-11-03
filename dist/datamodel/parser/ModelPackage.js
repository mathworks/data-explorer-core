// Copyright 2026 The MathWorks, Inc.
import { packageStampsOf } from './EntrySource.js';
// What a `.slx` package holds of its Model Workspace, and whether a save of the package can be
// written at all: for the workspace's editor (ModelWorkspaceNode), which takes no edit a save could
// not write, and for the save (ModelFileWriter). No node is imported here, so that both can.
/** Where a `.slx` keeps its model workspace from R2019b: MATLAB's getByteStreamFromArray of a struct of the variables. */
export const WORKSPACE_STREAM_PART = 'simulink/modelWorkspace.mxarray';
/** Where a `.slx` kept it before R2019b: a whole MAT-file. */
export const WORKSPACE_MAT_PART = 'simulink/modelworkspace.mat';
/**
 * MATLAB's getByteStreamFromArray(struct()): a workspace of no variables, which is what a model
 * that keeps its own workspace and holds no part for it has (measured on R2027a,
 * test/parity/matlab/probe_workspace_stream.m).
 */
export const EMPTY_WORKSPACE = Uint8Array.from('0001494d000000000e000000380000000600000008000000020000000000000005000000080000000100000001000000010000000000000005000400010000000100000000000000'
    .match(/../g)
    .map((h) => parseInt(h, 16)));
/** The part a package names the type of each of its parts in. */
export const CONTENT_TYPES = '[Content_Types].xml';
/** The part a package names its own parts in, a model's workspace part among them. */
export const ROOT_RELS = '_rels/.rels';
/**
 * Why no save of `model`'s package can be written, as a clause, or null where one can: it is no
 * `.slx` (a `.mdl` is text, which this package does not write), it was opened without its parts or
 * without the list of its members (a host's parse handed over without them), a member the list
 * names is not among its parts (one that could not be read, or named `__proto__`), or a part's
 * bytes were handed away since.
 */
export function packageRefusal(model) {
    const entries = model._zipEntries;
    if (model.sourceFormat !== 'slx') {
        return 'a ' + extensionOf(model.name) + ' model is not written by this editor';
    }
    if (!entries) {
        return 'it was opened without its parts, so a save would lose every one';
    }
    const stamps = packageStampsOf(entries);
    if (!stamps) {
        return 'it was opened without the list of its parts a save puts the package back together by';
    }
    // The two parts a save of the workspace's first variable, or its last, writes the part's name
    // into (ModelFileWriter), which every package MATLAB writes holds.
    for (const naming of [CONTENT_TYPES, ROOT_RELS]) {
        if (!Object.prototype.hasOwnProperty.call(entries, naming)) {
            return 'it holds no "' + naming + '", which a package names its parts in';
        }
    }
    for (const stamp of stamps) {
        if (stamp.name.endsWith('/')) {
            continue;
        }
        if (!Object.prototype.hasOwnProperty.call(entries, stamp.name)) {
            return 'its part "' + stamp.name + '" could not be read, so a save would lose it';
        }
        if (handedAway(entries[stamp.name])) {
            return 'its part "' + stamp.name + '" is no longer held, so a save would lose it';
        }
    }
    return null;
}
/** Whether `bytes` are a view of a buffer a host has handed away (transferred) since. */
export function handedAway(bytes) {
    return bytes.buffer.detached === true;
}
function extensionOf(name) {
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot) : 'model';
}
//# sourceMappingURL=ModelPackage.js.map