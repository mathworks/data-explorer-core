// Copyright 2026 The MathWorks, Inc.
//
// The crash review's input: a compressed .mat of 11 KB holding one cell of 80,000 sparse
// arrays, each declaring 0x256 and holding nothing after its name (48 bytes inflated).
// Opened, copied, pasted into a binary dictionary and saved, it was a fatal out-of-memory
// under 1.36.2 and at 67bb37e, at 4.8 GB. Its members carry the bytes they were read from,
// so the cell is written as one stream of them (MatWriter.memberElement), which takes
// nothing from the unbacked-bytes budget. Its own file, so that the peak RSS is this case's
// (test/tools/pasteVenues.ts).
import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { createSession } from '../src/index.js';
import { encodeMatStream } from '../src/datamodel/parser/MatWriter.js';
import { CLASS, MI, arrayFlags, cellVar, dims, element, matFile, matrix, varName } from './tools/matBytes.js';
import { BINARY, TEXT, copyOf, pasteSaveReopen, peakMB, timed } from './tools/pasteVenues.js';

const member = matrix([arrayFlags(CLASS.SPARSE, { sparse: true, nzmax: 1 }), dims([0, 256]), varName('')]);
const file = matFile([element(MI.COMPRESSED, deflateSync(cellVar('c', Array.from({ length: 80000 }, () => member))))]);

// These write the 80,000 members, and paste them twice: up to 2.2 s here, 5.6 s on CI's
// runners, past vitest's 5 s default; give them headroom. The open runs as the file is
// collected, under no test's timeout.
const HEAVY_TIMEOUT = 60_000;

describe('a cell of 80,000 0x256 arrays in an 11 KB .mat', () => {
  const [c, openMs]: [any, number] = timed(() => createSession().addMatSource('c.mat', file).children[0]);
  let copied: any;

  it('opens at once', () => {
    expect([file.byteLength < 12000, member.length, c.displayValue, c.children.length, openMs < 3000]).toEqual([true, 48, '<1x80000 cell>', 80000, true]);
  });

  it('is one stream of its members\' own bytes, at once', { timeout: HEAVY_TIMEOUT }, () => {
    const [stream, ms] = timed(() => encodeMatStream(c._var));
    // Preamble, tag, the cell's flags, dims and name, and 80,000 members of 48 bytes.
    expect([stream.length, ms < 2000]).toEqual([8 + 8 + 40 + 80000 * 48, true]);
  });

  it('is copied, and pasted into either dictionary and saved, at once', { timeout: HEAVY_TIMEOUT }, () => {
    const [value, copyMs] = timed(() => copyOf(c) as any);
    copied = value;
    expect([copied._elements.length, copyMs < 5000]).toEqual([80000, true]);
    const binary = pasteSaveReopen(BINARY, copied);
    expect([binary.written, binary.ms < 10000]).toEqual(['<P Name="Value" Class="cell" Encoding="hex" EncodedLength="3840056">', true]);
    expect([binary.entry.children.length, binary.entry.children[79999].displayValue]).toEqual([80000, '<0x256 sparse double>']);
    const text = pasteSaveReopen(TEXT, copied);
    expect([text.entry.children.length, text.entry.children[79999].displayValue, text.ms < 10000]).toEqual([80000, '<0x256 sparse double>', true]);
    // 1.4 GB in this process, the 80,000 nodes opened three times over; 4.8 GB, fatal, before.
    expect(peakMB()).toBeLessThan(2048);
  });
});
