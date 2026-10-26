// Copyright 2026 The MathWorks, Inc.
//
// An element edit of a complex array every imaginary part of which is 0, complex([1 2], [0 0]), which
// MATLAB holds as complex (fixtures/complex-zero-imag, made by make_complex_zero_imag.m, R2027a). The
// edit makes it real, as MATLAB's x(1) = 5 does (MatlabVariableNode._settleComplexity), and its undo
// puts back the array as it was, complex, and its bytes as read; a redo the edit again.
//
// The undo set the element back to the text it showed, `1+0i`, which over the real array the edit
// had left is the real 1, as MATLAB reads the literal: the array came back real.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, ingest } from '../src/index.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const FILE = fileURLToPath(new URL('./fixtures/complex-zero-imag/complex_zero_imag.mat', import.meta.url));
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

function opened(bytes: Uint8Array) {
  const session = createSession();
  const root: any = ingest(session, bytes, { filename: 'complex_zero_imag.mat' });
  const at = (path: string): any => root.flatten().find((n: any) => !n.isContainer && n.matlabPath === path);
  const save = (): Uint8Array => session.serializeSource(root.name).bytes;
  return { session, root, at, save };
}

/** The array at `path`: its class, whether complex, and each element's text. */
function arrayAt(o: ReturnType<typeof opened>, path: string) {
  const n = o.at(path);
  return { cls: n._isComplexValue() ? n._complexClass() : n.className, complex: n._isComplexValue(), elements: n.children.map((c: any) => c.displayValue) };
}

describe('an element edit of a complex array with every imaginary part 0', () => {
  it.each([
    ['z0', 'double'],
    ['zi8', 'int8'],
    ['sz.z0', 'double'],
    ['cz{1}', 'double'],
    ['pz.Value', 'double'],
  ])('%s: makes it real, and its undo puts it back complex, as read', (array, cls) => {
    const bytes = new Uint8Array(readFileSync(FILE));
    const o = opened(bytes);
    const before = arrayAt(o, array);
    expect(before).toMatchObject({ cls, complex: true });
    const el = o.at(array + '(1)');
    o.session.setActive(o.root, el);
    expect(o.session.editProperty(el.id, 'Value', '5')).toBe(true);
    const edited = arrayAt(o, array);
    expect(edited).toMatchObject({ cls, complex: false });
    o.session.setActive(o.root, null);
    o.session.undo();
    expect(arrayAt(o, array)).toEqual(before);
    expect(arrayAt(opened(o.save()), array)).toEqual(before);
    expect(sameBytes(o.save(), bytes)).toBe(true);
    o.session.redo();
    expect(arrayAt(o, array)).toEqual(edited);
    expect(arrayAt(opened(o.save()), array)).toEqual(edited);
  });
});
