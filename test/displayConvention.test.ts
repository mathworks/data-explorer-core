// Copyright 2026 The MathWorks, Inc.
//
// The display convention's arithmetic, in isolation. These pin the RULES; the
// rendered strings are pinned by test/matlabVariableNode.test.ts and by the
// parity suite against MATLAB truth.
import { describe, it, expect } from 'vitest';
import {
  SUMMARY_MAX_CHARS,
  SUMMARY_MAX_ELEMENTS,
  EMPTY_NUMERIC,
  EMPTY_CELL,
  effectiveDims,
  elementCount,
  needsSummary,
  overCharBudget,
  summaryForm,
} from '../src/datamodel/display/DisplayConvention.js';

describe('DisplayConvention constants', () => {
  it('keeps the two thresholds the spec agreed', () => {
    expect(SUMMARY_MAX_CHARS).toBe(1000);
    expect(SUMMARY_MAX_ELEMENTS).toBe(10);
  });

  it('spells empty with a space inside, both brackets', () => {
    expect(EMPTY_NUMERIC).toBe('[ ]');
    expect(EMPTY_CELL).toBe('{ }');
  });
});

describe('effectiveDims', () => {
  it('drops trailing singletons past the second, as MATLAB size() does', () => {
    expect(effectiveDims([2, 3, 1])).toEqual([2, 3]);
    expect(effectiveDims([2, 3, 1, 1])).toEqual([2, 3]);
  });

  it('keeps a real trailing extent and keeps interior singletons', () => {
    expect(effectiveDims([2, 3, 2])).toEqual([2, 3, 2]);
    expect(effectiveDims([2, 1, 2])).toEqual([2, 1, 2]);
  });

  it('normalizes degenerate input to a 2-D pair', () => {
    expect(effectiveDims([])).toEqual([1, 1]);
    expect(effectiveDims([5])).toEqual([1, 5]);
    expect(effectiveDims([1, 1])).toEqual([1, 1]);
  });
});

describe('elementCount', () => {
  it('multiplies every extent, including pages', () => {
    expect(elementCount([2, 3])).toBe(6);
    expect(elementCount([2, 3, 2])).toBe(12);
    expect(elementCount([0, 0])).toBe(0);
    expect(elementCount([1, 1])).toBe(1);
  });
});

describe('needsSummary', () => {
  it('is true for rank >= 3 at ANY size — mat2str itself has no literal for it', () => {
    expect(needsSummary([2, 2, 2])).toBe(true);
    expect(needsSummary([1, 1, 2])).toBe(true);
  });

  it('treats a trailing singleton as rank 2, not rank 3', () => {
    expect(needsSummary([2, 3, 1])).toBe(false);
  });

  it('is false at the element budget and true one past it', () => {
    expect(needsSummary([1, 10])).toBe(false);
    expect(needsSummary([1, 11])).toBe(true);
    expect(needsSummary([2, 5])).toBe(false);
    expect(needsSummary([3, 4])).toBe(true);
  });
});

describe('overCharBudget', () => {
  it('is false at the char budget and true one past it', () => {
    expect(overCharBudget('x'.repeat(SUMMARY_MAX_CHARS))).toBe(false);
    expect(overCharBudget('x'.repeat(SUMMARY_MAX_CHARS + 1))).toBe(true);
  });
});

describe('summaryForm', () => {
  it('always uses angle brackets — the italic and non-editable signal', () => {
    expect(summaryForm([1, 30], 'double')).toBe('<1x30 double>');
    expect(summaryForm([2, 3, 2], 'double')).toBe('<2x3x2 double>');
    expect(summaryForm([1, 3], 'cell')).toBe('<1x3 cell>');
    expect(summaryForm([0, 0], 'struct')).toBe('<0x0 struct>');
  });

  it('spells the shape the way MATLAB size() would', () => {
    expect(summaryForm([2, 3, 1], 'double')).toBe('<2x3 double>');
  });
});
