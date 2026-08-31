import DataNode from '../DataNode.js';
import type BaseNode from '../BaseNode.js';
import type { PropClass, PIGroupDef } from '../BaseNode.js';
export default class ObjectNode extends DataNode {
    arrayClass: string;
    _isElementArray?: boolean;
    constructor(name: string, parent: BaseNode | null, arrayClass: string, serial?: Record<string, unknown>);
    get icon(): string;
    get className(): string;
    get isObjectPropertyBag(): boolean;
    get displayValue(): string;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[];
    serializeValue(): unknown;
    serializeXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    _getSerializedProperties(): Record<string, unknown>;
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): ObjectNode;
    static _addPropertyChildren(node: ObjectNode, properties: Record<string, unknown> | undefined): void;
}
//# sourceMappingURL=ObjectNode.d.ts.map