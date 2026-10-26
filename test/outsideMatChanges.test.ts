// Copyright 2026 The MathWorks, Inc.
//
// The two changes Tier B makes outside a MAT-file, pinned:
//   - a Simulink.NumericType decoded of MATLAB's objects (a model workspace, a dictionary value's MAT
//     stream) shows its Signedness, FractionLength and Slope, of the SignednessBool, FixedExponent
//     and SlopeAdjustmentFactor it saves, where it showed them blank; read-only there, as before;
//   - an edit of a row only the Property Inspector shows (a dictionary LookupTable's storage class),
//     undone, is undone: the undo reads the text it had from the inspector's row, where it read none
//     before and set nothing back.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';

const read = (rel: string) => new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/' + rel, import.meta.url))));
const bufferOf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const allNodes = (root: any): any[] => {
  const out: any[] = [];
  const walk = (n: any) => {
    out.push(n);
    (n.children ?? []).forEach(walk);
  };
  walk(root);
  return out;
};
const inspector = (node: any, key: string) => {
  const prop = (node.getPILayout() ?? []).flatMap((g: any) => g.items).find((p: any) => p.key === key);
  return node.getPropInfo(prop);
};

describe('outside a MAT-file', () => {
  it("a model workspace's NumericType shows its Signedness, FractionLength and Slope, read-only", () => {
    const session = createSession();
    const root: any = ingest(session, bufferOf(read('mcos/mcosfix.slx')), { filename: 'mcosfix.slx' });
    const nt = allNodes(root).find((n) => n.className === 'Simulink.NumericType');
    expect(['signedness', 'fractionLength', 'slope'].map((k) => inspector(nt, k).displayValue)).toEqual(['Signed', '0', '1']);
    expect(['signedness', 'fractionLength', 'slope', 'wordLength', 'dataTypeMode'].some((k) => inspector(nt, k).editable)).toBe(false);
  });

  it("a dictionary Parameter's storage class, edited and undone, is as it was, and saved so; a LookupTable's, shown read-only, takes no edit", () => {
    const original = read('mcos/complex.sldd');
    const session = createSession();
    const root: any = ingest(session, bufferOf(original), { filename: 'complex.sldd' });
    const lut = allNodes(root).find((n) => n.className === 'Simulink.LookupTable');
    const before = (session.serializeSource(root.name) as { text: string }).text;
    // Shown in its Property Inspector alone, which offers no editor of it (DataNode._offerRefusal).
    session.setActive(root, lut);
    expect(session.editProperty(lut.id, 'storageClass', 'ExportedGlobal')).toMatchObject({ error: true });
    expect([inspector(lut, 'storageClass').displayValue, session.canUndo()]).toEqual(['Auto', false]);
    const p = allNodes(root).find((n) => n.name === 'pScalar');
    session.setActive(root, p);
    expect(session.editProperty(p.id, 'storageClass', 'ExportedGlobal')).toBe(true);
    expect(inspector(p, 'storageClass').displayValue).toBe('ExportedGlobal');
    session.undo();
    expect(inspector(p, 'storageClass').displayValue).toBe('Auto');
    // But the entry's modified time, which every edit stamps and its undo does not take back.
    const stamped = (text: string) => text.replace(/"lastmod": "\d{8}T\d{6}\.\d+"/g, '"lastmod": ""');
    const after = (session.serializeSource(root.name) as { text: string }).text;
    expect(stamped(after)).toBe(stamped(before));
  });
});
