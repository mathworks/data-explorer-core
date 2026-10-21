// Copyright 2026 The MathWorks, Inc.
// Which nodes hold a dictionary value that is a MAT stream with MCOS objects in it, and what
// answers for an edit inside one: a binary dictionary's hex value, or the cdata this package
// pastes the same stream into a text dictionary as, whose Simulink.Parameter and Simulink.Signal
// objects ride in the stream's own subsystem (MatlabVariableNode.parseEncoded, _parseCdataObjects).
// Set where the stream is decoded, through the registry (data/mcosStreamEdit.adoptMcosStream), and
// read by BaseNode's editability getters and source hooks, which ask the stream, as they ask a
// MAT-file, what an edit inside it may be (BaseNode.sourceEditRefusal and its two siblings).
//
// Beside the node rather than on it, for the reason mcosPlace is: a field on a node is a field
// every writer and every restorer of it meets. Here, and not in data/, because BaseNode reads it,
// and this folder imports none of data/.
const gateByHolder = new WeakMap();
export function setMcosStreamGate(holder, gate) {
    gateByHolder.set(holder, gate);
}
/** The gate of the stream `holder` holds, or undefined for a node that holds none. */
export function mcosStreamGateOf(holder) {
    return gateByHolder.get(holder);
}
/**
 * The gate of the stream `node` is in, at or above it within its entry, or null for a node in
 * none. Duck-typed on `isContainer`, as BaseNode.encodedHolderOf walks: the walk stops at the
 * first container, which an entry is a child of.
 */
export function mcosStreamGateAbove(node) {
    for (let n = node; n && !n.isContainer; n = n.parent) {
        const gate = gateByHolder.get(n);
        if (gate) {
            return gate;
        }
    }
    return null;
}
//# sourceMappingURL=mcosStream.js.map