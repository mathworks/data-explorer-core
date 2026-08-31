import type BaseNode from '../node/BaseNode.js';
export default class PropLabels {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string | null;
    static readValue(node: BaseNode): string;
    static format(value: unknown): string;
}
//# sourceMappingURL=PropLabels.d.ts.map