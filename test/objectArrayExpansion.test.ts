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
// tests, and a MATLAB-written .mat by the two blocks at the end (paramArray.mat,
// busArray.mat), whose objects reach the rule through the MCOS decoder.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import * as NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import '../src/datamodel/node/data/NodeClassMap.js';

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
      expect(child.displayName).toBe(`p(${i + 1})`);
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
      expect(child.displayName).toBe(`u(${i + 1})`);
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
    expect(node.children.map((c: any) => c.displayName)).toEqual([
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
    const pairs = node.children.map((c: any) => [c.displayName, c.Value]);
    expect(pairs).toEqual([
      ['w(1,1)', 11], ['w(2,1)', 21], ['w(1,2)', 12],
      ['w(2,2)', 22], ['w(1,3)', 13], ['w(2,3)', 23],
    ]);
  });

  it('emits three-part subscripts for a rank-3 object array', () => {
    const elems = Array.from({ length: 12 }, (_, i) => ({ Value: i + 1 }));
    const val = arrayValue('Simulink.Parameter', [2, 3, 2], elems);
    const node = NodeRegistry.parseValue(val, 'v', null);
    const labels = node.children.map((c: any) => c.displayName);
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

// The icon the container row presents with. An object ARRAY is an array OF
// something, and the container is the only row that stands for the whole of it — so
// it reads as what its elements are. It used to return the generic object glyph
// unconditionally, which put a `ws3d` above three `wsParameters` rows for one 3x1
// Simulink.Parameter: the same array, drawn as two different things.
describe('object array container — the icon it presents with', () => {
  it('takes its ELEMENTS icon for a known class, so the column reads as one array', () => {
    const node = NodeRegistry.parseValue(arrayValue('Simulink.Parameter', [3, 1], [
      { Value: 10 }, { Value: 20 }, { Value: 30 },
    ]), 'p', null) as any;
    // The container and every element row: one answer.
    expect([node.icon, ...node.children.map((c: any) => c.icon)])
      .toEqual(['wsParameters', 'wsParameters', 'wsParameters', 'wsParameters']);
  });

  it('still shows the object glyph for an array of a class with no icon of its own', () => {
    // The rule is "ask the element", not "brand the container": an array of an
    // unmodelled class has ObjectNode elements, which answer ws3d — so the generic
    // case falls out of the same code path rather than needing its own branch.
    const node = NodeRegistry.parseValue(arrayValue('Acme.Thing', [2, 1], [
      { A: 1 }, { A: 2 },
    ]), 'objs', null) as any;
    expect([node.icon, ...node.children.map((c: any) => c.icon)])
      .toEqual(['ws3d', 'ws3d', 'ws3d']);
  });

  it('agrees with the icon the SCALAR of that class presents with', () => {
    // A 1x1 of a known class IS the typed node, so its icon is the reference answer
    // the array container has to match — nothing may make a 3x1 Parameter look like
    // a different kind of thing from a 1x1 one.
    const scalar = NodeRegistry.parseValue(arrayValue('Simulink.Signal', [1, 1], [{ Min: 0 }]), 's', null) as any;
    const array = NodeRegistry.parseValue(arrayValue('Simulink.Signal', [2, 1], [{ Min: 0 }, { Min: 1 }]), 's', null) as any;
    expect(array.icon).toBe(scalar.icon);
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

// ---- The rule on a .mat MATLAB wrote: object arrays out of the MCOS decoder -------
// Ported from data-explorer-view test/objectExpansion.test.ts at ce62a24 (its two
// "MCOS object array expansion — .mat" blocks), whose assertions were on view's
// rows (buildMatRows). Here they are on the nodes and each node's own toRow(),
// which those rows are built from: a row is expandable where its node has children.

/** The variable `name` of the MATLAB-written fixtures/mcos/`file`, read by a session. */
function matVariable(file: string, name: string): any {
  const bytes = new Uint8Array(readFileSync(new URL(`./fixtures/mcos/${file}`, import.meta.url)));
  const mat: any = createSession().addMatSource(file, bytes);
  return mat.children.find((c: any) => c.name === name);
}

const labelOf = (node: any) => node.toRow().Name.label;
const childLabelled = (node: any, label: string) => node.children.find((c: any) => labelOf(c) === label);

// paramArray.mat: arr = [Simulink.Parameter(5) Simulink.Parameter([1 2 3]) Simulink.Parameter(struct('a',1))].
describe('MCOS object array expansion — .mat (1x3 Simulink.Parameter, heterogeneous)', () => {
  const top = matVariable('paramArray.mat', 'arr');

  it('shows <1x3 Simulink.Parameter> on the top row and makes it expandable', () => {
    expect(top).toBeDefined();
    const row = top.toRow();
    expect(row.ID).toBe('paramArray.mat/arr');
    expect(row.Class).toBe('Simulink.Parameter');
    expect(String(row.Value)).toBe('<1x3 Simulink.Parameter>');
    expect(top.children.length).toBeGreaterThan(0);
  });

  it('expands into 3 element rows arr(1)..arr(3), each a scalar Simulink.Parameter', () => {
    expect(top.children.map(labelOf)).toEqual(['arr(1)', 'arr(2)', 'arr(3)']);
    top.children.forEach((e: any) => {
      expect(e.constructor.name).toBe('ParameterNode');
      expect(e.toRow().Class).toBe('Simulink.Parameter');
      expect(e.toRow().parent).toBe(top.id);
    });
  });

  it('draws the array row and its element rows with the parameter icon', () => {
    // A MATLAB array is homogeneous, so the container row stands for three
    // parameters and has to read as one. On the row's iconId, which is what a tree
    // draws (objectIcon.test.ts pins the nodes' icon on the same file).
    expect([top, ...top.children].map((n: any) => n.toRow().Name.iconId))
      .toEqual(['wsParameters', 'wsParameters', 'wsParameters', 'wsParameters']);
  });

  it('decodes each element Value in its own shape: scalar, numeric vector, struct', () => {
    // Proves the decoder walks every object id in the handle (not just the first)
    // and resolves each element's distinct Value type through the typed node.
    expect(top.children.map((e: any) => String(e.toRow().Value))).toEqual([
      '5', //            Simulink.Parameter(5)
      '[1 2 3]', //      Simulink.Parameter([1 2 3])
      '<1x1 struct>', // Simulink.Parameter(struct('a',1))
    ]);
  });

  it('lets a struct-valued element expand further into its struct fields', () => {
    const structElem = top.children[2];
    expect(structElem.children.length).toBeGreaterThan(0);
    // arr(3).Value is the struct; drill into it to reach field `a` = 1.
    const value = childLabelled(structElem, 'Value');
    expect(value).toBeDefined();
    expect(value.children.length).toBeGreaterThan(0);
    const fieldA = childLabelled(value, 'a');
    expect(fieldA).toBeDefined();
    expect(String(fieldA.toRow().Value)).toBe('1');
  });
});

// An object array whose elements THEMSELVES contain a nested object ARRAY property
// must keep every element at BOTH levels. busArray.mat is authentic MATLAB output:
//   buses = [b1 b2 b3]  where b1/b2/b3 are Simulink.Bus with 1 / 2 / 3
//   Simulink.BusElement children respectively.
// This guards a second, deeper truncation the top-level array fix did NOT cover: a
// Bus's Elements_internal is itself an object-array-valued PROPERTY, decoded by the
// MCOS resolveValue object-handle path, which once read only the first element id —
// so buses(2) lost 'y' and buses(3) lost 'q','r'.
describe('MCOS object array expansion — .mat (1x3 Simulink.Bus, each a different element count)', () => {
  const top = matVariable('busArray.mat', 'buses');

  it('shows <1x3 Simulink.Bus> on the top row and makes it expandable', () => {
    expect(top).toBeDefined();
    const row = top.toRow();
    expect(row.ID).toBe('busArray.mat/buses');
    expect(row.Class).toBe('Simulink.Bus');
    expect(String(row.Value)).toBe('<1x3 Simulink.Bus>');
    expect(top.children.length).toBeGreaterThan(0);
  });

  it('expands into 3 Bus element rows buses(1)..buses(3), each itself expandable', () => {
    expect(top.children.map(labelOf)).toEqual(['buses(1)', 'buses(2)', 'buses(3)']);
    top.children.forEach((e: any) => {
      expect(e.toRow().Class).toBe('Simulink.Bus');
      expect(e.children.length).toBeGreaterThan(0);
    });
  });

  it('keeps EACH bus’s full, distinct set of BusElements (1, 2, and 3 elements)', () => {
    expect(top.children.map((bus: any) => bus.children.map(labelOf))).toEqual([['a'], ['x', 'y'], ['p', 'q', 'r']]);
  });

  it('decodes each BusElement’s DataType through the typed BusElement node', () => {
    const dtOf = (bus: any, name: string) => {
      const element = childLabelled(bus, name);
      expect(element.constructor.name).toBe('BusElementNode');
      return String(element.toRow().DataType);
    };
    const [b1, b2, b3] = top.children;
    expect(dtOf(b1, 'a')).toBe('double');
    expect(dtOf(b2, 'x')).toBe('single');
    expect(dtOf(b2, 'y')).toBe('int32');
    expect(dtOf(b3, 'p')).toBe('uint8');
    expect(dtOf(b3, 'q')).toBe('boolean');
    expect(dtOf(b3, 'r')).toBe('double');
  });
});
