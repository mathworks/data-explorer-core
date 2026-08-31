import type BaseNode from '../node/BaseNode.js';
export default class PropDataType {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string;
    static defaultValue: string;
    static readValue(node: BaseNode): string;
    static format(value: unknown): string;
    static parse(raw: unknown): string;
    static validate(): string | null;
}
//# sourceMappingURL=PropDataType.d.ts.map