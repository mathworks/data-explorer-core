import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass, PIGroupDef } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import type { SetPropertyResult } from '../DataNode.js';
export default class ValueTypeNode extends SimulinkObjectNode {
    Description: string;
    DataType: string;
    Dimensions: unknown;
    Complexity: string;
    DimensionsMode: string;
    Min: number | undefined;
    Max: number | undefined;
    Unit: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>);
    get icon(): string;
    get className(): string;
    get dataType(): string;
    get displayValue(): string;
    get valueEditable(): boolean;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[];
    setProperty(propName: string, stringValue: string): true | SetPropertyResult;
    _serializedOverrides(): Record<string, unknown>;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): ValueTypeNode;
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): ValueTypeNode;
}
//# sourceMappingURL=ValueTypeNode.d.ts.map