// Copyright 2026 The MathWorks, Inc.
// Add one child and return the closures that reverse and re-apply it, or null when
// the node refuses. `redo` restores the SAME child node at its original index
// rather than minting a fresh one, so a node reference held by the undo stack stays
// valid across any number of undo/redo cycles.
export function addChildUndoable(node) {
    if (!node.canAddChild()) {
        return null;
    }
    const child = node.addChildNode();
    // A second refusal, after the fact: a bus subclass that does not implement
    // _createElementNode accepts children in principle (canAddChild is
    // unconditional on BaseBusNode) but cannot actually mint one.
    if (!child) {
        return null;
    }
    const index = node.children.indexOf(child);
    return {
        node: child,
        undo: () => node.removeChildNode(child),
        redo: () => node.restoreChildNode(child, index),
    };
}
// Remove `child` and return the closures that reverse and re-apply it, or null when
// the node refuses, or when `child` is missing or not one of its children — a stale
// reference from another container must not disturb this one.
export function removeChildUndoable(node, child) {
    if (!node.canRemoveChild() || !child) {
        return null;
    }
    const index = node.children.indexOf(child);
    if (index < 0) {
        return null;
    }
    node.removeChildNode(child);
    return {
        undo: () => node.restoreChildNode(child, index),
        redo: () => node.removeChildNode(child),
    };
}
//# sourceMappingURL=childEdit.js.map