// Copyright 2026 The MathWorks, Inc.
//
// The Data Type link rule, as a table.
//
// One dictionary, every case, one assertion — because the failure mode this guards against
// is not an exception, it is a link that quietly stops appearing (or starts appearing on
// the wrong row) while every other test stays green. A table makes both directions visible
// in one diff.
//
// Two of these rows are the whole reason the rule is CLASS-gated rather than name-gated:
// `UsesParamName` names a Simulink.Parameter and `ElemOnly` names a bus ELEMENT, and both
// must stay plain text. Each would otherwise produce a perfectly plausible link to the
// wrong row, which is worse than no link at all.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';

const DICT = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/typeLink.sldd', import.meta.url)), 'utf8'),
) as Record<string, unknown>;

const session = createSession();
// Kept, because `rowsOf` takes the CONTAINER and not the source id — the id is what
// findNodes filters on, and the two are not interchangeable.
const source = session.addDataSource('d.sldd', DICT);
// EXACT-match, deliberately. `findNodes`' `name` criterion is a case-insensitive SUBSTRING
// test (src/core/findQuery.ts — only className and kind compare whole strings), so
// `{ name: 'NumSig' }` also matches `EnumSig`, `{ name: 'Fix' }` matches `ntFix16`, and
// `{ name: 'ElemOnly' }` matches the bus element `elemOnlyType`. It returns document order,
// so in all three cases the WRONG node comes first. Measured against this fixture: 3 of its
// 21 entry names collide that way. Taking `[0]` would silently assert the wrong row — and
// for `NumSig` the wrong row links too, so the failure would read as a broken rule.
const entryNamed = (name: string) => {
  const node = session
    .findNodes({ sourceId: 'd.sldd', name })
    .find((n) => n.name === name && n.isEntry === true);
  if (!node) {
    throw new Error(`the fixture holds no entry named ${name}`);
  }
  return node;
};
const dataTypeOf = (name: string): unknown => entryNamed(name).toRow()!.DataType;

const CASES: Array<[string, string, unknown]> = [
  // entry, why, expected DataType cell
  ['Kp', 'a bare name that names an AliasType', { text: 'adtUint8', linkTarget: 'adtUint8@d.sldd' }],
  ['Ki', 'a second consumer of the same type links to the same row', { text: 'adtUint8', linkTarget: 'adtUint8@d.sldd' }],
  ['NumSig', 'a bare name that names a NumericType', { text: 'ntFix16', linkTarget: 'ntFix16@d.sldd' }],
  ['adtCounter', 'an alias OF an alias, via PropBaseType', { text: 'adtUint8', linkTarget: 'adtUint8@d.sldd' }],
  ['BusSig', 'Bus: qualifier, space after the colon', { prefix: 'Bus: ', text: 'artFsAimCmd', linkTarget: 'artFsAimCmd@d.sldd' }],
  ['TightSig', 'Bus: qualifier, no space', { prefix: 'Bus:', text: 'artFsAimCmd', linkTarget: 'artFsAimCmd@d.sldd' }],
  ['EnumSig', 'Enum: qualifier', { prefix: 'Enum: ', text: 'avtEngSt', linkTarget: 'avtEngSt@d.sldd' }],
  ['QuatSig', 'a qualifier nothing hard-codes', { prefix: 'Quaternion: ', text: 'vtSpeed', linkTarget: 'vtSpeed@d.sldd' }],
  ['Gain', 'a built-in is not an entry', 'double'],
  ['Auto', 'the default type is not an entry', 'auto'],
  ['Dangling', 'a non-built-in nothing here defines', 'sint8'],
  ['Fix', 'an expression, not a name', 'fixdt(1,16,3)'],
  ['ElemOnly', 'names a bus ELEMENT, which is not a definition', 'elemOnlyType'],
  ['UsesParamName', 'names a Simulink.Parameter, which is not a type', 'pmScale'],
  // A Simulink.Signal written with DataType '' reads back as 'auto' — the class defaults it,
  // so this row duplicates `Auto`'s claim from the Signal side rather than covering the
  // empty cell. MEASURED, not assumed: this is what the parsed fixture actually returns.
  ['EmptySig', 'an unset Signal DataType defaults to auto, and auto is not an entry', 'auto'],
  // The genuinely empty cell — a Bus has no Data Type of its own. It is also the sharpest
  // place to make the claim, because `artFsAimCmd` IS a link target (BusSig and TightSig
  // both point at it), so this row additionally pins that the rule never links an entry to
  // itself: an empty cell has nothing to look up, target or not.
  ['artFsAimCmd', 'an empty cell has nothing to look up, even on a link target', ''],
];

describe('the Data Type link rule, case by case', () => {
  it.each(CASES)('%s — %s', (entry, _why, expected) => {
    expect(dataTypeOf(entry)).toEqual(expected);
  });

  it('links exactly the cells the table says it does, and no others', () => {
    // A count, so a rule that started linking something not in the table above fails here
    // rather than passing silently. Every linked row in the whole dictionary is one of the
    // eight CASES rows that expect an object — which is why `Ki` has a row of its own even
    // though it repeats `Kp`'s claim: it links, so leaving it out would put this count one
    // short and fail for a reason that has nothing to do with the rule.
    const linked = session
      .rowsOf(source)
      .filter((r) => typeof r.DataType === 'object' && r.DataType !== null);
    const expectedLinks = CASES.filter(([, , want]) => typeof want === 'object').length;
    expect(linked.length).toBe(expectedLinks);
  });

  it('every link resolves to a node of a type-defining class', () => {
    // The other half of "no dead links": the rule must not produce a target resolveLink
    // cannot follow.
    for (const [entry, , want] of CASES) {
      if (typeof want !== 'object') continue;
      const cell = dataTypeOf(entry) as { linkTarget: string };
      const resolved = session.resolveLink(cell.linkTarget);
      expect(resolved.status, `${entry} resolves`).toBe('resolved');
      expect(
        [
          'Simulink.AliasType',
          'Simulink.NumericType',
          'Simulink.data.dictionary.EnumTypeDefinition',
          'Simulink.Bus',
          'Simulink.ValueType',
        ],
        `${entry} lands on a type definition`,
      ).toContain(resolved.node?.className);
    }
  });
});
