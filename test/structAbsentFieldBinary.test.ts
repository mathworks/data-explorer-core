// Copyright 2026 The MathWorks, Inc.
//
// A struct some of whose elements do not hold a field the struct has, pasted into a BINARY
// dictionary at a place core writes a struct from its bag rather than from its rows
// (DataNode._structXml): a Simulink.Parameter's Value, an object's property, and a struct in a cell
// or in a field there (B-17). Graded against what MATLAB R2027a read back
// (test/parity/matlab/probe_struct_absent_fields_binary.m, which opens the dictionaries
// struct_absent_fields_binary.mjs saves through core's API, and writes
// struct_absent_fields_binary.truth.json).
//
// A text dictionary is JSON anyone can edit, so an element can be `null` or `{}`, or hold only some
// of the struct's fields. MATLAB reads each field an element does not hold as [], and core's
// StructNode shows it so (structAbsentField.test.ts). The raw writer wrote each element with only
// the fields it holds: `<Element></Element>` for `{}` or `null`. MATLAB fills a field another
// element holds, by name, so most of those read back right; but a struct of one element lost its
// field (`struct()` with no fields where the source reads `a = []`), and a struct whose first
// element lacks a field read back with its fields in another order. So did a struct whose elements
// hold every field in another order than its `_fields`, as MATLAB's own text dictionaries hold them
// (keys sorted): MATLAB reads the text in `_fields` order, a binary dictionary in the order its
// first element is written in. Each field the struct has (its `_fields`, or element 1's keys, as
// StructNode reads them) is now written in the struct's order, an absent one as []
// (`Class="double" Dimension="0*0"`), then any other the element holds, which is what StructNode
// writes, and MATLAB reads every case as it reads the source.
//
// At a Parameter's Value MATLAB holds no struct with an empty field (PrmInvalidStruct,
// parameter_value_truth.json): it reads the text source of every such case, and the binary save,
// as a double 0x0. Written as held, a struct of one element read back as a struct with no fields.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { createSession, ingest } from '../src/index.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Place = 'param' | 'prop' | 'pcell' | 'pfield';
type Reads = { error: string } | { class: string; size: number[]; fields?: string[]; elements?: unknown[] };
type Row = { id: string; form: string; place: Place; name: string; spelling: string; reads: Reads };

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const TRUTH: { release: string; rows: Row[] } = JSON.parse(readFileSync(at('./parity/matlab/struct_absent_fields_binary.truth.json'), 'utf8'));
const BINARY = new Uint8Array(readFileSync(at('./fixtures/lossy_empties_readback_binary.sldd')));
const buffer = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const PLACES: Place[] = ['param', 'prop', 'pcell', 'pfield'];
const PREFIX: Record<Place, string> = { param: 'p_', prop: 'w_', pcell: 'c_', pfield: 's_' };

const S = (elements: unknown[], fields?: string[]) => ({
  _array_type: 'Struct',
  _dimensions: [1, elements.length],
  _elements: elements,
  ...(fields ? { _fields: fields } : {}),
  _mw_element_type: 'MATLABArray',
});
// The structs MATLAB was asked about, as held (struct_absent_fields_binary.mjs's CASES).
const ABSENT: Record<string, ReturnType<typeof S>> = {
  A2: S([{ a: 1 }, {}]),
  N2: S([{ a: 1 }, null]),
  A1: S([{}], ['a']),
  N1: S([null], ['a']),
  F2: S([{ a: 1, b: 2 }, { b: 3 }]),
  L2: S([{ b: 2 }, { a: 1, b: 3 }], ['a', 'b']),
  X2: S([{ a: 1 }, { b: 2 }]),
};
// Every field held, in another order than `_fields`, as MATLAB's own text dictionaries hold their
// structs (the keys sorted, `_fields` in the struct's order).
const REORDERED: Record<string, ReturnType<typeof S>> = { R1: S([{ a: 1, b: 2 }], ['b', 'a']), R2: S([{ a: 1, b: 2 }, { a: 3, b: 4 }], ['b', 'a']) };
// Every element holding every field, in its order, as MATLAB writes a struct.
const WHOLE: Record<string, ReturnType<typeof S>> = { C2: S([{ a: 1 }, { a: [] }]), C1: S([{ a: 1 }]), C3: S([{ a: 1 }, { a: 2 }]) };

const row = (id: string, form: string, place: Place): Row => {
  const r = TRUTH.rows.find((x) => x.id === id && x.form === form && x.place === place);
  expect(r, id + ' ' + form + ' ' + place).toBeDefined();
  return r!;
};
/** MATLAB's reading of `spelling` at `place`, or undefined if it was never asked. */
const matlabRead = (place: Place, spelling: string): Reads | undefined => TRUTH.rows.find((r) => r.place === place && r.form !== 'text' && r.spelling === spelling)?.reads;

// Where the struct at each place opens in the entry's XML (the last tag of the match), as
// struct_absent_fields_binary.mjs finds it.
const OPENS: Record<Place, RegExp> = {
  param: /<Element Class="Simulink.Parameter">\s*<P Name="Value"[^>]*>/,
  prop: /<P Name="Scalar"[^>]*>/,
  pcell: /<P Name="Scalar" Class="cell"[^>]*>\s*<Element[^>]*>/,
  pfield: /<P Name="Scalar"[^>]*>\s*<Element[^>]*>\s*<P Name="f"[^>]*>/,
};
/** The element of `xml` at `place` in entry `name`, through its close, with no whitespace between tags. */
function spellingIn(xml: string, name: string, place: Place): string {
  const from = xml.indexOf('>' + name + '<');
  const m = OPENS[place].exec(xml.slice(from));
  if (from < 0 || !m) {
    return '?';
  }
  const start = from + m.index + m[0].lastIndexOf('<');
  const tag = /<(\/?)[^>]*?(\/?)>/g;
  tag.lastIndex = start;
  let depth = 0;
  for (let t = tag.exec(xml); t; t = tag.exec(xml)) {
    depth += t[1] ? -1 : t[2] ? 0 : 1;
    if (depth === 0) {
      return xml.slice(start, tag.lastIndex).replace(/>\s+</g, '><');
    }
  }
  return '?';
}

/** The value of an entry holding `v` at `place`; the Parameter and the Widget are MATLAB's own, copied out of the file. */
function valueAt(bin: any, place: Place, v: ReturnType<typeof S>): unknown {
  const copied = (section: string, name: string) => JSON.parse(JSON.stringify(bin.getSection(section).children.find((e: any) => e.name === name).serialize().value));
  if (place === 'param') {
    const p = copied('design', 'p_D022');
    p._elements[0]._properties.Value = v;
    p._elements[0]._properties.Dimensions = v._dimensions;
    return p;
  }
  const w = copied('other', 'w_D022');
  w._elements[0]._properties.Scalar =
    place === 'prop' ? v : place === 'pcell' ? { _array_type: 'Cell', _dimensions: [1, 1], _elements: [v], _mw_element_type: 'MATLABArray' } : S([{ f: v }], ['f']);
  return w;
}

/** Every row under the entry's property at `place` (Value or Scalar), by path, with the value it shows. */
function rowsAt(root: any, name: string, place: Place): string[] {
  const entry = root.children.flatMap((s: any) => s.children).find((e: any) => e.name === name);
  const top = entry?.children?.find((c: any) => c.name === (place === 'param' ? 'Value' : 'Scalar'));
  const out: string[] = [];
  const walk = (n: any, path: string): void => {
    out.push(path + ' = ' + String(n.displayValue));
    for (const c of n.children) {
      walk(c, path + '/' + c.displayName);
    }
  };
  if (top) {
    walk(top, top.displayName);
  }
  return out;
}

let seq = 0;
/** `v` pasted at `place` into MATLAB's binary dictionary, as a host pastes, the dictionary saved and reopened. */
function pastedAndSaved(id: string, place: Place, v: ReturnType<typeof S>): { spelling: string; shown: string[]; reopened: string[] } {
  const name = PREFIX[place] + id;
  const session = createSession();
  const bin: any = ingest(session, buffer(BINARY), { filename: 'lossy_empties_readback_binary.sldd' });
  const into = bin.getSection(place === 'param' ? 'design' : 'other');
  into.parseEntry({ name, metadata: { ...into.children[0].metadata, uuid: '00000000-0000-4000-a951-' + String(++seq).padStart(12, '0') }, value: valueAt(bin, place, JSON.parse(JSON.stringify(v))) });
  const shown = rowsAt(bin, name, place);
  const bytes = new Uint8Array(session.serializeSource(bin.name)!.bytes!);
  const spelling = spellingIn(strFromU8(unzipSync(bytes)['data/chunk0.xml']), name, place);
  const reopened = rowsAt(ingest(createSession(), buffer(bytes), { filename: 'resaved.sldd' }), name, place);
  return { spelling, shown, reopened };
}

describe("a struct with a field an element does not hold, pasted into a binary dictionary, graded against MATLAB's reading", () => {
  it("the truth is MATLAB's: each absent field written as [] in the struct's order reads as the source does, and only so", () => {
    expect(TRUTH.release).toBe('2027a');
    expect(TRUTH.rows.length).toBe(144);
    const wrong: string[] = [];
    for (const id of [...Object.keys(ABSENT), ...Object.keys(REORDERED)]) {
      for (const place of PLACES) {
        const source = row(id, 'text', place).reads;
        if (JSON.stringify(row(id, 'filled', place).reads) !== JSON.stringify(source)) {
          wrong.push(id + ' ' + place + ' filled');
        }
      }
    }
    expect(wrong).toEqual([]);
    // Written as held, a struct of one element loses its field everywhere, and one whose first
    // element lacks a field reads its fields in another order; so does the [] put after what the
    // element holds.
    const differs = (id: string, form: string, place: Place) => JSON.stringify(row(id, form, place).reads) !== JSON.stringify(row(id, 'text', place).reads);
    expect(PLACES.filter((p) => differs('A1', 'held', p) && differs('N1', 'held', p))).toEqual(PLACES);
    expect(row('A1', 'held', 'prop').reads).toMatchObject({ class: 'struct', size: [1, 1], fields: [] });
    expect(row('A1', 'text', 'prop').reads).toMatchObject({ class: 'struct', size: [1, 1], fields: ['a'] });
    expect(PLACES.filter((p) => differs('L2', 'held', p))).toEqual(['prop', 'pcell', 'pfield']);
    expect(PLACES.filter((p) => differs('L2', 'appended', p))).toEqual(['prop', 'pcell', 'pfield']);
    expect(row('L2', 'held', 'prop').reads).toMatchObject({ fields: ['b', 'a'] });
    expect(row('L2', 'text', 'prop').reads).toMatchObject({ fields: ['a', 'b'] });
    // MATLAB reads a text dictionary's struct in its `_fields` order, and a binary one's in the
    // order its first element is written in.
    for (const id of Object.keys(REORDERED)) {
      expect(PLACES.filter((p) => differs(id, 'held', p)), id).toEqual(PLACES);
      expect(row(id, 'text', 'prop').reads, id).toMatchObject({ fields: ['b', 'a'] });
      expect(row(id, 'held', 'prop').reads, id).toMatchObject({ fields: ['a', 'b'] });
    }
    // A Parameter's Value with an empty field is not one MATLAB holds: the source reads as a double 0x0.
    expect(row('A1', 'text', 'param').reads).toEqual({ class: 'double', size: [0, 0] });
    expect(row('C2', 'text', 'param').reads).toEqual({ class: 'double', size: [0, 0] });
    expect(row('C1', 'text', 'param').reads).toMatchObject({ class: 'struct', fields: ['a'] });
  });

  it.each(PLACES)("at %s, each field the struct has is written in its order, an absent one as [], and MATLAB reads it as it reads the source", (place) => {
    const wrong: string[] = [];
    for (const [id, v] of [...Object.entries(ABSENT), ...Object.entries(REORDERED)]) {
      const saved = pastedAndSaved(id, place, v);
      const want = row(id, 'filled', place).spelling;
      const read = matlabRead(place, saved.spelling);
      const source = row(id, 'text', place).reads;
      if (saved.spelling !== want || JSON.stringify(read) !== JSON.stringify(source)) {
        wrong.push(id + ': wrote ' + saved.spelling + ' for ' + want + ', which MATLAB reads as ' + JSON.stringify(read) + ' where it reads the source as ' + JSON.stringify(source));
      }
    }
    expect(wrong).toEqual([]);
  });

  it.each(PLACES)('at %s, the saved dictionary reopens with the rows the pasted struct showed', (place) => {
    const wrong: string[] = [];
    for (const [id, v] of [...Object.entries(ABSENT), ...Object.entries(REORDERED)]) {
      const saved = pastedAndSaved(id, place, v);
      expect(saved.shown.length, id).toBeGreaterThan(1);
      if (JSON.stringify(saved.reopened) !== JSON.stringify(saved.shown)) {
        wrong.push(id + ': showed ' + JSON.stringify(saved.shown) + ', reopened ' + JSON.stringify(saved.reopened));
      }
    }
    expect(wrong).toEqual([]);
  });

  it.each(PLACES)('at %s, a struct whose every element holds every field is written as before', (place) => {
    for (const [id, v] of Object.entries(WHOLE)) {
      const saved = pastedAndSaved(id, place, v);
      expect(saved.spelling, id).toBe(row(id, 'held', place).spelling);
      expect(matlabRead(place, saved.spelling), id).toEqual(row(id, 'text', place).reads);
    }
  });

  it('a field the struct names twice is written once in each element, as an element holds a field once', () => {
    const saved = pastedAndSaved('D1', 'prop', S([{}], ['a', 'a']));
    expect(saved.spelling).toBe(row('A1', 'filled', 'prop').spelling);
  });

  // `_fields` is JSON anyone can edit too, so a member of it can be a number or null, which names no
  // field. Written as one, it went out as `<P Name="5">`, a field no struct of MATLAB's can have, or
  // failed the save; it is written as no field, as before B-17 (which wrote only the fields an
  // element holds), and the struct as one whose element holds `a`, which MATLAB reads as such (C1).
  it.each(PLACES)('at %s, a member of `_fields` that is not a name is written as no field, and the save does not fail', (place) => {
    for (const [id, fields] of [
      ['NS', ['a', 5]],
      ['NL', [null, 'a']],
    ] as [string, unknown[]][]) {
      const saved = pastedAndSaved(id, place, S([{ a: 1 }], fields as string[]));
      expect(saved.spelling, id).toBe(row('C1', 'held', place).spelling);
      expect(matlabRead(place, saved.spelling), id).toEqual(row('C1', 'text', place).reads);
      expect(saved.reopened.some((r) => r.endsWith('/a = 1')), id).toBe(true);
    }
  });
});
