import type BaseNode from '../node/BaseNode.js';
import { formatText } from './formatText.js';
export default class PropDataType {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string;
    static readValue(node: BaseNode): string;
    static format: typeof formatText;
}
//# sourceMappingURL=PropDataType.d.ts.map