// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/textDictionaryNumbers.test.ts at c73da3c: reserializeEntry is
// core's copy (src/edit/structuralEdit.ts), the dictionary is opened in a session of its own
// (createSession().addDataSource) where vscode used the global DataModel and removed the source after
// each test, and the fixture is core's test/parity/artifacts/text/params.sldd, byte for byte vscode's
// test-integration/fixtures/workspace/params.sldd. Every assertion is vscode's.
//
// The JSON dictionary editor writes an entry's numbers as MATLAB writes them in a text dictionary
// (structuralEdit.recordText, through core's textDictionaryJson, which core's save uses too).
// JSON.stringify wrote a double with no fraction as an integer literal: 2^64 - 1 as
// 18446744073709552000 and -2^63 as -9223372036854776000, past what a 64-bit integer holds, and
// MATLAB R2027a could not open the dictionary. MATLAB writes such a double with a fraction of zero
// from a million up, and an exponent with no plus sign; a dimension is a count, written bare.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSession } from '../src/index.js';
import { reserializeEntry } from '../src/edit/structuralEdit.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const srcId = 'textDictionaryNumbers.sldd';

/** `gravity` of the workspace's params.sldd (a Simulink.Parameter of a double), its Value set to `text`. */
function gravityWith(text: string): any {
  const json = readFileSync(join(import.meta.dirname, 'parity', 'artifacts', 'text', 'params.sldd'), 'utf8');
  const dict: any = createSession().addDataSource(srcId, JSON.parse(json), { path: 'params.sldd' });
  const gravity = (dict.children as any[]).flatMap((s) => s.children ?? []).find((e) => e.name === 'gravity');
  expect(gravity.setProperty('Value', text)).toBe(true);
  return gravity;
}

describe("the JSON editor's entry text", () => {
  for (const [typed, written] of [
    ['18446744073709551615', '18446744073709552000.0'],
    ['-9223372036854775808', '-9223372036854776000.0'],
    ['1000000', '1000000.0'],
    ['1e300', '1e300'],
  ]) {
    it(`writes a double typed as ${typed} as ${written}, as MATLAB does`, () => {
      const text = reserializeEntry(gravityWith(typed), '\t');
      expect(text).toContain(written);
      expect(text).not.toMatch(/\d{19,}(?![\d.])/);
      expect(text).not.toContain('e+');
    });
  }

  it('writes a double under a million, and a dimension, bare', () => {
    const text = reserializeEntry(gravityWith('999999'), '\t');
    expect(text).toMatch(/\b999999(?![\d.])/);
    expect(text).not.toContain('999999.0');
    expect(text).not.toMatch(/"_dimensions": \[\s*1\.0/);
  });
});
