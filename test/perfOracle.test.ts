// Copyright 2026 The MathWorks, Inc.
// The oracle's own tests. The oracle is what licenses every fast path in
// docs/deep-work/2026-09-12-core-perf-plan.md, so an oracle that cannot FAIL is
// worse than no oracle -- it would have blessed the MAT scanner at 8/31.
//
// These run without the perf corpus: they check the comparator, not the parsers.

import { describe, it, expect } from 'vitest';
// @ts-expect-error -- .mjs harness module, deliberately untyped and outside src/
import { compareSequences, compareBytes, runCase } from '../perf/oracle.mjs';

describe('compareSequences', () => {
  it('accepts identical sequences', () => {
    const r = compareSequences(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(r.equal).toBe(true);
    expect(r.matched).toBe(3);
    expect(r.total).toBe(3);
    expect(r.divergenceCount).toBe(0);
  });

  it('catches a single wrong element and says where', () => {
    const r = compareSequences(['a', 'b', 'c'], ['a', 'X', 'c']);
    expect(r.equal).toBe(false);
    expect(r.matched).toBe(2);
    expect(r.divergenceCount).toBe(1);
    expect(r.divergences[0]).toEqual({ index: 1, expected: 'b', actual: 'X' });
  });

  it('catches a truncated candidate', () => {
    const r = compareSequences(['a', 'b', 'c'], ['a', 'b']);
    expect(r.equal).toBe(false);
    expect(r.lengthDiffers).toBe(true);
    expect(r.divergences[0]).toEqual({ index: 2, expected: 'c', actual: '<missing>' });
  });

  it('catches a candidate that invented an extra element', () => {
    const r = compareSequences(['a'], ['a', 'b']);
    expect(r.equal).toBe(false);
    expect(r.lengthDiffers).toBe(true);
    expect(r.divergences[0]).toEqual({ index: 1, expected: '<missing>', actual: 'b' });
  });

  // Order matters: consumers index into these lists positionally, so a
  // permutation is a real defect. But it is a DIFFERENT defect from a wrong
  // value, and the report has to distinguish them or the diagnosis is guesswork.
  it('reports a permutation as unequal but flags that the set matched', () => {
    const r = compareSequences(['a', 'b'], ['b', 'a']);
    expect(r.equal).toBe(false);
    expect(r.sameSet).toBe(true);
  });

  it('does not claim sameSet when values genuinely differ', () => {
    const r = compareSequences(['a', 'b'], ['a', 'X']);
    expect(r.equal).toBe(false);
    expect(r.sameSet).toBe(false);
  });

  it('bounds the reported divergences but keeps the true count', () => {
    const expected = Array.from({ length: 100 }, (_, i) => `e${i}`);
    const actual = Array.from({ length: 100 }, (_, i) => `a${i}`);
    const r = compareSequences(expected, actual);
    expect(r.divergenceCount).toBe(100);
    expect(r.divergences).toHaveLength(5);
  });

  it('treats an empty-vs-empty comparison as equal, not as vacuous failure', () => {
    expect(compareSequences([], []).equal).toBe(true);
  });
});

describe('compareBytes', () => {
  it('accepts byte-identical buffers', () => {
    const r = compareBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]));
    expect(r.equal).toBe(true);
    expect(r.matched).toBe(3);
  });

  it('reports the first differing byte', () => {
    const r = compareBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 9, 3]));
    expect(r.equal).toBe(false);
    expect(r.firstDiff).toBe(1);
    expect(r.reason).toContain('byte 1');
  });

  it('reports a length difference without reading past the end', () => {
    const r = compareBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]));
    expect(r.equal).toBe(false);
    expect(r.lengthDiffers).toBe(true);
    expect(r.reason).toContain('length 3 vs 2');
  });

  it('accepts an ArrayBuffer on either side', () => {
    const ab = new Uint8Array([7, 8]).buffer;
    expect(compareBytes(ab, new Uint8Array([7, 8])).equal).toBe(true);
  });
});

describe('runCase', () => {
  const files = ['one', 'two', 'three'];

  it('passes when the candidate agrees on every file', () => {
    const r = runCase({
      name: 'agree',
      files,
      reference: (f: string) => [f, f.length],
      candidate: (f: string) => [f, f.length],
    });
    expect(r.equal).toBe(true);
    expect(r.filesEqual).toBe(3);
    expect(r.filesDiffer).toBe(0);
    expect(r.elementsMatched).toBe(6);
  });

  it('fails on the one file the candidate gets wrong', () => {
    const r = runCase({
      name: 'one-bad',
      files,
      reference: (f: string) => [f],
      candidate: (f: string) => (f === 'two' ? ['WRONG'] : [f]),
    });
    expect(r.equal).toBe(false);
    expect(r.filesEqual).toBe(2);
    expect(r.filesDiffer).toBe(1);
  });

  // A candidate that crashes has not "skipped" anything -- the reference read the
  // file fine, so the candidate is simply broken on it.
  it('counts a throwing candidate as a failure, not a skip', () => {
    const r = runCase({
      name: 'candidate-throws',
      files,
      reference: (f: string) => [f],
      candidate: (f: string) => {
        if (f === 'two') throw new Error('boom');
        return [f];
      },
    });
    expect(r.equal).toBe(false);
    expect(r.filesDiffer).toBe(1);
    expect(r.skipped).toBe(0);
    expect(r.perFile.find((p: { file: string }) => p.file === 'two').reason).toContain('boom');
  });

  // The case that matters most in practice. 9 of 40 `.mat` fixtures are v7.3, where
  // the reference `parseMat` throws. Those files must not be counted as agreement:
  // an oracle that reported 31/31 by folding skips into the pass rate is exactly how
  // a scanner at 18/31 would look finished.
  it('excludes files the reference cannot read from the pass count', () => {
    const r = runCase({
      name: 'reference-refuses',
      files,
      reference: (f: string) => {
        if (f === 'three') throw new Error('version 7.3 (HDF5) is not supported');
        return [f];
      },
      candidate: (f: string) => [f],
    });
    expect(r.equal).toBe(true);
    expect(r.skipped).toBe(1);
    expect(r.filesConsidered).toBe(2);
    expect(r.filesEqual).toBe(2);
    // The skipped file is neither a pass nor a failure.
    expect(r.filesEqual + r.filesDiffer).toBe(2);
  });

  it('is vacuously equal on an empty file list, and says so via filesConsidered', () => {
    const r = runCase({ name: 'empty', files: [], reference: () => [], candidate: () => [] });
    expect(r.equal).toBe(true);
    expect(r.filesConsidered).toBe(0);
  });

  it('honours a custom comparator', () => {
    const r = runCase({
      name: 'bytes',
      files: ['a'],
      reference: () => new Uint8Array([1, 2]),
      candidate: () => new Uint8Array([1, 3]),
      compare: compareBytes,
    });
    expect(r.equal).toBe(false);
  });
});
