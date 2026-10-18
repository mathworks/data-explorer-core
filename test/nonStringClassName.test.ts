// Copyright 2026 The MathWorks, Inc.
//
// An object whose class a hand-edited text dictionary names by something that is not a string,
// `{"_object_class": 5}` or `"_array_class": ["a"]`, opens and shows what was read, and is saved
// to a text dictionary as it was read. Its XML, the spelling a binary dictionary holds and a
// paste into one writes, is refused, naming the entry and the path to it, and nothing is written
// (OBJCLASS-NONSTRING; the maintainer's group F ruling, 2026-10-18: a save the writer cannot spell
// is refused rather than written wrong).
//
// MATLAB names every class by a string, and a binary dictionary's reader reads every class from
// an XML attribute, so only a text dictionary holds such a value, and only once someone edits it.
// Every XML writer of an object handed its class to escapeXml, which threw a TypeError for it,
// "str.replace is not a function", and a host showed that as the reason the paste or the save
// failed. An element of an object array that names its own class so was read as one of the
// array's class (DataNode.elementClassOf, which the reader keeps), and was written with the
// array's class, in the XML and in a text save, the class the file gave it gone.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { MatBudgetError, MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { BINARY, copyOf, sparseFixture, thrownBy } from './tools/pasteVenues.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

/** The refusal's whole text, for the class `cls` (as JSON gives it) at `path` of the entry `entry`. */
const refusalText = (entry: string, path: string, cls: string) =>
  `Cannot write "${entry}": ${path} names its class as ${cls}, which is not a class name. Nothing was written.`;

const objectOf = (cls: unknown, props: Record<string, unknown>) => ({
  _array_class: cls,
  _dimensions: [1, 1],
  _elements: [{ _properties: props }],
  _mw_element_type: 'MATLABArray',
});
const arrayOf = (cls: unknown, elements: Record<string, unknown>[]) => ({
  _array_class: cls,
  _dimensions: [1, elements.length],
  _elements: elements.map((e) => ({ ...e, _properties: { ...((e._properties as object) ?? {}) } })),
  _mw_element_type: 'MATLABArray',
});
const widget = (props: Record<string, unknown>) => objectOf('Widget', props);
const parameterOf = (value: unknown) => ({ _array_class: 'Simulink.Parameter', _dimensions: [1, 1], _elements: [{ _properties: { Value: value } }] });
const cellOf = (...elements: unknown[]) => ({ _array_type: 'Cell', _dimensions: [1, elements.length], _elements: elements, _mw_element_type: 'MATLABArray' });
const structOf = (fields: Record<string, unknown>) => ({ _array_type: 'Struct', _dimensions: [1, 1], _elements: [fields] });

// Where a class the value names stands, the value holding it, and the path from the entry the
// refusal names. `c` is the class: an object's own (`_object_class`) or an array's (`_array_class`).
const PLACES: [place: string, value: (c: unknown) => unknown, path: string][] = [
  ["a field of the entry's struct, spelled `_object_class`", (c) => structOf({ f: { _object_class: c, _properties: { A: 1 } }, g: 1 }), '.f'],
  ["a field of the entry's struct, spelled `_array_class`", (c) => structOf({ f: objectOf(c, { A: 1 }), g: 1 }), '.f'],
  ["a field of the entry's struct, an array of two", (c) => structOf({ f: arrayOf(c, [{}, {}]) }), '.f'],
  ['the entry itself', (c) => objectOf(c, { A: 1 }), ''],
  ['the entry itself, empty', (c) => ({ _array_class: c, _dimensions: [0, 0], _elements: [], _mw_element_type: 'MATLABArray' }), ''],
  ['the entry itself, an array of two', (c) => arrayOf(c, [{ _properties: { A: 1 } }, { _properties: { A: 2 } }]), ''],
  [
    'the entry itself, an enumeration value',
    (c) => ({ _array_class: c, _dimensions: [1, 1], _elements: [{ _enum_value: { _type: 'int32', _value: '1' } }], _mw_element_type: 'MATLABArray' }),
    '',
  ],
  ["an element of the entry's cell, spelled `_object_class`", (c) => cellOf({ _object_class: c, _properties: { A: 1 } }, 2), '{1}'],
  ["an element of the entry's cell, spelled `_array_class`", (c) => cellOf(2, objectOf(c, { A: 1 })), '{2}'],
  ["a Simulink.Parameter's Value", (c) => parameterOf({ _object_class: c, _properties: { A: 1 } }), '.Value'],
  ["an object's property", (c) => widget({ P: objectOf(c, { a: 1 }), n: 1 }), '.P'],
  ["an object's property, holding no property", (c) => widget({ P: objectOf(c, {}), n: 1 }), '.P'],
  ["an object's property, empty", (c) => widget({ P: { _array_class: c, _dimensions: [0, 0], _elements: [] }, n: 1 }), '.P'],
  ["an element of a cell in an object's property", (c) => widget({ C: cellOf(objectOf(c, { a: 1 })), n: 1 }), '.C{1}'],
];
// The classes a hand edit can leave that are not a class name, as JSON gives each: a value of no
// class (`null`, `0`, `''`) does not open as an object at all, and is not one of these.
const NOT_CLASSES: [cls: unknown, json: string][] = [
  [5, '5'],
  [{}, '{}'],
  [['a'], '["a"]'],
  [{ x: 1 }, '{"x":1}'],
];

// An element of an object array naming its own class by something that is not a string, which
// was read, and written, as one of the array's class; and the path the refusal names. `o` is the
// element's own class. A `null` one is an element of the array's class too.
const ELEMENTS: [place: string, value: (o: unknown) => unknown, path: string][] = [
  ["the first of the entry's array of two", (o) => arrayOf('Simulink.Signal', [{ _object_class: o }, {}]), '(1)'],
  ["the second of the entry's array of two", (o) => arrayOf('Simulink.Signal', [{}, { _object_class: o }]), '(2)'],
  ['the one element of the entry', (o) => ({ ...objectOf('my.Cls', {}), _elements: [{ _object_class: o, _properties: { A: 1 } }] }), ''],
  ['the one element of a Simulink.Parameter entry', (o) => ({ ...objectOf('Simulink.Parameter', {}), _elements: [{ _object_class: o, _properties: { Value: 1 } }] }), ''],
  ["one of an array at a field of the entry's struct", (o) => structOf({ f: arrayOf('my.Cls', [{}, { _object_class: o }]) }), '.f(2)'],
  ["one of an array in an object's property", (o) => widget({ P: arrayOf('Simulink.Signal', [{ _object_class: o }, {}]), n: 1 }), '.P(1)'],
];
const NOT_OWN_CLASSES: [cls: unknown, json: string][] = [[null, 'null'], ...NOT_CLASSES];

// Each case is an entry of its own, named `e<n>`, of one hand-edited text dictionary.
type Case = { name: string; value: unknown; path: string; json: string };
const cases: Case[] = [];
const caseOf = (value: unknown, suffix: string, json: string): Case => {
  const c = { name: `e${cases.length}`, value: JSON.parse(JSON.stringify(value)), path: '', json };
  c.path = c.name + suffix;
  cases.push(c);
  return c;
};
const placed = PLACES.map(([place, value, suffix]) => ({
  place,
  refused: NOT_CLASSES.map(([cls, json]) => caseOf(value(cls), suffix, json)),
  written: caseOf(value('my.Cls'), suffix, ''),
}));
const elements = ELEMENTS.map(([place, value, suffix]) => ({
  place,
  refused: NOT_OWN_CLASSES.map(([cls, json]) => caseOf(value(cls), suffix, json)),
  written: caseOf(value('mpt.Signal'), suffix, ''),
}));
const long = caseOf(objectOf({ note: 'x'.repeat(100) }, { A: 1 }), '', '');

/** rt_text.sldd with each of `list` appended as an entry, as a hand edit leaves the file. */
const handEdited = (list: Case[]): string => {
  const json = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/rt_text.sldd', import.meta.url)), 'utf8'));
  const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
  list.forEach((c, i) => {
    entries.push({ name: c.name, metadata: { ...entries[0].metadata, uuid: `d43e9523-8ba6-426a-b689-${String(7e11 + i)}` }, value: c.value });
  });
  return JSON.stringify(json, null, '\t');
};
const HAND_EDITED = handEdited(cases);

const openText = (text: string): { session: Any; root: Any } => {
  const session = createSession();
  return { session, root: ingest(session, text, { filename: 'handEdited.sldd' }) };
};
const TEXT = openText(HAND_EDITED);
// rt_text.sldd's entries, and so these, are in its "other" section.
const entryIn = (root: Any, c: Case): Any => root.children.flatMap((s: Any) => s.children).find((e: Any) => e.name === c.name);
const textEntry = (c: Case): Any => entryIn(TEXT.root, c);

// A bus with no elements writes its Elements_internal as an empty array of the class its bag
// names (BaseBusNode._xmlProperties). It is a dictionary of its own, and only its own entry is
// written: a bus's copy, and its text save, carry the Elements_internal its elements make,
// whatever class the bag named, which is not this.
const bus: Case = {
  name: 'bus',
  value: objectOf('Simulink.Bus', { Description: '', Elements_internal: { _array_class: 5, _dimensions: [0, 0], _elements: [] } }),
  path: 'bus.Elements_internal',
  json: '5',
};
const BUS = openText(handEdited([bus]));

let seq = 0;
/** The case's entry, copied as a host copies it, pasted into a fresh sparse_binary.sldd. */
function pastedIntoBinary(c: Case): { session: Any; root: Any; entry: Any } {
  const session = createSession();
  const root: Any = ingest(session, sparseFixture(BINARY), { filename: BINARY });
  const entry = root
    .getSection('design')
    .parseEntry({ name: c.name, metadata: { uuid: `00000000-0000-4000-c1a5-${String(++seq).padStart(12, '0')}` }, value: copyOf(textEntry(c)) });
  return { session, root, entry };
}

/** The entry's XML, a paste of it into a binary dictionary and the save of that are each refused, with exactly `text`. */
function expectRefused(c: Case, text: string): void {
  // The text dictionary's own entry, written as XML, as a paste into a binary dictionary writes it.
  const [direct] = thrownBy(() => serializeEntryToXml(textEntry(c)));
  expect(direct?.name).toBe('MatWriteError');
  expect(direct).toBeInstanceOf(MatWriteError);
  // This writer has no spelling for the class, which is not the budget's refusal.
  expect(direct).not.toBeInstanceOf(MatBudgetError);
  expect(direct!.message).toBe(text);
  // Copied as a host copies it, pasted into a binary dictionary, and saved there.
  const { session, root, entry } = pastedIntoBinary(c);
  const [pasted] = thrownBy(() => serializeEntryToXml(entry));
  expect(pasted).toBeInstanceOf(MatWriteError);
  expect(pasted!.message).toBe(text);
  const [saved] = thrownBy(() => session.serializeSource(root.name));
  expect(saved).toBeInstanceOf(MatWriteError);
  expect(saved!.message).toBe(text);
}

/** The entry's XML, its paste into a binary dictionary and the save of that are written, naming `cls`. */
function expectWritten(c: Case, cls: string): void {
  const xml = serializeEntryToXml(textEntry(c));
  expect(xml).toContain(`Class="${cls}"`);
  const { session, root, entry } = pastedIntoBinary(c);
  const pasted = serializeEntryToXml(entry);
  // The value as the text dictionary's own entry writes it; the entries differ in their UUID.
  expect(pasted.slice(pasted.indexOf('<P Name="Value"'))).toBe(xml.slice(xml.indexOf('<P Name="Value"')));
  expect(session.serializeSource(root.name)!.kind).toBe('binary');
}

describe('a hand-edited text dictionary naming an object\'s class by something that is not a string, opened', () => {
  it('opens with no warning, and shows the object of class 5 as it was read', () => {
    expect(TEXT.root.warnings).toBeUndefined();
    const entry = textEntry(placed[3].refused[0]);
    expect([entry.constructor.name, entry.className, entry.displayValue]).toEqual(['ObjectNode', 5, '<1x1 5>']);
    const field = textEntry(placed[0].refused[0]).children.find((n: Any) => n.name === 'f');
    expect([field.constructor.name, field.className, field.displayValue]).toEqual(['ObjectNode', 5, '<1x1 5>']);
  });

  it('is saved, untouched, as the bytes it was read from', () => {
    const { session, root } = openText(HAND_EDITED);
    const out = session.serializeSource(root.name)!;
    expect(out.kind).toBe('text');
    expect(out.text).toBe(HAND_EDITED);
  });

  it('copies each entry as it was read, an element naming its own class included', () => {
    expect(cases.filter((c) => JSON.stringify(copyOf(textEntry(c))) !== JSON.stringify(c.value)).map((c) => c.path)).toEqual([]);
  });

  it('pasted into another text dictionary and saved, holds each element\'s own class as it was read', () => {
    for (const c of elements.flatMap((e) => e.refused)) {
      const session = createSession();
      const root: Any = ingest(session, sparseFixture('sparse_text.sldd'), { filename: 'sparse_text.sldd' });
      root.getSection('design').parseEntry({ name: c.name, metadata: { uuid: `00000000-0000-4000-c1a6-${String(++seq).padStart(12, '0')}` }, value: copyOf(textEntry(c)) });
      const saved = JSON.parse(session.serializeSource(root.name)!.text!);
      const back = saved.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: Any) => e.name === c.name);
      expect([c.path, back.value]).toEqual([c.path, c.value]);
    }
  });
});

describe('an object whose class is not a string, written as XML', () => {
  for (const { place, refused, written } of placed) {
    it(`at ${place}: refused, naming the entry and the path, for 5, {}, ["a"] and {"x":1}`, () => {
      for (const c of refused) {
        expectRefused(c, refusalText(c.name, c.path, c.json));
      }
    });
    it(`at ${place}: a class named by a string is written, as before`, () => {
      expectWritten(written, 'my.Cls');
    });
  }

  it("at a bus's empty Elements_internal: refused, naming the entry and the path", () => {
    const [thrown] = thrownBy(() => serializeEntryToXml(entryIn(BUS.root, bus)));
    expect(thrown?.name).toBe('MatWriteError');
    expect(thrown!.message).toBe(refusalText(bus.name, bus.path, '5'));
  });

  it('quotes a long class only so far', () => {
    expectRefused(long, refusalText(long.name, long.path, `{"note":"${'x'.repeat(51)}...`));
  });
});

describe('an element of an object array naming its own class by something that is not a string, written as XML', () => {
  for (const { place, refused, written } of elements) {
    it(`${place}: refused, naming the element, for null, 5, {}, ["a"] and {"x":1}, where the array's class was written for it`, () => {
      for (const c of refused) {
        expectRefused(c, refusalText(c.name, c.path, c.json));
      }
    });
    it(`${place}: an element naming its own class by a string is written under it, as before`, () => {
      expectWritten(written, 'mpt.Signal');
    });
  }
});
