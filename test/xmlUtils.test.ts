// Copyright 2026 The MathWorks, Inc.
// Unit tests for the XML emit helpers. These are the last step before bytes reach
// a .sldd, so a formatting slip here is a corrupt file rather than a wrong pixel:
// MATLAB distinguishes `1` from `1.0` by type, and its arrays are column-major
// while ours are row-major.

import { describe, it, expect } from 'vitest';
import {
  escapeXml,
  formatDoubleXml,
  formatNumericXml,
  formatComplexXml,
  formatMatlabNum,
  parseMatlabNum,
  transposeToColumnMajor,
  pad,
} from '../src/datamodel/parser/XmlUtils.js';

describe('escapeXml', () => {
  it('escapes the four characters that would break an attribute or element', () => {
    expect(escapeXml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });

  it('escapes the ampersand first, so an escape is not double-escaped', () => {
    // Replacing < before & would turn "&lt;" into "&amp;lt;".
    expect(escapeXml('<')).toBe('&lt;');
    expect(escapeXml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves an apostrophe alone', () => {
    // We always emit double-quoted attributes, so ' needs no escape and escaping
    // it would churn every MATLAB char value that contains one.
    expect(escapeXml("it's")).toBe("it's");
  });

  it('passes ordinary text through unchanged', () => {
    expect(escapeXml('')).toBe('');
    expect(escapeXml('Kp_gain')).toBe('Kp_gain');
  });
});

describe('formatDoubleXml', () => {
  it('appends .0 so an integral double is not read back as an integer', () => {
    expect(formatDoubleXml(1)).toBe('1.0');
    expect(formatDoubleXml(0)).toBe('0.0');
    expect(formatDoubleXml(-7)).toBe('-7.0');
  });

  it('leaves a value that already reads as a double alone', () => {
    expect(formatDoubleXml(1.5)).toBe('1.5');
    expect(formatDoubleXml(1e21)).toBe('1e+21');
    expect(formatDoubleXml(1e-7)).toBe('1e-7');
  });

  it('spells the non-finite values as MATLAB does, with no decimal suffix', () => {
    // The JavaScript spelling 'Infinity' is not a MATLAB literal: it would be
    // written into the .sldd as something MATLAB cannot evaluate. 'Infinity.0'
    // would be worse still.
    expect(formatDoubleXml(Infinity)).toBe('Inf');
    expect(formatDoubleXml(-Infinity)).toBe('-Inf');
    expect(formatDoubleXml(NaN)).toBe('NaN');
  });
});

describe('formatMatlabNum / parseMatlabNum', () => {
  it('spells the non-finite values the way MATLAB does', () => {
    expect([formatMatlabNum(Infinity), formatMatlabNum(-Infinity), formatMatlabNum(NaN)]).toEqual([
      'Inf',
      '-Inf',
      'NaN',
    ]);
  });

  it('leaves a finite number, and a non-number, to String()', () => {
    expect(formatMatlabNum(1.5)).toBe('1.5');
    expect(formatMatlabNum(-0)).toBe('0');
    expect(formatMatlabNum('already text')).toBe('already text');
  });

  it('reads the MATLAB non-finite spellings back as real values', () => {
    // parseFloat('Inf') is NaN, and the widespread `parseFloat(t) || 0` idiom
    // then turns all three of these into 0 — silently replacing the value.
    expect(parseMatlabNum('Inf')).toBe(Infinity);
    expect(parseMatlabNum('+Inf')).toBe(Infinity);
    expect(parseMatlabNum('-Inf')).toBe(-Infinity);
    expect(parseMatlabNum('NaN')).toBeNaN();
    expect(parseMatlabNum(' Inf ')).toBe(Infinity);
  });

  it('round-trips every non-finite value through format and parse', () => {
    for (const v of [Infinity, -Infinity, 1.5, -3]) {
      expect(parseMatlabNum(formatMatlabNum(v))).toBe(v);
    }
    expect(parseMatlabNum(formatMatlabNum(NaN))).toBeNaN();
  });

  it('reads an ordinary number, and falls back to 0 for text that is not one', () => {
    expect(parseMatlabNum('2.5e3')).toBe(2500);
    expect(parseMatlabNum('-7')).toBe(-7);
    // A missing or malformed value must not poison arithmetic with NaN.
    expect(parseMatlabNum('')).toBe(0);
    expect(parseMatlabNum('abc')).toBe(0);
  });

  it('still reads the JavaScript spelling, to recover files we mis-wrote', () => {
    // Reading is the lenient direction. Earlier versions of this code emitted
    // 'Infinity' into .sldd XML; accepting it back recovers those values instead
    // of zeroing them. Writing it is what we must never do.
    expect(parseMatlabNum('Infinity')).toBe(Infinity);
    expect(parseMatlabNum('-Infinity')).toBe(-Infinity);
  });
});

describe('formatNumericXml', () => {
  it('formats the floating-point types as doubles', () => {
    expect(formatNumericXml(2, 'double')).toBe('2.0');
    expect(formatNumericXml(2, 'single')).toBe('2.0');
  });

  it('rounds every other type to a bare integer', () => {
    // An integer-typed MATLAB value cannot carry a fraction, and MATLAB rounds
    // rather than truncates on assignment.
    expect(formatNumericXml(2.6, 'int32')).toBe('3');
    expect(formatNumericXml(-2.6, 'int32')).toBe('-3');
    expect(formatNumericXml(2, 'uint8')).toBe('2');
  });
});

describe('formatComplexXml', () => {
  it('makes each integral part of a complex literal read as a double', () => {
    expect(formatComplexXml('1+2i')).toBe('1.0+2.0i');
    expect(formatComplexXml('3-4i')).toBe('3.0-4.0i');
  });

  it('leaves a part that already has a decimal point alone', () => {
    expect(formatComplexXml('1.5+2.5i')).toBe('1.5+2.5i');
    expect(formatComplexXml('1.5+2i')).toBe('1.5+2.0i');
  });

  it('leaves an exponent alone instead of appending .0 to it', () => {
    // Typing '0.0000001+0.00000002i' into the inspector stores '1e-7+2e-8i',
    // because Number stringifies anything below 1e-6 in exponent form — so this
    // is an ordinary small value, not a corner case. Appending '.0' to the
    // trailing digits of each part turned it into '1e-7.0+2e-8.0i', which is not
    // a MATLAB literal, so the written .sldd no longer round-trips.
    expect(formatComplexXml('1e-7+2e-8i')).toBe('1e-7+2e-8i');
    expect(formatComplexXml('1e+21+2i')).toBe('1e+21+2.0i');
    expect(formatComplexXml('1.0e-07+2.0e-08i')).toBe('1.0e-07+2.0e-08i');
    expect(formatComplexXml('1E10+2E5i')).toBe('1E10+2E5i');
  });

  it('formats a whole array of complex literals and the non-finite spellings', () => {
    expect(formatComplexXml('1+2i 3+4i')).toBe('1.0+2.0i 3.0+4.0i');
    expect(formatComplexXml('2i')).toBe('2.0i');
    expect(formatComplexXml('-3-4i')).toBe('-3.0-4.0i');
    // A bare leading dot is one number, not a digit run that would give '.5.0'.
    expect(formatComplexXml('.5+.25i')).toBe('.5+.25i');
    expect(formatComplexXml('Inf+2i')).toBe('Inf+2.0i');
    expect(formatComplexXml('NaN+0i')).toBe('NaN+0.0i');
  });
});

describe('transposeToColumnMajor', () => {
  it('reorders a matrix from our row-major layout to MATLAB column-major', () => {
    // [1 2 3; 4 5 6] is stored by MATLAB as 1 4 2 5 3 6.
    expect(transposeToColumnMajor([1, 2, 3, 4, 5, 6], 2, 3)).toEqual([1, 4, 2, 5, 3, 6]);
  });

  it('returns a row vector untouched, since the orders coincide', () => {
    // Same array, not a copy: the caller emits it directly and a copy would be waste.
    const row = [1, 2, 3];
    expect(transposeToColumnMajor(row, 1, 3)).toBe(row);
    expect(transposeToColumnMajor(row, 0, 0)).toBe(row);
  });

  it('reorders a column vector and a square matrix', () => {
    expect(transposeToColumnMajor([1, 2, 3], 3, 1)).toEqual([1, 2, 3]);
    expect(transposeToColumnMajor([1, 2, 3, 4], 2, 2)).toEqual([1, 3, 2, 4]);
  });
});

describe('pad', () => {
  it('indents by four spaces per level', () => {
    expect(pad(0)).toBe('');
    expect(pad(1)).toBe('    ');
    expect(pad(3)).toBe('            ');
  });
});
