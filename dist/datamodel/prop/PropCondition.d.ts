import { unquoteMatlabText } from '../parser/MatlabValueParser.js';
export default class PropCondition {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string;
    static format(value: unknown): string;
    static unformat: typeof unquoteMatlabText;
}
//# sourceMappingURL=PropCondition.d.ts.map