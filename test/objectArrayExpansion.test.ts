// Copyright 2026 The MathWorks, Inc.
//
// General array-expansion rule: a value object with MORE THAN ONE element is a
// vector/matrix of objects and MUST expand in two levels — first into N element
// rows (name(1), name(2), …), then each element into its own rows. This holds for
//   • ANY class: a KNOWN Simulink class (Simulink.Parameter → each element a typed
//     ParameterNode) OR a CUSTOM class (Simulink.VariableUsage → each element a
//     generic ObjectNode).
// The rule lives in NodeClassMap.parseValue (format-independent), so this unit
// suite over the value-object shape proves the routing. Per-format fixtures (that
// each parser hands the same shape up) are covered by the extension's integration
// tests and by objectExpansion.test.ts's authentic .mat fixtures.
import { describe, it, expect } from 'vitest';
import * as NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import '../src/datamodel/node/NodeClassMap.js';

// A value object of N elements, exactly as every parser emits it.
function arrayValue(arrayClass: string, dims: number[], elements: Record<string, unknown>[]) {
  return {
    _array_class: arrayClass,
    _array_type: 'MATLABArray',
    _dimensions: dims,
    _mw_element_type: 'MATLABArray',
    _elements: elements.map((p) => ({ _properties: p })),
  };
}

// ---- Format-independent routing (the rule itself) -------------------------------
describe('general array rule — NodeClassMap.parseValue routing (format-independent)', () => {
  it('routes a KNOWN-class array to an ObjectNode container whose elements are typed nodes', () => {
    const val = arrayValue('Simulink.Parameter', [3, 1], [
      { Value: 10 },
      { Value: 20 },
      { Value: 30 },
    ]);
    const node = NodeRegistry.parseValue(val, 'p', null);
    // The container is an ObjectNode (array), NOT a single ParameterNode.
    expect(node.constructor.name).toBe('ObjectNode');
    expect(node.children).toHaveLength(3);
    expect(node.displayValue).toBe('<3x1 Simulink.Parameter>');
    // Each element is a KNOWN typed node (ParameterNode), labeled p(i).
    node.children.forEach((child: any, i: number) => {
      expect(child.constructor.name).toBe('ParameterNode');
      expect(child._displayName).toBe(`p(${i + 1})`);
    });
    expect((node.children[1] as any).Value).toBe(20);
  });

  it('routes a CUSTOM-class array to an ObjectNode container whose elements are ObjectNodes', () => {
    const val = arrayValue('Simulink.VariableUsage', [2, 1], [
      { Name: ['Ka'] },
      { Name: ['Kf'] },
    ]);
    const node = NodeRegistry.parseValue(val, 'u', null);
    expect(node.constructor.name).toBe('ObjectNode');
    expect(node.children).toHaveLength(2);
    node.children.forEach((child: any, i: number) => {
      expect(child.constructor.name).toBe('ObjectNode');
      expect(child._displayName).toBe(`u(${i + 1})`);
    });
  });

  it('leaves a SINGLE-element value object as its own scalar typed node (no array wrapper)', () => {
    const val = arrayValue('Simulink.Parameter', [1, 1], [{ Value: 7 }]);
    const node = NodeRegistry.parseValue(val, 'p', null);
    expect(node.constructor.name).toBe('ParameterNode');
    expect((node as any).Value).toBe(7);
  });

  it('labels a 2x2 matrix of objects in MATLAB column-major order', () => {
    const val = arrayValue('Simulink.Parameter', [2, 2], [
      { Value: 1 }, { Value: 2 }, { Value: 3 }, { Value: 4 },
    ]);
    const node = NodeRegistry.parseValue(val, 'm', null);
    // The elements arrive in MATLAB's own order, so element 2 IS m(2,1).
    expect(node.children.map((c: any) => c._displayName)).toEqual([
      'm(1,1)', 'm(2,1)', 'm(1,2)', 'm(2,2)',
    ]);
  });

  it('maps a 2x3 object array label to the value MATLAB puts there', () => {
    // MATLAB-authored truth (gen_truth.m, obj2x3): Value = row*10 + col, and
    // the element list arrives column-major: 11 21 12 22 13 23.
    const val = arrayValue('Simulink.Parameter', [2, 3], [
      { Value: 11 }, { Value: 21 }, { Value: 12 },
      { Value: 22 }, { Value: 13 }, { Value: 23 },
    ]);
    const node = NodeRegistry.parseValue(val, 'w', null);
    const pairs = node.children.map((c: any) => [c._displayName, c.Value]);
    expect(pairs).toEqual([
      ['w(1,1)', 11], ['w(2,1)', 21], ['w(1,2)', 12],
      ['w(2,2)', 22], ['w(1,3)', 13], ['w(2,3)', 23],
    ]);
  });

  it('emits three-part subscripts for a rank-3 object array', () => {
    const elems = Array.from({ length: 12 }, (_, i) => ({ Value: i + 1 }));
    const val = arrayValue('Simulink.Parameter', [2, 3, 2], elems);
    const node = NodeRegistry.parseValue(val, 'v', null);
    const labels = node.children.map((c: any) => c._displayName);
    expect(labels[0]).toBe('v(1,1,1)');
    expect(labels[11]).toBe('v(2,3,2)');
    expect(labels.some((s: string) => /\(3,|\(4,/.test(s))).toBe(false);
  });
});

// Defect 13. The container knew its shape and exposed it ONLY baked into the
// display string, so a test (or any other consumer) that wanted MATLAB's size()
// had to parse the very string it was checking — an assertion that cannot fail
// independently of the thing it asserts.
describe('object array container — shape as data', () => {
  it('reports every extent MATLAB reports, normalized the way size() does', () => {
    const elems = Array.from({ length: 12 }, (_, i) => ({ Value: i + 1 }));
    expect((NodeRegistry.parseValue(arrayValue('Simulink.Parameter', [2, 3], [
      { Value: 11 }, { Value: 21 }, { Value: 12 }, { Value: 22 }, { Value: 13 }, { Value: 23 },
    ]), 'w', null) as any).dims).toEqual([2, 3]);
    expect((NodeRegistry.parseValue(arrayValue('Simulink.Parameter', [2, 3, 2], elems), 'v', null) as any).dims)
      .toEqual([2, 3, 2]);
    // MATLAB's size() drops trailing singletons past the second, so a 2x3x1 IS a
    // 2x3 — the container must not claim a rank MATLAB does not report.
    expect((NodeRegistry.parseValue(arrayValue('Simulink.Parameter', [2, 3, 1], [
      { Value: 1 }, { Value: 2 }, { Value: 3 }, { Value: 4 }, { Value: 5 }, { Value: 6 },
    ]), 'q', null) as any).dims).toEqual([2, 3]);
  });

  it('reports [1,1] for a scalar object, which carries no _dimensions at all', () => {
    // A single-element value object of a KNOWN class becomes a ParameterNode, so
    // the ObjectNode cases are a custom class (scalar) and a NESTED object — the
    // { _object_class, _properties } form, which has no _dimensions key.
    const scalar = NodeRegistry.parseValue(arrayValue('MyPkg.MyGain', [1, 1], [{ Value: 1 }]), 'g', null) as any;
    expect(scalar.constructor.name).toBe('ObjectNode');
    expect(scalar.dims).toEqual([1, 1]);
    const nested = NodeRegistry.parseValue(
      { _object_class: 'MyPkg.MyGain', _properties: { Value: 1 } }, 'n', null,
    ) as any;
    expect(nested.constructor.name).toBe('ObjectNode');
    expect(nested.dims).toEqual([1, 1]);
  });

  it('spells the display value out of that same shape', () => {
    const node = NodeRegistry.parseValue(arrayValue('Simulink.Parameter', [2, 3, 1], [
      { Value: 1 }, { Value: 2 }, { Value: 3 }, { Value: 4 }, { Value: 5 }, { Value: 6 },
    ]), 'q', null) as any;
    expect(node.displayValue).toBe('<' + node.dims.join('x') + ' Simulink.Parameter>');
  });
});

// The columns those element rows fill in. A NUMERIC array hands its class down to
// its elements (one MATLAB array is one class — see matlabVariableNode.test.ts), and
// the question these pin is what the same two levels look like when the elements are
// OBJECTS: an object's class belongs in Class, not in Data Type, and its data type —
// if it has one at all — is its own property, never the container's class. So the
// inheritance that is right for int32 would be wrong here, and nothing should hand
// 'Simulink.Parameter' to a Data Type column.
describe('general array rule — the columns an object element row fills', () => {
  it('shows a custom-class element its class, and leaves its Data Type blank', () => {
    const val = arrayValue('MyPkg.MyGain', [1, 3], [{ Value: 1 }, { Value: 2 }, { Value: 3 }]);
    const node = NodeRegistry.parseValue(val, 'objs', null);
    expect(node.children.map((c: any) => [c.displayName, c.className, c.dataType])).toEqual([
      ['objs(1)', 'MyPkg.MyGain', ''],
      ['objs(2)', 'MyPkg.MyGain', ''],
      ['objs(3)', 'MyPkg.MyGain', ''],
    ]);
  });

  it('shows each Parameter element its OWN DataType, not one inherited from the array', () => {
    // Deliberately mixed: a Parameter array's elements are independent objects, so
    // the column has to read per element. Inheriting anything from the container —
    // the class name, or the first element's type — would show one of these wrong.
    const val = arrayValue('Simulink.Parameter', [1, 3], [
      { Value: 1, DataType: 'int8' },
      { Value: 2, DataType: 'single' },
      { Value: 3 },
    ]);
    const node = NodeRegistry.parseValue(val, 'params', null);
    expect(node.children.map((c: any) => [c.className, c.dataType])).toEqual([
      ['Simulink.Parameter', 'int8'],
      ['Simulink.Parameter', 'single'],
      // No DataType key on disk means MATLAB's default, 'auto' — see ParameterNode.
      ['Simulink.Parameter', 'auto'],
    ]);
  });
});
