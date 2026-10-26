import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import { type SetPropertyResult } from '../DataNode.js';
export default class VariantBankNode extends SimulinkObjectNode {
    Value: unknown;
    readonly _valueInFile: boolean;
    BankName: string;
    VariantConditions: unknown;
    AllChoicesCoderInfo: string;
    ActiveChoiceCoderInfo: string;
    _editedFields: Map<string, unknown>;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>);
    get icon(): string;
    get className(): string;
    get displayValue(): string;
    get valueEditable(): boolean;
    getProperties(): PropClass[];
    _unofferedValueRefusal(stringValue: string): SetPropertyResult;
    _setProperty(propName: string, stringValue: string): true | SetPropertyResult;
    _restorerFor(propName: string): (() => void) | null;
    _serializedOverrides(): Record<string, unknown>;
    _mergeProps(propOverrides: Record<string, unknown>): Record<string, unknown>;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): VariantBankNode;
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): VariantBankNode;
}
//# sourceMappingURL=VariantBankNode.d.ts.map