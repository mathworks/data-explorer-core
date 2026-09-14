// Copyright 2026 The MathWorks, Inc.
//
// The Property Inspector's half of the Data Type link.
//
// The same fact the table renders as a link must not be dead text one pane away, so
// toPIObject carries it too. It travels as `valueLink` and NOT as the `link` the vendored
// PI already understood, because that one anchors the property NAME and mutes the value —
// right for a row whose label is the link, wrong here, where the value is. Nothing in core
// sets `link`, so this is a new field rather than an overloaded one.
//
// And it is the SAME cell the table gets, read from the same _typeLinkCell: two derivations
// of one fact would be free to disagree about which half of `Bus: artFsAimCmd` is the link.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const loadJson = (name: string) => JSON.parse(readFileSync(fixture(name), 'utf8')) as Record<string, unknown>;
const DICT = 'typeLink.sldd';

// EXACT-match, and do not simplify to `[0]`: `findNodes`' `name` criterion is a
// case-insensitive SUBSTRING test in document order (src/core/findQuery.ts — only className
// and kind compare whole strings), so `'Fix'` yields `ntFix16` and `'ElemOnly'` yields the
// bus element `elemOnlyType`. The names below do not collide, but the next one added could.
const entryNamed = (s: ReturnType<typeof createSession>, entry: string) => {
  const node = s.findNodes({ sourceId: 'd.sldd', name: entry }).find((n) => n.name === entry && n.isEntry === true);
  if (!node) {
    throw new Error(`the fixture holds no entry named ${entry}`);
  }
  return node;
};

function piProp(name: string, entry: string): Record<string, unknown> | undefined {
  const s = createSession();
  s.addDataSource('d.sldd', loadJson(DICT));
  const pi = entryNamed(s, entry).toPIObject() as
    | { propertySheet: { properties: Record<string, unknown>[] } }
    | null;
  return pi?.propertySheet.properties.find((p) => p.name === name);
}

describe('toPIObject carries the Data Type link', () => {
  it('sets valueLink on the Data Type property of a resolving entry', () => {
    expect(piProp('DataType', 'Kp')?.valueLink).toBe('adtUint8@d.sldd');
  });

  it('leaves valueLink absent when the type resolves to nothing', () => {
    // Absent, not null or '': the PI reads presence, the same way a row reads a missing
    // UsedBy key rather than an empty list.
    expect(piProp('DataType', 'Gain')?.valueLink).toBeUndefined();
  });

  it('does NOT set the name-anchoring `link` field', () => {
    // Setting `link` would flip piBuilder to type:'link', which anchors the property NAME.
    expect(piProp('DataType', 'Kp')?.link).toBeUndefined();
  });

  it('sets it on no other property', () => {
    expect(piProp('Name', 'Kp')?.valueLink).toBeUndefined();
    expect(piProp('Value', 'Kp')?.valueLink).toBeUndefined();
    expect(piProp('Class', 'Kp')?.valueLink).toBeUndefined();
  });

  it('agrees with the table cell about which half of a qualified value is the link', () => {
    // BusSig is a Simulink.Signal whose DataType reads `Bus: artFsAimCmd`. One derivation,
    // so the PI cannot anchor `Bus: artFsAimCmd` where the table anchors `artFsAimCmd`.
    const s = createSession();
    s.addDataSource('d.sldd', loadJson(DICT));
    const cell = entryNamed(s, 'BusSig').toRow()!.DataType as { linkTarget: string };
    expect(piProp('DataType', 'BusSig')?.valueLink).toBe(cell.linkTarget);
  });

  it('leaves the property untouched on a class with no Data Type in its layout', () => {
    // adtUint8 is a Simulink.AliasType: aliasType.json's layout has BaseType, not dataType.
    // Nothing must be invented for a property the layout does not list.
    expect(piProp('DataType', 'adtUint8')).toBeUndefined();
  });

  // The Data Type COLUMN is not always fed by a prop keyed `DataType`. PropBaseType is
  // keyed `BaseType` and carries `column = 'DataType'`, so an alias's base type reaches
  // the same column by a different key — and toRow, which gates on the column, links it.
  // A PI gating on the key instead would leave exactly the divergence this design exists
  // to prevent, so the gate here derives the column the way toRow does.
  describe('on a prop that reaches the Data Type column under another key', () => {
    it('sets valueLink on an alias BaseType that names a definition', () => {
      expect(piProp('BaseType', 'adtCounter')?.valueLink).toBe('adtUint8@d.sldd');
    });

    it('agrees with the table cell for that same node', () => {
      // Against each other, not two independent literals: this is the assertion that
      // catches a PI gate that has drifted from toRow's.
      const s = createSession();
      s.addDataSource('d.sldd', loadJson(DICT));
      const cell = entryNamed(s, 'adtCounter').toRow()!.DataType as { linkTarget: string };
      expect(piProp('BaseType', 'adtCounter')?.valueLink).toBe(cell.linkTarget);
    });

    it('leaves valueLink absent when the base type is a built-in', () => {
      // adtUint8's base is `uint8`, which no entry defines.
      expect(piProp('BaseType', 'adtUint8')?.valueLink).toBeUndefined();
    });
  });
});
