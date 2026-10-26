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
//# sourceMappingURL=editRefusal.d.ts.map