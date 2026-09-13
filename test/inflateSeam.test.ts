// Copyright 2026 The MathWorks, Inc.
// Unit tests for the inflate seam (src/datamodel/parser/Inflate.ts).
//
// The seam swaps fflate for node:zlib when one is available. Its whole value rests on
// producing IDENTICAL output, so most of what follows compares the two engines rather
// than asserting fixed bytes: the engine is the thing under test, not the format.
//
// Every test forces the engine explicitly instead of trusting whatever the host Node
// happens to provide. `process.getBuiltinModule` only exists from Node 22.3, so on an
// older host the interesting path would silently not run and the suite would pass
// without testing anything.

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateRawSync, inflateSync, deflateSync } from 'node:zlib';
import { strToU8, unzipSync, zipSync } from 'fflate';
import {
  inflateZlib,
  setNativeInflate,
  unzipEntries,
  type NativeInflate,
} from '../src/datamodel/parser/Inflate.js';
import { parseBinarySldd, parseMat, parseSlx } from '../src/index.js';

// The real node:zlib engine, injected rather than detected so these tests behave the
// same on every supported Node.
const NATIVE: NativeInflate = {
  raw: (deflated) => inflateRawSync(deflated),
  zlib: (wrapped) => inflateSync(wrapped),
};

afterEach(() => {
  setNativeInflate(undefined); // back to detection, so no test leaks its engine
});

function fixtureBytes(name: string): Uint8Array {
  const b = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

/** The same fixture as a standalone ArrayBuffer, which is what the parsers take. */
function fixtureBuffer(name: string): ArrayBuffer {
  const b = fixtureBytes(name);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

function entriesWith(engine: NativeInflate | null, bytes: Uint8Array): Record<string, Uint8Array> {
  setNativeInflate(engine);
  return unzipEntries(bytes);
}

/** Same names in the same order, same bytes. */
function expectSameEntries(a: Record<string, Uint8Array>, b: Record<string, Uint8Array>): void {
  expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
  for (const name of Object.keys(a)) {
    expect(Array.from(b[name]), `entry ${name}`).toEqual(Array.from(a[name]));
  }
}

describe('inflate seam — the two engines agree', () => {
  it('produces identical entries for a deflated archive', () => {
    const archive = zipSync({
      'data/chunk0.xml': strToU8('<Object>'.repeat(4000)),
      'meta.txt': strToU8('hello'),
    });
    expectSameEntries(entriesWith(null, archive), entriesWith(NATIVE, archive));
  });

  it('produces identical entries for a committed .slx fixture', () => {
    const bytes = fixtureBytes('maskUsage.slx');
    expectSameEntries(entriesWith(null, bytes), entriesWith(NATIVE, bytes));
  });

  it('produces identical entries for a committed compressed .sldd fixture', () => {
    const bytes = fixtureBytes('compressed.sldd');
    expectSameEntries(entriesWith(null, bytes), entriesWith(NATIVE, bytes));
  });

  it('agrees with fflate on stored (uncompressed) members', () => {
    // Simulink writes most .slx parts stored -- one 13.8 MB model measured 347 stored
    // members against 29 deflated -- so this is the common case, not the exotic one.
    const archive = zipSync({ 'stored.bin': [new Uint8Array([1, 2, 3, 4]), { level: 0 }] });
    expectSameEntries(entriesWith(null, archive), entriesWith(NATIVE, archive));
  });

  it('emits a zero-length entry for a directory member, as fflate does', () => {
    // fflate returns directory members as empty entries. The fast walk originally
    // skipped names ending in '/', which no corpus archive would have caught: none of
    // the 40 real archives contains one, but an archive from another writer can.
    const archive = zipSync({ 'dir/': new Uint8Array(0), 'dir/f.txt': strToU8('x') });
    const viaFflate = entriesWith(null, archive);
    const viaNative = entriesWith(NATIVE, archive);
    expect(Object.keys(viaFflate)).toContain('dir/');
    expectSameEntries(viaFflate, viaNative);
  });

  it('agrees on an empty archive', () => {
    const archive = zipSync({});
    expectSameEntries(entriesWith(null, archive), entriesWith(NATIVE, archive));
  });
});

describe('inflate seam — every entry owns an exactly sized buffer', () => {
  // This is the sharp edge. node:zlib hands back a Buffer that, for small payloads, is
  // a window into a shared 16 KB pool: byteLength 2 inside buffer.byteLength 16384.
  // Callers reach straight through to the ArrayBuffer -- SlxParser does
  // `parseMxArray(part.buffer)`, MdlParser hands `.buffer` to readMxArrayRecords -- so
  // a pooled buffer means reading whatever else is in the pool as trailing records.
  // fflate always allocated per entry, so nothing downstream expects otherwise.
  it('holds for small deflated members, where zlib pools its output', () => {
    const archive = zipSync({
      'tiny1.txt': strToU8('a'),
      'tiny2.txt': strToU8('bb'),
      'tiny3.txt': strToU8('ccc'),
    });
    const entries = entriesWith(NATIVE, archive);
    for (const [name, value] of Object.entries(entries)) {
      expect(value.byteOffset, `${name} byteOffset`).toBe(0);
      expect(value.buffer.byteLength, `${name} buffer length`).toBe(value.byteLength);
    }
  });

  it('holds for stored members too', () => {
    const archive = zipSync({ 's.bin': [new Uint8Array([9, 8, 7]), { level: 0 }] });
    const entries = entriesWith(NATIVE, archive);
    expect(entries['s.bin'].byteOffset).toBe(0);
    expect(entries['s.bin'].buffer.byteLength).toBe(3);
  });

  it('returns plain Uint8Array, not Buffer, so no Node semantics leak out', () => {
    // Buffer is a Uint8Array subclass with a different toString(); a consumer that
    // gets one back behaves differently depending on which engine ran.
    const archive = zipSync({ 'a.txt': strToU8('some text long enough to deflate') });
    const entries = entriesWith(NATIVE, archive);
    expect(Object.getPrototypeOf(entries['a.txt'])).toBe(Uint8Array.prototype);
  });

  it('holds for inflateZlib output as well', () => {
    const payload = deflateSync(Buffer.from('xy')); // small on purpose: pooled output
    const asU8 = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    setNativeInflate(null);
    const viaFflate = inflateZlib(asU8);
    setNativeInflate(NATIVE);
    const viaNative = inflateZlib(asU8);
    expect(viaNative.byteOffset).toBe(0);
    expect(viaNative.buffer.byteLength).toBe(viaNative.byteLength);
    expect(Array.from(viaNative)).toEqual(Array.from(viaFflate));
  });
});

describe('inflate seam — falls back rather than failing', () => {
  it('falls back when the native engine throws', () => {
    const archive = zipSync({ 'a.txt': strToU8('content that deflates') });
    const exploding: NativeInflate = {
      raw: () => {
        throw new Error('engine exploded');
      },
      zlib: () => {
        throw new Error('engine exploded');
      },
    };
    setNativeInflate(exploding);
    expect(unzipEntries(archive)).toEqual(unzipSync(archive));
  });

  it('falls back when the native engine returns the wrong number of bytes', () => {
    // The size guard exists because a walk that misreads an offset would otherwise
    // return bytes that are confidently wrong -- worse than an error.
    const archive = zipSync({ 'a.txt': strToU8('content that deflates') });
    const truncating: NativeInflate = {
      raw: (d) => inflateRawSync(d).subarray(0, 3),
      zlib: (w) => inflateSync(w),
    };
    setNativeInflate(truncating);
    expect(unzipEntries(archive)).toEqual(unzipSync(archive));
  });

  it('falls back on an unsupported compression method', () => {
    const archive = zipSync({ 'a.txt': strToU8('content that deflates') });
    const patched = patchCompressionMethod(archive, 99);
    // fflate rejects method 99 too, so the observable is that the seam raises the SAME
    // failure it always did rather than inventing a new one.
    let fromFflate: unknown;
    try {
      unzipSync(patched);
    } catch (e) {
      fromFflate = (e as Error).message;
    }
    setNativeInflate(NATIVE);
    let fromSeam: unknown;
    try {
      unzipEntries(patched);
    } catch (e) {
      fromSeam = (e as Error).message;
    }
    expect(fromFflate).toBeTruthy();
    expect(fromSeam).toBe(fromFflate);
  });

  it('keeps the existing diagnostic for bytes that are not a zip at all', () => {
    // test/ingestDispatch.test.ts matches /invalid zip/i on this path. The fallback is
    // what keeps that true: fflate raises it, exactly as before the seam existed.
    const notAZip = new Uint8Array([0x20, 0x09, 0x0a]);
    setNativeInflate(NATIVE);
    expect(() => unzipEntries(notAZip)).toThrow(/invalid zip/i);
  });

  it('reads an archive whose local header defers sizes to a data descriptor', () => {
    // General-purpose flag bit 3 means the local header's sizes are zero and the real
    // ones trail the data. The walk reads sizes from the CENTRAL DIRECTORY, which is
    // authoritative either way, so bit 3 needs no special case -- this test is what
    // says so rather than the comment claiming it.
    const archive = zipSync({ 'a.txt': strToU8('content that deflates nicely') });
    const streamed = makeLocalHeaderStreaming(archive);
    setNativeInflate(NATIVE);
    const entries = unzipEntries(streamed);
    expect(new TextDecoder().decode(entries['a.txt'])).toBe('content that deflates nicely');
  });
});

describe('inflate seam — a filtered read materializes only what was asked for', () => {
  // `unzipEntries(bytes, wanted)` exists so a caller reading five parts of a 13 MB `.slx`
  // does not materialize the other 13.2 MB (`ModelStructureScan`, which holds 1.4 KB
  // instead). Filtering the RESULT would give the same map, so "only the wanted members
  // were materialized" is the whole contract -- and it cannot be checked with a clock
  // without being flaky. What is checked instead: the map contains exactly the wanted
  // names. A walk that ignored the filter would hand back every member and fail here, and
  // the two engines are checked separately because each implements the filter itself --
  // the walk with a `keep` flag, fflate with its own `filter` option.
  const MIXED = () =>
    zipSync({
      'simulink/blockDiagram.json': strToU8(`{"note":"deflated, and wanted"}${' '.repeat(200)}`),
      'simulink/systems/system_1.xml': strToU8('<System><Block/></System>'.repeat(400)),
      'metadata/thumbnail.png': [new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { level: 0 }],
      'meta.txt': strToU8('stored-or-deflated, unwanted'),
    });
  const WANTED = new Set(['simulink/blockDiagram.json', 'metadata/thumbnail.png']);
  const wanted = (name: string) => WANTED.has(name);

  it.each([['node:zlib', NATIVE], ['fflate', null]] as Array<[string, NativeInflate | null]>)(
    'returns exactly the wanted names, with the same bytes as an unfiltered read (%s)',
    (_label, engine) => {
      const archive = MIXED();
      // One wanted member is deflated and one is stored, deliberately: the two are gated
      // in different branches of the walk, and a filter honoured in only one of them would
      // pass a test whose wanted members were all the same kind.
      const all = entriesWith(engine, archive);
      expect(Object.keys(all).length).toBeGreaterThan(WANTED.size);

      setNativeInflate(engine);
      const filtered = unzipEntries(archive, wanted);
      expect(Object.keys(filtered).sort()).toEqual([...WANTED].sort());
      // And they are the SAME members, not merely members with the right names: skipping
      // entries is where an offset walk would go wrong, and a wrong offset yields bytes
      // rather than an error.
      for (const name of WANTED) {
        expect(Array.from(filtered[name]), name).toEqual(Array.from(all[name]));
      }
    },
  );

  it.each([['node:zlib', NATIVE], ['fflate', null]] as Array<[string, NativeInflate | null]>)(
    'admits nothing for a filter that wants nothing, and everything for one that wants all (%s)',
    (_label, engine) => {
      // The degenerate ends. A filter ignored outright passes neither: the empty case comes
      // back full, and the total case is what says the filter subtracts nothing on its own.
      const archive = MIXED();
      const all = entriesWith(engine, archive);
      setNativeInflate(engine);
      expect(unzipEntries(archive, () => false)).toEqual({});
      expectSameEntries(all, unzipEntries(archive, () => true));
    },
  );

  it('leaves an unwanted member unread even when that member could not be read at all', () => {
    // The documented consequence of filtering, pinned so it cannot drift silently: bytes
    // that are never inflated cannot fail to inflate. An archive with an unsupported
    // compression method on an UNWANTED member is refused by the unfiltered read -- fflate
    // raises it, and that is the diagnostic callers have always seen -- and opens on the
    // filtered one. `ModelStructureScan` inherits exactly this, which is why a model whose
    // block parts are corrupt still yields its dictionary link and references.
    const archive = zipSync({
      'wanted.txt': strToU8('the part the caller reads'),
      'broken.bin': strToU8('content that deflates'),
    });
    const patched = patchCompressionMethod(archive, 99, 'broken.bin');
    setNativeInflate(NATIVE);
    expect(() => unzipEntries(patched)).toThrow();
    expect(Object.keys(unzipEntries(patched, (name) => name === 'wanted.txt'))).toEqual(['wanted.txt']);
  });
});

describe('inflate seam — engine selection', () => {
  it('null forces the fflate path', () => {
    setNativeInflate(null);
    const archive = zipSync({ 'a.txt': strToU8('x') });
    expect(unzipEntries(archive)).toEqual(unzipSync(archive));
  });

  it('inflateZlib agrees with fflate on a zlib-wrapped stream', () => {
    const original = 'MAT miCOMPRESSED payloads are zlib-wrapped, not raw. '.repeat(200);
    const wrapped = deflateSync(Buffer.from(original));
    const asU8 = new Uint8Array(wrapped.buffer, wrapped.byteOffset, wrapped.byteLength);
    setNativeInflate(null);
    const viaFflate = inflateZlib(asU8);
    setNativeInflate(NATIVE);
    const viaNative = inflateZlib(asU8);
    expect(new TextDecoder().decode(viaNative)).toBe(original);
    expect(Array.from(viaNative)).toEqual(Array.from(viaFflate));
  });
});

describe('inflate seam — the parsers produce the same result either way', () => {
  // The end-to-end claim. Byte equality at the seam is necessary but not sufficient:
  // what matters is that no parser behaves differently, including the ones that reach
  // through an entry's `.buffer`.
  it.each(['maskUsage.slx', 'model_with_refs.slx'])('parseSlx agrees on %s', (name) => {
    const buffer = fixtureBuffer(name);
    setNativeInflate(null);
    const viaFflate = parseSlx(buffer, name);
    setNativeInflate(NATIVE);
    const viaNative = parseSlx(buffer, name);
    expect(JSON.stringify(viaNative)).toBe(JSON.stringify(viaFflate));
  });

  it.each(['compressed.sldd', 'nd_binary.sldd', 'object_props_binary.sldd', 'rt_bin.sldd'])(
    'parseBinarySldd agrees on %s',
    (name) => {
      const buffer = fixtureBuffer(name);
      setNativeInflate(null);
      const viaFflate = parseBinarySldd(buffer);
      setNativeInflate(NATIVE);
      const viaNative = parseBinarySldd(buffer);
      expect(JSON.stringify(viaNative)).toBe(JSON.stringify(viaFflate));
    },
  );

  it.each(['strings.mat', 'strings_mixed.mat', 'strings_nested.mat', 'sparse_cases.mat'])(
    'parseMat agrees on %s',
    (name) => {
      const buffer = fixtureBuffer(name);
      setNativeInflate(null);
      const viaFflate = parseMat(buffer);
      setNativeInflate(NATIVE);
      const viaNative = parseMat(buffer);
      expect(JSON.stringify(viaNative)).toBe(JSON.stringify(viaFflate));
    },
  );
});

// ---- archive surgery, so the odd cases are real archives and not mocks -------------

function findEocd(b: Uint8Array): number {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = v.byteLength - 22; i >= 0; i--) {
    if (v.getUint32(i, true) === 0x06054b50) return i;
  }
  throw new Error('no EOCD in the test archive');
}

/**
 * Rewrite the compression method in both the central directory and the local header —
 * for every member, or for just the one named.
 */
function patchCompressionMethod(archive: Uint8Array, method: number, only?: string): Uint8Array {
  const out = archive.slice();
  const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const utf8 = new TextDecoder();
  const eocd = findEocd(out);
  let p = v.getUint32(eocd + 16, true);
  const count = v.getUint16(eocd + 10, true);
  let patched = 0;
  for (let i = 0; i < count; i++) {
    const nameLength = v.getUint16(p + 28, true);
    const extraLength = v.getUint16(p + 30, true);
    const commentLength = v.getUint16(p + 32, true);
    const localOffset = v.getUint32(p + 42, true);
    if (only === undefined || utf8.decode(out.subarray(p + 46, p + 46 + nameLength)) === only) {
      v.setUint16(p + 10, method, true);
      v.setUint16(localOffset + 8, method, true);
      patched++;
    }
    p += 46 + nameLength + extraLength + commentLength;
  }
  // A misspelled name would leave the archive intact and every caller's `toThrow` would
  // then be asserting nothing at all.
  expect(patched, `patched no member for ${only ?? 'all'}`).toBeGreaterThan(0);
  return out;
}

/**
 * Turn a normal archive into one a STREAMING writer would produce: flag bit 3 set and
 * the local header's sizes and CRC zeroed, with the central directory left correct.
 */
function makeLocalHeaderStreaming(archive: Uint8Array): Uint8Array {
  const out = archive.slice();
  const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const eocd = findEocd(out);
  let p = v.getUint32(eocd + 16, true);
  const count = v.getUint16(eocd + 10, true);
  for (let i = 0; i < count; i++) {
    const nameLength = v.getUint16(p + 28, true);
    const extraLength = v.getUint16(p + 30, true);
    const commentLength = v.getUint16(p + 32, true);
    const localOffset = v.getUint32(p + 42, true);
    v.setUint16(p + 8, v.getUint16(p + 8, true) | 0x08, true); // CD flags
    v.setUint16(localOffset + 6, v.getUint16(localOffset + 6, true) | 0x08, true);
    v.setUint32(localOffset + 14, 0, true); // crc
    v.setUint32(localOffset + 18, 0, true); // compressed size
    v.setUint32(localOffset + 22, 0, true); // uncompressed size
    p += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}
