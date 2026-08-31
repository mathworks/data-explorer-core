import { BaseBusNode, BaseBusElementNode, PropKind } from './BaseBusNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
export declare class FunctionElementNode extends BaseBusElementNode {
    Prototype: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>);
    get icon(): string;
    get className(): string;
    get dataType(): string;
    get displayValue(): string;
    getProperties(): PropClass[];
    getPILayout(): {
        group: string;
        items: (typeof PropKind)[];
    }[];
}
export declare class ServiceBusNode extends BaseBusNode {
    get icon(): string;
    get className(): string;
    get displayValue(): string;
    get valueEditable(): boolean;
    _createElementNode(name: string, props: Record<string, unknown>, serial: Record<string, unknown>): FunctionElementNode;
    addChildNode(): FunctionElementNode;
    static ELEMENT_CLASS_NAME: string;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): ServiceBusNode;
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): ServiceBusNode;
}
declare const _default: {
    ServiceBusNode: typeof ServiceBusNode;
    FunctionElementNode: typeof FunctionElementNode;
};
export default _default;
//# sourceMappingURL=ServiceBusNode.d.ts.map