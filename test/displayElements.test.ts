// Copyright 2026 The MathWorks, Inc.
//
// EVERY ELEMENT'S LABEL AND VALUE, WHETHER OR NOT THE ARRAY WAS EXPANDED.
//
// MAX_EXPANDED_ELEMENTS (see largeArrayNotExpanded.test.ts) stops a huge array from
// becoming one node per element. That was the right call for the TABLE — a million
// rows cannot be rendered and nobody scrolls them — but it also removed the only
// channel a consumer had for reading element-by-element display text, because that
// text was read off the child nodes. The Variable Editor grid is exactly such a
// consumer: it is read-only, it is opened deliberately, and it wants the whole
// matrix at once.
//
// So the element display text is now an ACCESSOR over `_elements`, not a by-product
// of expansion. The invariant this file exists to pin is that it is the SAME text:
// where children exist, the accessor must agree with them element for element. One
// rule, two paths — and the test that matters is the one BETWEEN the paths, not
// either one alone. Nothing here may create a child: an accessor that expanded the
// array to answer would undo the cap it exists to work around.
import { describe, it, expect } from 'vitest';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import { MAX_EXPANDED_ELEMENTS } from '../src/datamodel/display/DisplayConvention.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const parse = (raw: unknown, name = 'v'): Any => MatlabVariableNode.parse(raw, name, null);

// A rows x cols double literal, sequential in ROW-major reading order — the shape
// both .sldd parsers hand up, and the order `_elements` holds for a numeric.
const matrix = (rows: number, cols: number) => {
  const lines: string[] = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const row: number[] = new Array(cols);
    for (let c = 0; c < cols; c++) row[c] = r * cols + c + 1;
    lines[r] = '[' + row.join(', ') + ']';
  }
  return { _type: 'double', _value: 'Matrix(' + rows + ',' + cols + ')\n[' + lines.join('; ') + ']' };
};

// What the child nodes say, for the comparison that is the whole point.
const fromChildren = (n: Any) =>
  n.children.map((c: Any) => ({ label: c.displayName, value: c.displayValue }));

describe('displayElements, where the array WAS expanded', () => {
  it('says exactly what the element children say', () => {
    // Non-square on purpose: a square array labels the same under either element
    // order, which is how the row-major/column-major defect in these labels went
    // unnoticed once already (see cellElementOrder.test.ts).
    const n = parse(matrix(2, 3));
    expect(n.children.length).toBe(6);
    expect(n.displayElements()).toEqual(fromChildren(n));
  });

  it('agrees with the children of a string array too, brackets and order included', () => {
    const n = parse({ _array_type: 'String', _dimensions: [2, 3], _elements: ['a', 'd', 'b', 'e', 'c', 'f'] });
    expect(n.children.length).toBe(6);
    expect(n.displayElements()).toEqual(fromChildren(n));
  });

  it('agrees with the children of a cell array, which are its only copy', () => {
    const n = parse({ _array_type: 'Cell', _dimensions: [2, 3], _elements: [1, 4, 2, 5, 3, 6] });
    expect(n.children.length).toBe(6);
    expect(n.displayElements()).toEqual(fromChildren(n));
  });
});

describe('displayElements, where the array was NOT expanded', () => {
  const ROWS = 100;
  const COLS = 103; // 10,300 — past the cap, and not square.

  it('still answers for every element', () => {
    const n = parse(matrix(ROWS, COLS));
    expect(n.children.length).toBe(0);
    expect(n.displayElements().length).toBe(ROWS * COLS);
  });

  it('labels them row-major, the order `_elements` is in for a numeric', () => {
    const els = parse(matrix(ROWS, COLS)).displayElements();
    expect(els[0]).toEqual({ label: 'v(1,1)', value: '1' });
    expect(els[1]).toEqual({ label: 'v(1,2)', value: '2' });
    expect(els[COLS]).toEqual({ label: 'v(2,1)', value: String(COLS + 1) });
    expect(els[ROWS * COLS - 1]).toEqual({
      label: 'v(' + ROWS + ',' + COLS + ')',
      value: String(ROWS * COLS),
    });
  });

  it('labels a string array column-major, with round brackets', () => {
    const count = MAX_EXPANDED_ELEMENTS + 2; // even, so it has a 2 x N/2 shape
    const elements: string[] = new Array(count);
    for (let i = 0; i < count; i++) elements[i] = 's' + (i + 1);
    const n = parse({ _array_type: 'String', _dimensions: [2, count / 2], _elements: elements });
    expect(n.children.length).toBe(0);
    const els = n.displayElements();
    expect(els.length).toBe(count);
    // Column-major: the first two elements are the first COLUMN.
    expect(els[0].label).toBe('v(1,1)');
    expect(els[1].label).toBe('v(2,1)');
    expect(els[2].label).toBe('v(1,2)');
    expect(els[0].value).toBe('"s1"');
  });

  it('formats a complex array\'s elements as complex, not as plain doubles', () => {
    // The one container whose elements are NOT of its own class: `_scalarType` is
    // 'double' because that is what it serializes as, while each element is a
    // 'complex' scalar. Expansion was told so by its caller; with no expansion to
    // tell, the node has to have remembered.
    //
    // Asserted ACROSS the two paths rather than against a literal, which is the only
    // form of this test that cannot pass while being wrong: whatever a small complex
    // array's element children display, a huge one's elements must display too.
    const cdata = (parts: string[], dims: number[]) => ({
      _type: 'cdata',
      _value: parts.join(' '),
      _dimensions: dims,
    });
    const small = parse(cdata(['1.0+2.0i', '3.0-4.0i'], [1, 2]));
    expect(small.children.length).toBe(2);
    const expected = small.children[0].displayValue;
    expect(expected).toContain('i');

    const count = MAX_EXPANDED_ELEMENTS + 1;
    const parts: string[] = new Array(count);
    for (let i = 0; i < count; i++) parts[i] = '1.0+2.0i';
    const big = parse(cdata(parts, [1, count]));
    expect(big.children.length).toBe(0);
    const els = big.displayElements();
    expect(els.length).toBe(count);
    expect(els[0].value).toBe(expected);
  });

  it('creates no children, so asking does not undo the cap', () => {
    const n = parse(matrix(ROWS, COLS));
    n.displayElements();
    n.displayElements();
    expect(n.children.length).toBe(0);
    // And the value itself is untouched by having been read for display.
    expect((n.Value as number[]).length).toBe(ROWS * COLS);
  });
});

describe('displayElements, where there are no elements', () => {
  it('is null for a scalar', () => {
    expect(parse(42).displayElements()).toBeNull();
  });

  it('is null for a struct, whose children are fields and not elements', () => {
    expect(parse({ a: 1, b: 2 }).displayElements()).toBeNull();
  });

  it('is an empty list for an empty array, which has a shape but no elements', () => {
    expect(parse({ _type: 'double', _emptyDims: [0, 0] }).displayElements()).toEqual([]);
  });
});
