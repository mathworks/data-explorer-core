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

describe('a binary dictionary\'s Dimension is written back as it was read', () => {
  it('1*2.5, 1*4294967296 and 0*2147483648, verbatim on a no-op save, as at 6402869', () => {
    const files = unzipSync(new Uint8Array(sparseFixture(BINARY)));
    const xml = strFromU8(files['data/chunk0.xml']);
    const values: [string, string][] = [
      ['f', '<P Name="Value" Class="cell" Dimension="1*2.5">\n            <Element Class="double">1.0</Element>\n        </P>'],
      ['w', '<P Name="Value" Class="cell" Dimension="1*4294967296">\n            <Element Class="double">1.0</Element>\n        </P>'],
      ['z', '<P Name="Value" Class="double" Dimension="0*2147483648"/>'],
    ];
    const fragment = (name: string, n: number, value: string) =>
      `    <Object Class="DD.ENTRY">\n        <P Name="Name" Class="char">${name}</P>\n        <P Name="UUID" Class="char">00000000-0000-4000-ef20-00000000001${n}</P>\n`
      + `        <P Name="Namespace" Class="char">dacaf35e-55a5-454d-a7c1-93db038a210e</P>\n        <P Name="LastMod" Class="char">20261011T000000.000000</P>\n`
      + `        <P Name="LastModBy" Class="char"></P>\n        <P Name="IsDerived" Class="char">0</P>\n        ${value}\n    </Object>\n`;
    files['data/chunk0.xml'] = strToU8(xml.replace('    <Object Class="DD.Dictionary">', values.map(([n, v], i) => fragment(n, i, v)).join('') + '    <Object Class="DD.Dictionary">'));
    const session = createSession();
    const root: any = ingest(session, buffer(zipSync(files)), { filename: BINARY });
    const saved = strFromU8(unzipSync(session.serializeSource(root.name)!.bytes!)['data/chunk0.xml']);
    for (const [name, value] of values) {
      const from = saved.indexOf(`<P Name="Name" Class="char">${name}</P>`);
      expect(saved.slice(from, saved.indexOf('</Object>', from)), name).toContain(value.split('\n')[0]);
    }
  });
});

describe('the writer\'s own refusals', () => {
  const sparse = (row: unknown[], col: unknown[]) => ({
    name: '', className: 'double', dimensions: [3, 3], isComplex: false, isLogical: false, isSparse: true, value: null, fields: null,
    sparse: { row: row as any, col: col as any, re: Float64Array.from(row.map(() => 1)), im: null, backedColumns: 3 },
  });

  it('a sparse array\'s non-zero that is not at a row and a column is refused, not written into the index', () => {
    for (const [row, col] of [[[0.5], [0]], [['x'], [0]], [[0], [NaN]]] as const) {
      const [thrown] = thrownBy(() => encodeMatStream(sparse(row as unknown[], col as unknown[]) as any));
      expect([thrown instanceof MatWriteError, thrown instanceof MatBudgetError, thrown?.message], JSON.stringify([row, col])).toEqual([
        true,
        false,
        `a sparse array's non-zero 0 is at (${String(row[0])}, ${String(col[0])}), which is not a row and a column`,
      ]);
    }
    expect(thrownBy(() => encodeMatStream(sparse([0, 2], [0, 1]) as any))[0]).toBeNull();
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
