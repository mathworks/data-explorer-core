// Copyright 2026 The MathWorks, Inc.
import { defaultBus, createEventBus } from './EventBus.js';
import { createUndoManager } from './UndoManager.js';
import SlddNode from '../datamodel/node/container/SlddNode.js';
import ModelNode from '../datamodel/node/container/ModelNode.js';
import MatNode from '../datamodel/node/container/MatNode.js';
import ProjectNode from '../datamodel/node/container/ProjectNode.js';
import { parseSlx } from '../datamodel/parser/SlxParser.js';
import { parseMat } from '../datamodel/parser/MatParser.js';
import { parseProject } from '../datamodel/parser/ProjectParser.js';
export function createSession(opts = {}) {
    const bus = opts.bus ?? createEventBus();
    const UndoManager = createUndoManager(bus);
    const { publish, subscribe } = bus;
    const allNode = {
        __isAllNode: true,
        isContainer: true,
        name: '__all__',
        displayName: 'Root',
        icon: 'abstractClass',
        parent: null,
        id: '__all__',
    };
    const dataSources = new Map();
    const nodeIndex = new Map();
    let contextNode = null;
    let entryNodes = [];
    let previewNode = null;
    let batchDepth = 0;
    function buildMeta(meta) {
        return {
            path: (meta && meta.path) || '',
            lastModified: (meta && meta.lastModified) || null,
            size: (meta && meta.size) || 0,
            fileHandle: (meta && meta.fileHandle) || null,
        };
    }
    function registerSource(srcId, sourceNode, meta) {
        sourceNode.meta = buildMeta(meta);
        dataSources.set(srcId, sourceNode);
        indexSource(sourceNode);
        publish('datamodel/source-added', { srcId, slddNode: sourceNode });
        return sourceNode;
    }
    function indexSource(source) {
        const flat = source.flatten();
        for (let i = 0; i < flat.length; i++) {
            nodeIndex.set(flat[i].id, flat[i]);
        }
    }
    function deindexSource(source) {
        const flat = source.flatten();
        for (let i = 0; i < flat.length; i++) {
            nodeIndex.delete(flat[i].id);
        }
    }
    function beginBatch() {
        batchDepth++;
    }
    function endBatch() {
        if (batchDepth > 0) {
            batchDepth--;
        }
        if (batchDepth === 0) {
            publish('active/changed');
        }
    }
    function publishActiveChanged() {
        if (batchDepth === 0) {
            publish('active/changed');
        }
    }
    function setActiveContext(node) {
        contextNode = node;
        entryNodes = [];
        publishActiveChanged();
    }
    function setActiveEntry(nodes) {
        if (nodes === null) {
            entryNodes = [];
        }
        else if (Array.isArray(nodes)) {
            entryNodes = nodes;
        }
        else {
            entryNodes = [nodes];
        }
        publishActiveChanged();
    }
    function setActive(context, entry) {
        contextNode = context;
        if (entry === null) {
            entryNodes = [];
        }
        else if (Array.isArray(entry)) {
            entryNodes = entry;
        }
        else {
            entryNodes = [entry];
        }
        publishActiveChanged();
    }
    function getContextNode() {
        return contextNode;
    }
    function getEntryNode() {
        return entryNodes.length > 0 ? entryNodes[0] : null;
    }
    function getEntryNodes() {
        return entryNodes;
    }
    function getActiveNode() {
        return entryNodes.length > 0 ? entryNodes[0] : contextNode;
    }
    function addDataSource(srcId, content, meta) {
        const slddNode = SlddNode.parse(content, srcId);
        return registerSource(srcId, slddNode, meta);
    }
    function addParsedSource(srcId, slddNode, meta) {
        return registerSource(srcId, slddNode, meta);
    }
    function addModelSource(srcId, buffer, meta) {
        const parsed = parseSlx(buffer, srcId);
        const modelNode = ModelNode.fromParsed(parsed, srcId);
        return registerSource(srcId, modelNode, meta);
    }
    function addMatSource(srcId, buffer, meta) {
        const parsed = parseMat(buffer);
        const matNode = MatNode.fromParsed(parsed, srcId);
        return registerSource(srcId, matNode, meta);
    }
    function addProjectSource(srcId, files, meta) {
        // Filename = basename of srcId (or meta.path) including .prj; display name drops it.
        const basename = ((meta && meta.path) || srcId).split(/[\\/]/).pop() || srcId;
        const name = basename.replace(/\.prj$/i, '');
        const parsed = parseProject(files, name);
        const projectNode = ProjectNode.fromParsed(parsed, basename);
        return registerSource(srcId, projectNode, meta);
    }
    function addModelSourceParsed(srcId, parsed, meta) {
        const modelNode = ModelNode.fromParsed(parsed, srcId);
        return registerSource(srcId, modelNode, meta);
    }
    function addMatSourceParsed(srcId, parsed, meta) {
        const matNode = MatNode.fromParsed(parsed, srcId);
        return registerSource(srcId, matNode, meta);
    }
    function removeDataSource(srcId) {
        const source = dataSources.get(srcId);
        if (!source) {
            return;
        }
        deindexSource(source);
        dataSources.delete(srcId);
        publish('datamodel/source-removed', { srcId });
    }
    function removeAll() {
        dataSources.clear();
        nodeIndex.clear();
        publish('datamodel/cleared');
    }
    function getDataSource(srcId) {
        return dataSources.get(srcId) || null;
    }
    function hasDataSource(srcId) {
        return dataSources.has(srcId);
    }
    function getDataSourceIds() {
        return Array.from(dataSources.keys());
    }
    function getDataSourceCount() {
        return dataSources.size;
    }
    function isBatching() {
        return batchDepth > 0;
    }
    function findNodeById(nodeId) {
        return nodeIndex.get(nodeId) || null;
    }
    function reindexAll() {
        nodeIndex.clear();
        dataSources.forEach((src) => indexSource(src));
    }
    subscribe('node/added', reindexAll);
    subscribe('node/deleted', reindexAll);
    subscribe('node/children-changed', reindexAll);
    // --- Mutation Actions ---
    function editProperty(nodeId, propertyName, newValue, oldValue) {
        const activeNode = getActiveNode();
        if (!activeNode || activeNode.id !== nodeId) {
            return false;
        }
        if ('__isAllNode' in activeNode) {
            return false;
        }
        const node = activeNode;
        if (!node.setProperty) {
            return false;
        }
        const result = node.setProperty(propertyName, newValue);
        if (result !== true) {
            return result || false;
        }
        const slddNode = getActiveSlddNode();
        const kind = propertyName === 'Name' ? 'rename' : 'property';
        if (slddNode) {
            const cmd = {
                execute() {
                    node.setProperty(propertyName, newValue);
                    publish('node/edited', { source: 'undo', nodeId: node.id, kind });
                    if (kind === 'rename') {
                        publishActiveChanged();
                    }
                    publish('node/children-changed', { parent: node });
                },
                undo() {
                    node.setProperty(propertyName, oldValue);
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
    function addEntry(sectionKey, className, entryName) {
        const slddNode = getActiveSlddNode();
        if (!slddNode) {
            return null;
        }
        let section = slddNode.getSection(sectionKey);
        if (!section) {
            // When at root (sectionKey='sldd'), find the section that accepts this className
            for (const child of slddNode.children) {
                const sec = child;
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
    function addChild() {
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
        const result = rawResult;
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
    function deleteNode() {
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
                const section = node.parent;
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
            }
            else {
                const parent = node.parent;
                if (!parent || !parent.execRemoveChild) {
                    return false;
                }
                const nodeId = node.id;
                const rawResult = parent.execRemoveChild(node);
                if (!rawResult) {
                    return false;
                }
                const result = rawResult;
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
        }
        else {
            const undoInfo = [];
            for (const node of nodes) {
                if (!node.isEntry)
                    continue;
                const section = node.parent;
                if (!section || !section.execRemoveEntry)
                    continue;
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
    function undoAction() {
        const slddNode = getActiveSlddNode();
        if (!slddNode) {
            return;
        }
        UndoManager.undo(slddNode.name);
    }
    function redoAction() {
        const slddNode = getActiveSlddNode();
        if (!slddNode) {
            return;
        }
        UndoManager.redo(slddNode.name);
    }
    function canUndoActive() {
        const slddNode = getActiveSlddNode();
        return slddNode ? UndoManager.canUndo(slddNode.name) : false;
    }
    function canRedoActive() {
        const slddNode = getActiveSlddNode();
        return slddNode ? UndoManager.canRedo(slddNode.name) : false;
    }
    function setPreviewNode(node) {
        previewNode = node;
        publish('preview/changed');
    }
    function getPreviewNode() {
        return previewNode;
    }
    function clearPreviewNode() {
        if (previewNode !== null) {
            previewNode = null;
            publish('preview/changed');
        }
    }
    function getActiveSlddNode() {
        if (!contextNode) {
            return null;
        }
        if ('__isAllNode' in contextNode && contextNode.__isAllNode) {
            return null;
        }
        let node = contextNode;
        while (node.parent) {
            node = node.parent;
        }
        return node.dirty !== undefined ? node : null;
    }
    function getActiveSourceNode() {
        if (!contextNode) {
            return null;
        }
        if ('__isAllNode' in contextNode && contextNode.__isAllNode) {
            return null;
        }
        let node = contextNode;
        while (node.parent) {
            node = node.parent;
        }
        return node;
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
const DataModel = createSession({ bus: defaultBus });
export default DataModel;
//# sourceMappingURL=DataModel.js.map