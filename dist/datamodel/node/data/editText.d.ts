import type MatlabVariableNode from './MatlabVariableNode.js';
/** Is `text` a summary (DisplayConvention.summaryForm), which is no value's text? */
export declare function isSummaryText(text: string): boolean;
/**
 * The text of `node`'s value written out whole for an editor (MatlabVariableNode._editText), or why
 * there is none, as a clause: a value no text spells at any size (an N-D array, a struct, an object,
 * a sparse array, a cell holding one), one too long to edit as text, and one whose text would make
 * another value of it (a -0 shows as 0). Judged once of a value, until an edit, an undo or a redo in
 * its entry, or a change in its source of what is in no entry, may have changed it
 * (valueGeneration.keptVerdict).
 */
export declare function wholeText(node: MatlabVariableNode): {
    text: string;
} | {
    why: string;
};
/**
 * `node`'s value as an exact edit of it leaves it: its kind, class and size and each element, a -0
 * told from a 0 and an imaginary part of 0 kept; a MAT-file's string and a dictionary's alike, as
 * their texts. Null for a value no text makes: a struct, an object, a function handle, a sparse
 * array, and a cell holding one.
 */
export declare function valuePrint(node: MatlabVariableNode): string | null;
//# sourceMappingURL=editText.d.ts.map