// Copyright 2026 The MathWorks, Inc.

import type BaseNode from './BaseNode.js';

// The undo/redo wrapper around adding or removing one child, shared by every node
// that manages its own children: bus (BaseBusNode and its three subclasses), enum
// type, struct, and the MATLAB array/cell/string variable. Each of those defines
// the five hooks in ChildEditableNode; only the WRAPPING — check the gate, capture
// the child's index, hand back closures — was duplicated, four times over, and had
// begun to drift (StructNode's remove took a required child argument while the
// other three took an optional one, and two of the four copies guarded a null child
// their own non-nullable addChildNode could never produce).
//
// Free functions rather than base-class methods because the hooks are declared on
// the four subclasses, not on DataNode: hoisting the wrapper would mean giving
// DataNode no-op removeChildNode / restoreChildNode purely to satisfy it, adding
// two bodies nothing can ever call. DataNode instead answers "no structural editing
// here" directly, returning null from both exec methods.

// The structural-editing contract. Nothing declares `implements` — TypeScript's
// structural typing matches the node classes as they already are. Generic in the
// child type so a node whose addChildNode returns something narrower than BaseNode
// (StructNode returns DataNode) keeps that type in its own exec signature.
export interface ChildEditableNode<C extends BaseNode = BaseNode> {
  children: BaseNode[];
  parent: BaseNode | null;
  canAddChild(): boolean;
  addChildNode(): C | null;
  canRemoveChild(): boolean;
  removeChildNode(child: BaseNode): void;
  restoreChildNode(child: BaseNode, index: number): void;
}

// Tell the container's own parent that the container gained or lost a child, so a
// parent whose row for this container depends on its shape can follow. Called after
// every mutation below, including the undo/redo closures — a Simulink.Parameter's
// Value row disappears when its array collapses to a single element and has to come
// back when that removal is undone. Nothing else reacts (BaseNode's hook is a no-op),
// and this is the one place the four container classes share: doing it inside their
// own removeChildNode/restoreChildNode would mean five copies, each having to fire
// only AFTER the collapse bookkeeping those methods do last.
function notifyParent(node: ChildEditableNode<BaseNode>): void {
  node.parent?.childStructureChanged(node as unknown as BaseNode);
}

// What puts back, as it is now, what every node above `node` sets from it (its
// childStructureRestorer), or null where none sets anything: held before an edit of `node` or
// of a node under it, and called by the edit's undo after the undone change is reported. The
// report sets it again from what the undo restored, and for a Simulink.Parameter that is the
// Value's shape, not the Dimensions and Complexity a hand-edited file held (ParameterNode). The
// edit's redo reports as the edit did, which sets it as the edit set it.
export function holdersRestorer(node: BaseNode): (() => void) | null {
  const restorers: (() => void)[] = [];
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

export interface ChildUndoRedo {
  undo: () => void;
  redo: () => void;
}

export interface ChildAddEdit<C extends BaseNode = BaseNode> extends ChildUndoRedo {
  node: C;
}

// Add one child and return the closures that reverse and re-apply it, or null when
// the node refuses. `redo` restores the SAME child node at its original index
// rather than minting a fresh one, so a node reference held by the undo stack stays
// valid across any number of undo/redo cycles.
export function addChildUndoable<C extends BaseNode>(node: ChildEditableNode<C>): ChildAddEdit<C> | null {
  if (!node.canAddChild()) {
    return null;
  }
  const holders = holdersRestorer(node as unknown as BaseNode);
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
export function removeChildUndoable(node: ChildEditableNode, child?: BaseNode): ChildUndoRedo | null {
  if (!node.canRemoveChild() || !child) {
    return null;
  }
  const index = node.children.indexOf(child);
  if (index < 0) {
    return null;
  }
  const holders = holdersRestorer(node as unknown as BaseNode);
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
