// Copyright 2026 The MathWorks, Inc.
//
// The two bus-element enum properties item 13 unlocked: Complexity ('real' |
// 'complex') and DimensionsMode ('Fixed' | 'Variable'). Both were `editor =
// 'label'` with a comment saying they COULD be editable selects, and this file is
// what turns that from a comment into a contract. Four things per property, because
// each is a different way the unlock could be a lie:
//
//   1. the prop reports as editable, as a DROPDOWN carrying MATLAB's enum — a text
//      box here would invite exactly the values MATLAB refuses;
//   2. an edit through the session's own edit path stores it, and undo puts the old
//      value back (undo submits the PRIOR value, so it goes through the same
//      validator the edit did);
//   3. a value outside the enum is REJECTED, in the {error, reason, invalidValue,
//      validValue} shape DataModel.editProperty hands the property inspector, with
//      MATLAB's own wording;
//   4. the edited value survives serialize + re-parse in BOTH .sldd formats. This
//      is the one that matters most: the value lived on the node, and the writers
//      serialize from the raw property bag, so before _applyElementOverrides was
//      taught to copy it across, an edit was stored, displayed, and then dropped on
//      save — an unlock that changes nothing in the file.
//
// NOT covered here, and not covered anywhere yet: that MATLAB reopens the file and
// reads these values back. That is the live tier
// (test/parity/matlab/writeback.live.test.ts, which now carries a case per
// property), it is gated on DEX_MATLAB_CMD, and it has never been run against this
// change — there is no MATLAB on the machine it was written on. Everything below is
// in-process only.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import {
  loadModel,
  entryByName,
  serializeModel,
  reparseEntry,
  type SlddFormat,
} from './parity/fidelity/roundTripHarness.js';

// One row per unlocked property: the column/prop key an edit arrives under, the node
// field and raw `_properties` key it must land in, the enum, and a value outside it.
// `illegal` is a near miss in each case (wrong case, not a wrong word) because that
// is the failure mode a hand-copied enum actually produces.
const ENUMS = [
  {
    prop: 'complexity',
    field: 'Complexity',
    options: ['real', 'complex'],
    from: 'real',
    to: 'complex',
    illegal: 'Real',
  },
  {
    prop: 'dimensionsMode',
    field: 'DimensionsMode',
    options: ['Fixed', 'Variable'],
    from: 'Fixed',
    to: 'Variable',
    illegal: 'fixed',
  },
] as const;

// arch.sldd's DataInterface bus, whose three elements are exactly the three cases
// needed: Element (Complexity 'real', DimensionsMode 'Fixed'), Element1 ('complex' /
// 'Variable'), and `a`, whose property bag is just { Name: 'a' } — an element that
// carries neither key, which is what a freshly added element looks like too.
function archBusSession() {
  const path = fileURLToPath(new URL('./fixtures/arch.sldd', import.meta.url));
  const s = createSession();
  const src = s.addDataSource('arch.sldd', JSON.parse(readFileSync(path, 'utf8'))) as any;
  const bus = (src.flatten() as any[]).find((n) => n.name === 'DataInterface' && n.className === 'Simulink.Bus');
  if (!bus) throw new Error('no DataInterface bus in arch.sldd');
  s.setActiveContext(src);
  return { s, src, bus };
}

const elementNamed = (bus: any, name: string) => bus.children.find((c: any) => c.name === name);

describe('bus element enum props — the editable surface', () => {
  for (const e of ENUMS) {
    it(`${e.field} reports as an editable select carrying MATLAB's enum`, () => {
      // getPropInfo is what both the table cell and the property inspector row are
      // built from, so `editable: false` here is the whole read-only behaviour and
      // this assertion is the unlock itself.
      const { bus } = archBusSession();
      const elem = elementNamed(bus, 'Element');
      const prop = elem.getProperties().find((p: any) => p.key === e.prop);
      const info = elem.getPropInfo(prop);
      expect(info.editable).toBe(true);
      expect(info.editor).toBe('select');
      expect(info.options).toEqual(e.options);
      expect(info.displayValue).toBe(e.from);
    });

    it(`the ${e.field} table cell carries the dropdown, not a bare string`, () => {
      // toRow emits a plain string for a read-only column and an
      // {text, editable, editor, options} object for an editable generic one, so this
      // is how a host learns to open a combobox rather than render text.
      const { bus } = archBusSession();
      const row = elementNamed(bus, 'Element').toRow();
      expect(row[e.prop]).toEqual({
        text: e.from,
        editable: true,
        editor: 'select',
        options: e.options,
      });
    });
  }

  it('the value each atom reads is the one MATLAB wrote, per element', () => {
    // Guards against an edit path that writes the right value into the wrong place:
    // the two elements differ on both properties, so a field/key mix-up shows up as
    // one element wearing the other's value.
    const { bus } = archBusSession();
    expect(elementNamed(bus, 'Element').Complexity).toBe('real');
    expect(elementNamed(bus, 'Element').DimensionsMode).toBe('Fixed');
    expect(elementNamed(bus, 'Element1').Complexity).toBe('complex');
    expect(elementNamed(bus, 'Element1').DimensionsMode).toBe('Variable');
  });
});

describe('bus element enum props — editing through the session', () => {
  for (const e of ENUMS) {
    it(`editProperty stores a legal ${e.field}, and undo/redo round-trips it`, () => {
      const { s, src, bus } = archBusSession();
      const elem = elementNamed(bus, 'Element');
      s.setActive(src, elem);

      expect(s.editProperty(elem.id, e.prop, e.to)).toBe(true);
      expect(elem[e.field]).toBe(e.to);

      // Undo submits the captured prior value through setProperty, so it meets the
      // same validator the edit did — a validator that refused it would leave the
      // undo silently unapplied while reporting success.
      s.undo();
      expect(elem[e.field]).toBe(e.from);
      s.redo();
      expect(elem[e.field]).toBe(e.to);
    });

    it(`editProperty refuses a ${e.field} outside the enum and changes nothing`, () => {
      const { s, src, bus } = archBusSession();
      const elem = elementNamed(bus, 'Element');
      s.setActive(src, elem);

      // MATLAB's own wording for the assignment it refuses, probed on the live
      // object and recorded in Simulink.BusElement.md.
      expect(s.editProperty(elem.id, e.prop, e.illegal)).toEqual({
        error: true,
        reason: `There is no enumerated value named '${e.illegal}'.`,
        invalidValue: e.illegal,
        validValue: e.from,
      });
      expect(elem[e.field]).toBe(e.from);
      // A rejected edit changed nothing, so it must not leave an undo step behind.
      expect(s.canUndo()).toBe(false);
    });

    it(`a near-miss ${e.field} is refused for the CASE alone`, () => {
      // The casing is not ours to normalise: MATLAB wrote 'real' lower case and
      // 'Fixed' capitalised, and it refuses the other spelling of each. Accepting a
      // case-insensitive match here would write a value MATLAB rejects on load,
      // which is invisible from inside this package.
      const { bus } = archBusSession();
      const elem = elementNamed(bus, 'Element');
      const wrongCase = e.to === e.to.toLowerCase() ? e.to.toUpperCase() : e.to.toLowerCase();
      const result = elem.setProperty(e.prop, wrongCase);
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(elem[e.field]).toBe(e.from);
    });

    it(`an empty ${e.field} clears the property instead of being refused`, () => {
      // The one non-enumeral value that must get through, because it is what undo of
      // an edit to an element that never carried the property submits.
      const { bus } = archBusSession();
      const elem = elementNamed(bus, 'a');
      expect(elem[e.field]).toBe('');

      expect(elem.setProperty(e.prop, e.to)).toBe(true);
      expect(elem[e.field]).toBe(e.to);
      expect(elem.setProperty(e.prop, '')).toBe(true);
      expect(elem[e.field]).toBe('');
    });

    it(`an element that never carried ${e.field} does not gain the key on save`, () => {
      // The write-back guard is `'<key>' in sp || this.<field>`, so an untouched
      // element — or one edited and then cleared — must serialize without the key.
      // A phantom key is a spurious diff on every save of a file the user only
      // opened, and for these two it would also be an empty char where MATLAB
      // expects an enumeral.
      const { bus } = archBusSession();
      const elem = elementNamed(bus, 'a');
      const clean = elem.serializeValue() as Record<string, unknown>;
      expect(e.field in (clean._properties as Record<string, unknown>)).toBe(false);

      expect(elem.setProperty(e.prop, e.to)).toBe(true);
      expect(elem.setProperty(e.prop, '')).toBe(true);
      const cleared = elem.serializeValue() as Record<string, unknown>;
      expect(e.field in (cleared._properties as Record<string, unknown>)).toBe(false);
    });
  }
});

// The half that decides whether the unlock reaches the FILE. Both writers serialize
// from the element's raw property bag, not from the node's fields, so an edit that is
// never copied into that bag is stored, displayed, and then lost on save — with our
// own reader agreeing with us afterwards, because it re-reads the value the file
// still holds. Run for both formats: the JSON dump and serializeEntryToXml are
// independent writers (the reason defect 30 survived the fix for defect 29).
for (const format of ['json', 'binary'] as SlddFormat[]) {
  describe(`bus element enum props — .sldd round trip (${format})`, () => {
    function freshMyBus(tag: string) {
      const uri = `test://buselem-enum-${format}-${tag}.sldd`;
      const model = loadModel(format, 'params.sldd', uri);
      return { model, entry: entryByName(model, uri, 'MyBus') };
    }

    for (const e of ENUMS) {
      it(`an edited ${e.field} survives serialize and re-parse`, () => {
        const { model, entry } = freshMyBus(e.field);
        const elem = entry.children[0];
        expect(elem.name).toBe('x');
        expect(elem[e.field]).toBe(e.from);

        expect(elem.setProperty(e.prop, e.to)).toBe(true);
        const fresh = reparseEntry(serializeModel(model, format), format, 'params.sldd', 'MyBus');
        expect(fresh.children[0][e.field]).toBe(e.to);
        // And the sibling still holds what MATLAB wrote, so the edit went to one
        // element rather than to the class.
        expect(fresh.children[1][e.field]).toBe(e.from);
      });
    }

    it('both properties edited at once survive together', () => {
      // Each is written by its own guarded line in _applyElementOverrides, so one
      // working is not evidence that both do.
      const { model, entry } = freshMyBus('both');
      const elem = entry.children[0];
      expect(elem.setProperty('complexity', 'complex')).toBe(true);
      expect(elem.setProperty('dimensionsMode', 'Variable')).toBe(true);

      const fresh = reparseEntry(serializeModel(model, format), format, 'params.sldd', 'MyBus');
      expect(fresh.children[0].Complexity).toBe('complex');
      expect(fresh.children[0].DimensionsMode).toBe('Variable');
    });

    it('an unedited bus round-trips with the values MATLAB wrote', () => {
      // The control: if the write-back turned every element's enum into '' or into
      // the first option, the assertions above would still pass.
      const { model, entry } = freshMyBus('control');
      expect(entry.children[0].Complexity).toBe('real');
      const fresh = reparseEntry(serializeModel(model, format), format, 'params.sldd', 'MyBus');
      expect(fresh.children.map((c: any) => c.Complexity)).toEqual(['real', 'real']);
      expect(fresh.children.map((c: any) => c.DimensionsMode)).toEqual(['Fixed', 'Fixed']);
    });
  });
}
