// Copyright 2026 The MathWorks, Inc.
//
// Every node type opens its Property Inspector with the common, fixed-name
// "General" identity group — whether it is schema-driven (classes/*.json) or
// authors its layout in an override (dynamic classNames, className collisions,
// and bus/enum ELEMENT nodes that read `*_internal` aliases). This pins that
// consistency so a future node can't silently reintroduce a "Data Properties" /
// "Properties" / "Element Properties" title. The identity group is adaptive:
// Value/DataType appear only where the node has them; a value-like prop
// (Condition/Specification) substitutes for Value; Description trails the
// identity rows or moves to "Value Properties" for element nodes.
import { describe, it, expect } from 'vitest';
import VariantControlNode from '../../src/datamodel/node/data/VariantControlNode.js';
import VariantExpressionNode from '../../src/datamodel/node/data/VariantExpressionNode.js';
import VariantVariableNode from '../../src/datamodel/node/data/VariantVariableNode.js';
import VariantBankNode from '../../src/datamodel/node/data/VariantBankNode.js';
import VariantConfigurationDataNode from '../../src/datamodel/node/data/VariantConfigurationDataNode.js';
import ConfigSetNode from '../../src/datamodel/node/data/ConfigSetNode.js';
import ConfigSetRefNode from '../../src/datamodel/node/data/ConfigSetRefNode.js';
import LookupTableNode from '../../src/datamodel/node/data/LookupTableNode.js';
import BreakpointNode from '../../src/datamodel/node/data/BreakpointNode.js';
import CustomObjectNode from '../../src/datamodel/node/data/CustomObjectNode.js';
import StructNode from '../../src/datamodel/node/data/StructNode.js';
import MatlabVariableNode from '../../src/datamodel/node/data/MatlabVariableNode.js';
import { BusNode } from '../../src/datamodel/node/data/BusNode.js';
import { ConnectionBusNode } from '../../src/datamodel/node/data/ConnectionBusNode.js';
import { ServiceBusNode } from '../../src/datamodel/node/data/ServiceBusNode.js';
import { EnumTypeNode } from '../../src/datamodel/node/data/EnumTypeNode.js';
import NodeRegistry from '../../src/datamodel/node/NodeRegistry.js';
import '../../src/datamodel/node/NodeClassMap.js';

function groupsOf(node: any): { name: string; items: string[] }[] {
  const pi = node.toPIObject();
  return (pi.propertySheet.groups as any[]).map((g) => ({
    name: g.displayName,
    items: g.items.map((i: any) => i.name),
  }));
}
function firstGroup(node: any) {
  return groupsOf(node)[0];
}
function firstChild(container: any): any {
  container.addChildNode?.();
  return container.children[0];
}

describe('common "General" identity group — schema-driven classes', () => {
  it('Variant* / ConfigSet* open with General [Name, value-like, DataType, Kind, Class]', () => {
    expect(firstGroup(VariantControlNode.createDefault('vc', null))).toEqual({
      name: 'General',
      items: ['Name', 'Value', 'DataType', 'Kind', 'Class'],
    });
    expect(firstGroup(VariantExpressionNode.createDefault('ve', null))).toEqual({
      name: 'General',
      items: ['Name', 'Condition', 'DataType', 'Kind', 'Class'],
    });
    expect(firstGroup(VariantVariableNode.createDefault('vv', null))).toEqual({
      name: 'General',
      items: ['Name', 'Specification', 'DataType', 'Kind', 'Class'],
    });
    for (const M of [VariantBankNode, VariantConfigurationDataNode, ConfigSetNode, ConfigSetRefNode]) {
      expect(firstGroup(M.createDefault('n', null))).toEqual({
        name: 'General',
        items: ['Name', 'Value', 'DataType', 'Kind', 'Class'],
      });
    }
  });

  it('LookupTable / Breakpoint / CustomObject keep Description in General', () => {
    for (const M of [LookupTableNode, BreakpointNode, CustomObjectNode]) {
      expect(firstGroup(M.createDefault('n', null))).toEqual({
        name: 'General',
        items: ['Name', 'Value', 'DataType', 'Kind', 'Class', 'Description'],
      });
    }
  });
});

describe('common "General" identity group — override-driven classes', () => {
  it('Struct / MatlabVariable (dynamic className) open with General', () => {
    expect(firstGroup(StructNode.createDefault('s', null))).toEqual({
      name: 'General',
      items: ['Name', 'Value', 'DataType', 'Kind', 'Class', 'Description'],
    });
    expect(firstGroup(MatlabVariableNode.createDefault('m', null))).toEqual({
      name: 'General',
      items: ['Name', 'Value', 'DataType', 'Kind', 'Class', 'Description'],
    });
  });

  it('Bus / Connection elements open with General, value-semantics in Value Properties', () => {
    const busEl = firstChild(BusNode.createDefault('b', null));
    expect(groupsOf(busEl)[0]).toEqual({ name: 'General', items: ['Name', 'DataType', 'Kind', 'Class'] });
    expect(groupsOf(busEl)[1].name).toBe('Value Properties');

    const connEl = firstChild(ConnectionBusNode.createDefault('cb', null));
    expect(groupsOf(connEl)[0]).toEqual({ name: 'General', items: ['Name', 'DataType', 'Kind', 'Class'] });
    expect(groupsOf(connEl)[1]).toEqual({ name: 'Value Properties', items: ['Description'] });
  });

  it('Function element (no DataType/Description) opens with General [Name, Kind, Class]', () => {
    const fnEl = firstChild(ServiceBusNode.createDefault('sb', null));
    expect(groupsOf(fnEl)[0]).toEqual({ name: 'General', items: ['Name', 'Kind', 'Class'] });
  });

  it('Enum value (no DataType) opens with General [Name, Value, Kind, Class, Description]', () => {
    const enumVal = firstChild(EnumTypeNode.createDefault('et', null));
    expect(groupsOf(enumVal)[0]).toEqual({
      name: 'General',
      items: ['Name', 'Value', 'Kind', 'Class', 'Description'],
    });
  });
});

describe('every routed class reaches a Property Inspector', () => {
  it('opens a General group for each class NodeClassMap can produce', () => {
    // A class registered in NodeClassMap but missing from the schema (and without
    // a node-authored override) resolves no layout at all, and toPIObject returns
    // null — the Property Inspector renders empty with no other symptom. Walking
    // the registry catches that the moment a class is added.
    for (const className of NodeRegistry.getRegisteredClasses()) {
      const node = NodeRegistry.parseValue(
        {
          _array_class: className,
          _array_type: 'MATLABArray',
          _dimensions: [1, 1],
          _mw_element_type: 'MATLABArray',
          _elements: [{ _properties: {} }],
        },
        'n',
        null,
      );
      expect(firstGroup(node), className).toMatchObject({ name: 'General' });
    }
  });
});
