// Copyright 2026 The MathWorks, Inc.
//
// What one write puts out that no data it was handed backs (MatWriter.UNBACKED_BYTES_BUDGET):
// the column index of a sparse array past the columns its source backs, four bytes a column,
// and the empty double a cell or a struct array writes for each element it declares and does
// not hold, 56 bytes apiece. One budget of 16 MiB for a whole value, shared by every array and
// container in it, charged before anything is allocated, and refused past it with a
// MatWriteError a caller can catch. The numbers here are the budget's, written out, so that
// moving it is a change to this file: each boundary is a shape just under it that is written
// and one just over it that is not.
//
// One budget for the value, not an allowance per array: an allowance of 256 free columns per
// array let a cell of 80,000 sparse arrays of 0x256, an 11 KB .mat, write 80 MB of index, and
// copied, pasted into a binary dictionary and saved, it was a fatal out-of-memory.
import { describe, it, expect } from 'vitest';
import {
  encodeMatStream,
  MatBudgetError,
  MatWriteError,
  oneWrite,
  spendUnbacked,
} from '../src/datamodel/parser/MatWriter.js';
import type { MatVariable } from '../src/datamodel/parser/MatParser.js';
import type { SparseData } from '../src/datamodel/parser/SparseData.js';

const none = (): SparseData => ({ row: new Int32Array(0), col: new Int32Array(0), re: new Float64Array(0), im: null });
/** A sparse array of `dims` holding nothing, with nothing behind its columns: a literal's, or a host's. */
const sparse = (dims: number[], s: SparseData = none()): MatVariable => ({
  name: '', className: 'double', dimensions: dims, isComplex: false, isLogical: false, isSparse: true, value: null, fields: null, sparse: s,
});
/** A 1xN host array with one entry: N - 1 columns no data backs. */
const host = (cols: number): MatVariable =>
  sparse([1, cols], { row: Int32Array.from([0]), col: Int32Array.from([0]), re: Float64Array.from([5]), im: null });
const cell = (members: (MatVariable | null)[], dims = [1, members.length]): MatVariable => ({
  name: '', className: 'cell', dimensions: dims, isComplex: false, isLogical: false, value: members, fields: null,
});
const structArray = (n: number, f: (MatVariable | null)[]): MatVariable => ({
  name: '', className: 'struct', dimensions: [1, n], isComplex: false, isLogical: false, value: null, fields: { f: f as MatVariable[] },
});
const many = (n: number, f: () => MatVariable) => Array.from({ length: n }, f);
/**
 * The stream of a sparse array holding nothing: preamble and tag, 16 bytes; flags, dims and
 * name, 40; empty ir and pr, 16; and its index of cols + 1 words, padded to eight bytes.
 */
const streamOf = (cols: number) => 72 + 8 + 8 * Math.ceil((4 * (cols + 1)) / 8);

/** What encodeMatStream does with `v`: the stream's length, or 'refused' for a MatWriteError. */
function encode(v: MatVariable): number | 'refused' {
  try {
    return encodeMatStream(v).length;
  } catch (e) {
    if (e instanceof MatWriteError) return 'refused';
    throw e;
  }
}
const timed = <T>(f: () => T): [T, number] => {
  const t0 = performance.now();
  const out = f();
  return [out, performance.now() - t0];
};

// These encode arrays of 8 or 16 MiB of index, cells of 16,384 or more sparse arrays, or
// 299,595 holes: up to 1.2 s here, 2.8 s on CI's runners, past half vitest's 5 s default;
// give them headroom.
const HEAVY_TIMEOUT = 60_000;

describe('one sparse array: 4,194,304 columns no data backs are written, and one more is not', () => {
  it('a 0xN array, backed for none of its columns', { timeout: HEAVY_TIMEOUT }, () => {
    expect(encode(sparse([0, 4194304]))).toBe(streamOf(4194304));
    const [refused, ms] = timed(() => encode(sparse([0, 4194305])));
    expect([refused, ms < 100]).toEqual(['refused', true]);
  });

  it('a host\'s 1xN with one entry, which backs one column', { timeout: HEAVY_TIMEOUT }, () => {
    expect(encode(host(4194305))).not.toBe('refused');
    expect(encode(host(4194306))).toBe('refused');
    // A host's 1x2e6 with three entries: 7,999,988 bytes, within it.
    expect(encode(sparse([1, 2e6], { row: Int32Array.from([0, 0, 0]), col: Int32Array.from([0, 1e6, 2e6 - 1]), re: Float64Array.from([1, 2, 3]), im: null }))).not.toBe('refused');
  });

  it('what a source does back never counts', { timeout: HEAVY_TIMEOUT }, () => {
    // A file's own index, recorded by the reader, backs every column it held.
    const backed = sparse([0, 4194305], { ...none(), backedColumns: 4194305 });
    expect(encode(backed)).toBe(streamOf(4194305));
  });
});

describe('one budget for the whole value, shared by every array and container in it', () => {
  it('a cell of 16,384 0x256 arrays is written, and of 16,385 refused, at once', { timeout: HEAVY_TIMEOUT }, () => {
    // 1,024 bytes of index apiece.
    expect(encode(cell(many(16384, () => sparse([0, 256]))))).not.toBe('refused');
    const [refused, ms] = timed(() => encode(cell(many(16385, () => sparse([0, 256])))));
    expect([refused, ms < 3000]).toEqual(['refused', true]);
  });

  it('a cell of 80,000 of them, 82 MB of index, is refused at once', { timeout: HEAVY_TIMEOUT }, () => {
    const [refused, ms] = timed(() => encode(cell(many(80000, () => sparse([0, 256])))));
    expect([refused, ms < 5000]).toEqual(['refused', true]);
  });

  it('nested: two cells of 8,192 inside one are written, 8,192 and 8,193 are not', { timeout: HEAVY_TIMEOUT }, () => {
    const inner = (n: number) => cell(many(n, () => sparse([0, 256])));
    expect(encode(cell([inner(8192), inner(8192)]))).not.toBe('refused');
    expect(encode(cell([inner(8192), inner(8193)]))).toBe('refused');
  });

  it('a cell\'s holes: one declaring 299,594 elements and holding one is written, 299,595 is not', { timeout: HEAVY_TIMEOUT }, () => {
    // 56 bytes a hole: 299,593 of them is 16,777,208 bytes, 299,594 is 16,777,264.
    expect(encode(cell([sparse([0, 0])], [1, 299594]))).not.toBe('refused');
    expect(encode(cell([sparse([0, 0])], [1, 299595]))).toBe('refused');
  });

  it('a cell declaring 1e8 elements around one, which was 1e8 empty doubles, is refused before any is made', () => {
    const [refused, ms] = timed(() => encode(cell([sparse([0, 5])], [1, 1e8])));
    expect([refused, ms < 100]).toEqual(['refused', true]);
  });

  it('a struct array\'s holes the same, field by field', { timeout: HEAVY_TIMEOUT }, () => {
    expect(encode(structArray(299594, [sparse([0, 0])]))).not.toBe('refused');
    expect(encode(structArray(299595, [sparse([0, 0])]))).toBe('refused');
    const [refused, ms] = timed(() => encode(structArray(1e8, [sparse([0, 0])])));
    expect([refused, ms < 100]).toEqual(['refused', true]);
  });

  it('columns and holes come out of the same budget', { timeout: HEAVY_TIMEOUT }, () => {
    // 16,383 arrays of 1,024 bytes, and 18 holes of 56: 16,777,200 bytes. One hole more is
    // 16,777,256.
    const members = many(16383, () => sparse([0, 256]));
    expect(encode(cell(members, [1, 16383 + 18]))).not.toBe('refused');
    expect(encode(cell(members, [1, 16383 + 19]))).toBe('refused');
  });
});

describe('one write: what a writer splits one value into shares the budget', () => {
  it('every encode inside oneWrite draws on one budget; outside it, each has its own', { timeout: HEAVY_TIMEOUT }, () => {
    // 8 MiB of index each: two fit in one write, and then not a byte more.
    const half = () => sparse([0, 2097152]);
    expect(oneWrite(() => [encode(half()), encode(half()), encode(sparse([0, 1]))])).toEqual([
      streamOf(2097152),
      streamOf(2097152),
      'refused',
    ]);
    expect([encode(half()), encode(half()), encode(half())].includes('refused')).toBe(false);
    // Nested, it is the write already under way.
    expect(oneWrite(() => [encode(half()), oneWrite(() => encode(half())), encode(sparse([0, 1]))])[2]).toBe('refused');
  });

  it('an encode that is refused writes nothing, so it takes nothing', { timeout: HEAVY_TIMEOUT }, () => {
    // The refused cell had charged 16,384 arrays' index before the one that did not fit.
    expect(oneWrite(() => [encode(cell(many(16385, () => sparse([0, 256])))), encode(cell(many(16384, () => sparse([0, 256]))))])).toEqual([
      'refused',
      expect.any(Number),
    ]);
  });

  it('spendUnbacked draws on the same budget, and refuses the write when it has not that much left', () => {
    const spend = (bytes: number) => {
      try {
        spendUnbacked(bytes, 'a test\'s zeros');
        return true;
      } catch (e) {
        if (e instanceof MatBudgetError) return 'refused';
        throw e;
      }
    };
    expect(oneWrite(() => [spend(16777216), spend(1)])).toEqual([true, 'refused']);
    expect(oneWrite(() => [spend(16777217), spend(16777216)])).toEqual(['refused', true]);
    expect(oneWrite(() => [spend(8388608), encode(sparse([0, 2097152])), encode(sparse([0, 1]))])).toEqual([true, streamOf(2097152), 'refused']);
  });
});

describe('a refusal for the budget is its own, and says where the budget ran out', () => {
  const refusedWith = (v: MatVariable) => {
    try {
      encodeMatStream(v);
    } catch (e) {
      return e;
    }
    return null;
  };

  it('in a cell, a struct array, a cell\'s holes and one array, in MATLAB\'s spelling', { timeout: HEAVY_TIMEOUT }, () => {
    const cases: [MatVariable, string, string][] = [
      [cell(many(16385, () => sparse([0, 256]))), '{16385}', 'a 0x256 sparse array whose data holds none of its 256 columns'],
      [cell([cell(many(8192, () => sparse([0, 256]))), cell(many(8193, () => sparse([0, 256])))]), '{2}{8193}', 'a 0x256 sparse array whose data holds none of its 256 columns'],
      [structArray(2, [host(4194305), host(3)]), '(2).f', 'a 1x3 sparse array whose data holds 1 of its 3 columns'],
      [cell([sparse([0, 5])], [1, 1e8]), '', 'a 1x100000000 cell holding 1 of its 100000000 elements'],
      [host(4194306), '', 'a 1x4194306 sparse array whose data holds 1 of its 4194306 columns'],
    ];
    for (const [v, at, what] of cases) {
      const e = refusedWith(v) as MatBudgetError;
      expect([e instanceof MatBudgetError, e.at, e.what], at).toEqual([true, at, what]);
    }
  });

  it('while a class this writer has no sparse storage for is refused as before, for its caller to write another way', () => {
    const int8 = { ...host(3), className: 'int8' };
    const e = refusedWith(int8);
    expect([e instanceof MatWriteError, e instanceof MatBudgetError, (e as Error).message]).toEqual([true, false, 'no sparse MAT class for "int8"']);
  });
});

describe('a charge that is not a count is refused, and never turns the budget off', () => {
  // A dims word that is no size — a hand-made [1, "x"], [0, 1e400], a host's [NaN, 1] —
  // made a NaN charge. Compared, NaN is never more than what is left, and taken, it left NaN,
  // which no later charge was ever more than: the budget was off for the rest of the value.
  const holes = (d: unknown[]) => cell([sparse([0, 0])], d as number[]);
  const past = () => many(16385, () => sparse([0, 256]));

  it('each form of a dims word that is no size, alone and ahead of 16,385 0x256 arrays', () => {
    for (const d of [[1, 'x'], [1, {}], [NaN, 1], [0, 1e400], [1, Infinity], [1, -3], [1, 2.5]]) {
      const label = JSON.stringify(d);
      const alone = (() => {
        try {
          encodeMatStream(holes(d));
          return null;
        } catch (e) {
          return e as MatBudgetError;
        }
      })();
      expect([alone instanceof MatBudgetError, alone?.counted], label).toEqual([true, false]);
      // Ahead of a value past the budget, which is refused, not written.
      expect(encode(cell([holes(d), ...past()])), label).toBe('refused');
    }
  });

  it('within a write, the same', { timeout: HEAVY_TIMEOUT }, () => {
    expect(oneWrite(() => [encode(holes([0, 1e400])), encode(cell(past()))])).toEqual(['refused', 'refused']);
  });
});

describe('a count past 2^53 is still a count, over the budget, and never printed rounded', () => {
  const refusedWith = (v: MatVariable) => {
    try {
      encodeMatStream(v);
      return null;
    } catch (e) {
      return e as MatBudgetError;
    }
  };

  it('a cell of 2147483647x2147483647 around one, and a struct array of 2147483647x4194305 with two fields', () => {
    const big = 2147483647;
    const c = refusedWith(cell([sparse([0, 0])], [big, big]));
    const elements = (BigInt(big) * BigInt(big)).toString();
    expect([c?.reason, c?.counted, c?.what]).toEqual(['budget', true, `a ${big}x${big} cell holding 1 of its ${elements} elements`]);
    expect(c?.message).toContain('would write more than 9007199254740991 bytes');
    expect(c?.message).not.toMatch(/e\+/);
    // Three fields of 2147483647x2147483647: 13835058042397261827, which a double prints
    // as 13835058042397262000.
    const s = refusedWith({ name: '', className: 'struct', dimensions: [big, big], isComplex: false, isLogical: false, value: null,
      fields: { f: [sparse([0, 0])], g: [sparse([0, 0])], h: [sparse([0, 0])] } } as MatVariable);
    const fields = (BigInt(big) * BigInt(big) * 3n).toString();
    expect(fields).toBe('13835058042397261827');
    expect([s?.reason, s?.counted, s?.what]).toEqual(['budget', true, `a ${big}x${big} struct array missing some of its ${fields} fields`]);
  });
});

describe('an extent past what a MAT stream\'s int32 dims word can say', () => {
  // A size, which the readers hold as read: MATLAB on 64 bits has zeros(0, 2^31). A MAT
  // stream cannot say it, so an array that has to be one is refused, finally, saying why.
  const refusedWith = (v: MatVariable) => {
    try {
      encodeMatStream(v);
      return null;
    } catch (e) {
      return e as MatBudgetError;
    }
  };
  const full = (d: number[]): MatVariable => ({ name: '', className: 'double', dimensions: d, isComplex: false, isLogical: false, value: [], fields: null });

  it('a full empty, a sparse array and a member of a cell, at 2147483648; at 2147483647 a full empty is written', () => {
    for (const [v, at] of [
      [full([0, 2147483648]), ''],
      [host(2147483648), ''],
      [cell([full([0, 0]), full([2147483648, 0])]), '{2}'],
    ] as const) {
      const e = refusedWith(v as MatVariable);
      expect([e instanceof MatBudgetError, e?.reason, e?.counted, e?.at], at).toEqual([true, 'past-int32', true, at]);
    }
    expect(refusedWith(full([0, 2147483647]))).toBeNull();
  });
});
