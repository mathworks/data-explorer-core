// Copyright 2026 The MathWorks, Inc.
//
// Sparse arrays and hex-encoded values, against MATLAB's own answers, in all four venues:
// test/fixtures/sparse/make_sparse_fixtures.m writes the same values into a .mat
// (sparse_values.mat), a model workspace (sparse_ws.slx) and a text and a binary
// dictionary (sparse_text.sldd, sparse_binary.sldd), and reads each back to record what
// MATLAB says it holds. Three things used to be wrong here:
//
//   * every sparse array said 'sparse' in its Class and Data Type cells and its summary
//     (`<10x10 sparse>`), where MATLAB's class() says double — or logical, or single —
//     and its own summary of the value is `10×10 double`;
//   * a sparse SINGLE read as a full one, its row indices taken for its values;
//   * in the binary dictionary every hex value showed 1494, a number parseFloat read out
//     of the hex text.
//
// And one thing is this package's choice rather than MATLAB's: a sparse array always shows
// as its summary, `<10x10 sparse double>`, at any size and inside a cell's literal too,
// with one element row per non-zero, labelled `name(r,c)` in MATLAB's column-major order.
// MATLAB's own struct and cell displays print a small one inline (`[0 2 0 4 0]`,
// `{[0 0 9]}` — the truth's fieldDisp and cellDisp), so those are not the oracle here.
//
// Everything below is driven by the truth files, so a value added to the generator is
// covered without editing this file:
//
//   * every value's class and size; a full value's every element, real and imaginary, in
//     MATLAB's order; a sparse value's non-zeros, which are what it holds (it holds no
//     dense list), by subscript and value, in MATLAB's order, and its element rows, which
//     are those non-zeros;
//   * its display, in this package's spelling of the numbers MATLAB recorded;
//   * that the four venues present every value the same, and in particular that the
//     binary dictionary presents what its text twin does;
//   * and that every path is one of the kinds checked, so none goes unchecked.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFile } from './parity/loadFile.js';
import { nodeAt } from './tools/matlabPath.js';
import { parseComplexNum } from '../src/datamodel/parser/XmlUtils.js';
import { uudecode } from '../src/datamodel/parser/CdataCodec.js';
import { matStreamPrefix } from '../src/datamodel/parser/EncodedValue.js';
import { readMxArrayRecords } from '../src/datamodel/parser/MxArrayParser.js';
import { serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';

// One part of a number as the truth records it: a number, or MATLAB's word where JSON has
// none ('Inf', '-Inf', 'NaN').
type Part = number | string;

interface ValueTruth {
  class: string;
  size: number[];
  numel: number;
  issparse: boolean;
  isreal: boolean;
  real?: Part[];
  imag?: Part[];
  fullOmitted?: string;
  nnz?: number;
  nonzeros: { rows: number[]; cols: number[]; real: Part[]; imag: Part[] };
}

interface PathTruth extends Partial<ValueTruth> {
  class: string;
  size: number[];
  isobject: boolean;
  fields?: string[];
  Value?: ValueTruth;
  DataType?: string;
  properties?: Record<string, { class: string; disp: string }>;
  [key: string]: unknown;
}

interface Truth {
  paths: Record<string, PathTruth>;
  venueDifferences: { path: string; what: string }[];
}

const truthOf = (name: string): Truth =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/sparse/${name}`, import.meta.url)), 'utf8'));

const VENUES = [
  { name: 'mat', truth: truthOf('sparse_values.truth.json'), variables: (): any => loadFile('../fixtures/sparse/sparse_values.mat') },
  { name: 'ws', truth: truthOf('sparse_ws.truth.json'), variables: (): any => loadFile('../fixtures/sparse/sparse_ws.slx').getSection('workspace') },
  { name: 'text', truth: truthOf('sparse_text_sldd.truth.json'), variables: (): any => loadFile('../fixtures/sparse/sparse_text.sldd').getSection('design') },
  { name: 'binary', truth: truthOf('sparse_binary_sldd.truth.json'), variables: (): any => loadFile('../fixtures/sparse/sparse_binary.sldd').getSection('design') },
] as const;

// ---- Numbers ------------------------------------------------------------------------

const numberOf = (p: Part): number => {
  const n = typeof p === 'number' ? p : p === 'Inf' ? Infinity : p === '-Inf' ? -Infinity : p === 'NaN' ? NaN : Number(p);
  // MATLAB's -0 and 0 are one value to every question here; JSON cannot tell them apart.
  return n === 0 ? 0 : n;
};

/** One element as this package holds it, as [re, im]. */
function partsOf(e: unknown, label: string): [number, number] {
  if (typeof e === 'boolean') return [e ? 1 : 0, 0];
  if (typeof e === 'number') return [numberOf(e), 0];
  if (typeof e === 'string') {
    const c = parseComplexNum(e);
    if (c) return [numberOf(c.re as Part), numberOf(c.im as Part)];
    return [numberOf(e), 0];
  }
  if (e && typeof e === 'object' && 're' in e) {
    const c = e as { re: Part; im: Part };
    return [numberOf(c.re), numberOf(c.im)];
  }
  throw new Error(`${label}: an element this test cannot read: ${JSON.stringify(e)}`);
}

/** The elements of a value node, in MATLAB's column-major order. */
function columnMajor(node: any, size: number[]): unknown[] {
  if (node._kind === 'scalar') return [node.Value];
  const rowMajor: unknown[] = node.Value;
  const [rows, cols] = size;
  const pages = size.slice(2).reduce((a, b) => a * b, 1);
  const out: unknown[] = [];
  for (let p = 0; p < pages; p++) {
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) out.push(rowMajor[p * rows * cols + r * cols + c]);
    }
  }
  return out;
}

// ---- The display, in this package's spelling --------------------------------------

const numberText = (n: number): string => (Number.isNaN(n) ? 'NaN' : n === Infinity ? 'Inf' : n === -Infinity ? '-Inf' : String(n));

function elementText(t: ValueTruth, re: number, im: number): string {
  if (t.class === 'logical') return re ? 'true' : 'false';
  if (!t.isreal) return numberText(re) + (im >= 0 ? '+' : '') + numberText(im) + 'i';
  return numberText(re);
}

/**
 * What the value's own cell shows: a sparse array its summary, whatever its size; a full
 * one a scalar inline, a small matrix as its literal, else a summary.
 */
function displayOf(t: ValueTruth): string {
  if (t.issparse) return `<${t.size.join('x')} sparse ${t.class}>`;
  if (t.numel > 10 || t.size.length > 2) return `<${t.size.join('x')} ${t.class}>`;
  if (t.numel === 0) return '[ ]';
  const re = t.real!.map(numberOf);
  const im = t.imag!.map(numberOf);
  if (t.numel === 1) return elementText(t, re[0], im[0]);
  const [rows, cols] = t.size;
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const line: string[] = [];
    for (let c = 0; c < cols; c++) line.push(elementText(t, re[c * rows + r], im[c * rows + r]));
    lines.push(line.join(' '));
  }
  return '[' + lines.join('; ') + ']';
}

/** A sparse store's entries as [row, col, re, im], 1-based, MATLAB's -0 read as 0. */
function entriesOf(s: any): [number, number, number, number][] {
  return Array.from(s.row as Int32Array, (r, k) => [r + 1, s.col[k] + 1, numberOf(s.re[k]), s.im ? numberOf(s.im[k]) : 0]);
}

/** A value with nothing around it: its class, size, display and every element. */
function expectValue(node: any, t: ValueTruth, label: string): void {
  // MATLAB's class(), complex included, never the storage.
  expect(node.className, label).toBe(t.class);
  expect(node.dataType, label).toBe(t.class);
  expect(node.dims.map(Number), label).toEqual(t.size.map(Number));
  expect(node.displayValue, label).toBe(displayOf(t));
  if (t.issparse) {
    expectNonzeroRows(node, t, label);
    // The value itself, which every writer reads: the non-zeros, every one, and nothing
    // else — at any size, past the truth's dense listing (spBig, spTall) as below it.
    const nz = t.nonzeros;
    expect(entriesOf(node._sparse), `${label} non-zeros`).toEqual(
      nz.rows.map((r, k) => [r, nz.cols[k], numberOf(nz.real[k]), numberOf(nz.imag[k])]),
    );
    expect([node._sparse.im !== null, node._elements.length], `${label} complexity, no dense list`).toEqual([!t.isreal, 0]);
    return;
  }
  const ours = columnMajor(node, t.size).map((e, k) => partsOf(e, `${label}(${k + 1})`));
  expect(ours.map((p) => p[0]), `${label} real`).toEqual(t.real!.map(numberOf));
  expect(ours.map((p) => p[1]), `${label} imag`).toEqual(t.imag!.map(numberOf));
}

/**
 * A sparse array's element rows: one per non-zero, labelled with its MATLAB subscript —
 * both of them, a vector's too, as MATLAB's own display of one has them, `(1,3) 9` — and
 * valued as the element, in MATLAB's column-major order. An all-zero one has none.
 */
function expectNonzeroRows(node: any, t: ValueTruth, label: string): void {
  const nz = t.nonzeros;
  expect(node.children.map((c: any) => c.displayName), `${label} rows`).toEqual(
    nz.rows.map((r, k) => `${node.displayName}(${r},${nz.cols[k]})`),
  );
  node.children.forEach((c: any, k: number) => {
    expect(partsOf(c._scalarValue, label), `${label} row ${k + 1}`).toEqual([numberOf(nz.real[k]), numberOf(nz.imag[k])]);
  });
  expect(node.children.length, `${label} nnz`).toBe(t.nnz);
}

const isValueTruth = (t: PathTruth): boolean => 'real' in t || 'fullOmitted' in t;

// A text dictionary writes an object's properties only where they differ from the class
// default (make_class_fixtures.m measured it, and make_sparse_fixtures.m sets fhAlias's Fh
// for that reason). numAlias's K is its default 7, so the text file has no K to show; the
// binary one writes every property.
const OMITTED_AT_DEFAULT = new Set(['text numAlias.K']);

// Where two venues spell one value differently on screen, and why. Not ours to change
// here: both are about how a FULL value is written, which this suite holds only as the
// dense control beside each sparse one.
const SPELLED_DIFFERENTLY: Record<string, string> = {
  // MATLAB's binary dictionary writes the element complex(-0, -3) as `-0.0-3.0i`, and this
  // package's complex text keeps the sign; the .mat and the text dictionary's cdata hold
  // the same -0 as a double, which prints as 0. The numbers are equal (the per-venue check
  // above says so); the spelling of the zero is not.
  dComplex: 'binary -0-3i, elsewhere 0-3i',
  // OMITTED_AT_DEFAULT: the text dictionary has no K.
  numAlias: 'text has no K',
};

// ---- Per venue: every path against MATLAB ------------------------------------------

for (const venue of VENUES) {
  describe(`${venue.name}: every value is what MATLAB says it is`, () => {
    const variables = venue.variables();
    for (const [path, t] of Object.entries(venue.truth.paths)) {
      it(path, () => {
        const node = nodeAt(variables, path);
        if (isValueTruth(t)) {
          expectValue(node, t as ValueTruth, `${venue.name} ${path}`);
          return;
        }
        expect(node.className, path).toBe(t.class);
        if (t.class === 'struct') {
          expect(node.dims.map(Number), path).toEqual(t.size.map(Number));
          expect(node.displayValue).toBe(`<${t.size.join('x')} struct>`);
          expect(node.children.map((c: any) => c.name)).toEqual(t.fields);
          return;
        }
        if (t.class === 'cell') {
          expect(node.dims.map(Number), path).toEqual(t.size.map(Number));
          // Its elements are paths of their own; the cell is their literal.
          expect(node.children).toHaveLength(t.numel);
          expect(node.displayValue).toBe('{' + node.children.map((c: any) => c.displayValue).join(', ') + '}');
          return;
        }
        if (t.Value) {
          // A Simulink.Parameter: its Value is a value with nothing around it, and the
          // Parameter's own row shows it. DataType is the Parameter's property.
          expect(node.dataType, path).toBe(t.DataType);
          const value = node.children.find((c: any) => c.name === 'Value');
          expectValue(value, t.Value, `${venue.name} ${path}.Value`);
          expect(node.displayValue, path).toBe(value.displayValue);
          return;
        }
        // An object of a class this package does not know: its properties, each as MATLAB
        // displays it.
        expect(t.isobject, path).toBe(true);
        expect(node.displayValue).toBe(`<1x1 ${t.class}>`);
        const props = t.properties!;
        const shownProps = Object.keys(props).filter((prop) => !OMITTED_AT_DEFAULT.has(`${venue.name} ${path}.${prop}`));
        expect(node.children.map((c: any) => c.name).sort(), path).toEqual(shownProps.sort());
        for (const prop of shownProps) {
          const p = props[prop];
          const child = node.children.find((c: any) => c.name === prop);
          expect(child.className, `${path}.${prop}`).toBe(p.class);
          const shown = p.class === 'char' ? `'${p.disp}'` : p.disp;
          expect(child.displayValue, `${path}.${prop}`).toBe(shown);
        }
      });
    }
  });
}

// ---- Across venues: one value, one presentation ------------------------------------

/**
 * What a node presents, minus what is about where it is rather than what it is: whether
 * it can be edited (a binary dictionary's hex value is read-only, the same value in a
 * .mat is not) and the order of an object's properties (each format lists them in its
 * own order; MATLAB's own display orders them by the class).
 */
function look(node: any): unknown {
  const children = node.children.map((c: any) => [c.name, look(c)]);
  if (node.isObjectPropertyBag) children.sort((a: any, b: any) => (a[0] < b[0] ? -1 : 1));
  return {
    className: node.className,
    dataType: node.dataType,
    displayValue: node.displayValue,
    displayName: node.displayName,
    dims: node.dims,
    children,
  };
}

describe('the four venues present every value alike', () => {
  const loaded = VENUES.map((v) => ({ ...v, root: v.variables() }));
  const [, , text, binary] = loaded;

  const top = (path: string) => /^[A-Za-z]\w*/.exec(path)![0];
  // What MATLAB itself stored differently in the text twin (see the last test below).
  const MATLAB_DIFFERS = new Set(text.truth.venueDifferences.map((d) => d.path));

  for (const path of Object.keys(binary.truth.paths)) {
    it(`${path}: the binary dictionary presents what its text twin does`, () => {
      const ours = look(nodeAt(binary.root, path));
      if (SPELLED_DIFFERENTLY[top(path)] || MATLAB_DIFFERS.has(path)) {
        expect(ours).not.toEqual(look(nodeAt(text.root, path)));
        return;
      }
      expect(ours).toEqual(look(nodeAt(text.root, path)));
    });
  }

  for (const path of Object.keys(loaded[0].truth.paths)) {
    it(`${path}: the .mat, the model workspace and the binary dictionary`, () => {
      const mat = look(nodeAt(loaded[0].root, path));
      expect(look(nodeAt(loaded[1].root, path))).toEqual(mat);
      if (SPELLED_DIFFERENTLY[top(path)]) {
        expect(look(nodeAt(binary.root, path))).not.toEqual(mat);
        return;
      }
      expect(look(nodeAt(binary.root, path))).toEqual(mat);
    });
  }

  it('MATLAB itself records one venue difference, and it is the one value shown differently', () => {
    // sparse(0,0) goes into a text dictionary as the literal [] and comes back DENSE —
    // MATLAB's own doing, recorded by the generator rather than failed. Its class and size
    // are a sparse one's; its display is not, because a sparse array shows its summary.
    expect(text.truth.venueDifferences.map((d) => [d.path, d.what])).toEqual([['spEmpty', 'issparse']]);
    for (const v of loaded.filter((l) => l !== text)) {
      expect(v.truth.venueDifferences, v.name).toEqual([]);
    }
    expect(nodeAt(text.root, 'spEmpty').displayValue).toBe('[ ]');
    for (const v of loaded.filter((l) => l !== text)) {
      expect(nodeAt(v.root, 'spEmpty').displayValue, v.name).toBe('<0x0 sparse double>');
    }
  });
});

// ---- Every kind of path is checked ---------------------------------------------------

describe('every path is one of the kinds checked', () => {
  it('in every venue', () => {
    for (const venue of VENUES) {
      for (const [path, t] of Object.entries(venue.truth.paths)) {
        const kind = isValueTruth(t)
          ? 'value'
          : t.class === 'struct' || t.class === 'cell'
            ? t.class
            : t.Value
              ? 'parameter'
              : t.isobject && t.properties
                ? 'object'
                : 'unchecked';
        expect(kind, `${venue.name} ${path}`).not.toBe('unchecked');
      }
    }
  });

  it('and the sweep reaches every class and storage it is meant to', () => {
    const values = Object.values(VENUES[3].truth.paths).filter(isValueTruth) as ValueTruth[];
    const sparse = values.filter((v) => v.issparse);
    expect(new Set(sparse.map((v) => v.class))).toEqual(new Set(['double', 'logical', 'single']));
    expect(sparse.some((v) => !v.isreal)).toBe(true);
    expect(sparse.some((v) => v.fullOmitted)).toBe(true);
    expect(values.filter((v) => !v.issparse).length).toBeGreaterThanOrEqual(9);
  });
});

// ---- The storage, where the reader keeps it --------------------------------------

describe('the storage is kept wherever the reader reads the array itself', () => {
  // A sparse array read out of MAT bytes knows it is one (MatlabVariableNode.isSparse),
  // which is what sends MatWriter to its sparse encoder and gives the array its summary
  // and its non-zero rows. A Simulink.Parameter's Value in a .mat, a workspace or a binary
  // dictionary is decoded through the MCOS subsystem, which used to hand a sparse property
  // over as a dense literal, so those three arrived full; the decoder now hands it over as
  // the stream it is (McosParser.resolveValue), and every venue keeps it.
  for (const venue of VENUES) {
    it(venue.name, () => {
      const variables = venue.variables();
      for (const [path, t] of Object.entries(venue.truth.paths)) {
        const value = isValueTruth(t) ? (t as ValueTruth) : t.Value;
        if (!value) continue;
        const node = isValueTruth(t) ? nodeAt(variables, path) : nodeAt(variables, path).children.find((c: any) => c.name === 'Value');
        expect(node.isSparse, `${venue.name} ${path}`).toBe(value.issparse);
      }
    });
  }
});

// ---- Writing one -----------------------------------------------------------------

// The variable a text dictionary's cdata stream holds, read back by the stream reader the
// venues share (and which the rest of this file holds to MATLAB's answers).
function streamVariable(value: any): any {
  expect(value?._type, 'a cdata stream').toBe('cdata');
  const bytes = matStreamPrefix(uudecode(value._value))!;
  return readMxArrayRecords(bytes.slice().buffer).outer;
}

// MATLAB's own text dictionary, as JSON: what each entry was written as.
const TEXT_JSON = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/sparse/sparse_text.sldd', import.meta.url)), 'utf8'));
const textRaw = (name: string): any =>
  TEXT_JSON.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === name).value;

// One non-zero of each bare sparse array the text twin holds, by MATLAB subscript, and
// what it is set to — a non-zero, because a zero has no row: nothing in the tree adds a
// non-zero (spAllZero has no rows at all). Each is chosen where the row's place among the
// rows differs from the element's place in the row-major value, where both exist: the
// edit has to reach the element the row names. Not spNonFinite's NaN: set to itself, it is
// this package's NaN, whose bits are not MATLAB's.
const ELEMENT_EDITS: [string, number, number, string, unknown][] = [
  ['spCol', 2, 1, '7', 7],
  ['spComplex', 2, 3, '42', { re: 42, im: 0 }],
  ['spDiag', 3, 3, '42', 42],
  ['spLogical', 2, 3, 'false', 0],
  ['spNonFinite', 2, 1, '9', 9],
  ['spRow', 1, 4, '7', 7],
  ['spSingle', 2, 1, '42', 42],
];

// A store's entries with the one at (r, c) set to `want`, as the writers keep them: only
// the non-zeros.
function editedEntries(s: any, r: number, c: number, want: unknown): [number, number, number, number][] {
  return entriesOf(s)
    .map(([er, ec, re, im]): [number, number, number, number] => (er === r && ec === c ? [er, ec, ...partsOf(want, `(${r},${c})`)] : [er, ec, re, im]))
    .filter(([, , re, im]) => re !== 0 || im !== 0);
}

// The element row at MATLAB subscript (r, c), found by its label.
function elementAt(node: any, r: number, c: number): any {
  const row = node.children.find((e: any) => e.displayName === `${node.displayName}(${r},${c})`);
  expect(row, `${node.displayName}(${r},${c})`).toBeDefined();
  return row;
}

describe('an edited sparse array is written in a form MATLAB reads back as itself', () => {
  it('in a text dictionary, an element set to the value it holds writes MATLAB\'s own stream back', () => {
    // An edited sparse array is the stream of its non-zeros MATLAB writes for one
    // (MatWriter.encodeSparse), so an edit that changes nothing writes MATLAB's bytes,
    // character for character. It used to be the `sparse` literal, which MATLAB reads as
    // what it was only for a real double matrix: a complex one came back an empty 1x0, a
    // column a row, a non-finite one reshaped, a logical or single one full.
    //
    // Not spComplex: its 0-3i holds MATLAB's -0 as the real part (-3i is -(0+3i)), which
    // the element's text, `0-3i`, does not carry, so the stream re-written for it has +0
    // there — the same value to MATLAB (isequaln), and to the test below, but not the same
    // bytes.
    const design = loadFile('../fixtures/sparse/sparse_text.sldd').getSection('design');
    for (const [name, r, c] of ELEMENT_EDITS.filter(([n]) => n !== 'spComplex')) {
      const node = design.children.find((e: any) => e.name === name);
      const el = elementAt(node, r, c);
      expect(el.setProperty('Value', el.displayValue), name).toBe(true);
      expect(node._rawInput, `${name} is edited`).toBeUndefined();
      expect(JSON.parse(JSON.stringify(node.serialize())).value, name).toEqual(textRaw(name));
    }
  });

  it('in a text dictionary, an edited element is in the stream, and the array is still sparse', () => {
    // A non-zero set to zero (spLogical's false) is not in it: a sparse array stores its
    // non-zeros. -0 and 0 are one, as MATLAB's isequaln has them (see the test above).
    const design = loadFile('../fixtures/sparse/sparse_text.sldd').getSection('design');
    for (const [name, r, c, text, want] of ELEMENT_EDITS) {
      const node = design.children.find((e: any) => e.name === name);
      const before = streamVariable(textRaw(name));
      expect(elementAt(node, r, c).setProperty('Value', text), name).toBe(true);
      const v = streamVariable(JSON.parse(JSON.stringify(node.serialize())).value);
      expect([v.isSparse, v.className, v.dimensions, v.isComplex], name).toEqual([true, before.className, before.dimensions, before.isComplex]);
      expect(entriesOf(v.sparse), name).toEqual(editedEntries(before.sparse, r, c, want));
    }
  });

  it('in a text dictionary, a value typed in whole is the full array MATLAB makes of the literal', () => {
    // `x = [1 2 3]` is full in MATLAB whatever x was, so the node stops being sparse: the
    // stream it would otherwise write is a different variable.
    const design = loadFile('../fixtures/sparse/sparse_text.sldd').getSection('design');
    const spRow = design.children.find((e: any) => e.name === 'spRow');
    expect(spRow.setProperty('Value', '[1 2 3]')).toBe(true);
    expect(spRow.isSparse).toBe(false);
    expect(JSON.parse(JSON.stringify(spRow.serialize())).value).toEqual([1, 2, 3]);
  });

  it('in a text dictionary, a renamed entry is written as it was read, whatever it holds', () => {
    // The value of a renamed entry is the one it was read as. It used to be rebuilt from
    // the node, which MATLAB read back as a different value for every sparse array: full,
    // a column as a row, the 1000x1000 spBig as `{}` (a 1x0), spTall — then too large to
    // decode — as the char of its own placeholder (MATLAB R2027a, all of them, before this).
    const design = loadFile('../fixtures/sparse/sparse_text.sldd').getSection('design');
    for (const entry of [...design.children]) {
      const before = JSON.parse(JSON.stringify(entry.serialize())).value;
      expect(entry.setProperty('Name', entry.name + 'Renamed'), entry.name).toBe(true);
      expect(JSON.parse(JSON.stringify(entry.serialize())).value, entry.name).toEqual(before);
    }
    for (const name of ['spBig', 'spTall', 'spCol', 'spComplex', 'spNonFinite']) {
      const entry = design.children.find((e: any) => e.name === name + 'Renamed');
      expect(JSON.parse(JSON.stringify(entry.serialize())).value, name).toEqual(textRaw(name));
    }
  });

  // This package's own literal for a sparse double, in both the forms _serializeArray writes
  // one in — a matrix, and a row — which a text dictionary this package wrote before it
  // could write a sparse stream holds: the literal, its size, its rows, its non-zeros.
  const LITERALS: [Record<string, string>, number[], [string, string][], number[][]][] = [
    [{ _type: 'sparse', _value: 'Matrix(2,2)\n[[42, 0]; [0, 5]]' }, [2, 2], [['(1,1)', '42'], ['(2,2)', '5']], [[1, 1, 42, 0], [2, 2, 5, 0]]],
    [{ _type: 'sparse', _value: '[0, 7, 0]' }, [1, 3], [['(1,2)', '7']], [[1, 2, 7, 0]]],
  ];

  it('this package\'s own `sparse` literal still reads as the sparse double it stands for, a row too', () => {
    // The row form read as a FULL array of a class named 'sparse', displayed `[0 7 0]`,
    // where the Property Inspector showed the same literal as `<1x3 sparse double>`.
    const design = loadFile('../fixtures/sparse/sparse_text.sldd').getSection('design');
    LITERALS.forEach(([value, dims, rows], k) => {
      const again = design.parseEntry({ name: `spLiteral${k}`, metadata: { uuid: `x${k}` }, value });
      expect([again.className, again.dataType, again.displayValue, again.isSparse, again.dims, again.children.map((c: any) => [c.displayName, c.displayValue])]).toEqual([
        'double',
        'double',
        `<${dims.join('x')} sparse double>`,
        true,
        dims,
        rows.map(([at, shown]) => [`spLiteral${k}${at}`, shown]),
      ]);
    });
  });

  it('that literal in a Parameter\'s Value or an object\'s cell, put into a binary dictionary, is hex, never `Class="sparse"`', () => {
    // 1.36.1 wrote it for an edited element of a Parameter's sparse Value (pSp) and of a
    // sparse array in a cell, so a text dictionary it saved holds it there. A copy of such
    // an entry into a binary dictionary reaches the property-bag writers, which spelled it
    // `Class="sparse"`: MATLAB's reader segfaults on that. The row form was spelled so
    // until it read as sparse.
    const binary = loadFile('../fixtures/sparse/sparse_binary.sldd').getSection('design');
    LITERALS.forEach(([literal, dims, , nonzeros], k) => {
      const pSp = JSON.parse(JSON.stringify(textRaw('pSp')));
      pSp._elements[0]._properties.Value = literal;
      const thing = {
        _array_class: 'my.Thing',
        _dimensions: [1, 1],
        _elements: [{ _id: '1', _properties: { C: { _array_type: 'Cell', _dimensions: [1, 2], _elements: [literal, 7], _mw_element_type: 'MATLABArray' } } }],
        _mw_element_type: 'MATLABArray',
      };
      for (const [name, value, tagName] of [[`pLiteral${k}`, pSp, 'P'], [`thingLiteral${k}`, thing, 'Element']] as const) {
        const entry = binary.parseEntry({ name, metadata: { uuid: `00000000-0000-4000-d000-${name.length}${k}000000000` }, value });
        const xml = serializeEntryToXml(entry);
        expect(xml, name).not.toContain('sparse');
        const m = new RegExp(`<${tagName}(?: Name="Value")? Class="double" Encoding="hex" EncodedLength="(\\d+)">([^<]*)</${tagName}>`).exec(xml);
        expect(m, name).not.toBeNull();
        const bytes = Uint8Array.from(m![2].replace(/\s+/g, '').match(/../g)!.map((h) => parseInt(h, 16)));
        const v = readMxArrayRecords(bytes.buffer).outer as any;
        expect([v.isSparse, v.className, v.dimensions, entriesOf(v.sparse)], name).toEqual([true, 'double', dims, nonzeros]);
      }
    });
  });

  it('a value typed over the largest of them is that value, and no longer sparse', () => {
    // spTall, 10000000x2 with two non-zeros, shows its summary, unquoted; a char typed over
    // it is a char, and is shown as one.
    for (const file of ['../fixtures/sparse/sparse_values.mat', '../fixtures/sparse/sparse_text.sldd']) {
      const root = loadFile(file);
      const spTall = (file.endsWith('.mat') ? root : root.getSection('design')).children.find((e: any) => e.name === 'spTall');
      expect(spTall.displayValue, file).toBe('<10000000x2 sparse double>');
      expect(spTall.setProperty('Value', "'abc'"), file).toBe(true);
      expect([spTall.displayValue, spTall.className, spTall.isSparse, spTall.serializeValue()], file).toEqual(["'abc'", 'char', false, 'abc']);
    }
  });

  it('one too large to decode with no stream to write is its placeholder, escaped, never markup', () => {
    // Every reader here leaves such a value its stream (the cdata it was read from, or the
    // element of a .mat or a model workspace), and those are what it is written as. Built
    // without one, all there is to write is the placeholder; unescaped inside a
    // Class="double" element it made the dictionary one MATLAB would not open at all.
    const node = MatlabVariableNode._createUndecoded(
      {
        name: '', className: 'double', dimensions: [10000000, 2], isComplex: false, isLogical: false, isSparse: true,
        value: '<10000000x2 sparse double, not decoded>', undecoded: 'too large', fields: null,
      },
      'spTall',
      null,
    );
    expect(node.serializeXml('P', { Name: 'Value' }, 2)).toBe(
      '        <P Name="Value" Class="double">&lt;10000000x2 sparse double, not decoded&gt;</P>',
    );
  });

  it('as XML, it is the hex of its stream, never `Class="sparse"`, the attribute MATLAB\'s reader crashes on', () => {
    // An edited sparse array put into a binary dictionary (a paste from a text one) has no
    // hex of its own to replay, and `Class="sparse"` made MATLAB's dictionary reader
    // segfault (measured, R2027a); the full array XML can spell is a different variable.
    const design = loadFile('../fixtures/sparse/sparse_text.sldd').getSection('design');
    for (const [name, r, c, text, want] of ELEMENT_EDITS) {
      const node = design.children.find((e: any) => e.name === name);
      expect(elementAt(node, r, c).setProperty('Value', text), name).toBe(true);
      const xml = node.serializeXml('P', { Name: 'Value' }, 2);
      expect(xml, name).not.toContain('sparse');
      const m = new RegExp(`^ *<P Name="Value" Class="${node.className}" Encoding="hex" EncodedLength="(\\d+)">([^<]*)</P>$`).exec(xml);
      expect(m, name).not.toBeNull();
      const bytes = Uint8Array.from(m![2].replace(/\s+/g, '').match(/../g)!.map((h) => parseInt(h, 16)));
      expect(bytes.length, name).toBe(Number(m![1]));
      const v = readMxArrayRecords(bytes.buffer).outer as any;
      expect([v.isSparse, entriesOf(v.sparse)], name).toEqual([true, editedEntries(streamVariable(textRaw(name)).sparse, r, c, want)]);
    }
  });

  it('in a .mat, an element edit is written sparse, and a value typed in whole full', async () => {
    const { encodeMatVariable } = await import('../src/datamodel/parser/MatWriter.js');
    const { parseMatrix } = await import('../src/datamodel/parser/MatParser.js');
    const decode = (bytes: Uint8Array): any => parseMatrix(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 8, bytes.length - 8);
    const mat = loadFile('../fixtures/sparse/sparse_values.mat');
    const spRow = mat.children.find((c: any) => c.name === 'spRow');
    expect(elementAt(spRow, 1, 2).setProperty('Value', '9')).toBe(true);
    const edited = decode(encodeMatVariable(spRow._var));
    expect([edited.isSparse, entriesOf(edited.sparse)]).toEqual([
      true,
      [
        [1, 2, 9, 0],
        [1, 4, 4, 0],
      ],
    ]);
    expect(spRow.setProperty('Value', '[1 2 3]')).toBe(true);
    const typed = decode(encodeMatVariable(spRow._var));
    expect([typed.isSparse ?? false, typed.className, typed.value]).toEqual([false, 'double', [1, 2, 3]]);
  });
});

describe('a Parameter\'s sparse Value read through an MCOS subsystem is the stream MATLAB writes for it', () => {
  it('in a .mat, a model workspace and a binary dictionary alike', () => {
    // McosParser used to hand it over as a dense literal: the Value was full, and a copy
    // of the Parameter into a dictionary wrote it full — into a text one, in a spelling
    // MATLAB reads back as an empty [] (R2027a). It is the text twin's own cdata now,
    // character for character, wherever it was read from.
    for (const venue of [VENUES[0], VENUES[1], VENUES[3]]) {
      const variables = venue.variables();
      for (const name of ['pSp', 'pSpComplex', 'pSpLogical']) {
        const value = nodeAt(variables, name).children.find((c: any) => c.name === 'Value');
        expect(value._rawInput, `${venue.name} ${name}`).toEqual(textRaw(name)._elements[0]._properties.Value);
      }
    }
  });
});

// ---- What the rows being the non-zeros did not change ------------------------------

/** Every sparse value a venue holds, bare or as a Parameter's Value: [path, node, truth]. */
function sparseValues(venue: (typeof VENUES)[number], variables: any): [string, any, ValueTruth][] {
  const out: [string, any, ValueTruth][] = [];
  for (const [path, t] of Object.entries(venue.truth.paths)) {
    const value = isValueTruth(t) ? (t as ValueTruth) : t.Value;
    if (!value || !value.issparse) continue;
    const node = isValueTruth(t) ? nodeAt(variables, path) : nodeAt(variables, path).children.find((c: any) => c.name === 'Value');
    out.push([isValueTruth(t) ? path : `${path}.Value`, node, value]);
  }
  return out;
}

describe('a sparse array\'s rows are its non-zeros, and it has no Variable Editor grid', () => {
  for (const venue of VENUES) {
    it(`${venue.name}: no grid, and a host is told why`, () => {
      // displayElements is the grid's data. A sparse array's elements are not held, so it
      // has none to give, and `isSparse` is what a host asks to offer no grid at all.
      const found = sparseValues(venue, venue.variables());
      expect(found.length, venue.name).toBeGreaterThanOrEqual(13);
      for (const [path, node] of found) {
        expect([node.isSparse, node.displayElements()], path).toEqual([true, null]);
      }
    });

    it(`${venue.name}: no element can be added or removed, the summary offers no editor, a row is as editable as it was`, () => {
      for (const [path, node] of sparseValues(venue, venue.variables())) {
        expect([node.canAddChild(), node.canRemoveChild(), node.valueEditable], path).toEqual([false, false, false]);
        for (const row of node.children) {
          // Hex-backed values are read-only through and through; the rest edit as before.
          expect(row.valueEditable, `${path} ${row.displayName}`).toBe(venue.name !== 'binary');
        }
      }
    });
  }

  it('an element row edits the non-zero it names, in a .mat, and the rest of the array is as it was', async () => {
    const { encodeMatVariable } = await import('../src/datamodel/parser/MatWriter.js');
    const { parseMatrix } = await import('../src/datamodel/parser/MatParser.js');
    const decode = (bytes: Uint8Array): any => parseMatrix(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 8, bytes.length - 8);
    for (const [name, r, c, text, want] of ELEMENT_EDITS) {
      const mat = loadFile('../fixtures/sparse/sparse_values.mat');
      const node = mat.children.find((e: any) => e.name === name);
      const read = entriesOf(node._matVar.sparse);
      expect(elementAt(node, r, c).setProperty('Value', text), name).toBe(true);
      // The node's own non-zeros: the one edited — kept, even at zero, so its row still
      // names it — and every other as it was. The variable it was read from is untouched.
      expect(entriesOf(node._sparse), name).toEqual(read.map((e) => (e[0] === r && e[1] === c ? [r, c, ...partsOf(want, name)] : e)));
      expect(entriesOf(node._matVar.sparse), name).toEqual(read);
      const written = decode(encodeMatVariable(node._var));
      expect([written.isSparse, written.className, written.dimensions], name).toEqual([true, node._matVar.className, node._matVar.dimensions]);
      expect(entriesOf(written.sparse), name).toEqual(editedEntries(node._matVar.sparse, r, c, want));
    }
  });

  it('a renamed .mat or workspace variable is written as the value it holds', async () => {
    // A rename makes the variable rebuild itself from the node (_var), which reads its
    // non-zeros off the node.
    const { encodeMatVariable } = await import('../src/datamodel/parser/MatWriter.js');
    const { parseMatrix } = await import('../src/datamodel/parser/MatParser.js');
    const decode = (bytes: Uint8Array): any => parseMatrix(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 8, bytes.length - 8);
    for (const venue of VENUES.slice(0, 2)) {
      const variables = venue.variables();
      let renamed = 0;
      for (const [path, node] of sparseValues(venue, variables)) {
        if (path.includes('.') || path.includes('{')) continue;
        const read = node._matVar;
        expect(node.setProperty('Name', node.name + 'Renamed'), path).toBe(true);
        expect(node._varStale, path).toBe(true);
        const written = decode(encodeMatVariable(node._var));
        // -0 and 0 as one (see ELEMENT_EDITS' first test): spComplex's 0-3i.
        expect([written.isSparse, written.className, written.dimensions, written.isComplex, entriesOf(written.sparse)], `${venue.name} ${path}`).toEqual([
          true,
          read.className,
          read.dimensions,
          read.isComplex,
          entriesOf(read.sparse),
        ]);
        renamed++;
      }
      expect(renamed, venue.name).toBeGreaterThanOrEqual(11);
    }
  });

  it('a writer\'s fallback, for a value MatWriter cannot write, still spells every element', () => {
    // serializeValue and serializeXml write a sparse array as its stream; these are what
    // they fall back to when MatWriter refuses one (a class or a rank MATLAB never stores
    // sparse), and they lay its elements out from its non-zeros.
    const design = loadFile('../fixtures/sparse/sparse_text.sldd').getSection('design');
    const spDiag = design.children.find((e: any) => e.name === 'spDiag');
    expect(elementAt(spDiag, 3, 3).setProperty('Value', '42')).toBe(true);
    const expected = Array.from({ length: 100 }, (_, i) => (i % 11 === 0 ? (i === 22 ? 42 : i / 11 + 1) : 0));
    const literal = spDiag._serializeArray();
    expect(literal._type).toBe('sparse');
    const again = MatlabVariableNode.parse(literal, 'again', null);
    expect([again._dims, again.isSparse, entriesOf(again._sparse)]).toEqual([
      [10, 10],
      true,
      Array.from({ length: 10 }, (_, k) => [k + 1, k + 1, k === 2 ? 42 : k + 1, 0]),
    ]);
    const xml = spDiag._serializeArrayXml('P', { Name: 'Value' }, 2);
    const body = /Dimension="10\*10">([^<]*)</.exec(xml)![1].trim().split(/\s+/).map(Number);
    // Column-major, as XML is.
    expect(body).toEqual(Array.from({ length: 100 }, (_, k) => expected[(k % 10) * 10 + Math.floor(k / 10)]));
    // A vector, which the literal spells as a bare list, and one with no rows at all.
    const spRow = design.children.find((e: any) => e.name === 'spRow');
    expect(elementAt(spRow, 1, 4).setProperty('Value', '7')).toBe(true);
    expect(spRow._serializeArray()).toEqual([0, 2, 0, 7, 0]);
    const spAllZero = design.children.find((e: any) => e.name === 'spAllZero');
    spAllZero._rawInput = undefined;
    const zero = MatlabVariableNode.parse(spAllZero._serializeArray(), 'z', null);
    expect([zero._dims, zero.isSparse, entriesOf(zero._sparse)]).toEqual([[3, 4], true, []]);
    // And a complex one is still complex when every non-zero is set to a real number: its
    // non-zeros still carry their (zero) imaginary parts.
    const spComplex = design.children.find((e: any) => e.name === 'spComplex');
    for (const [r, c] of [[1, 1], [3, 1], [2, 3], [1, 4]]) {
      expect(elementAt(spComplex, r, c).setProperty('Value', '1')).toBe(true);
    }
    expect([spComplex._isComplexValue(), spComplex._var.isComplex]).toEqual([true, true]);
    expect(/IsComplex="1" Dimension="3\*4">([^<]*)</.exec(spComplex._serializeArrayXml('P', { Name: 'Value' }, 2))![1].split(' ')).toEqual([
      '1.0+0.0i', '0.0+0.0i', '1.0+0.0i', '0.0+0.0i', '0.0+0.0i', '0.0+0.0i', '0.0+0.0i', '1.0+0.0i', '0.0+0.0i', '1.0+0.0i', '0.0+0.0i', '0.0+0.0i',
    ]);
  });

  it('past what it lays out densely, the fallback writes the summary, never a dense list', () => {
    // spTall's twenty million elements. Not a value MatWriter refuses — the fallback is
    // asked directly here, as a writer would be for one it did.
    const spTall = loadFile('../fixtures/sparse/sparse_text.sldd').getSection('design').children.find((e: any) => e.name === 'spTall');
    expect(spTall._serializeArray()).toBe('<10000000x2 sparse double>');
    expect(spTall._serializeArrayXml('P', { Name: 'Value' }, 0)).toBe('<P Name="Value" Class="double">&lt;10000000x2 sparse double&gt;</P>');
  });
});

describe('a full value copied out of a .mat or a workspace keeps its shape', () => {
  // The dense controls beside the sparse arrays. A value read out of MAT bytes has no
  // literal of its own to replay, and its writer spelled a column as a bare JSON list (a
  // row) and a matrix holding an Inf or a NaN as a typed row literal: copied into a
  // dictionary, MATLAB read dCol back 1x5 and dNonFinite 1x4 (R2027a, at 1.36.1 as on
  // this branch). And a Simulink.Parameter's matrix Value decoded through MCOS was spelled
  // with its rows joined by newlines, which MATLAB reads as an empty [] (pDense).
  const DENSE = ['dCol', 'dRow', 'dDiag', 'dNonFinite', 'dLogical', 'dSingle', 'dComplex', 'dAllZero', 'pDense'];
  for (const venue of [VENUES[0], VENUES[1]]) {
    it(`${venue.name}: into a text dictionary and a binary one, and back`, async () => {
      const { createSession } = await import('../src/index.js');
      const { ingest } = await import('../src/core/ingest.js');
      const session = createSession();
      const source = venue.variables();
      const roots = ['sparse_text.sldd', 'sparse_binary.sldd'].map((f) =>
        ingest(session, new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/sparse/${f}`, import.meta.url)))).slice().buffer, { filename: f }),
      ) as any[];
      let seq = 0;
      for (const root of roots) {
        for (const name of DENSE) {
          const value = JSON.parse(JSON.stringify(nodeAt(source, name).serializeValue()));
          root.getSection('design').parseEntry({ name: name + 'Copy', metadata: { uuid: `00000000-0000-4000-a000-${String(++seq).padStart(12, '0')}` }, value });
        }
        const saved = session.serializeSource(root.name)!;
        if (saved.kind === 'text') {
          // Read back by this package either way, the newline-joined rows are MATLAB's
          // empty [] (XmlUtils.formatMatrixSerial): no Matrix() literal may be spelled so.
          expect(saved.text!, venue.name).not.toMatch(/Matrix\(\d+,\d+\)\\n\[[^\[\]]*\]\\n\[/);
        }
        const bytes = saved.kind === 'text' ? new TextEncoder().encode(saved.text!) : saved.bytes!;
        const again: any = ingest(createSession(), bytes.slice().buffer, { filename: 'again.sldd' });
        for (const name of DENSE) {
          const want = look(nodeAt(source, name)) as any;
          const got = look(again.getSection('design').children.find((e: any) => e.name === name + 'Copy')) as any;
          // The copy's own name is in its rows' labels; the value is what is compared.
          const strip = (x: any): any => ({ ...x, displayName: undefined, children: x.children.map(([n, c]: any) => [n, strip(c)]) });
          expect(strip(got), `${venue.name} ${name} via ${saved.kind}`).toEqual(strip(want));
        }
      }
    });
  }
});

// ---- A function handle, the other value MATLAB writes as hex ---------------------

describe('a function handle shows as MATLAB shows it, in both dictionaries', () => {
  it('fhAlias.Fh is @sin, read-only, in the text twin and in the hex value', () => {
    // The text dictionary holds it as {"_type": "function_handle", "_value": "sin"}, which
    // read as the number parseFloat makes of 'sin' — 0, editable. The binary one holds the
    // whole object as hex for this property's sake, and the property decoded as MATLAB's
    // internal 2x1 cell {0xDD000000; struct(…, function_handle)}.
    for (const file of ['sparse_text.sldd', 'sparse_binary.sldd']) {
      const fh = loadFile(`../fixtures/sparse/${file}`).getSection('design').children.find((c: any) => c.name === 'fhAlias')
        .children.find((c: any) => c.name === 'Fh');
      expect([fh.className, fh.dataType, fh.displayValue, fh.valueEditable, fh.children.length], file).toEqual([
        'function_handle',
        'function_handle',
        '@sin',
        false,
        0,
      ]);
      // Refused for what it is, whatever is typed — a number and a vector included, which
      // the expression parser would take and the handle would become. In the binary
      // dictionary the whole object is a hex value, refused before it gets that far.
      const reason =
        file === 'sparse_text.sldd' ? 'A function handle is shown here but cannot be edited.' : expect.stringMatching(/is stored as an encoded MATLAB value/);
      for (const text of ['@cos', '1', '[1 2]', "'x'"]) {
        expect(fh.setProperty('Value', text), `${file} ${text}`).toMatchObject({ error: true, reason });
      }
      expect([fh.className, fh.displayValue], file).toEqual(['function_handle', '@sin']);
    }
  });

  it('an anonymous one keeps its own @, and an untouched one is written back as read', async () => {
    const NodeRegistry = (await import('../src/datamodel/node/NodeRegistry.js')).default;
    const literal = { _type: 'function_handle', _value: '@(x) x + 1' };
    const node: any = NodeRegistry.parseValue(literal, 'f', null);
    expect(node.displayValue).toBe('@(x) x + 1');
    expect(node.serializeValue()).toEqual(literal);
  });
});
