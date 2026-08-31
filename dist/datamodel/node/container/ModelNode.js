// Copyright 2026 The MathWorks, Inc.
import ContainerNode from '../ContainerNode.js';
import ModelSectionNode from './ModelSectionNode.js';
import MatlabVariableNode from '../data/MatlabVariableNode.js';
import { buildTypedNodeFromMcos } from '../data/mcosTypedNode.js';
import { decodeMcosBlob } from '../../parser/McosParser.js';
import PropName from '../../prop/PropName.js';
import PropRelease from '../../prop/PropRelease.js';
const SECTION_DEFS = [
    { key: 'blocks', label: 'Model Elements', icon: 'blocks' },
    { key: 'workspace', label: 'Model Workspace', icon: 'databaseFolderWorkspace' },
    { key: 'config', label: 'Configurations', icon: 'databaseFolderConfiguration' },
    { key: 'references', label: 'Model References', icon: 'modelReference' },
    { key: 'dataSources', label: 'External Data', icon: 'link_database' },
];
export default class ModelNode extends ContainerNode {
    constructor(name) {
        super(name, null);
        this.release = '';
        this.creator = '';
        this.lastModified = '';
        this.uuid = '';
        this.dataDictionary = null;
        this.rawContents = null;
        this.dirty = false;
        this.blockParamUsages = [];
        this._zipEntries = null;
        this._workspaceVars = null;
        SECTION_DEFS.forEach((def) => {
            this.addChild(new ModelSectionNode(def.key, this, def.label, def.icon));
        });
    }
    get tableColumnConfig() {
        return { columns: ['Name', 'Value', 'DataType', 'UsedBy'], labels: { DataType: 'Type', UsedBy: 'Usage' } };
    }
    get displayName() {
        return this.name;
    }
    get readOnly() {
        return true;
    }
    get icon() {
        return 'simulink';
    }
    get Release() {
        return this.release;
    }
    get NumberOfEntries() {
        let count = 0;
        this.children.forEach((section) => {
            count += section.children.length;
        });
        return count;
    }
    getProperties() {
        return [PropName, PropRelease];
    }
    getPILayout() {
        return [{ group: 'General', items: [PropName, PropRelease] }];
    }
    getSection(key) {
        return this.children.find((c) => c.name === key) || null;
    }
    serialize() {
        if (!this._zipEntries) {
            return {
                model: this.name,
                release: this.release,
                uuid: this.uuid,
                dataDictionary: this.dataDictionary || '(none)',
                modelReferences: this.getSection('references').children.map((c) => c.name),
                externalDataSources: this.getSection('dataSources').children.map((c) => c.name),
                configSets: this.getSection('config').children.map((c) => c.name),
                workspace: '... (' + this.getSection('workspace').children.length + ' entries)',
                archiveFiles: this.rawContents ? Object.keys(this.rawContents) : [],
            };
        }
        const entries = Object.assign({}, this._zipEntries);
        if (this._workspaceVars) {
            const wsSection = this.getSection('workspace');
            for (const child of wsSection.children) {
                const varChild = child;
                if (varChild._var && varChild._var._modified) {
                    const wsVar = this._workspaceVars.find((v) => v.name === child.name);
                    if (wsVar) {
                        wsVar.value = varChild._var.value;
                        wsVar.dimensions = varChild._var.dimensions;
                        wsVar._modified = true;
                    }
                }
            }
            // serializeMxArray is called externally when saving
        }
        return entries;
    }
    static fromParsed(parsed, filename) {
        const node = new ModelNode(filename);
        node.release = parsed.release;
        node.creator = parsed.creator;
        node.lastModified = parsed.lastModified;
        node.uuid = parsed.uuid;
        node.dataDictionary = parsed.dataDictionary;
        node.rawContents = parsed.rawContents || null;
        node._zipEntries = parsed.zipEntries || null;
        node._workspaceVars = parsed.workspace;
        node.blockParamUsages = parsed.blockParamUsages || [];
        // Populate blocks section from blockParamUsages
        if (parsed.blockParamUsages && parsed.blockParamUsages.length > 0) {
            const blocksSection = node.getSection('blocks');
            const blockMap = new Map();
            for (const usage of parsed.blockParamUsages) {
                if (!blockMap.has(usage.blockName)) {
                    blockMap.set(usage.blockName, { type: usage.blockType, usages: [] });
                }
                blockMap.get(usage.blockName).usages.push({
                    property: usage.paramProperty,
                    value: usage.paramValue,
                });
            }
            const paramSourceId = parsed.dataDictionary || null;
            for (const [blockName, info] of blockMap) {
                blocksSection.addBlockEntry(blockName, info.type, info.usages, filename, paramSourceId);
            }
        }
        // Populate workspace section with MCOS decoding
        const wsSection = node.getSection('workspace');
        const wsVars = parsed.workspace;
        const trailingElements = wsVars._trailingElements;
        const opaqueWsVars = wsVars.filter((v) => v.isOpaque && v.name);
        let mcosData = null;
        if (opaqueWsVars.length > 0 && trailingElements && trailingElements.length > 0) {
            mcosData = decodeMcosBlob(trailingElements[0], opaqueWsVars.map((v) => ({ name: v.name, className: v.className, rawBytes: v._rawBytes })));
        }
        for (const entry of wsVars) {
            if (entry.isOpaque) {
                // Unify on CLASS: any opaque Simulink object whose class the data model
                // knows (Parameter, Signal, LookupTable, NumericType, Bus, …) becomes the
                // SAME typed node the SLDD path builds. When the MCOS decoder resolved the
                // object's properties, they populate the node with real values (SLDD-
                // shaped); otherwise it is an empty shell. The class comes from the
                // variable's own metadata, so it works even for objects the decoder
                // could not resolve.
                const decoded = mcosData?.get(entry.name);
                const typed = buildTypedNodeFromMcos(entry.className, entry.name, wsSection, decoded?.properties, decoded?.elements, decoded?.dimensions);
                if (typed) {
                    wsSection.addChild(typed);
                    continue;
                }
                // No typed node for this class (e.g. Simulink.DataStore): keep the opaque
                // representation, enriched with decoded properties when available.
                if (decoded) {
                    wsSection.addChild(MatlabVariableNode.createFromMcosDecoded(entry, decoded, wsSection));
                    continue;
                }
            }
            wsSection.addWorkspaceEntry(entry);
        }
        // Populate config sets section
        const cfgSection = node.getSection('config');
        for (const cfg of parsed.configSets) {
            cfgSection.addConfigSetEntry(cfg);
        }
        // Populate model references section
        const refSection = node.getSection('references');
        for (const ref of parsed.modelReferences) {
            refSection.addReferenceEntry(ref);
        }
        // Populate external data sources section
        const dsSection = node.getSection('dataSources');
        if (parsed.dataDictionary) {
            dsSection.addDataSourceEntry(parsed.dataDictionary);
        }
        for (const path of parsed.externalDataSources) {
            dsSection.addDataSourceEntry(path);
        }
        return node;
    }
}
//# sourceMappingURL=ModelNode.js.map