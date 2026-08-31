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

  it('labels a 2x2 matrix of objects with (row,col) subscripts', () => {
    const val = arrayValue('Simulink.Parameter', [2, 2], [
      { Value: 1 }, { Value: 2 }, { Value: 3 }, { Value: 4 },
    ]);
    const node = NodeRegistry.parseValue(val, 'm', null);
    expect(node.children.map((c: any) => c._displayName)).toEqual([
      'm(1,1)', 'm(1,2)', 'm(2,1)', 'm(2,2)',
    ]);
  });
});
