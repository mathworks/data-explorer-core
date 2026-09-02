import DataNode from '../DataNode.js';
import type { SetPropertyResult } from '../DataNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
export default class ParameterNode extends DataNode {
    Value: unknown;
    _valueNode: DataNode | null;
    DataType: string;
    _rawMin: unknown;
    _rawMax: unknown;
    Min: number | undefined;
    Max: number | undefined;
    Unit: string;
    Description: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>);
    get icon(): string;
    get className(): string;
    get dataType(): string;
    get displayValue(): string;
    _adoptValueNode(rawValue: unknown): void;
    childStructureChanged(child: BaseNode): void;
    getProperties(): PropClass[];
    setProperty(propName: string, stringValue: string): true | SetPropertyResult;
    _getSerializedProperties(): Record<string, unknown>;
    serializeValue(): unknown;
    serializeXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): ParameterNode;
    static _normalizeMinMax(val: unknown): number | undefined;
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): ParameterNode;
}
//# sourceMappingURL=ParameterNode.d.ts.map