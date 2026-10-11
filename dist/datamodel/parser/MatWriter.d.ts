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
 *   - 'past-int32': an extent past MAT_MAX_EXTENT, which no MAT stream's dims word can say.
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
    readonly reason: 'budget' | 'not-a-count' | 'past-int32';
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
 * For the value nothing here can re-encode because the reader never decoded it — one
 * MatParser recorded as `undecoded` — and which a copy out of a .mat or a model workspace
 * into a dictionary would otherwise write as the text of its placeholder. Its bytes are
 * the value; the one thing in them a stream does not carry is the variable's NAME, which a
 * .mat writes into the element and a stream leaves empty, so the name subelement is
 * replaced by the empty one and the element's size restated. Everything else is copied byte for byte. An MCOS opaque (class 17) is not framed this
 * way, and its subsystem lives elsewhere in the file, so it is refused.
 */
export declare function matStreamOfElement(raw: Uint8Array): Uint8Array | null;
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
export {};
//# sourceMappingURL=MatWriter.d.ts.map