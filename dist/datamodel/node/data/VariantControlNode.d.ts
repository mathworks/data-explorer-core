import DataNode, { type SetPropertyResult } from '../DataNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
export default class VariantControlNode extends DataNode {
    Value: unknown;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>);
    get icon(): string;
    get className(): string;
    get displayValue(): string;
    getProperties(): PropClass[];
    /**
     * Validate and apply a Value edit. MATLAB requires the Value to be an
     * integer-valued real scalar, a logical (true/false), or empty (''/'[]').
     * Our editor always delivers a string; we parse it and mirror the same
     * accept/reject logic MATLAB applies.
     */
    setProperty(propName: string, stringValue: string): true | SetPropertyResult;
    _getSerializedProperties(): Record<string, unknown>;
    serializeValue(): unknown;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): VariantControlNode;
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): VariantControlNode;
}
//# sourceMappingURL=VariantControlNode.d.ts.map