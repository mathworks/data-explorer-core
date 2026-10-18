// Copyright 2026 The MathWorks, Inc.
//
// What a MAT record past the inflate ceiling costs to refuse (C-114(b)). The record holds
// 32 MiB of zeros in about 32 KB, and the ceiling is lowered to 1 MiB
// (test/tools/matInflateBomb.ts). Refusing it must not cost the 32 MiB first: node:zlib is
// handed the ceiling as `maxOutputLength` and stops there, and fflate is pushed the stream
// in slices small enough that it cannot run far past it before it is stopped. Inflated
// whole, as every engine did before the ceiling, and decoded into a variable, the read
// raised the peak RSS of this process by hundreds of megabytes. Its own file, so that the
// peak is this case's (test/tools/pasteVenues.ts), as test/inflateBomb.test.ts is for a zip
// member.
//
// The cases run in order and the first relies on it: importing the Node subpath arms that
// subpath's own engine, and the first case reads through it before any case replaces it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Unzlib } from 'fflate';
import { createSession, loadFromPath } from '../src/node/index.js';
import { nativeInflateAvailable, setMatRecordInflateCeiling, setNativeInflate } from '../src/datamodel/parser/Inflate.js';
import { parseMat } from '../src/index.js';
import { peakMB } from './tools/pasteVenues.js';
import { BOMB_DATA_BYTES, LOWERED_CEILING, bombMat, bombStream } from './tools/matInflateBomb.js';

// Held to this many MB of peak RSS, as test/inflateBomb.test.ts holds a zip member.
const PEAK_MB = 16;
const TIMEOUT = 60_000;

const { buffer: bomb } = bombMat();

beforeAll(() => setMatRecordInflateCeiling(LOWERED_CEILING));
afterAll(() => {
  setMatRecordInflateCeiling(undefined);
  setNativeInflate(undefined);
});

describe('a MAT record past the ceiling is refused at the cost of the ceiling, not of the record', () => {
  it('through the Node subpath, opened as a file', { timeout: TIMEOUT }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'dex-mat-ceiling-peak-'));
    try {
      const path = join(dir, 'bomb.mat');
      writeFileSync(path, new Uint8Array(bomb));
      const before = peakMB();
      const source = loadFromPath(createSession(), path);
      expect(peakMB() - before).toBeLessThan(PEAK_MB);
      expect(source.children.map((c) => c.name)).toEqual(['before', 'after']);
      expect(source.warnings?.map((w) => w.code)).toEqual(['part-unreadable']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['node:zlib, as detected', undefined],
    ['fflate', null],
  ] as const)('by %s', { timeout: TIMEOUT }, (_label, engine) => {
    setNativeInflate(engine);
    if (engine === undefined) expect(nativeInflateAvailable()).toBe(true);
    const before = peakMB();
    const parsed = parseMat(bomb);
    expect(peakMB() - before).toBeLessThan(PEAK_MB);
    expect(parsed.variables.map((v) => v.name)).toEqual(['before', 'after']);
    expect(parsed.warnings.map((w) => w.code)).toEqual(['part-unreadable']);
  });

  it('is what it says: a stream far smaller than the ceiling that inflates to 32 MiB and more', { timeout: TIMEOUT }, () => {
    // The control, last so that its own pass over the stream is not in any case's peak.
    // Counted as it streams by, so the 32 MiB is never held.
    const { stream, inflated } = bombStream();
    let total = 0;
    new Unzlib((chunk) => {
      total += chunk.byteLength;
    }).push(stream, true);
    expect(total).toBe(inflated);
    expect(inflated).toBeGreaterThan(BOMB_DATA_BYTES);
    expect(stream.byteLength).toBeLessThan(LOWERED_CEILING / 16);
  });
});
