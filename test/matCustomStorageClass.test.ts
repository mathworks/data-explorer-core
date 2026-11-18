// Copyright 2026 The MathWorks, Inc.
//
// In a MAT-file, an object whose storage class is a custom one (ExportToFile, GetSet) offers no
// editor of its CoderInfo's StorageClass, Identifier or Alignment: the rules change nothing of such
// a CoderInfo, no edit under one having been measured (McosPropertyRules' coderInfo), so its
// Storage Class was a dropdown every choice of which was refused. The cells are read-only now, and
// an edit says why, naming the property. An object under a built-in storage class still offers its
// Storage Class. Over MATLAB R2027a's objects (fixtures/definition-file/make_definition_file.m).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const MAT = fileURLToPath(new URL('./fixtures/definition-file/r2027a/definition_file.mat', import.meta.url));

function opened() {
  const session = createSession();
  const b = new Uint8Array(readFileSync(MAT));
  const root: Any = ingest(session, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, { filename: 'definition_file.mat' });
  const node = (name: string): Any => (root.flatten() as Any[]).find((n) => n.name === name && !n.isContainer);
  const editable = (n: Any, key: string): boolean => {
    const prop = [...n.getProperties(), ...(n.getPILayout() ?? []).flatMap((g: Any) => g.items)].find((p: Any) => p.key === key);
    return n.getPropInfo(prop).editable;
  };
  return { session, root, node, editable };
}

describe("a MAT-file's object with a custom storage class", () => {
  it('shows its Storage Class, Identifier and Alignment read-only', () => {
    const { node, editable } = opened();
    for (const name of ['pExport', 'sExport', 'pGetSet']) {
      const n = node(name);
      expect(n.toRow().storageClass, name).toBe('Custom');
      expect(['storageClass', 'identifier', 'alignment'].map((k) => editable(n, k)), name).toEqual([false, false, false]);
    }
  });

  it('refuses an edit of each, saying why, and marks nothing', () => {
    const { session, root, node } = opened();
    for (const [key, property, text] of [['storageClass', 'StorageClass', 'ExportedGlobal'], ['identifier', 'Identifier', 'p_id'], ['alignment', 'Alignment', '8']]) {
      for (const name of ['pExport', 'sExport', 'pGetSet']) {
        const n = node(name);
        session.setActive(root, n);
        const r: Any = session.editProperty(n.id, key, text);
        expect(r?.reason, name + ' ' + key).toBe(
          `Cannot edit "${name}": ${name}.CoderInfo.${property} cannot change while the object has a custom storage class, no edit under which was measured.`,
        );
      }
    }
    expect(root.dirty).toBeFalsy();
  });

  it('leaves an object under a built-in storage class its Storage Class editor', () => {
    const { session, root, node, editable } = opened();
    const n = node('pAuto');
    expect(n.toRow().storageClass).toMatchObject({ text: 'Auto', editable: true, editor: 'select' });
    expect(editable(n, 'storageClass')).toBe(true);
    session.setActive(root, n);
    expect(session.editProperty(n.id, 'storageClass', 'ExportedGlobal')).toBe(true);
  });
});
