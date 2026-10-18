import type { ParseWarning } from '../../parser/ParseWarning.js';
/**
 * The JSON `value` is, cut at SHOWN_MAX characters. A value JSON cannot spell, which only a host
 * can hand in (a bigint in it), is named by its first keys. Never throws.
 */
export declare function unshapedText(value: object): string;
/** Record one object of no shape MATLAB writes, held by the node `at`. */
export declare function recordUnshapedValue(at: {
    readonly matlabPath: string;
}, value: object): void;
/** What a warning names: how many, and the first one's path and text. */
export interface UnshapedValues {
    count: number;
    path: string;
    text: string;
}
/** The objects recorded since the last call, which clears them, or null if there were none. */
export declare function takeUnshapedValues(): UnshapedValues | null;
/** The one warning for entry `part` whose read recorded `taken`. */
export declare function unshapedValueWarning(part: string, taken: UnshapedValues): ParseWarning;
//# sourceMappingURL=unshapedValue.d.ts.map