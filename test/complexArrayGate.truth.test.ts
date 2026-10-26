// Copyright 2026 The MathWorks, Inc.
//
// The complex-array live gate, held to what core writes now: test/parity/matlab/
// complex_array_gate.truth.json is MATLAB R2027a's reading of each complex array core saved, typed
// as a Value through the session (complex_array_gate.mjs) into a text dictionary, a binary
// dictionary and a MAT-file, an entry's and a Simulink.Parameter's: every one loaded as MATLAB's
// own evaluation of the same literal (isequaln, its class, its size, complex; a Parameter's
// Dimensions and Complexity as `p.Value = v` makes them), with no warning, and the CONTROL, typed
// as one value and compared with another, found to differ (probe_complex_array_gate.m).
//
// Here the same cases are made from the package's source, and each saved value reopens in core as
// what MATLAB read: its class, its size, complex. A change to the cases, or to what core makes of
// them, fails here until MATLAB is asked again.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as core from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { complexArrayGate } from './parity/matlab/complex_array_gate.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEST = fileURLToPath(new URL('.', import.meta.url));
type Row = { file: string; entry: string; literal: string; matlab: string; control: boolean; class: string; isreal: boolean; size: number[]; same: boolean; warning: string };
const TRUTH: { release: string; cases: Row[] } = JSON.parse(readFileSync(TEST + 'parity/matlab/complex_array_gate.truth.json', 'utf8'));

describe("MATLAB's reading of the complex arrays core saved (the complex-array live gate)", () => {
  const made = complexArrayGate(core, ingest, TEST.replace(/\/$/, ''), readFileSync);

  it('read every one as MATLAB makes the literal, with no warning, and caught the control', () => {
    expect(TRUTH.release).toBe('(R2027a)');
    const control = TRUTH.cases.filter((c) => c.control);
    expect(control.length).toBe(3);
    expect(control.every((c) => !c.same)).toBe(true);
    const rest = TRUTH.cases.filter((c) => !c.control);
    expect(rest.length).toBe(30);
    expect(rest.filter((c) => !c.same || c.warning !== '').map((c) => c.file + ' ' + c.entry)).toEqual([]);
  });

  it('asked about the cases core makes now', () => {
    const key = (c: { file: string; entry: string; literal: string; matlab: string; control: boolean }) => [c.file, c.entry, c.literal, c.matlab, c.control].join(' | ');
    expect(TRUTH.cases.map(key)).toEqual(made.cases.map(key));
  });

  it('saves each value as one that reopens as what MATLAB read', () => {
    const reopened = new Map<string, any>();
    for (const [name, content] of Object.entries(made.files)) {
      const input = typeof content === 'string' ? content : (content as Uint8Array).buffer.slice((content as Uint8Array).byteOffset, (content as Uint8Array).byteOffset + (content as Uint8Array).byteLength);
      reopened.set(name, ingest(core.createSession(), input as any, { filename: name }));
    }
    for (const row of TRUTH.cases) {
      const root = reopened.get(row.file);
      const entries = root.constructor.name === 'MatNode' ? root.children : root.children.flatMap((s: any) => s.children);
      const entry = entries.find((e: any) => e.name === row.entry);
      const value = entry._valueNode ?? entry;
      const complex = value._kind === 'cell' ? value.children.some((c: any) => c._isComplexValue()) : value._isComplexValue();
      const cls = value._kind === 'cell' ? 'cell' : complex ? value._complexClass() : value.className;
      expect([cls, !complex, value._dims], `${row.file} ${row.entry}`).toEqual([row.class, row.isreal, ([] as number[]).concat(row.size)]);
    }
  });
});
