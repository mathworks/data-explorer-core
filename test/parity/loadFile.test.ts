// Copyright 2026 The MathWorks, Inc.
//
// The loader is load-bearing for every parity suite, so it gets its own test:
// a broken loader would make every downstream suite fail for the wrong reason.
import { describe, it, expect } from 'vitest';
import { loadFile, findEntry, flatten } from './loadFile.js';

describe('loadFile', () => {
  it('opens a text .sldd through ingest and finds an entry', () => {
    const root = loadFile('./artifacts/text/params.sldd');
    expect(flatten(root).length).toBeGreaterThan(1);
    expect(findEntry(root, 'MyAlias').name).toBe('MyAlias');
  });

  it('opens the binary .sldd form of the same dictionary', () => {
    const root = loadFile('./artifacts/binary/params.sldd');
    expect(findEntry(root, 'MyAlias').name).toBe('MyAlias');
  });

  it('names the entries it does have when one is missing', () => {
    const root = loadFile('./artifacts/text/params.sldd');
    expect(() => findEntry(root, 'nope')).toThrow(/no entry "nope"; have: .*MyAlias/);
  });
});
