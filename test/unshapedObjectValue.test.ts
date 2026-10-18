// Copyright 2026 The MathWorks, Inc.
//
// A hand-edited text dictionary whose value, at an entry, a struct field or a cell element, is a
// JSON object of no shape MATLAB writes: `{"foo": 1}`, `{}`, or a class marker left with no class,
// `{"_array_class": null, ...}` or `{"_object_class": null, ...}`. It opens, shows the JSON it holds
// and says so in one warning for the entry, and is saved to a text dictionary as it was read. Its
// XML, the spelling a binary dictionary holds and a paste into one writes, is refused, naming the
// entry and the path to it, and nothing is written (G1-OBJTAIL; the maintainer's group F rulings of
// 2026-10-18: a save the writer cannot spell is refused rather than written wrong, and malformed
// input warns and shows what was read).
//
// Such an object was read as a double scalar holding the object (MatlabVariableNode.parseScalar),
// shown as String() of it, `[object Object]`, with an editor and no warning, and written in the
// double's own XML, `<P Name="Value" Class="double">[object Object]</P>`. MATLAB (R2027a) opens the
// file and reads no value from it: a 1x0 double at an entry, the struct without the field, a 0x0
// char in a cell. As an object's property or a Simulink.Parameter's Value the same object was
// already refused by the property writer (C-205), but its row showed `[object Object]` too.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { MatBudgetError, MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { BINARY, TEXT as SPARSE_TEXT, copyOf, sparseFixture, thrownBy } from './tools/pasteVenues.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

/** The refusal's whole text: the object at `path` of `entry`, described as `what`. */
const refusalText = (entry: string, path: string, what: string) =>
  `Cannot write "${entry}": ${path} is ${what}, which a binary dictionary has no spelling for. Nothing was written.`;
/** The warning for an entry holding one such object, shown as `shown`, at `path`. */
const warningText = (entry: string, path: string, shown: string) =>
  `"${entry}" holds ${shown}${path === entry ? '' : ' at ' + path}, which is not a value MATLAB writes; it is shown as read.`;

const structOf = (fields: Record<string, unknown>) => ({ _array_type: 'Struct', _dimensions: [1, 1], _elements: [fields] });
const cellOf = (...elements: unknown[]) => ({ _array_type: 'Cell', _dimensions: [1, elements.length], _elements: elements, _mw_element_type: 'MATLABArray' });
const widget = (props: Record<string, unknown>) => ({ _array_class: 'Widget', _dimensions: [1, 1], _elements: [{ _properties: props }], _mw_element_type: 'MATLABArray' });
const parameterOf = (value: unknown) => ({ _array_class: 'Simulink.Parameter', _dimensions: [1, 1], _elements: [{ _properties: { Value: value } }] });

// The objects a hand edit can leave: the value, what the row shows (the JSON it holds, cut at 60
// characters), and how the refusal describes it (DataNode._unspellable's words).
const OBJECTS: [value: unknown, shown: string, what: string][] = [
  [{ foo: 1 }, '{"foo":1}', 'an object holding "foo"'],
  [{}, '{}', 'an object holding no key'],
  [
    { _array_class: null, _dimensions: [1, 1], _elements: [{ _properties: { A: 1 } }] },
    '{"_array_class":null,"_dimensions":[1,1],"_elements":[{"_pro...',
    'an object holding "_array_class", "_dimensions", "_elements"',
  ],
  [{ _object_class: null, _properties: { A: 1 } }, '{"_object_class":null,"_properties":{"A":1}}', 'an object holding "_object_class", "_properties"'],
  [{ _type: 'double' }, '{"_type":"double"}', 'an object holding "_type"'],
];

// Where the object stands, the entry's value holding it, the path from the entry to it, and the
// row that shows it (from the entry).
type Place = [place: string, value: (v: unknown) => unknown, suffix: string, row: (entry: Any) => Any];
const child = (name: string) => (n: Any) => n.children.find((c: Any) => c.name === name);
const PLACES: Place[] = [
  ['the entry itself', (v) => v, '', (e) => e],
  ["a field of the entry's struct", (v) => structOf({ f: v, g: 1 }), '.f', child('f')],
  ["an element of the entry's cell", (v) => cellOf(2, v), '{2}', child('2')],
  ["an element of a cell at a field of the entry's struct", (v) => structOf({ c: cellOf(v) }), '.c{1}', (e) => child('1')(child('c')(e))],
];
// Where the property writer refused it already (C-205): only the row was wrong.
const REFUSED_BEFORE: Place[] = [
  ["an object's property", (v) => widget({ P: v, n: 1 }), '.P', child('P')],
  ["a Simulink.Parameter's Value", (v) => parameterOf(v), '.Value', (e) => e],
];

// Each case is an entry of its own, named `e<n>`, of one hand-edited text dictionary.
type Case = { name: string; value: unknown; path: string; shown: string; what: string; row: (entry: Any) => Any; derived?: boolean };
const cases: Case[] = [];
const caseOf = (value: unknown, suffix: string, shown: string, what: string, row: (entry: Any) => Any, derived = false): Case => {
  const name = `e${cases.length}`;
  const c = { name, value: JSON.parse(JSON.stringify(value)), path: name + suffix, shown, what, row, derived };
  cases.push(c);
  return c;
};
const placed = (list: Place[]) =>
  list.map(([place, value, suffix, row]) => ({ place, cases: OBJECTS.map(([v, shown, what]) => caseOf(value(v), suffix, shown, what, row)) }));
const PLACED = placed(PLACES);
const PROPERTIES = placed(REFUSED_BEFORE);
// Two in one entry: one warning, which counts them and names the first.
const two = caseOf(structOf({ f: { foo: 1 }, h: {} }), '.f', '{"foo":1}', 'an object holding "foo"', child('f'));
// Where a writer other than the XML's was asked for it: an Architectural Data entry, which is a
// Simulink.data.dictionary Constant; a cell holding a sparse array too, which the XML writes as one
// MAT stream; and an N-D cell, which a text dictionary holds only as its stream once it is edited.
const FOO: [string, string] = ['{"foo":1}', 'an object holding "foo"'];
const constant = caseOf({ foo: 1 }, '', ...FOO, (e) => e, true);
const withSparse = caseOf(cellOf({ foo: 1 }, { _type: 'sparse', _value: 'Matrix(2,2)\n[[0, 1]; [0, 0]]' }), '{1}', ...FOO, child('1'));
const nd = caseOf({ _array_type: 'Cell', _dimensions: [1, 1, 2], _elements: [{ foo: 1 }, 2], _mw_element_type: 'MATLABArray' }, '{1}', ...FOO, child('1'));
const OTHER_WRITERS = [constant, withSparse, nd];
// A spellable entry beside them, which is written.
const spellable = caseOf(structOf({ f: 1, g: 'a' }), '', '', '', (e) => e);

/** rt_text.sldd with each of `list` appended as an entry, as a hand edit leaves the file. */
const handEdited = (list: Case[]): string => {
  const json = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/rt_text.sldd', import.meta.url)), 'utf8'));
  const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
  list.forEach((c, i) => {
    const metadata = { ...entries[0].metadata, uuid: `d43e9523-8ba6-426a-b689-${String(7e11 + i)}`, ...(c.derived ? { isderived: '1' } : {}) };
    entries.push({ name: c.name, metadata, value: c.value });
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

let seq = 0;
/** The case's entry, copied as a host copies it, pasted into a fresh `file`. */
function pastedInto(file: string, c: Case): { session: Any; root: Any; entry: Any } {
  const session = createSession();
  const root: Any = ingest(session, sparseFixture(file), { filename: file });
  const entry = root
    .getSection('design')
    .parseEntry({ name: c.name, metadata: { uuid: `00000000-0000-4000-c1a7-${String(++seq).padStart(12, '0')}` }, value: copyOf(textEntry(c)) });
  return { session, root, entry };
}

/** The entry's XML, a paste of it into a binary dictionary and the save of that are each refused, with exactly `text`. */
function expectRefused(c: Case, text: string): void {
  // The text dictionary's own entry, written as XML, as a paste into a binary dictionary writes it.
  const [direct] = thrownBy(() => serializeEntryToXml(textEntry(c)));
  expect(direct?.name).toBe('MatWriteError');
  expect(direct).toBeInstanceOf(MatWriteError);
  // This writer has no spelling for the value, which is not the budget's refusal.
  expect(direct).not.toBeInstanceOf(MatBudgetError);
  expect(direct!.message).toBe(text);
  const { session, root, entry } = pastedInto(BINARY, c);
  const [pasted] = thrownBy(() => serializeEntryToXml(entry));
  expect(pasted).toBeInstanceOf(MatWriteError);
  expect(pasted!.message).toBe(text);
  const [saved] = thrownBy(() => session.serializeSource(root.name));
  expect(saved).toBeInstanceOf(MatWriteError);
  expect(saved!.message).toBe(text);
}

describe('a hand-edited text dictionary holding an object of no MATLAB shape, opened', () => {
  for (const { place, cases: list } of [...PLACED, ...PROPERTIES]) {
    it(`at ${place}: shows the JSON it holds, and takes no editor`, () => {
      for (const c of list) {
        const row = c.row(textEntry(c));
        expect([c.path, row.displayValue]).toEqual([c.path, `<${c.shown}>`]);
        expect([c.path, row.valueEditable]).toEqual([c.path, false]);
      }
    });
  }

  it('as an Architectural Data Constant, in a cell beside a sparse array, and in an N-D cell: shows the JSON it holds, and takes no editor', () => {
    expect(textEntry(constant).constructor.name).toBe('ConstantNode');
    for (const c of OTHER_WRITERS) {
      const row = c.row(textEntry(c));
      expect([c.path, row.displayValue, row.valueEditable]).toEqual([c.path, '<{"foo":1}>', false]);
    }
  });

  it('says so in one warning for each entry holding one, naming the first and how many there are', () => {
    const expected = [...PLACED, ...PROPERTIES]
      .flatMap((p) => p.cases)
      .map((c) => ({ code: 'part-unreadable', message: warningText(c.name, c.path, c.shown), part: c.name }));
    expected.push({
      code: 'part-unreadable',
      message: `"${two.name}" holds 2 values that are not values MATLAB writes; the first is {"foo":1} at ${two.path}, and each is shown as read.`,
      part: two.name,
    });
    for (const c of OTHER_WRITERS) {
      expected.push({ code: 'part-unreadable', message: warningText(c.name, c.path, c.shown), part: c.name });
    }
    expect(TEXT.root.warnings).toEqual(expected);
  });

  it('is saved, untouched, as the bytes it was read from', () => {
    const { session, root } = openText(HAND_EDITED);
    const out = session.serializeSource(root.name)!;
    expect(out.kind).toBe('text');
    expect(out.text).toBe(HAND_EDITED);
  });

  it('copies each entry as it was read', () => {
    expect(cases.filter((c) => JSON.stringify(copyOf(textEntry(c))) !== JSON.stringify(c.value)).map((c) => c.path)).toEqual([]);
  });

  it('keeps the object as read when a sibling field is edited and the text dictionary saved', () => {
    const { session, root } = openText(HAND_EDITED);
    const c = PLACED[1].cases[0];
    const entry = entryIn(root, c);
    expect(entry.children.find((n: Any) => n.name === 'g').setProperty('Value', '3')).toBe(true);
    const saved = JSON.parse(session.serializeSource(root.name)!.text!);
    const back = saved.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: Any) => e.name === c.name);
    expect(back.value._elements[0]).toEqual({ f: { foo: 1 }, g: 3 });
  });

  it('pasted into another text dictionary and saved, holds the object as it was read', () => {
    for (const c of PLACED.flatMap((p) => p.cases)) {
      const { session, root } = pastedInto(SPARSE_TEXT, c);
      const saved = JSON.parse(session.serializeSource(root.name)!.text!);
      const back = saved.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: Any) => e.name === c.name);
      expect([c.path, back.value]).toEqual([c.path, c.value]);
    }
  });

  it('shows a value no JSON spells, handed in by a host, by its keys, and does not throw', () => {
    const session = createSession();
    const root: Any = ingest(session, sparseFixture(SPARSE_TEXT), { filename: SPARSE_TEXT });
    const entry = root.getSection('design').parseEntry({ name: 'hosted', metadata: { uuid: '00000000-0000-4000-c1a7-ffffffffffff' }, value: { a: 1, b: 2n } });
    expect(entry.displayValue).toBe('<{"a", "b"}>');
    expect(entry.valueEditable).toBe(false);
  });
});

describe('an object of no MATLAB shape, written as XML', () => {
  for (const { place, cases: list } of PLACED) {
    it(`at ${place}: refused, naming the entry and the path, where it was written as [object Object]`, () => {
      for (const c of list) {
        expectRefused(c, refusalText(c.name, c.path, c.what));
      }
    });
  }

  it('two in one entry: the first is the one named', () => {
    expectRefused(two, refusalText(two.name, two.path, two.what));
  });

  for (const { place, cases: list } of PROPERTIES) {
    it(`at ${place}: refused, as before`, () => {
      for (const c of list) {
        expectRefused(c, refusalText(c.name, c.path, c.what));
      }
    });
  }

  it('as an Architectural Data Constant: refused, naming the entry', () => {
    expectRefused(constant, refusalText(constant.name, constant.path, constant.what));
  });

  it('in a cell beside a sparse array: refused, where the cell was written as one MAT stream holding it as 0', () => {
    expectRefused(withSparse, refusalText(withSparse.name, withSparse.path, withSparse.what));
  });

  it('in an N-D cell: refused, where it was written as [object Object]', () => {
    expectRefused(nd, refusalText(nd.name, nd.path, nd.what));
  });

  it('in an N-D cell edited at a sibling: the text save, which holds the cell only as its MAT stream, is refused, where it held the object as 0', () => {
    const { session, root } = openText(HAND_EDITED);
    expect(entryIn(root, nd).children.find((n: Any) => n.name === '2').setProperty('Value', '3')).toBe(true);
    const [thrown] = thrownBy(() => session.serializeSource(root.name));
    expect(thrown).toBeInstanceOf(MatWriteError);
    expect(thrown).not.toBeInstanceOf(MatBudgetError);
    expect(thrown!.message).toBe(
      `Cannot write "${nd.name}": ${nd.name} is a 1x1x2 cell, which a text dictionary holds only as its MAT stream, and that stream cannot be written: `
        + 'an object of no shape MATLAB writes, {"foo":1}, which MatWriter has no variable for. Nothing was written.',
    );
  });

  it('a spellable entry beside them is written, as before', () => {
    const xml = serializeEntryToXml(textEntry(spellable));
    expect(xml).toContain('<P Name="f" Class="double">1.0</P>');
    const { session, root } = pastedInto(BINARY, spellable);
    expect(session.serializeSource(root.name)!.kind).toBe('binary');
  });
});
