import type BaseNode from './BaseNode.js';
import type { PropClass } from './BaseNode.js';
/** What editRefusalText reads of the node an edit was made at. */
export interface EditedRow {
    name: string;
    readonly matlabPath?: string;
    getProperties?(): PropClass[];
}
/**
 * A refusal of an edit of `key` at `node` as a host shows it, naming the row: `reason` itself where
 * it names one already (NAMES_A_ROW), and otherwise `Cannot edit "<row>": <reason>.`, or
 * `Cannot rename "<row>": <reason>.` for its Name, the row its MATLAB path (an entry's name), the
 * reason's own words with one full stop at its end. session.editProperty answers every refusal so;
 * this is for a host that calls a node's setProperty itself, as a dictionary's editor does.
 *
 * Most setters say why and not where: "Invalid MATLAB expression", "Minimum must be a finite real
 * double scalar value", "'x' already exists in values.mat". Shown so, they named no row, and the
 * sweep of the edits a user can make found 6,700 such refusals.
 */
export declare function editRefusalText(node: EditedRow, key: string, reason: string): string;
/** Whether `key` names the node's Name, by its key or its column, as session.editProperty reads one. */
export declare function isNameKey(node: EditedRow, key: string): boolean;
/**
 * A value's size and class with its article, as it is read out: 'a 2x3 double', 'an 8x1 cell',
 * 'an 11x2 struct', where withArticle reads the first letter only.
 */
export declare function withSizeArticle(sized: string): string;
/**
 * Why a struct or an object of `dims` takes no editor of its text, as a clause, in every format
 * alike: 'it is a struct, whose fields are edited one at a time', 'it is a 1x3 struct array, whose
 * elements are edited one at a time', 'it is a Widget, which no text spells'.
 */
export declare function objectWhy(dims: string, cls: string): string;
/**
 * Why the Value of `node` takes no editor (its Value cell is greyed), as a clause, in the words
 * session.valueEditRefusal says it in, `Cannot edit the Value of "<row>": <why>.`, and the node's
 * setter refuses an edit of it (DataNode._offerRefusal): first its source's (a MAT-file's object, one
 * with another node of it), then, of a value shown as a summary, why its text written out whole is
 * no editor's seed (BaseNode._editTextWhy, the D13 ruling), then a value still in the encoded stream
 * it was read from, or read from a MAT stream that is shown and not edited, and else what it shows:
 * no value (a bus, a signal), a summary of what no text spells (a struct, an object), or a value
 * shown by its text.
 */
export declare function valueTakesNoEditWhy(node: BaseNode): string;
//# sourceMappingURL=editRefusal.d.ts.map