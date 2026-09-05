import { BaseBusNode, BaseBusElementNode, PropDescription, PropKind } from './BaseBusNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import type { SetPropertyResult } from '../DataNode.js';
import PropUnit from '../../prop/PropUnit.js';
export declare class BusElementNode extends BaseBusElementNode {
    _rawMin: unknown;
    _rawMax: unknown;
    Min: number | undefined;
    Max: number | undefined;
    Unit: string;
    DataType: string;
    Complexity: string;
    Dimensions: unknown;
    DimensionsMode: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>);
    static _normalizeMinMax(val: unknown): number | undefined;
    get icon(): string;
    get className(): string;
    get dataType(): string;
    getProperties(): PropClass[];
    getPILayout(): ({
        group: string;
        items: (PropClass | typeof PropKind)[];
    } | {
        group: string;
        items: (PropClass | typeof PropUnit | typeof PropDescription)[];
    })[];
    setProperty(propName: string, stringValue: string): true | SetPropertyResult;
    _rejectUnknownEnumeral(propName: string, stringValue: string): SetPropertyResult | null;
    _applyElementOverrides(props: Record<string, unknown>): void;
}
export declare class BusNode extends BaseBusNode {
    isStructType: boolean;
    get icon(): string;
    get className(): string;
    _createElementNode(name: string, props: Record<string, unknown>, serial: Record<string, unknown>): BusElementNode;
    static ELEMENT_CLASS_NAME: string;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): BusNode;
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): BusNode;
}
declare const _default: {
    BusNode: typeof BusNode;
    BusElementNode: typeof BusElementNode;
};
export default _default;
//# sourceMappingURL=BusNode.d.ts.map