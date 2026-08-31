// Copyright 2026 The MathWorks, Inc.
// Unit tests for MatlabValueParser — the MATLAB-expression reader behind
// Value/Min/Max edits. The parser gates what can be written back into a .sldd,
// so the important contract is two-sided: accept every legal MATLAB literal, and
// reject anything MATLAB itself could not evaluate.

import { describe, it, expect } from 'vitest';
import MatlabValueParser, { parsedIsScalarNumeric } from '../src/datamodel/parser/MatlabValueParser.js';

const parse = (s: string) => MatlabValueParser.parse(s);

describe('MatlabValueParser — scalar numbers', () => {
  it('parses integers and reals, signed or not', () => {
    expect(parse('42')).toEqual({ type: 'double', value: 42 });
    expect(parse('-3.5')).toEqual({ type: 'double', value: -3.5 });
    expect(parse('+7')).toEqual({ type: 'double', value: 7 });
  });

  it('parses the abbreviated decimal forms MATLAB allows', () => {
    expect(parse('.5')).toEqual({ type: 'double', value: 0.5 });
    expect(parse('5.')).toEqual({ type: 'double', value: 5 });
  });

  it('parses scientific notation in either case', () => {
    expect(parse('1e3')).toEqual({ type: 'double', value: 1000 });
    expect(parse('1E-3')).toEqual({ type: 'double', value: 0.001 });
    expect(parse('-2.5e2')).toEqual({ type: 'double', value: -250 });
  });

  it('ignores surrounding whitespace', () => {
    expect(parse('   42   ')).toEqual({ type: 'double', value: 42 });
  });

  it('parses the MATLAB non-finite literals', () => {
    expect(parse('Inf')).toEqual({ type: 'double', value: Infinity });
    expect(parse('-Inf')).toEqual({ type: 'double', value: -Infinity });
    expect(parse('+Inf')).toEqual({ type: 'double', value: Infinity });
    const nan = parse('NaN');
    expect(nan!.type).toBe('double');
    expect(Number.isNaN(nan!.value as number)).toBe(true);
  });

  it('rejects JavaScript-only number spellings MATLAB cannot evaluate', () => {
    // Accepting these would write a value back into the .sldd that MATLAB
    // cannot read; 'Infinity' is the JS name, MATLAB spells it 'Inf'.
    expect(parse('Infinity')).toBeNull();
    expect(parse('-Infinity')).toBeNull();
    expect(parse('0x10')).toBeNull();
    expect(parse('1_000')).toBeNull();
  });

  it('rejects non-numeric text and the empty string', () => {
    expect(parse('abc')).toBeNull();
    expect(parse('')).toBeNull();
    expect(parse('   ')).toBeNull();
    expect(parse('1 2')).toBeNull();
  });
});

describe('MatlabValueParser — logicals', () => {
  it('parses true and false', () => {
    expect(parse('true')).toEqual({ type: 'logical', value: true });
    expect(parse('false')).toEqual({ type: 'logical', value: false });
  });

  it('is case-sensitive, matching MATLAB', () => {
    expect(parse('True')).toBeNull();
    expect(parse('FALSE')).toBeNull();
  });
});

describe('MatlabValueParser — complex scalars', () => {
  it('parses a full complex literal', () => {
    expect(parse('3+4i')).toEqual({ type: 'complex', value: '3+4i' });
    expect(parse('3-4i')).toEqual({ type: 'complex', value: '3-4i' });
  });

  it('normalises a pure-imaginary literal to include a zero real part', () => {
    expect(parse('5i')).toEqual({ type: 'complex', value: '0+5i' });
    expect(parse('-2i')).toEqual({ type: 'complex', value: '0-2i' });
  });

  it('parses complex parts in scientific notation', () => {
    expect(parse('1e2+3i')).toEqual({ type: 'complex', value: '100+3i' });
  });
});

describe('MatlabValueParser — numeric arrays', () => {
  it('parses a row vector separated by spaces or commas', () => {
    expect(parse('[1 2 3]')).toEqual({ type: 'double', value: [1, 2, 3], dims: [1, 3] });
    expect(parse('[1,2,3]')).toEqual({ type: 'double', value: [1, 2, 3], dims: [1, 3] });
  });

  it('parses a matrix in row-major order with its dimensions', () => {
    expect(parse('[1 2; 3 4]')).toEqual({ type: 'double', value: [1, 2, 3, 4], dims: [2, 2] });
  });

  it('parses a column vector', () => {
    expect(parse('[1; 2; 3]')).toEqual({ type: 'double', value: [1, 2, 3], dims: [3, 1] });
  });

  it('parses the empty matrix', () => {
    expect(parse('[]')).toEqual({ type: 'double', value: [], dims: [0, 0] });
  });

  it('tolerates a trailing row separator', () => {
    expect(parse('[1 2;]')).toEqual({ type: 'double', value: [1, 2], dims: [1, 2] });
  });

  it('accepts non-finite elements', () => {
    expect(parse('[1 Inf]')).toEqual({ type: 'double', value: [1, Infinity], dims: [1, 2] });
    const withNan = parse('[1 NaN]')!;
    expect(withNan.dims).toEqual([1, 2]);
    expect(Number.isNaN((withNan.value as number[])[1])).toBe(true);
  });

  it('rejects elements MATLAB cannot evaluate', () => {
    expect(parse('[1 0x10]')).toBeNull();
    expect(parse('[1 Infinity]')).toBeNull();
  });

  it('rejects a ragged matrix', () => {
    expect(parse('[1 2; 3]')).toBeNull();
  });

  it('rejects an unterminated bracket', () => {
    expect(parse('[')).toBeNull();
    expect(parse('[1 2')).toBeNull();
  });
});

describe('MatlabValueParser — char and string', () => {
  it('parses a single-quoted char row vector', () => {
    expect(parse("'hello'")).toEqual({ type: 'char', value: 'hello' });
  });

  it('parses a double-quoted string scalar', () => {
    expect(parse('"hello"')).toEqual({ type: 'string', value: 'hello' });
  });

  it('parses the empty char and empty string', () => {
    expect(parse("''")).toEqual({ type: 'char', value: '' });
    expect(parse('""')).toEqual({ type: 'string', value: '' });
  });

  it('rejects an unterminated quote', () => {
    expect(parse("'abc")).toBeNull();
    expect(parse('"abc')).toBeNull();
  });

  it('parses an array of quoted strings as a string array', () => {
    expect(parse('["x" "y"]')).toEqual({ type: 'string-array', value: ['x', 'y'], dims: [1, 2] });
    expect(parse("['a' 'b']")).toEqual({ type: 'string-array', value: ['a', 'b'], dims: [1, 2] });
  });

  it('rejects a row mixing numbers and strings', () => {
    expect(parse('[1 "two"]')).toBeNull();
  });
});

describe('MatlabValueParser — cell arrays', () => {
  it('parses a flat cell of mixed scalars', () => {
    expect(parse("{1, 'two', true}")).toEqual({
      type: 'cell',
      value: [1, 'two', true],
      dims: [1, 3],
    });
  });

  it('parses the empty cell', () => {
    expect(parse('{}')).toEqual({ type: 'cell', value: [], dims: [0, 0] });
  });

  it('parses a cell of nested numeric arrays', () => {
    expect(parse('{[1 2],[3]}')).toEqual({
      type: 'cell',
      value: [[1, 2], [3]],
      dims: [1, 2],
    });
  });

  it('wraps a nested cell as a MATLABArray element', () => {
    const parsed = parse('{{1}}')!;
    expect(parsed.type).toBe('cell');
    expect(parsed.value).toEqual([
      { _array_type: 'Cell', _dimensions: [1, 1], _elements: [1], _mw_element_type: 'MATLABArray' },
    ]);
  });

  it('keeps a comma inside a quoted element intact', () => {
    // Splitting on the comma would silently turn one element into two.
    expect(parse("{'a,b'}")).toEqual({ type: 'cell', value: ['a,b'], dims: [1, 1] });
  });

  it('keeps a row separator inside a quoted element intact', () => {
    expect(parse("{'a;b'}")).toEqual({ type: 'cell', value: ['a;b'], dims: [1, 1] });
  });

  it('parses a multi-row cell', () => {
    expect(parse("{'a'; 'b'}")).toEqual({ type: 'cell', value: ['a', 'b'], dims: [2, 1] });
  });

  it('rejects a ragged cell and an unterminated brace', () => {
    expect(parse("{1, 2; 3}")).toBeNull();
    expect(parse('{1')).toBeNull();
  });
});

describe('parsedIsScalarNumeric', () => {
  it('accepts scalar numeric forms', () => {
    for (const expr of ['5', '-2.5', '1e3', '[5]', 'true', 'false', '3+4i', 'Inf']) {
      expect(parsedIsScalarNumeric(parse(expr))).toBe(true);
    }
  });

  it('rejects non-scalar and non-numeric forms', () => {
    for (const expr of ['[1 2]', '[1 2; 3 4]', '[]', "'abc'", '"abc"', '{1}', '{}']) {
      expect(parsedIsScalarNumeric(parse(expr))).toBe(false);
    }
  });

  it('rejects an unparseable expression', () => {
    expect(parsedIsScalarNumeric(null)).toBe(false);
    expect(parsedIsScalarNumeric(parse('Infinity'))).toBe(false);
  });
});
