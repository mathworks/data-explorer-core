// Copyright 2026 The MathWorks, Inc.
//
// session.isUnchangedEdit(nodeId, key, text): whether an edit would change nothing by core's own
// rule, the text a property shows committed unchanged (DataModel.editProperty's no-op). A
// dictionary's editor in the extension calls a node's setter itself, not editProperty, so it had no
// way to ask core's verdict before it marked and rewrote an entry. It agrees with editProperty's
// own answer for every editable property of every row of the edit-bash fixtures, and changes nothing.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));

function opened(file: string) {
  const session = createSession();
  const bytes = new Uint8Array(readFileSync(join(TEST_ROOT, 'fixtures/edit-bash', file)));
  const root: any = ingest(session, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { filename: file.split('/').pop()! });
  const save = (): Uint8Array => {
    const out: any = session.serializeSource(root.name);
    return out.bytes ?? new TextEncoder().encode(out.text);
  };
  return { session, root, save };
}

// The editable properties of a row, each with the text it shows.
function editable(node: any): [string, string][] {
  const out: [string, string][] = [];
  for (const prop of [...node.getProperties(), ...(node.getPILayout() ?? []).flatMap((g: any) => g.items)]) {
    const info = node.getPropInfo(prop);
    if (info.editable && typeof info.displayValue === 'string' && !out.some(([k]) => k === prop.key)) out.push([prop.key, info.displayValue]);
  }
  return out;
}

describe('isUnchangedEdit, for every editable property of every row of the edit-bash fixtures', () => {
  for (const file of ['r2027a/values.mat', 'r2027a/values_text.sldd', 'r2027a/values_binary.sldd', 'r2023b/values.mat', 'r2023b/values_binary.sldd']) {
    it(`${file}: true of the shown text, as editProperty takes it as no edit; false of another; changes nothing`, () => {
      const { session, root, save } = opened(file);
      const read = save();
      let asked = 0;
      const wrong: string[] = [];
      for (const node of root.flatten().filter((n: any) => !n.isContainer)) {
        for (const [key, shown] of editable(node)) {
          asked++;
          const label = node.matlabPath + ' ' + key;
          if (session.isUnchangedEdit(node.id, key, shown) !== true) wrong.push(label + ': the shown text is no edit, and it said not');
          if (session.isUnchangedEdit(node.id, key, shown + ' x') !== false) wrong.push(label + ': another text is an edit, and it said none');
          session.setActive(root, node);
          if (session.editProperty(node.id, key, shown) !== true || session.canUndo()) wrong.push(label + ': editProperty made an edit of the shown text');
        }
      }
      expect(wrong).toEqual([]);
      expect(asked).toBeGreaterThan(100);
      // Nothing changed: no step to undo, the file as read.
      session.setActive(root, null);
      expect([session.canUndo(), root.dirty === true, Buffer.from(save()).equals(Buffer.from(read))]).toEqual([false, false, true]);
    });
  }

  it('is false where no row of that id is open, and for a key the row does not show', () => {
    const { session, root } = opened('r2027a/values.mat');
    expect(session.isUnchangedEdit('nowhere/x', 'Value', '1')).toBe(false);
    const node = root.flatten().find((n: any) => n.matlabPath === 'dScalar');
    expect(session.isUnchangedEdit(node.id, 'NoSuchKey', '')).toBe(false);
    expect(session.isUnchangedEdit(node.id, 'Value', node.displayValue)).toBe(true);
  });
});
