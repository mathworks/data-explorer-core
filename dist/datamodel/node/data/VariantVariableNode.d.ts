import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
export default class VariantVariableNode extends SimulinkObjectNode {
    Specification: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>);
    get icon(): string;
    get className(): string;
    get displayValue(): string;
    getProperties(): PropClass[];
    _serializedOverrides(): Record<string, unknown>;
    _getSerializedProperties(): Record<string, unknown>;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): VariantVariableNode;
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): VariantVariableNode;
}
//# sourceMappingURL=VariantVariableNode.d.ts.map