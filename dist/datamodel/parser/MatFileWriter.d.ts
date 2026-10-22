import type { MatRecord, MatVariable } from './MatParser.js';
import { MatWriteError } from './MatWriter.js';
import type { MatCheckOptions } from './MatFileCheck.js';
import { type McosSubsystemRecords, type McosVerifyOptions } from './McosSubsystemCodec.js';
import type BaseNode from '../node/BaseNode.js';
import type MatNode from '../node/container/MatNode.js';
/**
 * The bytes of the MAT-file `matNode` is, as it stands now: what was edited written fresh,
 * everything else as the bytes it was read from. Throws MatWriteError, naming the variable or
 * the file and why, for anything it cannot write as what it is (see the file header), and
 * never hands back bytes that did not read back as planned.
 *
 * `check` is the budget of the check of what was written (MatFileCheck), its own by default:
 * for tests, which cannot make a file a gigabyte past it.
 */
export declare function serializeMatFile(matNode: MatNode, check?: MatCheckOptions): Uint8Array;
/**
 * The refusal of every save of `matNode`, an unedited one included, or null: a tree opened
 * without the records a save writes back, one whose bytes the host has since handed away, and
 * a file whose records do not tile it. Asked first by serializeMatFile, and by the editor, which
 * takes no edit of a file no save can write (MatNode._editRefusal).
 */
export declare function unsavableRefusal(matNode: MatNode): MatWriteError | null;
/**
 * One value cell a save wrote into a subsystem, and the value it was written from: of an edit of
 * an object's property, in a MAT-file (MatNode._objectSubsystemEdit) or in a dictionary value's
 * stream (mcosStreamEdit).
 */
export interface McosWrittenCell {
    objectId: number;
    cellIndex: number;
    savedName: string;
    value: MatVariable;
}
export declare function subsystemOf(matNode: MatNode, records: MatRecord[]): MatRecord | null;
/** Why the edit of a variable stored after the subsystem is refused (planOf, and the editor's gate). */
export declare const PAST_SUBSYSTEM: string;
/**
 * The refusal of a save of a file with an unnamed record that is not its subsystem, or whose
 * header puts its subsystem where no unnamed record starts, or null: such a save cannot place
 * what it writes where MATLAB reads it. Measured against MATLAB R2027a, MATLAB lists no variable
 * past the first unnamed record, and a header offset that is not the subsystem's fails the whole
 * load. Asked only of a save that changes the file: one that does not hands back the bytes it was
 * read from. So the editor asks it of every edit (MatNode._editRefusal).
 */
export declare function structureRefusal(matNode: MatNode, records: MatRecord[], subsystem: MatRecord | null): MatWriteError | null;
/** Why a variable is not written under `name`, which another variable of the file has (refuseDuplicates, and the editor's gate). */
export declare function duplicateWhy(name: string): string;
/**
 * Why the variable read from `record` cannot be renamed, or null where it can: its record is not
 * one whole element whose name can be replaced (elementOfRecord, MatWriter.elementNamed), which a
 * record MATLAB writes always is. Asked by renamedOf, and by a rename before it is made
 * (MatNode._renameRefusal), once a record: the records never change, and asking inflates one.
 */
export declare function renameWhy(record: MatRecord): string | null;
/**
 * The refusal a save throws for writing `node` fresh, the variable `record` became or one added
 * since (no record), or null where nothing about what it is refuses it: what an edit of anything
 * of it but its own name asks of a save. A name that is no MATLAB name by the rule a rename is
 * held to; a variable that was not a plain value, or whose node is a typed object's (freshOf); one
 * holding what this writer cannot write at any depth (unwritableIn); one with no form at all, a
 * container none of whose elements could be read (_heldNone) or a size that is no count
 * (_refuseNoSize); one holding a container read short at any depth (shortIn); and one stored in
 * a form MATLAB does not load as it is (storedRefusal).
 *
 * One rule for freshOf, which throws it, and for the editor, which takes no edit a save would
 * refuse so (MatNode._editRefusal): the two cannot come to disagree. What it does not judge is
 * what only the value's bytes say, MatWriter's budget among them, which freshElement meets.
 */
export declare function freshRefusal(node: BaseNode, record: MatRecord | null): MatWriteError | null;
/**
 * The first node at or under `at` that MatWriter cannot write as what it is (the rule of
 * MatlabVariableNode._matWritable), with its MATLAB path and what it is, or null for none. Asked
 * by freshRefusal, and by the editor of a value about to be typed in (MatNode._valueRefusal).
 * An MCOS object in a cell or a struct is written as the element it was read as, and is none of
 * these, but where that element is not one objectElementOf passes through (`why` says so).
 *
 * A container the node ceiling built without its rows (_cutByCeiling) is written as the variable
 * it was read as (MatlabVariableNode._var), so that variable is what is asked of it, and not its
 * rows, which _matWritable would find none of to refuse: a cell of function handles, cut, said
 * nothing, and its edit was refused by MatWriter at the save.
 */
export declare function unwritableIn(at: BaseNode): {
    path: string;
    what: string;
    why?: string;
} | null;
/**
 * The class-17 element a save writes for `v`, an MCOS object held in a struct field or a cell of a
 * variable it writes fresh, or why it writes none, as a clause naming it under `path`: the element
 * the object was read as (MatVariable._objectElement, which the node layer hands over for a typed
 * object's node, or the reader's own: a struct field's _rawBytes, a cell element's
 * MatParser.opaqueElementOf), which names the same objects of the file's subsystem. Only where it
 * is the element this package writes for the handle it holds (McosSubsystemCodec.
 * objectReferenceElement): the handle read (its dims and ids), the class row word beside them, an
 * empty name, 'MCOS' and the class name. Measured on every object held in a struct field of the
 * repo's fixtures, 79 of 79 over 60 files, each is so, MATLAB's element byte for byte; and one
 * that is not is not passed through, rather than written as bytes this package cannot say name
 * the objects they named.
 */
export declare function objectElementOf(v: MatVariable, path: string): {
    element: Uint8Array;
} | {
    why: string;
};
/**
 * The miMATRIX element `record` holds, inflated, or null where it holds no whole one
 * (elementOfRecord): what the subsystem's cells are swapped in (MatNode._mcosSubsystem).
 */
export declare function subsystemElementOf(record: MatRecord): Uint8Array | null;
/**
 * The miCOMPRESSED record of `stream`, the zlib stream of the variable `name`'s element: its tag
 * and the stream. Refused for a stream of 4 GiB or more, whose length the tag's 32 bits cannot
 * say: written, its length would wrap, and the record would declare a few bytes of a stream that
 * goes on. Exported for test/matFileSave.test.ts, which holds it to that without a stream so big.
 */
export declare function compressedRecordOf(stream: Uint8Array, name: string): Uint8Array;
/**
 * Where `element`, a subsystem a save wrote, is not `original`, the one it was read as, with `cells`
 * written into it, in words of `objects` (what the caller calls them: "the file's objects"), or
 * null where it is: it reads whole as a subsystem (its dims [1 N] its byte count among what that
 * asks); every byte the rewrite copies around the cells is the byte it was (copiedDiffer); its
 * metadata blob is the bytes it was, and so every object's class, property list and the cell each
 * property names; every cell written is a value cell of it, written once, and reads as the value it
 * was written from, and every cell not written is the bytes it was; and McosParser, which every
 * object of the file is shown through, reads the same table of objects out of it. The self-check of
 * a MAT-file's subsystem (selfCheck) and of a dictionary value's stream (mcosStreamEdit), which are
 * one check.
 */
export declare function subsystemCellsDiffer(original: Uint8Array | null, element: Uint8Array, cells: readonly McosWrittenCell[], objects: string): string | null;
/**
 * Where `element`, a subsystem a save wrote, is not the subsystem `records` hold, with `cells`
 * written into it, in words of `objects`, or null where it is: it reads back through the codec as
 * exactly those records (McosSubsystemCodec.verifySubsystem: every string in its place, every row,
 * list, triple and value cell the one meant, every offset landing, every object reference naming
 * what is there; against `original`, the records it was read as, nothing renumbered and nothing
 * changed no edit writes; and, with `options`, every object and property no edit names as it was,
 * and each variable created naming objects of its own); and each cell written, swapped or new, is a
 * value cell of it, written once, and reads as the value it was written from.
 */
export declare function subsystemRecordsDiffer(element: Uint8Array, records: McosSubsystemRecords, cells: readonly McosWrittenCell[], objects: string, original?: McosSubsystemRecords, options?: McosVerifyOptions): string | null;
/**
 * Where the value read back, `read`, is not the value `model` it was written from, in words naming
 * it under `at`, or null where it is that value: the same class, complexity, storage and size, the
 * same members of a cell, the same fields of a struct in the same order, and each element the same
 * number as its class holds it. MatWriter's own rules are taken as the model's meaning, not its
 * result: an integer element as MATLAB converts it to the class, a single's as a float32, a member
 * a cell or a struct does not hold as the empty double written for it. The self-check's (selfCheck)
 * judge of a value written fresh, and the editor's of an object's property against the cell the
 * file holds it in (mcosObjectEdit).
 */
export declare function variableDifference(model: MatVariable | null | undefined, read: MatVariable | null | undefined, at: string): string | null;
//# sourceMappingURL=MatFileWriter.d.ts.map