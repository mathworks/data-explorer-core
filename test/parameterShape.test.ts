// Copyright 2026 The MathWorks, Inc.
//
// A Simulink.Parameter's Dimensions and Complexity after an edit of its Value (B-25). MATLAB keeps
// them as the Value's: it refuses a numeric Dimensions other than its size
// (UDDData_CannotSetCustomDimensions) and any Complexity set (UDDData_CannotSetComplexity), and after
// every edit of the Value they are its size and its complexity (measured, R2027a:
// test/parity/matlab/probe_parameter_shape.m, truth parameter_shape.truth.json), except that
//   - a symbolic Dimensions ('[1,N]') is kept;
//   - an empty Value ([]) keeps both as they were: [1+2i 3+4i 5+6i] typed over with [] is still
//     [1 3] and complex;
//   - a struct Value keeps the Complexity it was given: [] and then struct('field', 0) typed over
//     a complex row leaves 'complex';
//   - text is a string scalar: 'abc' and '' are [1 1] and real.
// Core kept the Dimensions and Complexity it read: pRow cut from three elements to two still
// showed and saved [1 3], and [1 2 3 4] typed over it saved [1 3] and complex. The ruling A7
// (2026-10-15) had fixed only the removal that collapses a Value to a scalar.
//
// Each probe row is made here by the edit core's tree makes for it (parameter_shape.steps.json),
// through the session as a host makes it, on the same entry of the same MATLAB-written file.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, ingest } from '../src/index.js';
import '../src/datamodel/node/data/NodeClassMap.js';
import { applyStep, fileBytes as planFileBytes, parameterShapeSaves, PLAN } from './parity/matlab/parameter_shape.mjs';

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
const truth = JSON.parse(readFileSync(here('./parity/matlab/parameter_shape.truth.json'), 'utf8'));
const plan = PLAN as { files: Record<string, any>; rows: Record<string, { file: string; steps: Step[] }>; leftOut: Record<string, string> };

const arrayBuffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const readRel = (rel: string): Uint8Array => new Uint8Array(readFileSync(here('../' + rel)));
const fileBytes = (file: string): ArrayBuffer => arrayBuffer(planFileBytes(file, readRel));

type Step = ['cut', number] | ['add'] | ['element', number, string] | ['typed', string];

function open(file: string, bytes: ArrayBuffer = fileBytes(file)): { session: any; root: any } {
  const session = createSession();
  const root: any = ingest(session, bytes, { filename: file });
  return { session, root };
}

const rowOf = (id: string): any => truth.rows.find((r: any) => r.id === id);
const entryOf = (root: any, name: string): any => root.getSection('design').children.find((e: any) => e.name === name);

/** Make `step` on the entry `name` as a host makes it: through the session, which records its undo. */
const apply = (session: any, root: any, name: string, step: Step): void => applyStep(session, root, name, step);

const cellOf = (cell: unknown): string =>
  cell !== null && typeof cell === 'object' ? String((cell as { text: unknown }).text) : String(cell ?? '');
/** The row's text for a Dimensions MATLAB reports: `[1 4]`, or a symbolic one as it is. */
const dimsText = (dims: unknown): string => (Array.isArray(dims) ? `[${dims.join(' ')}]` : String(dims));

/** The entry's Dimensions and Complexity: what its save writes, and what its rows show. */
function shapeOf(entry: any): { saved: unknown[]; rows: string[] } {
  const props = entry.serializeValue()._elements[0]._properties;
  const row = entry.toRow();
  return { saved: [props.Dimensions, props.Complexity], rows: [cellOf(row.dimensions), cellOf(row.complexity)] };
}

/** What MATLAB's row says the shape is, in the terms of shapeOf. */
const expected = (after: { dimensions: unknown; complexity: string }) => ({
  saved: [after.dimensions, after.complexity],
  rows: [dimsText(after.dimensions), after.complexity],
});

/** The entry `name` in what the session's save of `root` reads back as. */
function reopened(session: any, root: any, name: string): any {
  const bytes: Uint8Array = session.serializeSource(root.name).bytes;
  return entryOf(open(root.name, arrayBuffer(bytes)).root, name);
}

describe('every row of the probe is one core makes, or is left out with its reason', () => {
  it('the steps name each row of the truth once', () => {
    const ids = truth.rows.map((r: any) => r.id).sort();
    expect([...Object.keys(plan.rows), ...Object.keys(plan.leftOut)].sort()).toEqual(ids);
  });
  it('the symbolic Dimensions is spelled as MATLAB spelled it in its own save', () => {
    expect(plan.files['symbolic_dims.sldd'].with).toBe(truth.symbolicDimensionsTag);
  });
});

describe("a Parameter's Dimensions and Complexity after an edit of its Value, as MATLAB keeps them", () => {
  for (const row of truth.rows) {
    const made = plan.rows[row.id];
    if (!made) {
      continue;
    }
    it(`${row.id} (${row.entry}: ${row.edit})`, () => {
      expect(row.ok, row.id).toBe(true);
      const { session, root } = open(made.file);
      const entry = entryOf(root, row.entry);
      // The file as read says what MATLAB read of it: the fixture's own entry, or for
      // symbolic_dims.sldd, which MATLAB saved after symbolic_set, what that row left.
      expect(shapeOf(entry), 'as read').toEqual(expected(made.file === 'symbolic_dims.sldd' ? rowOf('symbolic_set').after : row.before));
      for (const step of made.steps) {
        apply(session, root, row.entry, step);
      }
      expect(shapeOf(entryOf(root, row.entry)), 'after the edit').toEqual(expected(row.after));
      // And the binary save writes it so.
      const back = reopened(session, root, row.entry);
      expect(shapeOf(back).saved, 'reopened').toEqual([row.after.dimensions, row.after.complexity]);
    });
  }
});

describe('undone, an edit of the Value gives back the Dimensions and Complexity as read', () => {
  const asRead = expected(rowOf('add_row').before);

  it('an Add, undone and redone', () => {
    const { session, root } = open('complex_binary.sldd');
    apply(session, root, 'pRow', ['add']);
    expect(shapeOf(entryOf(root, 'pRow'))).toEqual(expected(rowOf('add_row').after));
    session.setActive(root, entryOf(root, 'pRow'));
    session.undo();
    expect(shapeOf(entryOf(root, 'pRow'))).toEqual(asRead);
    session.redo();
    expect(shapeOf(entryOf(root, 'pRow'))).toEqual(expected(rowOf('add_row').after));
  });

  it('a removal, undone and redone', () => {
    const { session, root } = open('complex_binary.sldd');
    apply(session, root, 'pRow', ['cut', 2]);
    expect(shapeOf(entryOf(root, 'pRow'))).toEqual(expected(rowOf('cut_row_to_2').after));
    session.setActive(root, entryOf(root, 'pRow'));
    session.undo();
    expect(shapeOf(entryOf(root, 'pRow'))).toEqual(asRead);
    session.redo();
    expect(shapeOf(entryOf(root, 'pRow'))).toEqual(expected(rowOf('cut_row_to_2').after));
  });

  it('a Value typed in, undone and redone', () => {
    const { session, root } = open('complex_binary.sldd');
    apply(session, root, 'pRow', ['typed', '[1 2 3 4]']);
    expect(shapeOf(entryOf(root, 'pRow'))).toEqual(expected(rowOf('typed_real_row').after));
    session.undo();
    expect(shapeOf(entryOf(root, 'pRow'))).toEqual(asRead);
    expect(entryOf(root, 'pRow').displayValue).toBe('[1+2i 3+4i 5+6i]');
    session.redo();
    expect(shapeOf(entryOf(root, 'pRow'))).toEqual(expected(rowOf('typed_real_row').after));
  });

  it('an empty typed in keeps the shape, and each undo gives back the one before', () => {
    const { session, root } = open('complex_binary.sldd');
    apply(session, root, 'pRow', ['typed', '[]']);
    apply(session, root, 'pRow', ['typed', '[1 2 3 4]']);
    expect(shapeOf(entryOf(root, 'pRow'))).toEqual(expected(rowOf('typed_empty_then_row').after));
    session.undo();
    expect(shapeOf(entryOf(root, 'pRow'))).toEqual(expected(rowOf('typed_empty').after));
    session.undo();
    expect(shapeOf(entryOf(root, 'pRow'))).toEqual(asRead);
  });

  it('elements set to real numbers, undone one by one', () => {
    const { session, root } = open('complex_binary.sldd');
    for (const step of plan.rows.elements_all_real.steps) {
      apply(session, root, 'pRow', step);
    }
    expect(shapeOf(entryOf(root, 'pRow'))).toEqual(expected(rowOf('elements_all_real').after));
    session.undo();
    expect(shapeOf(entryOf(root, 'pRow'))).toEqual(expected(rowOf('element_one_real').after));
    session.undo();
    session.undo();
    expect(shapeOf(entryOf(root, 'pRow'))).toEqual(asRead);
  });

  it('a Value typed over a collapsed one, then both undone', () => {
    const { session, root } = open('complex_binary.sldd');
    apply(session, root, 'pRow', ['cut', 2]);
    apply(session, root, 'pRow', ['cut', 1]);
    expect(shapeOf(entryOf(root, 'pRow'))).toEqual(expected(rowOf('cut_row_to_1').after));
    apply(session, root, 'pRow', ['typed', '[1 2 3 4]']);
    expect(shapeOf(entryOf(root, 'pRow'))).toEqual(expected(rowOf('typed_real_row').after));
    session.undo();
    expect(shapeOf(entryOf(root, 'pRow'))).toEqual(expected(rowOf('cut_row_to_1').after));
    session.setActive(root, entryOf(root, 'pRow'));
    session.undo();
    session.undo();
    expect(shapeOf(entryOf(root, 'pRow'))).toEqual(asRead);
  });
});

describe('a text dictionary\'s Parameter follows its Value too', () => {
  // typed_mcos.sldd's pDoubleRow, [1.1 2.2 3.3]: a real row, which a text dictionary holds as
  // JSON and not as a MAT stream, so it is edited there. The same rule as the binary rows above.
  const textShape = (session: any, root: any) => {
    const saved = session.serializeSource(root.name);
    expect(saved.kind).toBe('text');
    const entries: any[] = JSON.parse(saved.text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const props = entries.find((x) => x.name === 'pDoubleRow').value._elements[0]._properties;
    return [props.Dimensions, props.Complexity];
  };
  const openText = () => {
    const session = createSession();
    const bytes = arrayBuffer(new Uint8Array(readFileSync(here('./fixtures/mcos/typed_mcos.sldd'))));
    const root: any = ingest(session, bytes, { filename: 'typed_mcos.sldd' });
    return { session, root };
  };

  for (const [label, steps, after] of [
    ['cut to two elements', [['cut', 2]], [[1, 2], 'real']],
    ['an element added', [['add']], [[1, 4], 'real']],
    ['a matrix typed in', [['typed', '[1 2; 3 4]']], [[2, 2], 'real']],
    ['a complex scalar typed in', [['typed', '3+4i']], [[1, 1], 'complex']],
    ['an empty typed in', [['typed', '[]']], [[1, 3], 'real']],
  ] as [string, Step[], unknown[]][]) {
    it(`${label}: written so, and undone, as read`, () => {
      const { session, root } = openText();
      expect(shapeOf(entryOf(root, 'pDoubleRow')).saved).toEqual([[1, 3], 'real']);
      const asWritten = textShape(session, root);
      expect(asWritten).toEqual([[1, 3], 'real']);
      for (const step of steps) {
        apply(session, root, 'pDoubleRow', step);
      }
      expect(shapeOf(entryOf(root, 'pDoubleRow')).saved).toEqual(after);
      expect(textShape(session, root)).toEqual(after);
      session.setActive(root, entryOf(root, 'pDoubleRow'));
      for (let k = 0; k < steps.length; k++) {
        session.undo();
      }
      expect(textShape(session, root)).toEqual(asWritten);
    });
  }
});

describe('MATLAB reads each of core\'s saves with the Dimensions and Complexity its own edit leaves', () => {
  const shapeRead = (after: any) => ({ dimensions: after.dimensions, complexity: after.complexity });
  it('there are reads for every row core makes', () => {
    expect(truth.reads.map((q: any) => q.id).sort()).toEqual(Object.keys(plan.rows).sort());
  });
  it('the rows whose read differs are the ones named, with the reason', () => {
    const differ = truth.reads.filter((q: any) => JSON.stringify(shapeRead(q.after)) !== JSON.stringify(shapeRead(rowOf(q.id).after)));
    expect(differ.map((q: any) => q.id).sort()).toEqual(Object.keys((plan as any).readsDiffer).sort());
  });
  // What core writes now for each of them, so that a change to it asks for MATLAB to be asked again.
  const { cases } = parameterShapeSaves({ createSession, ingest }, readRel);
  for (const q of truth.reads) {
    it(`${q.file}: ${q.entry}`, () => {
      expect(q.error, q.file).toBe('');
      if (!(plan as any).readsDiffer[q.id]) {
        expect(shapeRead(q.after), q.file).toEqual(shapeRead(rowOf(q.id).after));
      }
      expect(cases.find((c: any) => c.id === q.id)!.saved, q.file).toEqual([rowOf(q.id).after.dimensions, rowOf(q.id).after.complexity]);
    });
  }
});
