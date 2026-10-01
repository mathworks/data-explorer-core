// Copyright 2026 The MathWorks, Inc.
//
// A HUGE ARRAY IS NOT EXPANDED INTO ONE NODE PER ELEMENT — AND LOSES NOTHING BY IT.
//
// A dictionary entry holding a 1000x1000 double is 1,000,000 elements. Expanding
// one node per element cost 1,000,001 nodes and ~690 MB for a single entry, and
// the table built from it could not be rendered at all: the host's projection of
// that subtree is ~413 MB of rows. The file simply did not open.
//
// So an array past MAX_EXPANDED_ELEMENTS gets NO element children. That is the same
// decision the grid panel already makes above its own 4096-element cap, and it is
// deliberately NOT a ParseWarning: the value was read completely and is saved
// completely, so by ParseWarning's own rule ("a reader that meets the limit of the
// FILE has read it correctly and must stay quiet") there is nothing to report.
//
// The invariant that makes this safe is the one matlabVariableNode.test.ts states:
// `_elements` and the child nodes are two copies of the same data, and `_elements`
// is authoritative whenever children are absent. So the cap must be ALL-OR-NOTHING.
// A PARTIALLY expanded array would be read through its children by `Value` and by
// every serializer (`children.length > 0 ? children.map(...) : this._elements`) and
// would silently save the first N elements as the whole value — a data loss far
// worse than a slow open. Hence `expandsNothing`, and hence the fidelity tests
// below rather than a node count alone.
import { describe, it, expect } from 'vitest';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import { MAX_EXPANDED_ELEMENTS } from '../src/datamodel/display/DisplayConvention.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const parse = (raw: unknown, name = 'v'): Any => MatlabVariableNode.parse(raw, name, null);

// A 1xN double literal, the shape both .sldd parsers hand up for a row vector.
const rowVector = (n: number) => {
  const vals: number[] = new Array(n);
  for (let i = 0; i < n; i++) vals[i] = i + 1;
  return { _type: 'double', _value: 'Matrix(1,' + n + ')\n[' + vals.join(', ') + ']' };
};

describe('MAX_EXPANDED_ELEMENTS', () => {
  it('sits above the host grid cap of 4096, so every griddable matrix still expands', () => {
    // The host grids a matrix only when `children.length === elementCount` and the
    // count is <= 4096 (data-explorer-vscode matrixPayload.isGriddable). A cap at or
    // below 4096 would leave a griddable matrix with no children and silently kill
    // the grid for the very matrices it is for.
    expect(MAX_EXPANDED_ELEMENTS).toBeGreaterThan(4096);
  });
});

describe('an array past the cap', () => {
  it('builds no element children at all', () => {
    const n = parse(rowVector(MAX_EXPANDED_ELEMENTS + 1));
    expect(n._kind).toBe('array');
    expect(n.children.length).toBe(0);
  });

  it('still holds every element, so the Value getter is complete', () => {
    const count = MAX_EXPANDED_ELEMENTS + 1;
    const n = parse(rowVector(count));
    expect(n._elements.length).toBe(count);
    expect((n.Value as number[]).length).toBe(count);
    expect((n.Value as number[])[count - 1]).toBe(count);
  });

  it('still serializes every element back to XML', () => {
    const count = MAX_EXPANDED_ELEMENTS + 1;
    const xml = parse(rowVector(count)).serializeXml('P', { Name: 'Value' }, 0);
    expect(xml).toContain('Dimension="1*' + count + '"');
    // The last element has to be in the bytes: an unexpanded array that saved only
    // what it expanded would be the data loss this cap exists to avoid.
    expect(xml).toContain(String(count));
    expect(xml).not.toContain('Dimension="0*0"');
  });

  it('still summarizes its shape in the Value column', () => {
    const n = parse(rowVector(MAX_EXPANDED_ELEMENTS + 1));
    expect(n.displayValue).toContain(String(MAX_EXPANDED_ELEMENTS + 1));
  });
});

describe('an array at the cap', () => {
  it('expands every element, so the boundary is inclusive', () => {
    const n = parse(rowVector(MAX_EXPANDED_ELEMENTS));
    expect(n.children.length).toBe(MAX_EXPANDED_ELEMENTS);
  });
});

describe('a cell array past the cap', () => {
  it('is expanded anyway, because its children are its ONLY copy', () => {
    // _buildCellChildren takes its elements as an argument and keeps no `_elements`
    // backing: a cell element is a whole node, not a scalar. With no children,
    // _serializeCellXml writes `Dimension="0*0"` — it would destroy the value. The
    // cap therefore does not apply to cells, and this test is what says so.
    const count = MAX_EXPANDED_ELEMENTS + 1;
    const elements: unknown[] = new Array(count);
    for (let i = 0; i < count; i++) elements[i] = i + 1;
    const n = parse({ _array_type: 'Cell', _dimensions: [1, count], _elements: elements });
    expect(n._kind).toBe('cell');
    expect(n.children.length).toBe(count);
  });
});

describe('an element label', () => {
  // BaseNode.displayName derived an element's subscript from
  // `parent.children.indexOf(this)` — an O(n) scan per element, so O(n^2) per array.
  // Measured on the 1000x1000 entry: 1.5 us at index 0 rising to 325 us at index
  // 999,999, ~161 s in total. The replacement is O(1) but SELF-VERIFYING: it trusts
  // the maintained 1-based `name` only when that slot really holds this node, and
  // falls back to the scan when it does not. These two tests pin both halves.
  it('is correct at a high index in a non-square array', () => {
    // Non-square on purpose: a square array labels the same either way, which is
    // how the row-major/column-major bug this file's sibling pins went unnoticed.
    const n = parse({ _type: 'double', _value: 'Matrix(2,3)\n[[1, 2, 3]; [4, 5, 6]]' });
    expect(n.children.map((c: Any) => c.displayName)).toEqual([
      'v(1,1)', 'v(1,2)', 'v(1,3)', 'v(2,1)', 'v(2,2)', 'v(2,3)',
    ]);
  });

  it('costs no scan of the parent, so labelling N elements is O(N) not O(N^2)', () => {
    // The assertion is a COUNT, not a clock: a wall-time threshold for a quadratic
    // this file also caps would be both flaky and redundant. Zero scans is the real
    // invariant, and it is the one the struct/object-element path below has always
    // had (it reads a stored `_subscript.index`) — measured 2000x faster on the same
    // array, which is what identified this as the 161 seconds.
    const n = parse(rowVector(2000));
    let scans = 0;
    const realIndexOf = n.children.indexOf.bind(n.children);
    n.children.indexOf = (x: Any) => {
      scans++;
      return realIndexOf(x);
    };
    const labels = n.children.map((c: Any) => c.displayName);
    expect(labels[0]).toBe('v(1)');
    expect(labels[1999]).toBe('v(2000)');
    expect(scans).toBe(0);
  });

  it('stays correct when a child sits at a slot its name does not predict', () => {
    // The fallback. Reordering children WITHOUT reindexing their names is what a
    // stale stamped index would get wrong; the label must still describe where the
    // node actually is, because the label is what pairs a row with its value.
    // 2x3, not a vector: a vector takes ONE subscript (the `spread >= 2` rule), so it
    // cannot show a row/column mix-up.
    const n = parse({ _type: 'double', _value: 'Matrix(2,3)\n[[1, 2, 3]; [4, 5, 6]]' });
    const first = n.children[0];
    const last = n.children[5];
    n.children[0] = last;
    n.children[5] = first;
    // The label is a function of the slot, not of the node that used to sit in it.
    expect(n.children.map((c: Any) => c.displayName)).toEqual([
      'v(1,1)', 'v(1,2)', 'v(1,3)', 'v(2,1)', 'v(2,2)', 'v(2,3)',
    ]);
    expect([first.displayName, last.displayName]).toEqual(['v(2,3)', 'v(1,1)']);
  });
});
