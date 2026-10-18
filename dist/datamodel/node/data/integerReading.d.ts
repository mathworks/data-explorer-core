import type { ParseWarning } from '../../parser/ParseWarning.js';
/** One number its class could not hold: as read, and as it is held. */
export interface UnheldInteger {
    /** The integer class, `int8` to `uint64`. */
    type: string;
    /** The number as read: a double, or a 64-bit integer's exact decimal text (parseExactNum). */
    read: number | string;
    /** What it is held as (toIntegerClass). */
    shown: number | string;
}
/** The numbers recorded since the last take: how many, and the first, all a warning names. */
export interface UnheldIntegers {
    count: number;
    first: UnheldInteger;
}
/**
 * A reader of numbers under integer class `type`, its conversion looked up once (for an array's
 * every element): each number comes back as MATLAB reads it under the class, and one the class
 * did not hold is recorded.
 */
export declare function integerReader(type: string): (read: number | string) => number | string;
/** The numbers recorded since the last call, which clears them, or null if there were none. */
export declare function takeUnheldIntegers(): UnheldIntegers | null;
/**
 * The one warning for entry `part` whose read recorded `taken`. A text dictionary's number is
 * shown as MATLAB reads that file (measured). A binary dictionary's is shown as MATLAB converts
 * a number to the class, which is what this package's binary writer writes; MATLAB's own binary
 * reader takes such text its own way (int8 300 as 44, measured), so that file's message does not
 * say "as MATLAB reads it".
 */
export declare function unheldIntegerWarning(part: string, taken: UnheldIntegers, textDictionary: boolean): ParseWarning;
//# sourceMappingURL=integerReading.d.ts.map