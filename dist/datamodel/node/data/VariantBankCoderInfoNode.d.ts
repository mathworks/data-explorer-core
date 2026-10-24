import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import { type SetPropertyResult } from '../DataNode.js';
export default class VariantBankCoderInfoNode extends SimulinkObjectNode {
    Value: unknown;
    readonly _valueInFile: boolean;
    HeaderFile: string;
    DefinitionFile: string;
    PreStatement: string;
    PostStatement: string;
    Qualifier: string;
    _editedFields: Map<string, unknown>;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>);
    get icon(): string;
    get className(): string;
    get displayValue(): string;
    get valueEditable(): boolean;
    get descriptionApplies(): boolean;
    getProperties(): PropClass[];
    setProperty(propName: string, stringValue: string): true | SetPropertyResult;
    _restorerFor(propName: string): (() => void) | null;
    _serializedOverrides(): Record<string, unknown>;
    _mergeProps(propOverrides: Record<string, unknown>): Record<string, unknown>;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): VariantBankCoderInfoNode;
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): VariantBankCoderInfoNode;
}
//# sourceMappingURL=VariantBankCoderInfoNode.d.ts.map