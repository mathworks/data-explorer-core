// Copyright 2026 The MathWorks, Inc.
//
// An empty char written into a binary dictionary is written as MATLAB writes it, at an entry, a
// cell's element and a struct field, and reads back as the shape it is.
//
// Measured against MATLAB R2027a (test/parity/matlab/probe_char_empty_binary.m, which wrote
// test/fixtures/char_empty_binary.sldd): an empty char carries its Dimension at every shape but the
// 0x0, at each of those places: `Class="char" Dimension="1*0"/>`, `"0*2"`, `"2*0"`, `"1*0*2"`, and
// `Class="char"/>` for the 0x0; and each reads back as the shape written. The writer left the
// Dimension off a 1x0 (and a 1x0x2) as it does off a row, so a 1x0 char copied into a binary
// dictionary was saved as the 0x0, and copyRefusal refused the copy for it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { BINARY, sparseFixture } from './tools/pasteVenues.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MATLAB_FILE = new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/char_empty_binary.sldd', import.meta.url))));
const bufferOf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** The empty char element each entry of a binary dictionary's chunk holds, by entry name. */
function emptyCharsOf(bytes: Uint8Array): Map<string, string> {
  const chunk = strFromU8(unzipSync(bytes)['data/chunk0.xml']);
  const out = new Map<string, string>();
  for (const object of chunk.split('<Object Class="DD.ENTRY">').slice(1)) {
    const name = /<P Name="Name" Class="char">([^<]*)<\/P>/.exec(object)![1];
    const value = object.slice(object.indexOf('<P Name="Value"'));
    const char = /<(?:P|Element)[^>]*Class="char"[^>]*\/>/.exec(value);
    if (char) {
      out.set(name, char[0].replace(/^<P Name="(?:Value|f)"/, '<P'));
    }
  }
  return out;
}

const MATLAB_WROTE = emptyCharsOf(MATLAB_FILE);

describe('an empty char written into a binary dictionary', () => {
  it("reads MATLAB's file, every entry the shape MATLAB read back", () => {
    expect(MATLAB_WROTE.size).toBe(15);
    expect([...MATLAB_WROTE.get('c1x0')!.matchAll(/Dimension="([^"]*)"/g)].map((m) => m[1])).toEqual(['1*0']);
    const root: any = ingest(createSession(), bufferOf(MATLAB_FILE), { filename: 'char_empty_binary.sldd' });
    const leaf = (e: any) => (e.name.startsWith('cell_') || e.name.startsWith('field_') ? e.children[0] : e);
    const dims = Object.fromEntries(root.getSection('design').children.map((e: any) => [e.name, leaf(e)._dims]));
    expect([dims.c1x0, dims.cell_c1x0, dims.field_c1x0, dims.c0x2, dims.c2x0, dims.c1x0x2]).toEqual([[1, 0], [1, 0], [1, 0], [0, 2], [2, 0], [1, 0, 2]]);
  });

  it('copied into a binary dictionary, is written as MATLAB writes it, and reads back as the shape it is', () => {
    const source = createSession();
    const from: any = ingest(source, bufferOf(MATLAB_FILE), { filename: 'char_empty_binary.sldd' });
    const session = createSession();
    const into: any = ingest(session, sparseFixture(BINARY), { filename: BINARY });
    const design = into.getSection('design');
    const names: string[] = [];
    from.getSection('design').children.forEach((e: any, i: number) => {
      // As a host copies one: its record, carried as the value it is.
      expect(source.copyRefusal(e.id, 'xml'), e.name).toBeNull();
      const record = structuredClone(e.serialize());
      design.parseEntry({ name: e.name, metadata: { ...record.metadata, uuid: `00000000-0000-4000-c4a1-${String(i).padStart(12, '0')}` }, value: record.value });
      names.push(e.name);
    });
    const saved = (session.serializeSource(into.name) as { bytes: Uint8Array }).bytes;
    const wrote = emptyCharsOf(saved);
    expect(Object.fromEntries(names.map((n) => [n, wrote.get(n)]))).toEqual(Object.fromEntries(names.map((n) => [n, MATLAB_WROTE.get(n)])));
    const again: any = ingest(createSession(), bufferOf(saved), { filename: BINARY });
    const shapeOf = (root: any, n: string) => {
      const e = root.getSection('design').children.find((c: any) => c.name === n);
      return e.serialize().value;
    };
    for (const n of names) {
      expect(shapeOf(again, n), n).toEqual(shapeOf(from, n));
    }
  });
});
