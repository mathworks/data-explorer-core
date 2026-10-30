// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/dropComplete.test.ts at c73da3c, through core's copy of the JSON
// paste (src/edit/structuralEdit.ts pasteEntries). Setup changed only: a model is a fresh core session
// over the text instead of view's getModel/invalidate, and a payload is the named entry's serialize()
// found among its nodes instead of through view's buildRows/findNode. The fixture is the same bytes:
// vscode's test/fixtures/arch.sldd is core's.
//
// pasteEntries is the drop-completion transform: a drop is exactly a paste of
// the dragged payloads into the target section (a move additionally deletes the
// sources, handled by the host via the existing deleteEntry path). This covers
// the multi-item case a drop introduces — pasting several entries into one text
// in a single edit, each getting a unique name across the growing namespace.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { pasteEntries } from '../src/edit/structuralEdit.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const archText = readFileSync('test/fixtures/arch.sldd', 'utf8');
const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

// A fresh core session over `text`, as view's getModel(uri, 'arch.sldd', text) after invalidate(uri).
function getModel(_uri: string, filename: string, text: string): any {
  return ingest(createSession(), ab(new TextEncoder().encode(text)), { filename });
}
function model(uri: string) {
  return getModel(uri, 'arch.sldd', archText);
}
function payloadOf(_uri: string, m: any, name: string) {
  const row = (m.flatten() as any[]).find((n) => !n.isContainer && n.name === name);
  return row.serialize() as Record<string, unknown>;
}

describe('pasteEntries — multi-item drop completion', () => {
  it('pastes two entries into design, each uniquely named across the namespace', () => {
    const uri = 'test://drop-multi.sldd';
    const m = model(uri);
    const bus = payloadOf(uri, m, 'DataInterface');
    const nt = payloadOf(uri, m, 'NumericType');
    const design = m.children.find((s: any) => s.name === 'design');

    const { newText, selectIds } = pasteEntries(archText, design, [bus, nt]);
    expect(() => JSON.parse(newText)).not.toThrow();
    expect(selectIds).toHaveLength(2);

    const m2 = getModel(uri, 'arch.sldd', newText);
    const designNames = m2.children.find((s: any) => s.name === 'design').children.map((c: any) => c.name);
    expect(designNames).toContain('DataInterface1');
    expect(designNames).toContain('NumericType1');
    // Distinct names — the second paste saw the first already in the namespace.
    expect(new Set(designNames).size).toBe(designNames.length);
  });

  it('rejects the whole drop if any item is disallowed in the target', () => {
    const uri = 'test://drop-reject.sldd';
    const m = model(uri);
    const bus = payloadOf(uri, m, 'DataInterface');
    const svc = payloadOf(uri, m, 'ServiceInterface'); // Simulink.ServiceBus, design-illegal
    const design = m.children.find((s: any) => s.name === 'design');

    expect(() => pasteEntries(archText, design, [bus, svc])).toThrow(/not allowed|ServiceBus/i);
  });

  it('a single-item drop matches pasteEntry (one entry, one select id)', () => {
    const uri = 'test://drop-single.sldd';
    const m = model(uri);
    const bus = payloadOf(uri, m, 'DataInterface');
    const arch = m.children.find((s: any) => s.name === 'arch');

    const { newText, selectIds } = pasteEntries(archText, arch, [bus]);
    expect(selectIds).toHaveLength(1);
    const m2 = getModel(uri, 'arch.sldd', newText);
    const copy = m2.children.find((s: any) => s.name === 'arch').children.find((c: any) => c.name === 'DataInterface1');
    expect(copy).toBeTruthy();
    expect((copy.metadata as any).isderived).toBe('1');
  });
});
