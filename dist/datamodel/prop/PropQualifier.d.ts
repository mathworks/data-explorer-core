import { formatText } from './formatText.js';
export declare const QUALIFIERS: readonly string[];
export default class PropQualifier {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string;
    static sourceKeys: string[];
    static readOptions(): string[];
    static format: typeof formatText;
}
//# sourceMappingURL=PropQualifier.d.ts.map