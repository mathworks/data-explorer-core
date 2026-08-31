// src/core/dto.ts
// Copyright 2026 The MathWorks, Inc.
//
// Serializable snapshots of live data-model nodes. In-process clients (GUI, VS Code)
// hold live nodes directly; out-of-process consumers (the `dex --json` agent path,
// a future TUI-over-ssh) need a flat, JSON-safe projection with no methods and no
// live parent/child object links. `toDTO` is that projection, used only at the edge.

import type { INode, ISourceNode } from './NodeInterfaces.js';

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
  // so the machine contract (SourceDTO) is actually produced.
  const asSource = node as Partial<ISourceNode>;
  if (typeof asSource.dirty === 'boolean') {
    const sdto = dto as SourceDTO;
    sdto.dirty = asSource.dirty;
    if (asSource.meta?.path) sdto.path = asSource.meta.path;
    if (asSource.sourceFormat) sdto.sourceFormat = asSource.sourceFormat;
  }
  if (depth > 0) {
    dto.children = kids.map((c) => toDTO(c, { depth: depth - 1 }));
  }
  return dto;
}
