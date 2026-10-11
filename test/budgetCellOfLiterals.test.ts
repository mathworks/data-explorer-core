// Copyright 2026 The MathWorks, Inc.
//
// A cell of 80,000 `Matrix(0,256)` literals, 3.4 MB of text: 82 MB of column index no data
// backs, past the unbacked-bytes budget (test/unbackedBudget.test.ts). Pasted into a binary
// dictionary and saved, it was a fatal out-of-memory at 4.8 GB, under 1.36.2 and under the
// allowance of 256 free columns per array alike; now the save is refused, at once. Its own
// file, so that the peak RSS is this case's (test/tools/pasteVenues.ts).
import { describe, it, expect } from 'vitest';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { BINARY, TEXT, pasted, pasteSaveReopen, peakMB, refusal, sparseFixture, thrownBy } from './tools/pasteVenues.js';

const bag = {
  _array_type: 'Cell',
  _dimensions: [1, 80000],
  _elements: Array.from({ length: 80000 }, () => ({ _type: 'sparse', _value: 'Matrix(0,256)\n[]' })),
};

// Each of these pastes the 80,000 literals: up to 0.5 s here, 1.5 s on CI's runners. Give
// them headroom past vitest's 5 s default, which the heavier cases have outrun on CI.
const HEAVY_TIMEOUT = 60_000;

describe('a cell of 80,000 0x256 literals', () => {
  it('is refused whole by the writer, at once', { timeout: HEAVY_TIMEOUT }, () => {
    const [refused, ms] = refusal(pasted(TEXT, bag)._var);
    expect([refused, ms < 5000]).toEqual([true, true]);
  });

  it('is saved into a text dictionary as the literals it was read as', { timeout: HEAVY_TIMEOUT }, () => {
    const r = pasteSaveReopen(TEXT, bag);
    expect([r.entry.children.length, r.entry.children[79999].displayValue, r.ms < 5000]).toEqual([80000, '<0x256 sparse double>', true]);
  });

  it('is refused by a binary dictionary, at once, naming where the budget ran out, and nothing is written', { timeout: HEAVY_TIMEOUT }, () => {
    // A binary dictionary has no spelling for it but its stream, and a refusal for the
    // budget is final: no XML of its members one by one, no full empties.
    const session = createSession();
    const root: any = ingest(session, sparseFixture(BINARY), { filename: BINARY });
    root.getSection('design').parseEntry({ name: 'pasted', metadata: { uuid: '00000000-0000-4000-e800-0000000000a1' }, value: bag });
    const [thrown, ms] = thrownBy(() => session.serializeSource(root.name));
    expect([thrown?.name, thrown?.message, ms < 10000]).toEqual([
      'MatBudgetError',
      'Cannot write "pasted": pasted{16385} is a 0x256 sparse array whose data holds none of its 256 columns, and with it the value would add more than 16 MiB that its data does not hold, the most one value may add. Nothing was written.',
      true,
    ]);
    expect(peakMB()).toBeLessThan(1536);
  });
});
