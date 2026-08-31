import type BaseNode from '../node/BaseNode.js';
import { formatText } from './formatText.js';
export default class PropKind {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string | null;
    static readValue(node: BaseNode): string;
    static format: typeof formatText;
}
//# sourceMappingURL=PropKind.d.ts.map