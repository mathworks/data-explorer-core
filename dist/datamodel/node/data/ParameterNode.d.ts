import DataNode from '../DataNode.js';
import type { SetPropertyResult } from '../DataNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import type MatlabVariableNode from './MatlabVariableNode.js';
import type { ParsedValue } from '../../parser/MatlabValueParser.js';
export default class ParameterNode extends DataNode {
    Value: unknown;
    _valueNode: DataNode | null;
    DataType: string;
    Min: number | undefined;
    Max: number | undefined;
    Unit: string;
    Description: string;
    _classFollowed?: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>);
    get icon(): string;
    get className(): string;
    get dataType(): string;
    get displayValue(): string;
    get valueEditable(): boolean;
    get descriptionEditable(): boolean;
    getPropInfo(PropClassRef: PropClass): ReturnType<DataNode['getPropInfo']>;
    _valueIsEnum(): boolean;
    _refuseStreamValue(stringValue: string): SetPropertyResult | null;
    _refuseValueBelow(node: MatlabVariableNode, parsed: ParsedValue, stringValue: string): SetPropertyResult | null;
    _refuseStructureBelow(container: DataNode, op: 'add' | 'remove'): string | null;
    _adoptValueNode(rawValue: unknown, edited?: boolean): void;
    static _needsValueRow(valueNode: BaseNode): boolean;
    childStructureChanged(child: BaseNode): void;
    childStructureRestorer(child: BaseNode): (() => void) | null;
    _shapeRestorer(): () => void;
    _followValueShape(): void;
    _followSourceDataType(): void;
    /**
     * The DataType this Parameter holds once its Value is of the class it is now, as MATLAB's own
     * `p.Value = v` makes it (McosPropertyRules.parameterDataTypeAfter) of the Value class this last
     * followed and the DataType it shows, an edit's included. A Parameter added holds MATLAB's
     * default, an empty double. The rule a MAT-file's object is shown by
     * (matObjectEdit.dataTypeShownFor). Null for a Value of no class this knows (an enumeration
     * value's), whose DataType it leaves as it is.
     */
    _followedDataType(): string | null;
    _valueClass(): string | null;
    _shapeFromValue(): {
        dims: number[];
        complexity: string | null;
    } | null;
    get isObjectPropertyBag(): boolean;
    getProperties(): PropClass[];
    setProperty(propName: string, stringValue: string): true | SetPropertyResult;
    _coWrittenWhy(propName: string): {
        property: string;
        why: string;
    } | null;
    _refuseValueForSource(stringValue: string): SetPropertyResult | null;
    _refuseValueForStream(stringValue: string): SetPropertyResult | null;
    _valueMadeBy(stringValue: string): BaseNode | null;
    _restorerFor(propName: string): (() => void) | null;
    _getSerializedProperties(): Record<string, unknown>;
    serializeValue(): unknown;
    serializeXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): ParameterNode;
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): ParameterNode;
}
//# sourceMappingURL=ParameterNode.d.ts.map