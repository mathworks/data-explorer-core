import ContainerNode from '../ContainerNode.js';
import type { TableColumnConfig } from '../ContainerNode.js';
import type BaseNode from '../BaseNode.js';
import type DataNode from '../DataNode.js';
import type { NodeClassMapAPI } from '../NodeRegistry.js';
import type { SystemComposerCatalog } from './SlddNode.js';
import { NS_DESIGN, NS_CONFIGURATIONS, NS_OTHER, SECTION_NAMESPACE } from '../../SectionConstants.js';
export { NS_DESIGN, NS_CONFIGURATIONS, NS_OTHER, SECTION_NAMESPACE };
export declare function generateUuid(): string;
export declare function _injectNodeClassMap(map: NodeClassMapAPI): void;
export default class SectionNode extends ContainerNode {
    label: string;
    iconId: string;
    constructor(name: string, parent: BaseNode | null, label: string, iconId: string);
    get icon(): string;
    get displayName(): string;
    get tableColumnConfig(): TableColumnConfig;
    getAllowedTypes(): string[];
    allowsType(className: string): boolean;
    _namespaceEntryNames(): string[];
    addEntry(className: string, entryName?: string): DataNode | null;
    execAddEntry(className: string, entryName?: string): {
        node: DataNode;
        undo: () => void;
        redo: () => void;
    } | null;
    execRemoveEntry(node: BaseNode): {
        undo: () => void;
        redo: () => void;
    } | null;
    _uniqueName(baseName: string): string;
    parseEntry(rawEntry: Record<string, unknown>, systemComposer?: SystemComposerCatalog | null): DataNode | null;
}
//# sourceMappingURL=SectionNode.d.ts.map