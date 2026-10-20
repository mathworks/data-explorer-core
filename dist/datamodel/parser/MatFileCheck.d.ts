/**
 * What a MatViolation is about. Each is one rule MATLAB applies at `load`:
 *
 * - `short-file`: fewer than the 128 bytes of a header;
 * - `not-level5`: the version (bytes 124-125) or the endian mark (126-127) is not a Level-5
 *   file's, or the two disagree;
 * - `level4-lookalike`: a 16-bit half of bytes 0-3 is zero, so MATLAB reads the file as Level 4;
 * - `big-endian`: an 'MI' file, noted and not checked further (this package does not read one);
 * - `framing`: the records do not tile the file from byte 128 to its end: one is cut short, one
 *   is not a whole number of 8-byte words, or bytes follow or pad them;
 * - `top-level-type`: a record that is neither miMATRIX nor miCOMPRESSED;
 * - `empty-matrix`: a record holding an miMATRIX of 0 bytes;
 * - `compressed-wrapper`: a compressed record that is not one zlib stream of one miMATRIX;
 * - `subsystem-offset`: header bytes 116-123 do not point at the subsystem's record, or are 0
 *   with a subsystem in the file;
 * - `subsystem-not-last`: a record after the subsystem, which MATLAB silently leaves out;
 * - `anonymous-record`: an unnamed record that is not the subsystem, where MATLAB stops listing;
 * - `name`: a variable name that is not valid UTF-8, not an identifier, or a keyword (an empty
 *   one is an `anonymous-record`);
 * - `duplicate-name`: two records of one name;
 * - `char-type`: char data in a type MATLAB does not read as text, or reads wrong;
 * - `utf8-count`: miUTF8 char data whose UTF-16 length is not the array's element count;
 * - `nbytes`: a matrix its sub-elements do not fill exactly;
 * - `int-storage`: a numeric array of a class other than double, stored in a type other than
 *   its class's own;
 * - `element`: a sub-element MATLAB cannot read where it stands: array flags, dimensions or a
 *   name of the wrong type, an unknown class or data type, a small tag of more than 4 bytes, a
 *   container member that is not a matrix;
 * - `data-size`: a data sub-element holding more or fewer elements than the dimensions say;
 * - `budget`: the check stopped here, and nothing from here on was checked.
 */
export type MatViolationCode = 'short-file' | 'not-level5' | 'level4-lookalike' | 'big-endian' | 'framing' | 'top-level-type' | 'empty-matrix' | 'compressed-wrapper' | 'subsystem-offset' | 'subsystem-not-last' | 'anonymous-record' | 'name' | 'duplicate-name' | 'char-type' | 'utf8-count' | 'nbytes' | 'int-storage' | 'element' | 'data-size' | 'budget';
/** One rule a MAT-file breaks, and where. */
export interface MatViolation {
    code: MatViolationCode;
    /**
     * The byte of the file it is at. Inside a compressed record that is the record's own tag,
     * since the bytes at fault exist only inflated; the message gives their place in the
     * inflated payload. For a header field (`subsystem-offset`) it is the field.
     */
    at: number;
    /** What is wrong, and what MATLAB does with it, in a sentence a user can be shown. */
    message: string;
    /** The variable it is in, when its record has a name that could be read. */
    variable?: string;
}
/** How much one check may spend. Past either budget it stops with a `budget` note. */
export interface MatCheckOptions {
    /** Matrices walked, top-level and nested together. Defaults to MAT_CHECK_ELEMENT_BUDGET. */
    maxElements?: number;
    /** Bytes inflated from compressed records, over the whole file. Defaults to MAT_CHECK_INFLATE_BUDGET. */
    maxInflatedBytes?: number;
}
/**
 * How many matrices one check walks, at most: 2^24. A matrix costs the check a few tag reads,
 * and 2^24 of them is a struct array of 1.6 million elements and ten fields each.
 */
export declare const MAT_CHECK_ELEMENT_BUDGET: number;
/**
 * How many bytes one check inflates, at most, over every compressed record of the file: 1 GiB.
 * The check inflates one record at a time and drops it, so this bounds time more than memory;
 * the largest record in the corpus `parseMat` is measured against inflates to 114 MB.
 */
export declare const MAT_CHECK_INFLATE_BUDGET: number;
/**
 * Check a Level-5 MAT-file against the rules MATLAB loads one by (see the top of this file),
 * and list every place it breaks one, in file order. An empty list means MATLAB loads the
 * file, every variable in it, as stored. Pure and synchronous, and it never throws: bytes that
 * are not a MAT-file at all are a violation too.
 */
export declare function checkMatFile(bytes: Uint8Array, options?: MatCheckOptions): MatViolation[];
/**
 * What one variable's miMATRIX element (its tag and body, as a record holds it inflated) breaks
 * of the rules MATLAB reads a matrix by, at any depth: its char data, its storage, how its
 * sub-elements fill it, its name. Not the rules of a file (its header, framing, compression,
 * placement), which only a whole file has: those are checkMatFile's. Every `at` is 0, the
 * element's own start, and each message says where in the element. Asked of a variable as it was
 * read, whose element is in memory already, so nothing is inflated; and like checkMatFile it never
 * throws, and stops at its budget with a `budget` note.
 */
export declare function checkMatElement(element: Uint8Array, options?: MatCheckOptions): MatViolation[];
/**
 * The violations of `after` that `before` does not have: what a rewrite of a file added to it.
 *
 * Matched by code and variable, never by offset or message, which an edit anywhere before a
 * record moves; and counted, so a third violation of one kind in one variable is added where
 * the original had two. `renamed` maps a variable's name in `after` to its name in `before`.
 * A `budget` note in `after` is always added: a check that did not finish proves nothing about
 * what it did not reach, whatever the original's check reached.
 */
export declare function violationsAdded(before: readonly MatViolation[], after: readonly MatViolation[], renamed?: ReadonlyMap<string, string>): MatViolation[];
//# sourceMappingURL=MatFileCheck.d.ts.map