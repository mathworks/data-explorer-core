// Copyright 2026 The MathWorks, Inc.
import ContainerNode from '../ContainerNode.js';
import SectionNode from './SectionNode.js';
import { getSectionKey as _getSectionKey } from '../../SectionConstants.js';
import PropName from '../../prop/PropName.js';
import PropRelease from '../../prop/PropRelease.js';
import PropFileFormat from '../../prop/PropFileFormat.js';
import PropNumberOfEntries from '../../prop/PropNumberOfEntries.js';
const SECTION_DEFS = [
    { key: 'design', label: 'Design Data', icon: 'databaseFolderDesign' },
    { key: 'arch', label: 'Architectural Data', icon: 'databaseFolderArchitecture' },
    { key: 'config', label: 'Configurations', icon: 'databaseFolderConfiguration' },
    { key: 'other', label: 'Other Data', icon: 'databaseFolder' }
];
// Maps a systemcomposer type string to the semantic classification token that
// drives the entry's Kind. The token is derived from the type, not the entry
// name (which is user-chosen), so it stays correct regardless of the name.
const SC_TYPE_TO_CLASSIFICATION = {
    'systemcomposer.architecture.model.interface.CompositeDataInterface': 'DataInterface',
    'systemcomposer.architecture.model.interface.CompositePhysicalInterface': 'PhysicalInterface',
    'systemcomposer.architecture.model.swarch.ServiceInterface': 'ServiceInterface',
    'systemcomposer.architecture.model.interface.ValueTypeInterface': 'ValueType',
    'systemcomposer.property.StructDataType': 'StructType',
    'systemcomposer.property.NumericType': 'NumericType',
    'systemcomposer.property.EnumDataType': 'EnumType',
    'systemcomposer.property.AliasType': 'AliasType',
};
// Resolve the classification token (e.g. 'DataInterface', 'StructType') for an
// entry name, or null if the catalog doesn't classify it. Interfaces are checked
// before modeled data types.
export function classificationOf(catalog, entryName) {
    if (!catalog) {
        return null;
    }
    const scType = catalog.interfaces[entryName] || catalog.modeledDataTypes[entryName];
    return (scType && SC_TYPE_TO_CLASSIFICATION[scType]) || null;
}
export default class SlddNode extends ContainerNode {
    constructor(name) {
        super(name, null);
        this.coreProperties = null;
        this.dictionaryReferences = [];
        this.allowAccessBWS = false;
        this.dirty = false;
        this.sourceFormat = 'json';
        this.rawXml = null;
        this._zipMetadata = null;
        this._dataSourceAttrs = null;
        this.systemComposer = null;
        SECTION_DEFS.forEach((def) => {
            this.addChild(new SectionNode(def.key, this, def.label, def.icon));
        });
    }
    get displayName() {
        return this.dirty ? this.name + ' *' : this.name;
    }
    get icon() {
        return this.sourceFormat === 'xml' ? 'simulink_server' : 'simulink_database';
    }
    get FileFormat() {
        return this.sourceFormat === 'xml' ? 'compressed-binary' : 'uncompressed-text';
    }
    get Release() {
        return (this.coreProperties && this.coreProperties.release) || '';
    }
    get NumberOfEntries() {
        let count = 0;
        this.children.forEach((section) => {
            count += section.children.length;
        });
        return count;
    }
    getProperties() {
        return [PropName, PropRelease, PropFileFormat, PropNumberOfEntries];
    }
    getPILayout() {
        return [
            { group: 'General', items: [PropName, PropRelease, PropFileFormat, PropNumberOfEntries] }
        ];
    }
    getSection(key) {
        return this.children.find((c) => c.name === key) || null;
    }
    addEntry(className, entryName, sectionKey) {
        const section = this.getSection(sectionKey);
        if (!section) {
            return null;
        }
        return section.addEntry(className, entryName);
    }
    static parse(json, filename) {
        const node = new SlddNode(filename);
        node.coreProperties = json.__MW_TEXT_COREPROPERTIES__ || null;
        if (json.__rawXml) {
            node.sourceFormat = 'xml';
            node.rawXml = json.__rawXml;
            node._zipMetadata = json.__zipMetadata || null;
            node._dataSourceAttrs = json.__dataSourceAttrs || null;
        }
        const parts = json.__MW_TEXT_PARTS__;
        const chunk = parts && parts['__MW_TEXT_PART__/data/chunk0'];
        const content = chunk && chunk.__MW_TEXT_content;
        // Parse the systemcomposer catalog first so entry parsing can use it to
        // classify architectural entries (e.g. StructType vs DataInterface).
        node.systemComposer = SlddNode._parseSystemComposer(parts);
        if (content) {
            node.dictionaryReferences = content['Dictionary References'] || [];
            node.allowAccessBWS = content.AllowAccessBWS || false;
            const entries = content.entries || [];
            entries.forEach((entry) => {
                const sectionKey = SlddNode.getSectionKey(entry);
                const section = node.getSection(sectionKey);
                if (section) {
                    section.parseEntry(entry, node.systemComposer);
                }
            });
        }
        return node;
    }
    // Extract the interface and modeled-data-type classifications from the
    // systemcomposer interface dictionary part, if present.
    static _parseSystemComposer(parts) {
        const part = parts && parts['__MW_TEXT_PART__/simulink/systemcomposer/interfaceDictionary'];
        const content = part && part.__MW_TEXT_content;
        const entries = content && content.entries;
        if (!entries) {
            return null;
        }
        const interfaces = {};
        const modeledDataTypes = {};
        const readName = (item) => {
            const c = item.content || {};
            return c.p_Name || '';
        };
        entries.forEach((entry) => {
            const entryContent = entry.content || {};
            // PortInterfaceCatalog: named interfaces (data/physical/service/value).
            const catalog = entryContent.p_PortInterfaceCatalog;
            const catalogContent = catalog && catalog.content;
            const ifaceList = catalogContent && catalogContent.p_Interfaces;
            if (ifaceList) {
                ifaceList.forEach((iface) => {
                    const name = readName(iface);
                    if (name) {
                        interfaces[name] = iface.type || '';
                    }
                });
            }
            // TypeCatalog: modeled data types (struct/numeric/enum/alias).
            const modeled = entryContent.p_ModeledDataTypes;
            if (modeled) {
                modeled.forEach((dt) => {
                    const name = readName(dt);
                    if (name) {
                        modeledDataTypes[name] = dt.type || '';
                    }
                });
            }
        });
        return { interfaces, modeledDataTypes };
    }
    static getSectionKey(entry) {
        const meta = entry.metadata || {};
        return _getSectionKey(meta);
    }
    serialize() {
        // Binary format handled by BinarySlddSerializer (called externally)
        return this.serializeJson();
    }
    serializeJson() {
        const entries = [];
        this.children.forEach((section) => {
            section.children.forEach((entryNode) => {
                entries.push(entryNode.serialize());
            });
        });
        return {
            __MW_TEXT_COREPROPERTIES__: this.coreProperties,
            __MW_TEXT_PARTS__: {
                '__MW_TEXT_PART__/data/chunk0': {
                    __MW_TEXT_content: {
                        entries,
                        'Dictionary References': this.dictionaryReferences,
                        AllowAccessBWS: this.allowAccessBWS
                    }
                }
            }
        };
    }
}
//# sourceMappingURL=SlddNode.js.map