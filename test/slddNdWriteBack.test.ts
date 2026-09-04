// Copyright 2026 The MathWorks, Inc.
//
// What we WRITE for an N-D value, checked against the bytes MATLAB itself wrote
// for that same value. Keeping every extent on the read side (Phase 6) is only
// half the job: a writer that still thinks in dims[0] and dims[1] emits XML that
// contradicts its own Dimension attribute, and MATLAB does not merely misread
// such a file — `<P Class="struct" Dimension="2*3">` with twelve <Element>s
// SEGFAULTS the SLDD XML reader (ElementPart.cpp), and a 1x1x3 struct whose
// Dimension attribute is dropped altogether comes back as nested
// <Element><Element>.
//
// Every expectation here is a literal slice of a MATLAB-authored data/chunk0.xml
// — see test/parity/matlab/probe_ndarray.m and probe_nd_edge.m — so the test
// cannot drift toward whatever we happen to emit.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import DataModel from '../src/core/DataModel.js';
import '../src/datamodel/node/NodeClassMap.js';
import { parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import { buildDataChunkXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { loadFile, findEntry } from './parity/loadFile.js';

function chunkOf(fixture: string): string {
  const p = fileURLToPath(new URL('./fixtures/' + fixture, import.meta.url));
  const zip = unzipSync(new Uint8Array(readFileSync(p)));
  return new TextDecoder().decode(zip['data/chunk0.xml']);
}

// The `<P Name="Value" …>` block of one DD.ENTRY, verbatim, indentation included.
// Comparing this slice rather than the whole file keeps UUIDs and LastMod stamps
// out of the assertion while leaving the value itself byte-exact.
function valueXml(chunk: string, entryName: string): string {
  const obj = chunk
    .split('<Object Class="DD.ENTRY">')
    .find((o) => o.includes('<P Name="Name" Class="char">' + entryName + '</P>'));
  if (!obj) {
    throw new Error('no entry "' + entryName + '" in chunk');
  }
  const start = obj.indexOf('        <P Name="Value"');
  const end = obj.indexOf('    </Object>');
  if (start < 0 || end < 0) {
    throw new Error('no Value block for "' + entryName + '"');
  }
  return obj.slice(start, end).replace(/\s+$/, '');
}

// Every node in a subtree, marked Modified. Status has to be set on the node that
// owns the value: serializeXml short-circuits to `_rawInput` per node, and
// _markModified propagates up to the entry, not down into it.
function markAll(node: any): void {
  if (typeof node._markModified === 'function') {
    node._markModified();
  }
  for (const child of node.children || []) {
    markAll(child);
  }
}

// Re-emit a whole fixture through the data model and hand back the chunk XML.
// `modify` drops the `_rawInput` passthrough, so what comes out is what our own
// writers built rather than the bytes we read.
function rewritten(fixture: string, modify = false): string {
  const uri = 'mem://ndwb-' + fixture + modify;
  DataModel.removeDataSource(uri);
  const p = fileURLToPath(new URL('./fixtures/' + fixture, import.meta.url));
  const zip = unzipSync(new Uint8Array(readFileSync(p)));
  const xml = new TextDecoder().decode(zip['data/chunk0.xml']);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) {
    if (k !== 'data/chunk0.xml') {
      meta[k] = v;
    }
  }
  const model = DataModel.addDataSource(uri, parseBinarySlddParts(xml, meta), { path: fixture });
  if (modify) {
    markAll(model);
  }
  return buildDataChunkXml(model);
}

// fixture -> the entries in it, with the MATLAB shape each one is there to pin.
const CASES: [string, string, string][] = [
  ['nd_binary.sldd', 'A', '2*3*2 double'],
  ['nd_binary.sldd', 'C', '2*2*2 cell'],
  ['nd_binary.sldd', 'Kp', '2*3 double (the rank-2 control)'],
  ['nd_binary.sldd', 's', '2*3*2 struct'],
  ['nd_1x1x3.sldd', 'A113', '1*1*3 double'],
  ['nd_1x1x3.sldd', 's113', '1*1*3 struct'],
  ['nd_complex.sldd', 'Z', '2*3*2 complex double'],
];

describe('an untouched N-D entry is written back exactly as MATLAB wrote it', () => {
  for (const [fixture, entry, what] of CASES) {
    it(entry + ' (' + what + ')', () => {
      expect(valueXml(rewritten(fixture), entry)).toBe(valueXml(chunkOf(fixture), entry));
    });
  }
});

// The untouched cases above can pass on the strength of the `_rawInput`
// passthrough alone. These force the writers to build the value from the parsed
// tree, and still demand MATLAB's own bytes. Verified end to end: MATLAB reopened
// every file produced this way and reported each value isequaln to the original,
// where the pre-fix output of the same loop crashed it.
describe('a MODIFIED N-D entry is rebuilt into the bytes MATLAB wrote', () => {
  for (const [fixture, entry, what] of CASES) {
    it(entry + ' (' + what + ')', () => {
      expect(valueXml(rewritten(fixture, true), entry)).toBe(valueXml(chunkOf(fixture), entry));
    });
  }
});

describe('a MODIFIED N-D struct array keeps every element', () => {
  it('serializes all three elements of a 1x1x3, not one empty one', () => {
    // numElems was d[0]*d[1] — 1 for a 1x1x3 — so the array ROOT took the
    // single-element branch and serialized itself as one <Element> whose fields
    // were looked up by the array's field list against children named "0","1","2".
    // Nothing matched, so serializeValue returned _elements: [{}]: all three
    // elements' data gone the moment anything in the dictionary was touched.
    const s = findEntry(loadFile('../fixtures/nd_1x1x3.sldd'), 's113') as any;
    s._markModified();
    const out = s.serializeValue() as Record<string, unknown>;
    expect(out._dimensions).toEqual([1, 1, 3]);
    expect(out._elements).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it('serializes all twelve elements of a 2x3x2', () => {
    const s = findEntry(loadFile('../fixtures/nd_binary.sldd'), 's') as any;
    s._markModified();
    const out = s.serializeValue() as Record<string, unknown>;
    expect(out._dimensions).toEqual([2, 3, 2]);
    expect((out._elements as unknown[]).length).toBe(12);
  });
});

describe('an N-D struct array is not mistaken for a 1x1 struct', () => {
  // canAddChild/canRemoveChild gate on "is this a scalar struct, whose children
  // are FIELDS?" A 1x1x3 array satisfied d[0]===1 && d[1]===1, so the array root
  // offered to add a field beside its elements and to delete element 1 as though
  // it were a field — which also spliced the shared field list.
  it('refuses to add or remove a field on a 1x1x3 array root', () => {
    const s = findEntry(loadFile('../fixtures/nd_1x1x3.sldd'), 's113') as any;
    expect(s.children.length).toBe(3);
    expect(s.canAddChild()).toBe(false);
    expect(s.canRemoveChild()).toBe(false);
  });

  it('still allows both on a genuine 1x1 struct', () => {
    const p = findEntry(loadFile('./artifacts/binary/cases.sldd'), 'structScalar') as any;
    expect(p.canAddChild()).toBe(true);
    expect(p.canRemoveChild()).toBe(true);
  });
});

describe('an N-D value never displays as a 2-D literal', () => {
  // MATLAB has no bracketed literal for rank >= 3: truth.json records
  // mat2str_error "Input matrix must be 2-D." for nd2x3x2. Rendering page 1 as
  // `[1 2 3; 4 5 6]` is therefore not an approximation, it is a different value —
  // and it made a 2x3x2 indistinguishable from the 2x3 sitting next to it in the
  // same dictionary.
  it('summarizes rather than showing page 1 of a 2x3x2 double', () => {
    const root = loadFile('../fixtures/nd_binary.sldd');
    const a = findEntry(root, 'A');
    const kp = findEntry(root, 'Kp');
    expect(kp.displayValue).toBe('[1 2 3; 4 5 6]');
    expect(a.displayValue).toBe('<2x3x2 double>');
    expect(a.displayValue).not.toBe(kp.displayValue);
  });

  it('summarizes a 2x2x2 cell instead of showing four of its eight cells', () => {
    expect(findEntry(loadFile('../fixtures/nd_binary.sldd'), 'C').displayValue).toBe('<2x2x2 cell>');
  });

  it('summarizes a 1x1x3 double instead of showing its first value alone', () => {
    expect(findEntry(loadFile('../fixtures/nd_1x1x3.sldd'), 'A113').displayValue).toBe('<1x1x3 double>');
  });

  it('summarizes a 2x3x2 complex double', () => {
    expect(findEntry(loadFile('../fixtures/nd_complex.sldd'), 'Z').displayValue).toBe('<2x3x2 double>');
  });
});

describe('a complex N-D value keeps every element on the way in', () => {
  it('reads all twelve values of MATLAB\'s IsComplex="1" Dimension="2*3*2"', () => {
    // BinarySlddParser hands the cdata reader the full [2,3,2]; the reader looped
    // r<dims[0], c<dims[1] and so consumed six of the twelve values, dropping
    // MATLAB's entire second page on a plain open-and-save.
    const z = findEntry(loadFile('../fixtures/nd_complex.sldd'), 'Z') as any;
    expect(z._dims).toEqual([2, 3, 2]);
    expect(z.children.length).toBe(12);
    // Row-major within each page, which is the order the display layer and the
    // subscript helper both assume: page 1 is [1 3 5; 2 4 6] of MATLAB's
    // column-major 1..12, page 2 is [7 9 11; 8 10 12].
    expect(z.children.map((c: any) => c.displayValue)).toEqual([
      '1+1i', '3+3i', '5+5i', '2+2i', '4+4i', '6+6i',
      '7+7i', '9+9i', '11+11i', '8+8i', '10+10i', '12+12i',
    ]);
    const byLabel = new Map(z.children.map((c: any) => [c.displayName, c.displayValue]));
    expect(byLabel.get('Z(1,1,1)')).toBe('1+1i');
    expect(byLabel.get('Z(2,1,1)')).toBe('2+2i');
    expect(byLabel.get('Z(1,1,2)')).toBe('7+7i');
    expect(byLabel.get('Z(2,3,2)')).toBe('12+12i');
  });
});
