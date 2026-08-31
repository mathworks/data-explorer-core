import type BaseNode from '../node/BaseNode.js';
import { formatText } from './formatText.js';
export default class PropComplexity {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string | null;
    static sourceKeys: string[];
    static readValue(node: BaseNode): string;
    static format: typeof formatText;
}
//# sourceMappingURL=PropComplexity.d.ts.map