import type { MatVariable } from './MatParser.js';
/**
 * A value this format cannot carry — an MCOS object (a MATLAB `string`, an
 * object array), or a class MatParser could not name. Thrown rather than
 * written, because a stream that declares one thing and carries another is read
 * back as garbage instead of as a failure.
 */
export declare class MatWriteError extends Error {
    constructor(message: string);
}
/** The bytes of one complete `miMATRIX` element: tag, then the matrix body. */
export declare function encodeMatVariable(v: MatVariable): Uint8Array;
/**
 * The `_value` string of a text .sldd `{"_type": "cdata"}` entry: the 8-byte
 * preamble, one miMATRIX element, uuencoded.
 */
export declare function encodeCdata(v: MatVariable): string;
//# sourceMappingURL=MatWriter.d.ts.map