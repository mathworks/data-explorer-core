import { formatMatlabNum, integerConversion, isExactToken } from '../../parser/XmlUtils.js';
// The first and a count, not a list: one value can hold millions of such numbers, and one
// warning per entry names only the first.
let first = null;
let count = 0;
/**
 * A reader of numbers under integer class `type`, its conversion looked up once (for an array's
 * every element): each number comes back as MATLAB reads it under the class, and one the class
 * did not hold is recorded.
 */
export function integerReader(type) {
    const convert = integerConversion(type);
    return (read) => {
        const shown = convert(read);
        // `read === shown` is every number a dictionary MATLAB wrote holds, -0 included. Past it,
        // a value is held if it is the same integer: a double past 2^53 that an int64 holds comes
        // back as its exact text.
        if (!heldAsRead(read, shown)) {
            if (count++ === 0) {
                first = { type, read, shown };
            }
        }
        return shown;
    };
}
/** Was `read` held by its class as it was read, `shown` being what integerReader made of it? */
export function heldAsRead(read, shown) {
    return read === shown || sameInteger(read, shown);
}
function sameInteger(read, shown) {
    if (typeof read === 'number' ? !Number.isInteger(read) : !isExactToken(read)) {
        return false;
    }
    return BigInt(read) === BigInt(shown);
}
/** The numbers recorded since the last call, which clears them, or null if there were none. */
export function takeUnheldIntegers() {
    const taken = first && { count, first };
    first = null;
    count = 0;
    return taken;
}
/**
 * The one warning for entry `part` whose read recorded `taken`. A text dictionary's number is
 * shown as MATLAB reads that file (measured). A binary dictionary's is shown as MATLAB converts
 * a number to the class, which is what this package's binary writer writes; MATLAB's own binary
 * reader takes such text its own way (int8 300 as 44, measured), so that file's message does not
 * say "as MATLAB reads it".
 */
export function unheldIntegerWarning(part, taken, textDictionary) {
    const { type, read, shown } = taken.first;
    const value = `the ${type} value ${formatMatlabNum(read)}`;
    const how = textDictionary ? 'as MATLAB reads it' : 'as MATLAB converts a number to its class';
    const article = type.startsWith('u') ? 'a' : 'an';
    const message = taken.count === 1
        ? `"${part}" holds ${value}, which ${article} ${type} cannot hold; it is shown ${how}, ${formatMatlabNum(shown)}.`
        : `"${part}" holds ${taken.count} values its integer class cannot hold, each shown ${how}; `
            + `the first is ${value}, shown as ${formatMatlabNum(shown)}.`;
    return { code: 'part-unreadable', message, part };
}
//# sourceMappingURL=integerReading.js.map