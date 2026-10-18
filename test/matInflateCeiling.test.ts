// Copyright 2026 The MathWorks, Inc.
//
// The inflate ceiling for one MAT-file record (C-114(b)). A top-level miCOMPRESSED record
// is inflated before anything in it can be read, and nothing in the file says how big it
// will be: the size its matrix declares is inside the payload. So a record of a few
// hundred kilobytes could inflate to gigabytes, all of it held, before anything decided it
// was too big. Past `MAT_RECORD_INFLATE_CEILING` the record is unreadable, with a warning,
// and the read goes on at the next record. It is never cut to the ceiling and read short,
// which would show a variable the file does not hold.
//
// The ceiling is 2 GiB and 64 KiB, which a test cannot spend, so these read under a
// ceiling lowered to 1 MiB (test/tools/matInflateBomb.ts) through the seam's setter, which
// the package does not export. Peak memory is in its own file,
// test/matInflateCeilingPeak.test.ts.
//
// The cases run in order and the first relies on it: importing the Node subpath arms that
// subpath's own engine, and the first case reads through it before any case replaces it.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants as zlibConstants, deflateSync, inflateRawSync, inflateSync } from 'node:zlib';
import { unzlibSync } from 'fflate';
import { createSession, loadFromPath } from '../src/node/index.js';
import {
  MAT_RECORD_INFLATE_CEILING,
  inflateZlib,
  nativeInflateAvailable,
  setMatRecordInflateCeiling,
  setNativeInflate,
  type NativeInflate,
} from '../src/datamodel/parser/Inflate.js';
import { parseMat, scanMat } from '../src/index.js';
import { LOWERED_CEILING, bombMat, ceilingWarning, smallRecord } from './tools/matInflateBomb.js';

const { buffer: bomb, bombAt } = bombMat();
const WARNING = ceilingWarning(bombAt, LOWERED_CEILING);
// The fflate cases decode up to the ceiling and stop; give CI headroom past vitest's 5 s.
const TIMEOUT = 60_000;

/** A .mat of small compressed variables only. */
function smallMat(): ArrayBuffer {
  const header = new Uint8Array(128);
  header.fill(0x20, 0, 116);
  header[125] = 0x01;
  header[126] = 0x49;
  header[127] = 0x4d;
  const records = [smallRecord('p', 1), smallRecord('q', 2)];
  const out = new Uint8Array(128 + records.reduce((n, r) => n + r.byteLength, 0));
  out.set(header, 0);
  let at = 128;
  for (const r of records) {
    out.set(r, at);
    at += r.byteLength;
  }
  return out.buffer;
}

const names = (buffer: ArrayBuffer) => parseMat(buffer).variables.map((v) => v.name);

beforeAll(() => setMatRecordInflateCeiling(LOWERED_CEILING));
afterEach(() => setNativeInflate(undefined));
afterAll(() => setMatRecordInflateCeiling(undefined));

describe('a compressed record that inflates past the ceiling is unreadable, and the rest of the file is read', () => {
  it('through the Node subpath, opened as a file', { timeout: TIMEOUT }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'dex-mat-ceiling-'));
    try {
      const path = join(dir, 'bomb.mat');
      writeFileSync(path, new Uint8Array(bomb));
      const source = loadFromPath(createSession(), path);
      expect(source.children.map((c) => c.name)).toEqual(['before', 'after']);
      expect(source.warnings).toEqual([WARNING]);
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
    const parsed = parseMat(bomb);
    expect(parsed.variables.map((v) => v.name)).toEqual(['before', 'after']);
    expect(parsed.warnings).toEqual([WARNING]);
  });
});

describe('the ceiling reaches the engine, and the engine cannot get past it', () => {
  it('is handed to the engine as its maxOutputLength, the lowered one and the default', () => {
    const seen: (number | undefined)[] = [];
    setNativeInflate({
      raw: (deflated) => inflateRawSync(deflated),
      zlib: (wrapped, maxOutputLength) => {
        seen.push(maxOutputLength);
        return inflateSync(wrapped, { maxOutputLength });
      },
    });
    const read = names(bomb);
    expect(seen).toEqual([LOWERED_CEILING, LOWERED_CEILING, LOWERED_CEILING]);
    expect(read).toEqual(['before', 'after']);

    seen.length = 0;
    setMatRecordInflateCeiling(undefined);
    try {
      expect([names(smallMat()), seen]).toEqual([['p', 'q'], [MAT_RECORD_INFLATE_CEILING, MAT_RECORD_INFLATE_CEILING]]);
    } finally {
      setMatRecordInflateCeiling(LOWERED_CEILING);
    }
  });

  it('refuses the record after the fact from an engine that ignores the cap', () => {
    // An engine written before the cap existed inflates all of it. Too late to save the
    // memory, and still not read: the length is checked on what comes back.
    setNativeInflate({ raw: (deflated) => inflateRawSync(deflated), zlib: (wrapped) => inflateSync(wrapped) });
    const parsed = parseMat(bomb);
    expect(parsed.variables.map((v) => v.name)).toEqual(['before', 'after']);
    expect(parsed.warnings).toEqual([WARNING]);
  });

  it('takes the engine\'s ERR_BUFFER_TOO_LARGE as final, and does not ask fflate instead', () => {
    // Retried on fflate, a record the engine said was too big would be inflated whole by
    // the engine that has no cap of its own. So the refusal stands even here, on records
    // small enough that fflate would have read them.
    setNativeInflate({
      raw: (deflated) => inflateRawSync(deflated),
      zlib: () => {
        throw Object.assign(new RangeError('Cannot create a Buffer larger than 1048576 bytes'), { code: 'ERR_BUFFER_TOO_LARGE' });
      },
    });
    const parsed = parseMat(smallMat());
    expect(parsed.variables).toEqual([]);
    expect(parsed.warnings.map((w) => w.message)).toEqual([
      ceilingWarning(128, LOWERED_CEILING).message,
      ceilingWarning(128 + smallRecord('p', 1).byteLength, LOWERED_CEILING).message,
    ]);
  });

  it('falls back to fflate when the engine fails some other way, and fflate is held to it too', { timeout: TIMEOUT }, () => {
    // The fallback is what lets a stream the old engine read keep reading when the new one
    // is stricter. It used to inflate without a limit, so a record the engine refused for
    // any other reason was inflated whole on fflate.
    setNativeInflate({
      raw: (deflated) => inflateRawSync(deflated),
      zlib: () => {
        throw new Error('engine exploded');
      },
    });
    expect(names(smallMat())).toEqual(['p', 'q']);
    const parsed = parseMat(bomb);
    expect(parsed.variables.map((v) => v.name)).toEqual(['before', 'after']);
    expect(parsed.warnings).toEqual([WARNING]);
  });
});

describe('a stream too short to pass the ceiling reads on fflate as it always did', () => {
  it('as unzlibSync reads it, failures and their wording included', () => {
    // Only a stream long enough to pass the ceiling at deflate's largest expansion is
    // streamed; a shorter one cannot pass it and goes to unzlibSync, which is lenient in
    // ways the streaming inflate is not (a bare 2-byte header is 0 bytes to it).
    const good = new Uint8Array(deflateSync(new TextEncoder().encode('a MAT record, '.repeat(40))));
    const inputs = [
      good,
      good.subarray(0, good.byteLength - 10),
      new Uint8Array([...good, 1, 2, 3, 4, 5, 6, 7, 8]),
      new Uint8Array([0x78, 0x9c]),
      new Uint8Array([0x78, 0x9c, 1, 2, 3, 4, 5, 6]),
      new Uint8Array(0),
    ];
    const outcome = (f: () => Uint8Array) => {
      try {
        return Array.from(f());
      } catch (err) {
        return (err as Error).message;
      }
    };
    setNativeInflate(null);
    for (const input of inputs) expect(outcome(() => inflateZlib(input))).toEqual(outcome(() => unzlibSync(input)));
  });
});

describe('the ceiling is past every record MATLAB writes', () => {
  it('is 2 GiB and 64 KiB, which is above the largest record a -v7 save writes', () => {
    // MATLAB R2027a writes a uint8 array of 2^31-48 bytes as a record inflating to 2^31+8,
    // and refuses 2^31 bytes (MATLAB:save:sizeTooBigForMATFile), on the in-memory size:
    // test/fixtures/mat/v7limit.m and v7struct.m. So a record exceeds its data by its
    // headers only, and the 64 KiB covers any name and dimensions header there is.
    const truth = JSON.parse(readFileSync(new URL('./fixtures/mat/v7_record_limit.truth.json', import.meta.url), 'utf8')) as {
      written: { uint8Bytes: number; recordInflatesTo: number }[];
      refused: { uint8Bytes: number; id: string }[];
      structRefused: { whosBytes: number; id: string }[];
    };
    const largestWritten = Math.max(...truth.written.map((w) => w.recordInflatesTo));
    const smallestRefused = Math.min(...truth.refused.map((r) => r.uint8Bytes));
    expect([largestWritten, smallestRefused]).toEqual([2 ** 31 + 8, 2 ** 31]);
    expect([...truth.refused, ...truth.structRefused].map((r) => r.id)).toEqual(Array(4).fill('MATLAB:save:sizeTooBigForMATFile'));
    expect(MAT_RECORD_INFLATE_CEILING).toBe(2 ** 31 + 2 ** 16);
    expect(MAT_RECORD_INFLATE_CEILING).toBeGreaterThan(largestWritten);
  });
});

describe('scanMat names what parseMat reads, with a record past the ceiling in the file', () => {
  // The record's head is readable — its name is in the first few bytes — and the scanner
  // reads only heads, so on its own it would name a variable parseMat does not read. The
  // head declares more than the ceiling, which is what tells it to let parseMat answer.
  const HEAD: NativeInflate = {
    raw: (deflated) => inflateRawSync(deflated),
    zlib: (wrapped, maxOutputLength) => inflateSync(wrapped, { maxOutputLength }),
    zlibHead: (prefix) => inflateSync(prefix, { finishFlush: zlibConstants.Z_SYNC_FLUSH }),
  };
  const NO_HEAD: NativeInflate = { raw: HEAD.raw, zlib: HEAD.zlib };

  it.each([
    ['node:zlib, as detected', undefined],
    ['node:zlib with a head mode', HEAD],
    ['node:zlib without one', NO_HEAD],
    ['fflate', null],
  ] as const)('by %s', { timeout: TIMEOUT }, (_label, engine) => {
    setNativeInflate(engine);
    expect(scanMat(bomb).names).toEqual(['before', 'after']);
    expect(names(bomb)).toEqual(['before', 'after']);
  });
});
