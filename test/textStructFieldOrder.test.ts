// Copyright 2026 The MathWorks, Inc.
//
// A text dictionary's struct keeps the order of its fields as MATLAB reads it: MATLAB writes a
// struct's keys sorted, with `_fields` stating the order where it is not sorted, and reads one with
// no `_fields` with its fields sorted (R2027a: struct('zz', 1, 'b', 2) is written {"b": 2, "zz": 1}
// with `_fields: ["zz", "b"]`, and read back as {zz, b}). StructNode wrote `_fields` only where the
// file had held it, so a field renamed in place (sArr's a to zz_new) or one an Add put at the end
// ({v, field}) was read by MATLAB in sorted order, {b, zz_new}, {field, v}.
//
// Over every struct of every text dictionary fixture: after an Add, and after a rename of its first
// field to a name sorted last, the order MATLAB reads of the saved struct is the order of its rows.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function slddUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...slddUnder(p));
    else if (e.name.endsWith('.sldd')) out.push(p);
  }
  return out.sort();
}

const pathOf = (n: Any): number[] => {
  const p: number[] = [];
  for (let x = n; x && x.parent; x = x.parent) p.unshift(x.parent.children.indexOf(x));
  return p;
};
const nodeAt = (root: Any, path: number[]): Any => path.reduce((n, i) => n?.children?.[i], root);

// The order MATLAB reads the fields of a struct's JSON in: its `_fields`, or its keys sorted.
const matlabOrder = (s: Any): string[] => (Array.isArray(s._fields) ? s._fields : Object.keys(s._elements?.[0] ?? {}).sort());

// The struct's JSON at the struct node `node` stands for, in a saved text dictionary's entry value:
// walked by the node's path from its entry.
function savedStructOf(text: string, node: Any): Any {
  const steps: Any[] = [];
  let entry = node;
  while (entry.parent && !entry.parent.isContainer) {
    steps.unshift(entry);
    entry = entry.parent;
  }
  const json = JSON.parse(text);
  let v = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: Any) => e.name === entry.name).value;
  for (const step of steps) {
    const parent = step.parent;
    if (parent.className === 'Simulink.Parameter') v = v._elements[0]._properties.Value;
    else if (v?._array_type === 'Cell') v = v._elements[parent.children.indexOf(step)];
    else if (v?._array_type === 'Struct') v = step._isElementNode ? { ...v, _elements: [v._elements[parent.children.indexOf(step)]] } : v._elements[0][step.name];
    else return undefined;
  }
  return v;
}

describe("a text dictionary's struct, after a field is added or renamed", () => {
  it('is saved in the order of its rows, as MATLAB reads it', () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const file of slddUnder('test')) {
      const bytes = new Uint8Array(readFileSync(file));
      const name = file.split('/').pop()!;
      let root: Any;
      try {
        root = ingest(createSession(), ab(bytes), { filename: name });
      } catch {
        continue;
      }
      if (root.sourceFormat !== 'json') continue;
      for (const s0 of (root.flatten() as Any[]).filter((n) => n.constructor.name === 'StructNode' && n._isScalarStruct && !n._isElementNode)) {
        for (const op of ['add', 'rename'] as const) {
          const session = createSession();
          const r: Any = ingest(session, ab(bytes), { filename: name });
          const s = nodeAt(r, pathOf(s0));
          const first = s.children[0];
          session.setActive(r, op === 'add' ? s : first);
          const took = op === 'add' ? s.canAddChild() && session.addChildTo(s.id) !== null : !!first?.nameEditable && session.editProperty(first.id, 'Name', 'zz' + first.name) === true;
          if (!took) continue;
          const rows = s.children.map((c: Any) => c.name);
          let saved: Any;
          try {
            saved = savedStructOf((session.serializeSource(r.name) as Any).text, s);
          } catch (e) {
            wrong.push(`${name} ${s.matlabPath} ${op}: save threw ${(e as Error).message}`);
            continue;
          }
          if (!saved) continue;
          checked++;
          if (JSON.stringify(matlabOrder(saved)) !== JSON.stringify(rows)) wrong.push(`${name} ${s.matlabPath} ${op}: MATLAB reads {${matlabOrder(saved)}}, rows {${rows}}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    // Measured when this was written: 102 structs, after an Add or a rename.
    expect(checked).toBeGreaterThanOrEqual(95);
  }, 300_000);

  it('a struct whose fields stay sorted is written as MATLAB writes one, with no `_fields`', () => {
    const file = 'test/fixtures/edit-bash/r2027a/values_text.sldd';
    const session = createSession();
    const root: Any = ingest(session, ab(new Uint8Array(readFileSync(file))), { filename: 'values_text.sldd' });
    const a = (root.flatten() as Any[]).find((n) => n.matlabPath === 'sArr(2).a');
    session.setActive(root, a);
    expect(session.editProperty(a.id, 'Value', '20')).toBe(true);
    const saved = savedStructOf((session.serializeSource(root.name) as Any).text, a.parent.parent);
    expect([saved._fields, Object.keys(saved._elements[0])]).toEqual([undefined, ['a', 'b']]);
  });
});

describe("a text dictionary's struct written anew is keyed in sorted order, as MATLAB keys one", () => {
  // st is struct('sp', sparse(...), 'd', [7 8]) (test/fixtures/sparse/make_sparse_fixtures.m), which
  // MATLAB writes {"d": ..., "sp": ...} with `_fields: ["sp", "d"]`. Keyed in field order, an edit of
  // a sparse element, undone, rewrote it {"sp": ..., "d": ...}: the same value, not the text read.
  const file = 'test/fixtures/sparse/sparse_text.sldd';
  const bytes = new Uint8Array(readFileSync(file));
  const entryValue = (text: string): Any =>
    JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: Any) => e.name === 'st').value;

  it('after an edit of a sparse element in a field, and as read after its undo', () => {
    const session = createSession();
    const root: Any = ingest(session, ab(bytes), { filename: 'sparse_text.sldd' });
    const el = (root.flatten() as Any[]).find((n) => n.matlabPath === 'st.sp(2,1)');
    session.setActive(root, el);
    expect(session.editProperty(el.id, 'Value', '9')).toBe(true);
    const edited = entryValue((session.serializeSource(root.name) as Any).text);
    expect([edited._fields, Object.keys(edited._elements[0])]).toEqual([['sp', 'd'], ['d', 'sp']]);
    session.setActive(root, null);
    session.undo();
    const read = new TextDecoder().decode(bytes);
    expect(JSON.stringify(entryValue((session.serializeSource(root.name) as Any).text))).toBe(JSON.stringify(entryValue(read)));
  });
});
