// Copyright 2026 The MathWorks, Inc.
//
// What icon a CONTAINER row draws with, and the MATLAB semantics that decide it.
//
// A MATLAB array or matrix is HOMOGENEOUS: every element is the same type, so the
// container row and its element rows are rows about the same kind of thing and must
// draw as one — a 1x3 Simulink.Parameter reads as parameters all the way down, a
// logical array as checkboxes all the way down. A CELL is the exception, and not a
// missing case of the same rule: a cell is its own MATLAB type whose elements can
// each be anything, so its container keeps the cell glyph and inherits nothing —
// there is no element type to inherit FROM.
//
// The two halves are spread over node classes that know nothing of each other
// (MatlabVariableNode for numeric/logical/cell, ObjectNode for objects, StructNode
// for structs), and each has its own per-class icon test asserting its own literal —
// so none of them can catch the rule being applied to the wrong half. That is what
// this file is for. ObjectNode's container did draw the generic object glyph over
// three branded element rows until the array branch in its `icon` getter; a "fix"
// that reached the same inheritance into the cell container would be the opposite
// error, and this pins both edges of it.

import { describe, it, expect } from 'vitest';
// Importing the class map registers the NodeRegistry every case dispatches through.
import '../src/datamodel/node/NodeClassMap.js';
import * as NodeRegistry from '../src/datamodel/node/NodeRegistry.js';

interface IconNode { icon: string; className: string; children: IconNode[] }
const parse = (raw: unknown, name = 'v'): IconNode =>
  NodeRegistry.parseValue(raw, name, null) as unknown as IconNode;

// Container-and-elements, as one list: the homogeneous cases must come out uniform.
const column = (n: IconNode): string[] => [n.icon, ...n.children.map((c) => c.icon)];

// One entry per kind of homogeneous MATLAB array, in the shape a parser emits.
const HOMOGENEOUS: [string, unknown, string][] = [
  ['a double array', [1, 2, 3], 'wsDefault'],
  ['a logical array', { _type: 'logical', _value: '[1, 0, 1]' }, 'wsCheck'],
  [
    'a struct array',
    { _array_type: 'Struct', _dimensions: [1, 2], _fields: ['a'], _elements: [{ a: 1 }, { a: 2 }] },
    'wsTree',
  ],
  [
    'an object array of a branded class',
    {
      _array_class: 'Simulink.Parameter',
      _array_type: 'MATLABArray',
      _dimensions: [1, 3],
      _mw_element_type: 'MATLABArray',
      _elements: [{ _properties: { Value: 1 } }, { _properties: { Value: 2 } }, { _properties: { Value: 3 } }],
    },
    'wsParameters',
  ],
  [
    'an object array of a class with no icon of its own',
    {
      _array_class: 'Acme.Thing',
      _array_type: 'MATLABArray',
      _dimensions: [1, 2],
      _mw_element_type: 'MATLABArray',
      _elements: [{ _properties: { A: 1 } }, { _properties: { A: 2 } }],
    },
    'ws3d',
  ],
];

describe('a homogeneous array draws as one thing, container row included', () => {
  it.each(HOMOGENEOUS)('%s', (_label, raw, icon) => {
    const n = parse(raw);
    // Every row, not just the container: the point is that they AGREE, so an
    // assertion on the container alone would pass while the elements drifted.
    expect(n.children.length).toBeGreaterThan(1);
    expect(column(n)).toEqual(column(n).map(() => icon));
  });

  it('gives an array the same icon as the SCALAR of its type', () => {
    // The scalar is the reference answer — nothing may make a 1x3 of a type look
    // like a different kind of thing from a 1x1 of it.
    for (const [raw, scalar] of [
      [HOMOGENEOUS[0][1], 1],
      [HOMOGENEOUS[1][1], true],
    ] as [unknown, unknown][]) {
      expect(parse(raw).icon).toBe(parse(scalar).icon);
    }
  });
});

describe('a cell is its own type, so its container inherits nothing', () => {
  // {int32(5), 'text', Simulink.Parameter} — three unrelated types in one cell,
  // which is exactly what a cell is FOR and what an array cannot be.
  const heterogeneous = {
    _array_type: 'Cell',
    _dimensions: [1, 3],
    _mw_element_type: 'MATLABCell',
    _elements: [
      { _type: 'int32', _value: '5' },
      'text',
      {
        _array_class: 'Simulink.Parameter',
        _array_type: 'MATLABArray',
        _dimensions: [1, 1],
        _mw_element_type: 'MATLABArray',
        _elements: [{ _properties: { Value: 7 } }],
      },
    ],
  };

  it('keeps the cell glyph over elements that each draw as themselves', () => {
    const n = parse(heterogeneous);
    expect(n.className).toBe('cell');
    expect(n.icon).toBe('wsBrackets');
    // The elements deliberately disagree with each other, so there is no single
    // element icon the container could have taken even if it wanted to.
    expect(n.children.map((c) => c.icon)).toEqual(['wsDefault', 'wsCharacter', 'wsParameters']);
  });

  it('keeps it even when every element HAPPENS to be the same type', () => {
    // A cell of three doubles is still a cell, not a double array: the type is a
    // property of the container, not something inferred from what is in it today.
    const n = parse({
      _array_type: 'Cell', _dimensions: [1, 3], _mw_element_type: 'MATLABCell', _elements: [1, 2, 3],
    });
    expect([n.icon, ...n.children.map((c) => c.icon)]).toEqual(['wsBrackets', 'wsDefault', 'wsDefault', 'wsDefault']);
  });
});
