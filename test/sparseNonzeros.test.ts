// Copyright 2026 The MathWorks, Inc.
//
// A sparse array is held as its non-zeros and never as a dense list (1.36.3): what it
// costs is proportional to what it holds, so a sparse array of any declared size opens,
// with one row per non-zero. Until 1.36.2 the reader scattered the non-zeros into every
// element of the array, row-major, and past a million elements refused it instead: spTall,
// 10000000x2 with two non-zeros, showed `<10000000x2 sparse double, not decoded>` with no
// rows and a part-unreadable warning, and spBig, 1000x1000 with five, held a million
// zeros. A sparse array has no Variable Editor grid either: its rows are its non-zeros.
//
// test/sparseFixtures.test.ts grades every value against MATLAB's own answers in all four
// venues; this is what the storage itself owes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, parseMat } from '../src/index.js';
import { loadFile } from './parity/loadFile.js';
import { nodeAt } from './tools/matlabPath.js';
import { uudecode } from '../src/datamodel/parser/CdataCodec.js';
import { matStreamPrefix } from '../src/datamodel/parser/EncodedValue.js';
import { decodeMatStream } from '../src/datamodel/parser/MatParser.js';
import { encodeMatStream, encodeMatVariable, matStreamOfElement } from '../src/datamodel/parser/MatWriter.js';
import { sparseFromDense } from '../src/datamodel/parser/SparseData.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import { arrayFlags, CLASS, dims, element, matFile, matrix, MI, numericData, sparseVar, varName } from './tools/matBytes.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/** A variable's non-zeros as [row, col, re] — and im, when complex — 1-based as MATLAB counts. */
function entries(s: any): number[][] {
  expect(s, 'a sparse store').toBeTruthy();
  return Array.from(s.row as Int32Array, (r, k) => (s.im ? [r + 1, s.col[k] + 1, s.re[k], s.im[k]] : [r + 1, s.col[k] + 1, s.re[k]]));
}
const only = (buffer: ArrayBuffer) => parseMat(buffer).variables[0];
const rows = (node: any): [string, string][] => node.children.map((c: any) => [c.displayName, c.displayValue]);
const rowsOf = (node: any): [string, string, boolean][] => node.children.map((c: any) => [c.displayName, c.displayValue, c.valueEditable]);
const timed = <T>(f: () => T): [T, number] => {
  const t0 = performance.now();
  const out = f();
  return [out, performance.now() - t0];
};

/**
 * The subelements of the one miMATRIX element in a MAT stream, as [type, bytes] — read off
 * the stream itself rather than through the reader, which drops a stored zero.
 */
function subelements(stream: Uint8Array): [number, number][] {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const end = 16 + view.getUint32(12, true);
  const out: [number, number][] = [];
  for (let at = 16; at < end; ) {
    const word = view.getUint32(at, true);
    if (word >>> 16) {
      out.push([word & 0xffff, word >>> 16]);
      at += 8;
    } else {
      const n = view.getUint32(at + 4, true);
      out.push([word, n]);
      at += 8 + n + ((8 - (n % 8)) % 8);
    }
  }
  return out;
}
// The variable a MAT stream holds, read back by the reader every venue shares.
const streamOf = (bytes: Uint8Array) => {
  const read = decodeMatStream(bytes);
  if (!read.ok) throw new Error(read.reason);
  return read.variable;
};
const cdataVariable = (value: any) => {
  expect(value?._type, 'a cdata stream').toBe('cdata');
  return streamOf(matStreamPrefix(uudecode(value._value))!);
};

const VENUES = [
  ['mat', () => loadFile('../fixtures/sparse/sparse_values.mat')],
  ['ws', () => loadFile('../fixtures/sparse/sparse_ws.slx').getSection('workspace')],
  ['text', () => loadFile('../fixtures/sparse/sparse_text.sldd').getSection('design')],
  ['binary', () => loadFile('../fixtures/sparse/sparse_binary.sldd').getSection('design')],
] as const;

const TEXT_JSON = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/sparse/sparse_text.sldd', import.meta.url)), 'utf8'));
const textRaw = (name: string): any =>
  TEXT_JSON.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === name).value;

describe('the reader holds a sparse array as its non-zeros', () => {
  // S = sparse([1 2 3 2], [1 1 2 4], [10 11 20 30], 3, 4): find(S) is (1,1)=10, (2,1)=11,
  // (3,2)=20, (2,4)=30, column by column.
  const worked = { name: 'S', dimensions: [3, 4], ir: [0, 1, 2, 1], jc: [0, 2, 3, 3, 4], real: [10, 11, 20, 30] };

  it('in MATLAB\'s column-major order, with its summary as its value and no dense list anywhere', () => {
    const v = only(matFile([sparseVar(worked)]));
    expect(entries(v.sparse)).toEqual([
      [1, 1, 10],
      [2, 1, 11],
      [3, 2, 20],
      [2, 4, 30],
    ]);
    expect([v.className, v.isSparse, v.dimensions, v.value, v.undecoded]).toEqual(['double', true, [3, 4], '<3x4 sparse double>', undefined]);
  });

  it('complex with its imaginary parts, logical as ones, single as the doubles it holds', () => {
    const z = only(matFile([sparseVar({ name: 'Z', dimensions: [2, 2], ir: [0, 1], jc: [0, 1, 2], real: [1, 3], imag: [2, -4] })]));
    expect([z.isComplex, entries(z.sparse)]).toEqual([
      true,
      [
        [1, 1, 1, 2],
        [2, 2, 3, -4],
      ],
    ]);
    const l = only(matFile([sparseVar({ name: 'L', dimensions: [2, 2], ir: [0, 1], jc: [0, 1, 2], real: [1, 1], logical: true, dataType: MI.UINT8 })]));
    expect([l.className, l.sparse!.im, entries(l.sparse)]).toEqual(['logical', null, [[1, 1, 1], [2, 2, 1]]]);
    const s = only(matFile([sparseVar({ name: 'F', dimensions: [3, 2], ir: [1, 0, 2], jc: [0, 1, 3], real: [2.5, 1.5, -4], cls: CLASS.SINGLE, dataType: MI.SINGLE, sparseFlag: true })]));
    expect([s.className, s.value, entries(s.sparse)]).toEqual(['single', '<3x2 sparse single>', [[2, 1, 2.5], [1, 2, 1.5], [3, 2, -4]]]);
  });

  it('an all-zero one and an empty one hold nothing; a 1x1 is not unwrapped to a scalar', () => {
    const zero = only(matFile([sparseVar({ name: 'Z', dimensions: [3, 4], ir: [], jc: [0, 0, 0, 0, 0], real: [], nzmax: 1 })]));
    expect([zero.value, entries(zero.sparse)]).toEqual(['<3x4 sparse double>', []]);
    const empty = only(matFile([sparseVar({ name: 'E', dimensions: [0, 0], ir: [], jc: [0], real: [], nzmax: 1 })]));
    expect([empty.value, entries(empty.sparse)]).toEqual(['<0x0 sparse double>', []]);
    const one = only(matFile([sparseVar({ name: 'x', dimensions: [1, 1], ir: [0], jc: [0, 1], real: [5] })]));
    expect([one.value, entries(one.sparse)]).toEqual(['<1x1 sparse double>', [[1, 1, 5]]]);
  });

  it('whatever its declared size: spTall and spBig read in a moment, with nothing refused', () => {
    const parsed = parseMat(new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/sparse/sparse_values.mat', import.meta.url)))).slice().buffer);
    expect(parsed.warnings).toEqual([]);
    const tall = parsed.variables.find((v) => v.name === 'spTall')!;
    expect([tall.value, tall.undecoded, entries(tall.sparse)]).toEqual(['<10000000x2 sparse double>', undefined, [[1, 1, 7], [9999999, 2, 8]]]);
    const big = parsed.variables.find((v) => v.name === 'spBig')!;
    expect(entries(big.sparse)).toEqual([
      [1, 1, 1],
      [999, 2, 4],
      [500, 500, 3],
      [2, 999, 2],
      [1000, 1000, 5],
    ]);
  });
});

describe('a damaged sparse array costs what its bytes hold, not what it declares', () => {
  // The million-element limit was the only bound on the column walk, and on a column-start
  // list whose element type has no width: a corrupted dims word — one bad byte of a hex
  // value — would walk two billion columns, or allocate as many zeros.
  it('2^31-1 columns with a two-entry jc is read as the one column jc holds', () => {
    const [v, ms] = timed(() => only(matFile([sparseVar({ name: 'w', dimensions: [1, 0x7fffffff], ir: [0], jc: [0, 1], real: [5] })])));
    expect(entries(v.sparse)).toEqual([[1, 1, 5]]);
    expect(ms).toBeLessThan(1000);
  });

  it('index arrays of a type with no integer width are not indices', () => {
    const odd = (type: number, data: Uint8Array) => element(type, data);
    const v = (irType: number, jcType: number) =>
      only(
        matFile([
          matrix([
            arrayFlags(CLASS.SPARSE, { nzmax: 1 }),
            dims([1, 0x7fffffff]),
            varName('w'),
            odd(irType, new Uint8Array([0, 0, 0, 0])),
            odd(jcType, new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0])),
            numericData(MI.DOUBLE, [5]),
          ]),
        ]),
      );
    const [bad, ms] = timed(() => [v(MI.INT32, 0x63), v(0x63, MI.INT32), v(MI.INT32, MI.DOUBLE)]);
    expect(bad.map((x) => entries(x.sparse))).toEqual([[], [], []]);
    expect(ms).toBeLessThan(1000);
    // The control: the same bytes typed as MATLAB types them.
    expect(entries(v(MI.INT32, MI.INT32).sparse)).toEqual([[1, 1, 5]]);
  });

  it('rows out of order or repeated within a column are sorted, the last kept, as a dense read had them', () => {
    // A file MATLAB does not write, but nothing in the format forbids: the dense scatter
    // took the last value for a repeated row and the order from the matrix.
    const v = only(matFile([sparseVar({ name: 'u', dimensions: [3, 2], ir: [2, 0, 2, 1, 1], jc: [0, 3, 5], real: [5, 6, 7, 4, 0] })]));
    expect(entries(v.sparse)).toEqual([
      [1, 1, 6],
      [3, 1, 7],
    ]);
  });

  it('an explicit zero in the file is not a non-zero, nor a row out of range', () => {
    const v = only(matFile([sparseVar({ name: 'z', dimensions: [3, 1], ir: [0, 1, 7, -1], jc: [0, 4], real: [0, 4, 9, 9] })]));
    expect(entries(v.sparse)).toEqual([[2, 1, 4]]);
  });

  it('nor a row out of range in a column otherwise in MATLAB\'s order', () => {
    // Ascending, so the column is read as MATLAB writes one rather than sorted: the bound
    // there is the one the row has to pass.
    const v = only(matFile([sparseVar({ name: 'z', dimensions: [3, 1], ir: [0, 5], jc: [0, 2], real: [4, 5] })]));
    expect(entries(v.sparse)).toEqual([[1, 1, 4]]);
  });

  it('row indices in a narrower integer type are each read, at their own width', () => {
    // sparse([1; 2; 3]). MATLAB writes ir as miINT32, but the format lets it be any integer
    // type, and one counted at four bytes apiece lost the rest: miUINT8 read none of three.
    for (const type of [MI.INT8, MI.UINT8, MI.INT16, MI.UINT16, MI.INT32, MI.UINT32]) {
      const v = only(
        matFile([
          matrix([
            arrayFlags(CLASS.SPARSE, { nzmax: 3 }),
            dims([3, 1]),
            varName('x'),
            numericData(type, [0, 1, 2]),
            numericData(MI.INT32, [0, 3]),
            numericData(MI.DOUBLE, [1, 2, 3]),
          ]),
        ]),
      );
      expect(entries(v.sparse), `ir type ${type}`).toEqual([
        [1, 1, 1],
        [2, 1, 2],
        [3, 1, 3],
      ]);
    }
  });

  it('a dense list costs what it holds, not the size it declares', () => {
    // A 40-character `Matrix(40000,40000)` literal holding one element used to visit all
    // 1.6e9 cells; Matrix(1000000,1000000) would have taken minutes.
    const [s, ms] = timed(() => sparseFromDense([1, 2], [1000000, 1000000], false));
    expect(ms).toBeLessThan(100);
    expect(entries(s)).toEqual([
      [1, 1, 1],
      [1, 2, 2],
    ]);
    // In MATLAB's column-major order whatever the list's: [0 1; 2 0; 0 3].
    expect(entries(sparseFromDense([0, 1, 2, 0, 0, 3], [3, 2], false))).toEqual([
      [2, 1, 2],
      [1, 2, 1],
      [3, 2, 3],
    ]);
    const design = loadFile('../fixtures/sparse/sparse_text.sldd').getSection('design');
    const [node, parseMs] = timed((): any =>
      design.parseEntry({ name: 'big', metadata: { uuid: '00000000-0000-4000-e300-000000000001' }, value: { _type: 'sparse', _value: 'Matrix(1000000,1000000)\n[1]' } }),
    );
    expect(parseMs).toBeLessThan(100);
    // One element under a header that claims a trillion: what it holds is shown, and its
    // row is read-only, since no writer could write the column index the header declares.
    expect([node.displayValue, rowsOf(node)]).toEqual(['<1000000x1000000 sparse double>', [['big(1,1)', '1', false]]]);
    // And a host's dense list the same.
    const [hostNode, hostMs] = timed((): any =>
      MatlabVariableNode.parseMatVariable(
        { name: 'h', className: 'double', dimensions: [1000000, 1000000], isComplex: false, isLogical: false, isSparse: true, value: [0, 7], fields: null },
        'h',
        null,
      ),
    );
    expect(hostMs).toBeLessThan(100);
    expect(rowsOf(hostNode)).toEqual([['h(1,2)', '7', false]]);
  });
});

describe('a sparse array node holds its non-zeros, and offers no grid', () => {
  for (const [venue, open] of VENUES) {
    it(`${venue}: spTall opens with its two rows, editable where the venue edits`, () => {
      const root = open();
      const spTall = nodeAt(root, 'spTall');
      expect([spTall.displayValue, spTall.className, spTall.dims, spTall.isSparse, rows(spTall)]).toEqual([
        '<10000000x2 sparse double>',
        'double',
        [10000000, 2],
        true,
        [
          ['spTall(1,1)', '7'],
          ['spTall(9999999,2)', '8'],
        ],
      ]);
      expect(spTall.children.map((c: any) => c.valueEditable), venue).toEqual(venue === 'binary' ? [false, false] : [true, true]);
    });

    it(`${venue}: no sparse array lists its elements for a grid, and every one says it is sparse`, () => {
      const root = open();
      for (const path of ['spBig', 'spTall', 'spDiag', 'spAllZero', 'spComplex', 'spLogical', 'st.sp', 'c{1}']) {
        const node = nodeAt(root, path);
        expect([node.isSparse, node.displayElements()], `${venue} ${path}`).toEqual([true, null]);
      }
      // A full array still lists every element, and a cell its elements, a sparse one too.
      for (const path of ['dDiag', 'st.d', 'c{2}']) {
        const node = nodeAt(root, path);
        expect([node.isSparse, Array.isArray(node.displayElements())], `${venue} ${path}`).toEqual([false, true]);
      }
      expect(nodeAt(root, 'c').displayElements().map((e: any) => e.value), venue).toEqual(['<1x3 sparse double>', '[9 10]']);
    });
  }

  it('spBig holds its five non-zeros and no element list', () => {
    const spBig = nodeAt(loadFile('../fixtures/sparse/sparse_values.mat'), 'spBig');
    expect([spBig._elements.length, spBig.elements, spBig.Value, entries(spBig._sparse)]).toEqual([
      0,
      [],
      '<1000x1000 sparse double>',
      [
        [1, 1, 1],
        [999, 2, 4],
        [500, 500, 3],
        [2, 999, 2],
        [1000, 1000, 5],
      ],
    ]);
  });

  it('pTall.Value and cTall{1}, under an MCOS object and in a cell, are spTall too', () => {
    const fixtures = ['hexobj_text.sldd', 'hexobj_binary.sldd', 'hexobj_values.mat'];
    for (const file of fixtures) {
      const root = loadFile(`../fixtures/sparse/${file}`);
      const variables = file.endsWith('.mat') ? root : root.getSection('design');
      const pTall = nodeAt(variables, 'pTall');
      const value = pTall.children.find((c: any) => c.name === 'Value');
      const cell = nodeAt(variables, 'cTall{1}');
      for (const [what, node] of [['pTall.Value', value], ['cTall{1}', cell]] as const) {
        expect([node?.displayValue, node?.isSparse, node?.children.map((c: any) => c.displayValue)], `${file} ${what}`).toEqual([
          '<10000000x2 sparse double>',
          true,
          ['7', '8'],
        ]);
      }
      expect(pTall.displayValue, file).toBe('<10000000x2 sparse double>');
      // No part-unreadable warning, which is absent when there is nothing to report.
      expect(root.warnings, file).toBeUndefined();
    }
  });
});

describe('an edit changes the non-zero it names, and the writers write the non-zeros', () => {
  it('a non-zero set to 0 keeps its row, showing 0, and is not in what is written', () => {
    const design = loadFile('../fixtures/sparse/sparse_text.sldd').getSection('design');
    const spRow = design.children.find((e: any) => e.name === 'spRow');
    expect(spRow.children[1].setProperty('Value', '0')).toBe(true);
    expect(rows(spRow)).toEqual([
      ['spRow(1,2)', '2'],
      ['spRow(1,4)', '0'],
    ]);
    const value = JSON.parse(JSON.stringify(spRow.serialize())).value;
    const written = cdataVariable(value);
    expect([written.isSparse, written.dimensions, entries(written.sparse)]).toEqual([true, [1, 5], [[1, 2, 2]]]);
    // In the stream itself, not only as the reader reads it (which drops a stored zero):
    // nzmax 1, one row index, one value.
    const stream = matStreamPrefix(uudecode(value._value))!;
    expect(new DataView(stream.buffer, stream.byteOffset).getUint32(28, true)).toBe(1);
    const subs = subelements(stream);
    expect([subs[3], subs[5]]).toEqual([
      [MI.INT32, 4],
      [MI.DOUBLE, 8],
    ]);
    // And the row still edits its own element.
    expect(spRow.children[1].setProperty('Value', '6')).toBe(true);
    expect(entries(cdataVariable(JSON.parse(JSON.stringify(spRow.serialize())).value).sparse)).toEqual([
      [1, 2, 2],
      [1, 4, 6],
    ]);
  });

  it('a complex array whose every non-zero is set to a real number is still complex', () => {
    // Its complexity used to ride on the text of its zeros, `0+0i`; there are none now.
    const design = loadFile('../fixtures/sparse/sparse_text.sldd').getSection('design');
    const spComplex = design.children.find((e: any) => e.name === 'spComplex');
    for (const row of spComplex.children) {
      expect(row.setProperty('Value', '1')).toBe(true);
    }
    const written = cdataVariable(JSON.parse(JSON.stringify(spComplex.serialize())).value);
    expect([spComplex._isComplexValue(), written.isComplex, entries(written.sparse)]).toEqual([
      true,
      true,
      [
        [1, 1, 1, 0],
        [3, 1, 1, 0],
        [2, 3, 1, 0],
        [1, 4, 1, 0],
      ],
    ]);
  });

  it('spTall, edited, is written from its non-zeros; set to what it holds, as MATLAB wrote it', () => {
    const design = loadFile('../fixtures/sparse/sparse_text.sldd').getSection('design');
    const spTall = design.children.find((e: any) => e.name === 'spTall');
    const row = spTall.children[1];
    expect(row.setProperty('Value', row.displayValue)).toBe(true);
    expect(spTall._rawInput).toBeUndefined();
    expect(JSON.parse(JSON.stringify(spTall.serialize())).value).toEqual(textRaw('spTall'));
    expect(row.setProperty('Value', '9')).toBe(true);
    expect(entries(cdataVariable(JSON.parse(JSON.stringify(spTall.serialize())).value).sparse)).toEqual([
      [1, 1, 7],
      [9999999, 2, 9],
    ]);
    // Out of a .mat, the same: an element of a hundred-odd bytes, as MATLAB's is.
    const mat = nodeAt(loadFile('../fixtures/sparse/sparse_values.mat'), 'spTall');
    expect(mat.children[0].setProperty('Value', '3')).toBe(true);
    expect(encodeMatVariable(mat._var).length).toBeLessThan(200);
    expect(entries(streamOf(encodeMatStream(mat._var)).sparse)).toEqual([
      [1, 1, 3],
      [9999999, 2, 8],
    ]);
  });

  it('an edit changes the node, not the variable it was read from', () => {
    const mat = nodeAt(loadFile('../fixtures/sparse/sparse_values.mat'), 'spDiag');
    expect(mat.children[2].setProperty('Value', '42')).toBe(true);
    expect([entries(mat._sparse)[2], entries(mat._matVar.sparse)[2]]).toEqual([
      [3, 3, 42],
      [3, 3, 3],
    ]);
  });

  it('copied out of a .mat once edited, it is the edit, not the bytes it was read from', () => {
    // Unedited, a copy is the element the array was read from (_matStream); an edit is what
    // ends that, at the top of a .mat, in a struct field and in a cell element alike.
    const mat = loadFile('../fixtures/sparse/sparse_values.mat');
    const cases: [string, (v: any) => any][] = [
      ['spDiag', (v) => v],
      ['st', (v) => v._elements[0].sp],
      ['c', (v) => v._elements[0]],
    ];
    for (const [name, pick] of cases) {
      const node = nodeAt(mat, name === 'spDiag' ? 'spDiag' : name === 'st' ? 'st.sp' : 'c{1}');
      const before = entries(cdataVariable(pick(JSON.parse(JSON.stringify(nodeAt(mat, name).serializeValue())))).sparse);
      expect(node.children[0].setProperty('Value', '77'), name).toBe(true);
      const after = entries(cdataVariable(pick(JSON.parse(JSON.stringify(nodeAt(mat, name).serializeValue())))).sparse);
      expect(after, name).toEqual([[...before[0].slice(0, 2), 77], ...before.slice(1)]);
    }
  });

  it('a host\'s non-zeros under a column count no stream can hold are refused, as an error to catch', () => {
    // No reader says what backs them (SparseData.backedColumns), so the stream's own limit is
    // the one there is: a column index of 2^31 words is past what its uint32 size can say.
    const [thrown, ms] = timed(() => {
      try {
        encodeMatVariable({
          name: '', className: 'double', dimensions: [1, 0x7fffffff], isComplex: false, isLogical: false, isSparse: true, value: '<1x2147483647 sparse double>', fields: null,
          sparse: { row: Int32Array.from([0]), col: Int32Array.from([0]), re: Float64Array.from([5]), im: null },
        });
        return null;
      } catch (e) {
        return e;
      }
    });
    expect([(thrown as Error)?.name, ms < 1000]).toEqual(['MatWriteError', true]);
  });
});

describe('past the row budget, a sparse array is its summary alone, and its bytes are kept', () => {
  it('no rows, no grid; copied out of a .mat it is the element it was read from, and a dictionary\'s is replayed', () => {
    // 10001 non-zeros in a 1x20000: over MAX_EXPANDED_ELEMENTS in rows, so there are none,
    // and nothing can edit it — so nothing re-encodes it.
    const nnz = 10001;
    const element = sparseVar({
      name: 'big',
      dimensions: [1, 20000],
      ir: Array.from({ length: nnz }, () => 0),
      jc: Array.from({ length: 20001 }, (_, c) => Math.min(c, nnz)),
      real: Array.from({ length: nnz }, (_, k) => k + 1),
    });
    const mat: any = createSession().addMatSource('big.mat', matFile([element]));
    const big = mat.children[0];
    expect([big.displayValue, big.children.length, big.displayElements()]).toEqual(['<1x20000 sparse double>', 0, null]);
    const copied = big.serializeValue() as any;
    expect([...matStreamPrefix(uudecode(copied._value))!]).toEqual([...matStreamOfElement(element)!]);
    const design = loadFile('../fixtures/sparse/sparse_text.sldd').getSection('design');
    const pasted = design.parseEntry({ name: 'bigCopy', metadata: { uuid: '00000000-0000-4000-e300-000000000002' }, value: copied });
    expect([pasted.children.length, pasted.serializeValue()]).toEqual([0, copied]);
  });
});

describe('a host that builds a sparse variable as a dense list still gets a sparse node', () => {
  it('from the list, as MatParser used to hand one over', () => {
    const session = createSession();
    const root: any = session.addMatSource('h.mat', matFile([sparseVar({ name: 'x', dimensions: [2, 2], ir: [1], jc: [0, 1, 1], real: [4] })]));
    const variable = { ...root.children[0]._matVar, sparse: undefined, value: [0, 0, 4, 0] };
    const node = root.children[0].constructor.parseMatVariable(variable, 'y', null);
    expect([node.isSparse, rows(node)]).toEqual([true, [['y(2,1)', '4']]]);
  });
});
