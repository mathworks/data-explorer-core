// Copyright 2026 The MathWorks, Inc.
import ContainerNode from '../ContainerNode.js';
import ModelSectionNode from './ModelSectionNode.js';
import { decodeMcosObjects, modelOpaqueMcosVariable } from '../data/mcosTypedNode.js';
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
    // The format an out-of-process host is told this source is, since SourceDTO carries
    // this field and nothing else in the projection names the format. Three values rather
    // than one per extension, because a Simulink model on disk really comes in three
    // shapes and `.mdl` covers two of them: the classic single flat text file, and the
    // modern OPC package which is a zip of parts exactly as a `.slx` is. Derived, not
    // stored, for the reason ProjectNode gives: this cannot change once the file is read,
    // and a field could drift from the parse that set it.
    //
    // Read off the CONTENT first and the name only to separate the two package cases.
    // `_zipEntries` is non-null exactly when the file yielded OPC PARTS — a real zip's
    // entries for a `.slx`, or the parts decodeOpcTextPackage recovered from a modern
    // `.mdl`'s text framing, which MdlParser hands to the same parseModelParts — and null
    // only for the classic single flat text file. It is NOT "which parser ran": both
    // flavours of `.mdl` go through parseMdl. This is the same test `serialize()` below
    // already makes to decide whether it has an archive to summarize. A srcId with no
    // recognisable extension (an opaque host URI) therefore still answers 'slx' for a
    // package and 'mdl' for flat text rather than guessing from a name it lacks.
    //
    // One wrinkle, reported as what was READ rather than what the file was: a package
    // truncated before its first part survives falls through to the classic grammar
    // reader, which finds the compatibility stub a modern `.mdl` opens with, so this
    // answers 'mdl'. Nothing on the node distinguishes that case — both fields are null
    // on that path — and the `source-unreadable` warning the reader files is what tells a
    // host the file was more than the stub. Deriving a format from a warning would be
    // worse than understating one.
    // Note 'xml' is deliberately NOT used for the package cases even though the parts are
    // XML in older releases: that token means a compressed-binary dictionary elsewhere,
    // and a consumer switching on this field must not mistake a model for one.
    get sourceFormat() {
        if (!this._zipEntries) {
            return 'mdl';
        }
        return /\.mdl$/i.test(this.name) ? 'mdl-package' : 'slx';
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
        // An .slx model workspace keeps the MCOS blob in its own trailing-element list.
        const mcosData = decodeMcosObjects(trailingElements?.[0], wsVars);
        for (const entry of wsVars) {
            if (entry.isOpaque) {
                // `parsed.warnings` is the very array addModelSource hands to registerSource
                // after this returns, so a degrade appended here reaches the source node. It is
                // the same list the part readers wrote into: one list per file, whichever layer
                // the loss was found in.
                const mcosNode = modelOpaqueMcosVariable(entry, mcosData?.get(entry.name), wsSection, parsed.warnings);
                if (mcosNode) {
                    wsSection.addChild(mcosNode);
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
        const refExt = /\.mdl$/i.test(filename) ? '.mdl' : '.slx';
        for (const ref of parsed.modelReferences) {
            refSection.addReferenceEntry(ref, refExt);
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