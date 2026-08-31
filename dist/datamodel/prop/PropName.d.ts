import type BaseNode from '../node/BaseNode.js';
export default class PropName {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string;
    static nodeProperty: string;
    static defaultValue: string;
    static sourceKeys: string[];
    static readValue(node: BaseNode): string;
    static format(value: unknown): string;
    static parse(raw: unknown): string;
    static validate(value: unknown): string | null;
}
//# sourceMappingURL=PropName.d.ts.map