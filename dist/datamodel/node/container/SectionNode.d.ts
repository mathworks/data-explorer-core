import ContainerNode from '../ContainerNode.js';
import type { TableColumnConfig } from '../ContainerNode.js';
import type BaseNode from '../BaseNode.js';
import { type SourceOfferedEditor, type SourceSetResult } from '../BaseNode.js';
import type DataNode from '../DataNode.js';
import * as NodeRegistry from '../NodeRegistry.js';
import type { SystemComposerCatalog } from '../../parser/ScCatalog.js';
import { NS_DESIGN, NS_CONFIGURATIONS, NS_OTHER, SECTION_NAMESPACE } from '../../SectionConstants.js';
export { NS_DESIGN, NS_CONFIGURATIONS, NS_OTHER, SECTION_NAMESPACE };
interface NamespaceCounts {
    sections: SectionNode[];
    versions: number[];
    counts: Map<string, number>;
}
export declare function generateUuid(): string;
export default class SectionNode extends ContainerNode {
    label: string;
    iconId: string;
    _entriesVersion: number;
    constructor(name: string, parent: BaseNode | null, label: string, iconId: string);
    get icon(): string;
    get displayName(): string;
    get tableColumnConfig(): TableColumnConfig;
    getAllowedTypes(): string[];
    getAdmittedTypes(): string[];
    allowsType(className: string): boolean;
    _namespaceEntryNames(): string[];
    _offeredEditor(entry: BaseNode, node: BaseNode, key: string): SourceOfferedEditor | null;
    _setOffered(entry: BaseNode, node: BaseNode, key: string, text: string): SourceSetResult | null;
    _offeredRestorer(entry: BaseNode, node: BaseNode, key: string): (() => void) | null;
    _unofferedRefusal(entry: BaseNode, node: BaseNode, key: string): string | null;
    /**
     * Why `value`, a node built of the text an edit typed in for `node` (of `entry`), cannot be
     * written into this dictionary, or null where it can (MatlabVariableNode._refuseUnwritableValue,
     * as a MAT-file's _valueRefusal is asked): of a text dictionary, a numeric, logical or char empty
     * of another size than 0x0, whole or in a cell or a struct, which MATLAB's own text format reads
     * back as a 0x0 one (MatlabVariableNode._textDictionaryLostEmpty, the D15 ruling of the 2026-10-26
     * edit bash). A MAT stream it is written into keeps its size, and so does a binary dictionary.
     * Said of `path`, the node's own unless a Parameter names its Value.
     */
    _valueRefusal(entry: BaseNode, node: BaseNode, value: BaseNode, path?: string): string | null;
    _namespaceHolds(name: string): number;
    addChild(child: BaseNode, index?: number): BaseNode;
    removeChild(child: BaseNode): void;
    _entriesMoved(gone: string | null, came: string | null): void;
    _namespaceSections(): SectionNode[] | null;
    _heldCounts(): NamespaceCounts | null;
    _namespaceCounts(): Map<string, number> | null;
    _entryRenamed(oldName: string, newName: string): void;
    addEntry(className: string, entryName?: string): DataNode | null;
    /**
     * Why addEntry makes no entry of `className` here, named `entryName` or the class's default name,
     * in words naming the section, or null where it makes one: the session's addEntryRefusal.
     */
    entryRefusal(className: string, entryName?: string): string | null;
    _entryPlan(className: string, entryName?: string): {
        NodeClass: ReturnType<typeof NodeRegistry.getClass> & object;
        name: string;
    } | {
        why: string;
    };
    execAddEntry(className: string, entryName?: string): {
        node: DataNode;
        undo: () => void;
        redo: () => void;
    } | null;
    /** Why execRemoveEntry refuses `node`, as a clause, or null where it deletes it. */
    removeEntryRefusal(node: BaseNode): string | null;
    execRemoveEntry(node: BaseNode): {
        undo: () => void;
        redo: () => void;
    } | null;
    _uniqueName(baseName: string): string;
    _nameTaken(): (name: string) => boolean;
    parseEntry(rawEntry: Record<string, unknown>, systemComposer?: SystemComposerCatalog | null, options?: {
        asRead?: boolean;
    }): DataNode;
    _namesCatalog(): boolean;
    _readEntry(rawEntry: Record<string, unknown>, systemComposer?: SystemComposerCatalog | null): DataNode;
}
//# sourceMappingURL=SectionNode.d.ts.map