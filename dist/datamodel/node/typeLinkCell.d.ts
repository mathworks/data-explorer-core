import type { TypeLinkResolver } from './BaseNode.js';
/**
 * The plain half and the searchable half of a Data Type cell.
 *
 * `prefix` carries the qualifier AND the whitespace after it, so `prefix + name`
 * reproduces the text the user was already reading. Trailing whitespace after the name is
 * the one thing dropped — no real cell has any, and keeping it would mean a third field.
 */
export declare function splitTypeQualifier(text: string): {
    prefix: string;
    name: string;
};
/**
 * The linked form of a Data Type cell, or null when it stays a plain string.
 *
 * Null, rather than a cell with no `linkTarget`, is what keeps an unlinked cell a plain
 * STRING in the row — which is what it has always been, so nothing about the far
 * majority of rows changes shape.
 *
 * `prefix` is OMITTED when empty rather than set to `''`: an unqualified linked cell then
 * pools with every other one (see RowCellPool), and one value has one shape.
 */
export declare function typeLinkCell(cellText: string, resolve: TypeLinkResolver): {
    prefix?: string;
    text: string;
    linkTarget: string;
} | null;
//# sourceMappingURL=typeLinkCell.d.ts.map