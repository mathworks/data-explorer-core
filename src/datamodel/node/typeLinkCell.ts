// Copyright 2026 The MathWorks, Inc.
//
// The Data Type cell: which part of it is a link, and which part is text.
//
// A cell reads either a bare type name (`adtUint8`) or a qualified one
// (`Bus: artFsAimCmd`, `Enum: avtEngSt`). Only the name half exists in the dictionary, so
// only the name half is underlined — the qualifier stays plain, and the underline then
// marks exactly the string a user could search for.
//
// The split is on the FIRST colon, and only the remainder is looked up. ONE lookup, never
// two. A dictionary entry name cannot contain a colon, which is what makes that
// unambiguous, and it is also why no qualifier is named here: `Bus`, `Enum`, whatever
// Simulink emits next, all work with no change. A list of known qualifiers would be a
// list to keep topped up in exchange for nothing.
//
// Pure, and deliberately kept out of BaseNode: BaseNode is 9,000 lines and this rule is
// four, so it is the difference between a rule a reader can find and one they cannot.
import type { TypeLinkResolver } from './BaseNode.js';

/**
 * The plain half and the searchable half of a Data Type cell.
 *
 * `prefix` carries the qualifier AND the whitespace after it, so `prefix + name`
 * reproduces the text the user was already reading. Trailing whitespace after the name is
 * the one thing dropped — no real cell has any, and keeping it would mean a third field.
 */
export function splitTypeQualifier(text: string): { prefix: string; name: string } {
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
export function typeLinkCell(
  cellText: string,
  resolve: TypeLinkResolver,
): { prefix?: string; text: string; linkTarget: string } | null {
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
