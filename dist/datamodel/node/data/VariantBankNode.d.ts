import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
export default class VariantBankNode extends SimulinkObjectNode {
    Value: unknown;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>);
    get icon(): string;
    get className(): string;
    get displayValue(): string;
    getProperties(): PropClass[];
    _serializedOverrides(): Record<string, unknown>;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): VariantBankNode;
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): VariantBankNode;
}
//# sourceMappingURL=VariantBankNode.d.ts.map