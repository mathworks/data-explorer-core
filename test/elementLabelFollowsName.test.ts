// Copyright 2026 The MathWorks, Inc.
//
// AN ELEMENT LABEL IS DERIVED FROM ITS PARENT'S NAME, SO IT MUST FOLLOW THAT NAME.
//
// A struct-array / object-array element has no name of its own: its row reads
// `parent(2,1)`, a subscript INTO the parent. Three parse sites used to bake that
// string once, at parse time, and store it on the element — so renaming the array
// left every element row spelling the old name (`oldName(1,1)` under a row now
// called `newName`), until the file was closed and read again.
//
// This is the repo's "one rule, two paths" class in its derived-value form: the
// label and the name it is derived from were two facts that could disagree. The
// rule pinned here is BETWEEN them — the label is not stored, it is asked for.
import { describe, it, expect } from 'vitest';
import StructNode from '../src/datamodel/node/data/StructNode.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import * as NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import '../src/datamodel/node/NodeClassMap.js';
import type { MatVariable } from '../src/datamodel/parser/MatParser.js';

type Any = any;

const labels = (node: Any): string[] => node.children.map((c: Any) => c.displayName);

// A struct array exactly as both sldd parsers hand it up.
const structValue = (dims: number[], elements: Record<string, unknown>[]) => ({
  _array_type: 'Struct',
  _dimensions: dims,
  _fields: Object.keys(elements[0]),
  _mw_element_type: 'MATLABArray',
  _elements: elements,
});

// A value object of N elements, as every parser emits it.
const objectValue = (arrayClass: string, dims: number[], props: Record<string, unknown>[]) => ({
  _array_class: arrayClass,
  _array_type: 'MATLABArray',
  _dimensions: dims,
  _mw_element_type: 'MATLABArray',
  _elements: props.map((p) => ({ _properties: p })),
});

// A .mat struct array as MatParser reports it: fields[f] is one MatVariable per
// element, in MATLAB's column-major order.
const matStructArray = (dims: number[], values: number[]): MatVariable => ({
  name: 's',
  className: 'struct',
  dimensions: dims,
  isComplex: false,
  isLogical: false,
  value: null,
  fields: {
    a: values.map((v) => ({
      name: 'a', className: 'double', dimensions: [1, 1],
      isComplex: false, isLogical: false, value: v, fields: null,
    })),
  } as never,
});

describe('an element label follows its parent\'s name', () => {
  it('relabels a struct VECTOR\'s elements when the array is renamed', () => {
    const node: Any = StructNode.parse(
      structValue([1, 3], [{ a: 1 }, { a: 2 }, { a: 3 }]) as Any,
      'structArray',
      null,
    );
    expect(labels(node)).toEqual(['structArray(1)', 'structArray(2)', 'structArray(3)']);

    expect(node.setProperty('Name', 'renamedArray')).toBe(true);

    expect(labels(node)).toEqual(['renamedArray(1)', 'renamedArray(2)', 'renamedArray(3)']);
  });

  it('relabels a struct MATRIX\'s elements, keeping MATLAB\'s column-major subscripts', () => {
    const node: Any = StructNode.parse(
      structValue([2, 2], [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]) as Any,
      'structMatrix',
      null,
    );
    expect(labels(node)).toEqual([
      'structMatrix(1,1)', 'structMatrix(2,1)', 'structMatrix(1,2)', 'structMatrix(2,2)',
    ]);

    expect(node.setProperty('Name', 'sm')).toBe(true);

    // Only the NAME changes: element 2 is still MATLAB's (2,1), and each label
    // still sits beside the value MATLAB stores at that subscript.
    expect(node.children.map((c: Any) => [c.displayName, c.children[0].displayValue])).toEqual([
      ['sm(1,1)', '1'], ['sm(2,1)', '2'], ['sm(1,2)', '3'], ['sm(2,2)', '4'],
    ]);
  });

  it('relabels an OBJECT array\'s elements when the array is renamed', () => {
    const node: Any = NodeRegistry.parseValue(
      objectValue('My.Thing', [1, 2], [{ Gain: 1 }, { Gain: 2 }]),
      'objArray',
      null,
    );
    expect(labels(node)).toEqual(['objArray(1)', 'objArray(2)']);

    expect(node.setProperty('Name', 'renamedObjs')).toBe(true);

    expect(labels(node)).toEqual(['renamedObjs(1)', 'renamedObjs(2)']);
  });

  it('relabels a .mat struct array\'s elements when the variable is renamed', () => {
    const node: Any = MatlabVariableNode.parseMatVariable(matStructArray([1, 3], [1, 2, 3]), 's', null);
    expect(labels(node)).toEqual(['s(1)', 's(2)', 's(3)']);

    expect(node.setProperty('Name', 'sv')).toBe(true);

    expect(labels(node)).toEqual(['sv(1)', 'sv(2)', 'sv(3)']);
  });

  it('keeps an element\'s Name cell read-only and marked as an element after a rename', () => {
    // The label being derived is also what makes the cell uneditable — losing the
    // marker would silently offer a rename that has nowhere to go.
    const node: Any = StructNode.parse(
      structValue([1, 2], [{ a: 1 }, { a: 2 }]) as Any,
      'structArray',
      null,
    );
    node.setProperty('Name', 'renamedArray');

    const element: Any = node.children[0];
    expect(element.isElementName).toBe(true);
    expect(element.nameEditable).toBe(false);
    const cell = element.toRow().Name as { label: string; editable: boolean; element: boolean };
    expect(cell.label).toBe('renamedArray(1)');
    expect(cell.editable).toBe(false);
    expect(cell.element).toBe(true);
    // And the model refuses one asked for directly, as it does for every fixed name.
    expect(element.setProperty('Name', 'nope')).toMatchObject({ error: true });
  });

  it('relabels a struct array nested inside a renamed entry\'s field', () => {
    // The label is a subscript into whatever the PARENT ROW reads, so a nested
    // array's elements move with the name above them too — one derivation, not a
    // special case per depth.
    const outer: Any = StructNode.parse(
      {
        _array_type: 'Struct',
        _dimensions: [1, 1],
        _fields: ['inner'],
        _mw_element_type: 'MATLABArray',
        _elements: [{ inner: structValue([1, 2], [{ a: 1 }, { a: 2 }]) }],
      } as Any,
      'outer',
      null,
    );
    const inner: Any = outer.children[0];
    expect(labels(inner)).toEqual(['inner(1)', 'inner(2)']);

    expect(inner.setProperty('Name', 'renamedField')).toBe(true);

    expect(labels(inner)).toEqual(['renamedField(1)', 'renamedField(2)']);
  });
});
