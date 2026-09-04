// Copyright 2026 The MathWorks, Inc.
// Unit tests for ObjectNode — the generic node for a MATLAB class instance whose
// class the data model has no typed node for (Simulink.VariableUsage, a user
// class, …). Two things make it delicate. Its children are CLASS PROPERTIES, not
// struct fields, so their names are fixed by the class definition; and it has to
// write back — a loaded object emits its raw value verbatim unless serializeValue
// rebuilds the property bag from the live child nodes (issue #3), which silently
// discards edits.

import { describe, it, expect } from 'vitest';
// Importing the class map registers the NodeRegistry the element dispatch uses.
import '../src/datamodel/node/NodeClassMap.js';
import ObjectNode from '../src/datamodel/node/data/ObjectNode.js';

// A top-level value object: { _array_class, _elements: [{ _properties }] }.
function valueObject(cls: string, elements: Record<string, unknown>[], dimensions?: number[]) {
  return {
    _array_class: cls,
    _array_type: 'MATLABArray',
    _dimensions: dimensions ?? [1, elements.length],
    _mw_element_type: 'MATLABArray',
    _elements: elements.map((props) => ({ _properties: props })),
  };
}

const parse = (raw: Record<string, unknown>, name = 'obj') => ObjectNode.parse(raw, name, null) as any;

describe('ObjectNode — scalar object', () => {
  it('expands its properties as children', () => {
    const n = parse(valueObject('Simulink.VariableUsage', [{ Name: 'Ka', Source: 'f14' }]));
    expect(n.className).toBe('Simulink.VariableUsage');
    expect(n.children.map((c: any) => c.name)).toEqual(['Name', 'Source']);
  });

  it('also accepts the nested-object shape, which has no _elements wrapper', () => {
    // Reached when a struct field or cell element is itself an object; both shapes
    // must expand identically or a nested object stops opening in the tree.
    const n = parse({ _object_class: 'My.Thing', _properties: { A: 1, B: 'x' } });
    expect(n.className).toBe('My.Thing');
    expect(n.children.map((c: any) => c.name)).toEqual(['A', 'B']);
  });

  it('shows a dimensions-and-class summary instead of a value', () => {
    // An object has no scalar value to print, so the cell describes its shape;
    // the angle brackets are what makes BaseNode treat it as non-editable.
    const n = parse(valueObject('My.Thing', [{ A: 1 }]));
    expect(n.displayValue).toBe('<1x1 My.Thing>');
    expect(n.valueEditable).toBe(false);
  });

  it('reads 1x1 when the value carries no dimensions vector', () => {
    // A nested object has no _dimensions key; it is a scalar by construction.
    expect(parse({ _object_class: 'Z', _properties: {} }).displayValue).toBe('<1x1 Z>');
    expect(parse({ _array_class: 'Z', _elements: [] }).displayValue).toBe('<1x1 Z>');
  });

  it('marks its children as class properties, so none can be renamed', () => {
    // A struct field can be renamed; a class property cannot — its name is part
    // of the class definition.
    const n = parse(valueObject('My.Thing', [{ A: 1 }]));
    expect(n.isObjectPropertyBag).toBe(true);
    expect(n.children[0].nameEditable).toBe(false);
  });

  it('uses the generic object icon, and the service-interface icon when derived', () => {
    const n = parse(valueObject('Simulink.ServiceBus', [{}]));
    expect(n.icon).toBe('wsDefault');
    // A derived Simulink.ServiceBus is Architectural Data, not a plain object.
    n.metadata = { isderived: '1' };
    expect(n.icon).toBe('serviceInterfaces');
  });

  it('offers the object property set in the table and inspector', () => {
    const n = parse(valueObject('My.Thing', [{ A: 1 }]));
    expect(n.getProperties().map((p: any) => p.key)).toEqual(['Name', 'Value', 'DataType', 'Description']);
    expect(n.getPILayout()).toEqual([
      { group: 'General', items: expect.arrayContaining(n.getProperties()) },
    ]);
    // Kind and Class are inspector-only, so they appear in the PI layout but the
    // table gets them from toRow's own fallbacks.
    expect(n.getPILayout()[0].items.map((p: any) => p.key)).toEqual([
      'Name', 'Value', 'DataType', 'Kind', 'Class', 'Description',
    ]);
  });
});

describe('ObjectNode — object array', () => {
  it('expands one element child per array element, named by subscript', () => {
    const n = parse(valueObject('Simulink.VariableUsage', [{ Name: 'Ka' }, { Name: 'Kf' }], [2, 1]), 'usages');
    expect(n._isElementArray).toBe(true);
    expect(n.children.map((c: any) => c.displayName)).toEqual(['usages(1)', 'usages(2)']);
    // Each element expands into its own property rows.
    expect(n.children[0].children.map((c: any) => c.name)).toEqual(['Name']);
  });

  it('grays element names, since a subscript is not a user-assigned identifier', () => {
    const n = parse(valueObject('My.Thing', [{ A: 1 }, { A: 2 }], [2, 1]), 'arr');
    expect(n.children.map((c: any) => c.isElementName)).toEqual([true, true]);
  });

  it('uses row,column subscripts for a matrix, in MATLAB column-major order', () => {
    // The element list arrives in MATLAB's own order, so element 2 is m(2,1).
    const n = parse(valueObject('My.Thing', [{ N: 1 }, { N: 2 }, { N: 3 }, { N: 4 }], [2, 2]), 'm');
    expect(n.children.map((c: any) => c.displayName)).toEqual(['m(1,1)', 'm(2,1)', 'm(1,2)', 'm(2,2)']);
  });

  it('routes each element back through the registry, so a known class stays typed', () => {
    // An array of Simulink.Parameter must produce ParameterNodes, exactly as a
    // standalone scalar parameter would — the array wrapper must not downgrade
    // elements to generic objects.
    const n = parse(valueObject('Simulink.Parameter', [{ Value: 1 }, { Value: 2 }], [2, 1]), 'arr');
    expect(n.children.map((c: any) => c.constructor.name)).toEqual(['ParameterNode', 'ParameterNode']);
  });

  it('treats a single-element array as a scalar, expanding properties directly', () => {
    // A 1x1 object is not an array: its properties are the rows the user sees.
    const n = parse(valueObject('My.Thing', [{ A: 1 }]));
    expect(n._isElementArray).toBeUndefined();
    expect(n.children.map((c: any) => c.name)).toEqual(['A']);
  });

  it('expands nothing for an empty object or an empty array', () => {
    expect(parse({ _array_class: 'X', _elements: [] }).children).toEqual([]);
    expect(parse({ _array_class: 'X' }).children).toEqual([]);
    expect(parse({ _object_class: 'Y' }).children).toEqual([]);
  });
});

describe('ObjectNode.serializeValue', () => {
  it('rebuilds _properties from the live children after an edit', () => {
    // Without this the loaded raw value is emitted verbatim and the edit vanishes.
    const n = parse(valueObject('My.Thing', [{ A: 1, B: 'x' }]));
    expect(n.children[0].setProperty('Value', '42')).toBe(true);
    expect(n.serializeValue()).toMatchObject({
      _array_class: 'My.Thing',
      _elements: [{ _properties: { A: 42, B: 'x' } }],
    });
  });

  it('keeps the element identity keys the dictionary uses', () => {
    // `_id` is the dictionary's handle for the object; dropping it on write-back
    // would orphan the entry.
    const raw = {
      _array_class: 'My.Thing',
      _array_type: 'MATLABArray',
      _dimensions: [1, 1],
      _mw_element_type: 'MATLABArray',
      _elements: [{ _id: 'e0', _properties: { A: 1 } }],
    };
    const n = parse(raw);
    n.children[0].setProperty('Value', '2');
    const out = n.serializeValue() as any;
    expect(out._elements[0]._id).toBe('e0');
    expect(out._mw_element_type).toBe('MATLABArray');
  });

  it('keeps the nested-object shape when writing a nested object back', () => {
    const n = parse({ _object_class: 'My.Thing', _properties: { A: 1 } });
    n.children[0].setProperty('Value', '9');
    expect(n.serializeValue()).toEqual({ _object_class: 'My.Thing', _properties: { A: 9 } });
  });

  it('returns the raw value untouched when nothing was expanded', () => {
    // An empty object has no children to rebuild from, so the loaded value is
    // still the most accurate thing to write.
    const raw = { _array_class: 'X', _elements: [] };
    expect(parse(raw).serializeValue()).toBe(raw);
  });

  it('rebuilds one entry per element for an array, editing only the touched one', () => {
    const n = parse(valueObject('My.Thing', [{ N: 1 }, { N: 2 }], [2, 1]), 'arr');
    n.children[0].children[0].setProperty('Value', '99');
    expect(n.serializeValue()).toMatchObject({
      _dimensions: [2, 1],
      _elements: [{ _properties: { N: 99 } }, { _properties: { N: 2 } }],
    });
  });

  it('normalises a typed element back to a bare property bag', () => {
    // A ParameterNode serializes as { _array_class, _elements: [{_properties}] };
    // nesting that whole wrapper inside the outer array would double-wrap it.
    const n = parse(valueObject('Simulink.Parameter', [{ Value: 1 }, { Value: 2 }], [2, 1]), 'arr');
    n.children[0].setProperty('Value', '5');
    expect(n.serializeValue()).toMatchObject({
      _array_class: 'Simulink.Parameter',
      _elements: [{ _properties: { Value: 5 } }, { _properties: { Value: 2 } }],
    });
  });
});

describe('ObjectNode.serializeXml', () => {
  it('emits one <Element> per array element, with a Dimension attribute', () => {
    const n = parse(valueObject('Simulink.VariableUsage', [{ Name: 'Ka' }, { Name: 'Kf' }], [2, 1]), 'usages');
    expect(n.serializeXml('P', { Name: 'usages' }, 0)).toBe(
      '<P Name="usages" Dimension="2*1">\n' +
        '    <Element Class="Simulink.VariableUsage">\n' +
        '        <P Name="Name" Class="char">Ka</P>\n' +
        '    </Element>\n' +
        '    <Element Class="Simulink.VariableUsage">\n' +
        '        <P Name="Name" Class="char">Kf</P>\n' +
        '    </Element>\n' +
        '</P>',
    );
  });

  it('derives the Dimension from the element count when the value carries none', () => {
    const n = parse({ _array_class: 'My.Thing', _elements: [{ _properties: {} }, { _properties: {} }] }, 'arr');
    expect(n.serializeXml('P', undefined, 0)).toContain('<P Dimension="2*1">');
  });

  it('falls back to the single-element form for a scalar object', () => {
    // Only an array needs the multi-<Element> shape; a scalar must keep emitting
    // exactly what DataNode writes, or a round-trip would change the file.
    const n = parse(valueObject('My.Thing', [{ A: 1 }]));
    expect(n.serializeXml('P', { Name: 'obj' }, 0)).not.toContain('Dimension=');
  });
});
