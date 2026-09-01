import DataNode from '../DataNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import type { ChildAddEdit, ChildUndoRedo } from '../childEdit.js';
import PropDescription from '../../prop/PropDescription.js';
import PropKind from '../../prop/PropKind.js';
export declare class EnumValueNode extends DataNode {
    Value: unknown;
    Description: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>);
    get icon(): string;
    get className(): string;
    get dataType(): string;
    get displayValue(): string;
    get disabled(): boolean;
    getProperties(): PropClass[];
    getPILayout(): {
        group: string;
        items: (typeof PropKind | typeof PropDescription)[];
    }[];
    serializeValue(): unknown;
}
export declare class EnumTypeNode extends DataNode {
    DefaultValue: string;
    Description: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>);
    get icon(): string;
    get className(): string;
    get displayValue(): string;
    getProperties(): PropClass[];
    _getSerializedProperties(): Record<string, unknown>;
    serializeValue(): unknown;
    canRemoveChild(): boolean;
    removeChildNode(child: BaseNode): void;
    restoreChildNode(child: BaseNode, index: number): void;
    canAddChild(): boolean;
    addChildNode(): EnumValueNode;
    execAddChild(): ChildAddEdit<EnumValueNode> | null;
    execRemoveChild(child?: BaseNode): ChildUndoRedo | null;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): EnumTypeNode;
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): EnumTypeNode;
}
declare const _default: {
    EnumTypeNode: typeof EnumTypeNode;
    EnumValueNode: typeof EnumValueNode;
};
export default _default;
//# sourceMappingURL=EnumTypeNode.d.ts.map