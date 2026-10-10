// Copyright 2026 The MathWorks, Inc.
//
// A cell holding a sparse array, written into a binary dictionary. MATLAB writes such an
// entry as one hex stream (getByteStreamFromArray of the whole cell), and this package
// does too when MatWriter can write every element of the cell as what it is — the cell
// `c` of test/fixtures/sparse is written byte for byte as MATLAB's (encodedValueWriteBack).
// It cannot when an element is a Simulink object, a struct read from a text dictionary,
// a string, or anything else its MAT encoder has no spelling for: written whole, such a
// cell opened in MATLAB with every object in it a 0x0 double and every string a char
// (R2027a, measured on objsCell, and on cells MATLAB wrote with a Simulink.Parameter, a
// Simulink.Signal, a struct, "str" and ["a" "b"] beside a sparse array). Such a cell is
// written element by element, as before, with only its sparse elements as hex elements
// of their own — a form MATLAB reads back as the cell it was.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { encodeCdata } from '../src/datamodel/parser/MatWriter.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/sparse/${name}`, import.meta.url))));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

// sparse([0 1]) as a text dictionary's cdata.
const SPARSE = {
  _type: 'cdata',
  _value: encodeCdata({ name: '', className: 'double', dimensions: [1, 2], isComplex: false, isLogical: false, isSparse: true, value: [0, 1], fields: null }),
};
const cell = (elements: unknown[]) => ({ _array_type: 'Cell', _dimensions: [1, elements.length], _elements: elements, _mw_element_type: 'MATLABArray' });

// Cells as MATLAB's own text dictionary spells them (cells_text.sldd, written by R2027a
// for these values), the sparse element's stream included.
const CELLS: Record<string, unknown> = {
  cKinds: cell([SPARSE, ['str'], { _type: 'int64', _value: '9007199254740993' }, true, { _type: 'int8', _value: '[1, 2]' }, { _type: 'single', _value: '2.5F' }, cell([1])]),
  cStrs: cell([SPARSE, { _array_type: 'String', _dimensions: [1, 2], _elements: ['a', 'b'] }, 'chars']),
  cStruct: cell([SPARSE, { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ a: 1, b: 'x' }] }]),
};

/** What a node is, all the way down: class, shape, display and storage. */
const shape = (node: any): unknown => ({
  cls: node.className,
  dims: node.dims,
  shown: node.displayValue,
  sparse: !!node.isSparse,
  children: node.children.map(shape),
});

let seq = 0;
function pasteAndReopen(payload: any): { pasted: any; xml: string; reread: any } {
  const session = createSession();
  const binary: any = ingest(session, buffer(fixture('sparse_binary.sldd')), { filename: 'sparse_binary.sldd' });
  const name = `${payload.name}Pasted`;
  const pasted = binary.getSection('design').parseEntry({
    ...payload,
    name,
    metadata: { uuid: `00000000-0000-4000-c000-${String(++seq).padStart(12, '0')}` },
  });
  const xml = serializeEntryToXml(pasted);
  const reopened: any = ingest(createSession(), buffer(session.serializeSource(binary.name)!.bytes as Uint8Array), { filename: 'r.sldd' });
  return { pasted, xml, reread: reopened.getSection('design').children.find((e: any) => e.name === name) };
}

describe('a cell holding a sparse array beside a value MatWriter cannot write goes into a binary dictionary element by element', () => {
  const text: any = ingest(createSession(), buffer(fixture('hexobj_text.sldd')), { filename: 'hexobj_text.sldd' });
  const mat: any = ingest(createSession(), buffer(fixture('hexobj_values.mat')), { filename: 'hexobj_values.mat' });

  const sources: [string, any][] = [
    ['objsCell from the text dictionary', JSON.parse(JSON.stringify(text.getSection('design').children.find((e: any) => e.name === 'objsCell').serialize()))],
    ['objsCell from the .mat', { name: 'objsCell', value: JSON.parse(JSON.stringify(mat.children.find((e: any) => e.name === 'objsCell').serializeValue())) }],
    ...Object.entries(CELLS).map(([name, value]) => [name, { name, value }] as [string, any]),
  ];

  for (const [label, payload] of sources) {
    it(`${label}: its objects, structs and strings stay what they are, and its sparse array stays sparse`, () => {
      const source = createSession();
      const before: any = ingest(source, buffer(fixture('sparse_binary.sldd')), { filename: 's.sldd' }).getSection('design').parseEntry({
        ...payload,
        name: 'before',
        metadata: { uuid: '00000000-0000-4000-c100-000000000001' },
      });
      const { xml, reread } = pasteAndReopen(payload);
      const value = /<P Name="Value"[^>]*>/.exec(xml)![0];
      expect(value, label).toMatch(/^<P Name="Value" Class="cell" Dimension="1\*\d+">$/);
      // The sparse element is a hex element of its own, the one way XML spells it.
      expect(xml, label).toMatch(/<Element Class="double" Encoding="hex" EncodedLength="\d+">/);
      expect(xml, label).not.toContain('sparse');
      const reopened = shape(reread) as any;
      expect(reopened.children, label).toEqual((shape(before) as any).children);
      expect(reopened.children[0].sparse, label).toBe(true);
    });
  }

  it('which is what was lost when it was written whole: each source holds such a value', () => {
    for (const [label, payload] of sources) {
      const node: any = ingest(createSession(), buffer(fixture('sparse_binary.sldd')), { filename: 's.sldd' })
        .getSection('design')
        .parseEntry({ ...payload, name: 'probe', metadata: { uuid: '00000000-0000-4000-c200-000000000001' } });
      expect([node._holdsSparse(), node._matWritable()], label).toEqual([true, false]);
    }
  });

  it('MatWriter cannot write a Simulink object, a string, a handle, an MCOS object or a placeholder, nor a struct holding one', () => {
    const objs = mat.children.find((e: any) => e.name === 'objs');
    expect([objs.constructor.name, objs._matWritable()]).toEqual(['MatlabVariableNode', false]);
    expect(objs.children.find((c: any) => c.name === 'sp')._matWritable()).toBe(true);
    // A sparse array of any size is written from its non-zeros: spTall, once too large to
    // decode, is not a placeholder.
    const values: any = ingest(createSession(), buffer(fixture('sparse_values.mat')), { filename: 'sparse_values.mat' });
    const spTall = values.children.find((e: any) => e.name === 'spTall');
    expect([spTall._undecoded, spTall._matWritable()]).toEqual([false, true]);
    expect(values.children.find((e: any) => e.name === 'spDiag')._matWritable()).toBe(true);
    const placeholder = MatlabVariableNode.parseMatVariable(
      { name: 'o', className: 'object', dimensions: [1, 1], isComplex: false, isLogical: false, value: '<1x1 object, not decoded>', undecoded: 'not read', fields: null },
      'o',
      null,
    ) as any;
    expect([placeholder._undecoded, placeholder._matWritable()]).toEqual([true, false]);
    const strings: any = ingest(createSession(), buffer(new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/strings.mat', import.meta.url))))), { filename: 'strings.mat' });
    const string = strings.children.find((e: any) => e._isOpaque);
    expect([string.className, string._matWritable()]).toEqual(['string', false]);
    // An MCOS object no subsystem decoded: what a .mat holds for one its container could not.
    const opaque = MatlabVariableNode.parseMatVariable(
      { name: 'o', className: 'my.Thing', dimensions: [1, 1], isComplex: false, isLogical: false, value: null, fields: null, isOpaque: true },
      'o',
      null,
    ) as any;
    expect([opaque._isOpaque, opaque._matWritable()]).toEqual([true, false]);
    const handle: any = text.getSection('design').parseEntry({ name: 'fh', metadata: { uuid: '00000000-0000-4000-c300-000000000001' }, value: { _type: 'function_handle', _value: 'sin' } });
    expect([handle.className, handle._matWritable()]).toEqual(['function_handle', false]);
  });

  it('a cell MatWriter can write whole is still one hex stream, as MATLAB writes it', () => {
    const nested = { name: 'cNested', value: cell([SPARSE, cell([SPARSE, 8])]) };
    const { xml, reread } = pasteAndReopen(nested);
    expect(/<P Name="Value"[^>]*>/.exec(xml)![0]).toMatch(/^<P Name="Value" Class="cell" Encoding="hex" EncodedLength="\d+">$/);
    expect(shape(reread)).toMatchObject({ cls: 'cell', children: [{ sparse: true }, { cls: 'cell', children: [{ sparse: true }, { shown: '8' }] }] });
  });
});
