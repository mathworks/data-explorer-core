// Copyright 2026 The MathWorks, Inc.
//
// The two ways this package asks MATLAB's load rules of a variable: checkMatFile, of a whole
// file, and checkMatElement, of one variable's element alone, which a save asks of a variable it
// is about to write fresh (MatFileWriter.storedRefusal: a variable stored in a form MATLAB does
// not load as it is is written only as it was read). One rule, two entry points: what the element
// check says of an element is what the file check says of the same element as a file's only
// record, rule for rule, and it never throws or runs past its budget either.
//
// Then the parts of a matrix and of a file that only bytes built here reach, because MATLAB
// writes none of them: an old-style (class 3) object, whose class name comes before a struct's
// body; a sparse array of three dimensions; a compressed record that asks for a preset zlib
// dictionary; and a subsystem whose stream says its tags are not 32-bit, or that holds an empty
// matrix.

import { describe, it, expect } from 'vitest';
import { zlibSync } from 'fflate';
import { checkMatElement, checkMatFile, type MatViolation } from '../src/datamodel/parser/MatFileCheck.js';
import { CLASS, MI, arrayFlags, cellVar, charVar, dims, element, matFile, matrix, numericVar, sparseVar, structVar, u32le, varName } from './tools/matBytes.js';

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A record holding `el` compressed; `patch` may change the zlib stream before it is framed. */
function compressed(el: Uint8Array, patch: (z: Uint8Array) => void = () => {}): Uint8Array {
  const z = zlibSync(el);
  patch(z);
  return concat([u32le(MI.COMPRESSED), u32le(z.length), z]);
}

/** A subsystem record: an unnamed uint8 [1 N] array holding a MAT stream of `elements`, its preamble `preamble`. */
function subsystem(elements: Uint8Array[], preamble = new Uint8Array([0x00, 0x01, 0x49, 0x4d, 0, 0, 0, 0])): Uint8Array {
  const stream = concat([preamble, ...elements]);
  return matrix([arrayFlags(CLASS.UINT8), dims([1, stream.length]), varName(''), element(MI.UINT8, stream)]);
}

/** A file of `records`, its header's subsystem offset at `records[subsystemAt]` when given. */
function file(records: Uint8Array[], subsystemAt?: number): Uint8Array {
  const bytes = new Uint8Array(matFile(records));
  const at = subsystemAt === undefined ? 0 : 128 + records.slice(0, subsystemAt).reduce((n, r) => n + r.length, 0);
  new DataView(bytes.buffer).setUint32(116, at, true);
  return bytes;
}

const x = (name = 'x', real = [1, 2, 3]): Uint8Array => numericVar({ name, cls: CLASS.DOUBLE, dimensions: [1, real.length], real });
const int32 = (n: number): Uint8Array => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, n, true);
  return out;
};
const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const codesOf = (found: MatViolation[]): string[] => found.map((v) => v.code).sort();

/** An old-style (class 3) object of class `cls`, its fields `x` and `y` (32-byte names), as the spec lays one out. */
function oldObject(name: string, cls: Uint8Array, fields: [Uint8Array, Uint8Array]): Uint8Array {
  const names = new Uint8Array(64);
  names.set(text('x'), 0);
  names.set(text('y'), 32);
  return matrix([arrayFlags(CLASS.OBJECT), dims([1, 1]), varName(name), element(MI.INT8, cls), element(MI.INT32, int32(32)), element(MI.INT8, names), ...fields]);
}

// Elements of one variable each, every one breaking one rule of how MATLAB reads a matrix, at the
// top or deeper, and the clean ones beside them.
const ELEMENTS: [string, Uint8Array][] = [
  ['a clean double', x()],
  ['a clean struct holding text', structVar('s', ['a'], [{ a: charVar('', 'héllo', MI.UTF16) }])],
  ['char data as miUTF32', charVar('t', 'abc', 18)],
  ['char data as miUINT8', charVar('t', 'abc', MI.UINT8)],
  ['an int8 stored as miINT16', numericVar({ name: 'i', cls: CLASS.INT8, dimensions: [1, 2], dataType: MI.INT16, real: [1, 2] })],
  ['a double holding fewer elements than its dims', numericVar({ name: 'd', cls: CLASS.DOUBLE, dimensions: [1, 4], real: [1, 2] })],
  ['a cell member that is miUTF32 text', cellVar('c', [x(''), charVar('', 'ab', 18)])],
  ['a cell declaring more members than it holds', cellVar('c', [x('')], [1, 3])],
  ['an array class MATLAB has none of', matrix([arrayFlags(30), dims([1, 1]), varName('q'), element(MI.DOUBLE, new Uint8Array(8))])],
  ['an old-style object', oldObject('o', text('Pt'), [x(''), x('')])],
  ['an old-style object holding miUTF32 text', oldObject('o', text('Pt'), [x(''), charVar('', 'ab', 18)])],
  ['an old-style object with no class name', oldObject('o', new Uint8Array(0), [x(''), x('')])],
  ['a sparse array of three dimensions', sparseVar({ name: 'sp', dimensions: [2, 2, 1], ir: [0, 1], jc: [0, 1, 2], real: [1, 2] })],
];

describe('checkMatElement and checkMatFile', () => {
  for (const [what, el] of ELEMENTS) {
    it(`say the same of ${what}`, () => {
      const ofElement = checkMatElement(el);
      const ofFile = checkMatFile(file([el]));
      expect(codesOf(ofElement)).toEqual(codesOf(ofFile));
      // The element check speaks of where in the element it is, at its own start, and of the
      // variable by the name the file check gives it.
      for (const v of ofElement) {
        expect(v.at).toBe(0);
      }
      expect(ofElement.map((v) => v.variable)).toEqual(ofFile.map((v) => v.variable));
    });
  }

  it('find the rules ELEMENTS breaks, and nothing in the clean ones', () => {
    const verdicts = Object.fromEntries(ELEMENTS.map(([what, el]) => [what, codesOf(checkMatElement(el))]));
    expect(verdicts).toEqual({
      'a clean double': [],
      'a clean struct holding text': [],
      'char data as miUTF32': ['char-type'],
      'char data as miUINT8': ['char-type'],
      'an int8 stored as miINT16': ['int-storage'],
      'a double holding fewer elements than its dims': ['data-size'],
      'a cell member that is miUTF32 text': ['char-type'],
      'a cell declaring more members than it holds': ['nbytes'],
      'an array class MATLAB has none of': ['element'],
      'an old-style object': [],
      'an old-style object holding miUTF32 text': ['char-type'],
      'an old-style object with no class name': ['element'],
      'a sparse array of three dimensions': ['element'],
    });
  });
});

describe('checkMatElement of what is no matrix', () => {
  it('says an element shorter than a tag is one, and checks nothing else', () => {
    expect(checkMatElement(new Uint8Array(5))).toEqual([
      { code: 'element', at: 0, message: "The element holds 5 byte(s), fewer than one element's tag." },
    ]);
    expect(checkMatElement(new Uint8Array(0))).toEqual([expect.objectContaining({ code: 'element', message: expect.stringContaining('holds 0 byte(s)') })]);
  });

  it('says a data element that is not miMATRIX is not a matrix, naming its type', () => {
    const found = checkMatElement(element(MI.DOUBLE, new Uint8Array(8)));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ code: 'element', at: 0 });
    expect(found[0].message).toMatch(/^The element is a data element of miDOUBLE, not a matrix\.$/);
  });

  it('stops at its budget with a note, as the file check does, and never throws', () => {
    const big = cellVar('c', Array.from({ length: 10 }, () => x('')));
    expect(checkMatElement(big)).toEqual([]);
    const found = checkMatElement(big, { maxElements: 5 });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ code: 'budget', at: 0, variable: 'c' });
    expect(found[0].message).toMatch(/^The check of the element stopped at .*5 matrices.*, so nothing from there on was checked\.$/);
    // Nothing past the budget is reported, the char array after the members included.
    expect(checkMatElement(cellVar('c', [...Array.from({ length: 10 }, () => x('')), charVar('', 'ab', 18)]), { maxElements: 5 }).map((v) => v.code)).toEqual(['budget']);
  });

  it('never throws on an element cut at any length', () => {
    const el = structVar('s', ['a', 'b'], [{ a: x(''), b: cellVar('', [charVar('', 'hi', MI.UTF8, [1, 2])]) }]);
    for (let n = 0; n <= el.length; n++) {
      expect(() => checkMatElement(el.subarray(0, n)), `cut at ${n}`).not.toThrow();
    }
  });
});

describe('the file check of what MATLAB never writes', () => {
  it('reads an old-style object\'s class name before its fields, and its fields as a struct\'s', () => {
    expect(checkMatFile(file([oldObject('o', text('Pt'), [x(''), x('')])]))).toEqual([]);
    const unnamed = checkMatFile(file([oldObject('o', new Uint8Array(0), [x(''), x('')])]));
    expect(unnamed).toHaveLength(1);
    expect(unnamed[0]).toMatchObject({ code: 'element', variable: 'o' });
    expect(unnamed[0].message).toContain("the object's class name is 0 byte(s) of miINT8");
    // A field's text, past the class name, is checked as a struct field's is.
    const deep = checkMatFile(file([oldObject('o', text('Pt'), [x(''), charVar('', 'ab', 18)])]));
    expect(deep.map((v) => [v.code, v.variable])).toEqual([['char-type', 'o']]);
  });

  it('says a sparse array has two dimensions', () => {
    const found = checkMatFile(file([sparseVar({ name: 'sp', dimensions: [2, 2, 1], ir: [0, 1], jc: [0, 1, 2], real: [1, 2] })]));
    expect(found.map((v) => [v.code, v.variable])).toEqual([['element', 'sp']]);
    expect(found[0].message).toContain('the sparse array has 3 dimensions, and a sparse array has 2');
  });

  it('says a compressed record that needs a preset dictionary is one MATLAB does not inflate', () => {
    // 0x78 0x20: deflate, a 32 KiB window, the FDICT bit, and a header check that holds.
    const record = compressed(x(), (z) => {
      z[1] = 0x20;
    });
    expect(((0x78 << 8) | 0x20) % 31).toBe(0);
    const found = checkMatFile(file([x('a'), record]));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ code: 'compressed-wrapper', at: 128 + x('a').length });
    expect(found[0].message).toContain('is a zlib stream that needs a preset dictionary');
  });

  it('walks a subsystem whose tags are 32-bit, and not one whose preamble says they are not', () => {
    const bad = charVar('', 'abc', 18);
    // Walked: the char array inside it is found.
    expect(checkMatFile(file([x(), subsystem([bad])], 1)).map((v) => v.code)).toEqual(['char-type']);
    // The preamble's second half nonzero: a stream this check does not read, so nothing in it is said.
    const other = new Uint8Array([0x00, 0x01, 0x49, 0x4d, 0x01, 0x00, 0, 0]);
    expect(checkMatFile(file([x(), subsystem([bad], other)], 1))).toEqual([]);
  });

  it('takes an empty matrix in a subsystem, and spends the budget on it', () => {
    const empties = Array.from({ length: 50 }, () => matrix([]));
    expect(checkMatFile(file([x(), subsystem([x(''), ...empties])], 1))).toEqual([]);
    expect(checkMatFile(file([x(), subsystem([x(''), ...empties])], 1), { maxElements: 10 }).map((v) => v.code)).toEqual(['budget']);
  });
});
