// Copyright 2026 The MathWorks, Inc.
//
// A MAT-file's shaped empty of a numeric or logical class (zeros(0,3), int8 1x0, false(1,0)), copied,
// keeps its size, and a paste of it into a dictionary lands as the size it is (open-questions 14, D).
// A copy of a MAT-file's value carried it as `[]` (MatlabVariableNode._serializeEmpty spelled the size
// for a binary dictionary's value alone), so a paste into a binary dictionary saved a double 0x0 in a
// cell or a struct field, where MATLAB's own copy keeps the size, and the copy of one at the entry was
// refused ("its size reads back as 0x0 where 0x3 was written"). The copy now carries it as a binary
// dictionary's does, and each lands as it is, at the entry, in a cell and in a struct field, in either
// format: a text dictionary is given the spelling it reads back as that size (heldTextSpelling).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';

type Any = any;

const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const TARGETS = [
  ['test/fixtures/edit-bash/r2027a/values_text.sldd', 'json'],
  ['test/fixtures/edit-bash/r2027a/values_binary.sldd', 'xml'],
] as const;

function opened(bytes: Uint8Array, filename: string) {
  const session: Any = createSession();
  const root: Any = ingest(session, ab(bytes), { filename });
  const bytesOf = (): Uint8Array => {
    const out: Any = session.serializeSource(root.name);
    return out.kind === 'text' ? new TextEncoder().encode(out.text) : out.bytes;
  };
  return { session, root, bytesOf, design: root.children?.find((s: Any) => s.name === 'design') };
}
const open = (path: string) => opened(new Uint8Array(readFileSync(path)), path.split('/').pop()!);

// The node at `path` below `node` (child names, as a row's path names them), as class and size.
function shapeAt(node: Any, path: string[]): [string, number[]] {
  let n = node;
  for (const name of path) n = n.children.find((c: Any) => c.name === name);
  return [n.className, n._dims];
}

// `name` of the MAT-file `mat`, pasted into the target, saved and reopened: the pasted entry.
function pastedAndReopened(mat: string, name: string, target: (typeof TARGETS)[number]): Any {
  const m = open(mat);
  const node = m.root.children.find((v: Any) => v.name === name);
  expect(m.session.copyRefusal(node.id), name).toBeNull();
  expect(m.session.copyRefusal(node.id, target[1]), name).toBeNull();
  const d = open(target[0]);
  d.session.setActive(d.root, d.design);
  const made = d.session.pasteEntries(d.design.id, [node.serialize()]);
  expect(made.error, name).toBeUndefined();
  const back = opened(d.bytesOf(), target[0].split('/').pop()!);
  return back.design.children.find((e: Any) => e.name === made.nodes[0].name);
}

describe.each(TARGETS)('a MAT-file’s shaped empty pasted into %s', (...target) => {
  it.each([
    ['sLeaves', ['dEmpty0x3'], 'double', [0, 3]],
    ['sLeaves', ['i8Empty1x0'], 'int8', [1, 0]],
    ['cLeaves', ['33'], 'double', [0, 3]],
    ['cLeaves', ['34'], 'int8', [1, 0]],
  ])('%s at %j lands as a %s %j', (name, path, cls, dims) => {
    expect(shapeAt(pastedAndReopened('test/fixtures/edit-bash/r2027a/values.mat', name, target), path)).toEqual([cls, dims]);
  });

  it.each([
    ['dx_double_0x3', 'double', [0, 3]],
    ['dx_double_1x0', 'double', [1, 0]],
    ['dx_double_0x1', 'double', [0, 1]],
    ['dx_int8_0x3', 'int8', [0, 3]],
    ['dx_logical_1x0', 'logical', [1, 0]],
  ])('%s, at the entry, copies and lands as a %s %j', (name, cls, dims) => {
    expect(shapeAt(pastedAndReopened('test/fixtures/display/dispcat.mat', name, target), [])).toEqual([cls, dims]);
  });
});

describe('what the copy carries', () => {
  it("is the binary dictionary's spelling of the empty, of its class and its size", () => {
    const m = open('test/fixtures/display/dispcat.mat');
    const value = (name: string) => m.root.children.find((v: Any) => v.name === name).serialize().value;
    expect(value('dx_int8_0x3')).toEqual({ _type: 'int8', _value: 'Matrix(0,3)', _binary_empty: true });
    expect(value('dx_logical_1x0')).toEqual({ _type: 'logical', _value: 'Matrix(1,0)', _binary_empty: true });
    // A 0x0 is spelled as before.
    expect(value('dx_double_0x0')).toEqual([]);
    expect(value('dx_single_0x0')).toEqual({ _type: 'single', _value: '[]' });
  });
});
