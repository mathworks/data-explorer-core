// Copyright 2026 The MathWorks, Inc.
//
// MATLAB's 64-bit integers, out of a .mat file and out of the other three channels.
//
// A JavaScript number cannot hold intmax('uint64'). Read through `Number(getBigUint64())`
// it displayed as 18446744073709552000 — not merely rounded but OUT of uint64 range, which
// MATLAB's own reader does not clamp. The .sldd channels were fixed for defects 29 and 30
// by carrying such a token as its own decimal TEXT; the .mat reader kept the cast and was
// the last channel still lossy (PLAN.md Task 10.2).
//
// Ground truth is `mat2str` as MATLAB itself printed it into the corpus's truth.json —
// see test/parity/matlab/README.md for how the corpus was generated. Asserting all four
// channels against that one string is the point: a value that survives .sldd and dies in
// .mat is exactly the bug, and nothing but MATLAB's own spelling can tell.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFile, findEntry, bytesOf } from './parity/loadFile.js';
import { parseMat, parseMatrix } from '../src/datamodel/parser/MatParser.js';
import { encodeMatVariable } from '../src/datamodel/parser/MatWriter.js';
import { exactInt, isExactToken } from '../src/datamodel/parser/XmlUtils.js';

const truth = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./parity/artifacts/truth.json', import.meta.url)),
    'utf8',
  ),
);

// Every 64-bit entry the corpus carries, scalar and vector, both signs, both classes,
// and the one value that is inside int64 range but outside a double's (2^53 + 1).
const CASES: [string, string][] = [
  ['s_int64', 'int64'],
  ['max_int64', 'int64'],
  ['min_int64', 'int64'],
  ['i64Unsafe', 'int64'],
  ['i64Vec', 'int64'],
  ['s_uint64', 'uint64'],
  ['min_uint64', 'uint64'],
  ['maxU64', 'uint64'],
  ['u64Vec', 'uint64'],
];

// The corpus in all four formats. MATLAB wrote each one from the same workspace, so a
// disagreement between them is ours, not MATLAB's.
const CHANNELS: [string, string][] = [
  ['mat', './artifacts/mat/cases.mat'],
  ['text', './artifacts/text/cases.sldd'],
  ['binary', './artifacts/binary/cases.sldd'],
  ['slx', './artifacts/slx/cases.slx'],
];

const roots = new Map(CHANNELS.map(([label, rel]) => [label, loadFile(rel)]));

describe('64-bit integers, exact in every channel', () => {
  it('has MATLAB truth for every case', () => {
    // If a name ever leaves the corpus this fails here rather than silently asserting
    // `undefined === undefined` further down.
    for (const [name, cls] of CASES) {
      expect(truth.vars[name], name).toBeTruthy();
      expect(truth.vars[name].class, name).toBe(cls);
      expect(typeof truth.vars[name].mat2str, name).toBe('string');
    }
  });

  it('displays the digits MATLAB printed, in .mat and in every other channel', () => {
    for (const [label] of CHANNELS) {
      for (const [name] of CASES) {
        const n = findEntry(roots.get(label), name);
        expect(String(n.displayValue), label + ' ' + name).toBe(truth.vars[name].mat2str);
      }
    }
  });

  it('keeps the exact value on each element of a vector, not just in the summary', () => {
    // The summary line and the element rows are formatted by different code, so a fix
    // that lands on one and not the other reads as correct until a row is expanded.
    for (const [label] of CHANNELS) {
      expect(
        findEntry(roots.get(label), 'u64Vec').children.map((c: any) => String(c.displayValue)),
        label,
      ).toEqual(['18446744073709551615', '1', '0']);
      expect(
        findEntry(roots.get(label), 'i64Vec').children.map((c: any) => String(c.displayValue)),
        label,
      ).toEqual(['9223372036854775807', '-9223372036854775808', '-1']);
    }
  });

  it('reports the class MATLAB reports', () => {
    for (const [label] of CHANNELS) {
      for (const [name, cls] of CASES) {
        expect(findEntry(roots.get(label), name).dataType, label + ' ' + name).toBe(cls);
      }
    }
  });

  it('names the value the old cast produced, so the regression is unmistakable', () => {
    // MATLAB's spelling and what a double makes of it are two different strings — the
    // reason truth.json is the only usable oracle here, and the reason the assertion
    // above cannot be written as a numeric comparison: the literal
    // `18446744073709551615` in this file IS the wrong number already.
    expect(String(Number(truth.vars.maxU64.mat2str))).toBe('18446744073709552000');
    expect(String(findEntry(roots.get('mat'), 'maxU64').displayValue)).toBe(
      '18446744073709551615',
    );
  });
});

describe('exactInt', () => {
  it('keeps a number wherever a double is lossless', () => {
    // Only the values that were actually being corrupted change representation, so no
    // existing consumer sees a string where it used to see a number.
    for (const n of [0, 1, -1, 7, 4503599627370496, -4503599627370496, 9007199254740991]) {
      expect(exactInt(BigInt(n))).toBe(n);
    }
  });

  it('falls back to the canonical decimal text past 2^53', () => {
    expect(exactInt(18446744073709551615n)).toBe('18446744073709551615');
    expect(exactInt(9223372036854775807n)).toBe('9223372036854775807');
    expect(exactInt(-9223372036854775808n)).toBe('-9223372036854775808');
    expect(exactInt(9007199254740993n)).toBe('9007199254740993');
    // 2^53 itself: representable, but indistinguishable from 2^53 + 1 once it is a
    // double, so `isSafeInteger` excludes it and the text form is the honest answer.
    expect(exactInt(9007199254740992n)).toBe('9007199254740992');
  });

  it('produces tokens the rest of the pipeline recognizes as exact', () => {
    expect(isExactToken(exactInt(18446744073709551615n))).toBe(true);
    expect(isExactToken(exactInt(-9223372036854775808n))).toBe(true);
    expect(isExactToken(7)).toBe(false);
    expect(isExactToken('7.5')).toBe(false);
    expect(isExactToken('')).toBe(false);
  });
});

describe('64-bit round trip through the MAT byte writer', () => {
  // The reader and MatWriter's toBigInt are one pair: an exact read is worth nothing if
  // the writer puts the token back through a double. This goes out as bytes and comes
  // back through the same parser, so a rounding on either side shows up as a changed
  // value rather than as a changed spelling.
  function reread(v: any): any {
    const bytes = encodeMatVariable(v);
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const view = new DataView(buf as ArrayBuffer);
    return parseMatrix(view, 8, view.getUint32(4, true));
  }

  const { variables } = parseMat(bytesOf('./artifacts/mat/cases.mat'));
  const byName = new Map(variables.map((v) => [v.name, v]));

  it('carries every 64-bit case out and back unchanged', () => {
    for (const [name] of CASES) {
      const original = byName.get(name);
      expect(original, name).toBeTruthy();
      expect(reread(original).value, name).toEqual(original!.value);
    }
  });

  it('writes maxU64 as the eight bytes MATLAB wrote, not as a rounded double', () => {
    const bytes = encodeMatVariable(byName.get('maxU64')!);
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const view = new DataView(buf as ArrayBuffer);
    // The payload is the last eight bytes of the element: flags, dims and an empty name
    // precede it, and all three are fixed-size here.
    expect(view.getBigUint64(view.byteLength - 8, true)).toBe(18446744073709551615n);
  });
});
