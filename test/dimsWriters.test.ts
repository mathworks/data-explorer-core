// Copyright 2026 The MathWorks, Inc.
//
// Dims that are not a size, on the write side. The readers take a value's dims as they come
// (6402869's behaviour: a hand-made `[1, "x"]` in a text dictionary, a host's NaN, a binary
// dictionary's `Dimension="1*2.5"` are all held as read), and every writer refuses what it
// cannot write, finally, naming the value (MatBudgetError):
//   - a MAT stream needs a size, every extent a whole number a double counts exactly, and
//     an extent its int32 dims word can say (MatWriter.encodeElement, charge);
//   - an XML Dimension writes back any finite non-negative extent as read — a binary
//     dictionary's reader passes them through — and refuses what no Dimension can spell:
//     NaN, an infinity, a negative, a string, an object, a bigint (DataNode._sizeOrRefuse,
//     _spellableOrRefuse).
// An unedited value is still written back as read. An edited container holding a member
// with such dims fails its save or copy, naming the member; the member is never written as
// 0, false, `[]` or an empty struct, which a damaged member of an edited rank-3 cell was
// when the readers marked it (dfaecc0, reverted).
import { describe, it, expect } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { encodeMatStream, MatBudgetError, MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { BINARY, TEXT, sparseFixture, thrownBy } from './tools/pasteVenues.js';
import { sparseToDense } from '../src/datamodel/parser/SparseData.js';

const buffer = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const entriesOf = (json: any) => json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
const PAST_INT32 = ', an extent past 2147483647, the most a MAT stream\'s dimensions can say, and it has no other spelling here. Nothing was written.';
const NOT_A_COUNT = ', a size that is not a count, so what it would add beyond its data cannot be held to the 16 MiB one value may add. Nothing was written.';

// The write-side review's rank-3 cell: one member of each form, beside a 5.
const MEMBERS: { label: string; member: unknown; at: string; said: string }[] = [
  { label: 'double', member: { _type: 'double', _value: 'Matrix(1,4294967296)\n[]' }, at: 'dmg{1}', said: 'a 1x4294967296 double' + PAST_INT32 },
  { label: 'int8', member: { _type: 'int8', _value: 'Matrix(1,4294967296)\n[]' }, at: 'dmg{1}', said: 'a 1x4294967296 int8' + PAST_INT32 },
  { label: 'logical', member: { _type: 'logical', _value: 'Matrix(1,4294967296)\n[]' }, at: 'dmg{1}', said: 'a 1x4294967296 logical' + PAST_INT32 },
  { label: 'sparse', member: { _type: 'sparse', _value: 'Matrix(1,4294967296)\n[]' }, at: 'dmg{1}', said: 'a 1x4294967296 sparse double' + PAST_INT32 },
  { label: 'struct [1,"x"]', member: { _array_type: 'Struct', _dimensions: [1, 'x'], _elements: [{ f: 1 }], _fields: ['f'] }, at: 'dmg{1}', said: 'a struct declaring dimensions [1,"x"]' + NOT_A_COUNT },
];
const rank3 = (member: unknown) => ({ _array_type: 'Cell', _dimensions: [1, 1, 2], _elements: [member, 5], _mw_element_type: 'MATLABArray' });

/** sparse_text.sldd with one more entry, `dmg`, holding `value`, as a file. */
function textWith(value: unknown): Uint8Array {
  const json = JSON.parse(strFromU8(new Uint8Array(sparseFixture(TEXT))));
  entriesOf(json).push({ name: 'dmg', metadata: { uuid: '00000000-0000-4000-ef20-000000000001' }, value });
  return strToU8(JSON.stringify(json));
}

describe('the write-side review\'s rank-3 cell, one member of each form', () => {
  for (const m of MEMBERS) {
    it(`${m.label}: written back as read until edited; with its sibling edited, the save is refused naming it`, () => {
      const session = createSession();
      const root: any = ingest(session, buffer(textWith(rank3(m.member))), { filename: TEXT });
      // Opened with no warning about it, as 6402869 read it.
      expect(root.warnings?.filter((w: any) => w.part === 'dmg') ?? []).toEqual([]);
      // A no-op save writes it as it was read.
      const saved = JSON.parse(session.serializeSource(root.name)!.text!);
      expect(entriesOf(saved).find((e: any) => e.name === 'dmg').value).toEqual(rank3(m.member));
      // The sibling edited: a cell of rank 3 has no text spelling but its stream, which has
      // none for the member, so the save is refused, naming it — never written as 0.
      const dmg = root.getSection('design').children.find((e: any) => e.name === 'dmg');
      expect(dmg.children[1].setProperty('Value', '6')).toBe(true);
      const [thrown] = thrownBy(() => session.serializeSource(root.name));
      expect([thrown?.name, thrown?.message]).toEqual(['MatBudgetError', `Cannot write "dmg": ${m.at} is ${m.said}`]);
      // And its copy too.
      expect(thrownBy(() => dmg.serialize())[0]?.message).toBe(`Cannot write "dmg": ${m.at} is ${m.said}`);
    });
  }

  it('pasted into a binary dictionary: a full member past an int32 is its XML as read; one with no XML spelling, or no size, is refused', () => {
    const into = (member: unknown) => {
      const session = createSession();
      const root: any = ingest(session, sparseFixture(BINARY), { filename: BINARY });
      root.getSection('design').parseEntry({ name: 'dmg', metadata: { uuid: '00000000-0000-4000-ef20-000000000002' }, value: rank3(member) });
      return thrownBy(() => strFromU8(unzipSync(session.serializeSource(root.name)!.bytes!)['data/chunk0.xml']));
    };
    expect(into(MEMBERS[0].member)[0]).toBeNull();
    for (const m of MEMBERS.slice(3)) {
      expect(into(m.member)[0]?.message, m.label).toBe(`Cannot write "dmg": ${m.at} is ${m.said}`);
    }
  });
});

describe('the case that started this: a NaN charge no longer turns the budget off', () => {
  // A cell holding a cell whose dims are no size, and 16 MiB and four bytes of index.
  const LITERAL = { _type: 'sparse', _value: 'Matrix(0,4194305)\n[]' };
  const around = (d: unknown) => ({ _array_type: 'Cell', _dimensions: [1, 2], _elements: [{ _array_type: 'Cell', _dimensions: d, _elements: [[1, 2, 3]] }, LITERAL] });
  for (const [label, d, said] of [
    ['[1,"x"]', [1, 'x'], '[1,"x"]'],
    ['[1,{}]', [1, {}], '[1,{}]'],
    ['[NaN,1]', [NaN, 1], '[NaN,1]'],
    ['[0,1e400]', [0, Infinity], '[0,Infinity]'],
  ] as const) {
    it(`${label}: pasted into a binary dictionary, the save is refused at the inner cell; into a text one it is saved as pasted`, () => {
      const session = createSession();
      const root: any = ingest(session, sparseFixture(BINARY), { filename: BINARY });
      root.getSection('design').parseEntry({ name: 'pasted', metadata: { uuid: '00000000-0000-4000-ef20-000000000003' }, value: around(d) });
      const [thrown, ms] = thrownBy(() => session.serializeSource(root.name));
      expect([thrown?.name, thrown?.message, ms < 1000]).toEqual(['MatBudgetError', `Cannot write "pasted": pasted{1} is a cell declaring dimensions ${said}${NOT_A_COUNT}`, true]);
      const text = createSession();
      const t: any = ingest(text, sparseFixture(TEXT), { filename: TEXT });
      t.getSection('design').parseEntry({ name: 'pasted', metadata: { uuid: '00000000-0000-4000-ef20-000000000004' }, value: around(d) });
      expect(thrownBy(() => text.serializeSource(t.name))[0]).toBeNull();
    });
  }
});

describe('a value whose XML is its only spelling in a binary dictionary', () => {
  it('a cell of full arrays whose dims no Dimension can spell is refused, not written as `Dimension="1*x"`', () => {
    for (const [d, said] of [[[1, 'x'], '[1,"x"]'], [[NaN, 1], '[NaN,1]'], [[1, -2], '[1,-2]']] as const) {
      const session = createSession();
      const root: any = ingest(session, sparseFixture(BINARY), { filename: BINARY });
      root.getSection('design').parseEntry({ name: 'pasted', metadata: { uuid: '00000000-0000-4000-ef20-000000000006' }, value: { _array_type: 'Cell', _dimensions: d, _elements: [[1, 2]] } });
      expect(thrownBy(() => session.serializeSource(root.name))[0]?.message, said).toBe(`Cannot write "pasted": pasted is a cell declaring dimensions ${said}${NOT_A_COUNT}`);
    }
  });

  it('an object array the same', () => {
    const element = (id: string) => ({ _id: id, _properties: { Description: 'd' + id } });
    const session = createSession();
    const root: any = ingest(session, sparseFixture(BINARY), { filename: BINARY });
    root.getSection('design').parseEntry({ name: 'pasted', metadata: { uuid: '00000000-0000-4000-ef20-000000000007' }, value: { _array_class: 'dexsparse.Unmodelled', _dimensions: [1, 'x'], _elements: [element('1'), element('2')] } });
    expect(thrownBy(() => session.serializeSource(root.name))[0]?.message).toBe(`Cannot write "pasted": pasted is a dexsparse.Unmodelled declaring dimensions [1,"x"]${NOT_A_COUNT}`);
  });
});

describe('every raw property arm refuses dims no Dimension can spell, naming the property', () => {
  const textEntries = () => entriesOf(JSON.parse(strFromU8(new Uint8Array(sparseFixture(TEXT)))));
  const parameterWith = (value: unknown) => {
    const raw = JSON.parse(JSON.stringify(textEntries().find((e: any) => e.name === 'pSp').value));
    raw._elements[0]._properties.Value = value;
    return raw;
  };
  const binarySave = (value: unknown) => {
    const session = createSession();
    const root: any = ingest(session, sparseFixture(BINARY), { filename: BINARY });
    root.getSection('design').parseEntry({ name: 'pasted', metadata: { uuid: '00000000-0000-4000-ef20-000000000005' }, value });
    return thrownBy(() => session.serializeSource(root.name))[0]?.message ?? null;
  };
  const DIGITS = '9'.repeat(25);
  const cases: [string, unknown, string][] = [
    ['a string array', { _array_type: 'String', _dimensions: [1, 'x'], _elements: ['a'] }, 'pasted.Value is a string declaring dimensions [1,"x"]'],
    ['a char', { _type: 'mxchar', _value: `Matrix(1,${DIGITS})\n[97]` }, `pasted.Value is a char declaring dimensions [1,${Number(DIGITS)}]`],
    ['a typed literal', { _type: 'int8', _value: `Matrix(1,${DIGITS})\n[1]` }, `pasted.Value is an int8 declaring dimensions [1,${Number(DIGITS)}]`],
    ['a complex text', { _type: 'cdata', _value: '1+2i', _dimensions: [NaN, 1] }, 'pasted.Value is a double declaring dimensions [NaN,1]'],
    ['a struct', { _array_type: 'Struct', _dimensions: [-1, 1], _elements: [{ f: 1 }], _fields: ['f'] }, 'pasted.Value is a struct declaring dimensions [-1,1]'],
    ['a cell', { _array_type: 'Cell', _dimensions: [1, {}], _elements: [1] }, 'pasted.Value is a cell declaring dimensions [1,{}]'],
    ['a cell\'s complex element', { _array_type: 'Cell', _dimensions: [1, 1], _elements: [{ _type: 'cdata', _value: '1+2i', _dimensions: [1, 'x'] }] }, 'pasted.Value{1} is a double declaring dimensions [1,"x"]'],
    ['a cell\'s char element', { _array_type: 'Cell', _dimensions: [1, 1], _elements: [{ _type: 'mxchar', _value: `Matrix(1,${DIGITS})\n[97]` }] }, `pasted.Value{1} is a char declaring dimensions [1,${Number(DIGITS)}]`],
  ];
  for (const [label, value, said] of cases) {
    it(label, () => {
      expect(binarySave(parameterWith(value))).toBe(`Cannot write "pasted": ${said}${NOT_A_COUNT}`);
    });
  }
});

describe('after the reverts, the readers are 6402869\'s: Dimensions and dims past an int32 are held as read', () => {
  it('binary 1*2.5, 1*4294967296 and 0*2147483648: a no-op save writes each Value as 6402869 did', () => {
    // Each pair: the Value as the file holds it, and as a no-op save writes it — the same
    // bytes 6402869's dist writes for each (compared against `git archive 6402869 dist`).
    // Two are not the file's own bytes at 6402869 either: an empty struct array is written
    // with one empty <Element>, and a double's body read as its two numbers is 1x2.
    const values: [string, string, string][] = [
      ['f', '<P Name="Value" Class="cell" Dimension="1*2.5">\n            <Element Class="double">1.0</Element>\n        </P>', '<P Name="Value" Class="cell" Dimension="1*2.5">\n            <Element Class="double">1.0</Element>\n        </P>'],
      ['w', '<P Name="Value" Class="cell" Dimension="1*4294967296">\n            <Element Class="double">1.0</Element>\n        </P>', '<P Name="Value" Class="cell" Dimension="1*4294967296">\n            <Element Class="double">1.0</Element>\n        </P>'],
      ['z', '<P Name="Value" Class="double" Dimension="0*2147483648"/>', '<P Name="Value" Class="double" Dimension="0*2147483648"/>'],
      ['zs', '<P Name="Value" Class="struct" Dimension="0*2147483648"/>', '<P Name="Value" Class="struct" Dimension="0*2147483648">\n            <Element>\n            </Element>\n        </P>'],
      ['d', '<P Name="Value" Class="double" Dimension="1*2.5">1.0 2.0</P>', '<P Name="Value" Class="double" Dimension="1*2">1.0 2.0</P>'],
    ];
    const files = unzipSync(new Uint8Array(sparseFixture(BINARY)));
    const xml = strFromU8(files['data/chunk0.xml']);
    const fragment = (name: string, n: number, value: string) =>
      `    <Object Class="DD.ENTRY">\n        <P Name="Name" Class="char">${name}</P>\n        <P Name="UUID" Class="char">00000000-0000-4000-ef20-00000000001${n}</P>\n`
      + `        <P Name="Namespace" Class="char">dacaf35e-55a5-454d-a7c1-93db038a210e</P>\n        <P Name="LastMod" Class="char">20261011T000000.000000</P>\n`
      + `        <P Name="LastModBy" Class="char"></P>\n        <P Name="IsDerived" Class="char">0</P>\n        ${value}\n    </Object>\n`;
    files['data/chunk0.xml'] = strToU8(xml.replace('    <Object Class="DD.Dictionary">', values.map(([n, v], i) => fragment(n, i, v)).join('') + '    <Object Class="DD.Dictionary">'));
    const session = createSession();
    const root: any = ingest(session, buffer(zipSync(files)), { filename: BINARY });
    expect(root.warnings ?? []).toEqual([]);
    const saved = strFromU8(unzipSync(session.serializeSource(root.name)!.bytes!)['data/chunk0.xml']);
    for (const [name, , written] of values) {
      const from = saved.indexOf('<P Name="Value"', saved.indexOf(`<P Name="Name" Class="char">${name}</P>`));
      expect(saved.slice(from, saved.indexOf('</Object>', from)).trimEnd(), name).toBe(written);
    }
  });

  it('text Matrix(0,2^31) and _dimensions [0,2^31] read as themselves, with no warning, and saved as read', () => {
    const json = JSON.parse(strFromU8(new Uint8Array(sparseFixture(TEXT))));
    const values: [string, unknown][] = [
      ['ts', { _type: 'sparse', _value: 'Matrix(0,2147483648)\n[]' }],
      ['td', { _type: 'double', _value: 'Matrix(0,2147483648)\n[]' }],
      ['tc', { _array_type: 'Cell', _dimensions: [0, 2147483648], _elements: [], _mw_element_type: 'MATLABArray' }],
      ['tstr', { _array_type: 'String', _dimensions: [0, 2147483648], _elements: [] }],
      ['tst', { _array_type: 'Struct', _dimensions: [0, 2147483648], _elements: [], _fields: ['f'] }],
    ];
    values.forEach(([name, value], i) => entriesOf(json).push({ name, metadata: { uuid: `00000000-0000-4000-ef30-00000000000${i}` }, value }));
    const session = createSession();
    const root: any = ingest(session, buffer(strToU8(JSON.stringify(json))), { filename: TEXT });
    expect((root.warnings ?? []).filter((w: any) => values.some(([n]) => n === w.part))).toEqual([]);
    const saved = entriesOf(JSON.parse(session.serializeSource(root.name)!.text!));
    for (const [name, value] of values) {
      expect([root.getSection('design').children.find((e: any) => e.name === name).dims, saved.find((e: any) => e.name === name).value], name).toEqual([[0, 2147483648], value]);
    }
  });
});

describe('the writer\'s own refusals', () => {
  const sparse = (row: unknown[], col: unknown[]) => ({
    name: '', className: 'double', dimensions: [3, 3], isComplex: false, isLogical: false, isSparse: true, value: null, fields: null,
    sparse: { row: row as any, col: col as any, re: Float64Array.from(row.map(() => 1)), im: null, backedColumns: 3 },
  });

  it('a sparse array\'s non-zero that is not at a row and a column is refused, finally: not written into the index, and never written without it', () => {
    for (const [row, col] of [[[0.5], [0]], [['x'], [0]], [[0], [NaN]]] as const) {
      const [thrown] = thrownBy(() => encodeMatStream(sparse(row as unknown[], col as unknown[]) as any));
      expect([thrown instanceof MatBudgetError, (thrown as any)?.reason, (thrown as any)?.what], JSON.stringify([row, col])).toEqual([
        true,
        'not-an-index',
        `a 3x3 sparse double whose non-zero 1 is at (${String(row[0])}, ${String(col[0])})`,
      ]);
    }
    expect(thrownBy(() => encodeMatStream(sparse([0, 2], [0, 1]) as any))[0]).toBeNull();
    // A host's: its copy and its XML are refused — not written full, nor as zeros where the
    // non-zero was (_sparseFallback's dense spelling drops it).
    const h: any = createSession().addMatSourceParsed('h.mat', { header: '', warnings: [], variables: [{ ...sparse([0.5], [0]), name: 'h' }] as any }).children[0];
    const said = 'Cannot write "h": h is a 3x3 sparse double whose non-zero 1 is at (0.5, 0), which is not a row and a column, and it has no spelling here without that non-zero. Nothing was written.';
    for (const write of [() => h.serialize(), () => h.serializeXml('P', { Name: 'Value' }, 2)]) {
      expect(thrownBy(write)[0]?.message).toBe(said);
    }
  });

  it('so is one of a shape or class MATLAB never stores sparse: not written full without that non-zero', () => {
    // MatWriter has no sparse stream for an int8 or an N-D sparse array, so its caller writes
    // it full (_sparseFallback), and the full form dropped the non-zero it could not place.
    for (const [cls, dims] of [['int8', [3, 3]], ['double', [3, 3, 2]]] as const) {
      const v = { ...sparse([0.5], [0]), className: cls, dimensions: [...dims] };
      const what = `a ${dims.join('x')} sparse ${cls} whose non-zero 1 is at (0.5, 0)`;
      const [thrown] = thrownBy(() => encodeMatStream(v as any));
      expect([thrown instanceof MatBudgetError, (thrown as any)?.reason, (thrown as any)?.what], cls).toEqual([true, 'not-an-index', what]);
      const h: any = createSession().addMatSourceParsed('h.mat', { header: '', warnings: [], variables: [{ ...v, name: 'h' }] as any }).children[0];
      for (const write of [() => h.serialize(), () => h.serializeXml('P', { Name: 'Value' }, 2)]) {
        expect(thrownBy(write)[0]?.message, cls).toBe(`Cannot write "h": h is ${what}, which is not a row and a column, and it has no spelling here without that non-zero. Nothing was written.`);
      }
      // At a row and a column, it is refused as before, for its caller to write full.
      const [placed] = thrownBy(() => encodeMatStream({ ...v, sparse: { ...v.sparse, row: Int32Array.from([1]), col: Int32Array.from([0]) } } as any));
      expect([placed instanceof MatWriteError, placed instanceof MatBudgetError], cls).toEqual([true, false]);
    }
    // And the full form itself places every non-zero or none.
    const unplaced = { row: [0.5] as any, col: Int32Array.from([0]), re: Float64Array.from([5]), im: null };
    expect(() => sparseToDense(unplaced, [3, 3])).toThrow('a sparse array\'s non-zero 1 is at (0.5, 0), which is not a row and a column');
    expect(sparseToDense({ ...unplaced, row: Int32Array.from([1]) }, [3, 3])).toEqual([0, 0, 0, 5, 0, 0, 0, 0, 0]);
  });

  it('a sparse array whose dims are no size, or past an int32, has rows nothing could write an edit of', () => {
    const host = (dims: number[]): any =>
      createSession().addMatSourceParsed('h.mat', {
        header: '',
        warnings: [],
        variables: [{ name: 'h', className: 'double', dimensions: dims, isComplex: false, isLogical: false, isSparse: true, value: '', fields: null,
          sparse: { row: Int32Array.from([0]), col: Int32Array.from([0]), re: Float64Array.from([5]), im: null, backedColumns: 1 } }],
      }).children[0];
    const odd = host([2, 2.5]);
    expect([odd._sparseRefusal(), odd.children.map((c: any) => c.valueEditable)]).toEqual(['a sparse array declaring dimensions [2,2.5], which are not a size', [false]]);
    const wide = host([1, 2147483648]);
    expect([wide._sparseRefusal(), wide.children.map((c: any) => c.valueEditable)]).toEqual(['a 1x2147483648 sparse array has an extent past 2147483647, which no MAT stream can say', [false]]);
    expect(host([3, 3])._sparseRefusal()).toBeNull();
  });

  it('a uint8 is "a uint8", and an int8 "an int8"', () => {
    const v = (cls: string) => ({ name: '', className: cls, dimensions: [1, 'x'], isComplex: false, isLogical: false, value: [], fields: null });
    expect([thrownBy(() => encodeMatStream(v('uint8') as any))[0], thrownBy(() => encodeMatStream(v('int8') as any))[0]].map((e: any) => e?.what)).toEqual([
      'a uint8 declaring dimensions [1,"x"]',
      'an int8 declaring dimensions [1,"x"]',
    ]);
  });

  it('a host\'s bigint dims: the source loads, and its copy and its XML are refused as not a count', () => {
    const mat: any = createSession().addMatSourceParsed('h.mat', {
      header: '',
      warnings: [],
      variables: [{ name: 'h', className: 'int8', dimensions: [2n, 3n] as any, isComplex: false, isLogical: false, value: [1, 2, 3, 4, 5, 6], fields: null }],
    });
    const h = mat.children[0];
    expect(h.displayValue).toBe('<int8, not decoded>');
    const said = 'Cannot write "h": h is an int8 declaring dimensions [2n,3n]' + NOT_A_COUNT;
    for (const write of [() => h.serialize(), () => h.serializeXml('P', { Name: 'Value' }, 2)]) {
      const [thrown] = thrownBy(write);
      expect([thrown?.name, (thrown as any)?.reason, thrown?.message]).toEqual(['MatBudgetError', 'not-a-count', said]);
    }
  });
});

describe('a final refusal wins whatever the order of the members', () => {
  // A rank-3 cell of {a struct, a member whose dims are no size or past an int32, 5}, edited
  // at {3}. Encoded in order, the struct — a class MatWriter has no variable for — refused
  // the stream first, and the cell was written another way, the second member with it:
  // `[0, 1e400]` as `[0,null]`. Every member's dims are checked first now (refuseDimsBelow).
  const GOOD = '{"_array_type":"Struct","_dimensions":[1,1],"_elements":[{"f":1}],"_fields":["f"]}';
  const BAD: [string, string, string][] = [
    ['[0,1e400]', '{"_array_type":"Struct","_dimensions":[0,1e400],"_elements":[],"_fields":["f"]}', 'a struct declaring dimensions [0,Infinity]' + NOT_A_COUNT],
    ['[1,"x"]', '{"_array_type":"Struct","_dimensions":[1,"x"],"_elements":[{"f":1}],"_fields":["f"]}', 'a struct declaring dimensions [1,"x"]' + NOT_A_COUNT],
    ['Matrix(1,4294967296)', '{"_type":"double","_value":"Matrix(1,4294967296)\\n[]"}', 'a 1x4294967296 double' + PAST_INT32],
    ['a 0x2147483648 struct', '{"_array_type":"Struct","_dimensions":[0,2147483648],"_elements":[],"_fields":["f"]}', 'a 0x2147483648 struct' + PAST_INT32],
  ];
  const textHolding = (members: string[]) => {
    const json = JSON.parse(strFromU8(new Uint8Array(sparseFixture(TEXT))));
    entriesOf(json).push({ name: 'dmg', metadata: { uuid: '00000000-0000-4000-ef40-000000000001' }, value: '@@V@@' });
    return strToU8(JSON.stringify(json).replace('"@@V@@"', `{"_array_type":"Cell","_dimensions":[1,1,3],"_elements":[${members.join(',')},5],"_mw_element_type":"MATLABArray"}`));
  };
  for (const [label, bad, said] of BAD) {
    for (const order of ['first', 'second']) {
      it(`${label}, ${order}`, () => {
        const session = createSession();
        const root: any = ingest(session, buffer(textHolding(order === 'first' ? [bad, GOOD] : [GOOD, bad])), { filename: TEXT });
        const dmg = root.getSection('design').children.find((e: any) => e.name === 'dmg');
        expect(dmg.children[2].setProperty('Value', '6')).toBe(true);
        const at = order === 'first' ? 'dmg{1}' : 'dmg{2}';
        expect(thrownBy(() => session.serializeSource(root.name))[0]?.message).toBe(`Cannot write "dmg": ${at} is ${said}`);
        expect(thrownBy(() => dmg.serialize())[0]?.message).toBe(`Cannot write "dmg": ${at} is ${said}`);
      });
    }
  }

  it('[NaN,1], a host\'s, in either order', () => {
    for (const order of ['first', 'second']) {
      const json = JSON.parse(strFromU8(new Uint8Array(sparseFixture(TEXT))));
      const good = { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ f: 1 }], _fields: ['f'] };
      const bad = { _array_type: 'Cell', _dimensions: [NaN, 1], _elements: [[1, 2]] };
      entriesOf(json).push({ name: 'dmg', metadata: { uuid: '00000000-0000-4000-ef40-000000000002' }, value: { _array_type: 'Cell', _dimensions: [1, 1, 3], _elements: order === 'first' ? [bad, good, 5] : [good, bad, 5] } });
      const session = createSession();
      const root: any = session.addDataSource('h.sldd', json);
      const dmg = root.getSection('design').children.find((e: any) => e.name === 'dmg');
      dmg.children[2].setProperty('Value', '6');
      expect(thrownBy(() => session.serializeSource(root.name))[0]?.message, order).toBe(`Cannot write "dmg": dmg{${order === 'first' ? 1 : 2}} is a cell declaring dimensions [NaN,1]${NOT_A_COUNT}`);
    }
  });
});

describe('a complex value no MAT stream can say goes into a text dictionary as a refusal, not as complex text MATLAB reads as an empty double', () => {
  // MatWriter.textDictionaryForm's catch had swallowed the final refusal and left the
  // complex text, `{_type: 'cdata', _value: '', _dimensions: [0, 2147483648]}`, as it stood.
  const binaryWith = (valueXml: string, old = '<P Name="Value" Class="double" Dimension="3*3">0.0 0.0 6.0 5.0 0.0 0.0 0.0 0.0 0.0</P>') => {
    const files = unzipSync(new Uint8Array(sparseFixture(BINARY)));
    const xml = strFromU8(files['data/chunk0.xml']);
    expect(xml).toContain(old);
    files['data/chunk0.xml'] = strToU8(xml.replace(old, valueXml));
    return buffer(zipSync(files));
  };
  const intoText = (value: unknown) => {
    const session = createSession();
    const root: any = ingest(session, sparseFixture(TEXT), { filename: TEXT });
    root.getSection('design').parseEntry({ name: 'pasted', metadata: { uuid: '00000000-0000-4000-ef50-000000000001' }, value });
    return thrownBy(() => session.serializeSource(root.name))[0]?.message ?? null;
  };

  it('a Parameter\'s Value, a cell\'s element and the entry itself, out of a binary dictionary', () => {
    const root: any = ingest(createSession(), binaryWith('<P Name="Value" Class="double" IsComplex="1" Dimension="0*2147483648"/>'), { filename: BINARY });
    const pDense = root.getSection('design').children.find((e: any) => e.name === 'pDense');
    const value = JSON.parse(JSON.stringify(pDense.serialize().value));
    expect(intoText(value)).toBe('Cannot write "pasted": pasted.Value is a 0x2147483648 double' + PAST_INT32);
    const complexEmpty = value._elements[0]._properties.Value;
    expect(complexEmpty).toEqual({ _type: 'cdata', _value: '', _dimensions: [0, 2147483648] });
    expect(intoText({ _array_type: 'Cell', _dimensions: [1, 2], _elements: [1, complexEmpty] })).toBe('Cannot write "pasted": pasted{2} is a 0x2147483648 double' + PAST_INT32);
    expect(intoText(complexEmpty)).toBe('Cannot write "pasted": pasted is a 0x2147483648 double' + PAST_INT32);
    expect(intoText({ ...complexEmpty, _class: 'single', _dimensions: [2147483648, 0] })).toBe('Cannot write "pasted": pasted is a 2147483648x0 single' + PAST_INT32);
    // And a size that is no count, the same way.
    expect(intoText({ ...complexEmpty, _dimensions: [0, 2.5] })).toBe('Cannot write "pasted": pasted is a double declaring dimensions [0,2.5]' + NOT_A_COUNT);
    // Within an int32, it is written: MATLAB's own stream for the complex empty.
    expect(intoText({ ...complexEmpty, _dimensions: [0, 5] })).toBeNull();
  });

  it('a struct\'s field, by its name, and a struct array\'s, by the element\'s subscript too', () => {
    const complexEmpty = { _type: 'cdata', _value: '', _dimensions: [0, 2147483648] };
    const struct = (elements: unknown[]) => ({ _array_type: 'Struct', _dimensions: [1, elements.length], _elements: elements, _fields: ['f', 'g'] });
    expect(intoText(struct([{ f: complexEmpty, g: 1 }]))).toBe('Cannot write "pasted": pasted.f is a 0x2147483648 double' + PAST_INT32);
    expect(intoText(struct([{ f: 1, g: 2 }, { f: 3, g: complexEmpty }]))).toBe('Cannot write "pasted": pasted(2).g is a 0x2147483648 double' + PAST_INT32);
  });
});

describe('a binary dictionary\'s raw property is written back as read, Dimension and all', () => {
  // A Simulink.Parameter's Value (sparse_binary.sldd's pDense) of each form that is a size
  // or a finite extent the reader passes through, saved as opened and after its Description
  // is edited: the Value as 6402869 writes it (checked against its dist).
  const OLD = '<P Name="Value" Class="double" Dimension="3*3">0.0 0.0 6.0 5.0 0.0 0.0 0.0 0.0 0.0</P>';
  const FORMS: [string, string, string][] = [
    ['a 0*2147483648 cell', '<P Name="Value" Class="cell" Dimension="0*2147483648"/>', '<P Name="Value" Class="cell" Dimension="0*2147483648">\n                </P>'],
    ['a 1*2.5 cell', '<P Name="Value" Class="cell" Dimension="1*2.5">\n                    <Element Class="double">1.0</Element>\n                </P>', ''],
    ['a 1*4294967296 cell', '<P Name="Value" Class="cell" Dimension="1*4294967296">\n                    <Element Class="double">1.0</Element>\n                </P>', ''],
    ['a 0*2147483648 struct', '<P Name="Value" Class="struct" Dimension="0*2147483648"/>', '<P Name="Value" Class="struct" Dimension="0*2147483648">\n                </P>'],
    ['a 1*2.5 struct', '<P Name="Value" Class="struct" Dimension="1*2.5">\n                    <Element>\n                        <P Name="f" Class="double">1.0</P>\n                    </Element>\n                </P>', ''],
    ['a 1*2.5 string', '<P Name="Value">\n                    <Element Class="string">\n                        <P Source="saveobj" PropertyType="any" Class="cell" Dimension="1*2.5">\n                            <Element Class="char">ab</Element>\n                        </P>\n                    </Element>\n                </P>', ''],
    ['a 0*2147483648 complex double', '<P Name="Value" Class="double" IsComplex="1" Dimension="0*2147483648"/>', ''],
  ];
  for (const [label, read, written] of FORMS) {
    it(label, () => {
      for (const edit of [false, true]) {
        const files = unzipSync(new Uint8Array(sparseFixture(BINARY)));
        files['data/chunk0.xml'] = strToU8(strFromU8(files['data/chunk0.xml']).replace(OLD, read));
        const session = createSession();
        const root: any = ingest(session, buffer(zipSync(files)), { filename: BINARY });
        const p = root.getSection('design').children.find((e: any) => e.name === 'pDense');
        if (edit) expect(p.setProperty('Description', 'edited')).toBe(true);
        const saved = strFromU8(unzipSync(session.serializeSource(root.name)!.bytes!)['data/chunk0.xml']);
        const from = saved.indexOf('<P Name="Value"', saved.indexOf('<Element Class="Simulink.Parameter">', saved.indexOf('<P Name="Name" Class="char">pDense</P>')));
        expect(saved.slice(from, saved.indexOf('<P Name="Complexity"', from)).trimEnd(), edit ? 'edited' : 'no-op').toBe(written || read);
      }
    });
  }
});

describe('a Matrix(…) header\'s digits are taken exactly wherever the value stands, not only as a raw property', () => {
  // 2^53 + 1 is the first count a double does not hold: parsed, it is 2^53, which a
  // Dimension would spell as another size. The raw property arm has refused it since
  // eb288ea; an entry, a cell's element and a struct's field wrote it rounded. What is
  // refused is digits a double does not hold as written, not every count past 2^53 - 1: one
  // it does hold is written as read, and it is what a binary dictionary's reader puts in a
  // header for its own empty cell element (BinarySlddParser.parseCellElement).
  const PAST = '9007199254740993';
  const literal = (type: string, dims: string, body = '[]') => ({ _type: type, _value: `Matrix(${dims})\n${body}` });
  const binaryPaste = (value: unknown) => {
    const session = createSession();
    const root: any = ingest(session, sparseFixture(BINARY), { filename: BINARY });
    root.getSection('design').parseEntry({ name: 'pasted', metadata: { uuid: '00000000-0000-4000-ef60-000000000001' }, value });
    const [thrown] = thrownBy(() => session.serializeSource(root.name));
    if (thrown) return [thrown.name, thrown.message];
    const xml = strFromU8(unzipSync(session.serializeSource(root.name)!.bytes!)['data/chunk0.xml']);
    const from = xml.indexOf('<P Name="Value"', xml.indexOf('<P Name="Name" Class="char">pasted</P>'));
    return xml.slice(from, xml.indexOf('</Object>', from)).replace(/\s+/g, ' ').trim();
  };
  const refused = (said: string) => ['MatBudgetError', `Cannot write "pasted": ${said}${NOT_A_COUNT}`];
  const cell = (member: unknown) => ({ _array_type: 'Cell', _dimensions: [1, 1], _elements: [member] });
  const parameter = (value: unknown) => ({ _array_class: 'Simulink.Parameter', _dimensions: [1, 1], _elements: [{ _properties: { Value: value } }] });

  const cases: [string, unknown, string][] = [
    ['an entry', literal('double', `0,${PAST}`), 'pasted is a double declaring dimensions [0,9007199254740992]'],
    ['an int8 entry', literal('int8', `0,${PAST}`), 'pasted is an int8 declaring dimensions [0,9007199254740992]'],
    ['a char entry', literal('mxchar', `1,${PAST}`, '[97]'), 'pasted is a char declaring dimensions [1,9007199254740992]'],
    ['a cell entry\'s element', cell(literal('double', `0,${PAST}`)), 'pasted{1} is a double declaring dimensions [0,9007199254740992]'],
    ['a struct entry\'s field', { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ f: literal('double', `0,${PAST}`) }], _fields: ['f'] }, 'pasted.f is a double declaring dimensions [0,9007199254740992]'],
    ['a Parameter Value\'s cell element', parameter(cell(literal('double', `0,${PAST}`))), 'pasted.Value{1} is a double declaring dimensions [0,9007199254740992]'],
    ['a Parameter Value', parameter(literal('double', `0,${PAST}`)), 'pasted.Value is a double declaring dimensions [0,9007199254740992]'],
  ];
  for (const [label, value, said] of cases) {
    it(`${label}: refused, not written rounded`, () => {
      expect(binaryPaste(value)).toEqual(refused(said));
    });
  }

  // And as a Parameter Value's cell element, which the raw cell-element arm
  // (DataNode._serializeCellElementXml) writes under its Dimension since 411e108.
  const written = (digits: string) => {
    const dims = `0,${digits}`;
    const said = `0*${digits.replace(/^0+(?=\d)/, '')}`;
    return [
      [binaryPaste(literal('double', dims)), `<P Name="Value" Class="double" Dimension="${said}"/>`],
      [binaryPaste(cell(literal('int8', dims))), `<P Name="Value" Class="cell" Dimension="1*1"> <Element Class="int8" Dimension="${said}"/> </P>`],
      [binaryPaste({ _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ f: literal('double', dims) }], _fields: ['f'] }), `<P Name="Value" Class="struct"> <Element> <P Name="f" Class="double" Dimension="${said}"/> </Element> </P>`],
      [binaryPaste(parameter(literal('double', dims))), `<P Name="Value"> <Element Class="Simulink.Parameter"> <P Name="Value" Class="double" Dimension="${said}"></P> </Element> </P>`],
      [binaryPaste(parameter(cell(literal('int8', dims)))), `<P Name="Value"> <Element Class="Simulink.Parameter"> <P Name="Value" Class="cell"> <Element Class="int8" Dimension="${said}"></Element> </P> </Element> </P>`],
    ];
  };

  it('2^53 - 1, Number.MAX_SAFE_INTEGER, is written as read as an entry, a cell entry\'s element, a struct entry\'s field, a Parameter\'s Value and its cell\'s element', () => {
    for (const [got, want] of written('9007199254740991')) expect(got).toBe(want);
  });

  it('a count past it that a double holds as written — 2^53, 2^53 + 2, 10^20, 2^53 with leading zeros — is written as that count in the same five places', () => {
    // f535020's raw property arm refused each of these as a Parameter's Value, taking every
    // count past 2^53 - 1 for a rounded one, and so did 411e108's cell-element arm. None is
    // written rounded, so none is refused.
    for (const digits of ['9007199254740992', '9007199254740994', '100000000000000000000', '0009007199254740992']) {
      for (const [got, want] of written(digits)) expect(got, digits).toBe(want);
    }
  });

  it('a binary dictionary\'s own empty cell element at or past 2^53 is written back as read on a save that edited nothing', () => {
    // The reader writes the element's Dimension into a `Matrix(…)` header with
    // `dims.join(',')`, so its digits are always a double's own and survive the parse.
    const OLD = '<P Name="Value" Class="double" Dimension="0*0"/>';
    const one = (element: string) => `<P Name="Value" Class="cell" Dimension="1*1">\n            ${element}\n        </P>`;
    const FORMS: [string, string][] = [
      ['a double', one('<Element Class="double" Dimension="0*9007199254740992"/>')],
      ['an int8', one('<Element Class="int8" Dimension="0*9007199254740992"/>')],
      ['a nested cell\'s', one('<Element Class="cell" Dimension="1*1">\n                <Element Class="double" Dimension="0*9007199254740992"/>\n            </Element>')],
      ['a rank-4', one('<Element Class="double" Dimension="1*2*0*9007199254740992"/>')],
      ['2^53 + 2', one('<Element Class="double" Dimension="0*9007199254740994"/>')],
      ['10^20', one('<Element Class="double" Dimension="0*100000000000000000000"/>')],
    ];
    for (const [label, read] of FORMS) {
      const files = unzipSync(new Uint8Array(sparseFixture(BINARY)));
      const xml = strFromU8(files['data/chunk0.xml']);
      expect(xml).toContain(OLD);
      files['data/chunk0.xml'] = strToU8(xml.replace(OLD, read));
      const session = createSession();
      const root: any = ingest(session, buffer(zipSync(files)), { filename: BINARY });
      const [thrown] = thrownBy(() => session.serializeSource(root.name));
      expect(thrown?.message ?? null, label).toBeNull();
      const saved = strFromU8(unzipSync(session.serializeSource(root.name)!.bytes!)['data/chunk0.xml']);
      const from = saved.indexOf('<P Name="Value"', saved.indexOf('<P Name="Name" Class="char">dEmpty</P>'));
      expect(saved.slice(from, saved.indexOf('</Object>', from)).trimEnd(), label).toBe(read);
    }
  });

  it('so is one in a Parameter\'s Value, which the raw cell-element arm writes', () => {
    // 411e108 writes such an element under its Dimension, where it had been the scalar 0.0,
    // and held its header to the safe-integer rule, so a no-op save of a dictionary holding
    // one at 2^53 was refused whole.
    const OLD = '<P Name="Value" Class="double" Dimension="3*3">0.0 0.0 6.0 5.0 0.0 0.0 0.0 0.0 0.0</P>';
    const squeeze = (xml: string) => xml.replace(/\s+/g, ' ').trim();
    for (const element of [
      '<Element Class="double" Dimension="0*9007199254740992"/>',
      '<Element Class="int8" Dimension="0*9007199254740994"/>',
      '<Element Class="double" Dimension="1*2*0*100000000000000000000"/>',
    ]) {
      const read = `<P Name="Value" Class="cell">\n                    ${element}\n                </P>`;
      const files = unzipSync(new Uint8Array(sparseFixture(BINARY)));
      const xml = strFromU8(files['data/chunk0.xml']);
      expect(xml).toContain(OLD);
      files['data/chunk0.xml'] = strToU8(xml.replace(OLD, read));
      const session = createSession();
      const root: any = ingest(session, buffer(zipSync(files)), { filename: BINARY });
      const [thrown] = thrownBy(() => session.serializeSource(root.name));
      expect(thrown?.message ?? null, element).toBeNull();
      const saved = strFromU8(unzipSync(session.serializeSource(root.name)!.bytes!)['data/chunk0.xml']);
      const from = saved.indexOf('<P Name="Value"', saved.indexOf('<Element Class="Simulink.Parameter">', saved.indexOf('<P Name="Name" Class="char">pDense</P>')));
      expect(squeeze(saved.slice(from, saved.indexOf('<P Name="Complexity"', from))), element).toBe(squeeze(read));
    }
  });
});
