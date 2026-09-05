import ContainerNode from '../ContainerNode.js';
import SectionNode from './SectionNode.js';
import type DataNode from '../DataNode.js';
import type { PropClass, PIGroupDef } from '../BaseNode.js';
import type { ParseWarning } from '../../parser/ParseWarning.js';
export interface SystemComposerCatalog {
    interfaces: Record<string, string>;
    modeledDataTypes: Record<string, string>;
}
export declare function classificationOf(catalog: SystemComposerCatalog | null | undefined, entryName: string): string | null;
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
    constructor(name: string);
    get displayName(): string;
    get icon(): string;
    get FileFormat(): string;
    get Release(): string;
    get NumberOfEntries(): number;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[];
    getSection(key: string): SectionNode | null;
    addEntry(className: string, entryName: string, sectionKey: string): DataNode | null;
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
    static parse(json: Record<string, unknown>, filename: string, warnings?: ParseWarning[]): SlddNode;
    static _parseSystemComposer(parts: Record<string, unknown> | null, warnings?: ParseWarning[]): SystemComposerCatalog | null;
    static getSectionKey(entry: Record<string, unknown>): string;
    serialize(): unknown;
    serializeJson(): Record<string, unknown>;
}
//# sourceMappingURL=SlddNode.d.ts.map