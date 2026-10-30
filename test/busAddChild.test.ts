// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/busAddChild.test.ts at 546ba12, ahead of vscode's V4, which
// deletes its structuralEdit (view-split v4-design.md section 3): held to core's copy of addChild,
// the text half (src/edit/structuralEdit.ts, the same signature). Titles and assertions unchanged.
// Setup changed only: a model is a fresh core session over the text (createSession + ingest) instead
// of view's getModel/invalidate, and the entry is found among the session's rows by name instead of
// through view's buildRows/findNode. The fixture is the same bytes (vscode's
// test/parity/artifacts/text/params.sldd).
//
// Regression coverage for "Add Child" on a Bus in a text (JSON) sldd: the new
// BusElement must (1) grow Elements_internal._dimensions to match the element
// count, and (2) carry a unique _id within the entry's id namespace.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { addChild } from '../src/edit/structuralEdit.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// view's getModel(uri, filename, text) after invalidate(uri): a fresh session over `text`.
function getModel(_uri: string, filename: string, text: string): any {
  const bytes = new TextEncoder().encode(text);
  return ingest(createSession(), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { filename });
}
// Every model getModel answers is a fresh one, so there is no cache to drop.
const invalidate = (_uri: string): void => {};
// The first row of that name, section headers aside: what buildRows(model).find(...) then findNode gives.
const rowNamed = (model: any, name: string): any => (model.flatten() as any[]).find((n) => !n.isContainer && n.name === name);

const fixtureText = readFileSync('test/parity/artifacts/text/params.sldd', 'utf8');

function busEntry(uri: string) {
  invalidate(uri);
  const model = getModel(uri, 'params.sldd', fixtureText);
  return rowNamed(model, 'MyBus');
}

// Locate the Simulink.Bus value object in a parsed sldd JSON.
function findBusValue(o: any): any {
  if (o && typeof o === 'object') {
    if (o._array_class === 'Simulink.Bus') return o;
    for (const k of Object.keys(o)) {
      const r = findBusValue(o[k]);
      if (r) return r;
    }
  }
  return null;
}

describe('addChild on a Bus (text sldd)', () => {
  it('grows Elements_internal._dimensions and assigns a unique _id to the new element', () => {
    const uri = 'test://bus-add-child.sldd';
    const bus = busEntry(uri);
    expect(bus.canAddChild()).toBe(true);
    const before = bus.children.length;

    const { newText } = addChild(fixtureText, bus);
    expect(() => JSON.parse(newText)).not.toThrow();

    const busVal = findBusValue(JSON.parse(newText));
    const ei = busVal._elements[0]._properties.Elements_internal;

    // The element array grew by one.
    expect(ei._elements.length).toBe(before + 1);
    // Issue 1: _dimensions must track the element count.
    expect(ei._dimensions).toEqual([before + 1, 1]);

    // Issue 2: every element carries a unique, non-empty _id.
    const ids = ei._elements.map((e: any) => e._id);
    expect(ids.every((id: any) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    // The new element's _id is also distinct from the bus wrapper's _id.
    expect(ids).not.toContain(busVal._elements[0]._id);
  });
});
