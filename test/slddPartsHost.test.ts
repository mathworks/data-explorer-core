// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/slddParts.test.ts at c73da3c: its two behavioural describes,
// with imports pointing at core (src/index.ts, and the copy src/edit/jsonEntryScan.ts). The binary
// dictionary is core's parity/artifacts/binary/params.sldd, a MATLAB-written one, in place of vscode's
// test/fixtures/compressed.sldd: the assertion holds of any, and every binary fixture in this tree is
// one MATLAB was asked about (test/parity/m9MergedSaves.truth.test.ts). The text dictionaries,
// test/fixtures/object_array_text.sldd and test/parity/artifacts/text/params.sldd, core holds byte for
// byte. Its third describe ("no host
// file keeps its own copy of the part names") is not ported: it pins vscode's own source text, where
// core is the owner of those names. Every assertion ported is vscode's.
//
// The one part a `.sldd` keeps its entries in, named ONCE — by core — and used on the two paths an
// editor that keeps the user's text walks: the save path rebuilds a zip out of the pass-through bag it
// kept plus the one member it replaced, and core has to read that package back as the same
// dictionary; the scanner walks the three keys over RAW TEXT for byte offsets, in an order the scan
// chooses, and has to land on the same entries array core's object walk reaches.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { DATA_PART_XML, parseBinarySldd, readSlddContent, slddChunkContent } from '../src/index.js';
import { findEntriesArrayStart, indexEntries } from '../src/edit/jsonEntryScan.js';

const root = join(import.meta.dirname, '..');
const BINARY = 'test/parity/artifacts/binary/params.sldd';
// Two textual dictionaries, because the scanner runs over whatever a user has open: a
// compact fixture, and a 27 KB one MATLAB itself wrote (tab-indented, R2027a) — the
// whitespace between a key and its `{` is exactly what the walk has to tolerate.
const TEXTUAL = ['test/fixtures/object_array_text.sldd', 'test/parity/artifacts/text/params.sldd'];

const fixture = (p: string) => new Uint8Array(readFileSync(join(root, p)));
const buffer = (p: string) => {
  const u8 = fixture(p);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
};

describe('the save path rebuilds a package core reads back', () => {
  it('puts the entries under the member name core looks up, and drops no other part', () => {
    // The provider's `writeTo`, in the two lines that matter: spread the pass-through parts,
    // put the chunk in under core's name, zip. A host naming it anything else writes a
    // package whose entries core cannot find — and `zipSync` is perfectly happy to produce
    // it, which is why this is asserted by reading the result back rather than by comparing
    // strings.
    const content = parseBinarySldd(buffer(BINARY)) as unknown as {
      __zipMetadata: Record<string, Uint8Array>;
      __rawXml: string;
    };
    const rebuilt = { ...content.__zipMetadata };
    rebuilt[DATA_PART_XML] = new TextEncoder().encode(content.__rawXml);
    const zipped = zipSync(rebuilt, { level: 1 });
    const reread = slddChunkContent(
      readSlddContent(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer),
    );
    expect(Array.isArray(reread?.entries)).toBe(true);
    expect((reread?.entries as unknown[]).length).toBeGreaterThan(0);
    // And the member set is the original one: no part dropped, and no second copy of the
    // chunk left behind under a stale name. This is also what says the exclusion the
    // document made when it built its bag used the same string as the re-insert above.
    expect(Object.keys(unzipSync(zipped)).sort()).toEqual(Object.keys(unzipSync(fixture(BINARY))).sort());
  });
});

describe('the scanner’s raw-text walk reaches what core’s object walk reaches', () => {
  it('finds the entries array, and counts the entries core counts', () => {
    // The scanner never parses, so it needs the strings AND an order to walk them in. Core
    // publishes the three keys and says nothing about the walk, so the order is the scan's —
    // and a wrong one is not an error, it is `-1`, indistinguishable from a file of another
    // shape. The count is what makes the landing site the right one rather than merely a `[`.
    for (const file of TEXTUAL) {
      const text = new TextDecoder().decode(fixture(file));
      const start = findEntriesArrayStart(text);
      expect(start, `${file} must spell the path to its entries`).toBeGreaterThanOrEqual(0);
      expect(text[start], `${file} must land on the array`).toBe('[');

      const byCore = slddChunkContent(readSlddContent(buffer(file)))?.entries as unknown[] | undefined;
      expect(Array.isArray(byCore), `${file} must carry a content part`).toBe(true);
      expect(indexEntries(text)?.elements.length, file).toBe(byCore!.length);
      expect(byCore!.length, `${file} must have entries for this to mean anything`).toBeGreaterThan(0);
    }
  });
});
