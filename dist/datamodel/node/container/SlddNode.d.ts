import ContainerNode from '../ContainerNode.js';
import SectionNode from './SectionNode.js';
import type DataNode from '../DataNode.js';
import type { PropClass, PIGroupDef } from '../BaseNode.js';
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
    static parse(json: Record<string, unknown>, filename: string): SlddNode;
    static _parseSystemComposer(parts: Record<string, unknown> | null): SystemComposerCatalog | null;
    static getSectionKey(entry: Record<string, unknown>): string;
    serialize(): unknown;
    serializeJson(): Record<string, unknown>;
}
//# sourceMappingURL=SlddNode.d.ts.map