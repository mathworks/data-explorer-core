import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
export default class LookupTableNode extends SimulinkObjectNode {
    Description: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>);
    get icon(): string;
    get className(): string;
    get displayValue(): string;
    get valueEditable(): boolean;
    getProperties(): PropClass[];
    _serializedOverrides(): Record<string, unknown>;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): LookupTableNode;
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): LookupTableNode;
}
//# sourceMappingURL=LookupTableNode.d.ts.map