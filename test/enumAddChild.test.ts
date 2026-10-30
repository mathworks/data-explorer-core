// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/enumAddChild.test.ts at 546ba12, ahead of vscode's V4, which
// deletes its structuralEdit (view-split v4-design.md section 3): held to core's copy of addChild,
// the text half (src/edit/structuralEdit.ts, the same signature). Titles and assertions unchanged.
// Setup changed only: a model is a fresh core session over the text (createSession + ingest) instead
// of view's getModel/invalidate, and the entry is found among the session's rows by name instead of
// through view's buildRows/findNode. The fixture is the same bytes (vscode's
// test/parity/artifacts/text/params.sldd).
//
// enumTypeNode.test.ts (core #240) holds the same rule on the model: the node's Add Child and its
// serialize(). This holds it on the text an Add Child writes (addChild's splice): the document stays
// JSON, and the written Enumerals array grows, with its _dimensions and a string Value each.
//
// Regression coverage for "Add Child" on an EnumType in a text (JSON) sldd: the
// new enumeral must (1) grow Enumerals._dimensions to match the element count,
// and (2) carry a STRING Value ("3"), never a numeric one (3), to match how
// existing enumerals store their value.
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

function enumEntry(uri: string) {
  invalidate(uri);
  const model = getModel(uri, 'params.sldd', fixtureText);
  return rowNamed(model, 'MyEnum');
}

// Locate the Enumerals struct in a parsed sldd JSON.
function findEnumerals(o: any): any {
  if (o && typeof o === 'object') {
    if (o._array_class === 'Simulink.data.dictionary.EnumTypeDefinition') {
      return o._elements[0]._properties.Enumerals;
    }
    for (const k of Object.keys(o)) {
      const r = findEnumerals(o[k]);
      if (r) return r;
    }
  }
  return null;
}

describe('addChild on an EnumType (text sldd)', () => {
  it('grows Enumerals._dimensions and gives the new enumeral a string Value', () => {
    const uri = 'test://enum-add-child.sldd';
    const en = enumEntry(uri);
    expect(en.canAddChild()).toBe(true);
    const before = en.children.length;

    const { newText } = addChild(fixtureText, en);
    expect(() => JSON.parse(newText)).not.toThrow();

    const enumerals = findEnumerals(JSON.parse(newText));
    // The element array grew by one.
    expect(enumerals._elements.length).toBe(before + 1);
    // Issue 1: _dimensions must track the element count (row vector).
    expect(enumerals._dimensions).toEqual([1, before + 1]);

    // Issue 2: every enumeral Value is a string, including the new one.
    const values = enumerals._elements.map((e: any) => e.Value);
    expect(values.every((v: unknown) => typeof v === 'string')).toBe(true);
  });
});
