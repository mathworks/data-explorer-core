// Copyright 2026 The MathWorks, Inc.
import ContainerNode from '../ContainerNode.js';
import SectionNode from './SectionNode.js';
import { getSectionKey as _getSectionKey } from '../../SectionConstants.js';
import PropName from '../../prop/PropName.js';
import PropRelease from '../../prop/PropRelease.js';
import PropFileFormat from '../../prop/PropFileFormat.js';
import PropNumberOfEntries from '../../prop/PropNumberOfEntries.js';
import { slddChunkContent } from '../../parser/SlddContent.js';
import { SC_PART, scPartUnreadableMessage } from '../../parser/ScCatalog.js';
import { DATA_PART_KEY, TEXT_CONTENT, TEXT_PARTS } from '../../parser/SlddParts.js';
const SECTION_DEFS = [
    { key: 'design', label: 'Design Data', icon: 'databaseFolderDesign' },
    { key: 'arch', label: 'Architectural Data', icon: 'databaseFolderArchitecture' },
    { key: 'config', label: 'Configurations', icon: 'databaseFolderConfiguration' },
    { key: 'other', label: 'Other Data', icon: 'databaseFolder' }
];
// The catalog vocabulary — the part path, the type map, the classification rule —
// lives in the parser module both dictionary formats read it through (ScCatalog), so
// a textual and a compressed-binary dictionary cannot classify the same entry
// differently.
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
    static parse(json, filename, warnings) {
        const node = new SlddNode(filename);
        node.coreProperties = json.__MW_TEXT_COREPROPERTIES__ || null;
        if (json.__rawXml) {
            node.sourceFormat = 'xml';
            node.rawXml = json.__rawXml;
            node._zipMetadata = json.__zipMetadata || null;
            node._dataSourceAttrs = json.__dataSourceAttrs || null;
        }
        // `TEXT_PARTS`, not the literal: `serializeJson` below WRITES this bag through the
        // constant, and a reader in the same file spelling it by hand is the two-copies-of-
        // one-name shape SlddParts exists to close. A drift here would not empty the
        // dictionary — the entries arrive through `slddChunkContent` — it would drop only
        // the System Composer catalog, and drop it QUIETLY: a bag that is not there looks
        // exactly like a dictionary with no catalog part, which _parseSystemComposer is
        // deliberately silent about. That is the degrade its own comment below calls the
        // nastiest partial in this reader.
        const parts = json[TEXT_PARTS];
        // The shared unwrap (SlddContent), not a local one: the same three-level path is what
        // the usage index reads a dictionary's entries through, and a second copy here is a
        // second chance for one of them to look in the wrong place and report an empty file.
        const content = slddChunkContent(json);
        // Parse the systemcomposer catalog first so entry parsing can use it to
        // classify architectural entries (e.g. StructType vs DataInterface).
        //
        // A compressed-binary dictionary arrives with the catalog already read: its
        // interface dictionary is a zipped XML member, which the binary reader is the
        // only layer holding the bytes of, so it scans it and hands the finished catalog
        // over on `__scCatalog`. The textual flavour has no parser between the bytes and
        // here, so its catalog is read out of the parts below.
        node.systemComposer = json.__scCatalog
            ?? SlddNode._parseSystemComposer(parts, warnings);
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
        else {
            // VERBATIM, and `unknown[]` on purpose: a reference is a bare string in a
            // compressed dictionary and can be a `{ file: ... }` object in a textual one, and
            // serializeJson writes this array straight back out on save. Normalising here
            // would turn a display fix into a data loss — whatever else the object carried
            // would be gone from the saved file. Readers that need names call
            // SlddContent.normalizeRefNames, which is why that is a read-time step.
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
    static _parseSystemComposer(parts, warnings) {
        const part = parts && parts[`__MW_TEXT_PART__/${SC_PART}`];
        const content = part && part[TEXT_CONTENT];
        const entries = content && content.entries;
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
                    message: scPartUnreadableMessage(SC_PART),
                    part: SC_PART,
                });
            }
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
            [TEXT_PARTS]: {
                [DATA_PART_KEY]: {
                    [TEXT_CONTENT]: {
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