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
  canAddChild(): boolean;
  addChildNode(): C | null;
  canRemoveChild(): boolean;
  removeChildNode(child: BaseNode): void;
  restoreChildNode(child: BaseNode, index: number): void;
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
export function removeChildUndoable(node: ChildEditableNode, child?: BaseNode): ChildUndoRedo | null {
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
