/**
 * The block's identity within its model: its SID, or its NAME when the file records
 * no SID.
 *
 * The fallback is for the classic `.mdl` before R2010b, which has no SID for
 * anything — those files keep the identity they have always had here, name-merging
 * and all, because there is nothing better in the bytes.
 */
export declare function blockKey(name: string, sid: string): string;
/**
 * What a block reads as in a cell: its name, or `<SID: 65>` when the model gives it
 * none.
 *
 * Angle brackets and the space are deliberate: this is a stand-in for a name, and
 * must not be mistakable for one a user typed. A block with neither a name nor a SID
 * gets '' — there is nothing to say about it, and inventing a label for a case the
 * bytes cannot support would be worse than an empty cell.
 */
export declare function blockLabel(name: string, sid: string): string;
//# sourceMappingURL=blockIdentity.d.ts.map