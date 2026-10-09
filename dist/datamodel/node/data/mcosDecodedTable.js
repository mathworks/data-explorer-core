// Copyright 2026 The MathWorks, Inc.
// The decoded MCOS object of each opaque variable in a parsed tree, held BESIDE the
// variables rather than written into them. A parse can be a host's own object — one it
// registered, built, and may keep after the source is gone — and a field the container
// set on it would be a change to data this package does not own, outliving the source
// it was decoded for. Keyed weakly, so an entry goes when its variable does.
//
// A module of its own, importing nothing at run time, because three layers read it:
// mcosTypedNode.attachMcosDecoded fills it, MatNode and ModelNode read their top-level
// variables out of it, and MatlabVariableNode.parseMatVariable reads every nested one —
// and MatlabVariableNode cannot import mcosTypedNode, which imports it.
const decodedByVariable = new WeakMap();
export function setMcosDecoded(variable, decoded) {
    if (decoded) {
        decodedByVariable.set(variable, decoded);
    }
    else {
        decodedByVariable.delete(variable);
    }
}
// The object its container decoded for `variable`, or undefined: not an opaque, not
// decoded yet, or not resolvable with confidence.
export function mcosDecodedFor(variable) {
    return decodedByVariable.get(variable);
}
//# sourceMappingURL=mcosDecodedTable.js.map