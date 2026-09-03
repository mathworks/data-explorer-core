// Copyright 2026 The MathWorks, Inc.
// Unit tests for MatlabValueParser — the MATLAB-expression reader behind
// Value/Min/Max edits. The parser gates what can be written back into a .sldd,
// so the important contract is two-sided: accept every legal MATLAB literal, and
// reject anything MATLAB itself could not evaluate.

import { describe, it, expect } from 'vitest';
import MatlabValueParser, {
  parsedIsScalarNumeric,
  formatMatlabChar,
  formatMatlabString,
  unquoteMatlabText,
} from '../src/datamodel/parser/MatlabValueParser.js';

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

  it('tolerates a stray element separator, as MATLAB does', () => {
    // MATLAB evaluates all of these to the same 1x2. A separator with nothing on
    // one side of it contributes no element rather than an empty token that fails
    // the literal check — otherwise typing a comma before finishing the next
    // element would report the whole value as invalid mid-keystroke.
    expect(parse('[1, 2, ]')).toEqual({ type: 'double', value: [1, 2], dims: [1, 2] });
    expect(parse('[ ,1, 2]')).toEqual({ type: 'double', value: [1, 2], dims: [1, 2] });
    expect(parse('[1,,2]')).toEqual({ type: 'double', value: [1, 2], dims: [1, 2] });
    // But separators alone still describe no matrix at all, not a 1x0 one.
    expect(parse('[,]')).toBeNull();
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

  it('treats semicolons that delimit only whitespace as empty rows', () => {
    // MATLAB's `[;]` and `[ ; ]` are valid empty-matrix syntax — the semicolons
    // create empty rows that collapse to []. If we rejected these, a user who
    // typed a semicolon and backspaced the content would get an error.
    expect(parse('[;]')).toEqual({ type: 'double', value: [], dims: [0, 0] });
    expect(parse('[;;]')).toEqual({ type: 'double', value: [], dims: [0, 0] });
    expect(parse('[  ;  ]')).toEqual({ type: 'double', value: [], dims: [0, 0] });
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

  it("REGRESSION: undoubles an escaped quote inside a char literal", () => {
    // MATLAB escapes a quote by DOUBLING it, so 'it''s' is ONE value of four
    // characters. Slicing the outer quotes off and stopping there kept the doubled
    // quote in the value, so the text shown and saved was `it''s` — not what the
    // user typed, and doubled again on the next save.
    expect(parse("'it''s'")).toEqual({ type: 'char', value: "it's" });
    // '''' is the single-quote CHARACTER: two quotes of delimiter, two of escape.
    expect(parse("''''")).toEqual({ type: 'char', value: "'" });
    expect(parse("'a''''b'")).toEqual({ type: 'char', value: "a''b" });
    expect(parse('"say ""hi"""')).toEqual({ type: 'string', value: 'say "hi"' });
  });

  it("REGRESSION: rejects a literal with text after its closing quote", () => {
    // 'a'b' is a syntax error in MATLAB. Reading it as `a'b` (slice off the first
    // and last character) stored a value the saved file could no longer evaluate.
    expect(parse("'a'b'")).toBeNull();
    expect(parse('"a"b"')).toBeNull();
    // A doubled quote is not a terminator, so this one is still unterminated.
    expect(parse("'a''")).toBeNull();
  });

  it("REGRESSION: undoubles escaped quotes inside a bracketed literal", () => {
    expect(parse('["a""b" "c"]')).toEqual({ type: 'string-array', value: ['a"b', 'c'], dims: [1, 2] });
    // Single quotes make it a CHAR, so the pieces concatenate into one 1x6 value
    // rather than staying two elements — MATLAB's own answer for ['it''s' 'ok'] is
    // the 1x6 char `it'sok` (probe_char_shape's LITERALS section). The undoubling is
    // what this test is here for and it happens either way.
    expect(parse("['it''s' 'ok']")).toEqual({ type: 'char', value: "it'sok" });
  });

  it('round-trips every awkward char through formatMatlabChar', () => {
    // format and parse are inverses by construction — that pairing is the whole
    // point, since the table displays format's output and feeds it back to parse.
    for (const text of ["it's", "'", "''", 'plain', '', 'a;b', 'a]b', 'x}y', '"dq"']) {
      expect(parse(formatMatlabChar(text))).toEqual({ type: 'char', value: text });
    }
    for (const text of ['say "hi"', '"', 'plain', '', "it's"]) {
      expect(parse(formatMatlabString(text))).toEqual({ type: 'string', value: text });
    }
  });

  it('unquoteMatlabText strips one layer and passes bare text through', () => {
    // The Variant Condition/Specification path: stored raw, displayed quoted, and
    // edited through the displayed form.
    expect(unquoteMatlabText("'strcmp(mode,''fast'')'")).toBe("strcmp(mode,'fast')");
    expect(unquoteMatlabText('"a""b"')).toBe('a"b');
    expect(unquoteMatlabText('a == 1')).toBe('a == 1');
    // Only ONE layer comes off, so a value that really is a quoted literal keeps
    // its inner quoting.
    expect(unquoteMatlabText("'''q'''")).toBe("'q'");
    // Not a single well-formed literal — left alone rather than half-stripped.
    expect(unquoteMatlabText("'a'b'")).toBe("'a'b'");
  });

  it('rejects an unterminated quote', () => {
    expect(parse("'abc")).toBeNull();
    expect(parse('"abc')).toBeNull();
  });

  it('parses an array of DOUBLE-quoted strings as a string array', () => {
    expect(parse('["x" "y"]')).toEqual({ type: 'string-array', value: ['x', 'y'], dims: [1, 2] });
  });

  // The quote decides the class, which is the rule charShape.test.ts owns end to end;
  // these are the parser-level statements of it. Measured in MATLAB, not assumed —
  // probe_char_shape.m evals each spelling and prints class and size.
  it('parses an array of SINGLE-quoted text as one char value', () => {
    // ['a' 'b'] is horizontal char concatenation: a 1x2 char, not two elements. Read
    // as a string array it retyped the value and doubled its element count, and since
    // this is the text the table seeds a char row's editor with, committing a char's
    // own displayed value changed its class (defect 25).
    expect(parse("['a' 'b']")).toEqual({ type: 'char', value: 'ab' });
    expect(parse("['ab' 'cd']")).toEqual({ type: 'char', value: 'abcd' });
    // A single row states no shape — that is charNeedsShape, the same rule the writers
    // apply — so there is no `dims` key here at all.
    expect(parse("['abc']")).toEqual({ type: 'char', value: 'abc' });
  });

  it('parses a multi-row single-quoted literal as a char MATRIX', () => {
    // Stored the way every channel stores a char: one string in MATLAB's column-major
    // order, with the real extents beside it. MATLAB's ['ab'; 'cd'] is a 2x2 char
    // whose storage order is 'acbd'.
    expect(parse("['ab'; 'cd']")).toEqual({ type: 'char', value: 'acbd', dims: [2, 2] });
    expect(parse("['a'; 'b'; 'c']")).toEqual({ type: 'char', value: 'abc', dims: [3, 1] });
    expect(parse("['it''s'; 'okay']")).toEqual({ type: 'char', value: "iotk'asy", dims: [2, 4] });
    // Rows are measured in CHARACTERS, not in pieces: MATLAB accepts this one as a
    // 2x2 char because both rows are two characters wide.
    expect(parse("['ab'; 'c' 'd']")).toEqual({ type: 'char', value: 'acbd', dims: [2, 2] });
    // And rejects rows of unequal width — "Dimensions of arrays being concatenated
    // are not consistent."
    expect(parse("['ab'; 'c']")).toBeNull();
  });

  it('promotes a MIXED-quote literal to a string array, as MATLAB does', () => {
    // ['ab'; "cd"] is a 2x1 string in MATLAB: one double-quoted piece anywhere makes
    // the whole literal a string array, and then the rows are elements again.
    expect(parse('[\'ab\'; "cd"]')).toEqual({ type: 'string-array', value: ['ab', 'cd'], dims: [2, 1] });
  });

  it('parses a single-element string array', () => {
    expect(parse('["hello"]')).toEqual({ type: 'string-array', value: ['hello'], dims: [1, 1] });
  });

  it('parses a multi-row string matrix', () => {
    expect(parse('["a" "b"; "c" "d"]')).toEqual({
      type: 'string-array', value: ['a', 'b', 'c', 'd'], dims: [2, 2],
    });
  });

  it('rejects a ragged string matrix', () => {
    // Different column count per row — MATLAB would error.
    expect(parse('["a" "b"; "c"]')).toBeNull();
  });

  it('rejects a row mixing numbers and strings', () => {
    expect(parse('[1 "two"]')).toBeNull();
  });

  it('rejects rows that switch from numeric to string across a semicolon', () => {
    // The first row is numeric and the second is strings — MATLAB cannot combine
    // them into a single array. Before the fix this silently produced a
    // string-array whose first element was the number 1.
    expect(parse('[1; "a"]')).toBeNull();
    expect(parse('[1 2; "a" "b"]')).toBeNull();
  });

  it('rejects rows that switch from string to numeric across a semicolon', () => {
    expect(parse('["a"; 1]')).toBeNull();
    expect(parse('["a" "b"; 1 2]')).toBeNull();
  });

  it('rejects an unterminated quote inside a string array row', () => {
    // Without the closing quote the tokenizer cannot know where the string ends.
    expect(parse('["abc]')).toBeNull();
    expect(parse("['abc]")).toBeNull();
  });

  it('ignores trailing commas/spaces in a string array row', () => {
    // Trailing comma leaves an empty tail after the last element; the tokenizer
    // should skip it rather than inventing a phantom element.
    expect(parse('["a", ]')).toEqual({ type: 'string-array', value: ['a'], dims: [1, 1] });
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

  it('skips empty rows in a cell delimited by adjacent semicolons', () => {
    // `{1;;2}` has an empty row between the semicolons — it should be ignored,
    // not cause a parse failure or corrupt the dimensions.
    expect(parse('{1;;2}')).toEqual({ type: 'cell', value: [1, 2], dims: [2, 1] });
  });

  it('collapses to an empty cell when every row is empty', () => {
    expect(parse('{;}')).toEqual({ type: 'cell', value: [], dims: [0, 0] });
    expect(parse('{;;}')).toEqual({ type: 'cell', value: [], dims: [0, 0] });
  });

  it('parses double-quoted strings in a cell', () => {
    expect(parse('{"hello"}')).toEqual({ type: 'cell', value: ['hello'], dims: [1, 1] });
    expect(parse('{"a,b"}')).toEqual({ type: 'cell', value: ['a,b'], dims: [1, 1] });
  });

  it('rejects an unterminated quote inside a cell element', () => {
    expect(parse("{'abc}")).toBeNull();
    expect(parse('{"abc}')).toBeNull();
  });

  it('rejects a nested array with unmatched brackets inside a cell', () => {
    // The `[1 2` never finds a `]`, so findMatchingBracket returns -1.
    expect(parse('{[1 2}')).toBeNull();
  });

  it('rejects a nested array that is itself malformed', () => {
    // Brackets match, but the content mixes types.
    expect(parse('{[1 "a"]}')).toBeNull();
  });

  it('rejects a nested cell with unmatched braces', () => {
    expect(parse('{{{1}}')).toBeNull();
  });

  it('rejects a nested cell whose content is malformed', () => {
    // Braces match, but `[` inside the inner cell is not closed before `}`.
    expect(parse('{{[}}')).toBeNull();
  });

  it('parses boolean and non-finite literals inside a cell', () => {
    expect(parse('{false}')).toEqual({ type: 'cell', value: [false], dims: [1, 1] });
    const cellInf = parse('{Inf}')!;
    expect((cellInf.value as unknown[])[0]).toBe(Infinity);
    const cellNegInf = parse('{-Inf}')!;
    expect((cellNegInf.value as unknown[])[0]).toBe(-Infinity);
    const cellNaN = parse('{NaN}')!;
    expect(Number.isNaN((cellNaN.value as unknown[])[0])).toBe(true);
  });

  it('keeps bare identifiers as strings in a cell', () => {
    // MATLAB cells can hold arbitrary expressions; the parser cannot evaluate
    // function calls, so bare identifiers are kept as raw text — the user sees
    // what they typed and can edit it.
    expect(parse('{abc}')).toEqual({ type: 'cell', value: ['abc'], dims: [1, 1] });
  });

  it('ignores trailing commas/spaces in a cell row', () => {
    expect(parse('{1, }')).toEqual({ type: 'cell', value: [1], dims: [1, 1] });
  });

  it('wraps nested empty structures correctly', () => {
    expect(parse('{[]}')).toEqual({ type: 'cell', value: [[]], dims: [1, 1] });
    expect(parse('{{}}')).toEqual({
      type: 'cell',
      value: [{ _array_type: 'Cell', _dimensions: [0, 0], _elements: [], _mw_element_type: 'MATLABArray' }],
      dims: [1, 1],
    });
  });

  it("REGRESSION: an escaped quote does not end a cell element early", () => {
    // The worst of the quote bugs, because it changed the SHAPE of the value with
    // no error: taking the next quote as the terminator split 'it''s' after `it`,
    // so this 1x2 cell tokenized to the THREE elements "it", "s'" and "ok" and was
    // written back to the file as a 1x3 cell of mangled text.
    expect(parse("{'it''s', 'ok'}")).toEqual({ type: 'cell', value: ["it's", 'ok'], dims: [1, 2] });
    expect(parse('{"a""b", "c"}')).toEqual({ type: 'cell', value: ['a"b', 'c'], dims: [1, 2] });
    expect(parse("{''''}")).toEqual({ type: 'cell', value: ["'"], dims: [1, 1] });
  });

  it("REGRESSION: a bracket inside a quoted element is text, not a delimiter", () => {
    // findMatchingBracket counted brackets everywhere, so the ']' inside the char
    // value closed the nested array early and the whole cell failed to parse —
    // "Invalid MATLAB expression" on an expression MATLAB accepts.
    // `['a]']` is a 1x2 CHAR — brackets around one single-quoted piece are just
    // concatenation of one thing — so the element is the text itself and not a
    // one-element list holding it (defect 25).
    expect(parse("{['a]'], 1}")).toEqual({ type: 'cell', value: ['a]', 1], dims: [1, 2] });
    expect(parse("{{'a}b'}, 2}")).toEqual({
      type: 'cell',
      value: [{ _array_type: 'Cell', _dimensions: [1, 1], _elements: ['a}b'], _mw_element_type: 'MATLABArray' }, 2],
      dims: [1, 2],
    });
  });

  it('a semicolon inside a quoted element does not start a new row', () => {
    // splitRows already skipped quoted spans, but it did so with a flag that a
    // doubled quote toggled twice — so this checks the shared scanner kept it.
    expect(parse("{'a;b', 'c'}")).toEqual({ type: 'cell', value: ['a;b', 'c'], dims: [1, 2] });
    expect(parse("{'it''s;x'}")).toEqual({ type: 'cell', value: ["it's;x"], dims: [1, 1] });
    // A real row separator still splits.
    expect(parse("{'a;b'; 'c'}")).toEqual({ type: 'cell', value: ['a;b', 'c'], dims: [2, 1] });
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
