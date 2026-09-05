// src/core/dto.ts
// Copyright 2026 The MathWorks, Inc.
//
// Serializable snapshots of live data-model nodes. In-process clients (GUI, VS Code)
// hold live nodes directly; out-of-process consumers (the `dex --json` agent path,
// a future TUI-over-ssh) need a flat, JSON-safe projection with no methods and no
// live parent/child object links. `toDTO` is that projection, used only at the edge.

import type { INode, ISourceNode } from './NodeInterfaces.js';
import type { ParseWarning } from '../datamodel/parser/ParseWarning.js';

export interface PropDTO {
  key: string;
  displayName: string;
  value: string;      // node.getPropInfo().displayValue — string form the model reads/writes
  editable: boolean;
  // No per-property dataType: PropInfo carries no such field, and a node's own
  // data type already appears as its first-class `DataType` property row. Adding
  // an always-undefined field to the machine contract would be a false promise.
}

export interface NodeDTO {
  id: string;
  name: string;
  displayName: string;
  kind: string;
  className: string;
  icon: string;
  isContainer: boolean;
  isEntry: boolean;
  childIds: string[];       // ids only — breaks cycles, keeps flat
  props: PropDTO[];
  children?: NodeDTO[];     // present only when opts.depth > 0
}

export interface SourceDTO extends NodeDTO {
  path?: string;
  dirty: boolean;
  sourceFormat?: string;
  /**
   * What the reader could not read, omitted when it read everything. An
   * out-of-process consumer has only this projection to go on, so a warning the
   * live node carries and the DTO drops does not exist as far as that host is
   * concerned — which is the whole failure the channel was added to fix.
   */
  warnings?: ParseWarning[];
}

export interface ToDTOOptions {
  depth?: number;   // 0/undefined = shallow (childIds only); N = nest children N levels
}

function propsOf(node: INode): PropDTO[] {
  if (typeof node.getProperties !== 'function') return [];
  return node.getProperties().map((pc) => {
    const info = node.getPropInfo(pc);
    return {
      key: info.key,
      displayName: info.displayName,
      value: info.displayValue,
      editable: info.editable,
    };
  });
}

export function toDTO(node: INode, opts: ToDTOOptions = {}): NodeDTO {
  const depth = opts.depth ?? 0;
  const kids = Array.isArray(node.children) ? node.children : [];
  const dto: NodeDTO = {
    id: node.id,
    name: node.name,
    displayName: node.displayName,
    kind: node.kind,
    className: node.className,
    icon: node.icon,
    isContainer: !!node.isContainer,
    isEntry: !!node.isEntry,
    childIds: kids.map((c) => c.id),
    props: propsOf(node),
  };
  // Source-level nodes carry path/dirty/sourceFormat; surface them on the DTO
  // so the machine contract (SourceDTO) is actually produced. The gate is `meta`,
  // because it is the one field that means "a source some session opened": it is
  // written in exactly one place, `registerSource` in src/core/DataModel.ts, which
  // stamps it on every root it takes and on nothing else. Gating on `dirty` instead
  // asked a narrower question — "a source with a write path" — and a read-only
  // format failed it, so a `.prj` projected as a bare NodeDTO with no path for its
  // file label and none of the keys SourceDTO declares. What the narrower gate used
  // to catch and this one does not is a write-capable node no session has taken:
  // there is no path to go with it either way, and a `dirty` flag on a document the
  // DTO cannot name is not something a consumer can act on.
  const asSource = node as Partial<ISourceNode>;
  if (asSource.meta) {
    const sdto = dto as SourceDTO;
    // `dirty` stays REQUIRED on SourceDTO and reads `false` for a source that keeps
    // no flag, because for a read-only source that is the true answer rather than a
    // default: it can hold no unsaved edit. Note the node's own absence of the flag
    // is load-bearing elsewhere — getActiveSlddNode (DataModel.ts) reads it as "not
    // an editable document" — so the answer has to be supplied here rather than by
    // giving ProjectNode a flag. Leaving the DTO field optional instead would push
    // the same reasoning onto every consumer, each having to decide what `undefined`
    // means before it could so much as grey out a save button.
    sdto.dirty = typeof asSource.dirty === 'boolean' ? asSource.dirty : false;
    if (asSource.meta.path) sdto.path = asSource.meta.path;
    if (asSource.sourceFormat) sdto.sourceFormat = asSource.sourceFormat;
  }
  // Warnings are NOT part of the block above, and stayed out of it when that block
  // stopped keying off `dirty`: a node carries its diagnostics from the moment it is
  // parsed, so a host that parsed off-thread and holds a node the session has not
  // stamped yet still has something to report — and this is the one channel whose
  // absence a consumer is entitled to read as "the file was whole".
  // Copied rather than aliased — a DTO is a snapshot, so a consumer that sorts or
  // mutates this list must not be reaching into the live node to do it.
  if (asSource.warnings && asSource.warnings.length > 0) {
    (dto as SourceDTO).warnings = asSource.warnings.map((w) => ({ ...w }));
  }
  if (depth > 0) {
    dto.children = kids.map((c) => toDTO(c, { depth: depth - 1 }));
  }
  return dto;
}
