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
/**
 * A write refused for what a value declares rather than what it holds: `reason`
 *   - 'budget': it would put out more than UNBACKED_BYTES_BUDGET that no data backs;
 *   - 'not-a-count': its dims are not a size (parser/Size), so there is nothing to count;
 *   - 'past-int32': an extent past MAT_MAX_EXTENT, which no MAT stream's dims word can say;
 *   - 'not-an-index': a sparse array's non-zero whose row or column is not a whole number,
 *     which no index can hold, and without which the array is not the one it is;
 *   - 'not-decoded': a value the reader recorded without decoding, with no stream of its own
 *     to be written as, so nothing holds its value but the text of its placeholder;
 *   - 'no-spelling': an empty a text dictionary has no spelling of that MATLAB reads back as
 *     what it is: a function handle's, an N-D enumeration's or string's (textEmptySpelling).
 * Final: nothing may be written in the value's place — not the value laid out full, not its
 * summary, not its elements one by one — so it reaches whoever asked for the write, and a
 * copy or a save that holds the value fails. Every other MatWriteError says this writer has
 * no spelling for the value, and a caller may write it another way.
 *
 * `at` is where in the value the write was refused, in MATLAB's spelling from the value the
 * write began at ('{16385}', '.f', '(2).f'; '' for that value itself), and `what` is what
 * stands there, in words. `entry` is set once the node layer has restated it for a user,
 * naming the entry (budgetFailure).
 */
export declare class MatBudgetError extends MatWriteError {
    readonly at: string;
    readonly what: string;
    readonly entry: string | undefined;
    readonly reason: 'budget' | 'not-a-count' | 'past-int32' | 'not-an-index' | 'not-decoded' | 'no-spelling';
    /** False when what stands at `at` declares a size that is no count at all (NaN, Inf). */
    readonly counted: boolean;
    constructor(message: string, at: string, what: string, entry?: string, reason?: MatBudgetError['reason']);
}
/**
 * The most bytes one write (oneWrite; outside one, each encodeMatVariable, encodeMatStream,
 * encodeCdata) puts out that no data it was handed backs. Sized by measuring the worst case
 * it allows, one value spending all of it — a host's 1x4194305 copied, pasted into a text and
 * a binary dictionary and saved, cdata and hex included — on node 24: a peak of 0.32 GB for
 * the copy, 0.67 GB for the text save and 0.73 GB for the binary one, where twice this
 * peaked at 1.0 and 1.1 GB. Pinned at its value in test/unbackedBudget.test.ts.
 */
export declare const UNBACKED_BYTES_BUDGET: number;
/** Whether a write (oneWrite) is under way. */
export declare function writeUnderWay(): boolean;
/**
 * Runs `write` as one write of one value: every encode in it, and every spendUnbacked, shares
 * one UNBACKED_BYTES_BUDGET. Inside a write already under way it is that write. Every node
 * writer of a value that holds others — serializeValue and serializeXml of a cell, a struct,
 * an object — starts one when none is, so a node written on its own is one write as an
 * entry's serialize() and XML are, not one per member it holds.
 */
export declare function oneWrite<T>(write: () => T): T;
/**
 * Runs `write` with each MCOS object held in a struct field or a cell written as the class-17
 * element `elementOf` gives for it, the one it was read as: what a MAT-file's save does for a
 * variable it writes fresh, a struct whose plain field was edited beside an object, say
 * (MatFileWriter.freshElement), and the save says which elements it passes through
 * (MatFileWriter.objectElementOf). The element names objects of the file's own subsystem, which the
 * save writes beside it, so it is the object, as it was, or edited there. Nowhere else: a stream
 * written into a dictionary has no subsystem of the file's, and an object member there is refused
 * as it always was.
 */
export declare function withObjectMembers<T>(elementOf: (v: MatVariable) => Uint8Array | null, write: () => T): T;
/**
 * Takes `bytes` of the write's budget for something a writer spells that no data backs —
 * `what`, in words — or, when not that much is left, takes nothing and refuses the write
 * (MatBudgetError).
 */
export declare function spendUnbacked(bytes: number, what: string): void;
/**
 * `e` restated for whoever asked for the write: the entry, the MATLAB path of what the
 * budget ran out at — `where` is the path of the value the refused encode began at, from
 * the entry's name — and the budget, in words a user can act on. Restated once.
 */
export declare function budgetFailure(e: MatBudgetError, entry: string, where: string): MatBudgetError;
/**
 * `cls` as MATLAB names a class, with its article: 'an int8', 'a char' (this package's
 * `mxchar` envelope holds one), 'a sparse double' (its `sparse` literal holds one).
 */
export declare function classPhrase(cls: string): string;
/**
 * Why encodeSparse refuses `v`, or null when it writes it. Read off the shape, the class and
 * what the non-zeros say backs them — never the non-zeros themselves — so it is asked of a
 * node before it offers an editor (MatlabVariableNode._sparseRefusal): an array no edit of
 * could be written takes none.
 *
 * The column index is the one part of the stream that grows with the array's declared
 * shape: cols + 1 words, whatever the rows. So the columns have to be backed by what the
 * array came from (SparseData.backedColumns): a file's own column index, or a dense list's
 * elements, one column apiece — never the declared count alone. One read from a file whose
 * index held fewer columns than its dims declare has a damaged dims word (`new Array(2^31)`
 * for one corrupted cols word of a 3 KB hex value, a fatal out-of-memory no caller could
 * catch), and `Matrix(0,134217728)\n[]`, credited its header's columns, was a 512 MB index
 * from 52 characters. The columns past the backed ones are written out of the write's
 * budget (UNBACKED_BYTES_BUDGET), so sparse(0, 5) and a host's 1x2e6 with three entries are
 * written, and refused here is only an array whose unbacked index alone is past all of it.
 * And no stream holds a column index past what its uint32 size word can say. A value MATLAB
 * wrote is none of these.
 */
export declare function sparseWriteRefusal(v: SparseRefusalInput): string | null;
type SparseRefusalInput = Pick<MatVariable, 'undecoded' | 'dimensions' | 'className' | 'isLogical' | 'sparse' | 'value'>;
/**
 * The bytes of one complete `miMATRIX` element: tag, then the matrix body. It writes no more
 * than UNBACKED_BYTES_BUDGET that the value does not back, out of the write's budget when one
 * is under way (oneWrite).
 */
export declare function encodeMatVariable(v: MatVariable): Uint8Array;
/**
 * The refusal this writer makes of a variable of class `className` (encodeElement), or null for a
 * class it has a MAT class for. Asked, too, of a value whose variable says another class than
 * it has: a MATLAB string, which the node layer hands over as a char (MatlabVariableNode
 * _unwritableStream).
 */
export declare function classRefusal(className: string): MatWriteError | null;
/**
 * The `_value` string of a text .sldd `{"_type": "cdata"}` entry: the 8-byte
 * preamble, one miMATRIX element, uuencoded.
 */
export declare function encodeCdata(v: MatVariable): string;
/**
 * The MAT stream of one value — `getByteStreamFromArray(value)`: the 8-byte preamble and
 * one miMATRIX element. A text dictionary carries it uuencoded (encodeCdata), a binary
 * one as hex (EncodedValue.hexValue).
 */
export declare function encodeMatStream(v: MatVariable): Uint8Array;
/**
 * The MAT stream of a value whose miMATRIX element is at hand AS READ (MatVariable's
 * `_rawBytes`), or null when the bytes are not a whole one this can re-frame.
 *
 * For a value nothing here can re-encode because the reader never decoded it — one
 * MatParser recorded as `undecoded` — though a copy of such a value itself, out of a .mat or
 * a model workspace, is refused (MatlabVariableNode._undecodedRefusal). Its bytes are
 * the value; the one thing in them a stream does not carry is the variable's NAME, which a
 * .mat writes into the element and a stream leaves empty, so the name subelement is
 * replaced by the empty one and the element's size restated. Everything else is copied byte for byte. An MCOS opaque (class 17) is not framed this
 * way, and its subsystem lives elsewhere in the file, so it is refused.
 */
export declare function matStreamOfElement(raw: Uint8Array): Uint8Array | null;
/**
 * The miMATRIX element `raw` holds as read, named `name`: the inverse of ownElement, for a
 * variable of a MAT-file, which carries its name in its element as a stream's value does not.
 * Every byte but the name subelement's is copied, and the element's size restated, so a
 * variable renamed and saved is the value it was, byte for byte, whatever this writer would
 * write for it. Null when the bytes are not a whole element whose name this can find.
 *
 * An MCOS object's element (class 17) is renamed as well: its name comes straight after its
 * array flags, with no dimensions before it, and then the type system's name and the object's
 * class, which are kept. Measured against MATLAB R2027a: the file's subsystem holds no
 * variable's name, so an object variable renamed this way loads as the same object, a
 * Simulink.Parameter and a string alike.
 *
 * The name is written as MATLAB writes one, miINT8 with its UTF-8 bytes, in the small form
 * when it is 1 to 4 bytes long (element).
 */
export declare function elementNamed(raw: Uint8Array, name: string): Uint8Array | null;
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
 * Records every complex text in `value`, a value as the text dictionary being read holds it,
 * every dims array that holds an infinity, and every `{_type, _emptyDims}`. Every entry is
 * walked, so the walk allocates nothing and steps over every primitive: 15 ms of the 420 ms a
 * 138 MB dictionary of 140,000 entries takes to read.
 */
export declare function heldByTextDictionary(value: unknown): void;
/**
 * A value as an uncompressed-text dictionary must hold it: every complex value in its
 * plain-text form, at any depth, replaced by the MAT stream MATLAB writes for it there, a
 * binary dictionary's dense empty too, and a real rank >= 3 `Matrix(…)` literal
 * (matrixLiteralVariable), a bare Inf, -Inf or NaN as the typed literal MATLAB writes for it
 * (nonFiniteForm), and everything else as it was. A copy wherever
 * something changed, so the bag a node replays is never touched; the same object where
 * nothing did.
 *
 * MATLAB reads the plain-text form back out of a TEXT dictionary as an empty double
 * (defect 24's signature), and it is the form a binary dictionary and the MCOS decoder
 * hold a complex value in, which an untouched value replays: a Parameter pasted out of a
 * binary dictionary, or copied out of a .mat, went into a text one as
 * `{"_type": "cdata", "_value": "3+4i"}` and MATLAB reopened it as []. At any depth,
 * because the replay is whole bags too — a struct's, a cell's, a LookupTable's Table.
 */
export declare function textDictionaryForm(x: unknown, at?: string): unknown;
/**
 * `{_type, _emptyDims}`, the form an entry's classed or shaped empty took before the binary reader
 * held one under its header, and the form a host still hands in, as that reader holds it now
 * (BinarySlddParser.emptyOf, XmlUtils.BINARY_EMPTY_KEY): of rank 2, so that a text dictionary is
 * given the one spelling of it (heldTextSpelling), and a copy carries its class and size; a double
 * 0x0 `[]`, as both dictionaries hold one. Null for one of rank >= 3, which has a MAT stream of
 * its own, for an extent that is no safe count, and for a class whose name this package's own
 * values give another meaning under `_type` (BinarySlddParser.RESERVED_TYPE), or a char, a struct
 * or a cell, which no reader holds so: the binary one holds a struct's or a cell's empty as its
 * array (BinarySlddParser.structValue, cellValue), and the header's text spelling, `[]` or '',
 * would reopen one as a double or a char 0x0, where its MAT stream reopens as what it is.
 *
 * A string's and a function handle's, which no MAT stream holds, go so too, the function handle's
 * at every rank: a text dictionary is given a string's as the String bag MATLAB reads back as it
 * is, and refuses a function handle's, which MATLAB reads back as it is in no spelling
 * (textEmptySpelling). As the host handed it in, MATLAB read either back as another value, or a
 * struct without the field, and it was written so at a field and in a cell, and `[]` at an entry
 * and at an object's property, a double 0x0. But one the text dictionary holds itself, as it was
 * written there (heldByTextDictionary), is itself: a save that edits nothing writes the file it
 * read.
 *
 * A string's of rank 2 is that String bag here already, not the binary reader's empty: the binary
 * writers build an object's property and a Parameter's Value from this (serializeValue), and spell
 * the bag as MATLAB's own saveobj envelope, which MATLAB reads back as the string it is at a
 * property, where the reader's empty, `Class="string" Dimension="0*3"/>`, reads back as a double
 * 1x1 (test/parity/matlab/host_string_empties_binary.truth.json, R2027a). At a Parameter's Value,
 * where MATLAB holds no empty string, it reads every spelling back as a double 0x0. A copy carries
 * the bag, which a paste into a binary dictionary writes as that envelope too.
 */
export declare function emptyDimsHeldForm(o: Record<string, unknown>): Record<string, unknown> | [] | null;
export {};
//# sourceMappingURL=MatWriter.d.ts.map