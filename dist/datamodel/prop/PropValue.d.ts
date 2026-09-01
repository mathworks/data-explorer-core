import type BaseNode from '../node/BaseNode.js';
import { unquoteMatlabText } from '../parser/MatlabValueParser.js';
export default class PropValue {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string;
    static readValue(node: BaseNode): string;
    static format(value: unknown): string;
    static unformat: typeof unquoteMatlabText;
}
//# sourceMappingURL=PropValue.d.ts.map