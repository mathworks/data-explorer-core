// Copyright 2026 The MathWorks, Inc.
//
// A bus element that declares neither Complexity nor DimensionsMode now DISPLAYS MATLAB's
// default for it — 'real' and 'Fixed' — where it used to display a blank. MATLAB shows a
// value for those properties on every element it has, because the object always has one;
// only the FILE is silent.
//
// The whole risk in that change is on the save side, and it is the reason this file exists
// separately from busElementEnumEdit.test.ts. The write-back gates read the same node
// fields the display does, and they were `if ('Complexity' in sp || this.Complexity)` — a
// truthiness test that is correct only while an absent property reads as ''. Give the field
// a non-empty default and that test is ALWAYS true, so every untyped element in every
// dictionary would silently gain `Complexity: "real"` and `DimensionsMode: "Fixed"` on the
// next save. Open a file, change nothing, save, get a diff on every element: the failure is
// in a file the user never edited, which is the worst place for it.
//
// So the gates now compare against the default, exactly as DataType's already did, plus a
// `this.X &&` for the CLEAR — emptying the cell stores '' (DataNode._rejectUnknownEnumeral
// keeps '' as a clear rather than refusing it as an illegal enumeral), and '' is not a value
// either enum has, so it means absence here too.
//
// The invariant, stated so it is testable, and it is a BETWEEN-paths one rather than a fact
// about either: what an element DISPLAYS and what it SAVES are now allowed to differ, and
// the display value MATLAB supplies for an absent property must never become a saved key.

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

// arch.sldd's DataInterface bus, whose three elements are exactly the three cases needed:
// Element (Complexity 'real', DimensionsMode 'Fixed' — both declared), Element1 ('complex' /
// 'Variable'), and `a`, whose property bag is just { Name: 'a' } — an element that carries
// neither key, which is also what a freshly added element looks like.
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
// A bus element has ONE serialization method, and both of the parent bus's save paths call
// it (BaseBusNode._getSerializedProperties maps it over the children; its serializeValue
// wraps that) — so this single bag is what reaches the file in either format.
const savedBag = (elem: any) => (elem.serializeValue() as { _properties: Record<string, unknown> })._properties;
const piValue = (node: any, key: string) => (node.toPIObject().objects[0] as Record<string, unknown>)[key];
const cellText = (node: any, column: string): string => {
  const cell = node.toRow()[column];
  return typeof cell === 'string' ? cell : (cell as { text: string }).text;
};

const ENUMS = [
  { prop: 'complexity', field: 'Complexity', dflt: 'real', other: 'complex' },
  { prop: 'dimensionsMode', field: 'DimensionsMode', dflt: 'Fixed', other: 'Variable' },
] as const;

describe('a bus element that declares neither enum property', () => {
  for (const e of ENUMS) {
    it(`displays MATLAB's ${e.field} default in the table and the PI`, () => {
      const { bus } = archBusSession();
      const elem = elementNamed(bus, 'a');
      expect(elem[e.field]).toBe(e.dflt);
      expect(cellText(elem, e.prop)).toBe(e.dflt);
      expect(piValue(elem, e.prop)).toBe(e.dflt);
    });

    it(`does not gain a ${e.field} key on save`, () => {
      // The gate's reach: the display default is not a value the user set, so it is not a
      // value the file learns about.
      const { bus } = archBusSession();
      expect(savedBag(elementNamed(bus, 'a'))).toEqual({ Name: 'a' });
    });

    it(`does not gain a ${e.field} key when the user picks that same default`, () => {
      // Choosing 'real' on an element that was already showing 'real' changes nothing the
      // file has to record. This is the case the `!== default` half of the gate handles.
      const { bus } = archBusSession();
      const elem = elementNamed(bus, 'a');
      expect(elem.setProperty(e.prop, e.dflt)).toBe(true);
      expect(savedBag(elem)).toEqual({ Name: 'a' });
    });

    it(`does not gain a ${e.field} key when an edit is cleared again`, () => {
      // A clear stores '', which the `this.X &&` half reads as absence. Without it the save
      // writes an empty char where MATLAB expects an enumeral.
      const { bus } = archBusSession();
      const elem = elementNamed(bus, 'a');
      expect(elem.setProperty(e.prop, e.other)).toBe(true);
      expect(elem.setProperty(e.prop, '')).toBe(true);
      expect(savedBag(elem)).toEqual({ Name: 'a' });
    });

    it(`still saves a ${e.field} the user really changed`, () => {
      // The other direction the gate can fail in: over-tighten it and an edit made in the
      // UI is dropped on save, surviving only until the file is reopened.
      const { bus } = archBusSession();
      const elem = elementNamed(bus, 'a');
      expect(elem.setProperty(e.prop, e.other)).toBe(true);
      expect(savedBag(elem)[e.field]).toBe(e.other);
    });
  }
});

describe('a bus element that DID declare the enum properties', () => {
  it('shows its own values, not the defaults', () => {
    // A default that overrode a declared value would be the same defect from the other
    // side, and Element1 differs from the default on both properties at once.
    const { bus } = archBusSession();
    expect(elementNamed(bus, 'Element').Complexity).toBe('real');
    expect(elementNamed(bus, 'Element').DimensionsMode).toBe('Fixed');
    expect(elementNamed(bus, 'Element1').Complexity).toBe('complex');
    expect(elementNamed(bus, 'Element1').DimensionsMode).toBe('Variable');
  });

  for (const e of ENUMS) {
    it(`keeps a declared ${e.field} on save even when its value IS the default`, () => {
      // The `key in sp` half: a key MATLAB wrote must survive a save whatever its value, or
      // opening a dictionary and saving it produces a diff — and Element declares both
      // properties AT their defaults, which is exactly the case a default-only gate loses.
      const { bus } = archBusSession();
      const elem = elementNamed(bus, 'Element');
      expect((elem.serial._properties as Record<string, unknown>)[e.field]).toBe(e.dflt);
      expect(savedBag(elem)[e.field]).toBe(e.dflt);
    });

    it(`saves a declared ${e.field} the user set back to the default`, () => {
      // Element1 declares the non-default; setting it to the default must be written, not
      // dropped as "same as absent" — the file said something about this property, so the
      // saved file has to say the new thing.
      const { bus } = archBusSession();
      const elem = elementNamed(bus, 'Element1');
      expect(elem.setProperty(e.prop, e.dflt)).toBe(true);
      expect(savedBag(elem)[e.field]).toBe(e.dflt);
    });
  }
});

describe('the bus as a whole', () => {
  it('adds no element key to a bus nobody edited', () => {
    // Stated over the parent, because that is the object with the save paths: the elements
    // reach a file only inside Elements_internal, and this is the "open, save, no diff"
    // claim at the level a user would see it.
    const { bus } = archBusSession();
    for (const elem of bus.children) {
      const arrived = new Set(Object.keys(elem.serial._properties as Record<string, unknown>));
      // Name is always written (BaseBusElementNode.serializeValue), so it is the one key an
      // element may gain — every fixture element already carries it.
      arrived.add('Name');
      expect(Object.keys(savedBag(elem)).sort()).toEqual([...arrived].sort());
    }
  });
});

for (const format of ['json', 'binary'] as SlddFormat[]) {
  describe(`bus element display defaults — .sldd round trip (${format})`, () => {
    // Through a real MATLAB-written dictionary and both writers, because the defaults are
    // read on the way IN and the gates fire on the way OUT: a re-parse is the only thing
    // that shows the two composing rather than each being right alone.
    function freshMyBus(tag: string) {
      const uri = `test://buselem-defaults-${format}-${tag}.sldd`;
      const model = loadModel(format, 'params.sldd', uri);
      return { model, entry: entryByName(model, uri, 'MyBus') };
    }

    it('an untouched bus round-trips with each element keeping exactly its own keys', () => {
      const { model, entry } = freshMyBus('clean');
      const before = entry.children.map((c: any) => Object.keys(c.serial._properties as Record<string, unknown>).sort());

      const fresh = reparseEntry(serializeModel(model, format), format, 'params.sldd', 'MyBus');
      const after = fresh.children.map((c: any) => Object.keys(c.serial._properties as Record<string, unknown>).sort());
      expect(after).toEqual(before);
    });

    it('an edited element enum survives the round trip while its siblings gain nothing', () => {
      const { model, entry } = freshMyBus('edit');
      const target = entry.children[0];
      const siblingKeysBefore = entry.children
        .slice(1)
        .map((c: any) => Object.keys(c.serial._properties as Record<string, unknown>).sort());
      expect(target.setProperty('complexity', 'complex')).toBe(true);

      const fresh = reparseEntry(serializeModel(model, format), format, 'params.sldd', 'MyBus');
      expect(fresh.children[0].Complexity).toBe('complex');
      expect(fresh.children.slice(1).map((c: any) => Object.keys(c.serial._properties as Record<string, unknown>).sort()))
        .toEqual(siblingKeysBefore);
    });
  });
}
