import DataNode from '../DataNode.js';
import type { SetPropertyResult } from '../DataNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
export default class SignalNode extends DataNode {
    Min: number | undefined;
    Max: number | undefined;
    Unit: string;
    Description: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>);
    get icon(): string;
    get className(): string;
    get displayValue(): string;
    get valueEditable(): boolean;
    getProperties(): PropClass[];
    setProperty(propName: string, stringValue: string): true | SetPropertyResult;
    _getSerializedProperties(): Record<string, unknown>;
    serializeValue(): unknown;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): SignalNode;
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): SignalNode;
}
//# sourceMappingURL=SignalNode.d.ts.map