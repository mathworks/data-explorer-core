import type BaseNode from '../node/BaseNode.js';
export default class PropDimensionsMode {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string | null;
    static defaultValue: string;
    static sourceKeys: string[];
    static readValue(node: BaseNode): string;
    static format(value: unknown): string;
}
//# sourceMappingURL=PropDimensionsMode.d.ts.map