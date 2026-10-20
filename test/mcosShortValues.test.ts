// Copyright 2026 The MathWorks, Inc.
//
// A struct array or a cell under a decoded object that holds fewer elements than it declares
// says so (F1-4), as the same value at the top of a .mat does (MatParser.collectUndecoded).
//
// What is shown does not change: a row for each element the bytes hold (McosParser
// buildStructValue lays out structElementsHeld, its cell arm the cells read), which is what
// matStructArray.test.ts pins. What changes is that a `<1x3 struct>` with one row, or a
// `{'suv', 'electric', [ ]}` with two, is no longer silent: one `part-unreadable` warning,
// named by the value's MATLAB path, in the words collectUndecoded uses for it.
//
// Every fixture here is MATLAB-written; the damage is a same-length respelling of the value's
// dims, located by its header bytes and asserted to land exactly once (renameInMat's hits).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renameInMat } from './tools/matRename.js';
import { MatBudgetError, createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { buildTypedNodeFromMcos } from '../src/datamodel/node/data/mcosTypedNode.js';
import StructNode from '../src/datamodel/node/data/StructNode.js';
import type { ParseWarning } from '../src/datamodel/parser/ParseWarning.js';
import '../src/datamodel/node/data/NodeClassMap.js';
import { thrownBy } from './tools/pasteVenues.js';

const fixture = (rel: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${rel}`, import.meta.url)));

// collectUndecoded's two messages, spelled out here rather than imported, so that a change to
// either site's wording fails this file.
const elementsSaid = (path: string, declared: number, read: number): ParseWarning => ({
  code: 'part-unreadable',
  message: `"${path}" declares ${declared} element(s) and only ${read} could be read.`,
  part: path,
});
const cellsSaid = (path: string, declared: number, read: number): ParseWarning => ({
  code: 'part-unreadable',
  message: `"${path}" declares ${declared} cell(s) and only ${read} could be read.`,
  part: path,
});
// Every message either site files, and nothing else: the positive tests below match it, so the
// sweep at the end cannot pass on a needle that matches nothing.
const SHORT = /^"[^"]*" declares \d+ (element|cell)\(s\) and only \d+ could be read\.$/;
const shortOf = (warnings: readonly ParseWarning[] | undefined) => (warnings ?? []).filter((w) => SHORT.test(w.message));

// arr(3).Value of fixtures/mcos/paramArray.mat, MATLAB's struct('a', 1), respelled in place as
// a struct array of `d`: its field `a` kept, and the one element's bytes after it. The same
// respelling as matStructArray.test.ts's.
const paramStruct = (d: number[]) =>
  Uint8Array.from([5, 0, 0, 0, 8, 0, 0, 0, ...new Uint8Array(Int32Array.from(d).buffer), 1, 0, 0, 0, 0, 0, 0, 0, 5, 0, 4, 0, 5, 0, 0, 0, 1, 0, 0, 0, 5, 0, 0, 0, 0x61]);
function paramOpened(d: number[]): { arr: any; warnings: ParseWarning[] } {
  const out = renameInMat(fixture('mcos/paramArray.mat'), paramStruct([1, 1]), paramStruct(d));
  expect(out.hits).toBe(1);
  const src: any = createSession().addMatSource('paramArray.mat', out.bytes);
  return { arr: src.children.find((c: any) => c.name === 'arr'), warnings: src.warnings ?? [] };
}

// A cell's array flags, its dims and its empty name, which is how MATLAB writes a cell held by
// an object's property. holder.C of fixtures/mcos/complex_objects.mat, MATLAB's
// {1+2i, [3+4i 5+6i]}, is the one 1x2 cell in that file.
const cellHeader = (d: number[]) =>
  Uint8Array.from([6, 0, 0, 0, 8, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 8, 0, 0, 0, ...new Uint8Array(Int32Array.from(d).buffer), 1, 0, 0, 0, 0, 0, 0, 0]);
function holderOpened(d: number[]): { holder: any; warnings: ParseWarning[] } {
  const out = renameInMat(fixture('mcos/complex_objects.mat'), cellHeader([1, 2]), cellHeader(d));
  expect(out.hits).toBe(1);
  const src: any = createSession().addMatSource('complex_objects.mat', out.bytes);
  return { holder: src.children.find((c: any) => c.name === 'holder'), warnings: src.warnings ?? [] };
}

const shown = (n: any) => [n.displayName, n.displayValue, n.children.length];
const rowsOf = (n: any) => n.children.map((e: any) => [e.displayName, e.children.map((f: any) => [f.name, f.displayValue])]);

describe('a struct array under a decoded object that holds fewer elements than it declares', () => {
  it('says so once, named by its MATLAB path, and keeps its rows', () => {
    const { arr, warnings } = paramOpened([1, 3]);
    expect(warnings).toEqual([elementsSaid('arr(3).Value', 3, 1)]);
    // The rows are matStructArray.test.ts's: one element row, holding the field it read.
    const value = arr.children[2].children[0];
    expect([shown(value), value instanceof StructNode, rowsOf(value)]).toEqual([['Value', '<1x3 struct>', 1], true, [['Value(1)', [['a', '1']]]]]);
  });

  it('counts every extent, a column and the size that once ran the heap out', () => {
    expect(paramOpened([3, 1]).warnings).toEqual([elementsSaid('arr(3).Value', 3, 1)]);
    expect(paramOpened([1, 999_999]).warnings).toEqual([elementsSaid('arr(3).Value', 999_999, 1)]);
  });

  it('control: the pristine file, a 1x1 holding its one element, says nothing', () => {
    const { arr, warnings } = paramOpened([1, 1]);
    expect(warnings).toEqual([]);
    expect(shown(arr.children[2].children[0])).toEqual(['Value', '<1x1 struct>', 1]);
  });
});

describe('a cell under a decoded object that holds fewer cells than it declares', () => {
  it('says so once, in the words a short cell at the top of a .mat gets, and keeps its rows', () => {
    const { holder, warnings } = holderOpened([1, 3]);
    expect(warnings).toEqual([cellsSaid('holder.C', 3, 2)]);
    const c = holder.children.find((x: any) => x.name === 'C');
    expect(c.children.map((x: any) => x.displayName)).toEqual(['C{1}', 'C{2}']);
    // Every extent: a 2x2 that holds the two of a 1x2.
    expect(holderOpened([2, 2]).warnings).toEqual([cellsSaid('holder.C', 4, 2)]);
  });

  it('control: the pristine file says nothing', () => {
    const { holder, warnings } = holderOpened([1, 2]);
    expect(warnings).toEqual([]);
    expect(holder.children.find((x: any) => x.name === 'C').children).toHaveLength(2);
  });
});

// holder.C's two elements as MATLAB wrote them, 1+2i and [3+4i 5+6i]: each one's miMATRIX tag (14) and
// byte count, its array flags (a complex double, class 6) and its dims, and the first one's name and
// parts. `tag` and `cls` respell an element in place, at the same length, so the cell's walk still
// lands on the next element where MATLAB put it.
const firstCell = (tag = 14, cls = 6, d = [1, 1]) => [
  tag, 0, 0, 0, 72, 0, 0, 0, 6, 0, 0, 0, 8, 0, 0, 0, cls, 8, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 8, 0, 0, 0, ...new Uint8Array(Int32Array.from(d).buffer),
  1, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 240, 63, 9, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64,
];
const secondCellTag = (tag = 14) => [tag, 0, 0, 0, 88, 0, 0, 0];
function slotsOpened(d: number[], first: number[], second = secondCellTag()): { c: any; warnings: ParseWarning[] } {
  const from = Uint8Array.from([...cellHeader([1, 2]), ...firstCell(), ...secondCellTag()]);
  const out = renameInMat(fixture('mcos/complex_objects.mat'), from, Uint8Array.from([...cellHeader(d), ...first, ...second]));
  expect(out.hits).toBe(1);
  const src: any = createSession().addMatSource('complex_objects.mat', out.bytes);
  const holder = src.children.find((x: any) => x.name === 'holder');
  return { c: holder.children.find((x: any) => x.name === 'C'), warnings: src.warnings ?? [] };
}
// In a .mat every row under an object takes no edit, a slot read as well as one that was not: its
// save writes the object only as it was read (MatNode._editRefusal). What tells the two apart is
// their values, and the copy of the one not decoded, which is refused (copyRefused).
const slotRows = (c: any) => c.children.map((e: any) => [e.displayName, e.displayValue, e.valueEditable]);
// What a host meets copying the slot: the refusal of a value that was not decoded (F1-10), naming it.
function copyRefused(node: any): unknown[] {
  const [e] = thrownBy(() => node.serialize());
  const b = e as MatBudgetError | null;
  return [e instanceof MatBudgetError, b?.reason, b?.entry, b?.at, e?.message];
}
const refusedAs = (what: string, why?: string) => [
  true, 'not-decoded', 'holder', 'holder.C{1}',
  `Cannot write "holder": holder.C{1} is ${what} that was not decoded${why ? ` (${why})` : ''}, so there is no value of it to write. Nothing was written.`,
];

describe('a cell slot under a decoded object that could not be read', () => {
  // McosParser's cell arm resolved each slot and kept what it could not read as `undefined`, which
  // the node layer built as the double 0: holder.C showed `{0, [3+4i 5+6i]}`, editable, said nothing,
  // and a copy of the slot was the 0. At the top of a .mat the same cell says it holds one cell of
  // its two (MatParser.collectUndecoded). Under an object it now says so in those words, and the slot
  // shows as not decoded (theme 1: show what was read), with no editor and a refused copy. (No row
  // under the object takes an edit in a .mat, whose save writes the object as it was read.)
  it('one that is not a matrix: shown as not decoded, in its own place, and counted as not read', () => {
    const { c, warnings } = slotsOpened([1, 2], firstCell(2));
    expect(warnings).toEqual([cellsSaid('holder.C', 2, 1)]);
    expect(slotRows(c)).toEqual([['C{1}', '<unknown, not decoded>', false], ['C{2}', '[3+4i 5+6i]', false]]);
    expect(c.displayValue).toBe('{<unknown, not decoded>, [3+4i 5+6i]}');
    expect(copyRefused(c.children[0])).toEqual(refusedAs('a 1x1 unknown'));
    // The second slot, the first read: nothing slides into the hole.
    const second = slotsOpened([1, 2], firstCell(), secondCellTag(2));
    expect(second.warnings).toEqual([cellsSaid('holder.C', 2, 1)]);
    expect(slotRows(second.c)).toEqual([['C{1}', '1+2i', false], ['C{2}', '<unknown, not decoded>', false]]);
  });

  it('one of a class the reader does not model: the same, under the class the file names', () => {
    const { c, warnings } = slotsOpened([1, 2], firstCell(14, 99));
    expect(warnings).toEqual([cellsSaid('holder.C', 2, 1)]);
    expect(slotRows(c)).toEqual([['C{1}', '<1x1 unknown, not decoded>', false], ['C{2}', '[3+4i 5+6i]', false]]);
    expect(copyRefused(c.children[0])).toEqual(refusedAs('a 1x1 unknown', 'its MAT array class is not one this reader models'));
  });

  it('one the reader recorded without decoding: shown by its placeholder, and said with its reason, as at the top of a .mat', () => {
    const { c, warnings } = slotsOpened([1, 2], firstCell(14, 6, [1, 100_000_000]));
    const why = 'declares 100000000 elements, more than the 32 bytes left in it can hold';
    expect(warnings).toEqual([{ code: 'part-unreadable', message: `"holder.C{1}" was not decoded: ${why}.`, part: 'holder.C{1}' }]);
    expect(slotRows(c)).toEqual([['C{1}', '<1x100000000 double, not decoded>', false], ['C{2}', '[3+4i 5+6i]', false]]);
    expect(copyRefused(c.children[0])).toEqual(refusedAs('a 1x100000000 double', why));
  });

  it('in a cell that also holds fewer cells than it declares: one warning, counting both', () => {
    const { c, warnings } = slotsOpened([1, 3], firstCell(2));
    expect(warnings).toEqual([cellsSaid('holder.C', 3, 1)]);
    expect(slotRows(c)).toEqual([['C{1}', '<unknown, not decoded>', false], ['C{2}', '[3+4i 5+6i]', false]]);
  });

  it('control: the respelling is the identity on the pristine bytes, and the slots read', () => {
    const { c, warnings } = slotsOpened([1, 2], firstCell());
    expect(warnings).toEqual([]);
    expect(slotRows(c)).toEqual([['C{1}', '1+2i', false], ['C{2}', '[3+4i 5+6i]', false]]);
  });
});

describe('through the bridge itself, at any depth under the object', () => {
  // buildTypedNodeFromMcos is what MatNode and ModelNode reach through modelOpaqueMcosVariable;
  // handed the bag McosParser builds, it reports what reportUndecoded finds under it.
  const bag = (props: Record<string, unknown>) => {
    const warnings: ParseWarning[] = [];
    const node = buildTypedNodeFromMcos('Simulink.Parameter', 'p', null, props, null, null, warnings);
    expect(node).not.toBeNull();
    return warnings;
  };
  const cell = (d: unknown[], elements: unknown[]) => ({ _array_type: 'Cell', _dimensions: d, _elements: elements, _mw_element_type: 'MATLABArray' });
  const struct = (d: unknown[], fields: string[], elements: unknown[]) => ({ _array_type: 'Struct', _dimensions: d, _elements: elements, _fields: fields, _mw_element_type: 'MATLABArray' });

  it('a cell, a cell in a struct field, and a struct in a cell', () => {
    expect(bag({ Value: cell([1, 3], [1]) })).toEqual([cellsSaid('p.Value', 3, 1)]);
    expect(bag({ Value: struct([1, 1], ['c'], [{ c: cell([1, 3], [1]) }]) })).toEqual([cellsSaid('p.Value.c', 3, 1)]);
    expect(bag({ Value: cell([1, 2], [1, struct([2, 2], ['a'], [{ a: 1 }])]) })).toEqual([elementsSaid('p.Value{2}', 4, 1)]);
  });

  it('named by subscript under an element of an object array or a struct array, as MATLAB indexes it', () => {
    // An element was named as a field called by its slot: "arr.3.Value".
    const warnings: ParseWarning[] = [];
    buildTypedNodeFromMcos('Simulink.Parameter', 'arr', null, null, [{ Value: 1 }, { Value: 2 }, { Value: cell([1, 3], [1]) }], [1, 3], warnings);
    expect(warnings).toEqual([cellsSaid('arr(3).Value', 3, 1)]);
    expect(bag({ Value: struct([2, 2], ['c'], [{ c: 1 }, { c: 2 }, { c: 3 }, { c: cell([1, 3], [1]) }]) })).toEqual([cellsSaid('p.Value(2,2).c', 3, 1)]);
    expect(bag({ Value: cell([2, 1], [1, cell([1, 4], [1])]) })).toEqual([cellsSaid('p.Value{2}', 4, 1)]);
  });

  it('a struct array that names its fields and holds none of its elements', () => {
    // As collectUndecoded reports one at the top of a .mat (parseWarnings.test.ts).
    expect(bag({ Value: struct([2, 5], ['a', 'b'], []) })).toEqual([elementsSaid('p.Value', 10, 0)]);
  });

  it('control: one holding every element it declares, an empty one, and dims that cannot be counted', () => {
    expect(bag({ Value: cell([1, 2], [1, 2]) })).toEqual([]);
    expect(bag({ Value: cell([0, 0], []) })).toEqual([]);
    expect(bag({ Value: struct([2, 2], ['a'], [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]) })).toEqual([]);
    expect(bag({ Value: struct([1, 0], ['a'], []) })).toEqual([]);
    // A fieldless 1x3 MATLAB wrote: McosParser lays out a bag for each element it declares.
    expect(bag({ Value: struct([1, 3], [], [{}, {}, {}]) })).toEqual([]);
    // An extent that is not a number counts nothing, as StructNode does not count it.
    expect(bag({ Value: struct([1, 3n], ['a'], [{ a: 1 }]) })).toEqual([]);
  });
});

describe('no false positive', () => {
  // Every MATLAB-written .mat and .slx this package's tests hold: the MCOS fixtures, the rest of
  // test/fixtures, and the parity artifacts. Not one of them holds a short value, so not one of
  // them may say it does. The v7.3 file is HDF5, which this reader refuses by design.
  const roots = ['./fixtures/', './parity/artifacts/'].map((r) => fileURLToPath(new URL(r, import.meta.url)));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(mat|slx)$/.test(name) && !name.endsWith('_v73.mat')) files.push(path);
    }
  };
  roots.forEach(walk);

  it('the fixture set is the one this sweep was written against', () => {
    expect(files.length).toBeGreaterThanOrEqual(50);
    expect(files.filter((f) => f.includes('/fixtures/mcos/')).length).toBeGreaterThanOrEqual(21);
  });

  const opened = (bytes: ArrayBuffer | Uint8Array, filename: string): ParseWarning[] => {
    const buf = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer : bytes;
    return shortOf((ingest(createSession(), buf, { filename }) as any).warnings);
  };

  it('control: the sweep\'s own route sees a short value', () => {
    const out = renameInMat(fixture('mcos/paramArray.mat'), paramStruct([1, 1]), paramStruct([1, 3]));
    expect(opened(out.bytes, 'paramArray.mat')).toEqual([elementsSaid('arr(3).Value', 3, 1)]);
  });

  it('every MATLAB-written .mat and .slx gives none of these warnings', () => {
    const said: [string, ParseWarning[]][] = [];
    for (const file of files) {
      const short = opened(new Uint8Array(readFileSync(file)), file.split('/').pop()!);
      if (short.length > 0) said.push([file, short]);
    }
    expect(said).toEqual([]);
  });
});
