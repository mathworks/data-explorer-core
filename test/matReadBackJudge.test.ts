// Copyright 2026 The MathWorks, Inc.
//
// The judge of a value read back against the value it was written from
// (MatFileWriter.variableDifference): the save's self-check asks it of every variable a MAT-file
// save writes fresh, and the object-edit paths (matObjectEdit, mcosStreamEdit) ask it of an
// object's property against the cell the file holds it in. So it is the one rule of "this is the
// value that was written" for two writers, and what it calls the same, and what it does not, is
// pinned here by itself, of values built as the reader builds them.
//
// The same, where MatWriter's own rules say so: an integer element as MATLAB converts it to the
// class (rounded, saturated, NaN as 0), a single's as a float32, a logical's as a uint8, a member
// a cell does not hold as the empty double written for it, dims of fewer than two as the column
// they are, and a sparse array's non-zeros as a set (the order a writer puts them in is its own,
// and an explicit zero is no non-zero). Not the same: NaN is NaN and -0 is not 0, and every other
// difference of class, size, storage, fields, text, element or object, each named where it is.

import { describe, it, expect } from 'vitest';
import { variableDifference } from '../src/datamodel/parser/MatFileWriter.js';
import type { MatVariable } from '../src/datamodel/parser/MatParser.js';

/** A full numeric variable as the reader holds one: a 1x1 bare, any other a list. */
function numeric(className: string, dimensions: number[], value: unknown, extra: Partial<MatVariable> = {}): MatVariable {
  return { name: '', className, dimensions, isComplex: false, isLogical: false, value, fields: null, ...extra };
}

const double = (value: unknown, dimensions = [1, 1]) => numeric('double', dimensions, value);
const char = (text: string) => numeric('char', [1, text.length], text);
const cell = (members: (MatVariable | null)[], dimensions = [1, members.length]) => numeric('cell', dimensions, members);
const struct = (fields: Record<string, MatVariable | MatVariable[]>, dimensions = [1, 1]) => ({ ...numeric('struct', dimensions, null), fields });

/** A sparse double of the non-zeros given, (row, column) 0-based. */
function sparse(dimensions: number[], nz: [number, number, number][], im?: number[]): MatVariable {
  return numeric('double', dimensions, null, {
    isSparse: true,
    isComplex: !!im,
    sparse: {
      row: Int32Array.from(nz.map((n) => n[0])),
      col: Int32Array.from(nz.map((n) => n[1])),
      re: Float64Array.from(nz.map((n) => n[2])),
      im: im ? Float64Array.from(im) : null,
    },
  });
}

/** An MCOS object as the reader holds one in a cell or a struct: its class, its handle, its element. */
const object = (className: string, ids: number[], element?: number[]): MatVariable =>
  numeric(className, [1, ids.length], null, { isOpaque: true, mcosHandle: { dims: [1, ids.length], ids }, _rawBytes: element ? Uint8Array.from(element) : undefined });

const judged = (model: MatVariable | null, read: MatVariable | null) => variableDifference(model, read, 'v');

describe('what the judge calls the value written, by the rules the writer writes it by', () => {
  it('an integer element as MATLAB converts it to the class: rounded, saturated, NaN as 0', () => {
    expect(judged(numeric('int8', [1, 3], [200.7, -1000, Number.NaN]), numeric('int8', [1, 3], [127, -128, 0]))).toBeNull();
    expect(judged(numeric('uint8', [1, 2], [2.5, -3]), numeric('uint8', [1, 2], [3, 0]))).toBeNull();
    // But a value the class does not convert so is another.
    expect(judged(numeric('int8', [1, 1], 5), numeric('int8', [1, 1], 6))).toBe('v: its element 1 reads back as 6 where 5 was written');
  });

  it("a single's element as the float32 it is, and a logical's as the uint8 it is stored as", () => {
    expect(judged(numeric('single', [1, 1], 0.1), numeric('single', [1, 1], Math.fround(0.1)))).toBeNull();
    expect(judged(numeric('double', [1, 1], 0.1), numeric('double', [1, 1], Math.fround(0.1)))).toBe(
      'v: its element 1 reads back as ' + Math.fround(0.1) + ' where 0.1 was written',
    );
    expect(judged(numeric('logical', [1, 2], [true, false]), numeric('uint8', [1, 2], [1, 0], { isLogical: true }))).toBeNull();
  });

  it('a double as itself: NaN is NaN, and -0 is not 0', () => {
    expect(judged(double(Number.NaN), double(Number.NaN))).toBeNull();
    // Said as String() says them, which writes -0 as 0.
    expect(judged(double(-0), double(0))).toBe('v: its element 1 reads back as 0 where 0 was written');
    expect(judged(double(Number.NaN), double(0))).toBe('v: its element 1 reads back as 0 where NaN was written');
  });

  it('a member a cell does not hold as the empty double written for it, and an empty double as one', () => {
    const empty = double(null, [0, 0]);
    expect(judged(cell([double(1), null]), cell([double(1), empty]))).toBeNull();
    expect(judged(null, empty)).toBeNull();
    expect(judged(cell([double(1), null]), cell([double(1), double(2)]))).toBe('v{2}: its size reads back as 1x1 where 0x0 was written');
  });

  it('dims of fewer than two as the column or the scalar they are', () => {
    expect(judged(double([1, 2, 3], [3]), double([1, 2, 3], [3, 1]))).toBeNull();
    expect(judged(double(7, []), double(7, [1, 1]))).toBeNull();
    expect(judged(double([1, 2, 3], [3]), double([1, 2, 3], [1, 3]))).toBe('v: its size reads back as 1x3 where 3x1 was written');
  });

  it("a sparse array's non-zeros as a set: in any order, an explicit zero none", () => {
    const model = sparse([3, 3], [[0, 0, 1], [2, 1, 5], [1, 2, 0]]);
    expect(judged(model, sparse([3, 3], [[2, 1, 5], [0, 0, 1]]))).toBeNull();
    expect(judged(sparse([2, 2], [[0, 0, 1]], [2]), sparse([2, 2], [[0, 0, 1]], [2]))).toBeNull();
  });
});

describe('what the judge says is not the value written, naming where', () => {
  it('a class, a size, a storage', () => {
    expect(judged(double(1), numeric('single', [1, 1], 1))).toBe('v: its class reads back as single where double was written');
    expect(judged(double([1, 2], [1, 2]), double([1, 2], [2, 1]))).toBe('v: its size reads back as 2x1 where 1x2 was written');
    expect(judged(numeric('double', [1, 1], { re: 1, im: 2 }, { isComplex: true }), double(1))).toBe(
      'v: its storage reads back as full real where full complex was written',
    );
    expect(judged(sparse([1, 1], [[0, 0, 1]]), double(1))).toBe('v: its storage reads back as full real where sparse real was written');
  });

  it('an element, by its part of a complex one', () => {
    const z = (im: number) => numeric('double', [1, 2], [{ re: 1, im: 0 }, { re: 3, im }], { isComplex: true });
    expect(judged(z(4), z(4))).toBeNull();
    expect(judged(z(4), z(5))).toBe('v: its element 2 (imaginary part) reads back as 5 where 4 was written');
  });

  it('an element count the dims do not hold, on either side', () => {
    expect(judged(double([1, 2], [1, 3]), double([1, 2, 3], [1, 3]))).toBe('v: its element count reads back as 3 where 2 was written');
    expect(judged(double([1, 2, 3], [1, 3]), double([1, 2], [1, 3]))).toBe('v: its element count reads back as 2 where 3 was written');
  });

  it('a text, quoted', () => {
    expect(judged(char('héllo'), char('h�llo'))).toBe('v: its text reads back as "h�llo" where "héllo" was written');
  });

  it('a cell member and a struct field at any depth, by its MATLAB path', () => {
    expect(judged(cell([double(1), cell([char('a')])]), cell([double(1), cell([char('b')])]))).toBe(
      'v{2}{1}: its text reads back as "b" where "a" was written',
    );
    const s = (b: number) => struct({ a: [double(1), double(2)], b: [double(3), double(b)] }, [1, 2]);
    expect(judged(s(4), s(4))).toBeNull();
    expect(judged(s(4), s(5))).toBe('v(2).b: its element 1 reads back as 5 where 4 was written');
    expect(judged(struct({ a: double(1) }), struct({ a: double(2) }))).toBe('v.a: its element 1 reads back as 2 where 1 was written');
  });

  it("a struct's fields, in their order", () => {
    expect(judged(struct({ a: double(1), b: double(2) }), struct({ b: double(2), a: double(1) }))).toBe(
      'v: its fields reads back as b, a where a, b was written',
    );
    expect(judged(struct({ a: double(1) }), struct({}))).toBe('v: its fields reads back as none where a was written');
  });

  it("a sparse array's non-zeros: a count, a value at (row, column) 1-based, or none to compare", () => {
    const model = sparse([3, 3], [[0, 0, 1], [2, 1, 5]]);
    expect(judged(model, sparse([3, 3], [[0, 0, 1]]))).toBe('v: it reads back with 1 non-zero(s) where 2 were written');
    expect(judged(model, sparse([3, 3], [[0, 0, 1], [2, 1, 6]]))).toBe('v: its non-zero at (3,2) does not read back as written');
    expect(judged(model, sparse([3, 3], [[0, 0, 1], [1, 1, 5]]))).toBe('v: its non-zero at (3,2) does not read back as written');
    expect(judged(sparse([2, 2], [[0, 0, 1]], [2]), sparse([2, 2], [[0, 0, 1]], [3]))).toBe('v: its non-zero at (1,1) does not read back as written');
    expect(judged(model, numeric('double', [3, 3], null, { isSparse: true }))).toBe('v: it holds no non-zeros to compare');
  });

  it('an MCOS object: its class and handle, which name its objects, and its element where both hold one', () => {
    const element = [1, 2, 3, 4];
    expect(judged(object('Simulink.Parameter', [1], element), object('Simulink.Parameter', [1], element))).toBeNull();
    // The reader keeps no element of a cell member's object: the class and handle are the answer.
    expect(judged(object('Simulink.Parameter', [1], element), object('Simulink.Parameter', [1]))).toBeNull();
    expect(judged(object('Simulink.Parameter', [1], element), object('Simulink.Parameter', [1], [1, 2, 3, 5]))).toBe(
      'v: its object reads back as another element than the one written',
    );
    expect(judged(object('Simulink.Parameter', [1]), object('Simulink.Parameter', [2]))).toBe(
      'v: it reads back as the Simulink.Parameter object(s) 1x1:2 where the Simulink.Parameter object(s) 1x1:1 were written',
    );
    expect(judged(object('Simulink.Parameter', [1]), object('Simulink.Signal', [1]))).toBe(
      'v: it reads back as the Simulink.Signal object(s) 1x1:1 where the Simulink.Parameter object(s) 1x1:1 were written',
    );
    expect(judged(object('Simulink.Parameter', [1, 2]), double(1))).toBe('v: it reads back as no object where the Simulink.Parameter object(s) 1x2:1,2 were written');
    // A member the node layer hands over as the element it was read as (MatVariable._objectElement).
    const handedOver = { ...object('Simulink.Parameter', [1]), isOpaque: false, _objectElement: Uint8Array.from(element) };
    expect(judged(handedOver, object('Simulink.Parameter', [1], element))).toBeNull();
  });
});
