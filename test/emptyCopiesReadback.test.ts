// Copyright 2026 The MathWorks, Inc.
//
// A copy of a struct array of no element with fields, and of a complex empty, pasted into a text
// and a binary dictionary, as MATLAB reads it back: as `load` reads the .mat variable it was
// copied from, its field names and its complexity kept, as an entry's value, a struct field and a
// cell's element, copied as read and once marked edited.
//
// parity/matlab/empty_copies_readback.mjs makes the saves through core's API from MATLAB's own
// variables (fixtures/display/dispcat.mat), into sparse_text.sldd and sparse_binary.sldd;
// parity/matlab/probe_empty_copies_readback.m had MATLAB R2027a reopen them and wrote what it read,
// beside what `load` reads of each variable, to parity/matlab/empty_copies_readback.truth.json.
// This test makes the same saves from the package's source and asks that each value is still
// written as MATLAB read it, so that a change to the spelling fails here until MATLAB is asked
// again. test/emptyNamesAndComplexityCopy.test.ts holds the spellings and the other venues.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, ingest } from '../src/index.js';
import { emptyCopiesReadback, PLACES, VARIABLES } from './parity/matlab/empty_copies_readback.mjs';
import './../src/datamodel/node/data/NodeClassMap.js';

type Shape = { class: string; size: number[]; isreal: boolean; fields: string[] };
type Case = { file: string; format: string; variable: string; edited: boolean; place: string; entry: string; fragment: string; matlab: Shape | { error: string }; loaded: Shape };

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const TRUTH: { version: string; release: string; cases: Case[] } = JSON.parse(readFileSync(at('./parity/matlab/empty_copies_readback.truth.json'), 'utf8'));
const read = (rel: string) => new Uint8Array(readFileSync(at('./fixtures/' + rel)));

describe('a copy of an empty struct with fields, and of a complex empty, pasted into a dictionary, as MATLAB reads it back', () => {
  const { cases } = emptyCopiesReadback({ createSession, ingest }, read);

  it('MATLAB read every place of every save as load reads the variable', () => {
    expect(TRUTH.release).toBe('2027a');
    expect(TRUTH.cases.length).toBe(2 * VARIABLES.length * 2 * PLACES.length);
    for (const c of TRUTH.cases) {
      expect(c.matlab, `${c.file} ${c.entry} ${c.variable} ${c.place}`).toEqual(c.loaded);
    }
    // What load reads: field names for each struct, and complexity for each numeric empty.
    const loaded = new Map(TRUTH.cases.map((c) => [c.variable, c.loaded]));
    expect([...loaded.entries()].map(([v, s]) => [v, s.class, s.size, s.fields, s.class === 'struct' || s.isreal])).toEqual([
      ['dx_struct_0x0_fields', 'struct', [0, 0], ['a'], true],
      ['dx_struct_1x0', 'struct', [1, 0], ['a'], true],
      ['dx_complex_0x0', 'double', [0, 0], [], false],
      ['dx_complex_1x0', 'double', [1, 0], [], false],
      ['dx_complex_int16_1x0', 'int16', [1, 0], [], false],
      ['e_single_complex_1x0', 'single', [1, 0], [], false],
    ]);
  });

  it('and core still writes the values MATLAB read', () => {
    const asked = TRUTH.cases.map(({ file, format, variable, edited, place, entry, fragment }) => ({ file, format, variable, edited, place, entry, fragment }));
    expect(cases).toEqual(asked);
  });
});
