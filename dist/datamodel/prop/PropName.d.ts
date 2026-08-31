import type BaseNode from '../node/BaseNode.js';
import { formatText } from './formatText.js';
export default class PropName {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string;
    static nodeProperty: string;
    static sourceKeys: string[];
    static readValue(node: BaseNode): string;
    static format: typeof formatText;
}
//# sourceMappingURL=PropName.d.ts.map