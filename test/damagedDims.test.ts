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
const FORMS: { label: string; dims: unknown; text: string | null; said: string }[] = [
  { label: '[1,"x"]', dims: [1, 'x'], text: '[1,"x"]', said: '[1,"x"]' },
  { label: '[1,{}]', dims: [1, {}], text: '[1,{}]', said: '[1,{}]' },
  { label: '[0,1e400]', dims: [0, Infinity], text: '[0,1e400]', said: '[0,Infinity]' },
  { label: '[NaN,1]', dims: [NaN, 1], text: null, said: '[NaN,1]' },
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
      expect(root.warnings?.filter((w: any) => w.part === 'damaged').map((w: any) => w.message)).toEqual([
        `"damaged" holds a cell declaring dimensions ${f.said}, which is not a size; it is shown as not decoded and saved as it was read.`,
      ]);
      // Saved as opened: as it was read, and read back as damaged again.
      const saved = session.serializeSource(root.name)!.text!;
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

  it('a binary dictionary\'s Dimension that is not a size is read as the binary reader always read one, never as NaN', () => {
    const files = unzipSync(new Uint8Array(sparseFixture(BINARY)));
    const xml = strFromU8(files['data/chunk0.xml']);
    const entryXml = (dim: string, n: number) =>
      `    <Object Class="DD.ENTRY">\n        <P Name="Name" Class="char">d${n}</P>\n        <P Name="UUID" Class="char">00000000-0000-4000-ed00-00000000000${n}</P>\n`
      + `        <P Name="Namespace" Class="char">dacaf35e-55a5-454d-a7c1-93db038a210e</P>\n        <P Name="LastMod" Class="char">20261011T000000.000000</P>\n`
      + `        <P Name="LastModBy" Class="char"></P>\n        <P Name="IsDerived" Class="char">0</P>\n`
      + `        <P Name="Value" Class="cell" Dimension="${dim}">\n            <Element Class="double">1.0</Element>\n        </P>\n    </Object>\n`;
    const forms = ['1*x', '1*2.5', '1*1e400', '1*-2', '1*4294967296'];
    files['data/chunk0.xml'] = strToU8(xml.replace('    <Object Class="DD.Dictionary">', forms.map((d, i) => entryXml(d, i)).join('') + '    <Object Class="DD.Dictionary">'));
    const session = createSession();
    const root: any = ingest(session, buffer(zipSync(files)), { filename: BINARY });
    // The binary reader reads a Dimension that is not a size as none (BinarySlddParser
    // parseDims, which always did so for NaN and a negative): a 1x1 cell around the one
    // element it holds. Not damaged — a binary dictionary keeps no bytes to write one back
    // as it was read — and so saved as it was read.
    const read = forms.map((_, i) => root.getSection('design').children.find((e: any) => e.name === 'd' + i));
    expect(read.map((e: any) => [e.dims, e._damaged ?? null])).toEqual(forms.map(() => [[1, 1], null]));
    expect(notSizes(root)).toEqual([]);
    expect(thrownBy(() => session.serializeSource(root.name))[0]).toBeNull();
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

  it('a Matrix(…) header past an int32 is damaged too; one within it is read', () => {
    for (const [header, damaged] of [['Matrix(0,4294967296)\n[]', true], ['Matrix(0,' + '9'.repeat(400) + ')\n[]', true], ['Matrix(0,5)\n[]', false]] as const) {
      const node = createSession().addDataSource('t.sldd', JSON.parse(strFromU8(new Uint8Array(sparseFixture(TEXT))))).getSection('design');
      const e: any = node.parseEntry({ name: 'm', metadata: { uuid: '00000000-0000-4000-ee00-000000000001' }, value: { _type: 'sparse', _value: header } });
      expect(!!e._damaged, header.slice(0, 30)).toBe(damaged);
      expect(notSizes(e), header.slice(0, 30)).toEqual([]);
    }
  });
});
