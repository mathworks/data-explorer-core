// Copyright 2026 The MathWorks, Inc.
//
// A missing string (<missing>) is refused by a paste into a dictionary, in either format and at any
// depth: MATLAB does not save one in a dictionary ("<missing> string element not supported", R2027a,
// at an entry, in a cell and in a struct), so there is no copy of it MATLAB would make. A MAT-file
// holds one, and core's paste wrote it, as "" (the binary writer) or as a null element MATLAB reads
// as "" (the text one): the value was lost without a word (open-questions 14, group A). Each
// refusal names the entry, where in the value the missing string is, and why; copyRefusal with a
// dictionary target, the deep pasteRefusal and pasteEntries all say it, and nothing is pasted.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';

type Any = any;

const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const DIR = 'test/fixtures/edit-bash/r2027a/';
const TARGETS = [['values_text.sldd', 'json', 'a text dictionary'], ['values_binary.sldd', 'xml', 'a binary dictionary']] as const;

function opened(file: string) {
  const session: Any = createSession();
  const root: Any = ingest(session, ab(new Uint8Array(readFileSync(DIR + file))), { filename: file });
  const bytesOf = (): Buffer => {
    const out: Any = session.serializeSource(root.name);
    return Buffer.from(out.kind === 'text' ? out.text : out.bytes);
  };
  return { session, root, bytesOf, design: root.children?.find((s: Any) => s.name === 'design') };
}

const why = (at: string) => at + ' is a missing string (<missing>), which MATLAB does not save in a dictionary';
const missing = { _array_type: 'String', _dimensions: [1, 1], _elements: [null], _mw_element_type: 'MATLABArray' };
const str = (dims: number[], elements: (string | null)[]) => ({ _array_type: 'String', _dimensions: dims, _elements: elements, _mw_element_type: 'MATLABArray' });
const cell = (dims: number[], elements: unknown[]) => ({ _array_type: 'Cell', _dimensions: dims, _elements: elements, _mw_element_type: 'MATLABArray' });
const struct = (dims: number[], elements: Record<string, unknown>[]) => ({ _array_type: 'Struct', _dimensions: dims, _elements: elements, _fields: Object.keys(elements[0] ?? {}), _mw_element_type: 'MATLABArray' });

// Each refuses the paste of `payload` into `target`, in the writer's words, and pastes nothing.
function refusesPaste(target: (typeof TARGETS)[number], payload: Any, at: string): void {
  const d = opened(target[0]);
  const before = d.bytesOf();
  const held = d.design.children.length;
  const said = 'Cannot write "' + payload.name + '": ' + why(at) + '. Nothing was written.';
  expect(d.session.pasteRefusal(d.design.id, payload, { deep: true })).toBe(said);
  d.session.setActive(d.root, d.design);
  expect(d.session.pasteEntries(d.design.id, [payload])).toMatchObject({ error: true, reason: said });
  expect(d.design.children.length).toBe(held);
  expect(d.root.dirty).toBeFalsy();
  expect(d.bytesOf().equals(before)).toBe(true);
}

describe.each(TARGETS)('a missing string pasted into %s', (...target) => {
  it.each([
    ['strMissing', 'strMissing'],
    ['strMissingInCell', 'strMissingInCell{1}'],
    ['strMissingInStruct', 'strMissingInStruct.v'],
  ])('%s, copied out of a MAT-file, is refused at %s', (name, at) => {
    const mat = opened('values.mat');
    const node = mat.root.children.find((v: Any) => v.name === name);
    expect(mat.session.copyRefusal(node.id, target[1])).toBe('Cannot copy "' + name + '" into ' + target[2] + ': ' + why(at) + '. Nothing was copied.');
    refusesPaste(target, node.serialize(), at);
  });

  it.each([
    ['an element of a string array', 'x(2)', str([1, 3], ['a', null, 'c'])],
    ['in a 2x2 cell, by its linear index', 'x{3}', cell([2, 2], [1, 'a', missing, 2])],
    ['in a cell in a cell', 'x{2}{1}', cell([1, 2], [1, cell([1, 1], [missing])])],
    ['a field of a struct array', 'x(2).v', struct([1, 2], [{ v: 'a' }, { v: missing }])],
    ['a struct in a cell', 'x{1}.s(4)', cell([1, 1], [struct([1, 1], [{ s: str([2, 2], ['a', 'b', 'c', null]) }])])],
  ])('%s: refused at %s', (_what, at, value) => {
    refusesPaste(target, { name: 'x', metadata: null, value }, at);
  });

  it('a string with no missing element is pasted, as before', () => {
    const mat = opened('values.mat');
    const node = mat.root.children.find((v: Any) => v.name === 'strScalar');
    expect(mat.session.copyRefusal(node.id, target[1])).toBeNull();
    const d = opened(target[0]);
    d.session.setActive(d.root, d.design);
    expect(d.session.pasteEntries(d.design.id, [node.serialize()]).error).toBeUndefined();
  });
});
