// Copyright 2026 The MathWorks, Inc.
//
// A Simulink.ValueType's value properties — Dimensions, Complexity, DimensionsMode, Min,
// Max, Unit — and the fact that they are now reachable at all.
//
// The defect this file locks out was not a missing layout entry. `valueType.json` already
// listed `min`, `max` and `unit`, and schemaBridge resolves those three keys through
// ATOM_BY_KEY to PropMin/PropMax/PropUnit, which read the NODE FIELDS `Min`/`Max`/`Unit`.
// ValueTypeNode declared none of them. So the row rendered blank — and, worse, toPIObject
// still added each key to `shownKeys`, which had the "Other" catch-all suppress the raw
// property too. A `"Unit": "m"` sitting in the file was invisible in BOTH panes at once,
// with nothing anywhere reporting an error. `test/parity/artifacts/text/params.sldd`'s
// MyValueType is exactly that dictionary, and it is asserted below.
//
// The shape of that bug is why the tests here read the SAME value through two surfaces and
// compare them to each other rather than each to a literal:
//
//   * the table cell (getProperties → toRow) and the PI row (getPILayout → toPIObject) must
//     show one value, because they are now fed by one node field;
//   * an ABSENT property's default is read on two INDEPENDENT paths — the table column for
//     `dimensionsMode` comes from the schema descriptor's `default` (schemaColumns), the PI
//     from the node field's own fallback — and those two are separately authored, in a JSON
//     file and in a constructor. `Fixed` in one and `auto` in the other is a live defect
//     that no assertion against a literal in only one of them would catch.
//
// MATLAB-measured facts relied on below (probed on R2027a, recorded in the design spec's
// evidence table): a ValueType serializes its unit as `Unit` where a Parameter/Signal uses
// `DocUnits`; an undeclared ValueType is `DataType='double'`, `Complexity='real'`,
// `DimensionsMode='Fixed'` — Fixed, NOT the `auto` a Simulink.Signal defaults to; the
// enums are exactly {real, complex} and {Fixed, Variable}; and a refused assignment is
// reported as "There is no enumerated value named 'X'.".
//
// NOT covered here: that MATLAB reopens a file we wrote and reads these values back. That
// is the live tier (test/parity/matlab/, gated on DEX_MATLAB_CMD) and it has not been run
// against this change. Everything below is in-process.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import ValueTypeNode from '../src/datamodel/node/data/ValueTypeNode.js';
import { schemaColumns } from '../src/datamodel/node/schemaBridge.js';
import { getSchema, hydrate } from '../src/datamodel/schema/index.js';
import {
  loadModel,
  entryByName,
  serializeModel,
  reparseEntry,
  type SlddFormat,
} from './parity/fidelity/roundTripHarness.js';
import '../src/datamodel/node/data/NodeClassMap.js';

// A ValueType built straight from a property bag, which is how the parsers hand one over.
function valueType(properties: Record<string, unknown>): any {
  const rawVal = {
    _array_class: 'Simulink.ValueType',
    _array_type: 'MATLABArray',
    _dimensions: [1, 1],
    _mw_element_type: 'MATLABArray',
    _elements: [{ _properties: properties }],
  };
  return ValueTypeNode.parse(rawVal, 'V', null);
}

// The three surfaces under test, each reduced to what a caller actually sees.
const piValue = (node: any, key: string) => (node.toPIObject().objects[0] as Record<string, unknown>)[key];
const piRowKeys = (node: any, groupTitle: string): string[] => {
  const g = (node.toPIObject().propertySheet.groups as any[]).find((x) => x.displayName === groupTitle);
  return g ? g.items.map((it: any) => it.name) : [];
};
const piGroups = (node: any): string[] => (node.toPIObject().propertySheet.groups as any[]).map((g) => g.displayName);
// An editable generic column arrives as {text, editable, editor, options}; a read-only one
// as a plain string. Both are "what the cell shows", so this collapses the difference.
const cellText = (node: any, column: string): string => {
  const cell = node.toRow()[column];
  return typeof cell === 'string' ? cell : (cell as { text: string }).text;
};

// The two save paths, each reduced to the property bag it puts in the file — the same
// reduction test/absentPropertyWriteBack.test.ts uses, for the same reason: this is a
// question about a KEY SET, not about bytes.
const binaryPath = (node: any) => node._getSerializedProperties() as Record<string, unknown>;
const textFileBag = (node: any) => {
  const sv = node.serializeValue() as { _elements: { _properties: Record<string, unknown> }[] };
  return JSON.parse(JSON.stringify({ p: sv._elements[0]._properties })).p as Record<string, unknown>;
};

// Every property key a MATLAB-written ValueType carries (probe4 wrote one with all of them
// non-default and got these eight, flat — no `*_internal` aliases, unlike a bus element).
const FULL_BAG = {
  Complexity: 'complex',
  DataType: 'uint16',
  Description: 'a speed',
  Dimensions: [1, 3],
  DimensionsMode: 'Variable',
  Max: 100,
  Min: 0,
  Unit: 'm',
};

describe("a ValueType's value properties are reachable", () => {
  it('shows Min, Max and Unit the source carried — the rows that used to render blank', () => {
    // The exact reproduction: before ValueTypeNode declared these fields, all three of
    // these read '' in the PI while the file plainly held the values.
    const n = valueType({ Unit: 'm', Min: 0, Max: 100 });
    expect(piValue(n, 'Min')).toBe('0');
    expect(piValue(n, 'Max')).toBe('100');
    expect(piValue(n, 'Unit')).toBe('m');

    // Min '0' and not '' is the case worth spelling out: a falsy bound is exactly what a
    // `|| ''` fallback or a truthiness gate silently loses.
    expect(n.Min).toBe(0);
    expect(n.Max).toBe(100);
  });

  it('shows Dimensions, Complexity and DimensionsMode the source carried', () => {
    const n = valueType(FULL_BAG);
    expect(piValue(n, 'dimensions')).toBe('[1 3]');
    expect(piValue(n, 'complexity')).toBe('complex');
    expect(piValue(n, 'dimensionsMode')).toBe('Variable');
    expect(piValue(n, 'DataType')).toBe('uint16');
    expect(piValue(n, 'Description')).toBe('a speed');
  });

  it('gives the table the same nine columns a bus element has, reading the same fields', () => {
    // getProperties drives the table; getPILayout drives the PI. Two lists over one set of
    // node fields, so the failure to rule out is a value that appears in one pane only.
    const n = valueType(FULL_BAG);
    expect(n.getProperties().map((p: any) => p.key)).toEqual([
      'Name', 'DataType', 'dimensions', 'complexity', 'dimensionsMode', 'Min', 'Max', 'Unit', 'Description',
    ]);
    for (const [column, key] of [
      ['DataType', 'DataType'], ['dimensions', 'dimensions'], ['complexity', 'complexity'],
      ['dimensionsMode', 'dimensionsMode'], ['Min', 'Min'], ['Max', 'Max'], ['Unit', 'Unit'],
    ] as const) {
      expect(cellText(n, column)).toBe(piValue(n, key));
    }
  });

  it('keeps the PI groups and order the schema layout authored', () => {
    // getPILayout is a node override rather than the schema route (see the comment on it:
    // the two enums are editable node fields, and the schema route would read them from
    // the untouched source bag, so the table and the PI would disagree after an edit).
    // valueType.json's layout stays the authored record of the order, so the override has
    // to reproduce it — this is what stops the two drifting apart unnoticed.
    const n = valueType(FULL_BAG);
    expect(piGroups(n)).toEqual(['General', 'Value Properties']);
    expect(piRowKeys(n, 'General')).toEqual(['Name', 'DataType', 'Kind', 'Class']);
    expect(piRowKeys(n, 'Value Properties')).toEqual([
      'dimensions', 'complexity', 'Min', 'Max', 'Unit', 'dimensionsMode', 'Description',
    ]);
  });

  it('leaves no "Other" group for a ValueType whose every property is modeled', () => {
    // The second half of the original defect: a key the layout claims to show is added to
    // `shownKeys` whether or not the row displayed anything, so an unreadable row also
    // hides the raw value from the catch-all. With all eight keys genuinely shown, "Other"
    // must be empty — and if a future key is added to the file format and not to the node,
    // this is what surfaces it instead of silently swallowing it.
    expect(piGroups(valueType(FULL_BAG))).toEqual(['General', 'Value Properties']);
  });

  it('reads a unit under either spelling, and re-lists neither in "Other"', () => {
    // MATLAB writes a ValueType's unit as `Unit`; a Parameter's and a Signal's as
    // `DocUnits`. Both are read so a file written either way displays, and PropUnit
    // declares both in sourceKeys so the one the file used is not ALSO rendered as a raw
    // "Other" row — a duplicate that would show the same unit twice.
    const canonical = valueType({ Unit: 'm' });
    expect(piValue(canonical, 'Unit')).toBe('m');
    expect(piGroups(canonical)).toEqual(['General', 'Value Properties']);

    const alternate = valueType({ DocUnits: 'm/s' });
    expect(piValue(alternate, 'Unit')).toBe('m/s');
    expect(piGroups(alternate)).toEqual(['General', 'Value Properties']);

    // `Unit` wins when a file somehow carries both, because it is this class's own key.
    expect(valueType({ Unit: 'm', DocUnits: 'm/s' }).Unit).toBe('m');
  });

  it("the schema's own `unit` descriptor points at Unit for a ValueType and DocUnits elsewhere", () => {
    // The node reads both spellings, so nothing above would notice if the schema's
    // per-class `sourcePath` override went missing — and the schema is where the asymmetry
    // is DECLARED, for any consumer that reads a unit through the descriptor rather than
    // through the atom (a class that goes back to the schema PI route, or a `unit` that
    // becomes `projected`). Pinned here so the override is a fact with a test behind it
    // rather than an unobserved line of JSON.
    const unitFor = (cls: string) => getSchema(cls)!.find((p) => p.key === 'unit')!;
    expect(unitFor('Simulink.ValueType').sourcePath).toBe('Unit');
    expect(hydrate({ Unit: 'm' }, unitFor('Simulink.ValueType'))).toBe('m');
    // And the shared descriptor is untouched, so Parameter and Signal still read the key
    // MATLAB writes for THEM — overriding it in place would have broken both.
    expect(unitFor('Simulink.Parameter').sourcePath).toBe('DocUnits');
    expect(unitFor('Simulink.Signal').sourcePath).toBe('DocUnits');
  });

  it("shows params.sldd's MyValueType unit, in both formats", () => {
    // The committed MATLAB-written fixture that demonstrated the bug. The text flavour
    // carries `{ Unit: 'm' }` alone; the binary flavour carries all eight keys, with
    // `Min`/`Max` written as MATLAB's empty (`Dimension="0*0"`, parsed to `[]`).
    for (const format of ['json', 'binary'] as SlddFormat[]) {
      const uri = `test://vt-unit-${format}.sldd`;
      const vt = entryByName(loadModel(format, 'params.sldd', uri), uri, 'MyValueType');
      expect(vt.Unit).toBe('m');
      expect(piValue(vt, 'Unit')).toBe('m');
      // `[]` is MATLAB's empty bound and it is TRUTHY, so left unnormalized it reaches the
      // cell as the text `[]` — a minimum of nothing displayed as a value.
      expect(vt.Min).toBeUndefined();
      expect(cellText(vt, 'Min')).toBe('');
    }
  });
});

describe("an absent property's default, on both paths at once", () => {
  // The table column and the PI read an absent property's default from two separately
  // authored places, and the whole point of these assertions is that they are compared to
  // EACH OTHER. `dimensionsMode` is the live case: it is `projected: true`, so the shared
  // descriptor's default feeds the table, and that default is 'auto' — Simulink.Signal's
  // value, not a ValueType's. valueType.json overrides it to 'Fixed' per class; the node
  // constructor's fallback is the PI's copy of the same fact.
  const schemaDefault = (key: string): string => {
    const col = schemaColumns('Simulink.ValueType').find((c) => c.key === key)!;
    return col.readValue!(valueType({}));
  };

  for (const [key, expected] of [['dimensionsMode', 'Fixed'], ['complexity', 'real']] as const) {
    it(`${key} reads ${expected} from the schema descriptor AND from the node field`, () => {
      const n = valueType({});
      expect(schemaDefault(key)).toBe(piValue(n, key));
      // Both, and not just their agreement: two paths that agree on the wrong value are
      // still wrong, and MATLAB is the arbiter of which value it is.
      expect(schemaDefault(key)).toBe(expected);
    });
  }

  it('an undeclared ValueType displays MATLAB defaults across every value property', () => {
    const n = valueType({});
    expect(n.DataType).toBe('double');
    expect(n.Complexity).toBe('real');
    expect(n.DimensionsMode).toBe('Fixed');
    expect(cellText(n, 'DataType')).toBe('double');
    expect(cellText(n, 'complexity')).toBe('real');
    expect(cellText(n, 'dimensionsMode')).toBe('Fixed');
    // Dimensions has no default MATLAB writes, so it stays blank rather than inventing 1.
    expect(cellText(n, 'dimensions')).toBe('');
    expect(cellText(n, 'Min')).toBe('');
    expect(cellText(n, 'Unit')).toBe('');
  });
});

describe('editing a ValueType value property', () => {
  const ENUMS = [
    { prop: 'complexity', field: 'Complexity', options: ['real', 'complex'], from: 'real', to: 'complex', illegal: 'Real' },
    { prop: 'dimensionsMode', field: 'DimensionsMode', options: ['Fixed', 'Variable'], from: 'Fixed', to: 'Variable', illegal: 'fixed' },
  ] as const;

  for (const e of ENUMS) {
    it(`${e.field} is an editable select carrying MATLAB's enum`, () => {
      const n = valueType({});
      const info = n.getPropInfo(n.getProperties().find((p: any) => p.key === e.prop));
      expect(info.editable).toBe(true);
      expect(info.editor).toBe('select');
      expect(info.options).toEqual(e.options);
    });

    it(`a ${e.field} outside the enum is refused, in MATLAB's own wording`, () => {
      // The refusal matters most for the Property Inspector, which has no combobox and
      // seeds a plain text box: without it 'Real' or 'fixed' would be stored and written
      // into a file MATLAB then declines to load, which is invisible from inside here.
      const n = valueType({});
      expect(n.setProperty(e.prop, e.illegal)).toEqual({
        error: true,
        reason: `There is no enumerated value named '${e.illegal}'.`,
        invalidValue: e.illegal,
        // The value to restore is the one being DISPLAYED, which for an undeclared
        // property is now MATLAB's default rather than a blank.
        validValue: e.from,
      });
      expect(n[e.field]).toBe(e.from);
    });

    it(`an empty ${e.field} clears the property instead of being refused`, () => {
      // '' is not a value either enum has, and it is what emptying the cell submits. It
      // has to get through, because the write-back gate reads it as absence — refusing it
      // would leave the user unable to undo a value back off a file that never had one.
      const n = valueType({});
      expect(n.setProperty(e.prop, e.to)).toBe(true);
      expect(n[e.field]).toBe(e.to);
      expect(n.setProperty(e.prop, '')).toBe(true);
      expect(n[e.field]).toBe('');
    });

    it(`a legal ${e.field} reaches BOTH the table cell and the PI row`, () => {
      // The reason getPILayout is an override: through the schema route these two keys
      // resolve to a descriptor that reads the untouched source bag, so an edit would move
      // the table cell and leave the PI showing the old value.
      const n = valueType({});
      expect(n.setProperty(e.prop, e.to)).toBe(true);
      expect(cellText(n, e.prop)).toBe(e.to);
      expect(piValue(n, e.prop)).toBe(e.to);
    });
  }

  it('Min/Max take the MATLAB-verified finite-real-scalar rule, not the generic numeric path', () => {
    // DataNode's generic numeric branch accepts Inf and NaN; MATLAB's
    // Simulink.DataObject/setPropValue does not. Routing through _setMinMax is what makes
    // a ValueType bound obey the same constraint a Signal's does.
    const n = valueType({});
    expect(n.setProperty('Min', '5')).toBe(true);
    expect(n.Min).toBe(5);
    expect(n.setProperty('Max', 'Inf')).toEqual({
      error: true,
      reason: 'Maximum must be a finite real double scalar value',
      invalidValue: 'Inf',
      validValue: '[]',
    });
    expect(n.Max).toBeUndefined();
    // '' and '[]' both clear, MATLAB's own empty.
    expect(n.setProperty('Min', '')).toBe(true);
    expect(n.Min).toBeUndefined();
  });

  it('Unit stays read-only, for the reason PropUnit records', () => {
    // Simulink parses Unit through a unit-expression parser we cannot replicate, so it is
    // surfaced as a label. Asserted so making it editable is a deliberate act.
    const n = valueType({ Unit: 'm' });
    expect(n.getPropInfo(n.getProperties().find((p: any) => p.key === 'Unit')).editable).toBe(false);
  });

  it('undo of an edit puts the displayed value back, through the session', () => {
    // Undo resubmits the PRIOR value through setProperty, so it meets the same validator
    // the edit did. vtSpeed declares Complexity but not DimensionsMode, which covers both
    // cases in one node: undoing the declared one restores the file's value, undoing the
    // undeclared one restores MATLAB's default — and both have to be values the validator
    // accepts, or the undo reports success and applies nothing.
    const path = fileURLToPath(new URL('./fixtures/typeLink.sldd', import.meta.url));
    const s = createSession();
    const src = s.addDataSource('typeLink.sldd', JSON.parse(readFileSync(path, 'utf8'))) as any;
    const vt = (src.flatten() as any[]).find((n) => n.name === 'vtSpeed' && n.className === 'Simulink.ValueType');
    s.setActiveContext(src);
    s.setActive(src, vt);

    expect(s.editProperty(vt.id, 'complexity', 'complex')).toBe(true);
    expect(s.editProperty(vt.id, 'dimensionsMode', 'Variable')).toBe(true);
    s.undo();
    expect(vt.DimensionsMode).toBe('Fixed');
    s.undo();
    expect(vt.Complexity).toBe('real');
  });
});

describe('what a saved ValueType carries', () => {
  it('invents no key for a ValueType the file declared nothing about, on either path', () => {
    // The gate's whole purpose: open a dictionary, save it with no edits, get no diff. All
    // three defaults here are TRUTHY ('double', 'real', 'Fixed'), so a truthiness gate
    // would write every one of them into a file that never had them.
    const n = valueType({});
    expect(binaryPath(n)).toEqual({});
    expect(textFileBag(n)).toEqual({});
  });

  it('writes every key the file declared straight back, on either path', () => {
    const n = valueType(FULL_BAG);
    expect(binaryPath(n)).toEqual(FULL_BAG);
    expect(textFileBag(n)).toEqual(FULL_BAG);
  });

  it('names the same keys on both paths, whatever the source held', () => {
    // One list, two writers (SimulinkObjectNode's reason for existing). A key written into
    // the binary file and missing from the text one, from the same model in the same
    // session, is the hardest kind of difference to notice — either file looks right alone.
    for (const bag of [{}, FULL_BAG, { Unit: 'm' }, { DocUnits: 'm/s' }, { Min: 0 }]) {
      const n = valueType({ ...bag });
      expect(Object.keys(binaryPath(n)).sort()).toEqual(Object.keys(textFileBag(n)).sort());
    }
  });

  it('persists an edit to each value property, under the key MATLAB uses', () => {
    const n = valueType({});
    expect(n.setProperty('complexity', 'complex')).toBe(true);
    expect(n.setProperty('dimensionsMode', 'Variable')).toBe(true);
    expect(n.setProperty('Min', '0')).toBe(true);
    expect(n.setProperty('Max', '100')).toBe(true);
    expect(binaryPath(n)).toEqual({ Complexity: 'complex', DimensionsMode: 'Variable', Max: 100, Min: 0 });
    expect(textFileBag(n)).toEqual({ Complexity: 'complex', DimensionsMode: 'Variable', Max: 100, Min: 0 });
  });

  it('does not write an enum back just because the user chose MATLAB\'s default', () => {
    // Setting Complexity to 'real' on a file that never declared it leaves the file saying
    // what it always said. This is the case the plain `!== default` gate gets right and a
    // truthiness gate gets wrong.
    const n = valueType({});
    expect(n.setProperty('complexity', 'real')).toBe(true);
    expect(binaryPath(n)).toEqual({});
  });

  it('does not gain an enum key when an edit is cleared again', () => {
    // A clear stores '', which is not a value either property has, so it means absence —
    // the same thing the file already said. Without the `this.X &&` half of the gate this
    // writes `Complexity: ""`, an empty char where MATLAB expects an enumeral.
    const n = valueType({});
    expect(n.setProperty('complexity', 'complex')).toBe(true);
    expect(n.setProperty('complexity', '')).toBe(true);
    expect(binaryPath(n)).toEqual({});
    expect(textFileBag(n)).toEqual({});
  });

  it('writes a cleared bound as MATLAB\'s empty, not as the value the file held', () => {
    // Emptying the Minimum box must not save the old number back — the bound would return
    // on reopen, with the row blank until then.
    const n = valueType({ Min: 5, Max: 9 });
    expect(n.setProperty('Min', '')).toBe(true);
    expect(binaryPath(n).Min).toEqual([]);
    expect(textFileBag(n).Min).toEqual([]);
    expect(binaryPath(n).Max).toBe(9);
  });

  it('writes the unit under the spelling the file used', () => {
    // A ValueType's own key is `Unit`, but a file that came in spelled `DocUnits` keeps
    // that spelling: writing both would leave MATLAB two units to choose between.
    expect(binaryPath(valueType({ Unit: 'm' }))).toEqual({ Unit: 'm' });
    expect(binaryPath(valueType({ DocUnits: 'm/s' }))).toEqual({ DocUnits: 'm/s' });
    expect(textFileBag(valueType({ DocUnits: 'm/s' }))).toEqual({ DocUnits: 'm/s' });
  });
});

for (const format of ['json', 'binary'] as SlddFormat[]) {
  describe(`ValueType value properties — .sldd round trip (${format})`, () => {
    // The half that decides whether an edit reaches the FILE. Both writers serialize from
    // the property bag, not from the node's fields, so an edit never copied across is
    // stored, displayed and then lost on save — with our own reader agreeing with us
    // afterwards, because it re-reads what the file still holds.
    function freshValueType(tag: string) {
      const uri = `test://vt-props-${format}-${tag}.sldd`;
      const model = loadModel(format, 'params.sldd', uri);
      return { model, entry: entryByName(model, uri, 'MyValueType') };
    }

    it('an edited Complexity and DimensionsMode survive serialize + re-parse', () => {
      const { model, entry } = freshValueType('enums');
      expect(entry.setProperty('complexity', 'complex')).toBe(true);
      expect(entry.setProperty('dimensionsMode', 'Variable')).toBe(true);

      const fresh = reparseEntry(serializeModel(model, format), format, 'params.sldd', 'MyValueType');
      expect(fresh.Complexity).toBe('complex');
      expect(fresh.DimensionsMode).toBe('Variable');
    });

    it('an edited Min/Max survives serialize + re-parse, and a clear survives as no bound', () => {
      const { model, entry } = freshValueType('bounds');
      expect(entry.setProperty('Min', '0')).toBe(true);
      expect(entry.setProperty('Max', '100')).toBe(true);

      const edited = reparseEntry(serializeModel(model, format), format, 'params.sldd', 'MyValueType');
      expect(edited.Min).toBe(0);
      expect(edited.Max).toBe(100);

      // Cleared on the node that belongs to `model`, since that is the model serialized
      // below — `edited` is a node in the fresh model reparseEntry just built.
      expect(entry.setProperty('Min', '')).toBe(true);
      const cleared = reparseEntry(serializeModel(model, format), format, 'params.sldd', 'MyValueType');
      expect(cleared.Min).toBeUndefined();
      expect(cleared.Max).toBe(100);
    });

    it('a ValueType nobody edited keeps exactly the keys it arrived with', () => {
      const { entry } = freshValueType('clean');
      const arrived = Object.keys(entry.serial._properties as Record<string, unknown>);
      expect(Object.keys(binaryPath(entry))).toEqual(arrived);
      expect(Object.keys(textFileBag(entry))).toEqual(arrived.filter((k) => k !== '_id'));
    });
  });
}
