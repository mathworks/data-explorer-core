// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/constantNode.test.ts at c73da3c: its cases that go through the
// JSON text paste (core's copy, src/edit/structuralEdit.ts pasteEntry / pasteEntries). Setup changed
// only: a model is a fresh core session over the text instead of view's getModel/invalidate, and an
// entry is found among its nodes by name instead of through view's buildRows/findNode. Not ported: its
// parseEntry-fork and addEntry cases, which drive no text (core's test/constantNode.test.ts covers
// ConstantNode itself). The fixture is the same bytes: vscode's test/fixtures/arch.sldd is core's.
//
// A Constant is an Architectural Data entry that on disk is byte-identical to a plain (derived) MATLAB
// variable — the distinction is purely metadata.isderived. A derived plain variable pasted in becomes
// a Constant, which must be scalar and numeric; pasted out to Design it is a MATLAB variable again.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession, getSectionMetadata } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { pasteEntry, pasteEntries } from '../src/edit/structuralEdit.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// The design/arch namespace URI, used to seed paste payloads.
const NS_DESIGN = getSectionMetadata('design').namespace;

// The runtime class name (a faithful proxy for the class fork).
const classOf = (n: any): string | undefined => n?.constructor?.name;

const archText = readFileSync('test/fixtures/arch.sldd', 'utf8');
const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

// A fresh core session over `text`, as view's getModel(uri, 'arch.sldd', text) after invalidate(uri).
function getModel(_uri: string, filename: string, text: string): any {
  return ingest(createSession(), ab(new TextEncoder().encode(text)), { filename });
}
function invalidate(_uri: string): void {
  // A fresh session per getModel: nothing is cached to drop.
}
function model(uri: string) {
  invalidate(uri);
  return getModel(uri, 'arch.sldd', archText);
}
function entryNode(_uri: string, m: any, name: string) {
  return (m.flatten() as any[]).find((n) => !n.isContainer && n.name === name);
}
function sectionOf(m: any, name: string) {
  return m.children.find((s: any) => s.name === name);
}

describe('SectionNode.parseEntry forks on isderived (through a paste)', () => {
  it('a NON-derived scalar variable stays a MatlabVariableNode', () => {
    // Paste the arch Constant into design (becomes non-derived), then re-read.
    const uri = 'test://var-fork.sldd';
    const m = model(uri);
    const payload = entryNode(uri, m, 'Constant').serialize() as Record<string, unknown>;
    const design = sectionOf(m, 'design');
    const { newText } = pasteEntry(archText, design, payload);
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', newText);
    const copy = sectionOf(m2, 'design').children[0];
    expect(classOf(copy)).toBe('MatlabVariableNode');
    expect(copy.kind).toBe('MATLAB Variable');
  });

});

describe('Design ↔ Arch Constant conversion round-trip', () => {
  it('Constant → Design becomes an editable MATLAB Variable, then → Arch becomes a Constant again', () => {
    const uri = 'test://const-roundtrip.sldd';
    const m = model(uri);
    const seed = entryNode(uri, m, 'Constant').serialize() as Record<string, unknown>;

    // Into design: non-derived MATLAB Variable.
    const design = sectionOf(m, 'design');
    const { newText: t1 } = pasteEntry(archText, design, seed);
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', t1);
    const designVar = sectionOf(m2, 'design').children[0];
    expect(classOf(designVar)).toBe('MatlabVariableNode');
    expect((designVar.metadata as any).isderived).toBe('0');
    expect(designVar.kind).toBe('MATLAB Variable');

    // Back into arch: a Constant again.
    const arch = sectionOf(m2, 'arch');
    const { newText: t2 } = pasteEntry(t1, arch, designVar.serialize() as Record<string, unknown>);
    invalidate(uri);
    const m3 = getModel(uri, 'arch.sldd', t2);
    const archConst = sectionOf(m3, 'arch').children.find(
      (c: any) => c.className === 'double' && c.name !== 'Constant',
    );
    expect(classOf(archConst)).toBe('ConstantNode');
    expect((archConst.metadata as any).isderived).toBe('1');
    expect(archConst.kind).toBe('Constant');
  });
});

describe('Variable→Constant paste gate (host side)', () => {
  // A design MATLAB variable pasted into arch becomes a Constant, so a
  // non-scalar-numeric value must be rejected — mirroring the drop feedback but
  // enforced on the host so keyboard/menu Paste is gated too.
  function arrayVariablePayload(name = 'Vec'): Record<string, unknown> {
    return {
      name,
      metadata: { uuid: 'seed', namespace: NS_DESIGN, isderived: '0' },
      value: [1, 2, 3],
    };
  }

  it('rejects a non-scalar-numeric variable pasted into arch, with the exact message', () => {
    const uri = 'test://paste-gate.sldd';
    const m = model(uri);
    const arch = sectionOf(m, 'arch');
    expect(() => pasteEntry(archText, arch, arrayVariablePayload())).toThrow(
      /must be scalar and numeric/,
    );
  });

  it('leaves the document byte-identical when the paste is rejected', () => {
    const uri = 'test://paste-gate-identical.sldd';
    const m = model(uri);
    const arch = sectionOf(m, 'arch');
    expect(() => pasteEntry(archText, arch, arrayVariablePayload())).toThrow();
    // The failed paste never produced new text; the source is unchanged.
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', archText);
    expect(sectionOf(m2, 'arch').children.some((c: any) => c.name === 'Vec')).toBe(false);
  });

  it('allows a scalar-numeric variable pasted into arch (becomes a Constant)', () => {
    const uri = 'test://paste-gate-ok.sldd';
    const m = model(uri);
    const arch = sectionOf(m, 'arch');
    const payload = {
      name: 'K',
      metadata: { uuid: 'seed', namespace: NS_DESIGN, isderived: '0' },
      value: 7,
    };
    const { newText } = pasteEntry(archText, arch, payload);
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', newText);
    const pasted = sectionOf(m2, 'arch').children.find((c: any) => c.name === 'K');
    expect(classOf(pasted)).toBe('ConstantNode');
  });

  it('multi-select paste is all-or-nothing: one non-scalar rejects the whole batch', () => {
    const uri = 'test://paste-gate-multi.sldd';
    const m = model(uri);
    const arch = sectionOf(m, 'arch');
    const good = { name: 'Good', metadata: { uuid: 's1', namespace: NS_DESIGN, isderived: '0' }, value: 1 };
    expect(() => pasteEntries(archText, arch, [good, arrayVariablePayload()])).toThrow(
      /must be scalar and numeric/,
    );
  });

  it('the SAME non-scalar variable pastes fine into design (stays a Variable)', () => {
    const uri = 'test://paste-gate-design.sldd';
    const m = model(uri);
    const design = sectionOf(m, 'design');
    const { newText } = pasteEntry(archText, design, arrayVariablePayload());
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', newText);
    const pasted = sectionOf(m2, 'design').children.find((c: any) => c.name === 'Vec');
    expect(classOf(pasted)).toBe('MatlabVariableNode');
  });
});

