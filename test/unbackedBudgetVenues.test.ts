// Copyright 2026 The MathWorks, Inc.
//
// The unbacked-bytes budget's inputs (test/unbackedBudget.test.ts pins its numbers) where a
// user meets them: read out of a .mat or handed over by a host, copied as a host copies an
// entry, pasted into a text and a binary dictionary, saved and opened again. What is within
// the budget stays sparse everywhere. What is past it is refused, at once, with an error that
// names the entry and the budget, and nothing is written in its place: the copy or the save
// fails (test/budgetFailsClosed.test.ts). The cells of many arrays, which need a process
// each to measure, are in test/budgetCell*.test.ts.
import { describe, it, expect } from 'vitest';
import { createSession } from '../src/index.js';
import { cellVar, matFile, sparseVar } from './tools/matBytes.js';
import { BINARY, TEXT, copyOf, pasteSaveReopen, pasted, peakMB, refusal, thrownBy, timed } from './tools/pasteVenues.js';

const sparseHost = (dims: number[], row: number[], col: number[], re: number[]) => ({
  name: 'h', className: 'double', dimensions: dims, isComplex: false, isLogical: false, isSparse: true, value: '', fields: null,
  sparse: { row: Int32Array.from(row), col: Int32Array.from(col), re: Float64Array.from(re), im: null },
});
const hostMat = (variable: unknown): any => createSession().addMatSourceParsed('h.mat', { header: '', warnings: [], variables: [variable] }).children[0];
const shape = (e: any) => [e.displayValue, e.isSparse, e.children.length];

// These copy, paste and save 8 MB of column index, or 4,300 members of 1000x1000: up to 1.7 s
// here, 3.2 s on CI's runners, close to vitest's 5 s default; give them headroom.
const HEAVY_TIMEOUT = 60_000;

describe('within the budget, a sparse array stays sparse wherever it goes', () => {
  it('a host\'s 1x2e6 with three entries, 8 MB of index no data backs', { timeout: HEAVY_TIMEOUT }, () => {
    const h = hostMat(sparseHost([1, 2e6], [0, 0, 0], [0, 1e6, 2e6 - 1], [1, 2, 3]));
    expect(h.children.map((c: any) => [c.displayName, c.valueEditable])).toEqual([
      ['h(1,1)', true],
      ['h(1,1000001)', true],
      ['h(1,2000000)', true],
    ]);
    const [copied, ms] = timed(() => copyOf(h) as any);
    expect([copied._type, ms < 2000]).toEqual(['cdata', true]);
    for (const file of [TEXT, BINARY]) {
      const r = pasteSaveReopen(file, copied);
      expect([shape(r.entry), r.ms < 5000], file).toEqual([['<1x2000000 sparse double>', true, 3], true]);
      if (file === BINARY) expect(r.written).toBe('<P Name="Value" Class="double" Encoding="hex" EncodedLength="8000128">');
    }
    expect(peakMB()).toBeLessThan(1024);
  });

  it('a host\'s dense 0x1000, which backs none of its columns, stays a 0x1000 sparse array', () => {
    const h = hostMat({ name: 'h', className: 'double', dimensions: [0, 1000], isComplex: false, isLogical: false, isSparse: true, value: [], fields: null });
    const copied = copyOf(h) as any;
    expect(copied._type).toBe('cdata');
    for (const file of [TEXT, BINARY]) {
      const r = pasteSaveReopen(file, copied);
      expect([shape(r.entry), r.entry.dims], file).toEqual([['<0x1000 sparse double>', true, 0], [0, 1000]]);
      if (file === BINARY) expect(r.written).toBe('<P Name="Value" Class="double" Encoding="hex" EncodedLength="4088">');
    }
  });

  it('Matrix(1000,1000) holding nothing stays sparse: as this package\'s literal, and as a .mat whose index held no column', () => {
    const literal = { _type: 'sparse', _value: 'Matrix(1000,1000)\n[]' };
    for (const file of [TEXT, BINARY]) {
      const r = pasteSaveReopen(file, literal);
      expect(shape(r.entry), file).toEqual(['<1000x1000 sparse double>', true, 0]);
      if (file === BINARY) expect(r.written).toBe('<P Name="Value" Class="double" Encoding="hex" EncodedLength="4088">');
    }
    const m: any = createSession().addMatSource('m.mat', matFile([sparseVar({ name: 'm', dimensions: [1000, 1000], ir: [], jc: [0], real: [], nzmax: 1, sparseFlag: true })])).children[0];
    expect(refusal(m._var)[0]).toBe(false);
    const copied = copyOf(m);
    for (const file of [TEXT, BINARY]) {
      expect(shape(pasteSaveReopen(file, copied).entry), file).toEqual(['<1000x1000 sparse double>', true, 0]);
    }
  });
});

describe('past the budget, the write is refused at once, and nothing is written in the value\'s place', () => {
  it('a host\'s cell of 4,300 1000x1000 arrays of one entry each: its copy fails, naming the member the budget ran out at', { timeout: HEAVY_TIMEOUT }, () => {
    // 3,996 bytes of index apiece, so 4,198 of them are within the budget, and the 4,199th is
    // not. Nothing is copied: not its summary, not the array laid out full.
    const member = () => sparseHost([1000, 1000], [0], [0], [5]);
    const c = hostMat({ name: 'h', className: 'cell', dimensions: [1, 4300], isComplex: false, isLogical: false, value: Array.from({ length: 4300 }, member), fields: null });
    const [thrown, ms] = thrownBy(() => copyOf(c));
    expect([thrown?.name, thrown?.message, ms < 5000]).toEqual([
      'MatBudgetError',
      'Cannot write "h": h{4199} is a 1000x1000 sparse array whose data holds 1 of its 1000 columns, and with it the value would add more than 16 MiB that its data does not hold, the most one value may add. Nothing was written.',
      true,
    ]);
    // 4,198 of them are a value within it.
    const within = hostMat({ name: 'h', className: 'cell', dimensions: [1, 4198], isComplex: false, isLogical: false, value: Array.from({ length: 4198 }, member), fields: null });
    expect((copyOf(within) as any)._elements.every((e: any) => e._type === 'cdata')).toBe(true);
    expect(peakMB()).toBeLessThan(1024);
  });

  it('a cell declaring 1e8 elements around one: refused before any is made; a text dictionary keeps it as it was read, a binary one refuses it', () => {
    const bag = { _array_type: 'Cell', _dimensions: [1, 1e8], _elements: [{ _type: 'sparse', _value: 'Matrix(0,5)\n[]' }] };
    const [refused, ms] = refusal(pasted(TEXT, bag)._var);
    expect([refused, ms < 100]).toEqual([true, true]);
    const text = pasteSaveReopen(TEXT, bag);
    expect([text.entry.displayValue, text.ms < 2000, text.size < 1_000_000]).toEqual(['<1x100000000 cell>', true, true]);
    // A binary dictionary has no spelling for it but its stream: no XML declaring 1e8
    // elements around one.
    const [thrown, saveMs] = thrownBy(() => pasteSaveReopen(BINARY, bag));
    expect([thrown?.name, thrown?.message, saveMs < 2000]).toEqual([
      'MatBudgetError',
      'Cannot write "pasted": pasted is a 1x100000000 cell holding 1 of its 100000000 elements, and with it the value would add more than 16 MiB that its data does not hold, the most one value may add. Nothing was written.',
      true,
    ]);
    // A .mat cell declaring as many and holding one is read as what it holds, and copied so.
    const member = sparseVar({ name: '', dimensions: [0, 5], ir: [], jc: [0, 0, 0, 0, 0, 0], real: [], nzmax: 1, sparseFlag: true });
    const c: any = createSession().addMatSource('c.mat', matFile([cellVar('c', [member], [1, 1e8])])).children[0];
    const [copied, copyMs] = timed(() => JSON.stringify(c.serialize().value));
    expect([copyMs < 1000, copied.length < 1000]).toEqual([true, true]);
    expect(peakMB()).toBeLessThan(1024);
  });
});
