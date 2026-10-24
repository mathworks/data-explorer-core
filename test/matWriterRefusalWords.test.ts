// Copyright 2026 The MathWorks, Inc.
//
// What MatWriter says when it refuses a value, and what it writes of one whose dims say less than
// a MAT element needs.
//
// A refusal reaches a user restated by the node layer (budgetFailure), naming the entry, and only
// once: a refusal already restated goes on as it is, so a write nested in another's says the
// entry the user acted on and not every one around it. The class in a refusal is MATLAB's word for
// it with its article (classPhrase), and a value that names no class is still said to be one. A
// struct array declaring more fields than a double can count is refused at once, without walking
// its elements, and says the count exactly. And a variable whose dims hold fewer than two extents
// is written with the trailing ones a MAT element needs, as MATLAB holds every value: [3] is 3x1.

import { describe, it, expect } from 'vitest';
import { budgetFailure, classPhrase, encodeMatStream, MatBudgetError, MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { decodeMatStream } from '../src/datamodel/parser/MatParser.js';
import type { MatVariable } from '../src/datamodel/parser/MatParser.js';

const variable = (v: Partial<MatVariable>): MatVariable =>
  ({ name: '', className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value: [0], fields: null, ...v }) as MatVariable;

function refusalOf(v: MatVariable): MatWriteError {
  try {
    encodeMatStream(v);
  } catch (e) {
    if (e instanceof MatWriteError) return e;
    throw e;
  }
  throw new Error('written, not refused');
}

describe('a refusal restated for a user', () => {
  const raw = refusalOf(variable({ dimensions: [1, 2.5], value: [1] })) as MatBudgetError;

  it('names the entry and where in it the write stood, once', () => {
    const once = budgetFailure(raw, 'K', 'K.Value');
    expect(once.entry).toBe('K');
    expect(once.at).toBe('K.Value');
    expect(once.message).toBe(
      'Cannot write "K": K.Value is a double declaring dimensions [1,2.5], a size that is not a count, so what it would add beyond '
        + 'its data cannot be held to the 16 MiB one value may add. Nothing was written.',
    );
    // Restated again by a write around it, it is the same refusal: the entry the user acted on.
    expect(budgetFailure(once, 'Outer', 'Outer.f')).toBe(once);
  });

  it('keeps the reason it was refused for', () => {
    expect([raw.reason, raw.counted]).toEqual(['not-a-count', false]);
    expect([budgetFailure(raw, 'K', 'K').reason, budgetFailure(raw, 'K', 'K').counted]).toEqual(['not-a-count', false]);
  });
});

describe("a class, in a refusal's words", () => {
  it("is MATLAB's name for it, with its article", () => {
    expect(['mxchar', 'sparse', 'int8', 'uint8', 'object', 'Simulink.Parameter', 'enumeration'].map(classPhrase)).toEqual([
      'a char',
      'a sparse double',
      'an int8',
      'a uint8',
      'an object',
      'a Simulink.Parameter',
      'an enumeration',
    ]);
  });

  it('and a value that names none is still said to be one', () => {
    expect(refusalOf(variable({ className: undefined as never, dimensions: [1, 2.5] })).message).toBe(
      'the value, a value declaring dimensions [1,2.5], would write NaN bytes no data backs, which is not a count',
    );
    expect(refusalOf(variable({ className: '', isOpaque: true, value: null })).message).toBe('cannot write an MCOS opaque value (unknown)');
  });
});

describe('a struct array declaring more fields than a double can count', () => {
  it('is refused at once, saying the count exactly', () => {
    const extent = 2 ** 31 - 1;
    const t0 = performance.now();
    const e = refusalOf(variable({ className: 'struct', dimensions: [extent, extent], value: null, fields: { f: [] } })) as MatBudgetError;
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(e.reason).toBe('budget');
    expect(e.what).toBe('a ' + extent + 'x' + extent + ' struct array missing some of its ' + (BigInt(extent) * BigInt(extent)).toString() + ' fields');
  });

  it('and one missing fewer is said to miss that many', () => {
    // Under the budget, the holes are written as empty doubles in their slots.
    const read = decodeMatStream(encodeMatStream(variable({ className: 'struct', dimensions: [1, 3], value: null, fields: { f: [variable({ value: 5 as never })] } })));
    expect(read.ok).toBe(true);
    const v = (read as { variable: MatVariable }).variable;
    expect(v.dimensions).toEqual([1, 3]);
    const f = v.fields!.f as MatVariable[];
    expect(f.map((x) => [x.className, x.dimensions])).toEqual([['double', [1, 1]], ['double', [0, 0]], ['double', [0, 0]]]);
  });
});

describe('a variable whose dims hold fewer than two extents', () => {
  for (const [dimensions, value, expected] of [
    [[3], [1, 2, 3], [3, 1]],
    [[], [5], [1, 1]],
  ] as const) {
    it(`[${dimensions.join(',')}] is written ${expected.join('x')}, as MATLAB holds every value`, () => {
      const read = decodeMatStream(encodeMatStream(variable({ dimensions: [...dimensions], value: [...value] })));
      expect(read.ok).toBe(true);
      const v = (read as { variable: MatVariable }).variable;
      expect(v.dimensions).toEqual(expected);
      expect(v.value).toEqual(value.length === 1 ? value[0] : value);
    });
  }
});
