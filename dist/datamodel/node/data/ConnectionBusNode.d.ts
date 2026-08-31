import { BaseBusNode, BaseBusElementNode, PropDescription, PropKind } from './BaseBusNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
export declare class ConnectionBusElementNode extends BaseBusElementNode {
    Type: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>);
    get icon(): string;
    get className(): string;
    get dataType(): string;
    getProperties(): PropClass[];
    getPILayout(): ({
        group: string;
        items: (PropClass | typeof PropKind)[];
    } | {
        group: string;
        items: (typeof PropDescription)[];
    })[];
    _applyElementOverrides(props: Record<string, unknown>): void;
}
export declare class ConnectionBusNode extends BaseBusNode {
    get icon(): string;
    get className(): string;
    _createElementNode(name: string, props: Record<string, unknown>, serial: Record<string, unknown>): ConnectionBusElementNode;
    static ELEMENT_CLASS_NAME: string;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): ConnectionBusNode;
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): ConnectionBusNode;
}
declare const _default: {
    ConnectionBusNode: typeof ConnectionBusNode;
    ConnectionBusElementNode: typeof ConnectionBusElementNode;
};
export default _default;
//# sourceMappingURL=ConnectionBusNode.d.ts.map