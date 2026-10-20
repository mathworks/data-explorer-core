import type { MatRecord, MatVariable } from './MatParser.js';
import { MatWriteError } from './MatWriter.js';
import type BaseNode from '../node/BaseNode.js';
import type MatNode from '../node/container/MatNode.js';
/**
 * The bytes of the MAT-file `matNode` is, as it stands now: what was edited written fresh,
 * everything else as the bytes it was read from. Throws MatWriteError, naming the variable or
 * the file and why, for anything it cannot write as what it is (see the file header), and
 * never hands back bytes that did not read back as planned.
 */
export declare function serializeMatFile(matNode: MatNode): Uint8Array;
/**
 * The refusal of every save of `matNode`, an unedited one included, or null: a tree opened
 * without the records a save writes back, one whose bytes the host has since handed away, and
 * a file whose records do not tile it. Asked first by serializeMatFile, and by the editor, which
 * takes no edit of a file no save can write (MatNode._editRefusal).
 */
export declare function unsavableRefusal(matNode: MatNode): MatWriteError | null;
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
 *
 * A container the node ceiling built without its rows (_cutByCeiling) is written as the variable
 * it was read as (MatlabVariableNode._var), so that variable is what is asked of it, and not its
 * rows, which _matWritable would find none of to refuse: a cell of function handles, cut, said
 * nothing, and its edit was refused by MatWriter at the save.
 */
export declare function unwritableIn(at: BaseNode): {
    path: string;
    what: string;
} | null;
/**
 * The miMATRIX element `record` holds, inflated, or null where it holds no whole one
 * (elementOfRecord): what the subsystem's cells are swapped in (MatNode._mcosSubsystem).
 */
export declare function subsystemElementOf(record: MatRecord): Uint8Array | null;
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