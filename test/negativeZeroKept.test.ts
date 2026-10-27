// Copyright 2026 The MathWorks, Inc.
//
// A -0 typed into a Simulink.Parameter's Value, or into a field of its struct Value, beside a
// non-finite number or in a matrix, keeps its sign in every format, as MATLAB keeps it (measured,
// R2027a: [NaN Inf -0] is `NaN Inf -0.0` in a binary dictionary and `[NaN, Inf, -0.0]` in a text
// one, and reads back -0 from both). The typed literal such a value is written from spelled -0 as
// String() does, `0`: a binary dictionary's Parameter [NaN Inf -0] was saved [NaN Inf 0], and so was
// any such row of a text dictionary, a plain variable's included, and a matrix typed as a Parameter's
// Value in every format, a MAT-file's too.
//
// Each edit saved and read back: the element is -0 (by Object.is), in a MAT-file, a text dictionary
// and a binary dictionary of R2027a and of R2023b.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const FILES = [
  'test/fixtures/edit-bash/r2027a/values.mat',
  'test/fixtures/edit-bash/r2027a/values_text.sldd',
  'test/fixtures/edit-bash/r2027a/values_binary.sldd',
  'test/fixtures/edit-bash/r2023b/values_binary.sldd',
];
// [row, typed, the element of the value read back that is -0, by its index in the value's elements].
// The elements of a matrix are held row by row. pProps (Min 0, Max 10) only in a dictionary: a
// MAT-file holds a Value to its bounds (D10), which NaN and Inf are outside.
const EDITS: [string, string, number][] = [
  ['pMatrix', '[NaN Inf -0]', 2],
  ['pStruct.Value.a', '[NaN Inf -0]', 2],
  ['pMatrix', '[NaN -0; 1 2]', 1],
  ['pMatrix', '[1 -0 2]', 1],
  ['pProps', '[NaN Inf -0]', 2],
  ['dRow', '[NaN Inf -0]', 2],
];

function opened(bytes: Uint8Array, filename: string): { session: Any; root: Any } {
  const session = createSession();
  const root: Any = ingest(session, ab(bytes), { filename });
  return { session, root };
}

const rowAt = (root: Any, path: string): Any => (root.flatten() as Any[]).find((n) => n.matlabPath === path && !n.isContainer);
// The numbers a row's value holds: a Parameter's its Value's.
const elementsOf = (row: Any): unknown[] => (row._valueNode ?? row)._elements;

describe('a -0 typed into a value keeps its sign once saved and read back', () => {
  for (const file of FILES) {
    const name = file.split('/').pop()!;
    it(file, () => {
      const bytes = new Uint8Array(readFileSync(file));
      const lost: string[] = [];
      for (const [path, typed, at] of EDITS) {
        if (path === 'pProps' && name.endsWith('.mat')) continue;
        // A finite row is a bare JSON list in a text dictionary, where MATLAB writes a -0 as 0 itself
        // (its own dNegZero is `"value": 0`): the format's limit, accepted.
        if (typed === '[1 -0 2]' && name.endsWith('_text.sldd')) continue;
        const { session, root } = opened(bytes, name);
        const row = rowAt(root, path);
        session.setActive(root, row);
        expect(session.editProperty(row.id, 'Value', typed), `${name} ${path} = ${typed}`).toBe(true);
        expect(Object.is(elementsOf(row)[at], -0), `${name} ${path} = ${typed}, as edited`).toBe(true);
        const out: Any = session.serializeSource(root.name);
        const saved = out.kind === 'text' ? new TextEncoder().encode(out.text) : out.bytes;
        const back = rowAt(opened(saved, name).root, path);
        if (!Object.is(elementsOf(back)[at], -0)) lost.push(`${path} = ${typed}: read back ${String(elementsOf(back)[at])}`);
      }
      expect(lost).toEqual([]);
    });
  }

  it("a text dictionary spells it as MATLAB's own save does", () => {
    const { session, root } = opened(new Uint8Array(readFileSync('test/fixtures/edit-bash/r2027a/values_text.sldd')), 'values_text.sldd');
    const p = rowAt(root, 'pProps');
    session.setActive(root, p);
    expect(session.editProperty(p.id, 'Value', '[NaN Inf -0]')).toBe(true);
    const entries = JSON.parse(session.serializeSource(root.name).text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const value = entries.find((e: Any) => e.name === 'pProps').value._elements[0]._properties.Value;
    expect(value).toEqual({ _type: 'double', _value: '[NaN, Inf, -0.0]' });
  });
});
