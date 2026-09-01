// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect, vi } from 'vitest';
// Importing the class map registers the NodeRegistry the adapter routes through.
import '../src/datamodel/node/NodeClassMap.js';
import * as NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import {
  buildTypedNodeFromMcos,
  decodeMcosObjects,
  modelOpaqueMcosVariable,
} from '../src/datamodel/node/data/mcosTypedNode.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import type { MatVariable } from '../src/datamodel/parser/MatParser.js';
import ParameterNode from '../src/datamodel/node/data/ParameterNode.js';
import SignalNode from '../src/datamodel/node/data/SignalNode.js';
import { BusNode } from '../src/datamodel/node/data/BusNode.js';
import LookupTableNode from '../src/datamodel/node/data/LookupTableNode.js';
import NumericTypeNode from '../src/datamodel/node/data/NumericTypeNode.js';
import BreakpointNode from '../src/datamodel/node/data/BreakpointNode.js';
import VariantControlNode from '../src/datamodel/node/data/VariantControlNode.js';

// The binary (.slx / .mat) path decodes an opaque Simulink object; the adapter
// turns it into the SAME node class the SLDD (JSON) path builds, so class and
// icon are consistent across formats — one node class per entry type.
//
// The adapter takes an optional decoded `properties` bag (SLDD-shaped, produced by
// the McosParser table walk) and feeds it through the SAME NodeRegistry.parseValue
// the SLDD path uses, so decoded values populate the typed node. When no properties
// are supplied it falls back to an EMPTY SHELL from the class name alone — correct
// class + icon, empty columns, no children — which is what happens for objects the
// decoder could not resolve with confidence (never guess). The class always comes
// from the variable's own metadata, so class unification holds either way. The
// end-to-end property-value parity across formats is covered in
// test/mcosCrossFormat.test.ts.

describe('buildTypedNodeFromMcos — unifies node class + values across formats', () => {
  it('routes Parameter/Signal to their typed classes', () => {
    expect(buildTypedNodeFromMcos('Simulink.Parameter', 'K', null)).toBeInstanceOf(ParameterNode);
    expect(buildTypedNodeFromMcos('Simulink.Signal', 's', null)).toBeInstanceOf(SignalNode);
  });

  it('routes the previously-opaque types to their typed classes too', () => {
    expect(buildTypedNodeFromMcos('Simulink.LookupTable', 'L', null)).toBeInstanceOf(LookupTableNode);
    expect(buildTypedNodeFromMcos('Simulink.NumericType', 'N', null)).toBeInstanceOf(NumericTypeNode);
    expect(buildTypedNodeFromMcos('Simulink.Breakpoint', 'B', null)).toBeInstanceOf(BreakpointNode);
    expect(buildTypedNodeFromMcos('Simulink.VariantControl', 'V', null)).toBeInstanceOf(VariantControlNode);
    expect(buildTypedNodeFromMcos('Simulink.Bus', 'Bus', null)).toBeInstanceOf(BusNode);
  });

  it('builds an EMPTY SHELL when no decoded properties are supplied', () => {
    const p = buildTypedNodeFromMcos('Simulink.Parameter', 'K', null) as ParameterNode;
    expect(p.Value).toBeUndefined();
    expect(p.Min).toBeUndefined();
    expect(p.Max).toBeUndefined();
    expect(p.Unit).toBe('');
    expect(p.Description).toBe('');
    // An empty Parameter Value formats as MATLAB's empty display '[ ]' — the
    // honest representation of "no value".
    expect(p.displayValue).toBe('[ ]');

    const s = buildTypedNodeFromMcos('Simulink.Signal', 's', null) as SignalNode;
    expect(s.Max).toBeUndefined();
    expect(s.Description).toBe('');
    expect(s.displayValue).toBe('');
  });

  it('surfaces decoded SLDD-shaped properties when supplied', () => {
    // The bag the McosParser table walk produces (binary exposes DocUnits; the
    // typed node maps it to Unit) fed through the same NodeRegistry.parseValue path.
    const p = buildTypedNodeFromMcos('Simulink.Parameter', 'K', null, {
      Value: 42,
      Min: -1,
      Max: 100,
      DocUnits: 'm/s',
      Description: 'hello',
    }) as ParameterNode;
    expect(p.displayValue).toBe('42');
    expect(p.Min).toBe(-1);
    expect(p.Max).toBe(100);
    expect(p.Unit).toBe('m/s');
    expect(p.Description).toBe('hello');
  });

  it('builds Bus with no element children (deferred to decoder handle-resolution)', () => {
    const b = buildTypedNodeFromMcos('Simulink.Bus', 'Bus', null) as BusNode;
    expect(b.className).toBe('Simulink.Bus');
    expect(b.children.length).toBe(0);
    expect(b.dataType).toBe('');
  });

  it('returns null for classes with no typed node (stay opaque)', () => {
    // Simulink.DataStore exists in real models but has no typed node in CLASS_MAP.
    expect(buildTypedNodeFromMcos('Simulink.DataStore', 'ds', null)).toBeNull();
    expect(buildTypedNodeFromMcos('SomeUnknown.Class', 'x', null)).toBeNull();
  });

  it('returns null for generic (non-Simulink-object) registry keys', () => {
    // A plain MATLAB variable/struct is handled by its own path, not here.
    expect(buildTypedNodeFromMcos('MatlabVariable', 'v', null)).toBeNull();
    expect(buildTypedNodeFromMcos('MatlabStruct', 'v', null)).toBeNull();
    expect(buildTypedNodeFromMcos('CustomObject', 'v', null)).toBeNull();
    expect(buildTypedNodeFromMcos('', 'v', null)).toBeNull();
  });

  it('degrades to null when parseValue throws (corrupt data), not a crash', () => {
    // A class whose parse() unexpectedly rejects the value (e.g. the MCOS
    // decoder handed over a corrupted element) must not break the whole file —
    // the adapter swallows the error and the variable stays opaque.
    const spy = vi.spyOn(NodeRegistry, 'parseValue').mockImplementationOnce(() => {
      throw new Error('simulated parse failure');
    });
    expect(buildTypedNodeFromMcos('Simulink.Parameter', 'broken', null)).toBeNull();
    spy.mockRestore();
  });
});

// The .slx and .mat paths both enter object expansion HERE: the MCOS decoder hands
// buildTypedNodeFromMcos a per-element `_properties` list plus the real dimensions,
// and the adapter must apply the SAME general array rule the SLDD paths do — expand
// a multi-element array into an ObjectNode container whose children are one scalar
// node per element (a KNOWN class → its typed node; a CUSTOM class → an ObjectNode).
// This is the format-independent proof for .slx/.mat known-class arrays; the raw
// decode of a real object handle into these elements is covered by
// mcosParser.test.ts (variableUsageArray.mat, 20x1) and mcosCrossFormat.test.ts.
describe('buildTypedNodeFromMcos — object ARRAYS (the .slx/.mat entry point)', () => {
  it('KNOWN class: a 3x1 Simulink.Parameter array becomes an ObjectNode of 3 ParameterNodes', () => {
    const node = buildTypedNodeFromMcos(
      'Simulink.Parameter',
      'p',
      null,
      null,
      [{ Value: 10 }, { Value: 20 }, { Value: 30 }],
      [3, 1],
    )!;
    expect(node.constructor.name).toBe('ObjectNode');
    expect(node.displayValue).toBe('<3x1 Simulink.Parameter>');
    expect(node.children).toHaveLength(3);
    node.children.forEach((child: any, i: number) => {
      expect(child).toBeInstanceOf(ParameterNode);
      expect(child._displayName).toBe(`p(${i + 1})`);
    });
    expect((node.children[0] as ParameterNode).Value).toBe(10);
    expect((node.children[2] as ParameterNode).Value).toBe(30);
  });

  it('CUSTOM class: a 2x1 Simulink.VariableUsage array becomes an ObjectNode of 2 ObjectNodes', () => {
    const node = buildTypedNodeFromMcos(
      'Simulink.VariableUsage',
      'u',
      null,
      null,
      [{ Name: 'Ka' }, { Name: 'Kf' }],
      [2, 1],
    )!;
    expect(node.constructor.name).toBe('ObjectNode');
    expect(node.displayValue).toBe('<2x1 Simulink.VariableUsage>');
    expect(node.children).toHaveLength(2);
    node.children.forEach((child: any, i: number) => {
      expect(child.constructor.name).toBe('ObjectNode');
      expect(child._displayName).toBe(`u(${i + 1})`);
    });
  });

  it('a SINGLE-element decode stays a scalar typed node (no array wrapper)', () => {
    const node = buildTypedNodeFromMcos(
      'Simulink.Parameter',
      'p',
      null,
      null,
      [{ Value: 7 }],
      [1, 1],
    )!;
    expect(node).toBeInstanceOf(ParameterNode);
    expect((node as ParameterNode).Value).toBe(7);
  });
});

// The two helpers MatNode (.mat) and ModelNode (.slx model workspace) share, so the
// three-way decision below is written once instead of once per container format.
describe('decodeMcosObjects / modelOpaqueMcosVariable — the shared container path', () => {
  const opaque = (name: string, className: string): MatVariable =>
    ({
      name,
      className,
      dimensions: [1, 1],
      isComplex: false,
      isLogical: false,
      value: null,
      fields: null,
      isOpaque: true,
    }) as unknown as MatVariable;

  it('returns null when there is no blob to decode', () => {
    // No opaque objects at all...
    expect(decodeMcosObjects(new Uint8Array([1, 2, 3]), [])).toBeNull();
    // ...and opaque objects but no blob bytes, which is what a .mat with no
    // anonymous trailing element (or an .slx with no trailing elements) yields.
    expect(decodeMcosObjects(undefined, [opaque('K', 'Simulink.Parameter')])).toBeNull();
    expect(decodeMcosObjects(null, [opaque('K', 'Simulink.Parameter')])).toBeNull();
  });

  it('a class the data model knows becomes its typed node, decoded or not', () => {
    expect(modelOpaqueMcosVariable(opaque('K', 'Simulink.Parameter'), undefined, null as never))
      .toBeInstanceOf(ParameterNode);
    const decoded = { value: 5, properties: { Value: 5 }, elements: [], dimensions: [1, 1] };
    const node = modelOpaqueMcosVariable(opaque('K', 'Simulink.Parameter'), decoded, null as never);
    expect((node as ParameterNode).Value).toBe(5);
  });

  it('an unknown class with recovered properties expands as a generic object', () => {
    const decoded = { value: null, properties: { Foo: 1 }, elements: [], dimensions: [1, 1] };
    const node = modelOpaqueMcosVariable(opaque('d', 'Simulink.DataStore'), decoded, null as never);
    expect(node!.constructor.name).toBe('ObjectNode');
    expect(node!.children.map((c) => c.name)).toEqual(['Foo']);
  });

  // The enriched-opaque arm. An unknown class with an EMPTY property bag has nothing
  // to expand as an object, so buildTypedNodeFromMcos declines it — but the decoder
  // still recovered the object's VALUE, and that value has to reach the Value column.
  // Falling through to the caller's plain-variable path instead would drop it and
  // render the bare '<1x1 Simulink.DataStore>' shell.
  it('an unknown class with only a decoded value becomes an enriched opaque node', () => {
    const decoded = { value: 'abc', properties: {}, elements: [], dimensions: [1, 1] };
    const node = modelOpaqueMcosVariable(opaque('d', 'Simulink.DataStore'), decoded, null as never);
    expect(node).toBeInstanceOf(MatlabVariableNode);
    expect((node as MatlabVariableNode)._isOpaque).toBe(true);
    expect((node as MatlabVariableNode)._opaqueClassName).toBe('Simulink.DataStore');
    expect((node as MatlabVariableNode).displayValue).toBe("'abc'");
  });

  // Nothing decoded and no typed class: null, telling the caller to use its own
  // plain-variable path (parseMatVariable / addWorkspaceEntry).
  it('returns null when neither a typed class nor a decode is available', () => {
    expect(modelOpaqueMcosVariable(opaque('d', 'Simulink.DataStore'), undefined, null as never)).toBeNull();
  });
});
