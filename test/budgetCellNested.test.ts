// Copyright 2026 The MathWorks, Inc.
//
// The crash review's nested form of test/budgetCellOf80000Mat.test.ts: 200 cells of 1,000
// sparse arrays each, every one declaring 0x256 and holding nothing after its name, in a
// compressed .mat of 30 KB. A flat cell of more than about 120,000 members once overflowed
// the stack in the writer; nested, this reached the fatal out-of-memory instead (5.5 GB at
// 67bb37e). Written as one stream of its members' own bytes now, the cost is the 200,000
// nodes it opens as, not the column index they declare. Its own file, so that the peak RSS
// is this case's (test/tools/pasteVenues.ts).
import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { createSession } from '../src/index.js';
import { encodeMatStream } from '../src/datamodel/parser/MatWriter.js';
import { CLASS, MI, arrayFlags, cellVar, dims, element, matFile, matrix, varName } from './tools/matBytes.js';
import { BINARY, copyOf, pasted, peakMB, timed } from './tools/pasteVenues.js';

const member = matrix([arrayFlags(CLASS.SPARSE, { sparse: true, nzmax: 1 }), dims([0, 256]), varName('')]);
const inner = cellVar('', Array.from({ length: 1000 }, () => member));
const file = matFile([element(MI.COMPRESSED, deflateSync(cellVar('c', Array.from({ length: 200 }, () => inner))))]);
// Preamble, tag and header of the outer cell, then 200 inner cells of 48 + 1,000 x 48 bytes.
const STREAM = 8 + 8 + 40 + 200 * (8 + 40 + 1000 * 48);

// It opens 200,000 nodes twice and writes them three times: 3.3 s here, 8.3 s on CI's
// runners, past vitest's 5 s default; give it headroom.
const HEAVY_TIMEOUT = 60_000;

describe('a cell of 200 cells of 1,000 0x256 arrays', () => {
  it('opens, is written as one stream of its members\' bytes, and is copied, pasted into a binary dictionary and saved, at once', { timeout: HEAVY_TIMEOUT }, () => {
    const [c, openMs]: [any, number] = timed(() => createSession().addMatSource('c.mat', file).children[0]);
    expect([file.byteLength < 40000, c.displayValue, c.children[199].children.length, openMs < 5000]).toEqual([true, '<1x200 cell>', 1000, true]);
    const [stream, ms] = timed(() => encodeMatStream(c._var));
    expect([stream.length, ms < 3000]).toEqual([STREAM, true]);
    const [copied, copyMs] = timed(() => copyOf(c));
    expect(copyMs).toBeLessThan(10000);
    const entry = pasted(BINARY, copied);
    const [hex, hexMs] = timed(() => entry._binaryEncoded());
    expect([hex._attrs.EncodedLength, hexMs < 10000]).toEqual([String(STREAM), true]);
    // 1.5 GB in this process, nearly all of it the 200,000 nodes, opened twice.
    expect(peakMB()).toBeLessThan(2560);
  });
});
