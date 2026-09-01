import { unquoteMatlabText } from '../parser/MatlabValueParser.js';
export default class PropSpecification {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string;
    static format(value: unknown): string;
    static unformat: typeof unquoteMatlabText;
}
//# sourceMappingURL=PropSpecification.d.ts.map