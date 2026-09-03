// Copyright 2026 The MathWorks, Inc.
//
// Every value in the MATLAB-authored corpus, in every format that can hold it,
// displayed as the convention says MATLAB displays it. This is the suite that
// makes the next display defect fail a test instead of reaching a user.
//
// The expectation comes from expect.ts, which reads only what MATLAB reported.
// Nothing in this file may compute an expectation from the data model — that is
// the one failure mode a parity suite cannot see from the inside.
import { describe, it, expect } from 'vitest';
import {
  truth, loadArtifact, hasArtifact, entry, verdict, refused, ARTIFACT_KINDS,
  type Artifact, type VarTruth,
} from './loadTruth.js';
import { expectedDisplay, literalMatches, isObjectArray } from './expect.js';

const T = truth();

/**
 * Entries and object arrays together. An object array lives only in the `.mat`;
 * both dictionary formats and the .slx model workspace refuse it, and `refused`
 * skips it there off MATLAB's own message.
 */
const ALL: Record<string, VarTruth> = { ...T.vars, ...T.objArr };

/** Why MATLAB offers no one-line spelling, for the skip title. */
function noLiteralBecause(v: VarTruth): string {
  if (v.class === 'cell') { return 'mat2str refuses a cell'; }
  if (v.isobject) { return 'mat2str refuses class ' + v.class; }
  return 'mat2str: ' + (v.mat2str_error || 'no literal recorded');
}

for (const fmt of ARTIFACT_KINDS) {
  describe('display parity — ' + fmt, () => {
    if (!hasArtifact(fmt)) {
      it.skip('artifact not generated — run gen_truth.m', () => {});
      return;
    }
    const root = loadArtifact(fmt);

    for (const [name, v] of Object.entries(ALL)) {
      // A value the format cannot hold is not a parity failure — but the skip has
      // to be justified by MATLAB's own rejection message, not by our convenience.
      if (refused(T, fmt as Artifact, name)) {
        it.skip(name + ' — MATLAB refused: ' + verdict(T, fmt as Artifact, name), () => {});
        continue;
      }

      const want = expectedDisplay(v);
      if (want === null) {
        // No MATLAB spelling to compare against, so this asserts only that a cell
        // exists. Titled so the suite REPORTS the gap instead of hiding it behind
        // an assertion that can never fail: the value itself is checked where
        // MATLAB does have something to say — structure.test.ts for the elements
        // of a cell, schemaProps.test.ts for the properties of an object.
        it(name + ' has no MATLAB one-line spelling (' + noLiteralBecause(v) + ')', () => {
          const node = entry(root, name);
          expect(typeof node.displayValue).toBe('string');
          expect((node.displayValue as string).length).toBeGreaterThan(0);
        });
      } else {
        it(name + ' displays as MATLAB does', () => {
          const node = entry(root, name);
          // literalMatches, not toBe: the ONE documented deviation is a float's
          // digit count (MATLAB prints 15 significant digits, we print the shortest
          // round-trip spelling). Structure and every non-float class stay exact.
          expect(
            literalMatches(node.displayValue, v),
            name + ': MATLAB ' + JSON.stringify(want) + ', model ' + JSON.stringify(node.displayValue),
          ).toBe(true);
        });
      }

      it(name + ' reports the class MATLAB reports', () => {
        const node = entry(root, name);
        if (v.isobject && v.class !== 'string') {
          // An object has no data type of its own — aParam's dataType is its
          // UNDERLYING int16, and the class lives on className. Measured across all
          // four channels: aParam dataType 'int16' / className 'Simulink.Parameter';
          // aSignal, aBus, aLookup, aVariant dataType '' / className the class.
          expect(node.className).toBe(v.class);
        } else {
          expect(node.dataType).toBe(v.class);
        }
      });

      // An object array's shape is the only thing its cell can carry, so pin it
      // separately: <2x3x2 Simulink.Parameter> and <2x3 Simulink.Parameter> differ
      // by a page, and that page went missing three times in Phase 8.
      if (isObjectArray(v)) {
        it(name + ' carries its full rank in the summary', () => {
          const node = entry(root, name);
          expect(node.displayValue).toBe(want);
        });
      }
    }
  });
}
