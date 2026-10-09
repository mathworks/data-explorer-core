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
/**
 * A complex value's plain-text form — `{_type: 'cdata', _value: '1+2i 5+6i 3+4i 7+8i',
 * _dimensions, _class?}`, what BinarySlddParser reads out of a binary dictionary and
 * McosParser.complexPropertyValue builds — as the variable it stands for, or null when it
 * is not that form or a token in it is not one complex element. Read off the text, so a
 * value the node layer could not read as numbers (a binary dictionary's own non-finite
 * text, shown quoted) still converts: XmlUtils.parseComplexNum reads every spelling,
 * MATLAB's `1.0NaNi` included.
 */
export declare function complexTextVariable(raw: unknown): MatVariable | null;
/**
 * A value as an uncompressed-text dictionary must hold it: every complex value in its
 * plain-text form, at any depth, replaced by the MAT stream MATLAB writes for it there,
 * and everything else as it was. A copy wherever something changed, so the bag a node
 * replays is never touched; the same object where nothing did.
 *
 * MATLAB reads the plain-text form back out of a TEXT dictionary as an empty double
 * (defect 24's signature), and it is the form a binary dictionary and the MCOS decoder
 * hold a complex value in, which an untouched value replays: a Parameter pasted out of a
 * binary dictionary, or copied out of a .mat, went into a text one as
 * `{"_type": "cdata", "_value": "3+4i"}` and MATLAB reopened it as []. At any depth,
 * because the replay is whole bags too — a struct's, a cell's, a LookupTable's Table.
 */
export declare function textDictionaryForm(x: unknown): unknown;
//# sourceMappingURL=MatWriter.d.ts.map