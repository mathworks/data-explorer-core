// Copyright 2026 The MathWorks, Inc.

import type BaseNode from './BaseNode.js';
import type { SourceOfferedEditor } from './BaseNode.js';

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
const gateByHolder = new WeakMap<object, McosStreamGate>();

/**
 * What answers for an edit inside a stream, with a MAT-file's three answers
 * (MatNode._editRefusal, _editValueRefusal, _valueRefusal): why an edit of `key` at `node` is
 * refused whatever its value, why the value it makes the property hold is, and why a value node
 * typed in for `node` is; or null where the stream's save writes it. `entry` is the entry `node`
 * is in. And, as a MAT-file says it (MatNode._followedProperty), what a property that follows an
 * edit of another follows to once the stream is saved, or undefined.
 */
export interface McosStreamGate {
  _editRefusal(entry: BaseNode, node: BaseNode, key: string): string | null;
  // And the editor it offers of a property a dictionary shows read-only (MatNode._offeredEditor).
  _offeredEditor(entry: BaseNode, node: BaseNode, key: string): SourceOfferedEditor | null;
  _editValueRefusal(entry: BaseNode, node: BaseNode, key: string, value: unknown): string | null;
  _valueRefusal(entry: BaseNode, node: BaseNode, value: BaseNode): string | null;
  _followedProperty(entry: BaseNode, node: BaseNode, key: string): unknown;
  // And, as a MAT-file keeps two nodes of one object in step (MatNode._twinsOutside, _mirrorTwins),
  // the nodes outside `root` an edit at or under it is copied into, and, after the edit, the copy,
  // answering the nodes copied into.
  _twinsOutside(root: BaseNode): BaseNode[];
  _mirrorTwins(root: BaseNode): BaseNode[];
  // And, as a MAT-file is told (MatNode._nodeEdited), an edit at `node`, once made.
  _nodeEdited(node: BaseNode): void;
}

export function setMcosStreamGate(holder: object, gate: McosStreamGate): void {
  gateByHolder.set(holder, gate);
}

/** The gate of the stream `holder` holds, or undefined for a node that holds none. */
export function mcosStreamGateOf(holder: object): McosStreamGate | undefined {
  return gateByHolder.get(holder);
}

/**
 * The gate of the stream `node` is in, at or above it within its entry, or null for a node in
 * none. Duck-typed on `isContainer`, as BaseNode.encodedHolderOf walks: the walk stops at the
 * first container, which an entry is a child of.
 */
export function mcosStreamGateAbove(node: BaseNode | null | undefined): McosStreamGate | null {
  for (let n = node; n && !(n as unknown as { isContainer?: boolean }).isContainer; n = n.parent) {
    const gate = gateByHolder.get(n);
    if (gate) {
      return gate;
    }
  }
  return null;
}
