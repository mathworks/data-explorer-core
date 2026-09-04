// Copyright 2026 The MathWorks, Inc.
//
// Phase-0 smoke test: proves the fidelity round-trip harness works end-to-end
// for BOTH sldd formats — edit a Parameter's Min, serialize, re-parse, and (when
// MATLAB is configured via DEX_MATLAB_CMD) assert MATLAB reads back the value we
// set. This validates the harness the per-node fidelity suites build on.
import { describe, it, expect } from 'vitest';
import {
  loadModel,
  entryByName,
  serializeModel,
  reparseEntry,
  matlabAvailable,
  matlabAssertRoundTrip,
  type SlddFormat,
} from './parity/fidelity/roundTripHarness.js';

// This test launches MATLAB when DEX_MATLAB_CMD is set, and a launch is ~20-30s against
// vitest's 5s default — so with MATLAB configured it reported a timeout rather than a
// verdict, which is the one failure mode that tells you nothing about the thing under test.
// 60s and not the 120s writeback.live uses: that file makes two dozen launches and pays a
// cold start on the first, this one makes one per format. Every live `it` in this repo needs
// its own timeout; there is no global one.
const MATLAB_TIMEOUT = 60_000;

for (const format of ['json', 'binary'] as SlddFormat[]) {
  describe(`fidelity harness smoke (${format})`, () => {
    it('edits Parameter.Min and round-trips through serialize/re-parse', { timeout: MATLAB_TIMEOUT }, () => {
      const uri = `test://smoke-${format}.sldd`;
      const model = loadModel(format, 'params.sldd', uri);
      // params.sldd has a Parameter entry — find the first one.
      const rows = model;
      void rows;
      const entry = entryByName(model, uri, 'gravity');
      expect(entry.className).toBe('Simulink.Parameter');

      expect(entry.setProperty('Min', '3')).toBe(true);
      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'gravity');
      expect(fresh.Min).toBe(3);

      // Definitive gate: MATLAB reads the value we set (skipped w/o MATLAB).
      const out = matlabAssertRoundTrip(bytes, 'gravity', { Min: 3, __class__: 'Simulink.Parameter' });
      if (matlabAvailable()) expect(out).toMatch(/RESULT PASS/);
    });
  });
}
