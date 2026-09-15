/**
 * The plain half and the searchable half of a Data Type cell.
 *
 * `prefix` carries the qualifier AND the whitespace after it, so `prefix + name`
 * reproduces the text the user was already reading. Trailing whitespace after the name is
 * the one thing dropped — no real cell has any, and keeping it would mean a third field.
 */
export function splitTypeQualifier(text) {
    const colon = text.indexOf(':');
    if (colon < 0) {
        return { prefix: '', name: text.trim() };
    }
    const rest = text.slice(colon + 1);
    const lead = rest.length - rest.trimStart().length;
    return { prefix: text.slice(0, colon + 1 + lead), name: rest.trim() };
}
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
export function typeLinkCell(cellText, resolve) {
    if (typeof cellText !== 'string' || cellText === '') {
        return null;
    }
    const { prefix, name } = splitTypeQualifier(cellText);
    if (name === '') {
        return null;
    }
    const linkTarget = resolve(name);
    if (linkTarget === null || linkTarget === '') {
        return null;
    }
    return prefix === '' ? { text: name, linkTarget } : { prefix, text: name, linkTarget };
}
//# sourceMappingURL=typeLinkCell.js.map