import type BaseNode from '../node/BaseNode.js';
import { formatText } from './formatText.js';
export default class PropDimensionsMode {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string | null;
    static nodeProperty: string;
    static sourceKeys: string[];
    static readValue(node: BaseNode): string;
    static readOptions(): string[];
    static format: typeof formatText;
}
//# sourceMappingURL=PropDimensionsMode.d.ts.map