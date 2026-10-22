import type BaseNode from '../node/BaseNode.js';
export default class PropDimensions {
    static key: string;
    static displayName: string;
    static editor: string;
    static sourceEditable: boolean;
    static column: string | null;
    static sourceKeys: string[];
    static readValue(node: BaseNode): string;
    static format(value: unknown): string;
}
//# sourceMappingURL=PropDimensions.d.ts.map