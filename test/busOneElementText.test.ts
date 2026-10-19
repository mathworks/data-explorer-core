// Copyright 2026 The MathWorks, Inc.
//
// A bus of one element in a TEXT dictionary (B-24; rulings A4, "a no-op save of the fixtures is
// byte-equal", and D3, "don't rewrite data nobody changed"). MATLAB R2027a writes such a bus's
// Elements_internal as the element itself, `{_id, _object_class, _properties}`, and one of more
// elements as the array, `{_array_class, _dimensions, _elements}`, whose elements carry no
// `_object_class` of the array's class. BaseBusNode rebuilt every Elements_internal as the array,
// so a save that changed nothing changed such a file.
//
// MATLAB's own files (test/fixtures/bus_one_element, made by
// parity/matlab/probe_bus_one_element_text.m): a Simulink.Bus, a Simulink.ConnectionBus and a
// Simulink.ServiceBus of one element each, as saved, and MATLAB's copies of that edited: an
// element added to each (self_added), then removed again (self_added_removed), or the first
// removed instead (self_added_removed_first). Core makes the same edits through its session API
// (parity/matlab/bus_one_element_text.mjs) and its saves are graded against MATLAB's, place by
// place, and against what MATLAB read back of them (bus_one_element_text.truth.json).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession, ingest } from '../src/index.js';
import { busOneElementSaves, elementsInternalOf, ENTRIES } from './parity/matlab/bus_one_element_text.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
const read = (rel: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./fixtures/${rel}`, import.meta.url)));
const matlab = (name: string): string => new TextDecoder().decode(read(`bus_one_element/${name}.sldd`));
const { files, cases } = busOneElementSaves({ createSession, ingest }, read) as {
  files: Record<string, string>;
  cases: { file: string; entry: string; fragment: string }[];
};
const core = (name: string): string => files[`${name}.sldd`];
const valuesOf = (text: string): unknown[] =>
  JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.map((e: any) => e.value);
// JSON text, so that the order of the keys counts, as it does in the file.
const at = (text: string, entry: string): string => JSON.stringify(elementsInternalOf(text, entry));

describe('a bus of one element in a text dictionary', () => {
  it('saved untouched is the file MATLAB wrote, byte for byte', () => {
    expect(core('core_noop')).toBe(matlab('bus_one_element_text'));
  });

  it('is read as the element itself, MATLAB\'s spelling of one', () => {
    for (const entry of ENTRIES) {
      expect(Object.keys(elementsInternalOf(matlab('bus_one_element_text'), entry)), entry).toEqual(['_id', '_object_class', '_properties']);
    }
  });

  it('with an element added and removed again, every value is MATLAB\'s after the same edits', () => {
    expect(JSON.stringify(valuesOf(core('core_added_removed')))).toBe(JSON.stringify(valuesOf(matlab('self_added_removed'))));
  });

  it('with an element added and the add undone, every value is as read', () => {
    expect(JSON.stringify(valuesOf(core('core_added_undone')))).toBe(JSON.stringify(valuesOf(matlab('bus_one_element_text'))));
  });

  it('with an element added, is the array, its element read written as MATLAB writes it there', () => {
    for (const entry of ENTRIES) {
      const ours = elementsInternalOf(core('core_added'), entry);
      const theirs = elementsInternalOf(matlab('self_added'), entry);
      expect(Object.keys(ours), entry).toEqual(Object.keys(theirs));
      expect([ours._array_class, ours._dimensions], entry).toEqual([theirs._array_class, theirs._dimensions]);
      expect(JSON.stringify(ours._elements[0]), entry).toBe(JSON.stringify(theirs._elements[0]));
      // The element core adds holds what core gives a new one, which is not what MATLAB gives it.
      expect(ours._elements[1]._properties.Name, entry).toBe(theirs._elements[1]._properties.Name);
    }
  });

  it('with an element added and the first removed, the one left is in MATLAB\'s spelling of one', () => {
    for (const entry of ENTRIES) {
      const ours = elementsInternalOf(core('core_added_removed_first'), entry);
      const theirs = elementsInternalOf(matlab('self_added_removed_first'), entry);
      expect(Object.keys(ours), entry).toEqual(Object.keys(theirs));
      expect([ours._object_class, ours._properties.Name], entry).toEqual([theirs._object_class, theirs._properties.Name]);
      // MATLAB numbers the elements again on its save; core keeps the _id it gave the element.
      expect([ours._id, theirs._id], entry).toEqual(['3', '2']);
    }
  });

  it('places the session edits as named, so the cases above edit what they say', () => {
    expect(at(core('core_added'), 'OneBus')).not.toBe(at(core('core_noop'), 'OneBus'));
    expect(at(core('core_added_removed_first'), 'OneBus')).not.toBe(at(core('core_noop'), 'OneBus'));
  });
});
// What MATLAB read of its own files and of core's saves (probe_bus_one_element_text.m, READ).
describe('MATLAB reads back core\'s saves (bus_one_element_text.truth.json)', () => {
  const truth = JSON.parse(readFileSync(new URL('./parity/matlab/bus_one_element_text.truth.json', import.meta.url), 'utf8'));
  const rowOf = (file: string, entry: string): any => truth.rows.find((r: any) => r.file === file && r.entry === entry);
  // Each core save, and MATLAB's own file after the same edits.
  const SAME: Record<string, string> = {
    core_noop: 'bus_one_element_text',
    core_added: 'self_added',
    core_added_removed: 'self_added_removed',
    core_added_removed_first: 'self_added_removed_first',
    core_added_undone: 'bus_one_element_text',
  };

  it('was measured on R2027a, of every file and bus', () => {
    expect(truth.release).toBe('2027a');
    expect(truth.rows).toHaveLength((Object.keys(SAME).length + 4) * ENTRIES.length);
  });

  it('MATLAB reads its own files as edited', () => {
    expect(ENTRIES.map((e: string) => rowOf('bus_one_element_text.sldd', e).reads.names)).toEqual([['x'], ['c1'], ['svc']]);
    expect(ENTRIES.map((e: string) => rowOf('self_added.sldd', e).reads.names)).toEqual([['x', 'a'], ['c1', 'a'], ['svc', 'f1']]);
    expect(ENTRIES.map((e: string) => rowOf('self_added_removed.sldd', e).reads.names)).toEqual([['x'], ['c1'], ['svc']]);
    expect(ENTRIES.map((e: string) => rowOf('self_added_removed_first.sldd', e).reads.names)).toEqual([['a'], ['a'], ['f1']]);
  });

  it('reads each core save as it reads its own file after the same edits, with no warning', () => {
    for (const [ours, theirs] of Object.entries(SAME)) {
      for (const entry of ENTRIES) {
        const reads = rowOf(`${ours}.sldd`, entry).reads;
        expect(reads, `${ours} ${entry}`).toEqual(rowOf(`${theirs}.sldd`, entry).reads);
        expect([reads.error, reads.warning], `${ours} ${entry}`).toEqual([undefined, '']);
      }
    }
  });

  it('was asked of what core writes now', () => {
    // A change to any of these spellings asks for MATLAB to be asked again.
    expect(cases).toHaveLength(Object.keys(SAME).length * ENTRIES.length);
    for (const c of cases) {
      expect(c.fragment, `${c.file} ${c.entry}`).toBe(rowOf(c.file, c.entry).fragment);
    }
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
