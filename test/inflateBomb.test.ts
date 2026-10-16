// Copyright 2026 The MathWorks, Inc.
//
// What a zip member that lies about its size costs. Its directory entry declares 1 KB and
// its bytes, about 200 KB of them, inflate to 200 MB of zeros. Such a member is unreadable
// (test/inflateSeam.test.ts pins the rule), and saying so must not cost the 200 MB first:
// node:zlib is given the declared size as `maxOutputLength` and stops there, and fflate
// inflates into a buffer one byte past it. Inflated whole, as both node:zlib engines did
// before the cap, the read raised the peak RSS of this process by 405 MB; capped, by
// 0.05 MB detected, 0.7 MB through the Node subpath's whole open, and 1.3 MB on fflate. Its
// own file, so that the peak is this case's (test/tools/pasteVenues.ts).
//
// The cases run in order and the first relies on it: importing the Node subpath arms that
// subpath's own engine, and the first case reads through it before any case replaces it.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Deflate, Inflate } from 'fflate';
import { createSession, loadFromPath } from '../src/node/index.js';
import { nativeInflateAvailable, setNativeInflate, unzipEntries, type UnreadableMember } from '../src/datamodel/parser/Inflate.js';
import { peakMB, timed } from './tools/pasteVenues.js';

const INFLATED = 200 * 1024 * 1024;
const DECLARED = 1024;
const PART = 'simulink/modelWorkspace.mxarray';
const REASON = `inflates to more than the ${DECLARED} bytes its directory entry declares`;
// Held to this many MB of peak RSS, against the 1.3 MB the heaviest capped case measured.
const PEAK_MB = 16;
// The fflate case inflates the whole stream into nowhere, 0.4 s here; give CI headroom
// past vitest's 5 s default.
const HEAVY_TIMEOUT = 60_000;

// 200 MB of zeros as raw deflate, built without holding 200 MB: fflate's streaming
// compressor, fed the same 1 MB of zeros 200 times. One stream with no flush points in it,
// deliberately: a FULL or SYNC flush writes an empty stored block, and fflate's inflate
// throws on a stored block past the end of its output even when the block is empty, which
// would make the fflate case below refuse the archive for a reason that is not this one.
function zerosDeflated(): Uint8Array {
  const chunks: Uint8Array[] = [];
  const deflate = new Deflate({ level: 6 }, (chunk) => chunks.push(chunk));
  const megabyte = new Uint8Array(1024 * 1024);
  for (let i = 0; i < INFLATED / megabyte.byteLength; i++) deflate.push(megabyte);
  deflate.push(new Uint8Array(0), true);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** A zip of one deflated member holding `data` and declaring `declared` bytes. */
function zipOfOne(name: string, data: Uint8Array, declared: number): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(4, 20, true);
  local.setUint16(8, 8, true); // deflated
  local.setUint32(18, data.byteLength, true);
  local.setUint32(22, declared, true);
  local.setUint16(26, nameBytes.byteLength, true);
  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(4, 20, true);
  central.setUint16(6, 20, true);
  central.setUint16(10, 8, true);
  central.setUint32(20, data.byteLength, true);
  central.setUint32(24, declared, true);
  central.setUint16(28, nameBytes.byteLength, true);
  const centralAt = 30 + nameBytes.byteLength + data.byteLength;
  const centralLength = 46 + nameBytes.byteLength;
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, 1, true);
  eocd.setUint16(10, 1, true);
  eocd.setUint32(12, centralLength, true);
  eocd.setUint32(16, centralAt, true);
  const parts = [new Uint8Array(local.buffer), nameBytes, data, new Uint8Array(central.buffer), nameBytes, new Uint8Array(eocd.buffer)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

const deflated = zerosDeflated();
const bomb = zipOfOne(PART, deflated, DECLARED);

afterAll(() => setNativeInflate(undefined));

describe('a member declaring 1 KB that inflates to 200 MB is unreadable, at the cost of the 1 KB', () => {
  it('opens as a model through the Node subpath, naming the part, without inflating it', { timeout: HEAVY_TIMEOUT }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'dex-inflate-bomb-'));
    try {
      const path = join(dir, 'bomb.slx');
      writeFileSync(path, bomb);
      const before = peakMB();
      const source = loadFromPath(createSession(), path) as unknown as { warnings?: { code: string; part?: string; message: string }[] };
      expect(peakMB() - before).toBeLessThan(PEAK_MB);
      expect(source.warnings?.map((w) => [w.code, w.part])).toEqual([['part-unreadable', PART]]);
      expect(source.warnings?.[0].message).toContain(REASON);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['node:zlib, as detected', undefined],
    ['fflate', null],
  ] as const)('is left out and named by %s, without inflating it', { timeout: HEAVY_TIMEOUT }, (_label, engine) => {
    setNativeInflate(engine);
    if (engine === undefined) expect(nativeInflateAvailable()).toBe(true);
    const unreadable: UnreadableMember[] = [];
    const before = peakMB();
    const [entries, ms] = timed(() => unzipEntries(bomb, undefined, unreadable));
    expect(peakMB() - before).toBeLessThan(PEAK_MB);
    expect(Object.keys(entries)).toEqual([]);
    expect(unreadable).toEqual([{ name: PART, reason: REASON }]);
    expect(ms).toBeLessThan(20_000);
  });

  it('is what it says: about 200 KB that really inflate to 200 MB', { timeout: HEAVY_TIMEOUT }, () => {
    // The control, last so that its own pass over the stream is not in any case's peak.
    // Counted as it streams by, so the 200 MB is never held.
    let total = 0;
    new Inflate((chunk) => {
      total += chunk.byteLength;
    }).push(deflated, true);
    expect(total).toBe(INFLATED);
    expect(deflated.byteLength).toBeLessThan(256 * 1024);
  });
});
