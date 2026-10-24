// Copyright 2026 The MathWorks, Inc.
//
// An object copied out of a MAT-file and pasted into a dictionary, as a host pastes one
// (SectionNode.parseEntry), held as MATLAB holds it there: by the properties MATLAB saves alone.
// A MAT-file's object holds, beside what it saves, what MATLAB shows of it under other names
// (mcosShown: a NumericType's Signed, FractionLength and Slope, a CoderInfo's Identifier), and the
// copy carried them into the dictionary's file, `Signed` a key MATLAB has no property of. MATLAB
// loaded the entry the same with and without them (R2027a, 2026-10-24); it never writes them.
//
// Held so, the entry shows every row it showed in the MAT-file, before a save and after, as a
// dictionary's rows show what it saves (mcosShown.shownPropertiesOf). A shown key that says other
// than the saved keys it is shown of is not one a copy makes, and is kept as it came. In a binary
// dictionary a CoderInfo is held in the order MATLAB writes one there, its StorageClass before its
// Alias and Alignment: MATLAB R2027a reads a binary dictionary's properties in order, and lost an
// Alignment set before the StorageClass (8 read as -1), the order an R2027a MAT-file saves a
// CoderInfo in. A text dictionary is read whatever the order. And a dictionary's own entries are
// as the file holds them: an unedited save is the file.
//
// Measured on 2026-10-24: the 57 Parameters, Signals, LookupTables, Breakpoints and NumericTypes
// of the MAT fixtures, pasted so into a text and a binary dictionary, loaded in MATLAB R2027a with
// no warning, each property isequaln to the source MAT-file's and each of the CoderInfo's equal;
// and aligned_coderinfo.mat's two kept their Alignment and Identifier in both.
import { describe, it, expect } from 'vitest';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { getSectionMetadata } from '../src/datamodel/SectionConstants.js';
import { BINARY_CASES, TEXT_CASES, bufferOf, copyOf, fixture, rowsOf, sameBytes } from './tools/matPaste.js';
import { withoutShownOfSaved } from '../src/datamodel/node/mcosShown.js';

type Any = any;

// MAT-files holding NumericTypes and CoderInfos of every saved form: R2027a's MCOS objects, and
// the 'handle' CoderInfo of R2023b and R2024b.
const SOURCES = [
  'test/fixtures/shown-saved/shown_saved.mat',
  'test/fixtures/shown-saved/aligned_coderinfo.mat',
  'test/fixtures/mcos/Numeric.mat',
  'test/fixtures/mcos-rules-parity/originals/r23_ntsaf.mat',
  'test/fixtures/mcos-rules-parity/originals/r27_ntauto.mat',
  'test/fixtures/mcos-handle/r2023b/exp_ci_pexp_id.mat',
  'test/fixtures/mcos-handle/r2024b/exp_ci_s0_combo2.mat',
];
const OBJECTS = /^Simulink\.(NumericType|Parameter|Signal)$/;

/** Every NumericType and CoderInfo bag under `value`, by its class: the keys a dictionary would write of each. */
function objectBags(value: unknown, out: { className: string; bag: Record<string, unknown> }[] = []): { className: string; bag: Record<string, unknown> }[] {
  if (value === null || typeof value !== 'object') {
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((v) => objectBags(v, out));
    return out;
  }
  const o = value as Any;
  if (typeof o._array_class === 'string' && Array.isArray(o._elements)) {
    for (const e of o._elements) {
      if (e && typeof e === 'object' && e._properties) {
        out.push({ className: e._object_class ?? o._array_class, bag: e._properties });
      }
    }
  } else if (typeof o._object_class === 'string' && o._properties) {
    out.push({ className: o._object_class, bag: o._properties });
  }
  Object.values(o).forEach((v) => objectBags(v, out));
  return out;
}

/** The keys of `value` a dictionary holds beside the saved keys they are shown of, each named by its class. */
function shownKeysHeld(value: unknown): string[] {
  return objectBags(value).flatMap(({ className, bag }) => {
    if (className === 'Simulink.NumericType') {
      return ['Signed', 'FractionLength', 'Slope'].filter((k) => k in bag && 'FixedExponent' in bag).map((k) => className + '.' + k);
    }
    if (className === 'Simulink.CoderInfo') {
      return 'Identifier' in bag && 'Alias' in bag ? ['Simulink.CoderInfo.Identifier'] : [];
    }
    return [];
  });
}

/** `payload` pasted into the dictionary `path` as a host pastes one: the entry made, the file saved, and the entry read back from it. */
function pasted(path: string, payload: Any) {
  const session = createSession();
  const root: Any = ingest(session, bufferOf(fixture(path)), { filename: 'cases.sldd' });
  const section = root.getSection('design');
  const raw = structuredClone(payload);
  raw.name = section._uniqueName(raw.name);
  raw.metadata = { uuid: '00000000-0000-4000-8000-000000000001', ...getSectionMetadata(section.name) };
  // parseEntry adds the entry it reads to the section.
  const node = section.parseEntry(raw);
  section._markSourceDirty();
  const out: Any = session.serializeSource(root.name);
  const bytes = out.kind === 'text' ? new TextEncoder().encode(out.text) : new Uint8Array(out.bytes);
  const again: Any = ingest(createSession(), bufferOf(bytes), { filename: 'cases.sldd' });
  return { node, back: again.children.flatMap((s: Any) => s.children).find((e: Any) => e.name === raw.name), text: out.kind === 'text' ? (out.text as string) : null };
}

function matObjects(path: string): Any[] {
  return (createSession().addMatSource(path, bufferOf(fixture(path))) as Any).children.filter((e: Any) => OBJECTS.test(e.className));
}

describe('an object copied out of a MAT-file, pasted into a dictionary', () => {
  it('is held, and saved, by the keys MATLAB saves alone, and shows every row it showed', () => {
    let copies = 0;
    for (const source of SOURCES) {
      for (const entry of matObjects(source)) {
        const copy = copyOf(entry);
        // What the copy carries, which the paste is held to drop.
        expect(shownKeysHeld(copy.value).length, source + ' ' + entry.name).toBeGreaterThan(0);
        copies++;
        for (const file of [TEXT_CASES, BINARY_CASES]) {
          const label = source + ' ' + entry.name + ' into ' + file;
          const { node, back, text } = pasted(file, copy);
          expect(shownKeysHeld(node.serialize().value), label).toEqual([]);
          expect(shownKeysHeld(back.serialize().value), label + ' (saved)').toEqual([]);
          if (text) {
            expect(text, label).not.toMatch(/"Signed":/);
          }
          expect(rowsOf(node), label).toEqual(rowsOf(entry));
          expect(rowsOf(back), label + ' (saved)').toEqual(rowsOf(entry));
        }
      }
    }
    expect(copies).toBe(12);
  });

  it("holds a CoderInfo's StorageClass before the Alias and the Alignment MATLAB takes only under it, in a binary dictionary", () => {
    const file = BINARY_CASES;
    for (const entry of matObjects('test/fixtures/shown-saved/aligned_coderinfo.mat')) {
      const { node, back } = pasted(file, copyOf(entry));
      for (const n of [node, back]) {
        const ci = n.serial._properties.CoderInfo;
        const keys = Object.keys(ci._properties ?? ci._elements[0]._properties);
        expect(keys.indexOf('StorageClass'), file + ' ' + entry.name).toBeLessThan(keys.indexOf('Alias'));
        expect(keys.indexOf('StorageClass'), file + ' ' + entry.name).toBeLessThan(keys.indexOf('Alignment'));
      }
    }
  });

  it('keeps a shown key that says other than what it is shown of, as it came', () => {
    const [ntBp] = matObjects(SOURCES[0]);
    const copy = copyOf(ntBp);
    copy.value._elements[0]._properties.Signed = 'Unsigned';
    const { node } = pasted(TEXT_CASES, copy);
    expect(node.serial._properties.Signed).toBe('Unsigned');
    expect('FractionLength' in node.serial._properties).toBe(false);
  });
});

describe('a value whose keys include __proto__', () => {
  it('keeps it its own key, on a bag the rule drops a shown key of and on one it walks into', () => {
    const numericType = '{"_array_class":"Simulink.NumericType","_elements":[{"_properties":{"SignednessBool":true,"FixedExponent":-8,"SlopeAdjustmentFactor":1,"Signed":"Signed","FractionLength":8,"Slope":0.00390625}}]}';
    // A struct field named __proto__ holding a NumericType, and a NumericType whose bag holds one.
    const value = JSON.parse('{"__proto__":' + numericType + ',"other":1}');
    const bag = JSON.parse('{"__proto__":' + numericType + ',"SignednessBool":true,"FixedExponent":0,"SlopeAdjustmentFactor":1,"Signed":"Signed"}');
    const nested = { _array_class: 'Simulink.NumericType', _elements: [{ _properties: bag }] };
    for (const [out, ownOf] of [
      [withoutShownOfSaved(value) as Any, (o: Any) => o],
      [withoutShownOfSaved(nested) as Any, (o: Any) => o._elements[0]._properties],
    ] as const) {
      const holder = ownOf(out);
      expect(Object.getPrototypeOf(holder)).toBe(Object.prototype);
      expect(Object.prototype.hasOwnProperty.call(holder, '__proto__')).toBe(true);
      expect(Object.keys(Object.getOwnPropertyDescriptor(holder, '__proto__')!.value._elements[0]._properties).sort()).toEqual(['FixedExponent', 'SignednessBool', 'SlopeAdjustmentFactor']);
    }
    expect('Signed' in withoutShownOfSaved(nested)._elements[0]._properties).toBe(false);
  });
});

describe("a dictionary's own entries", () => {
  it('are saved unedited as the file holds them, shown keys a hand wrote among them', () => {
    const file = 'test/fixtures/shown-saved/shown_saved_text.sldd';
    const session = createSession();
    const root: Any = ingest(session, bufferOf(fixture(file)), { filename: 'shown_saved_text.sldd' });
    expect(sameBytes(new TextEncoder().encode((session.serializeSource(root.name) as Any).text), fixture(file))).toBe(true);
    // A NumericType written by hand with the Signedness and FractionLength MATLAB shows, and no
    // saved key they are shown of: read back from its save with them.
    const hand = createSession();
    const typeLink: Any = ingest(hand, bufferOf(fixture('test/fixtures/typeLink.sldd')), { filename: 'typeLink.sldd' });
    const bagOf = (r: Any) => r.children.flatMap((s: Any) => s.children).find((e: Any) => e.name === 'ntFix16').serial._properties;
    const saved: Any = ingest(createSession(), bufferOf(new TextEncoder().encode((hand.serializeSource(typeLink.name) as Any).text)), { filename: 'typeLink.sldd' });
    expect(bagOf(saved)).toEqual(bagOf(typeLink));
    expect([bagOf(saved).Signedness, bagOf(saved).FractionLength]).toEqual(['Signed', 3]);
  });
});
