// Copyright 2026 The MathWorks, Inc.
//
// A cell of 80,000 `Matrix(0,256)` literals, 3.4 MB of text: 82 MB of column index no data
// backs, past the unbacked-bytes budget (test/unbackedBudget.test.ts). Pasted into a binary
// dictionary and saved, it was a fatal out-of-memory at 4.8 GB, under 1.36.2 and under the
// allowance of 256 free columns per array alike. Its own file, so that the peak RSS is this
// case's (test/tools/pasteVenues.ts).
import { describe, it, expect } from 'vitest';
import { BINARY, TEXT, pasted, pasteSaveReopen, peakMB, refusal } from './tools/pasteVenues.js';

const bag = {
  _array_type: 'Cell',
  _dimensions: [1, 80000],
  _elements: Array.from({ length: 80000 }, () => ({ _type: 'sparse', _value: 'Matrix(0,256)\n[]' })),
};

describe('a cell of 80,000 0x256 literals', () => {
  it('is refused whole by the writer, at once', () => {
    const [refused, ms] = refusal(pasted(TEXT, bag)._var);
    expect([refused, ms < 2000]).toEqual([true, true]);
  });

  it('is saved into a text dictionary as the literals it was read as', () => {
    const r = pasteSaveReopen(TEXT, bag);
    expect([r.entry.children.length, r.entry.children[79999].displayValue, r.ms < 5000]).toEqual([80000, '<0x256 sparse double>', true]);
  });

  it('is saved into a binary dictionary out of one budget for the value, at once', () => {
    // The cell as XML, each member the hex of its own stream: 16,384 of them, 1,024 bytes of
    // index apiece, before the budget is spent, and the rest the full empty of their shape.
    const r = pasteSaveReopen(BINARY, bag);
    expect([r.written, r.ms < 10000]).toEqual(['<P Name="Value" Class="cell" Dimension="1*80000">', true]);
    const members = r.entry.children;
    expect([members.length, members.filter((m: any) => m.isSparse).length, members[16383].isSparse, members[16384].isSparse, members[79999].dims]).toEqual([
      80000,
      16384,
      true,
      false,
      [0, 256],
    ]);
    // 1.0 GB in this process.
    expect(peakMB()).toBeLessThan(1536);
  });
});
