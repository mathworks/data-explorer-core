// Copyright 2026 The MathWorks, Inc.
//
// A value whose dims are not a size (parser/Size): a hand-made text entry's `_dimensions:
// [1, "x"]`, `[1, {}]` or `[0, 1e400]`, a host's `[NaN, 1]`, a `.mat`'s negative dims word.
// The final check's input was a cell holding such a cell and a `Matrix(0,N)` literal: the
// inner cell's NaN elements made a NaN charge, which turned the unbacked-bytes budget off
// for the rest of the value, so the literal's index was written whatever its size. Now the
// reader takes such a value as damaged (NodeClassMap.parseValue, parseMatVariable): it shows
// as not decoded, is reported, carries no NaN into the model, and is written only as what it
// was read from — a text dictionary writes it back as it was read, a binary dictionary has
// no spelling for it and refuses it, naming the entry and the path. The writer's own check
// (charge, encodeElement) is test/unbackedBudget.test.ts's.
import { describe, it, expect } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { CLASS, arrayFlags, dims, element, matFile, matrix, MI, varName } from './tools/matBytes.js';
import { BINARY, TEXT, pasteSaveReopen, sparseFixture, thrownBy } from './tools/pasteVenues.js';

// 16 MiB and four bytes of column index: written whole if the budget were off.
const LITERAL = { _type: 'sparse', _value: 'Matrix(0,4194305)\n[]' };
const cellAround = (inner: unknown) => ({ _array_type: 'Cell', _dimensions: [1, 2], _elements: [inner, LITERAL], _mw_element_type: 'MATLABArray' });
const innerOf = (d: unknown) => ({ _array_type: 'Cell', _dimensions: d, _elements: [[1, 2, 3]], _mw_element_type: 'MATLABArray' });
// Each form, and how it is spelled in a message. JSON has no NaN, so that one is a host's.
// `written` is how a text dictionary writes them back: JSON has no NaN or Infinity.
const FORMS: { label: string; dims: unknown; text: string | null; said: string; written: unknown[] }[] = [
  { label: '[1,"x"]', dims: [1, 'x'], text: '[1,"x"]', said: '[1,"x"]', written: [1, 'x'] },
  { label: '[1,{}]', dims: [1, {}], text: '[1,{}]', said: '[1,{}]', written: [1, {}] },
  { label: '[0,1e400]', dims: [0, Infinity], text: '[0,1e400]', said: '[0,Infinity]', written: [0, null] },
  { label: '[NaN,1]', dims: [NaN, 1], text: null, said: '[NaN,1]', written: [null, 1] },
];
const refused = (entry: string, at: string, said: string) =>
  `Cannot write "${entry}": ${at} is a cell declaring dimensions ${said}, a size that is not a count, so what it would add beyond its data cannot be held to the 16 MiB one value may add. Nothing was written.`;

/** Every MatlabVariableNode under `node` whose dims are not a size. */
const notSizes = (node: any): string[] => [
  ...(Array.isArray(node._dims) && !node._dims.every((x: unknown) => Number.isInteger(x) && (x as number) >= 0) ? [String(node.displayName)] : []),
  ...(node.children || []).flatMap(notSizes),
];

/** sparse_text.sldd with one more entry, `damaged`, spelled `valueJson`. */
function textWith(valueJson: string): Uint8Array {
  const json = JSON.parse(strFromU8(new Uint8Array(sparseFixture(TEXT))));
  json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.push({ name: 'damaged', metadata: { uuid: '00000000-0000-4000-ec00-000000000001' }, value: '@@VALUE@@' });
  return strToU8(JSON.stringify(json).replace('"@@VALUE@@"', valueJson));
}
const buffer = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

describe('a value whose dims are not a size is read as damaged, and never written as anything but what it was read as', () => {
  for (const f of FORMS) {
    it(`${f.label}: opened, pasted into either dictionary, and saved`, () => {
      // Opened: out of a text dictionary's file, or for the NaN a host's content.
      let root: any;
      let session = createSession();
      if (f.text) {
        root = ingest(session, buffer(textWith(JSON.stringify(cellAround('@@INNER@@')).replace('"@@INNER@@"', JSON.stringify(innerOf('@@D@@')).replace('"@@D@@"', f.text)))), { filename: TEXT });
      } else {
        const json = JSON.parse(strFromU8(new Uint8Array(sparseFixture(TEXT))));
        json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.push({ name: 'damaged', metadata: { uuid: '00000000-0000-4000-ec00-000000000001' }, value: cellAround(innerOf(f.dims)) });
        root = session.addDataSource(TEXT, json);
      }
      const entry = root.getSection('design').children.find((e: any) => e.name === 'damaged');
      const inner = entry.children[0];
      expect([inner.displayValue, inner.dims, inner._damaged, notSizes(root)]).toEqual(['<cell, not decoded>', [1, 1], 'dimensions ' + f.said, []]);
      // What the warning says it is saved as is what is saved.
      const exceptJson = f.said === JSON.stringify(f.written) ? '' : `, except that JSON, which has no NaN or Infinity, writes its dimensions ${JSON.stringify(f.written)}`;
      expect(root.warnings?.filter((w: any) => w.part === 'damaged').map((w: any) => w.message)).toEqual([
        `"damaged" holds a cell declaring dimensions ${f.said}, which is not a size; it is shown as not decoded and saved as it was read${exceptJson}.`,
      ]);
      // Saved as opened: as it was read — the bytes say so — and read back as damaged again.
      const saved = session.serializeSource(root.name)!.text!;
      const savedEntry = JSON.parse(saved).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === 'damaged');
      expect(savedEntry.value._elements[0]._dimensions).toEqual(f.written);
      expect(savedEntry.value._elements[1]).toEqual(LITERAL);
      const again: any = ingest(createSession(), buffer(strToU8(saved)), { filename: TEXT });
      expect(again.getSection('design').children.find((e: any) => e.name === 'damaged').children[0]._damaged).toMatch(/^dimensions \[/);
      // Pasted: into a text dictionary it is saved as it was pasted; a binary dictionary has
      // no spelling for it, and refuses it, at once, naming the entry and the path.
      const value = entry.serialize().value;
      const text = pasteSaveReopen(TEXT, value);
      expect(text.entry.children[0]._damaged).toMatch(/^dimensions \[/);
      const [thrown, ms] = thrownBy(() => pasteSaveReopen(BINARY, value));
      expect([thrown?.name, thrown?.message, ms < 1000]).toEqual(['MatBudgetError', refused('pasted', 'pasted{1}', f.said), true]);
    });
  }

  it('a binary dictionary\'s Dimension: a size past an int32 is read and written back verbatim; one that is no size is read as 1x1, said so, and written back as read until edited', () => {
    const files = unzipSync(new Uint8Array(sparseFixture(BINARY)));
    const xml = strFromU8(files['data/chunk0.xml']);
    const fragment = (name: string, n: number, value: string) =>
      `<Object Class="DD.ENTRY">\n        <P Name="Name" Class="char">${name}</P>\n        <P Name="UUID" Class="char">00000000-0000-4000-ed00-00000000000${n}</P>\n`
      + `        <P Name="Namespace" Class="char">dacaf35e-55a5-454d-a7c1-93db038a210e</P>\n        <P Name="LastMod" Class="char">20261011T000000.000000</P>\n`
      + `        <P Name="LastModBy" Class="char"></P>\n        <P Name="IsDerived" Class="char">0</P>\n`
      + `        ${value}\n    </Object>`;
    const cellValue = (dim: string) => `<P Name="Value" Class="cell" Dimension="${dim}">\n            <Element Class="double">1.0</Element>\n        </P>`;
    // Past an int32, and a size: MATLAB's zeros(0, 2^31), an empty struct of that size, a
    // 1x4294967296 cell holding one element.
    const sizes: [string, string, string][] = [
      ['z', '<P Name="Value" Class="double" Dimension="0*2147483648"/>', '<P Name="Value" Class="double" Dimension="0*2147483648"/>'],
      ['zs', '<P Name="Value" Class="struct" Dimension="0*2147483648"/>', 'Dimension="0*2147483648"'],
      ['w', cellValue('1*4294967296'), cellValue('1*4294967296')],
    ];
    const nonSizes = ['1*x', '1*2.5', '1*1e400', '1*-2'];
    const fragments = [
      ...sizes.map(([name, value], i) => fragment(name, i, value)),
      ...nonSizes.map((d, i) => fragment('d' + i, 5 + i, cellValue(d))),
    ];
    files['data/chunk0.xml'] = strToU8(xml.replace('    <Object Class="DD.Dictionary">', fragments.map((f) => '    ' + f + '\n').join('') + '    <Object Class="DD.Dictionary">'));
    const session = createSession();
    const root: any = ingest(session, buffer(zipSync(files)), { filename: BINARY });
    const design = root.getSection('design');
    const at = (name: string) => design.children.find((e: any) => e.name === name);
    // Read: the sizes as they are, warned of nothing; the others as 1x1, each said so.
    expect([at('z').dims, at('zs').dims, at('w').dims]).toEqual([[0, 2147483648], [0, 2147483648], [1, 4294967296]]);
    expect(nonSizes.map((_, i) => at('d' + i).dims)).toEqual(nonSizes.map(() => [1, 1]));
    expect(nonSizes.map((_, i) => at('d' + i)._damaged ?? null)).toEqual(nonSizes.map(() => null));
    expect(nonSizes.every((_, i) => !!at('d' + i)._xmlAsRead)).toBe(true);
    expect(nonSizes.map((d, i) => root.warnings.find((w: any) => w.part === 'd' + i)?.message)).toEqual(
      nonSizes.map((d, i) => `"d${i}" holds a Dimension that is not a size ("${d}"), read as 1x1; it is saved as the XML it was read as until it is edited, and then as what it shows.`),
    );
    expect(root.warnings.filter((w: any) => ['z', 'zs', 'w'].includes(w.part))).toEqual([]);
    expect(notSizes(root)).toEqual([]);
    // A no-op save: each Value written back as it was read, byte for byte.
    const saved = strFromU8(unzipSync(session.serializeSource(root.name)!.bytes!)['data/chunk0.xml']);
    for (const [name, , written] of sizes) {
      const from = saved.indexOf(`<P Name="Name" Class="char">${name}</P>`);
      expect(saved.slice(from, saved.indexOf('</Object>', from)), name).toContain(written);
    }
    for (const f of fragments.slice(sizes.length)) expect(saved).toContain('    ' + f + '\n');
    // Edited, it is what it shows: a 1x1 cell.
    expect(at('d1').setProperty('Name', 'd1edited')).toBe(true);
    const edited = strFromU8(unzipSync(session.serializeSource(root.name)!.bytes!)['data/chunk0.xml']);
    const from = edited.indexOf('<P Name="Name" Class="char">d1edited</P>');
    expect(edited.slice(from, edited.indexOf('</Object>', from))).toContain('<P Name="Value" Class="cell" Dimension="1*1">');
  });

  it('a host\'s variable declaring [NaN, 1] is damaged, and its copy is refused; a .mat\'s declaring [-1, 2] is copied as the element it was read from', () => {
    const host: any = createSession().addMatSourceParsed('h.mat', {
      header: '',
      warnings: [],
      variables: [{ name: 'h', className: 'double', dimensions: [NaN, 1], isComplex: false, isLogical: false, value: [1], fields: null }],
    });
    const h = host.children[0];
    expect([h.displayValue, h._damaged, host.warnings?.map((w: any) => w.part)]).toEqual(['<double, not decoded>', 'dimensions [NaN,1]', ['h']]);
    const [thrown] = thrownBy(() => h.serialize());
    expect(thrown?.message).toBe(
      'Cannot write "h": h is a double declaring dimensions [NaN,1], a size that is not a count, so what it would add beyond its data cannot be held to the 16 MiB one value may add. Nothing was written.',
    );
    const el = matrix([arrayFlags(CLASS.DOUBLE), dims([-1, 2]), varName('d'), element(MI.DOUBLE, new Uint8Array(16))]);
    const mat: any = createSession().addMatSource('d.mat', matFile([el]));
    const d = mat.children[0];
    expect([d.displayValue, d._damaged, mat.warnings?.map((w: any) => w.part)]).toEqual(['<double, not decoded>', 'dimensions [-1,2]', ['d']]);
    expect(d.serialize().value._type).toBe('cdata');
  });

  it('a host\'s sparse array of 1x2147483648 is read, its row read-only, and its copy refused, since no MAT stream can say it', () => {
    const host: any = createSession().addMatSourceParsed('h.mat', {
      header: '',
      warnings: [],
      variables: [{ name: 'h', className: 'double', dimensions: [1, 2147483648], isComplex: false, isLogical: false, isSparse: true, value: '', fields: null,
        sparse: { row: Int32Array.from([0]), col: Int32Array.from([0]), re: Float64Array.from([5]), im: null, backedColumns: 2147483648 } }],
    });
    const h = host.children[0];
    expect([h.displayValue, h._damaged, h.children.map((c: any) => [c.displayName, c.valueEditable])]).toEqual(['<1x2147483648 sparse double>', null, [['h(1,1)', false]]]);
    const [thrown] = thrownBy(() => h.serialize());
    expect([thrown?.name, (thrown as any)?.reason]).toEqual(['MatBudgetError', 'past-int32']);
  });

  it('a text dictionary\'s size past an int32 is read, as a size; one past what a double counts exactly is damaged', () => {
    const fresh = () => createSession().addDataSource('t.sldd', JSON.parse(strFromU8(new Uint8Array(sparseFixture(TEXT))))).getSection('design');
    let seq = 0;
    const read = (value: unknown) => fresh().parseEntry({ name: 'm', metadata: { uuid: `00000000-0000-4000-ee00-00000000000${++seq}` }, value });
    for (const [value, damaged] of [
      [{ _type: 'sparse', _value: 'Matrix(0,2147483648)\n[]' }, false],
      [{ _type: 'double', _value: 'Matrix(0,4294967296)\n[]' }, false],
      [{ _array_type: 'Cell', _dimensions: [0, 2147483648], _elements: [] }, false],
      [{ _array_type: 'String', _dimensions: [0, 2147483648], _elements: [] }, false],
      [{ _array_type: 'Struct', _dimensions: [0, 2147483648], _elements: [], _fields: ['f'] }, false],
      [{ _type: 'sparse', _value: 'Matrix(0,' + '9'.repeat(400) + ')\n[]' }, true],
      [{ _type: 'sparse', _value: 'Matrix(0,9007199254740993)\n[]' }, true],
    ] as const) {
      const e: any = read(value);
      expect([!!e._damaged, notSizes(e)], JSON.stringify(value).slice(0, 60)).toEqual([damaged, []]);
    }
    // Into a binary dictionary: a full empty is its XML, verbatim; a sparse one has no
    // spelling there but a stream, whose int32 dims word cannot say 2147483648, so it is
    // refused, saying why.
    const full = pasteSaveReopen(BINARY, { _type: 'double', _value: 'Matrix(0,2147483648)\n[]' });
    expect([full.written, full.entry.dims]).toEqual(['<P Name="Value" Class="double" Dimension="0*2147483648"/>', [0, 2147483648]]);
    // An empty cell is written as the XML cell writer writes every empty one, 0x0.
    expect(thrownBy(() => pasteSaveReopen(BINARY, { _array_type: 'Cell', _dimensions: [0, 2147483648], _elements: [] }))[0]).toBeNull();
    const [thrown] = thrownBy(() => pasteSaveReopen(BINARY, { _type: 'sparse', _value: 'Matrix(0,2147483648)\n[]' }));
    expect([thrown?.name, (thrown as any)?.reason, thrown?.message]).toEqual([
      'MatBudgetError',
      'past-int32',
      'Cannot write "pasted": pasted is a 0x2147483648 sparse double, an extent past 2147483647, the most a MAT stream\'s dimensions can say, and it has no other spelling here. Nothing was written.',
    ]);
  });
});
