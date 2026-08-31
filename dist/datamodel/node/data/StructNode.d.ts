import DataNode from '../DataNode.js';
import type BaseNode from '../BaseNode.js';
import type { PropClass, PIGroupDef } from '../BaseNode.js';
export default class StructNode extends DataNode {
    _isElementNode?: boolean;
    get icon(): string;
    get className(): string;
    get dataType(): string;
    get kind(): string;
    get displayValue(): string;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[];
    serializeElement(): Record<string, unknown>;
    serializeValue(): unknown;
    serializeXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    canRemoveChild(): boolean;
    removeChildNode(child: BaseNode): void;
    restoreChildNode(child: BaseNode, index: number): void;
    canAddChild(): boolean;
    addChildNode(): DataNode;
    execAddChild(): {
        node: DataNode;
        undo: () => void;
        redo: () => void;
    } | null;
    execRemoveChild(child: BaseNode): {
        undo: () => void;
        redo: () => void;
    } | null;
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): StructNode;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): StructNode;
}
//# sourceMappingURL=StructNode.d.ts.map