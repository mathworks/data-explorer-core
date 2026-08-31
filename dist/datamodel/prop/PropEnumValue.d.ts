import type BaseNode from '../node/BaseNode.js';
import { formatText } from './formatText.js';
export default class PropEnumValue {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string;
    static nodeProperty: string;
    static readValue(node: BaseNode): string;
    static readOptions(node: BaseNode): string[];
    static format: typeof formatText;
}
//# sourceMappingURL=PropEnumValue.d.ts.map