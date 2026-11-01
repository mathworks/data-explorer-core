// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/parity/parity.test.ts at 632f6e0: its PARITY › "Phase 2/3:
// sldd content [text|binary]" blocks and "Phase 2/3: text ≡ binary content equivalence". There each
// params.sldd was opened through data-explorer-view's host registry (getModel, getModelFromBytes);
// here it goes in through `ingest` (loadFile.ts), the entry point a host calls, in a session of its
// own. Every assertion is vscode's, and so is every title. One test is new: the converse of "all
// ground-truth entries are present as nodes", that every entry core reads is one MATLAB stored, so
// that a ground-truth list cut short no longer passes.
//
// The dictionaries are MATLAB's own: test/parity/artifacts/{text,binary}/params.sldd, the same
// bytes as vscode's, written by vscode's test/parity/generate.m, which wrote what MATLAB stored of
// each to ground_truth.json, copied here byte for byte. Its relationships and paramUsage halves
// are for parity checks of files core does not hold (top.slx, signals.mat and the rest).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFile } from './loadFile.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const GT: any = JSON.parse(readFileSync(fileURLToPath(new URL('./ground_truth.json', import.meta.url)), 'utf8'));

const VARIANTS = ['text', 'binary'] as const;

/** Each entry of the variant's params.sldd by name, as core reads the file. */
function entriesOf(variant: string): Map<string, any> {
  const node = loadFile(`./artifacts/${variant}/params.sldd`);
  const byEntry = new Map<string, any>();
  for (const section of node.children ?? []) {
    for (const entry of section.children ?? []) byEntry.set(entry.name, entry);
  }
  return byEntry;
}

function safeRow(n: any): any {
  try {
    return n.toRow();
  } catch {
    return null;
  }
}

describe('PARITY', () => {
  describe.each(VARIANTS)('Phase 2/3: sldd content [%s]', (variant) => {
    const byEntry = entriesOf(variant);

    it('all ground-truth entries are present as nodes', () => {
      const expected: string[] = GT[variant].params.stored;
      const missing = expected.filter((n) => !byEntry.has(n));
      expect(missing).toEqual([]);
    });

    it('every entry core reads is one MATLAB stored', () => {
      const stored: string[] = GT[variant].params.stored;
      expect([...byEntry.keys()].filter((n) => !stored.includes(n))).toEqual([]);
    });

    // ---- primitives (Phase 2) ----
    it('double scalar scalarD = 3.14', () => {
      expect(Number(byEntry.get('scalarD').Value)).toBeCloseTo(3.14, 10);
    });
    it('int32 scalar i32Scalar = 42', () => {
      expect(String(byEntry.get('i32Scalar').displayValue)).toContain('42');
    });
    it('uint8 scalar u8Scalar = 200', () => {
      expect(String(byEntry.get('u8Scalar').displayValue)).toContain('200');
    });
    it('logical scalar boolFlag = true', () => {
      const dv = String(byEntry.get('boolFlag').displayValue);
      expect(dv === 'true' || dv === '1').toBe(true);
    });
    it('char row charStr = hello', () => {
      expect(String(byEntry.get('charStr').displayValue)).toContain('hello');
    });
    it('string scalar strScalar = worldString', () => {
      expect(String(byEntry.get('strScalar').displayValue)).toContain('worldString');
    });
    it('row vector rowVec = [10 20 30 40]', () => {
      const dv = String(byEntry.get('rowVec').displayValue).replace(/[[\],]/g, ' ');
      for (const n of [10, 20, 30, 40]) expect(dv).toContain(String(n));
    });
    it('2x2 matrix mat2x2 preserves 1 2 3 4', () => {
      const dv = String(byEntry.get('mat2x2').displayValue).replace(/[[\];,]/g, ' ');
      for (const n of [1, 2, 3, 4]) expect(dv).toContain(String(n));
    });
    it('string array strArray has 3 elements a bb ccc', () => {
      const n = byEntry.get('strArray');
      const dv = String(n.displayValue);
      for (const s of ['a', 'bb', 'ccc']) expect(dv).toContain(s);
    });
    it('scalar struct myStruct has fields a b c', () => {
      const n = byEntry.get('myStruct');
      const childNames = (n.children ?? []).map((c: any) => c.name);
      expect(childNames).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    });

    // ---- Simulink object types (Phase 3) ----
    it('Simulink.Parameter gravity parses as object node with Value 9.81', () => {
      const n = byEntry.get('gravity');
      expect(n).toBeTruthy();
      // ObjectNode exposes properties; look for 9.81 in a row/property dump.
      const dump = JSON.stringify(safeRow(n)) + JSON.stringify(n.serial ?? {});
      expect(dump).toContain('9.81');
    });

    it.each([
      'gravity', 'pInt16', 'sig1', 'MyBus', 'MyConnBus', 'MyNumType', 'MyAlias',
      'MyValueType', 'MyEnum', 'MyLUT', 'MyBkpt', 'MyVarCtrl', 'MyVarExpr', 'MyVarVar',
    ])('Simulink object %s produces a non-crashing table row', (name) => {
      const n = byEntry.get(name);
      if (!n) {
        // Not stored by MATLAB in this variant — only fail if GT says it was.
        const stored: string[] = GT[variant].params.stored;
        expect(stored).not.toContain(name);
        return;
      }
      const row = safeRow(n);
      expect(row).not.toBeNull();
      expect(row.Name).toBeTruthy();
    });

    it('Simulink typed structure resolves correct className + children', () => {
      expect(byEntry.get('MyAlias').className).toBe('Simulink.AliasType');
      expect(byEntry.get('MyBus').children.map((c: any) => c.name)).toEqual(['x', 'y']);
      expect(byEntry.get('MyConnBus').children.map((c: any) => c.name)).toEqual(['c1']);
      expect(byEntry.get('sig1').className).toBe('Simulink.Signal');
    });
  });

  // TEXT ≡ BINARY equivalence — the same dictionary in both on-disk formats must parse to
  // identical table content.
  describe('Phase 2/3: text ≡ binary content equivalence', () => {
    it('every params.sldd entry has identical dataType + displayValue in both formats', () => {
      const load = (variant: string) => {
        const m = new Map<string, string>();
        for (const e of entriesOf(variant).values()) {
          let dv = '';
          try { dv = String(e.displayValue ?? ''); } catch { dv = 'ERR'; }
          let dt = '';
          try { dt = String(e.className ?? ''); } catch { /* */ }
          const kids = (e.children ?? []).map((c: any) => c.name).join(',');
          m.set(e.name, `${dt}|${dv}|${kids}`);
        }
        return m;
      };
      const t = load('text');
      const b = load('binary');
      expect(Array.from(t.keys()).sort()).toEqual(Array.from(b.keys()).sort());
      const mismatches: string[] = [];
      for (const [name, tv] of t) {
        if (b.get(name) !== tv) mismatches.push(`${name}: text=${tv} binary=${b.get(name)}`);
      }
      expect(mismatches).toEqual([]);
    });
  });
});
