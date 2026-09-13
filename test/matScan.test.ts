// Copyright 2026 The MathWorks, Inc.
// The contract of the MAT name scanner (src/datamodel/parser/MatScan.ts).
//
// `scanMat` claims to be `parseMat(...).variables.map(v => v.name)` for a fraction of the
// work. That is one claim, and it can fail two ways: by returning the WRONG name, or by
// quietly not being faster. Both are checked here.
//
// WRONG NAME is the dangerous one, because a wrong name does not look wrong — it puts a
// variable in a usage index under a name that is not its own, and every answer built on it
// is confidently false. So the expected values below are LITERAL, taken from `parseMat`
// once (`.scratch/fixture-mat-names.mjs`) and written down. Computing them from `parseMat`
// inside the test would make the comparison agree by construction on the day the scanner
// and the parser are wrong in the same way — which is exactly what a shared helper
// refactor does. The same lists are ALSO compared against `parseMat` live, in a separate
// test, because that catches the opposite failure: `parseMat` changing under the scanner.
//
// NOT FASTER is checked through the inflate seam rather than with a clock: a counting
// engine records whether each compressed record was head-inflated or inflated whole. A
// timing assertion would be flaky, and a scanner accidentally wired back to `parseMat`
// would still pass one on a small fixture.
//
// The corpus-wide version of the same comparison lives in `perf/oracle-run.mjs` (40 real
// `.mat` files, name by name, in order). This file exists so the claim is checked by
// `npm test` on a machine with no corpus at all.

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { constants as zlibConstants, deflateSync, inflateRawSync, inflateSync } from 'node:zlib';
import { setNativeInflate, type NativeInflate } from '../src/datamodel/parser/Inflate.js';
import { parseMat, scanMat } from '../src/index.js';

/**
 * The real node:zlib engine WITH the head mode, injected rather than detected so these
 * tests behave the same on every supported Node: `process.getBuiltinModule` only exists
 * from Node 22.3, and on an older host the interesting path would silently not run.
 */
const NATIVE: NativeInflate = {
  raw: (deflated) => inflateRawSync(deflated),
  zlib: (wrapped) => inflateSync(wrapped),
  zlibHead: (prefix) => inflateSync(prefix, { finishFlush: zlibConstants.Z_SYNC_FLUSH }),
};

/** An engine written before `zlibHead` existed. `src/node/index.ts` used to be this. */
const NATIVE_NO_HEAD: NativeInflate = {
  raw: (deflated) => inflateRawSync(deflated),
  zlib: (wrapped) => inflateSync(wrapped),
};

afterEach(() => {
  setNativeInflate(undefined); // back to detection, so no test leaks its engine
});

/**
 * Run `fn` with an engine that counts which inflate each compressed record went through.
 *
 * This is how a test tells a FAST PATH from a FALLBACK, which is otherwise invisible: both
 * return the same names, and that is the entire point of the fallback. `scanMat` only ever
 * head-inflates, and `parseMat` only ever inflates whole records, so on a file whose
 * records are compressed:
 *
 *   whole === 0   the scan answered by itself
 *   whole  >  0   it refused and `parseMat` answered
 *
 * Without this, a refusal test asserting "the same names as parseMat" would keep passing
 * with the refusal deleted — and a fast-path test would keep passing with the fast path
 * deleted. Both mutations were tried; both are caught here and nowhere else.
 */
function withCounting<T>(base: NativeInflate, fn: () => T): { result: T; head: number; whole: number; bytesOut: number } {
  const tally = { head: 0, whole: 0, bytesOut: 0 };
  setNativeInflate({
    raw: base.raw,
    zlib: (wrapped) => {
      tally.whole++;
      const out = base.zlib(wrapped);
      tally.bytesOut += out.byteLength;
      return out;
    },
    zlibHead: base.zlibHead && ((prefix) => {
      tally.head++;
      const out = base.zlibHead!(prefix);
      tally.bytesOut += out.byteLength;
      return out;
    }),
  });
  try {
    return { result: fn(), ...tally };
  } finally {
    setNativeInflate(undefined);
  }
}

function fixtureBuffer(name: string): ArrayBuffer {
  const b = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/**
 * Every `.mat` fixture in the repo and the name list it holds, in file order.
 *
 * The trailing `''` on four of them is not a gap in the data — it is the unnamed element
 * every MCOS file carries, which `parseMat` pushes as an anonymous variable. It is kept
 * because dropping it would shift every later name by one against a caller that indexes
 * positionally, and because a scanner that silently loses one entry per file is the bug
 * this list would otherwise hide.
 */
const FIXTURE_NAMES: Record<string, string[]> = {
  'sparse_cases.mat': ['spAlloc', 'spComplex', 'spEmpty', 'spLogical', 'spNoneZero', 'spWorked'],
  'strings.mat': [
    's2x3', 'sAstral', 'sCol', 'sEmptyA', 'sEmptyE', 'sLong',
    'sMissing', 'sNd', 'sRow', 'sScalar', 'sUnicode', '',
  ],
  'strings_mixed.mat': ['mixParam', 'mixStr', ''],
  'strings_nested.mat': ['mixCell', 'mixStruct', ''],
  'strings_v7.mat': ['s2x3', 'sRow', 'sScalar', ''],
};

describe('scanMat — the names, literally', () => {
  it.each(Object.keys(FIXTURE_NAMES))('reads %s', (name) => {
    expect(scanMat(fixtureBuffer(name)).names).toEqual(FIXTURE_NAMES[name]);
  });

  it('agrees with parseMat on every fixture, in order', () => {
    // The other direction: the literal lists above pin the scanner, and this pins the two
    // implementations to each other, so neither can drift alone.
    for (const name of Object.keys(FIXTURE_NAMES)) {
      const buffer = fixtureBuffer(name);
      expect(scanMat(buffer).names, name).toEqual(parseMat(buffer).variables.map((v) => v.name));
    }
  });

  it('raises parseMat\'s own error for a v7.3 file, word for word', () => {
    // Not scannable and not scanned: HDF5 carries the same 128-byte header, so nothing in
    // the bytes rejects it and the refusal is by version prefix. The message matters
    // because it reaches a user as the reason a file would not open, and it is spelled in
    // exactly one place — `MatParser` — which is what the fallback exit buys.
    const buffer = fixtureBuffer('strings_v73.mat');
    expect(() => scanMat(buffer)).toThrow('MAT-file version 7.3 (HDF5) is not supported');
    expect(() => parseMat(buffer)).toThrow('MAT-file version 7.3 (HDF5) is not supported');
  });
});

describe('scanMat — the mxOPAQUE layout, which is the failure it exists to avoid', () => {
  it('returns the VARIABLE name of a class-17 variable, not the class or the marker', () => {
    // 11 of the 12 variables in strings.mat are MATLAB `string` arrays, stored as mxOPAQUE
    // (class 17), whose layout is array flags -> class name, with NO dimensions
    // subelement between them. A scanner written from the format's general shape — flags,
    // dimensions, name — skips a subelement that is not there and reads the one AFTER the
    // name: it answers 'MCOS' for every object in the file. That was 13 of 31 corpus files
    // wrong with one symptom, and it is why this test names the wrong answers explicitly
    // instead of trusting the list above to notice.
    const names = scanMat(fixtureBuffer('strings.mat')).names;
    expect(names).not.toContain('MCOS');
    expect(names).not.toContain('string');
    expect(names).toContain('sScalar');
    // Same layout, a user-defined class rather than a built-in one.
    expect(scanMat(fixtureBuffer('strings_mixed.mat')).names).toEqual(['mixParam', 'mixStr', '']);
  });

  it('strips NULs from a class-17 name and from no other, as parseMat does', () => {
    // An asymmetry in `MatParser` rather than a choice made here: `parseOpaque` reads its
    // strings through `readString`, which drops NUL bytes, while the numeric path decodes
    // them raw. Two rules, so two rules are mirrored — the job is to agree with that file,
    // not to improve on it. No fixture has a NUL in a name, so without this the strip is a
    // line of code with nothing holding it in place.
    const opaque = matFile([opaqueVariable('a\0b'), TERMINATOR]);
    expect(scanMat(opaque).names).toEqual(['ab']);
    expect(parseMat(opaque).variables.map((v) => v.name)).toEqual(['ab']);

    const numeric = matFile([namedDouble('c\0d'), TERMINATOR]);
    expect(scanMat(numeric).names).toEqual(['c\0d']);
    expect(parseMat(numeric).variables.map((v) => v.name)).toEqual(['c\0d']);
  });
});

describe('scanMat — it really reads only the head', () => {
  it('head-inflates every compressed record and inflates none of them whole', () => {
    // Every `.mat` fixture in the repo is compressed, one record per variable, so the
    // counts are the variable counts. What this does NOT show is the SAVING: these
    // records are smaller than the 512-byte prefix the scanner asks for, so on a fixture
    // the head IS the whole record. The saving lives where the records are megabytes —
    // 8.6 MB of corpus payloads expanding to 171.4 MB when inflated whole against ~0.1 MB
    // of heads — and `perf/run.mjs` is where that is measured. This test's job is only to
    // prove the head path is the one taken.
    const run = withCounting(NATIVE, () => scanMat(fixtureBuffer('strings.mat')).names);
    expect(run.result).toHaveLength(12);
    expect(run.head).toBe(12);
    expect(run.whole).toBe(0);
  });

  it('bounds the head, so a record that inflates to megabytes still costs kilobytes', () => {
    // The claim above, made visible: one variable holding 1.6 MB of incompressible
    // doubles. Read whole it is 1.6 MB of output; read as a head it is a few hundred
    // bytes, and the name is in them either way.
    const buffer = matFile([compressed(doubleVariable('big', incompressibleDoubles(200_000)))]);

    const head = withCounting(NATIVE, () => scanMat(buffer).names);
    expect(head.result).toEqual(['big']);
    expect(head.head).toBe(1);
    expect(head.whole).toBe(0);
    expect(head.bytesOut).toBeLessThan(4096);

    // The same file through an engine with no head mode: same name, whole record inflated.
    // That is the fallback inside `inflateZlibHead` being a fallback — slower, never wrong,
    // and NOT the same thing as `scanMat` giving up (the scan still answers).
    const noHead = withCounting(NATIVE_NO_HEAD, () => scanMat(buffer).names);
    expect(noHead.result).toEqual(['big']);
    expect(noHead.head).toBe(0);
    expect(noHead.whole).toBe(1);
    expect(noHead.bytesOut).toBeGreaterThan(1_000_000);
  });
});

describe('scanMat — every engine gives the same names', () => {
  // The head comes from a different code path per engine: `inflateSync(prefix,
  // {finishFlush: Z_SYNC_FLUSH})` natively, and a streaming `Unzlib.push(prefix, false)`
  // under fflate — which is what a browser-hosted consumer runs, where neither one-shot
  // fflate spelling works at all (`unzlibSync(prefix)` throws `unexpected EOF`, and a
  // bounded `out` buffer throws `offset is out of bounds`). Three engines, one contract.
  const ENGINES: Array<[string, NativeInflate | null]> = [
    ['node:zlib with a head mode', NATIVE],
    ['node:zlib without one', NATIVE_NO_HEAD],
    ['fflate', null],
  ];

  it.each(ENGINES)('%s', (_label, engine) => {
    setNativeInflate(engine);
    for (const name of Object.keys(FIXTURE_NAMES)) {
      expect(scanMat(fixtureBuffer(name)).names, name).toEqual(FIXTURE_NAMES[name]);
    }
    // And on a record too big to fit the prefix, which is where the engines' head
    // behaviour actually differs.
    const big = matFile([compressed(doubleVariable('big', incompressibleDoubles(50_000)))]);
    expect(scanMat(big).names).toEqual(['big']);
  });
});

describe('scanMat — what it refuses, and what the caller gets instead', () => {
  // A refusal is not a failure: every one of these ends in `parseMat`, so the names are
  // always the ones `parseMat` gives. That makes "the same names" a weak assertion on its
  // own — it would hold with the refusal deleted too — so each test below also says WHICH
  // path answered, by compressing its records and counting inflates (`withCounting`).
  //
  // Every file here is hand-built rather than found, because the whole subject is
  // malformations no fixture contains.

  it('scans hand-built records the ordinary way — the control for everything below', () => {
    const buffer = matFile([compressed(doubleVariable('a')), compressed(doubleVariable('bb')), TERMINATOR]);
    const run = withCounting(NATIVE, () => scanMat(buffer).names);
    expect(run.result).toEqual(['a', 'bb']);
    expect(parseMat(buffer).variables.map((v) => v.name)).toEqual(['a', 'bb']);
    // Two heads, no whole records: the scan answered, so the tests below that show
    // `whole > 0` are showing something these bytes do not cause by themselves.
    expect([run.head, run.whole]).toEqual([2, 0]);
  });

  it('stops at the end-of-variables marker and reads nothing after it', () => {
    const buffer = matFile([compressed(doubleVariable('a')), TERMINATOR, compressed(doubleVariable('unreached'))]);
    const run = withCounting(NATIVE, () => scanMat(buffer).names);
    expect(run.result).toEqual(['a']);
    expect(parseMat(buffer).variables.map((v) => v.name)).toEqual(['a']);
    expect([run.head, run.whole]).toEqual([1, 0]);
  });

  it('answers "" on the FAST path for array flags too short to hold a class', () => {
    // `parseMatrix` returns a nameless shell for fewer than 2 flag bytes and `parseMat`
    // pushes it as an anonymous variable, so '' is the right answer rather than a doubt —
    // and the scanner gives it without falling back, which `whole === 0` is what proves.
    // The record carries a perfectly readable name subelement that neither reader reaches,
    // which is what makes '' a decision instead of an absence.
    const truncatedFlags = record(MI_MATRIX, concat(
      subelement(MI_UINT32, new Uint8Array([6])),
      nameSubelement('notRead'),
    ));
    const buffer = matFile([compressed(truncatedFlags), compressed(doubleVariable('a')), TERMINATOR]);
    const run = withCounting(NATIVE, () => scanMat(buffer).names);
    expect(run.result).toEqual(['', 'a']);
    expect(parseMat(buffer).variables.map((v) => v.name)).toEqual(['', 'a']);
    expect([run.head, run.whole]).toEqual([2, 0]);
  });

  it('falls back for a record that declares more bytes than the file holds', () => {
    // `parseMat` clamps every declared length against the buffer and reads the record
    // short, still producing a variable. Reproducing a clamp is reproducing a repair, so
    // the scanner refuses — and the caller gets the repaired answer anyway.
    // The truncated record is stored UNCOMPRESSED on purpose: a cut through a compressed
    // one destroys the stream, `parseMat` cannot inflate it either and the variable is
    // simply lost, which is a different story. Cut here, 16 bytes off a 72-byte record,
    // the name subelement is intact and only the values are missing — so `parseMat` really
    // does hand back a complete name list from a broken file, and the scanner really does
    // decline to reproduce that.
    const intact = matFile([compressed(doubleVariable('a')), doubleVariable('bb')]);
    const buffer = new Uint8Array(intact).subarray(0, intact.byteLength - 16).slice().buffer;
    const run = withCounting(NATIVE, () => scanMat(buffer).names);
    expect(parseMat(buffer).variables.map((v) => v.name)).toEqual(['a', 'bb']);
    expect(run.result).toEqual(['a', 'bb']);
    // One head — the first record, scanned before the second one was found wanting — and
    // then one WHOLE record, which is `parseMat` starting the file over. The whole count is
    // the proof that the scan bailed out rather than answering, and the head count is the
    // price of a refusal discovered late: work already done is thrown away, because a
    // partial name list is worth nothing.
    expect([run.head, run.whole]).toEqual([1, 1]);
  });

  it('falls back for a name subelement that declares more bytes than the file holds', () => {
    // The record LENGTH is honest here — it is the name subelement inside it that lies —
    // so the record-level check above cannot catch this one, and without a completeness
    // check on the name the decode would read past the end of the buffer.
    //
    // Stored uncompressed and placed LAST, with no terminator after it, so the file ends
    // exactly where the name claims to begin. That makes `parseMat`'s clamp land on zero
    // bytes and produce the anonymous '' shell — a name list worth asserting, rather than
    // whatever the next record's bytes happen to decode to.
    const lyingName = record(MI_MATRIX, concat(
      arrayFlags(6),
      dimensions(1, 1),
      overlongTag(MI_INT8, 1000),
    ));
    const buffer = matFile([compressed(doubleVariable('a')), lyingName]);
    const run = withCounting(NATIVE, () => scanMat(buffer).names);
    expect(run.result).toEqual(['a', '']);
    expect(parseMat(buffer).variables.map((v) => v.name)).toEqual(['a', '']);
    expect([run.head, run.whole]).toEqual([1, 1]);
  });

  it('falls back for a top-level element that is not a variable', () => {
    // `parseMat` warns and reads on, losing that record and nothing else. The scanner
    // could skip it too; it refuses because no corpus file has one, and an untested branch
    // that silently drops a name is not worth owning.
    const notAVariable = record(MI_INT32, new Uint8Array(8));
    const buffer = matFile([notAVariable, compressed(doubleVariable('a')), TERMINATOR]);
    const run = withCounting(NATIVE, () => scanMat(buffer).names);
    expect(run.result).toEqual(['a']);
    expect(parseMat(buffer).warnings.map((w) => w.code)).toContain('part-unreadable');
    expect([run.head, run.whole]).toEqual([0, 1]);
  });

  it('falls back when a name subelement is not int8 or uint8', () => {
    // A layout check, not a decode one: `parseMatrix` decodes those bytes as UTF-8
    // whatever the tag says, so this cannot change a name. What it catches is a walk
    // standing at the wrong offset — a name subelement declaring itself to be doubles is
    // the signal, and answering confidently from there is the one thing a name scanner
    // must never do. The caller still gets `parseMat`'s reading of it.
    const mistypedName = record(MI_MATRIX, concat(
      arrayFlags(6),
      dimensions(1, 1),
      subelement(MI_DOUBLE, new TextEncoder().encode('weird__')),
      subelement(MI_DOUBLE, new Uint8Array(8)),
    ));
    const buffer = matFile([compressed(mistypedName), TERMINATOR]);
    const run = withCounting(NATIVE, () => scanMat(buffer).names);
    expect(run.result).toEqual(['weird__']);
    expect(parseMat(buffer).variables.map((v) => v.name)).toEqual(['weird__']);
    // One head read, refused, then one whole record read by `parseMat`.
    expect([run.head, run.whole]).toEqual([1, 1]);
  });

  it('falls back for a compressed record that will not inflate', () => {
    const rubbish = record(MI_COMPRESSED, new Uint8Array([0x78, 0x9c, 1, 2, 3, 4, 5, 6]));
    const buffer = matFile([rubbish, compressed(doubleVariable('a')), TERMINATOR]);
    // `parseMat` warns about the record and reads the next one, so 'a' survives both ways.
    const run = withCounting(NATIVE, () => scanMat(buffer).names);
    expect(run.result).toEqual(['a']);
    expect(parseMat(buffer).warnings.map((w) => w.code)).toContain('part-unreadable');
    expect(run.whole).toBeGreaterThan(0);
  });

  it('raises parseMat\'s error for bytes that are not a v5 MAT-file at all', () => {
    const short = new Uint8Array(64).buffer;
    expect(() => scanMat(short)).toThrow('Not a MAT-file: shorter than the 128-byte header');

    const bigEndian = new Uint8Array(matFile([doubleVariable('a'), TERMINATOR]));
    bigEndian[126] = 0x4d; // 'M'
    bigEndian[127] = 0x49; // 'I'
    expect(() => scanMat(bigEndian.slice().buffer)).toThrow('Big-endian MAT files not supported');
  });
});

// ---- MAT surgery, so the odd cases are real files and not mocks ---------------------
//
// Level-5 layout, written out by hand: a 128-byte header, then tagged records, then the
// format's zero terminator. Nothing here is clever; it exists so a test can build the
// exact malformation it is about instead of hoping a fixture contains one.

const MI_INT8 = 1;
const MI_INT32 = 5;
const MI_UINT32 = 6;
const MI_DOUBLE = 9;
const MI_MATRIX = 14;
const MI_COMPRESSED = 15;

const TERMINATOR = new Uint8Array(8);

function align8(n: number): number {
  return n + ((8 - (n % 8)) % 8);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** One subelement: an 8-byte tag, then the payload padded out to an 8-byte boundary. */
function subelement(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + align8(payload.byteLength));
  const view = new DataView(out.buffer);
  view.setUint32(0, type, true);
  view.setUint32(4, payload.byteLength, true);
  out.set(payload, 8);
  return out;
}

/**
 * One top-level record. NOT padded, and the byte count is exact: `parseMat` advances by
 * `8 + numBytes` with no alignment of its own, and `miCOMPRESSED` counts really are exact
 * in files MATLAB writes. Every payload built here is a multiple of 8 anyway, because it
 * is made of subelements.
 */
function record(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, type, true);
  view.setUint32(4, payload.byteLength, true);
  out.set(payload, 8);
  return out;
}

/** The array-flags subelement: class in the low byte, then flags, then nzmax. */
function arrayFlags(arrayClass: number): Uint8Array {
  const payload = new Uint8Array(8);
  payload[0] = arrayClass;
  return subelement(MI_UINT32, payload);
}

function dimensions(...dims: number[]): Uint8Array {
  const payload = new Uint8Array(dims.length * 4);
  const view = new DataView(payload.buffer);
  dims.forEach((d, i) => view.setInt32(i * 4, d, true));
  return subelement(MI_INT32, payload);
}

function nameSubelement(name: string): Uint8Array {
  return subelement(MI_INT8, new TextEncoder().encode(name));
}

/**
 * A subelement tag that LIES: it declares `declaredBytes` of payload and carries none.
 *
 * Both readers believe a declared length until it runs out of file, so this is how a file
 * says "the name is 1000 bytes long" without being 1000 bytes long.
 */
function overlongTag(type: number, declaredBytes: number): Uint8Array {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setUint32(0, type, true);
  view.setUint32(4, declaredBytes, true);
  return out;
}

/**
 * An mxOPAQUE (class 17) variable: array flags, then the NAME, then a marker and a class
 * name, with NO dimensions subelement. The layout `parseOpaque` reads, and the one a
 * scanner written from the format's general shape gets wrong.
 */
function opaqueVariable(name: string, className = 'string'): Uint8Array {
  return record(MI_MATRIX, concat(
    arrayFlags(17),
    nameSubelement(name),
    subelement(MI_INT8, new TextEncoder().encode('MCOS')),
    subelement(MI_INT8, new TextEncoder().encode(className)),
  ));
}

/** Spelled out for readability at the one call site that cares about the name only. */
const namedDouble = (name: string): Uint8Array => doubleVariable(name);

/** A `1xN` double variable, or a `1x1` zero when no data is given. */
function doubleVariable(name: string, data = new Uint8Array(8)): Uint8Array {
  return record(MI_MATRIX, concat(
    arrayFlags(6),
    dimensions(1, data.byteLength / 8),
    nameSubelement(name),
    subelement(MI_DOUBLE, data),
  ));
}

/** The same record, zlib-wrapped the way MATLAB stores one. */
function compressed(matrixRecord: Uint8Array): Uint8Array {
  const deflated = deflateSync(matrixRecord);
  return record(MI_COMPRESSED, new Uint8Array(deflated.buffer, deflated.byteOffset, deflated.byteLength));
}

/**
 * Doubles that will NOT deflate, so a "record bigger than the head" test really is one.
 *
 * A counter, not a random source: a test that builds different bytes on every run has a
 * different subject on every run.
 */
function incompressibleDoubles(count: number): Uint8Array {
  const out = new Uint8Array(count * 8);
  const view = new DataView(out.buffer);
  let state = 0x2545f491;
  for (let i = 0; i < count; i++) {
    // xorshift32: cheap, deterministic, and its output has no structure to compress.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    view.setUint32(i * 8, state >>> 0, true);
    view.setUint32(i * 8 + 4, (state >>> 0) ^ 0x9e3779b9, true);
  }
  return out;
}

function matFile(records: Uint8Array[]): ArrayBuffer {
  const header = new Uint8Array(128);
  header.fill(0x20, 0, 116);
  header.set(new TextEncoder().encode('MATLAB 5.0 MAT-file, built by test/matScan.test.ts'), 0);
  header[124] = 0x00;
  header[125] = 0x01; // version 0x0100
  header[126] = 0x49; // 'I'
  header[127] = 0x4d; // 'M'
  return concat(header, ...records).slice().buffer;
}
