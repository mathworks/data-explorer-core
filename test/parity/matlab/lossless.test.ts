// Copyright 2026 The MathWorks, Inc.
//
// An unedited file must serialize back to something that re-parses to the same
// tree. This catches the class of defect where the DISPLAY is right but the write
// path drops or rounds a value — which is how a 64-bit integer and a struct
// array's later elements were both being lost.
//
// Only the two .sldd formats: a .slx and a .mat have no serializer through this
// harness, and serializeModel is defined for 'json' | 'binary' alone.
import { describe, it, expect } from 'vitest';
import { loadArtifact, hasArtifact, type Artifact } from './loadTruth.js';
import { serializeModel, reparseModel } from '../fidelity/roundTripHarness.js';

// Compare the whole display tree, not one value. Name, value and type per row, in
// tree order, so a dropped child or a reordered element shows up as a diff too.
function displayTree(root: any): string[] {
  const out: string[] = [];
  const walk = (n: any, depth: number) => {
    out.push('  '.repeat(depth) + n.displayName + ' = ' + n.displayValue + ' [' + (n.dataType || n.className || '') + ']');
    for (const c of n.children || []) { walk(c, depth + 1); }
  };
  for (const c of root.children || []) { walk(c, 0); }
  return out;
}

for (const fmt of ['sldd-text', 'sldd-binary'] as Artifact[]) {
  describe('lossless round-trip — ' + fmt, () => {
    if (!hasArtifact(fmt)) {
      it.skip('artifact not generated — run gen_truth.m', () => {});
      return;
    }
    const format = fmt === 'sldd-text' ? 'json' as const : 'binary' as const;
    it('re-parses to the same tree after an untouched serialize', () => {
      const before = loadArtifact(fmt);
      const tree = displayTree(before);
      const bytes = serializeModel(before, format);
      const after = reparseModel(bytes, format, 'cases.sldd', 'test://lossless-' + fmt);
      expect(displayTree(after)).toEqual(tree);
    });
  });
}
