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
 * - `utf8-wide`: miUTF8 char data holding a character of three UTF-8 bytes, which R2027a loads
 *   and R2023b does not (its value as read is the value, so it is no `char-type`);
 * - `nbytes`: a matrix its sub-elements do not fill exactly;
 * - `int-storage`: a numeric array of a class other than double, stored in a type other than
 *   its class's own;
 * - `element`: a sub-element MATLAB cannot read where it stands: array flags, dimensions or a
 *   name of the wrong type, an unknown class or data type, a small tag of more than 4 bytes, a
 *   container member that is not a matrix;
 * - `data-size`: a data sub-element holding more or fewer elements than the dimensions say;
 * - `budget`: the check stopped here, and nothing from here on was checked.
 */
export type MatViolationCode = 'short-file' | 'not-level5' | 'level4-lookalike' | 'big-endian' | 'framing' | 'top-level-type' | 'empty-matrix' | 'compressed-wrapper' | 'subsystem-offset' | 'subsystem-not-last' | 'anonymous-record' | 'name' | 'duplicate-name' | 'char-type' | 'utf8-count' | 'utf8-wide' | 'nbytes' | 'int-storage' | 'element' | 'data-size' | 'budget';
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
/** A record of a file as read, for violationsAddedBySplice: its bytes, from its tag. */
export interface MatReadRecord {
    bytes: Uint8Array;
    /**
     * Its payload as `inflateZlib` inflated it, for a compressed record whose inflate the caller
     * holds already (MatParser keeps it, MatVariable._rawBytes), so that it is not inflated again.
     */
    inflated?: Uint8Array | null;
}
/**
 * A record of a file written from another (violationsAddedBySplice): a record of that file kept
 * as its own bytes (`kept`, its index), or bytes written in place of one of its records
 * (`replaces`, its index: a variable renamed or written fresh, and the subsystem, when a save
 * writes it anew) or of none (`replaces` null: a variable added).
 */
export type MatSplicedRecord = {
    kept: number;
} | {
    written: Uint8Array;
    replaces: number | null;
};
/** A Level-5 file as its 128-byte header and its records, back to back from byte 128. */
export interface MatFileOfRecords<R> {
    header: Uint8Array;
    records: readonly R[];
}
/**
 * What `written` adds to `read` by the rules MATLAB loads a file by, as
 * `violationsAdded(checkMatFile(read), checkMatFile(written), renamed)` says it, where `written`
 * is `read` with some of its records kept as their own bytes, the others deleted or written anew,
 * and records added: worked out from what changed, rather than by checking both files whole.
 *
 * WHY IT IS THE SAME ANSWER. What a record breaks depends on its bytes alone (checkRecord, which
 * checkMatFile walks every record with: `at` only places what is said). So a record kept as its
 * own bytes breaks in `written` what it broke in `read`, under the same variable, and the two
 * cancel, by rule and variable, as violationsAdded counts them. What is left to compare is the
 * records written, the records they replace, the header, and the rules of where records stand
 * (checkPlacement), which are asked of both files whole, from each record's name and whether it
 * holds the subsystem: of a kept record, read without walking the rest of it (Check.headOnly).
 * That holds where three things do, and where one does not both files are checked whole:
 *
 *   - both files walk as their records are given: every record's tag declares exactly the bytes
 *     it is given, and opens with a nonzero byte, which the tag of a type that is a multiple of
 *     256 does not, and which the walk then takes for padding;
 *   - no record of `read` is kept twice, or kept and replaced;
 *   - no kept record holds a name `renamed` maps, which violationsAdded would compare its
 *     violations under the other name of.
 *
 * A record deleted is one more in `read` than in `written`, which can only take from what is
 * added: it is checked only when something is.
 *
 * THE BUDGET (MatCheckOptions) is spent on what is checked, the records written and the ones
 * they replace, and not on the records kept, which are not walked: so a file past it is still
 * checked where it changed, where checkMatFile of it would stop. A `budget` note on the written
 * side is added, as violationsAdded adds every one; one on the read side only leaves less for a
 * written record's violations to be matched with. A kept record whose name cannot be read within
 * the budget is a `budget` note on the written side: where it stands cannot be judged.
 */
export declare function violationsAddedBySplice(read: MatFileOfRecords<MatReadRecord>, written: MatFileOfRecords<MatSplicedRecord>, renamed?: ReadonlyMap<string, string>, options?: MatCheckOptions): MatViolation[];
//# sourceMappingURL=MatFileCheck.d.ts.map