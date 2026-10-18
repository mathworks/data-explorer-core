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
import { slddChunkContent } from '../../parser/SlddContent.js';
import type { ParseWarning } from '../../parser/ParseWarning.js';
import type { SystemComposerCatalog } from '../../parser/ScCatalog.js';
import { SC_PART, emptyCatalogBag, untypedDefinitions } from '../../parser/ScCatalog.js';
import { DATA_PART_KEY, TEXT_CONTENT, TEXT_PARTS } from '../../parser/SlddParts.js';
import { takeDecodeFailures, takePartialDecodes } from '../../parser/EncodedValue.js';
import { takeUnheldIntegers, unheldIntegerWarning } from '../data/integerReading.js';
import { takeUnwrittenSpellings, unwrittenSpellingWarning } from '../../parser/writtenSpelling.js';
import { heldByTextDictionary } from '../../parser/MatWriter.js';
import { attachChunkFrame, attachEntrySource, readFrameOf, readSourceOf } from '../../parser/EntrySource.js';

const SECTION_DEFS = [
    { key: 'design', label: 'Design Data', icon: 'databaseFolderDesign' },
    { key: 'arch', label: 'Architectural Data', icon: 'databaseFolderArchitecture' },
    { key: 'config', label: 'Configurations', icon: 'databaseFolderConfiguration' },
    { key: 'other', label: 'Other Data', icon: 'databaseFolder' }
];

// A textual dictionary as read, around the one part a save rebuilds: the text twin of
// `_zipMetadata`. MATLAB writes every part of a textual `.sldd` as a key of the parts bag —
// the data part, and beside it the System Composer interface dictionary and the
// ArchitecturePart — and a save that wrote back only the data part left a file whose struct
// types reopened as data interfaces, here and in MATLAB, which does not regenerate the part.
//
// Each level is a shallow copy of the object read, with the slot the save rebuilds set to
// null: the save spreads it, so every key keeps its place and its value as read, and what
// is kept does not hold on to the entries the file listed, which the nodes now stand for.
interface TextParts {
    top: Record<string, unknown>;
    parts: Record<string, unknown> | null;
    dataPart: Record<string, unknown> | null;
    content: Record<string, unknown> | null;
}

// The object at `key`, if it is one, so a part of the wrong shape is written back as read
// rather than spread into.
function objectAt(bag: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
    const value = bag ? bag[key] : undefined;
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

// The textual dictionary around its data part, as `TextParts` says. `slddChunkContent`'s
// path, one level at a time, so the slots kept are the ones the entries were read from.
function readTextParts(json: Record<string, unknown>): TextParts {
    const parts = objectAt(json, TEXT_PARTS);
    const dataPart = objectAt(parts, DATA_PART_KEY);
    const content = objectAt(dataPart, TEXT_CONTENT);
    const without = (bag: Record<string, unknown> | null, key: string): Record<string, unknown> | null =>
        bag && { ...bag, [key]: null };
    return {
        top: without(json, TEXT_PARTS) as Record<string, unknown>,
        parts: parts && dataPart ? without(parts, DATA_PART_KEY) : parts,
        dataPart: dataPart && content ? without(dataPart, TEXT_CONTENT) : dataPart,
        content: content && { ...content, entries: null },
    };
}

// The catalog vocabulary — the part path, the type map, the classification rule —
// lives in the parser module both dictionary formats read it through (ScCatalog), so
// a textual and a compressed-binary dictionary cannot classify the same entry
// differently.

export default class SlddNode extends ContainerNode {
    coreProperties: Record<string, unknown> | null;
    dictionaryReferences: unknown[];
    allowAccessBWS: boolean;
    dirty: boolean;
    sourceFormat: string;
    rawXml: string | null;
    _zipMetadata: Record<string, unknown> | null;
    _textParts: TextParts | null;
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
        this._textParts = null;
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

        // The frame the binary reader verified, if this is the very content object it
        // returned: what lets a save write each unedited entry back as the bytes it was
        // read from (parser/EntrySource). A copy of the content carries none, and is
        // regenerated whole, as it always was.
        const frame = readFrameOf(json);
        // Whether the binary reader wrote the content, by the part it always writes, and not by
        // whether that part has any text: a package whose data/chunk0.xml is empty used to be
        // taken for a text dictionary, and saved as one, with no package bytes at all.
        if (typeof json.__rawXml === 'string') {
            node.sourceFormat = 'xml';
            node.rawXml = json.__rawXml as string;
            node._zipMetadata = (json.__zipMetadata as Record<string, unknown>) || null;
            node._dataSourceAttrs = (json.__dataSourceAttrs as Record<string, string>) || null;
            if (frame && frame.xml === node.rawXml) {
                attachChunkFrame(node, frame);
            }
        } else {
            node._textParts = readTextParts(json);
        }

        // `TEXT_PARTS`, not the literal: `serializeJson` below WRITES this bag through the
        // constant, and a reader in the same file spelling it by hand is the two-copies-of-
        // one-name shape SlddParts exists to close. A drift here would not empty the
        // dictionary — the entries arrive through `slddChunkContent` — it would drop only
        // the System Composer catalog, and drop it QUIETLY, since a bag that is not there is
        // indistinguishable from a dictionary with no catalog part and nothing warns about
        // either. What that costs is one Kind on one class (a struct type reads as a data
        // interface), so the drift is worth naming here even though it is not worth a banner.
        const parts = json[TEXT_PARTS] as Record<string, unknown>;
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
        node.systemComposer = (json.__scCatalog as SystemComposerCatalog | undefined)
            ?? SlddNode._parseSystemComposer(parts);
        // A definition the catalog lists with no type is shown as read (its entry's Kind
        // is its class's) and said once, here, for both flavours: one site is what keeps
        // the same damage saying the same thing however the dictionary was saved.
        for (const name of untypedDefinitions(node.systemComposer)) {
            warnings?.push({
                code: 'part-unreadable',
                message: `The System Composer definition "${name}" has no type, so its Kind is taken from `
                    + 'its Simulink class and may be wrong (a struct type reads as a Data Interface).',
                part: name,
            });
        }

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
        } else {
            // VERBATIM, and `unknown[]` on purpose: a reference is a bare string in a
            // compressed dictionary and can be a `{ file: ... }` object in a textual one, and
            // serializeJson writes this array straight back out on save. Normalising here
            // would turn a display fix into a data loss — whatever else the object carried
            // would be gone from the saved file. Readers that need names call
            // SlddContent.normalizeRefNames, which is why that is a read-time step.
            node.dictionaryReferences = (content['Dictionary References'] as unknown[]) || [];
            node.allowAccessBWS = (content.AllowAccessBWS as boolean) || false;

            const entries = (content.entries as Record<string, unknown>[]) || [];
            entries.forEach((entry) => {
                const sectionKey = SlddNode.getSectionKey(entry);
                const section = node.getSection(sectionKey);
                if (section) {
                    // An encoded value that is framed right and still does not decode is
                    // shown as not decoded and saved unchanged, and a text dictionary's MAT
                    // stream that does not decode is shown as its encoded text; the node
                    // layer that finds out records why, and this is the read that can say so
                    // (see EncodedValue.recordDecodeFailure). Taken before too, so that nothing
                    // recorded outside this read is reported against this entry. And one
                    // that decoded with an object in it read only in part is shown from what
                    // was read and says so, collected the same way (recordPartialDecode).
                    takeDecodeFailures();
                    takePartialDecodes();
                    // And a number its integer class cannot hold, which is shown as MATLAB
                    // reads it, converted (integerReading): one warning for the entry.
                    takeUnheldIntegers();
                    // And a typed literal spelled as MATLAB does not write one (writtenSpelling).
                    // A binary dictionary's reader warned about its own text already, and hands
                    // the node the value it shows, so this is a text dictionary's alone.
                    takeUnwrittenSpellings();
                    // A text dictionary's complex text is this file's own, which a save writes
                    // back as read where it has no stream to be instead
                    // (MatWriter.heldByTextDictionary). A binary dictionary's is not: the record
                    // is by object, so the value of a binary entry, handed to a text paste
                    // uncloned, passed for that text dictionary's own and was written as
                    // complex text where it is refused. Not walked on a binary read at all.
                    if (node.sourceFormat !== 'xml') {
                        heldByTextDictionary(entry.value);
                    }
                    // Here and not in _readEntry: this is the one read that has the bytes
                    // in hand. _readEntry is also how a pasted or restored RECORD becomes a
                    // node (through parseEntry), and a record has no bytes to claim. Asked
                    // before the node is built, of the entry as the host handed it over.
                    const source = readSourceOf(entry);
                    const entryNode = section._readEntry(entry, node.systemComposer);
                    if (source && frame && source.frame === frame && frame.xml === node.rawXml) {
                        attachEntrySource(entryNode, source);
                    }
                    for (const { reason, shownAs } of takeDecodeFailures()) {
                        warnings?.push({
                            code: 'part-unreadable',
                            message: `"${String(entry.name)}" holds a value stored encoded that could not be read, `
                                + `because ${reason}; it is shown as ${shownAs} and saved unchanged.`,
                            part: String(entry.name),
                        });
                    }
                    for (const message of takePartialDecodes()) {
                        warnings?.push({ code: 'part-unreadable', message, part: String(entry.name) });
                    }
                    const unheld = takeUnheldIntegers();
                    if (unheld) {
                        warnings?.push(unheldIntegerWarning(String(entry.name), unheld, node.sourceFormat !== 'xml'));
                    }
                    const unwritten = takeUnwrittenSpellings();
                    if (unwritten && node.sourceFormat !== 'xml') {
                        warnings?.push(unwrittenSpellingWarning(String(entry.name), unwritten));
                    }
                }
            });
        }

        return node;
    }

    // Extract the interface and modeled-data-type classifications from the
    // systemcomposer interface dictionary part, if present.
    static _parseSystemComposer(
        parts: Record<string, unknown> | null,
    ): SystemComposerCatalog | null {
        const part = parts && (parts[`__MW_TEXT_PART__/${SC_PART}`] as Record<string, unknown>);
        const content = part && (part[TEXT_CONTENT] as Record<string, unknown>);
        const entries = content && (content.entries as Record<string, unknown>[]);
        if (!entries) {
            // Both reasons for a null catalog stay quiet, and they are quiet on the SAME
            // terms — which is the point, because this used to warn where the binary reader
            // did not and the two flavours of one dictionary answered differently.
            //
            // A dictionary with no interfaceDictionary part is every `.sldd` that is not a
            // System Composer interface dictionary: the overwhelming majority. A part that
            // is present and holds nothing is a catalog with nothing in it — MATLAB writes
            // exactly that into any dictionary System Composer has merely touched, built-in
            // value types and no definitions. Neither one loses anything a reader could
            // report: see the note below `classificationOf` in ScCatalog for the
            // measurement, and `DERIVED_KIND_BY_CLASS` for the fallback it licenses.
            return null;
        }

        // Prototype-less, like the binary reader's: see `classificationOf`.
        const interfaces = emptyCatalogBag();
        const modeledDataTypes = emptyCatalogBag();

        const readName = (item: Record<string, unknown>): string => {
            const c = (item.content as Record<string, unknown>) || {};
            return (c.p_Name as string) || '';
        };
        // A type that is missing or not a string classifies nothing, and is recorded as
        // the empty string either way, which is what `untypedDefinitions` warns about.
        const readType = (item: Record<string, unknown>): string =>
            (typeof item.type === 'string' ? item.type : '');

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
                        interfaces[name] = readType(iface);
                    }
                });
            }

            // TypeCatalog: modeled data types (struct/numeric/enum/alias).
            const modeled = entryContent.p_ModeledDataTypes as Record<string, unknown>[] | undefined;
            if (modeled) {
                modeled.forEach((dt) => {
                    const name = readName(dt);
                    if (name) {
                        modeledDataTypes[name] = readType(dt);
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

        // A textual dictionary is written back as it was read, every part in its place,
        // with only the data part rebuilt (`TextParts`). One that was not read as text —
        // a binary package, or a dictionary made here — has nothing else to keep.
        const kept = this._textParts;
        return {
            ...kept?.top,
            __MW_TEXT_COREPROPERTIES__: this.coreProperties,
            [TEXT_PARTS]: {
                ...kept?.parts,
                [DATA_PART_KEY]: {
                    ...kept?.dataPart,
                    [TEXT_CONTENT]: {
                        ...kept?.content,
                        entries,
                        'Dictionary References': this.dictionaryReferences,
                        AllowAccessBWS: this.allowAccessBWS
                    }
                }
            }
        };
    }
}
