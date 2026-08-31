import type BaseNode from '../node/BaseNode.js';
export default class PropValue {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string;
    static readValue(node: BaseNode): string;
    static format(value: unknown): string;
}
//# sourceMappingURL=PropValue.d.ts.map