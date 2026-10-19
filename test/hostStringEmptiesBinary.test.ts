// Copyright 2026 The MathWorks, Inc.
//
// An empty string or an empty function handle, as a host hands one in, `{_type, _emptyDims}`,
// pasted into a BINARY dictionary at an object's property or at a Simulink.Parameter's Value, and
// a copy of one pasted there at an entry. Graded against what MATLAB R2027a read back of each
// spelling core writes (test/parity/matlab/probe_host_string_empties_binary.m, which opens the
// dictionaries host_string_empties_binary.mjs saves through core's API, and writes
// host_string_empties_binary.truth.json):
//   - the String bag, written in a binary dictionary as MATLAB's own saveobj envelope, reads back
//     as the string it is at an entry, a cell, a field and an object's property;
//   - `Class="string" Dimension="0*3"/>` reads back as a double 1x1 at an object's property and
//     cannot be read at all at an entry, a cell or a field ("Invalid string returned.");
//   - at a Parameter's Value every spelling reads back as a double 0x0: MATLAB holds no empty
//     string there, and refuses one (lossy_empties_readback.truth.json, Str03 at param).
//
// MatWriter.emptyDimsHeldForm hands the host's string empty on as the String bag, so the binary
// property writer writes the envelope. Before PR #147 it was handed on as nothing, and written
// `Class="double" Dimension="0*0"`, a double 0x0; at that PR's first head, as the binary reader's
// empty, `Class="string" Dimension="0*3"/>`. An empty function handle is refused there, as it is
// at an entry, a cell and a field (FH-PASTE; the maintainer's group F ruling, group 1: refuse what
// the writers cannot spell), where it was written as a double 0x0.
//
// At an entry, a cell's element and a struct field the node writer writes the host's string empty
// (MatlabVariableNode._serializeArrayXml), and it wrote the binary reader's empty there, which
// MATLAB cannot read. It writes the String bag's envelope now, as it writes the bag itself.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { createSession, ingest } from '../src/index.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Place = 'entry' | 'cell' | 'field' | 'param' | 'prop';
type Reads = { class: string; size: number[] } | { error: string };
type Row = { id: string; form: string; dims: number[]; place: Place; name: string; spelling: string; reads: Reads };

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const TRUTH: { release: string; rows: Row[] } = JSON.parse(readFileSync(at('./parity/matlab/host_string_empties_binary.truth.json'), 'utf8'));
const BINARY = new Uint8Array(readFileSync(at('./fixtures/lossy_empties_readback_binary.sldd')));
const buffer = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const DIMS = [[0, 3], [0, 0], [1, 0]];
const PATH: Record<Place, string> = { entry: '', cell: '{1}', field: '.f', param: '.Value', prop: '.Scalar' };
const PREFIX: Record<Place, string> = { entry: 'e_', cell: 'c_', field: 's_', param: 'p_', prop: 'w_' };

/** MATLAB's reading of `spelling` at `place`, or undefined if it was never asked. */
const matlabRead = (place: Place, spelling: string): Reads | undefined => TRUTH.rows.find((r) => r.place === place && r.spelling === spelling)?.reads;
const reads = (cls: string, size: number[]): Reads => ({ class: cls, size });
/** The String bag's spelling at `place`, which MATLAB read back as the string it is (but at a Value). */
const bagSpelling = (place: Place, dims: number[]): string | undefined =>
  TRUTH.rows.find((r) => r.form === 'bag' && r.place === place && JSON.stringify(r.dims) === JSON.stringify(dims))?.spelling;

// Where the element at each place opens in the entry's XML (the last tag of the match), as
// host_string_empties_binary.mjs finds it.
const OPENS: Record<Place, RegExp> = {
  entry: /<P Name="Value"[^>]*>/,
  cell: /<P Name="Value" Class="cell"[^>]*>\s*<Element[^>]*>/,
  field: /<P Name="f"[^>]*>/,
  param: /<Element Class="Simulink.Parameter">\s*<P Name="Value"[^>]*>/,
  prop: /<P Name="Scalar"[^>]*>/,
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
function valueAt(bin: any, place: Place, v: unknown, dims: number[]): unknown {
  const copied = (section: string, name: string) => JSON.parse(JSON.stringify(bin.getSection(section).children.find((e: any) => e.name === name).serialize().value));
  switch (place) {
    case 'entry':
      return v;
    case 'cell':
      return { _array_type: 'Cell', _dimensions: [1, 1], _elements: [v], _mw_element_type: 'MATLABArray' };
    case 'field':
      return { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ f: v }], _fields: ['f'], _mw_element_type: 'MATLABArray' };
    case 'param': {
      const p = copied('design', 'p_D022');
      p._elements[0]._properties.Value = v;
      p._elements[0]._properties.Dimensions = dims;
      return p;
    }
    case 'prop': {
      const w = copied('other', 'w_D022');
      w._elements[0]._properties.Scalar = v;
      return w;
    }
  }
}

/** The node at `place` of `entry`. */
function nodeAt(entry: any, place: Place): any {
  const child = (n: any, c: string) => n?.children?.find((x: any) => x.name === c);
  switch (place) {
    case 'entry':
      return entry;
    case 'cell':
      return entry?.children?.[0];
    case 'field':
      return child(entry, 'f');
    case 'param':
      return entry?._valueNode ?? child(entry, 'Value');
    case 'prop':
      return child(entry, 'Scalar');
  }
}

type Saved = { spelling: string; matlab: Reads | undefined; reopened: unknown[] } | { refused: string; message: string };

let seq = 0;
/** `v` pasted at `place` into MATLAB's binary dictionary as entry `name`, the dictionary saved, and the entry reopened; or the save's refusal. */
function pastedAndSaved(name: string, place: Place, v: unknown, dims: number[]): Saved {
  const session = createSession();
  const bin: any = ingest(session, buffer(BINARY), { filename: 'lossy_empties_readback_binary.sldd' });
  const into = bin.getSection(place === 'prop' ? 'other' : 'design');
  into.parseEntry({ name, metadata: { ...into.children[0].metadata, uuid: '00000000-0000-4000-a940-' + String(++seq).padStart(12, '0') }, value: valueAt(bin, place, v, dims) });
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(session.serializeSource(bin.name)!.bytes!);
  } catch (e) {
    return { refused: (e as Error).name, message: (e as Error).message };
  }
  const spelling = spellingIn(strFromU8(unzipSync(bytes)['data/chunk0.xml']), name, place);
  const again: any = ingest(createSession(), buffer(bytes), { filename: 'resaved.sldd' });
  const node = nodeAt(again.children.flatMap((s: any) => s.children).find((e: any) => e.name === name), place);
  return { spelling, matlab: matlabRead(place, spelling), reopened: [node?.className, node?.dims] };
}

describe("an empty string or function handle pasted into a binary dictionary, graded against MATLAB's reading", () => {
  it('the truth is MATLAB\'s: the String bag reads back as the string it is but at a Value, the bare string tag as another value or nothing', () => {
    expect(TRUTH.release).toBe('2027a');
    expect(TRUTH.rows.length).toBe(50);
    const byForm = (form: string, place: Place) => TRUTH.rows.filter((r) => r.form === form && r.place === place);
    for (const place of ['entry', 'cell', 'field', 'prop'] as Place[]) {
      expect(byForm('bag', place).map((r) => r.reads), place).toEqual(byForm('bag', place).map((r) => reads('string', r.dims)));
      // The host's form, as core writes it now: the bag's spelling, read back so.
      expect(byForm('host', place).map((r) => [r.spelling, r.reads]), place + ' host').toEqual(byForm('bag', place).map((r) => [r.spelling, reads('string', r.dims)]));
    }
    expect(byForm('header', 'prop').map((r) => r.reads)).toEqual(DIMS.map(() => reads('double', [1, 1])));
    for (const place of ['entry', 'cell', 'field'] as Place[]) {
      expect(byForm('header', place).map((r) => r.reads), place).toEqual(DIMS.map(() => ({ error: 'Invalid string returned.' })));
    }
    expect(TRUTH.rows.filter((r) => r.place === 'param').map((r) => r.reads)).toEqual(TRUTH.rows.filter((r) => r.place === 'param').map(() => reads('double', [0, 0])));
  });

  it("a host's empty string at an object's property is written as MATLAB reads it back, the string it is, and reopens so", () => {
    const wrong: string[] = [];
    for (const dims of DIMS) {
      const saved = pastedAndSaved('w_h', 'prop', { _type: 'string', _emptyDims: dims }, dims);
      const want = reads('string', dims);
      if ('refused' in saved || JSON.stringify(saved.matlab) !== JSON.stringify(want) || JSON.stringify(saved.reopened) !== JSON.stringify(['string', dims])) {
        wrong.push(dims.join('x') + ': ' + JSON.stringify(saved));
      }
    }
    expect(wrong).toEqual([]);
  });

  it("at a Simulink.Parameter's Value, where MATLAB holds no empty string, it is written as at a property, which MATLAB reads back as the double 0x0 it read before", () => {
    // MATLAB refuses an empty string as a Parameter's Value and reads every spelling of one there,
    // this one, the old `Class="double" Dimension="0*0"` and the bare string tag, as a double 0x0.
    // This package reopens it as the string it was handed. Left as it is, as a text dictionary's is.
    for (const dims of DIMS) {
      const saved = pastedAndSaved('p_h', 'param', { _type: 'string', _emptyDims: dims }, dims);
      const envelope = TRUTH.rows.find((r) => r.form === 'bag' && r.place === 'param' && JSON.stringify(r.dims) === JSON.stringify(dims))!.spelling;
      expect(saved, dims.join('x')).toEqual({ spelling: envelope, matlab: reads('double', [0, 0]), reopened: ['string', dims] });
    }
  });

  it("a host's empty function handle at an object's property or a Parameter's Value is refused, as at an entry, a cell and a field, where it was written as a double 0x0", () => {
    for (const place of ['prop', 'param', 'entry', 'cell', 'field'] as Place[]) {
      for (const dims of [[1, 0], [0, 0]]) {
        const name = PREFIX[place] + 'fh';
        const saved = pastedAndSaved(name, place, { _type: 'function_handle', _emptyDims: dims }, dims);
        expect(saved, place + ' ' + dims.join('x')).toEqual({
          refused: 'MatWriteError',
          message:
            `Cannot write "${name}": ${name}${PATH[place]} is an empty function handle (${dims.join('x')}), which a binary dictionary holds only in MATLAB's MAT encoding, `
            + 'and this package cannot write that. Nothing was written.',
        });
      }
    }
  });

  it("a host's empty string copied out of a binary dictionary, and pasted into one as an entry, is written as MATLAB reads it back, the string it is", () => {
    for (const dims of DIMS) {
      const session = createSession();
      const bin: any = ingest(session, buffer(BINARY), { filename: 'lossy_empties_readback_binary.sldd' });
      const design = bin.getSection('design');
      const pasted = design.parseEntry({ name: 'h', metadata: { ...design.children[0].metadata, uuid: '00000000-0000-4000-a941-000000000001' }, value: { _type: 'string', _emptyDims: dims } });
      const copy = JSON.parse(JSON.stringify(pasted.serialize()));
      const saved = pastedAndSaved('e_copy', 'entry', copy.value, dims);
      expect(saved, dims.join('x')).toMatchObject({ matlab: reads('string', dims), reopened: ['string', dims] });
    }
  });

  it("a host's empty string pasted as an entry, a cell's element or a struct field is written as MATLAB reads it back, the string it is, and reopens so", () => {
    // The node writer wrote it as the binary reader's empty, `Class="string" Dimension="0*3"/>`,
    // which MATLAB cannot read at these places ("Invalid string returned."). It writes the String
    // bag's envelope there now, as it writes the bag itself and a copy of the host's empty.
    for (const place of ['entry', 'cell', 'field'] as Place[]) {
      for (const dims of DIMS) {
        const saved = pastedAndSaved(PREFIX[place] + 'h', place, { _type: 'string', _emptyDims: dims }, dims);
        expect(saved, place + ' ' + dims.join('x')).toEqual({ spelling: bagSpelling(place, dims), matlab: reads('string', dims), reopened: ['string', dims] });
      }
    }
  });

  it("a host's empty string with a trailing 1, pasted as an entry, a cell's element or a struct field, is written as the one without it", () => {
    // As at a property and a Value (below): MATLAB's size of a 0x3x1 string is 0x3. Written with the
    // 1, the envelope would say `Dimension="0*3*1"`, a spelling MATLAB was never asked about.
    for (const dims of [[0, 3, 1], [1, 0, 1], [0, 0, 1, 1]]) {
      const two = dims.slice(0, 2);
      for (const place of ['entry', 'cell', 'field'] as Place[]) {
        const saved = pastedAndSaved(PREFIX[place] + 'h', place, { _type: 'string', _emptyDims: dims }, two);
        expect(saved, place + ' ' + dims.join('x')).toEqual({ spelling: bagSpelling(place, two), matlab: reads('string', two), reopened: ['string', two] });
      }
    }
  });

  it("a host's N-D empty string, and the binary reader's own empty string, at an entry, a cell's element or a struct field are written as before (control: left as they are)", () => {
    // MATLAB was asked about neither spelling of an N-D string here, and saves none in a binary
    // dictionary itself (lossy_empties_readback.truth.json, Str022). The reader's empty is
    // `Class="string" Dimension="0*3"/>` as read, a copy of it pasted written as it was.
    const tags: Record<string, string> = { entry: '<P Name="Value"', cell: '<Element', field: '<P Name="f"' };
    for (const place of ['entry', 'cell', 'field'] as Place[]) {
      for (const dims of [[0, 3, 2], [2, 0, 3]]) {
        const saved = pastedAndSaved(PREFIX[place] + 'h', place, { _type: 'string', _emptyDims: dims }, dims);
        expect(saved, place + ' ' + dims.join('x')).toEqual({ spelling: tags[place] + ' Class="string" Dimension="' + dims.join('*') + '"/>', matlab: undefined, reopened: ['string', dims] });
      }
      const header = pastedAndSaved(PREFIX[place] + 'r', place, { _type: 'string', _value: 'Matrix(0,3)', _binary_empty: true }, [0, 3]);
      expect(header, place + ' header').toMatchObject({ spelling: tags[place] + ' Class="string" Dimension="0*3"/>', matlab: { error: 'Invalid string returned.' } });
    }
  });

  it("a host's empty string with a trailing 1 is written as the one without it at a property and a Value, and copied so", () => {
    // A trailing 1 is no extent: MATLAB's size of a 0x3x1 string is 0x3, and every other class is
    // written at its dims without it (MatWriter.effectiveDims). Written with it, the envelope was
    // `Dimension="0*3*1"`, a spelling MATLAB was never asked about, and it reopened here as a 0x3x1.
    for (const dims of [[0, 3, 1], [1, 0, 1], [0, 0, 1, 1]]) {
      const two = dims.slice(0, 2);
      const envelope = (place: Place) => TRUTH.rows.find((r) => r.form === 'bag' && r.place === place && JSON.stringify(r.dims) === JSON.stringify(two))!.spelling;
      const v = { _type: 'string', _emptyDims: dims };
      expect(pastedAndSaved('w_h', 'prop', v, two), dims.join('x') + ' at prop').toEqual({ spelling: envelope('prop'), matlab: reads('string', two), reopened: ['string', two] });
      expect(pastedAndSaved('p_h', 'param', v, two), dims.join('x') + ' at param').toEqual({ spelling: envelope('param'), matlab: reads('double', [0, 0]), reopened: ['string', two] });
      const session = createSession();
      const bin: any = ingest(session, buffer(BINARY), { filename: 'lossy_empties_readback_binary.sldd' });
      const design = bin.getSection('design');
      const pasted = design.parseEntry({ name: 'h', metadata: { ...design.children[0].metadata, uuid: '00000000-0000-4000-a942-000000000001' }, value: v });
      const copy = JSON.parse(JSON.stringify(pasted.serialize()));
      expect(copy.value, dims.join('x') + ' copied').toEqual({ _array_type: 'String', _dimensions: two, _elements: [], _mw_element_type: 'MATLABArray' });
      expect(pastedAndSaved('e_copy', 'entry', copy.value, two), dims.join('x') + ' copy pasted').toEqual({ spelling: envelope('entry'), matlab: reads('string', two), reopened: ['string', two] });
    }
  });
});
