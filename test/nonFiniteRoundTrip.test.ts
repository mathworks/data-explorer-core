// Copyright 2026 The MathWorks, Inc.
//
// Inf, -Inf and NaN are ordinary MATLAB values, but their JavaScript spellings
// ('Infinity', '-Infinity') are not MATLAB literals — and MatlabValueParser
// deliberately rejects 'Infinity' on the way in, because accepting a
// non-MATLAB literal is the harmful direction. Those two facts together make
// String(num) a bug anywhere its result is shown to a user or written to a
// file: the value renders as text that cannot be typed back in, and a .sldd
// written that way holds an expression MATLAB cannot evaluate.
//
// The individual helpers are unit-tested in xmlUtils.test.ts (formatMatlabNum /
// parseMatlabNum) and propAtoms.test.ts (the display formatters). What this file
// pins is the property that made the sweep worth doing: whatever the UI shows,
// the user can retype. A regression here is silent — the value still displays,
// it just stops being editable — so it needs its own assertion rather than
// relying on the per-helper tests to imply it.
import { describe, it, expect } from 'vitest';
import ParameterNode from '../src/datamodel/node/data/ParameterNode.js';
import MatlabValueParser from '../src/datamodel/parser/MatlabValueParser.js';
import PropValue from '../src/datamodel/prop/PropValue.js';
import '../src/datamodel/node/NodeClassMap.js';

describe('a displayed non-finite value can be typed back in', () => {
  for (const [text, expected] of [
    ['Inf', Infinity],
    ['-Inf', -Infinity],
  ] as const) {
    it('round-trips a scalar ' + text + ' through set, display, and re-parse', () => {
      const p = ParameterNode.createDefault('p', null);
      expect(p.setProperty('Value', text)).toBe(true);
      // What the table cell shows.
      expect(p.displayValue).toBe(text);
      // And the parser accepts exactly that, yielding the same number — so a
      // user who retypes what they see gets the value they had.
      expect(MatlabValueParser.parse(p.displayValue)?.value).toBe(expected);
    });
  }

  it('round-trips NaN, which is only equal to itself by isNaN', () => {
    const p = ParameterNode.createDefault('p', null);
    expect(p.setProperty('Value', 'NaN')).toBe(true);
    expect(p.displayValue).toBe('NaN');
    expect(MatlabValueParser.parse('NaN')?.value).toBeNaN();
  });

  it('round-trips a vector holding non-finite elements', () => {
    const p = ParameterNode.createDefault('p', null);
    expect(p.setProperty('Value', '[1 Inf -Inf]')).toBe(true);
    expect(p.displayValue).toBe('[1 Inf -Inf]');
    expect(MatlabValueParser.parse(p.displayValue)?.value).toEqual([1, Infinity, -Infinity]);
  });

  it('keeps a matrix element non-finite, and its row structure intact', () => {
    // The matrix path stores the value as a Matrix(r,c) literal rather than a
    // plain array, so it exercises both the writer that spells the element and
    // the reader that splits the rows.
    const p = ParameterNode.createDefault('p', null);
    expect(p.setProperty('Value', '[1 Inf; NaN 4]')).toBe(true);
    expect(p.displayValue).toBe('[1 Inf; NaN 4]');
    const reread = MatlabValueParser.parse(p.displayValue);
    expect(reread?.dims).toEqual([2, 2]);
    expect((reread?.value as number[]).map((v) => (Number.isNaN(v) ? 'NaN' : v))).toEqual([
      1,
      Infinity,
      'NaN',
      4,
    ]);
  });

  it('never renders the JavaScript spelling, for any shape', () => {
    // A single guard against the whole class: if some path reverts to String(),
    // 'Infinity' shows up in the rendered text and this fails regardless of
    // which formatter regressed.
    const shapes: unknown[] = [Infinity, -Infinity, NaN, [Infinity], [1, -Infinity, NaN]];
    for (const shape of shapes) {
      expect(PropValue.format(shape)).not.toContain('Infinity');
    }
  });
});
