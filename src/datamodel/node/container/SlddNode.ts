// Copyright 2026 The MathWorks, Inc.

import ContainerNode from '../ContainerNode.js';
import SectionNode from './SectionNode.js';
import { getSectionKey as _getSectionKey } from '../../SectionConstants.js';
import type DataNode from '../DataNode.js';
import type { PropClass, PIGroupDef } from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropRelease from '../../prop/PropRelease.js';
import PropFileFormat from '../../prop/PropFileFormat.js';
import PropNumberOfEntries from '../../prop/PropNumberOfEntries.js';
import type { ParseWarning } from '../../parser/ParseWarning.js';

const SECTION_DEFS = [
    { key: 'design', label: 'Design Data', icon: 'databaseFolderDesign' },
    { key: 'arch', label: 'Architectural Data', icon: 'databaseFolderArchitecture' },
    { key: 'config', label: 'Configurations', icon: 'databaseFolderConfiguration' },
    { key: 'other', label: 'Other Data', icon: 'databaseFolder' }
];

// The part path of the systemcomposer interface dictionary, named once because it is
// used three times now: to look the part up, and — when it is there and unreadable — in
// the message and in the `part` field of the warning that says so. A warning naming a
// different string from the one that was looked up would be a lie no reader could
// detect, and a `part` a host cannot match against the package is no better than none.
const SC_PART = 'simulink/systemcomposer/interfaceDictionary';

// The systemcomposer interface dictionary classifies architectural entries
// (which are stored as ordinary Simulink objects) into interface/type kinds.
// Captured at parse time so the rest of the model can distinguish, e.g., a
// StructType from a DataInterface (both are Simulink.Bus).
export interface SystemComposerCatalog {
    // Interface name -> systemcomposer type, from the PortInterfaceCatalog
    // (e.g. CompositeDataInterface, CompositePhysicalInterface, ServiceInterface,
    // ValueTypeInterface).
    interfaces: Record<string, string>;
    // Modeled data type name -> systemcomposer type, from the TypeCatalog
    // (e.g. StructDataType, NumericType, EnumDataType, AliasType).
    modeledDataTypes: Record<string, string>;
}

// Maps a systemcomposer type string to the semantic classification token that
// drives the entry's Kind. The token is derived from the type, not the entry
// name (which is user-chosen), so it stays correct regardless of the name.
const SC_TYPE_TO_CLASSIFICATION: Record<string, string> = {
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
export function classificationOf(catalog: SystemComposerCatalog | null | undefined, entryName: string): string | null {
    if (!catalog) {
        return null;
    }
    const scType = catalog.interfaces[entryName] || catalog.modeledDataTypes[entryName];
    return (scType && SC_TYPE_TO_CLASSIFICATION[scType]) || null;
}

export default class SlddNode extends ContainerNode {
    coreProperties: Record<string, unknown> | null;
    dictionaryReferences: unknown[];
    allowAccessBWS: boolean;
    dirty: boolean;
    sourceFormat: string;
    rawXml: string | null;
    _zipMetadata: Record<string, unknown> | null;
    _dataSourceAttrs: Record<string, string> | null;
    systemComposer: SystemComposerCatalog | null;

    constructor(name: string) {
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

    get displayName(): string {
        return this.dirty ? this.name + ' *' : this.name;
    }

    get icon(): string {
        return this.sourceFormat === 'xml' ? 'simulink_server' : 'simulink_database';
    }

    get FileFormat(): string {
        return this.sourceFormat === 'xml' ? 'compressed-binary' : 'uncompressed-text';
    }

    get Release(): string {
        return (this.coreProperties && this.coreProperties.release as string) || '';
    }

    get NumberOfEntries(): number {
        let count = 0;
        this.children.forEach((section) => {
            count += section.children.length;
        });
        return count;
    }

    getProperties(): PropClass[] {
        return [PropName, PropRelease, PropFileFormat, PropNumberOfEntries];
    }

    getPILayout(): PIGroupDef[] {
        return [
            { group: 'General', items: [PropName, PropRelease, PropFileFormat, PropNumberOfEntries] }
        ];
    }

    getSection(key: string): SectionNode | null {
        return (this.children.find((c) => c.name === key) as SectionNode) || null;
    }

    addEntry(className: string, entryName: string, sectionKey: string): DataNode | null {
        const section = this.getSection(sectionKey);
        if (!section) {
            return null;
        }
        return section.addEntry(className, entryName);
    }

    /**
     * Build a dictionary tree out of dictionary content.
     *
     * This is the whole reader for an uncompressed-text `.sldd`: there is no parser
     * between the bytes and here, because `ingest` calls `JSON.parse` and hands the
     * result straight over. So this method is where a textual dictionary's diagnostics
     * have to be raised, and `warnings` — the same optional sink `parseBinarySldd`
     * takes, appended to rather than replaced — is how they get out. For a binary
     * dictionary the caller passes the array the parser already filled in, so one file
     * reports through one list no matter which flavour it arrived in.
     */
    static parse(json: Record<string, unknown>, filename: string, warnings?: ParseWarning[]): SlddNode {
        const node = new SlddNode(filename);
        node.coreProperties = (json.__MW_TEXT_COREPROPERTIES__ as Record<string, unknown>) || null;

        if (json.__rawXml) {
            node.sourceFormat = 'xml';
            node.rawXml = json.__rawXml as string;
            node._zipMetadata = (json.__zipMetadata as Record<string, unknown>) || null;
            node._dataSourceAttrs = (json.__dataSourceAttrs as Record<string, string>) || null;
        }

        const parts = json.__MW_TEXT_PARTS__ as Record<string, unknown>;
        const chunk = parts && (parts['__MW_TEXT_PART__/data/chunk0'] as Record<string, unknown>);
        const content = chunk && (chunk.__MW_TEXT_content as Record<string, unknown>);

        // Parse the systemcomposer catalog first so entry parsing can use it to
        // classify architectural entries (e.g. StructType vs DataInterface).
        node.systemComposer = SlddNode._parseSystemComposer(parts, warnings);

        if (!content) {
            // The four sections are built by the constructor, so a content-less dictionary
            // used to open as a perfectly ordinary tree with four empty sections and report
            // success — indistinguishable from a dictionary a user had just created. That is
            // the shape this item is about, and it is reachable from a JSON file that is
            // valid JSON and not a dictionary at all, and from a partial write that lost the
            // content part.
            //
            // It cannot double up with the binary reader's `source-unreadable` for a chunk
            // it could not read: that reader always builds the content part, with an empty
            // entry list inside it, so a damaged binary package arrives here with `content`
            // present and is reported once, by the layer that saw the bytes.
            //
            // `source-empty` rather than `source-unreadable`: what happened is that nothing
            // was found to read, not that something was found and refused. The filename is
            // in the message because this is a warning about the SOURCE and carries no
            // `part`, and a host showing it beside three other open files has to be able to
            // say which one it is about.
            //
            // The near-miss on the other side of this line is a dictionary whose content
            // part is there and whose `entries` is empty: MATLAB writes exactly that for a
            // dictionary a user created and has not filled in, and it is a COMPLETE file
            // read correctly, so it stays quiet. That is why the test is the part and not
            // the entry count.
            warnings?.push({
                code: 'source-empty',
                message: `"${filename}" holds no dictionary content part, so it reads as empty. `
                    + 'It may not be a data dictionary, or it may not have been written completely.',
            });
        }

        if (content) {
            node.dictionaryReferences = (content['Dictionary References'] as unknown[]) || [];
            node.allowAccessBWS = (content.AllowAccessBWS as boolean) || false;

            const entries = (content.entries as Record<string, unknown>[]) || [];
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
    static _parseSystemComposer(
        parts: Record<string, unknown> | null,
        warnings?: ParseWarning[],
    ): SystemComposerCatalog | null {
        const part = parts && (parts[`__MW_TEXT_PART__/${SC_PART}`] as Record<string, unknown>);
        const content = part && (part.__MW_TEXT_content as Record<string, unknown>);
        const entries = content && (content.entries as Record<string, unknown>[]);
        if (!entries) {
            // The two reasons for a null catalog are opposites, and only one of them is a
            // loss. A dictionary with no interfaceDictionary part is every `.sldd` that is
            // not a System Composer interface dictionary — the overwhelming majority, and
            // the limit of the file rather than of this reader — so it stays quiet.
            //
            // A part that is PRESENT and holds nothing readable is the file claiming the
            // catalog is there. Losing it silently is the nastiest partial in the dictionary
            // reader, because the tree still fills in: the catalog is what tells a StructType
            // from a DataInterface (both are `Simulink.Bus`), so without it every
            // architectural entry's Kind quietly degrades to its raw Simulink class. That is
            // a wrong answer that looks exactly like a right one, which is worse than a
            // missing one.
            //
            // `part-unreadable` with the part named, because the dictionary's entries are all
            // still read and this is one piece of it that is not.
            if (part) {
                warnings?.push({
                    code: 'part-unreadable',
                    message: `The dictionary part "${SC_PART}" holds nothing readable, so `
                        + 'architectural entries are reported by their Simulink class rather than '
                        + 'their System Composer type.',
                    part: SC_PART,
                });
            }
            return null;
        }

        const interfaces: Record<string, string> = {};
        const modeledDataTypes: Record<string, string> = {};

        const readName = (item: Record<string, unknown>): string => {
            const c = (item.content as Record<string, unknown>) || {};
            return (c.p_Name as string) || '';
        };

        entries.forEach((entry) => {
            const entryContent = (entry.content as Record<string, unknown>) || {};

            // PortInterfaceCatalog: named interfaces (data/physical/service/value).
            const catalog = entryContent.p_PortInterfaceCatalog as Record<string, unknown> | undefined;
            const catalogContent = catalog && (catalog.content as Record<string, unknown>);
            const ifaceList = catalogContent && (catalogContent.p_Interfaces as Record<string, unknown>[]);
            if (ifaceList) {
                ifaceList.forEach((iface) => {
                    const name = readName(iface);
                    if (name) {
                        interfaces[name] = (iface.type as string) || '';
                    }
                });
            }

            // TypeCatalog: modeled data types (struct/numeric/enum/alias).
            const modeled = entryContent.p_ModeledDataTypes as Record<string, unknown>[] | undefined;
            if (modeled) {
                modeled.forEach((dt) => {
                    const name = readName(dt);
                    if (name) {
                        modeledDataTypes[name] = (dt.type as string) || '';
                    }
                });
            }
        });

        return { interfaces, modeledDataTypes };
    }

    static getSectionKey(entry: Record<string, unknown>): string {
        const meta = (entry.metadata as Record<string, unknown>) || {};
        return _getSectionKey(meta);
    }

    serialize(): unknown {
        // Binary format handled by BinarySlddSerializer (called externally)
        return this.serializeJson();
    }

    serializeJson(): Record<string, unknown> {
        const entries: unknown[] = [];
        this.children.forEach((section) => {
            section.children.forEach((entryNode) => {
                entries.push((entryNode as DataNode).serialize());
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
