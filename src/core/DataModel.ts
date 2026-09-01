// Copyright 2026 The MathWorks, Inc.

import { defaultBus, createEventBus, type EventBusInstance } from './EventBus.js';
import { createUndoManager } from './UndoManager.js';
import SlddNode from '../datamodel/node/container/SlddNode.js';
import ModelNode from '../datamodel/node/container/ModelNode.js';
import MatNode from '../datamodel/node/container/MatNode.js';
import ProjectNode from '../datamodel/node/container/ProjectNode.js';
import { parseSlx } from '../datamodel/parser/SlxParser.js';
import type { ParsedSlx } from '../datamodel/parser/SlxParser.js';
import { parseMat } from '../datamodel/parser/MatParser.js';
import type { ParsedMat } from '../datamodel/parser/MatParser.js';
import { parseProject } from '../datamodel/parser/ProjectParser.js';
import type { INode, IContainerNode, ISourceNode, IAllNode, SourceMeta } from './NodeInterfaces.js';

export type { IAllNode as AllNode, SourceMeta };

export interface CreateSessionOptions {
  bus?: EventBusInstance;
}

export function createSession(opts: CreateSessionOptions = {}) {
  const bus = opts.bus ?? createEventBus();
  const UndoManager = createUndoManager(bus);
  const { publish, subscribe } = bus;

  const allNode: IAllNode = {
  __isAllNode: true,
  isContainer: true,
  name: '__all__',
  displayName: 'Root',
  icon: 'abstractClass',
  parent: null,
  id: '__all__',
};

const dataSources: Map<string, ISourceNode> = new Map();
const nodeIndex: Map<string, INode> = new Map();
let contextNode: INode | IAllNode | null = null;
let entryNodes: INode[] = [];
let previewNode: INode | null = null;
let batchDepth = 0;

function buildMeta(meta?: Partial<SourceMeta>): SourceMeta {
  return {
    path: (meta && meta.path) || '',
    lastModified: (meta && meta.lastModified) || null,
    size: (meta && meta.size) || 0,
    fileHandle: (meta && meta.fileHandle) || null,
  };
}

function registerSource(srcId: string, sourceNode: ISourceNode, meta?: Partial<SourceMeta>): ISourceNode {
  (sourceNode as unknown as { meta: SourceMeta }).meta = buildMeta(meta);
  // Re-registering a srcId REPLACES its tree, so the outgoing tree's nodes have to
  // leave nodeIndex first. `dataSources.set` drops the only reference to the old
  // source, but its node ids stay in nodeIndex forever otherwise — and findNodeById
  // would keep resolving them, handing callers a detached node from a tree the
  // session no longer owns. Edits routed there mutate an orphan and vanish on save.
  // Reloading the same file (parse → addDataSource on the same uri) is the ordinary
  // way to hit this, so it is a routine path, not a corner case.
  const previous = dataSources.get(srcId);
  if (previous) {
    deindexSource(previous);
  }
  dataSources.set(srcId, sourceNode);
  indexSource(sourceNode);
  publish('datamodel/source-added', { srcId, slddNode: sourceNode });
  return sourceNode;
}

function indexSource(source: ISourceNode): void {
  const flat = source.flatten();
  for (let i = 0; i < flat.length; i++) {
    nodeIndex.set(flat[i].id, flat[i]);
  }
}

function deindexSource(source: ISourceNode): void {
  const flat = source.flatten();
  for (let i = 0; i < flat.length; i++) {
    nodeIndex.delete(flat[i].id);
  }
}

function beginBatch(): void {
  batchDepth++;
}

function endBatch(): void {
  if (batchDepth > 0) {
    batchDepth--;
  }
  if (batchDepth === 0) {
    publish('active/changed');
  }
}

function publishActiveChanged(): void {
  if (batchDepth === 0) {
    publish('active/changed');
  }
}

function setActiveContext(node: INode | IAllNode): void {
  contextNode = node;
  entryNodes = [];
  publishActiveChanged();
}

function setActiveEntry(nodes: INode | INode[] | null): void {
  if (nodes === null) {
    entryNodes = [];
  } else if (Array.isArray(nodes)) {
    entryNodes = nodes;
  } else {
    entryNodes = [nodes];
  }
  publishActiveChanged();
}

function setActive(context: INode | IAllNode | null, entry: INode | INode[] | null): void {
  contextNode = context;
  if (entry === null) {
    entryNodes = [];
  } else if (Array.isArray(entry)) {
    entryNodes = entry;
  } else {
    entryNodes = [entry];
  }
  publishActiveChanged();
}

function getContextNode(): INode | IAllNode | null {
  return contextNode;
}

function getEntryNode(): INode | null {
  return entryNodes.length > 0 ? entryNodes[0] : null;
}

function getEntryNodes(): INode[] {
  return entryNodes;
}

function getActiveNode(): INode | IAllNode | null {
  return entryNodes.length > 0 ? entryNodes[0] : contextNode;
}

function addDataSource(srcId: string, content: Record<string, unknown>, meta?: Partial<SourceMeta>): ISourceNode {
  const slddNode = SlddNode.parse(content, srcId);
  return registerSource(srcId, slddNode as unknown as ISourceNode, meta);
}

function addParsedSource(srcId: string, slddNode: ISourceNode, meta?: Partial<SourceMeta>): ISourceNode {
  return registerSource(srcId, slddNode, meta);
}

function addModelSource(srcId: string, buffer: ArrayBuffer, meta?: Partial<SourceMeta>): ISourceNode {
  const modelNode = ModelNode.fromParsed(parseSlx(buffer, srcId), srcId);
  return registerSource(srcId, modelNode as unknown as ISourceNode, meta);
}

function addMatSource(srcId: string, buffer: ArrayBuffer, meta?: Partial<SourceMeta>): ISourceNode {
  const matNode = MatNode.fromParsed(parseMat(buffer), srcId);
  return registerSource(srcId, matNode as unknown as ISourceNode, meta);
}

function addProjectSource(
  srcId: string,
  files: Record<string, string>,
  meta?: Partial<SourceMeta>,
): ISourceNode {
  // srcId may be a full path or an opaque URI, so prefer meta.path when the host
  // supplied one; either way the node is labelled with the basename, .prj included,
  // because the tree shows a file. parseProject wants a project NAME rather than a
  // filename for its fallback, hence the strip — note ProjectNode.fromParsed labels
  // itself from the basename and never reads parsed.name, so the stripped form only
  // shows up if a host calls parseProject itself.
  const basename = ((meta && meta.path) || srcId).split(/[\\/]/).pop() || srcId;
  const parsed = parseProject(files, basename.replace(/\.prj$/i, ''));
  const projectNode = ProjectNode.fromParsed(parsed, basename);
  return registerSource(srcId, projectNode as unknown as ISourceNode, meta);
}

// The *Parsed entry points take `unknown` because the host parsed the file itself
// (on a worker, say) and hands the result back across a boundary that erased its
// type, so the cast here is the real one and not a papered-over mismatch.
function addModelSourceParsed(srcId: string, parsed: unknown, meta?: Partial<SourceMeta>): ISourceNode {
  const modelNode = ModelNode.fromParsed(parsed as ParsedSlx, srcId);
  return registerSource(srcId, modelNode as unknown as ISourceNode, meta);
}

function addMatSourceParsed(srcId: string, parsed: unknown, meta?: Partial<SourceMeta>): ISourceNode {
  const matNode = MatNode.fromParsed(parsed as ParsedMat, srcId);
  return registerSource(srcId, matNode as unknown as ISourceNode, meta);
}

// The source a node ultimately belongs to, or null for the synthetic all-node.
function ownerSourceOf(node: INode | IAllNode | null): INode | null {
  if (!node || ('__isAllNode' in node && node.__isAllNode)) {
    return null;
  }
  let cur = node as INode;
  while (cur.parent) {
    cur = cur.parent;
  }
  return cur;
}

// Drop any selection or preview that points into `source` (all of them when
// `source` is null). Closing a file must not leave the active/preview node
// referencing a detached tree — getActiveSlddNode() would keep walking up to the
// removed root and hand callers a source the session no longer owns, so edits
// and undo would be routed at a document that is no longer open.
function releaseSelection(source: INode | null): void {
  let activeChanged = false;
  if (contextNode && (source === null || ownerSourceOf(contextNode) === source)) {
    contextNode = null;
    activeChanged = true;
  }
  if (entryNodes.length > 0) {
    const kept = source === null ? [] : entryNodes.filter((n) => ownerSourceOf(n) !== source);
    if (kept.length !== entryNodes.length) {
      entryNodes = kept;
      activeChanged = true;
    }
  }
  if (previewNode && (source === null || ownerSourceOf(previewNode) === source)) {
    previewNode = null;
    publish('preview/changed');
  }
  if (activeChanged) {
    publishActiveChanged();
  }
}

function removeDataSource(srcId: string): void {
  const source = dataSources.get(srcId);
  if (!source) {
    return;
  }
  deindexSource(source);
  dataSources.delete(srcId);
  // Drop the selection BEFORE announcing the removal. A subscriber to
  // 'datamodel/source-removed' legitimately asks what is selected now (to repaint a
  // property inspector, to decide whether to close a panel), and publishing first
  // answered that question with the tree that was just removed — getActiveSlddNode()
  // walks parents and would hand back the removed root, exactly the stale-context
  // hazard releaseSelection exists to prevent.
  releaseSelection(source as unknown as INode);
  publish('datamodel/source-removed', { srcId });
}

function removeAll(): void {
  dataSources.clear();
  nodeIndex.clear();
  publish('datamodel/cleared');
  releaseSelection(null);
}

function getDataSource(srcId: string): ISourceNode | null {
  return dataSources.get(srcId) || null;
}

function hasDataSource(srcId: string): boolean {
  return dataSources.has(srcId);
}

function getDataSourceIds(): string[] {
  return Array.from(dataSources.keys());
}

function getDataSourceCount(): number {
  return dataSources.size;
}

function isBatching(): boolean {
  return batchDepth > 0;
}

function findNodeById(nodeId: string): INode | null {
  return nodeIndex.get(nodeId) || null;
}

function reindexAll(): void {
  nodeIndex.clear();
  dataSources.forEach((src) => indexSource(src));
}

subscribe('node/added', reindexAll);
subscribe('node/deleted', reindexAll);
subscribe('node/children-changed', reindexAll);

// --- Mutation Actions ---

// The value `propertyName` currently holds on `node`, as the string setProperty
// accepts, so an edit can be undone without the caller having to supply the prior
// value. Falls back to `fallback` when the node does not project the property (an
// arbitrary key, or one absent from getProperties), which keeps a caller that DOES
// pass oldValue authoritative for anything this cannot see.
function readPropertyValue(node: INode, propertyName: string, fallback: unknown): unknown {
  try {
    const props = node.getProperties();
    for (let i = 0; i < props.length; i++) {
      const key = props[i].key;
      const column = (props[i] as unknown as { column?: string }).column;
      if (key === propertyName || column === propertyName) {
        // displayValue is the round-trippable text form (what the inspector shows
        // and what an edit submits); `value` may be a live object reference.
        return node.getPropInfo(props[i]).displayValue;
      }
    }
  } catch {
    // A node whose property projection throws must not break the edit itself.
  }
  return fallback;
}

function editProperty(
  nodeId: string,
  propertyName: string,
  newValue: unknown,
  oldValue?: unknown,
): true | false | { error: boolean; reason: string; invalidValue: string; validValue: string } {
  const activeNode = getActiveNode();
  if (!activeNode || activeNode.id !== nodeId) {
    return false;
  }
  if ('__isAllNode' in activeNode) {
    return false;
  }
  const node = activeNode as INode;
  if (!node.setProperty) {
    return false;
  }

  // Capture the pre-edit value so undo can restore it even when the caller omits
  // `oldValue`. The parameter is optional, and README's own example omits it, so
  // trusting it meant undo called setProperty(prop, undefined) — destroying the
  // prior value instead of restoring it, with redo unable to bring it back either.
  // Read through getPropInfo (the same path the property inspector displays) so the
  // captured value is in the shape setProperty round-trips; fall back to the passed
  // `oldValue` if this node does not project the property.
  const priorValue = readPropertyValue(node, propertyName, oldValue);

  const result = node.setProperty(propertyName, newValue);
  if (result !== true) {
    return (result as { error: boolean; reason: string; invalidValue: string; validValue: string }) || false;
  }

  const slddNode = getActiveSlddNode();
  const kind = propertyName === 'Name' ? 'rename' : 'property';
  if (slddNode) {
    const cmd = {
      execute() {
        node.setProperty!(propertyName, newValue);
        publish('node/edited', { source: 'undo', nodeId: node.id, kind });
        if (kind === 'rename') {
          publishActiveChanged();
        }
        publish('node/children-changed', { parent: node });
      },
      undo() {
        node.setProperty!(propertyName, priorValue);
        publish('node/edited', { source: 'undo', nodeId: node.id, kind });
        if (kind === 'rename') {
          publishActiveChanged();
        }
        publish('node/children-changed', { parent: node });
      },
    };
    UndoManager.pushExecuted(slddNode.name, cmd);
  }

  publish('node/edited', { source: 'pi', nodeId: node.id, kind });
  if (kind === 'rename') {
    publishActiveChanged();
  }
  publish('node/children-changed', { parent: node });
  return true;
}

function addEntry(sectionKey: string, className: string, entryName?: string): INode | null {
  const slddNode = getActiveSlddNode();
  if (!slddNode) {
    return null;
  }

  let section: IContainerNode | null = slddNode.getSection(sectionKey);
  if (!section) {
    // When at root (sectionKey='sldd'), find the section that accepts this className
    for (const child of slddNode.children) {
      const sec = child as IContainerNode;
      if (sec.getAllowedTypes && sec.getAllowedTypes().includes(className)) {
        section = sec;
        break;
      }
    }
    if (!section) {
      return null;
    }
  }

  if (!section.execAddEntry) {
    return null;
  }
  const result = section.execAddEntry(className, entryName);
  if (!result) {
    return null;
  }

  const srcId = slddNode.name;
  const node = result.node;
  const sectionRef = section;
  UndoManager.pushExecuted(srcId, {
    execute() {
      result.redo();
      nodeIndex.set(node.id, node);
      setActiveEntry(node);
      publish('node/added', { node, sectionKey: sectionRef.name });
    },
    undo() {
      result.undo();
      nodeIndex.delete(node.id);
      setActiveEntry(null);
      publish('node/deleted', { node, section: sectionRef });
    },
  });

  nodeIndex.set(node.id, node);
  publish('node/added', { node, sectionKey: section.name });
  setActiveEntry(node);
  return node;
}

function addChild(): INode | null {
  const node = entryNodes.length === 1 ? entryNodes[0] : null;
  if (!node) {
    return null;
  }
  if (!node.execAddChild) {
    return null;
  }

  const rawResult = node.execAddChild();
  if (!rawResult) {
    return null;
  }
  const result = rawResult as { node: INode; undo: () => void; redo: () => void };

  const slddNode = getActiveSlddNode();
  const child = result.node;
  if (slddNode) {
    UndoManager.pushExecuted(slddNode.name, {
      execute() {
        result.redo();
        nodeIndex.set(child.id, child);
        setActiveEntry(child);
        publish('node/children-changed', { parent: node });
      },
      undo() {
        result.undo();
        nodeIndex.delete(child.id);
        setActiveEntry(node);
        publish('node/children-changed', { parent: node });
      },
    });
  }

  nodeIndex.set(child.id, child);
  publish('node/children-changed', { parent: node });
  return child;
}

function deleteNode(): boolean {
  const nodes = getEntryNodes();
  if (nodes.length === 0) {
    return false;
  }

  const slddNode = getActiveSlddNode();
  if (!slddNode) {
    return false;
  }

  if (nodes.length === 1) {
    const node = nodes[0];
    if (node.isEntry) {
      const section = node.parent as IContainerNode;
      if (!section || !section.execRemoveEntry) {
        return false;
      }
      const nodeId = node.id;
      const result = section.execRemoveEntry(node);
      if (!result) {
        return false;
      }
      UndoManager.pushExecuted(slddNode.name, {
        execute() {
          const currentId = node.id;
          result.redo();
          nodeIndex.delete(currentId);
          setActiveEntry(null);
          publish('node/deleted', { node, section });
        },
        undo() {
          result.undo();
          nodeIndex.set(node.id, node);
          setActiveEntry(node);
          publish('node/added', { node, sectionKey: section.name });
        },
      });
      nodeIndex.delete(nodeId);
      setActiveEntry(null);
      publish('node/deleted', { node, section });
    } else {
      const parent = node.parent;
      if (!parent || !parent.execRemoveChild) {
        return false;
      }
      const nodeId = node.id;
      const rawResult = parent.execRemoveChild(node);
      if (!rawResult) {
        return false;
      }
      const result = rawResult as { undo: () => void; redo: () => void };
      UndoManager.pushExecuted(slddNode.name, {
        execute() {
          const currentId = node.id;
          result.redo();
          nodeIndex.delete(currentId);
          setActiveEntry(parent);
          publish('node/children-changed', { parent });
        },
        undo() {
          result.undo();
          nodeIndex.set(node.id, node);
          setActiveEntry(node);
          publish('node/children-changed', { parent });
        },
      });
      nodeIndex.delete(nodeId);
      setActiveEntry(parent);
      publish('node/children-changed', { parent });
    }
  } else {
    const undoInfo: {
      node: INode;
      nodeId: string;
      section: IContainerNode;
      result: { undo: () => void; redo: () => void };
    }[] = [];
    for (const node of nodes) {
      if (!node.isEntry) continue;
      const section = node.parent as IContainerNode;
      if (!section || !section.execRemoveEntry) continue;
      const nodeId = node.id;
      const result = section.execRemoveEntry(node);
      if (result) {
        undoInfo.push({ node, nodeId, section, result });
      }
    }
    if (undoInfo.length === 0) {
      return false;
    }
    UndoManager.pushExecuted(slddNode.name, {
      execute() {
        for (const info of undoInfo) {
          const currentId = info.node.id;
          info.result.redo();
          nodeIndex.delete(currentId);
        }
        setActiveEntry(null);
        publish('node/deleted', { node: undoInfo[0].node, section: undoInfo[0].section });
      },
      undo() {
        for (let i = undoInfo.length - 1; i >= 0; i--) {
          undoInfo[i].result.undo();
          nodeIndex.set(undoInfo[i].node.id, undoInfo[i].node);
        }
        setActiveEntry(undoInfo.map((info) => info.node));
        publish('node/added', { node: undoInfo[0].node, sectionKey: undoInfo[0].section.name });
      },
    });
    for (const info of undoInfo) {
      nodeIndex.delete(info.nodeId);
    }
    setActiveEntry(null);
    publish('node/deleted', { node: undoInfo[0].node, section: undoInfo[0].section });
  }
  return true;
}

function undoAction(): void {
  const slddNode = getActiveSlddNode();
  if (!slddNode) {
    return;
  }
  UndoManager.undo(slddNode.name);
}

function redoAction(): void {
  const slddNode = getActiveSlddNode();
  if (!slddNode) {
    return;
  }
  UndoManager.redo(slddNode.name);
}

function canUndoActive(): boolean {
  const slddNode = getActiveSlddNode();
  return slddNode ? UndoManager.canUndo(slddNode.name) : false;
}

function canRedoActive(): boolean {
  const slddNode = getActiveSlddNode();
  return slddNode ? UndoManager.canRedo(slddNode.name) : false;
}

function setPreviewNode(node: INode | null): void {
  previewNode = node;
  publish('preview/changed');
}

function getPreviewNode(): INode | null {
  return previewNode;
}

function clearPreviewNode(): void {
  if (previewNode !== null) {
    previewNode = null;
    publish('preview/changed');
  }
}

// The editable source owning the context node. A `dirty` flag is what marks a
// root as an editable document, so a root without one (e.g. a read-only project)
// is reported as no active sldd.
function getActiveSlddNode(): ISourceNode | null {
  const root = ownerSourceOf(contextNode);
  if (!root) {
    return null;
  }
  return (root as IContainerNode).dirty !== undefined ? (root as ISourceNode) : null;
}

function getActiveSourceNode(): ISourceNode | null {
  return ownerSourceOf(contextNode) as ISourceNode | null;
}

  const session = {
    allNode,
    addDataSource,
    addParsedSource,
    addModelSource,
    addModelSourceParsed,
    addMatSource,
    addMatSourceParsed,
    addProjectSource,
    removeDataSource,
    removeAll,
    getDataSource,
    hasDataSource,
    getDataSourceIds,
    getDataSourceCount,
    isBatching,
    setActiveContext,
    setActiveEntry,
    setActive,
    getContextNode,
    getEntryNode,
    getEntryNodes,
    getActiveNode,
    getActiveSlddNode,
    getActiveSourceNode,
    setPreviewNode,
    getPreviewNode,
    clearPreviewNode,
    findNodeById,
    beginBatch,
    endBatch,
    editProperty,
    addEntry,
    addChild,
    deleteNode,
    undo: undoAction,
    redo: redoAction,
    canUndo: canUndoActive,
    canRedo: canRedoActive,
    bus,
  };
  return session;
}

export type Session = ReturnType<typeof createSession>;

const DataModel = createSession({ bus: defaultBus });

export default DataModel;
