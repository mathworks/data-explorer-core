// Copyright 2026 The MathWorks, Inc.
//
// A sparse array as this package holds one: its non-zeros, and never its elements.
//
// What a sparse array costs is what it holds. `sparse(1e7, 2)` with two non-zeros is a
// 120-byte element in a file, and its dense form is twenty million slots — 145 MB to hold,
// 27 ms just to allocate, and about 2.9 GB once a grid labels every one. Until 1.36.2 the
// reader scattered every array into that form anyway and refused one past a million
// elements, so the array MATLAB stores in 120 bytes showed `<10000000x2 sparse double, not
// decoded>` with no rows, and spBig (1000x1000, five non-zeros) held a million zeros.
//
// The form is MATLAB's own `[i, j, v] = find(S)`, coordinate triplets in column-major order,
// rather than the file's ir/jc/pr: jc has an entry per COLUMN, so `sparse(1, 1e7)` would
// hold a 40 MB jc for two values, where triplets cost the same per non-zero at any shape.
// The writer rebuilds jc by counting, at write time only (MatWriter.encodeSparse).
//
// Parser-layer, so it imports nothing from the display or the node layer: MatParser
// produces one of these, MatWriter consumes one, and the node layer edits one.

import { parseComplexNum, parseMatlabNum } from './XmlUtils.js';

/**
 * The non-zeros of a sparse array: entry k is at 0-based (row[k], col[k]) and holds re[k]
 * (+ im[k]i). Sorted by column and, within a column, by row — the order MATLAB's display
 * lists them in, `(row,col) value` — with no (row, col) twice.
 *
 * `re` holds a logical array's values as 1 and a single array's as the doubles they are.
 * `im` is null for a real array and present for a complex one, every entry of it, so it IS
 * the array's complexity: a complex array whose every non-zero has been set to a real number
 * is still complex, as it is in MATLAB.
 *
 * As read, every entry is a non-zero (MATLAB's nnz rule: anything but 0 in either part, so
 * NaN stays and -0 goes). An edit can set one to zero, and it stays an entry — its element
 * row is still that entry's row — until the array is written, which keeps only the
 * non-zeros, or read again.
 *
 * `backedColumns` is how many columns what the array was read from backs: the column
 * starts its file's column index (jc) held, or, for a source with no index — a dense list,
 * this package's `sparse` literal — one column per element it holds. Never the dims alone:
 * a writer writes every column's start whatever the rows, so `Matrix(0,134217728)\n[]`,
 * credited the columns its header declared, was a 512 MB index from 52 characters, and a
 * dims word one corrupted byte turned from 2 columns to 2^31-1 was 8 GB. MatWriter refuses
 * an array that declares more columns than are backed (sparseWriteRefusal), and the node
 * layer offers it no editor. Absent, as on non-zeros a host builds itself, only the
 * entries back columns, one apiece (backedColumnsOf); a host that knows better says so here.
 */
export interface SparseData {
  row: Int32Array;
  col: Int32Array;
  re: Float64Array;
  im: Float64Array | null;
  backedColumns?: number;
}

/**
 * The most elements this package lays out densely for a sparse array: the writers' fallback,
 * for an array MatWriter cannot write as one (a class or a rank MATLAB never stores
 * sparse), spells every element, and past this many it has nothing to spell them with. A
 * million is the size the reader used to refuse a sparse array past, and the size a 1000x1000
 * is.
 */
export const MAX_DENSE_ELEMENTS = 1000000;

/** A sparse array of nothing but zeros, backed for `backedColumns` columns when known. */
export function emptySparse(complex: boolean, backedColumns?: number): SparseData {
  const s: SparseData = { row: new Int32Array(0), col: new Int32Array(0), re: new Float64Array(0), im: complex ? new Float64Array(0) : null };
  if (backedColumns !== undefined) {
    s.backedColumns = backedColumns;
  }
  return s;
}

/** An independent copy: an edit to one is not an edit to the other. */
export function cloneSparse(s: SparseData): SparseData {
  const copy: SparseData = { row: s.row.slice(), col: s.col.slice(), re: s.re.slice(), im: s.im ? s.im.slice() : null };
  if (s.backedColumns !== undefined) {
    copy.backedColumns = s.backedColumns;
  }
  return copy;
}

/** The columns `s` is backed for: what its source recorded, or one per entry it holds. */
export function backedColumnsOf(s: SparseData): number {
  return s.backedColumns ?? s.row.length;
}

/**
 * Why a sparse array's declared columns are more than what it was read from backs
 * (SparseData.backedColumns), or null when they are not — the reason a reader reports the
 * array as read short, phrased to follow its name.
 */
export function unbackedColumns(s: SparseData, dims: number[]): string | null {
  const cols = Math.max(0, dims[1] || 0);
  if (s.backedColumns === undefined || s.backedColumns >= cols) {
    return null;
  }
  return 'declares ' + cols + ' columns and its column index holds ' + s.backedColumns + ', so only the non-zeros of those were read';
}

/**
 * One complex element as the node layer holds it, `1+2i`, `3-4i`, `1NaNi`: each part
 * String()'d, and between them the imaginary part's own sign, or '+' when it is >= 0. The one
 * spelling of an element of a complex array read out of MAT bytes, full or sparse
 * (MatlabVariableNode._createFromMatNumeric), so the two show a value the same way.
 */
export function complexElement(re: number | string, im: number | string): string {
  return String(re) + (Number(im) >= 0 ? '+' : '') + String(im) + 'i';
}

/** Entry k as the node layer holds an element: a number, or complexElement's text. */
export function sparseEntry(s: SparseData, k: number): number | string {
  return s.im ? complexElement(s.re[k], s.im[k]) : s.re[k];
}

/**
 * A part of an element as a number: an exact token or MATLAB's word for a non-finite one
 * read as such, and anything that is not a number at all as 0.
 */
function partNumber(x: unknown): number {
  if (typeof x === 'number') {
    return x;
  }
  if (typeof x === 'boolean') {
    return x ? 1 : 0;
  }
  return typeof x === 'string' ? parseMatlabNum(x) : 0;
}

/**
 * An element in whichever form a layer holds one — a number, a boolean, an exact 64-bit
 * token, a `{ re, im }` pair, complex text (`'0-3i'`) — as its two parts.
 */
function elementParts(x: unknown): [number, number] {
  if (x !== null && typeof x === 'object' && 're' in x) {
    const c = x as { re: unknown; im?: unknown };
    return [partNumber(c.re), partNumber(c.im ?? 0)];
  }
  if (typeof x === 'string') {
    const c = parseComplexNum(x);
    if (c) {
      return [partNumber(c.re), partNumber(c.im)];
    }
  }
  return [partNumber(x), 0];
}

/**
 * Entry k set to `x`, an element in any of elementParts' forms — what an element row's edit
 * leaves in the row. A real array takes the real part alone: an element row of one takes
 * only a real number.
 */
export function setSparseEntry(s: SparseData, k: number, x: unknown): void {
  if (k < 0 || k >= s.re.length) {
    return;
  }
  const [re, im] = elementParts(x);
  s.re[k] = re;
  if (s.im) {
    s.im[k] = im;
  }
}

/**
 * The non-zeros of a dense row-major element list — what a writer or a host that built a
 * variable by hand hands over, and the body of this package's own `sparse` literal. A
 * missing element is a zero.
 *
 * It costs what the list holds, whatever its dims declare: the elements present are visited
 * once and the non-zeros sorted into column-major order. A `Matrix(1000000,1000000)` literal
 * holding one element visited all 1e12 cells of its declared shape. The list backs one
 * column per element it holds, and no more than the array declares
 * (SparseData.backedColumns): a complete list of rows x cols elements backs every column
 * except when it has no rows, and then it backs none.
 */
export function sparseFromDense(rowMajor: unknown[], dims: number[], complex: boolean): SparseData {
  const rows = Math.max(0, dims[0] || 0);
  const cols = Math.max(0, dims[1] || 0);
  const n = Math.min(rowMajor.length, rows * cols);
  const kept: [number, number, number, number][] = [];
  for (let at = 0; at < n; at++) {
    const [a, b] = elementParts(rowMajor[at]);
    const bb = complex ? b : 0;
    // `!== 0` is true of NaN and false of -0, which is MATLAB's rule for both.
    if (a !== 0 || bb !== 0) {
      kept.push([Math.floor(at / cols), at % cols, a, bb]);
    }
  }
  kept.sort((x, y) => x[1] - y[1] || x[0] - y[0]);
  return {
    row: Int32Array.from(kept, (e) => e[0]),
    col: Int32Array.from(kept, (e) => e[1]),
    re: Float64Array.from(kept, (e) => e[2]),
    im: complex ? Float64Array.from(kept, (e) => e[3]) : null,
    backedColumns: Math.min(cols, rowMajor.length),
  };
}

/**
 * Every element, row-major, as the node layer holds a full array's: a number, or for a
 * complex array complexElement's text (`0+0i` for a zero). Null past MAX_DENSE_ELEMENTS.
 */
export function sparseToDense(s: SparseData, dims: number[]): (number | string)[] | null {
  const rows = Math.max(0, dims[0] || 0);
  const cols = Math.max(0, dims[1] || 0);
  if (rows * cols > MAX_DENSE_ELEMENTS) {
    return null;
  }
  const out: (number | string)[] = new Array(rows * cols).fill(s.im ? complexElement(0, 0) : 0);
  for (let k = 0; k < s.row.length; k++) {
    if (s.row[k] < rows && s.col[k] < cols) {
      out[s.row[k] * cols + s.col[k]] = sparseEntry(s, k);
    }
  }
  return out;
}
