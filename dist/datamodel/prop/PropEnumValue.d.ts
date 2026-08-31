import type BaseNode from '../node/BaseNode.js';
export default class PropEnumValue {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string;
    static nodeProperty: string;
    static defaultValue: string;
    static readValue(node: BaseNode): string;
    static readOptions(node: BaseNode): string[];
    static format(value: unknown): string;
    static parse(raw: unknown): string;
    static validate(): string | null;
}
//# sourceMappingURL=PropEnumValue.d.ts.map