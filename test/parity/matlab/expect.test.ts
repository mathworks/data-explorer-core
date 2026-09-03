// Copyright 2026 The MathWorks, Inc.
//
// expect.ts is the convention expressed as a pure function of what MATLAB
// reported. It is tested on its own because a bug HERE would make the parity
// suites agree with a wrong data model — the one failure mode a parity suite
// cannot detect from the inside.
import { describe, it, expect } from 'vitest';
import {
  expectedDisplay, effective, summary, normalizeMat2str, literalMatches, hasMatlabLiteral,
  isObjectArray, expectedPropertyText, propertyTextMatches, subPropertyNames,
} from './expect.js';

// Field names are MATLAB's, because gen_truth.m's jsonencode emits them verbatim:
// iscomplex, isempty, islogical, isobject, mat2str_error.
const t = (over: any) => ({
  name: 'v', class: 'double', size: [1, 1], iscomplex: false, isempty: false,
  islogical: false, isobject: false, numel: 1, disp: '', ...over,
});

describe('expectedDisplay', () => {
  it('is the mat2str literal for a small real matrix', () => {
    expect(expectedDisplay(t({ size: [2, 3], numel: 6, mat2str: '[1 2 3;4 5 6]' })))
      .toBe('[1 2 3; 4 5 6]');
  });

  it('is a scalar literal for a scalar', () => {
    expect(expectedDisplay(t({ mat2str: '5' }))).toBe('5');
  });

  it('is the summary form when mat2str itself refused', () => {
    expect(expectedDisplay(t({
      class: 'double', size: [2, 3, 2], numel: 12,
      mat2str_error: 'Input matrix must be 2-D',
    }))).toBe('<2x3x2 double>');
  });

  it('is the summary form past the element budget', () => {
    expect(expectedDisplay(t({
      size: [1, 11], numel: 11, mat2str: '[1 2 3 4 5 6 7 8 9 10 11]',
    }))).toBe('<1x11 double>');
  });

  it('renders exactly 10 elements inline', () => {
    expect(expectedDisplay(t({
      size: [1, 10], numel: 10, mat2str: '[1 2 3 4 5 6 7 8 9 10]',
    }))).toBe('[1 2 3 4 5 6 7 8 9 10]');
  });

  it('is [ ] for an empty numeric and { } for an empty cell', () => {
    expect(expectedDisplay(t({ size: [0, 0], numel: 0, isempty: true }))).toBe('[ ]');
    expect(expectedDisplay(t({ class: 'cell', size: [0, 0], numel: 0, isempty: true }))).toBe('{ }');
  });

  it('always summarizes a struct', () => {
    expect(expectedDisplay(t({ class: 'struct' }))).toBe('<1x1 struct>');
    expect(expectedDisplay(t({ class: 'struct', size: [2, 3], numel: 6 }))).toBe('<2x3 struct>');
  });

  // MATLAB's own disp for the corpus's objRow is "1×3 Parameter array with
  // properties:" — a class-and-size summary, exactly what the angle form carries.
  // Under the element budget as well as over it, and at rank 3.
  it('always summarizes an object ARRAY, as MATLAB summarizes it', () => {
    const o = (over: any) => t({ class: 'Simulink.Parameter', isobject: true, ...over });
    expect(expectedDisplay(o({ size: [1, 3], numel: 3 }))).toBe('<1x3 Simulink.Parameter>');
    expect(expectedDisplay(o({ size: [2, 3, 2], numel: 12 }))).toBe('<2x3x2 Simulink.Parameter>');
  });

  // A scalar object is NOT the array case: its cell shows its Value. With no
  // property truth recorded there is nothing to compare against, so null.
  it('gives a SCALAR object no expectation when no properties were recorded', () => {
    expect(expectedDisplay(t({ class: 'Simulink.Parameter', isobject: true }))).toBe(null);
  });

  // The empty-cell rule, and its whole justification: MATLAB's own properties()
  // list. A class with a Value shows it; a class MATLAB gives no Value has nothing
  // to show. Simulink.Signal really has InitialValue and no Value in R2027a.
  it('shows a scalar object Value, and empty for a class MATLAB gives none', () => {
    const p = (over: any) => ({
      class: 'int16', size: [1, 1], numel: 1, isempty: false, disp: '5', mat2str: '5', ...over,
    });
    expect(expectedDisplay(t({
      class: 'Simulink.Parameter', isobject: true, properties: { Value: p({}) },
    }))).toBe('5');
    expect(expectedDisplay(t({
      class: 'Simulink.Signal', isobject: true,
      properties: { InitialValue: p({ class: 'char', mat2str: "''" }) },
    }))).toBe('');
  });

  // A Value that is itself over budget summarizes, because a property is measured
  // by the same rules as an entry — the whole point of routing it back through here.
  it('applies the same thresholds to a Value as to an entry', () => {
    expect(expectedDisplay(t({
      class: 'Simulink.Parameter', isobject: true,
      properties: {
        Value: {
          class: 'double', size: [1, 11], numel: 11, isempty: false, disp: '',
          mat2str: '[1 2 3 4 5 6 7 8 9 10 11]',
        },
      },
    }))).toBe('<1x11 double>');
  });

  // 'Value' present but unreadable is not the same as absent: MATLAB produced no
  // value, so an empty cell would be asserting something MATLAB never said.
  it('gives no expectation when reading Value errored', () => {
    expect(expectedDisplay(t({
      class: 'Simulink.Parameter', isobject: true,
      properties: { Value: { error: 'some MATLAB error' } },
    }))).toBe(null);
  });

  // isobject("a") is TRUE, so a string array would otherwise be caught by the
  // object-array arm and summarized — but mat2str spells it and the model shows it.
  it('does not treat a string array as an object array', () => {
    expect(expectedDisplay(t({
      class: 'string', size: [1, 3], numel: 3, isobject: true, mat2str: '["a" "bb" "ccc"]',
    }))).toBe('["a" "bb" "ccc"]');
  });

  it('summarizes past the char budget even under the element budget', () => {
    const long = "'" + 'x'.repeat(1200) + "'";
    expect(expectedDisplay(t({
      class: 'cell', size: [1, 2], numel: 2, mat2str: '{' + long + ',' + long + '}',
    }))).toBe('<1x2 cell>');
  });

  it('quotes a char scalar as a MATLAB literal', () => {
    expect(expectedDisplay(t({ class: 'char', size: [1, 5], numel: 5, mat2str: "'hello'" })))
      .toBe("'hello'");
  });

  // A char row is ONE value, not N elements, so the element budget must not touch
  // it — `hugeChar` in the corpus is 1x1500 and the char budget is what summarizes
  // it, while `longChar` at 1x120 stays a literal. If the element rule applied,
  // every char longer than ten characters would summarize.
  it('measures a char row in characters, not elements', () => {
    expect(expectedDisplay(t({
      class: 'char', size: [1, 30], numel: 30, mat2str: "'" + 'a'.repeat(30) + "'",
    }))).toBe("'" + 'a'.repeat(30) + "'");
    expect(expectedDisplay(t({
      class: 'char', size: [1, 1500], numel: 1500, mat2str: "'" + 'a'.repeat(1500) + "'",
    }))).toBe('<1x1500 char>');
  });

  // Same argument for a scalar string: no child rows, so length is the only bound.
  it('measures a scalar string in characters', () => {
    expect(expectedDisplay(t({
      class: 'string', size: [1, 1], numel: 1, mat2str: '"' + 'a'.repeat(1200) + '"',
    }))).toBe('<1x1 string>');
  });

  it('is the literal for an empty char and an empty scalar string', () => {
    expect(expectedDisplay(t({ class: 'char', size: [0, 0], numel: 0, isempty: true, mat2str: "''" })))
      .toBe("''");
    expect(expectedDisplay(t({ class: 'string', size: [1, 1], numel: 1, mat2str: '""' })))
      .toBe('""');
  });
});

describe('effective', () => {
  it('drops trailing singletons the way MATLAB does', () => {
    expect(effective([2, 3, 1])).toEqual([2, 3]);
    expect(effective([2, 3, 1, 1])).toEqual([2, 3]);
  });

  it('keeps an interior singleton, which is a real shape', () => {
    expect(effective([2, 1, 3])).toEqual([2, 1, 3]);
  });

  it('never reduces below rank 2', () => {
    expect(effective([1, 1])).toEqual([1, 1]);
    expect(effective([1, 1, 1])).toEqual([1, 1]);
    expect(effective([])).toEqual([1, 1]);
    expect(effective([5])).toEqual([1, 5]);
  });

  it('leaves a zero extent alone — 0x0 is not 1x1', () => {
    expect(effective([0, 0])).toEqual([0, 0]);
    expect(effective([1, 0])).toEqual([1, 0]);
  });
});

describe('summary', () => {
  it('is the angle form, x-joined, class last', () => {
    expect(summary([2, 3], 'double')).toBe('<2x3 double>');
    expect(summary([2, 3, 2], 'cell')).toBe('<2x3x2 cell>');
  });
});

describe('hasMatlabLiteral', () => {
  // mat2str refuses a cell and every object class, so there is no MATLAB one-line
  // spelling for either. Saying so out loud is what keeps the suites from quietly
  // asserting OUR spelling as if MATLAB had confirmed it.
  it('is false for a cell and for an object, true for the primitives', () => {
    expect(hasMatlabLiteral(t({ class: 'cell', numel: 3 }))).toBe(false);
    expect(hasMatlabLiteral(t({ class: 'Simulink.Parameter', isobject: true }))).toBe(false);
    expect(hasMatlabLiteral(t({ class: 'double' }))).toBe(true);
    expect(hasMatlabLiteral(t({ class: 'struct' }))).toBe(true);
  });

  // MATLAB's isobject says a string is an object; mat2str spells one anyway. If
  // this read isobject instead of class, every string would lose its expectation.
  it('is true for a string even though MATLAB calls it an object', () => {
    expect(hasMatlabLiteral(t({ class: 'string', isobject: true, numel: 3 }))).toBe(true);
    expect(isObjectArray(t({ class: 'string', isobject: true, numel: 3 }))).toBe(false);
    expect(isObjectArray(t({ class: 'Simulink.Parameter', isobject: true, numel: 3 }))).toBe(true);
  });

  it('gives a cell under budget no expectation at all', () => {
    expect(expectedDisplay(t({ class: 'cell', size: [1, 3], numel: 3 }))).toBe(null);
  });

  it('still summarizes a cell OVER budget, which needs no mat2str', () => {
    expect(expectedDisplay(t({ class: 'cell', size: [2, 3, 2], numel: 12 }))).toBe('<2x3x2 cell>');
    expect(expectedDisplay(t({ class: 'cell', size: [1, 11], numel: 11 }))).toBe('<1x11 cell>');
  });
});

describe('expectedPropertyText', () => {
  const p = (over: any) => ({
    class: 'double', size: [1, 1], numel: 1, isempty: false, disp: '', ...over,
  });

  // The one rule that separates a property sheet from a table cell: a cell holds a
  // MATLAB literal, a sheet holds the value. `'m/s'` is what you would type; `m/s`
  // is what the Unit text box contains.
  it('unquotes a char and a string, and keeps mat2str for everything else', () => {
    expect(expectedPropertyText(p({ class: 'char', size: [1, 3], numel: 3, disp: 'm/s', mat2str: "'m/s'" })))
      .toBe('m/s');
    expect(expectedPropertyText(p({ class: 'string', numel: 1, disp: 'abc', mat2str: '"abc"' })))
      .toBe('abc');
    expect(expectedPropertyText(p({ mat2str: '-10' }))).toBe('-10');
    expect(expectedPropertyText(p({ class: 'logical', islogical: true, mat2str: 'false' }))).toBe('false');
  });

  it('is the empty string for an empty char, which is MATLAB\'s own text', () => {
    expect(expectedPropertyText(p({ class: 'char', size: [0, 0], numel: 0, isempty: true, disp: '', mat2str: "''" })))
      .toBe('');
  });

  // Same spelling as a table cell for an array, because there mat2str IS the value.
  it('spells a numeric row as mat2str does', () => {
    expect(expectedPropertyText(p({ size: [1, 2], numel: 2, mat2str: '[1 1]' }))).toBe('[1 1]');
    expect(expectedPropertyText(p({ size: [2, 2], numel: 4, mat2str: '[1 2;3 4]' }))).toBe('[1 2; 3 4]');
  });

  // A nested object: mat2str refuses it, so there is no one-line answer and the
  // caller must check presence instead. Same for a property MATLAB could not read.
  it('is null for a nested object and for an unreadable property', () => {
    expect(expectedPropertyText(p({
      class: 'Simulink.CoderInfo',
      mat2str_error: 'Input matrix must be a numeric array, character array, or string array.',
    }))).toBe(null);
    expect(expectedPropertyText({ error: 'some MATLAB error' } as any)).toBe(null);
  });

  it('carries the float leniency through, exactly as literalMatches does', () => {
    const pi = p({ class: 'double', mat2str: '3.14159265358979' });
    expect(propertyTextMatches('3.141592653589793', pi)).toBe(true);
    expect(propertyTextMatches('3.14159265358978', pi)).toBe(false);
    // Unquoted char is exact — no leniency to fall back on.
    expect(propertyTextMatches('real', p({ class: 'char', numel: 4, disp: 'real', mat2str: "'real'" }))).toBe(true);
    expect(propertyTextMatches("'real'", p({ class: 'char', numel: 4, disp: 'real', mat2str: "'real'" }))).toBe(false);
  });
});

describe('subPropertyNames', () => {
  // MATLAB's own disp is what says a nested object HAS these sub-properties, which
  // is how a projected column (CoderInfo.StorageClass surfacing as storageClass)
  // can be checked at all.
  it('reads the sub-property names off MATLAB\'s disp', () => {
    expect(subPropertyNames({
      class: 'Simulink.CoderInfo', size: [1, 1], numel: 1, isempty: false,
      disp: "CoderInfo with properties:\n\n    StorageClass: 'Auto'",
    })).toEqual(['StorageClass']);
    expect(subPropertyNames({
      class: 'Simulink.lookuptable.StructTypeInfo', size: [1, 1], numel: 1, isempty: false,
      disp: "StructTypeInfo with properties:\n\n              Name: 'LtType'\n         DataScope: 'Auto'\n    HeaderFileName: ''",
    })).toEqual(['Name', 'DataScope', 'HeaderFileName']);
  });

  // An object ARRAY's disp lists property names with no values — `Min` on its own
  // line, no colon — so there is nothing to read, and the caller falls back to the
  // element-row rule. Getting this wrong would let a Bus claim its Elements
  // surfaced because `Min` happened to appear somewhere in the sheet.
  it('is empty for an object array, whose disp lists names without values', () => {
    expect(subPropertyNames({
      class: 'Simulink.BusElement', size: [2, 1], numel: 2, isempty: false,
      disp: '2×1 BusElement array with properties:\n\n    Min\n    Max\n    Name',
    })).toEqual([]);
  });
});

describe('literalMatches', () => {
  it('demands exact equality for an integer, logical, char or string', () => {
    const v = t({ class: 'int16', size: [1, 3], numel: 3, mat2str: '[1 2 3]' });
    expect(literalMatches('[1 2 3]', v)).toBe(true);
    expect(literalMatches('[1 2 4]', v)).toBe(false);
    expect(literalMatches('[1  2 3]', v)).toBe(false);
  });

  // The documented deviation: MATLAB prints 15 significant digits, we print
  // JavaScript's shortest round-trip spelling. For a double that is MORE digits —
  // and MATLAB's is lossy, so Number('3.14159265358979') is not Math.PI and plain
  // numeric equality would reject the very case this exists for.
  it('accepts our extra digits for a double, at mat2str resolution', () => {
    const v = t({ class: 'double', mat2str: '3.14159265358979' });
    expect(literalMatches('3.141592653589793', v)).toBe(true);
    expect(literalMatches('3.14159265358979', v)).toBe(true);
    expect(literalMatches('3.14159265358978', v)).toBe(false);
    expect(Number('3.14159265358979')).not.toBe(Math.PI);
  });

  // And FEWER digits for a single: 3.14159274 and 3.14159274101257 are one float32.
  it('accepts our shorter spelling for a single, at float32 resolution', () => {
    const v = t({ class: 'single', mat2str: '3.14159274101257' });
    expect(literalMatches('3.14159274', v)).toBe(true);
    expect(literalMatches('3.15', v)).toBe(false);
  });

  it('rejects a non-canonical float spelling even though it is the same number', () => {
    // 3.1400000000000001 === 3.14, but String(3.14) is '3.14' — the convention
    // says round-trip precision, and a longer spelling is not that.
    expect(literalMatches('3.1400000000000001', t({ class: 'double', mat2str: '3.14' }))).toBe(false);
  });

  it('never lets the float leniency past a structural difference', () => {
    const v = t({ class: 'double', size: [2, 2], numel: 4, mat2str: '[1 2;3 4]' });
    expect(literalMatches('[1 2; 3 4]', v)).toBe(true);
    expect(literalMatches('[1 2 3 4]', v)).toBe(false);
    expect(literalMatches('[1; 2; 3; 4]', v)).toBe(false);
  });

  it('compares Inf and NaN as text, since Number("Inf") is not a number', () => {
    const v = t({ class: 'double', size: [1, 3], numel: 3, mat2str: '[1 Inf NaN]' });
    expect(literalMatches('[1 Inf NaN]', v)).toBe(true);
    expect(literalMatches('[1 Infinity NaN]', v)).toBe(false);
  });

  it('passes anything when MATLAB has no spelling — the caller asserts elsewhere', () => {
    expect(literalMatches("{1, 'two'}", t({ class: 'cell', size: [1, 2], numel: 2 }))).toBe(true);
  });
});

describe('normalizeMat2str', () => {
  // The ONLY divergence from mat2str that the convention claims. If a suite needs
  // a second rule, that rule belongs here with the MATLAB spelling it reconciles —
  // not as a general whitespace strip, which would hide a real spacing defect.
  it('adds the space after a semicolon and changes nothing else', () => {
    expect(normalizeMat2str('[1 2;3 4]')).toBe('[1 2; 3 4]');
    expect(normalizeMat2str('[1 2 3]')).toBe('[1 2 3]');
    expect(normalizeMat2str("'it''s'")).toBe("'it''s'");
  });
});
