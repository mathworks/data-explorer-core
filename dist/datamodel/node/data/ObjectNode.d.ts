import DataNode, { type SetPropertyResult } from '../DataNode.js';
import type BaseNode from '../BaseNode.js';
import type { PropClass, PIGroupDef } from '../BaseNode.js';
/**
 * An enumeration value as a text dictionary holds one: its size, and the number each element's
 * enumeral stands for, in MATLAB's column-major order, as its text (`'1'`, `'-1'`, `'true'`),
 * with the class those numbers are of.
 */
interface TextEnum {
    type: string;
    dims: number[];
    values: string[];
}
export default class ObjectNode extends DataNode {
    arrayClass: string;
    _isElementArray?: boolean;
    constructor(name: string, parent: BaseNode | null, arrayClass: string, serial?: Record<string, unknown>);
    get icon(): string;
    get className(): string;
    get isObjectPropertyBag(): boolean;
    get dims(): number[];
    _textEnumRead?: TextEnum | null;
    _textEnum(): TextEnum | null;
    /**
     * What a text dictionary's enumeration value shows. Its file names the class and the numbers
     * the enumerals stand for, never an enumeral, so it shows the enumeral's name where that is
     * known, and otherwise the numbers, as the MATLAB expression that makes the value from them:
     *
     *   - an OnOffSwitchState is `on` or `off`, MATLAB's own class whose enumerals are its
     *     logical values (DisplayConvention.classColumnText);
     *   - one of a class an EnumTypeDefinition in the same dictionary defines is `Class.Name`, as
     *     a binary dictionary's, which names its enumerals, shows one (displayValue);
     *   - any other is `DispColor(1)`, or for an array `DispColor([1 3])`.
     *
     * An array whose names are known shows its summary, as a binary dictionary's does, and each
     * element its own name on its row (parse). Null for a value of more than one element whose
     * numbers have no one-line spelling, which shows its summary as any object does.
     */
    _textEnumText(textEnum: TextEnum): string | null;
    get displayValue(): string;
    get valueEditable(): boolean;
    get descriptionEditable(): boolean;
    setProperty(propName: string, stringValue: string): true | SetPropertyResult;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[];
    serializeValue(): unknown;
    serializeXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    _getSerializedProperties(): Record<string, unknown>;
    _rebuiltProperties(forXml: boolean): Record<string, unknown>;
    _storedProperties(): Record<string, unknown>;
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): ObjectNode;
    static _addTextEnumElements(node: ObjectNode): void;
    static _addPropertyChildren(node: ObjectNode, properties: Record<string, unknown> | undefined): void;
}
export {};
//# sourceMappingURL=ObjectNode.d.ts.map