// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/stringAddChild.test.ts at 546ba12, ahead of vscode's V4, which
// deletes its structuralEdit (view-split v4-design.md section 3): held to core's copy of addChild,
// the text half (src/edit/structuralEdit.ts, the same signature). Titles and assertions unchanged.
// Setup changed only: a model is a fresh core session over the text (createSession + ingest) instead
// of view's getModel/invalidate, and the entry is found among the session's rows by name instead of
// through view's buildRows/findNode. The fixture is the same bytes: vscode's
// test-integration/fixtures/workspace/data.sldd is core's test/fixtures/numeric_json.sldd.
//
// Adding a child to a string array must append a bare empty string element, not
// wrap it in an inner array: ["abc","de","f"] -> ["abc","de","f",""], never
// ["abc","de","f",[""]].
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

const fixtureText = readFileSync('test/fixtures/numeric_json.sldd', 'utf8');

function entryNode(uri: string, name: string): any {
  invalidate(uri);
  const model = getModel(uri, 'data.sldd', fixtureText);
  return rowNamed(model, name);
}

// Find a String-array value object by its element contents.
function findStringValue(o: any): any {
  if (o && typeof o === 'object') {
    if (o._array_type === 'String' && Array.isArray(o._elements)) return o;
    for (const k of Object.keys(o)) {
      const r = findStringValue(o[k]);
      if (r) return r;
    }
  }
  return null;
}

describe('addChild on a string array (text sldd)', () => {
  it('appends a bare empty string, not a nested array', () => {
    const uri = 'test://string-add-child.sldd';
    const node = entryNode(uri, 'stringArray');
    expect(node.canAddChild()).toBe(true);

    const { newText } = addChild(fixtureText, node);
    expect(() => JSON.parse(newText)).not.toThrow();

    const val = findStringValue(JSON.parse(newText));
    expect(val._elements).toEqual(['abc', 'de', 'f', '']);
    // No element is itself an array.
    expect(val._elements.every((e: unknown) => typeof e === 'string')).toBe(true);
  });
});
