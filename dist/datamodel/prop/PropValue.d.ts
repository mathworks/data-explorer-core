import type BaseNode from '../node/BaseNode.js';
export default class PropValue {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string;
    static defaultValue: number;
    static readValue(node: BaseNode): string;
    static format(value: unknown): string;
    static parse(raw: unknown): unknown;
    static validate(): string | null;
}
//# sourceMappingURL=PropValue.d.ts.map