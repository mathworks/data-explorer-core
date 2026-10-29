// Copyright 2026 The MathWorks, Inc.
//
// The version a folder scan keys its cache on, decided from a `stat`.
//
// The token's SPELLING is the contract, not just its equality: a host's caches store it
// and compare it as a string, and the vscode host keyed on `${mtime}:${size}` before this
// moved here — so a token that changed shape (rounded the mtime, swapped the order) would
// make every cached entry look stale once, or, worse, make two caches in one host
// disagree about the same file. The cases below pin the spelling exactly.
import { describe, it, expect } from 'vitest';
import { MAX_SCAN_BYTES, scanVersionOf } from '../src/index.js';

describe('scanVersionOf', () => {
  it('spells the version mtime, a colon, then size', () => {
    expect(scanVersionOf({ mtime: 1730000000000, size: 2048 })).toBe('1730000000000:2048');
    expect(scanVersionOf({ mtime: 0, size: 0 })).toBe('0:0');
  });

  it('keeps the mtime exactly as the host reported it, fractions included', () => {
    // Node's `mtimeMs` carries a fraction where VS Code's `FileStat.mtime` is whole
    // milliseconds. Either way the token is the number as given: rounding here would
    // fold two writes inside one millisecond into one version, and a host that
    // reported fractions would see its tokens change shape for no reason.
    expect(scanVersionOf({ mtime: 1730000000123.456, size: 10 })).toBe('1730000000123.456:10');
  });

  it('moves when either the mtime or the size moves', () => {
    const base = scanVersionOf({ mtime: 1000, size: 50 });
    expect(scanVersionOf({ mtime: 1001, size: 50 })).not.toBe(base);
    expect(scanVersionOf({ mtime: 1000, size: 51 })).not.toBe(base);
    // And it does NOT move across a write that keeps both — the documented gap, which
    // is a host's watcher to cover, not a finer token.
    expect(scanVersionOf({ mtime: 1000, size: 50 })).toBe(base);
  });

  it('is null past the scan cap, and a version at it', () => {
    // `size > cap`, not `>=`: a file of exactly MAX_SCAN_BYTES is still a string V8 can
    // hold, so a scan can still read it.
    expect(scanVersionOf({ mtime: 5, size: MAX_SCAN_BYTES })).toBe(`5:${MAX_SCAN_BYTES}`);
    expect(scanVersionOf({ mtime: 5, size: MAX_SCAN_BYTES + 1 })).toBeNull();
    expect(scanVersionOf({ mtime: 5, size: Number.MAX_SAFE_INTEGER })).toBeNull();
  });

  it('takes a host’s own stat object as it comes', () => {
    // A VS Code `FileStat` or a Node `Stats` carries more than these two fields; a host
    // passes it straight through rather than copying out the two this reads.
    const stat = { type: 1, ctime: 1, mtime: 42, size: 7, permissions: undefined };
    expect(scanVersionOf(stat)).toBe('42:7');
  });
});

describe('MAX_SCAN_BYTES', () => {
  it('is V8’s maximum string length', () => {
    expect(MAX_SCAN_BYTES).toBe(0x1fffffe8);
    // The claim the cap rests on, checked against the engine running this test: one
    // character past it cannot be a string at all. `repeat` checks the length before it
    // allocates, so this costs nothing.
    expect(() => 'x'.repeat(MAX_SCAN_BYTES + 1)).toThrow(RangeError);
  });
});
