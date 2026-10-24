import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import type { SetPropertyResult } from '../DataNode.js';
export default class BreakpointNode extends SimulinkObjectNode {
    Description: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>);
    get icon(): string;
    get className(): string;
    get displayValue(): string;
    get valueEditable(): boolean;
    getProperties(): PropClass[];
    get descriptionApplies(): boolean;
    _noDescriptionRefusal(propName: string, stringValue: string): SetPropertyResult | null;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): BreakpointNode;
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): BreakpointNode;
}
//# sourceMappingURL=BreakpointNode.d.ts.map