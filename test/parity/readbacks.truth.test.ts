// Copyright 2026 The MathWorks, Inc.
//
// What MATLAB read back of core's own saves, for the questions the 2026-10-13 save decisions left
// to a MATLAB check (D8-READBACKS M1, M2 and M3, run for group F on 2026-10-18), held to what core
// writes now.
//
// matlab/save_readbacks.mjs makes the saves through core's API, and names the fragment of each
// that a question is about; matlab/probe_save_readbacks.m had MATLAB R2027a reopen them, and wrote
// each row with what MATLAB read to matlab/save_readbacks.truth.json. This test makes the same
// saves from the package's source and asks that every fragment is still the one MATLAB was asked
// about: a change to what core writes there fails here until MATLAB is asked again (re-run the
// two, as the probe's header says). And it asks that what MATLAB read is what the value was.
//
//   M1  a config set (slConfigSetHDLCoder) regenerated in a binary dictionary and pasted into its
//       text twin reads 10 Components, each element its own class, as MATLAB's own file does
//       (decision D15). Its two files are corpus files, not in this repository: set
//       DEX_READBACKS_CORPUS to the directory holding dNJSON_SLDDApi_opc.sldd and dNJSON_SLDDApi.sldd
//       to re-derive its fragments too; without it they are not, and that is said.
//   M2  enumeration values, a scalar, a 1x3, an object's property, a 0x2 and a 0x0, regenerated in
//       a binary dictionary and pasted into a text one, read back as what they were.
//   M3  an emptied and a new bus read back as an empty Simulink.BusElement array in both
//       dictionaries; and so do the two spellings older core saves gave one, `Class="char"/>` and
//       `Class="double" Dimension="0*0"/>`, so those saves did no damage.
//
// M5, M6 and M8 (number and long-char spellings) are graded where the writers that use them are,
// by test/numbers/ (W1) and W2's battery; the D8 text spelling by test/textEmptyReadback.test.ts;
// F1-9 by test/fieldlessStructReadback.test.ts.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession, ingest } from '../../src/index.js';
import { saveReadbacks } from './matlab/save_readbacks.mjs';
import '../../src/datamodel/node/data/NodeClassMap.js';

type Matlab = {
  class?: string;
  size?: number[];
  enumerals?: string[] | string;
  elements?: { class: string; size: number[] };
  components?: { size: number[]; classes: string[]; DefaultParameterBehavior: string; StopTime: string };
  error?: string;
};
type Case = { check: string; file: string; section: string; entry: string; kind: string; fragment: unknown; control?: string; matlab: Matlab };

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const TRUTH: { version: string; release: string; cases: Case[] } = JSON.parse(readFileSync(at('./matlab/save_readbacks.truth.json'), 'utf8'));
const read = (rel: string) => new Uint8Array(readFileSync(at('../fixtures/' + rel)));
const CORPUS = process.env.DEX_READBACKS_CORPUS;
const corpus = (name: string) => (CORPUS && existsSync(join(CORPUS, name)) ? new Uint8Array(readFileSync(join(CORPUS, name))) : null);
const input = (c: Partial<Case>) => ({ check: c.check, file: c.file, section: c.section, entry: c.entry, kind: c.kind, fragment: c.fragment });
/** MATLAB writes a one-element cell of names as the name alone. */
const names = (m: Matlab) => (m.enumerals === undefined ? undefined : ([] as string[]).concat(m.enumerals));
const rows = (check: string) => TRUTH.cases.filter((c) => c.check === check);

describe("MATLAB's read-back of core's saves (D8-READBACKS M1, M2, M3)", () => {
  it('the truth is MATLAB\'s, and every case was read', () => {
    expect(TRUTH.release).toBe('2027a');
    expect(TRUTH.cases.map((c) => c.check + ' ' + c.file + ' ' + c.entry + ' ' + (c.matlab.error ?? ''))).toEqual(
      TRUTH.cases.map((c) => c.check + ' ' + c.file + ' ' + c.entry + ' '),
    );
    expect(rows('M1').length).toBe(3);
    expect(rows('M2').length).toBe(10);
    expect(rows('M3').length).toBe(8);
  });

  it('core still writes each fragment MATLAB was asked about (M2, M3)', () => {
    const { cases } = saveReadbacks({ createSession, ingest }, read, () => null);
    expect(cases.map(input)).toEqual(TRUTH.cases.filter((c) => c.check !== 'M1').map(input));
  });

  // Skipped, and so reported, without the corpus files.
  it.skipIf(!CORPUS)('and M1, from the corpus files DEX_READBACKS_CORPUS names', () => {
    const { cases } = saveReadbacks({ createSession, ingest }, read, corpus);
    expect(cases.filter((c: Case) => c.check === 'M1').map(input)).toEqual(rows('M1').map(input));
  });

  it('M1: a config set regenerated, and pasted into text, reads its 10 Components as MATLAB\'s own file does', () => {
    const [binary, text, own] = rows('M1');
    expect(own.control).toBeDefined();
    expect(own.matlab.components!.size).toEqual([10, 1]);
    expect(new Set(own.matlab.components!.classes).size).toBe(10);
    expect([binary.matlab, text.matlab]).toEqual([own.matlab, own.matlab]);
  });

  it('M2: an enumeration value regenerated, or pasted into text, reads back as what it was, an empty one included', () => {
    const want: Record<string, [string, number[], string[]]> = {
      gearValue: ['GearMode', [1, 1], ['Reverse']],
      gearRow: ['GearMode', [1, 3], ['Park', 'Drive', 'Reverse']],
      widget: ['GearMode', [1, 1], ['Reverse']],
      e_En2: ['dProbeColors', [0, 2], []],
      e_En0: ['dProbeColors', [0, 0], []],
    };
    const got = Object.fromEntries(rows('M2').map((c) => [c.entry, [c.matlab.class, c.matlab.size, names(c.matlab)]]));
    const expected = Object.fromEntries(Object.entries(want).flatMap(([n, w]) => [[n + 'R', w], [n + 'P', w]]));
    expect(got).toEqual(expected);
  });

  it('M3: an emptied or new bus, and the two spellings older saves wrote, read back as an empty BusElement array', () => {
    for (const c of rows('M3')) {
      expect([c.file, c.entry, c.matlab.class, c.matlab.elements]).toEqual([c.file, c.entry, 'Simulink.Bus', { class: 'Simulink.BusElement', size: [0, 0] }]);
    }
  });
});
