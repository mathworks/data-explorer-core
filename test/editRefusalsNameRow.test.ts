// Copyright 2026 The MathWorks, Inc.
//
// Every refusal of an edit names its row (editRefusal.editRefusalText): session.editProperty answers
// `Cannot edit "<row>": <reason>.`, or `Cannot rename "<row>": ...` for a Name, wherever the reason
// does not say so already. Most setters said why and not where ("Invalid MATLAB expression", "Array
// elements must be scalar numbers", "'x' already exists in values.mat"), and the sweep of the edits
// a user can make found 6,700 such refusals, in every format.
//
// Over every editable row of the parity fixtures and the stream and sparse ones (MAT-files of
// R2027a and R2023b, text and binary dictionaries), a few texts no row takes typed into its Value,
// its Name and its bounds: each refusal starts `Cannot ` and holds the row's MATLAB path. And a host
// that calls the node's setProperty itself (a dictionary's editor) says it in the same words through
// editRefusalText.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession, editRefusalText } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const FILES = [
  'test/fixtures/edit-bash/r2027a/values.mat',
  'test/fixtures/edit-bash/r2023b/values.mat',
  'test/fixtures/edit-bash/r2027a/handles.mat',
  'test/fixtures/edit-bash/r2027a/values_text.sldd',
  'test/fixtures/edit-bash/r2027a/values_binary.sldd',
  'test/fixtures/sldd-stream-objects/stream_objects_binary.sldd',
  'test/fixtures/sparse/hexobj_binary.sldd',
  'test/fixtures/sparse/sparse_text.sldd',
];
// Texts no row takes: one that reads as no value, bare words, a matrix, a cell; a name that is no
// MATLAB name (and, below, a sibling's); a bound that is no number.
const BAD: Record<string, string[]> = { Value: ['[1 2', 'abc def', '[1 2; 3 4]', '{1, 2}'], Name: ['1bad'], Min: ['abc'], Max: ['[1 2]'] };

function open(bytes: Uint8Array, filename: string): { session: Any; root: Any } {
  const session = createSession();
  const root: Any = ingest(session, ab(bytes), { filename });
  return { session, root };
}

const editable = (cell: unknown): boolean => !!cell && typeof cell === 'object' && (cell as { editable?: boolean }).editable === true;

// The keys a row offers an editor of, and the texts typed into each.
function cases(row: Any): [string, string][] {
  const r = row.toRow?.();
  if (!r) return [];
  const out: [string, string][] = [];
  if (r._valueEditable) out.push(...BAD.Value.map((t) => ['Value', t] as [string, string]));
  if (editable(r.Name)) {
    out.push(...BAD.Name.map((t) => ['Name', t] as [string, string]));
    const sibling = row.parent?.children.find((c: Any) => c !== row && c.name && !/^\d+$/.test(c.name));
    if (sibling) out.push(['Name', sibling.name]);
  }
  for (const key of ['Min', 'Max']) if (editable(r[key])) out.push(...BAD[key].map((t) => [key, t] as [string, string]));
  return out;
}

describe('a refused edit names its row', () => {
  for (const file of FILES) {
    const name = file.split('/').pop()!;
    it(`${file}: every refusal starts "Cannot " and holds the row's path`, () => {
      const bytes = new Uint8Array(readFileSync(file));
      const rows = (open(bytes, name).root.flatten() as Any[]).filter((n) => !n.isContainer && n.id !== undefined);
      const wrong: string[] = [];
      let refused = 0;
      for (const row0 of rows) {
        for (const [key, text] of cases(row0)) {
          const { session, root } = open(bytes, name);
          const row = (root.flatten() as Any[]).find((n) => n.matlabPath === row0.matlabPath && n.id !== undefined && !n.isContainer);
          if (!row) continue;
          session.setActive(root, row);
          const r = session.editProperty(row.id, key, text);
          if (r === true || r === false) continue;
          refused++;
          const reason = String(r.reason);
          if (!reason.startsWith('Cannot ') || !reason.includes(row.matlabPath)) wrong.push(`${row.matlabPath} ${key} = ${text}: ${reason}`);
        }
      }
      expect(wrong).toEqual([]);
      expect(refused).toBeGreaterThan(0);
    }, 300_000);
  }

  it("says it in the same words through editRefusalText for a host that calls the node's setProperty", () => {
    let compared = 0;
    for (const file of ['test/fixtures/edit-bash/r2027a/values_text.sldd', 'test/fixtures/edit-bash/r2027a/values_binary.sldd']) {
      const name = file.split('/').pop()!;
      const bytes = new Uint8Array(readFileSync(file));
      const rows = (open(bytes, name).root.flatten() as Any[]).filter((n) => !n.isContainer && n.id !== undefined);
      for (const row0 of rows) {
        for (const [key, text] of cases(row0)) {
          const viaSession = open(bytes, name);
          const a = (viaSession.root.flatten() as Any[]).find((n) => n.matlabPath === row0.matlabPath && n.id !== undefined && !n.isContainer);
          viaSession.session.setActive(viaSession.root, a);
          const r = viaSession.session.editProperty(a.id, key, text);
          const direct = (open(bytes, name).root.flatten() as Any[]).find((n) => n.matlabPath === row0.matlabPath && n.id !== undefined && !n.isContainer);
          const d = direct.setProperty(key, text);
          if (typeof r !== 'object' || !r || typeof d !== 'object' || !d) continue;
          compared++;
          expect(editRefusalText(direct, key, d.reason), `${name} ${row0.matlabPath} ${key} = ${text}`).toBe(r.reason);
        }
      }
    }
    expect(compared).toBeGreaterThan(500);
  }, 300_000);

  it('keeps a reason that names its row already, and ends the one it words with one full stop', () => {
    const row = { name: 'p', matlabPath: 's.p' };
    expect(editRefusalText(row, 'Value', 'Cannot edit "s": s.p is held as read.')).toBe('Cannot edit "s": s.p is held as read.');
    expect(editRefusalText(row, 'Value', 'Invalid MATLAB expression')).toBe('Cannot edit "s.p": Invalid MATLAB expression.');
    expect(editRefusalText(row, 'Min', 'Minimum must be a finite real double scalar value. ')).toBe('Cannot edit "s.p": Minimum must be a finite real double scalar value.');
    expect(editRefusalText(row, 'Name', "'q' already names another member of s")).toBe('Cannot rename "s.p": \'q\' already names another member of s.');
    expect(editRefusalText({ name: 'x' }, 'Value', 'why?')).toBe('Cannot edit "x": why?');
  });

  it('an element of an array says what it takes and what was typed, quoted on one line and cut short', () => {
    const { session, root } = open(new Uint8Array(readFileSync('test/fixtures/edit-bash/r2027a/values.mat')), 'values.mat');
    const typed = (path: string, text: string) => {
      const el = (root.flatten() as Any[]).find((n) => n.matlabPath === path);
      session.setActive(root, el);
      return session.editProperty(el.id, 'Value', text).reason;
    };
    const number = 'Cannot edit "dRow(2)": an element of the 1x3 double array takes one number, and ';
    expect(typed('dRow(2)', '[1 2; 3 4]')).toBe(number + 'the text typed, “[1 2; 3 4]”, is a 2x2 array.');
    expect(typed('dRow(2)', '[1 2')).toBe(number + 'the text typed, “[1 2”, is no value this editor reads.');
    expect(typed('dRow(2)', '"x"')).toBe(number + 'the text typed, “"x"”, is a string.');
    expect(typed('dRow(2)', '  ')).toBe(number + 'nothing was typed.');
    expect(typed('dRow(2)', 'line1\nline2')).toBe(number + 'the text typed, “line1 line2”, is no value this editor reads.');
    expect(typed('dRow(2)', 'x'.repeat(80))).toBe(number + 'the text typed, “' + 'x'.repeat(59) + '…”, is no value this editor reads.');
    // The array as it is: complex, sparse; and a logical or a string array's element alike.
    expect(typed('zArray(1)', '[1 2]')).toBe('Cannot edit "zArray(1)": an element of the 1x2 complex double array takes one number, and the text typed, “[1 2]”, is a 1x2 array.');
    expect(typed('spMatrix(1,1)', '{1}')).toBe('Cannot edit "spMatrix(1,1)": an element of the 2x2 sparse double array takes one number, and the text typed, “{1}”, is a 1x1 cell array.');
    expect(typed('lArray(1)', '7')).toBe('Cannot edit "lArray(1)": an element of the 1x3 logical array takes true or false, and the text typed, “7”, is a number.');
    expect(typed('strRow(1)', '[1 2]')).toBe('Cannot edit "strRow(1)": an element of the 1x2 string array takes one string, or a char row, and the text typed, “[1 2]”, is a 1x2 array.');
  });

  it("names the row of MATLAB's own words that start \"Cannot \" and name none", () => {
    for (const file of ['test/fixtures/edit-bash/r2027a/values_text.sldd', 'test/fixtures/edit-bash/r2027a/values_binary.sldd']) {
      const name = file.split('/').pop()!;
      for (const path of ['pInt8', 'cHoldsParam{1}', 'sHoldsParam.p']) {
        const { session, root } = open(new Uint8Array(readFileSync(file)), name);
        const p = (root.flatten() as Any[]).find((n) => n.matlabPath === path && n.className === 'Simulink.Parameter');
        session.setActive(root, p);
        expect(session.editProperty(p.id, 'alignment', '8'), name + ' ' + path).toMatchObject({
          error: true,
          reason: `Cannot edit "${path}": Cannot set Alignment when StorageClass is 'Auto'.`,
        });
      }
    }
    expect(editRefusalText({ name: 'p' }, 'storageClass', 'Cannot set Storage Class (target property is absent)')).toBe('Cannot edit "p": Cannot set Storage Class (target property is absent).');
    expect(editRefusalText({ name: 'p' }, 'Value', 'Cannot add a field to "s": s is a 1x2 struct array.')).toBe('Cannot add a field to "s": s is a 1x2 struct array.');
  });
});
