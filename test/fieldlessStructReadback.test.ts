// Copyright 2026 The MathWorks, Inc.
//
// A copy of MATLAB's own repmat(struct(), 1e4, 1e4), pasted into a dictionary, is written as one
// MAT stream, and MATLAB reads that back as the 10000x10000 struct with no field it was (F1-9, run
// for group F on 2026-10-18). MATLAB's own spelling of the array is one element per element, 1e8
// `<Element/>` (2.3 GB of chunk0.xml) or 1e8 `{}` (1.2 GB of text); this package writes a 132-byte
// cdata `_value` into a text dictionary and a 72-byte hex stream into a binary one
// (MatlabVariableNode._unexpandedStruct), as an entry's value, a struct field and a cell's element.
//
// parity/matlab/fieldless_struct_readback.mjs makes the saves through core's API from MATLAB's own
// `save` of the array (fixtures/mcos/fieldless_1e4x1e4.mat), into char_text.sldd, char_binary.sldd,
// sparse_text.sldd and sparse_binary.sldd; parity/matlab/probe_fieldless_struct_readback.m had MATLAB
// R2027a reopen them and wrote what it read to parity/matlab/fieldless_struct_readback.truth.json.
// This test makes the same saves from the package's source and asks that each stream is still the
// one MATLAB read back, so that a change to the spelling fails here until MATLAB is asked again; and
// that this package reads each back as the array it was. test/matStructArray.test.ts pins the
// spelling itself.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8 } from 'fflate';
import { createSession, ingest } from '../src/index.js';
import { fieldlessStructReadback } from './parity/matlab/fieldless_struct_readback.mjs';
import './../src/datamodel/node/data/NodeClassMap.js';

type Case = { file: string; format: string; place: 'entry' | 'field' | 'cell'; entry: string; fragment: string; matlab: { class?: string; size?: number[]; fields?: number; error?: string } };

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const TRUTH: { release: string; cases: Case[] } = JSON.parse(readFileSync(at('./parity/matlab/fieldless_struct_readback.truth.json'), 'utf8'));
const read = (rel: string) => new Uint8Array(readFileSync(at('./fixtures/' + rel)));
const buffer = (b: Uint8Array | string) => {
  const u8 = typeof b === 'string' ? strToU8(b) : b;
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
};

describe("a field-less 1e4x1e4 struct array pasted into a dictionary, as MATLAB reads it back (F1-9)", () => {
  const { files, cases } = fieldlessStructReadback({ createSession, ingest }, read);

  it('MATLAB read every place of every save as the 10000x10000 struct with no field', () => {
    expect(TRUTH.release).toBe('2027a');
    expect(TRUTH.cases.length).toBe(12);
    for (const c of TRUTH.cases) {
      expect(c.matlab, `${c.file} ${c.place}`).toEqual({ class: 'struct', size: [10000, 10000], fields: 0 });
    }
  });

  it('and core still writes the streams MATLAB read', () => {
    const asked = TRUTH.cases.map(({ file, format, place, entry, fragment }) => ({ file, format, place, entry, fragment }));
    expect(cases).toEqual(asked);
    // The stream is the same at every place in a format: 132 bytes of cdata, 72 of hex.
    for (const c of cases) {
      expect(c.fragment, `${c.file} ${c.place}`).toMatch(c.format === 'text' ? /^\{"_type":"cdata","_value":".{100,}"\}$/ : /Class="struct" Encoding="hex" EncodedLength="72">/);
    }
  });

  it('and reads each back as the array it was', () => {
    for (const [file, bytes] of Object.entries(files)) {
      const root: any = ingest(createSession(), buffer(bytes as Uint8Array | string), { filename: file });
      const design = root.getSection('design');
      const entry = (name: string) => design.children.find((e: any) => e.name === name);
      const nodes = [entry('bigPasted'), entry('bigInField').children.find((c: any) => c.name === 'f'), entry('bigInCell').children[0]];
      for (const n of nodes) {
        expect([file, n.className, n.dims, n.displayValue]).toEqual([file, 'struct', [10000, 10000], '<10000x10000 struct>']);
      }
    }
  });
});
