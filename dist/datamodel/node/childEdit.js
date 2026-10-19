// Copyright 2026 The MathWorks, Inc.
// Tell the container's own parent that the container gained or lost a child, so a
// parent whose row for this container depends on its shape can follow. Called after
// every mutation below, including the undo/redo closures — a Simulink.Parameter's
// Value row disappears when its array collapses to a single element and has to come
// back when that removal is undone. Nothing else reacts (BaseNode's hook is a no-op),
// and this is the one place the four container classes share: doing it inside their
// own removeChildNode/restoreChildNode would mean five copies, each having to fire
// only AFTER the collapse bookkeeping those methods do last.
function notifyParent(node) {
    node.parent?.childStructureChanged(node);
}
// What puts back, as it is now, what every node above `node` sets from it (its
// childStructureRestorer), or null where none sets anything: held before an edit of `node` or
// of a node under it, and called by the edit's undo after the undone change is reported. The
// report sets it again from what the undo restored, and for a Simulink.Parameter that is the
// Value's shape, not the Dimensions and Complexity a hand-edited file held (ParameterNode). The
// edit's redo reports as the edit did, which sets it as the edit set it.
export function holdersRestorer(node) {
    const restorers = [];
    let child = node;
    for (let holder = node.parent; holder; holder = holder.parent) {
        const restore = holder.childStructureRestorer(child);
        if (restore) {
            restorers.push(restore);
        }
        child = holder;
    }
    return restorers.length === 0 ? null : () => restorers.forEach((restore) => restore());
}
// Add one child and return the closures that reverse and re-apply it, or null when
// the node refuses. `redo` restores the SAME child node at its original index
// rather than minting a fresh one, so a node reference held by the undo stack stays
// valid across any number of undo/redo cycles.
export function addChildUndoable(node) {
    if (!node.canAddChild()) {
        return null;
    }
    const holders = holdersRestorer(node);
    const child = node.addChildNode();
    // A second refusal, after the fact: a bus subclass that does not implement
    // _createElementNode accepts children in principle (canAddChild is
    // unconditional on BaseBusNode) but cannot actually mint one.
    if (!child) {
        return null;
    }
    const index = node.children.indexOf(child);
    notifyParent(node);
    return {
        node: child,
        undo: () => {
            node.removeChildNode(child);
            notifyParent(node);
            holders?.();
        },
        redo: () => {
            node.restoreChildNode(child, index);
            notifyParent(node);
        },
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
    const holders = holdersRestorer(node);
    node.removeChildNode(child);
    notifyParent(node);
    return {
        undo: () => {
            node.restoreChildNode(child, index);
            notifyParent(node);
            holders?.();
        },
        redo: () => {
            node.removeChildNode(child);
            notifyParent(node);
        },
    };
}
//# sourceMappingURL=childEdit.js.map