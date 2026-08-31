// Copyright 2026 The MathWorks, Inc.
//
// Coverage for EnumTypeNode and EnumValueNode — the data-dictionary enum type and
// its enumeral children. The enum is editable: children can be added and removed,
// each operation exposes an undo/redo pair. The parent's _getSerializedProperties
// must keep the Enumerals wrapper (including _dimensions) in sync with the child
// list, or a round-trip silently corrupts the file.

import { describe, it, expect } from 'vitest';
import { EnumTypeNode, EnumValueNode } from '../src/datamodel/node/data/EnumTypeNode.js';

function rawVal(properties: Record<string, unknown>): Record<string, unknown> {
  return {
    _array_class: 'Simulink.data.dictionary.EnumTypeDefinition',
    _array_type: 'MATLABArray',
    _dimensions: [1, 1],
    _mw_element_type: 'MATLABArray',
    _elements: [{ _properties: properties }],
  };
}

function makeEnum(enumerals: Record<string, unknown>[], extra: Record<string, unknown> = {}): EnumTypeNode {
  const wrapper = {
    _array_type: 'Struct',
    _dimensions: [enumerals.length, 1],
    _fields: ['Name', 'Value', 'Description'],
    _elements: enumerals,
  };
  return EnumTypeNode.parse(rawVal({ Enumerals: wrapper, ...extra }), 'Color', null);
}

describe('EnumValueNode orphan icon fallback', () => {
  it('falls back to busElement when the enumeral has no parent', () => {
    // An orphan can occur transiently during undo/redo; it must not throw.
    const orphan = new EnumValueNode('x', null, { Value: '42', Description: 'test' });
    expect(orphan.icon).toBe('busElement');
  });
});

describe('EnumTypeNode.defaultName', () => {
  it('returns "EnumType" (seed for new-entry naming)', () => {
    expect(EnumTypeNode.defaultName).toBe('EnumType');
  });
});

describe('EnumTypeNode serialization — rawEnumerals without _elements', () => {
  it('injects _elements when rawEnumerals lacks it', () => {
    // When an enum was constructed from a malformed or stripped JSON that had
    // the Enumerals wrapper but no _elements array, the serializer must still
    // produce a valid output with the children serialized inside _elements.
    // Without this fallback (line 86) the round-trip silently drops all enumerals.
    const enumerals = { _array_type: 'Struct', _dimensions: [1, 1], _fields: ['Name', 'Value', 'Description'] };
    const rawOuter = rawVal({ Enumerals: enumerals });
    const elem = (rawOuter._elements as any[])[0];
    const props = elem._properties;
    const serial = { _rawVal: rawOuter, _properties: props, _rawEnumerals: enumerals };
    const node = new EnumTypeNode('Color', null, props, serial as Record<string, unknown>);
    // Manually add a child so serialize has something to write.
    const childProps = { Name: 'red', Value: '0', Description: '' };
    node.addChild(new EnumValueNode('red', node, childProps as Record<string, unknown>));

    const sv = node.serializeValue() as any;
    const resultEnums = sv._elements[0]._properties.Enumerals;
    expect(resultEnums._elements).toHaveLength(1);
    expect(resultEnums._elements[0].Name).toBe('red');
    expect(resultEnums._dimensions).toEqual([1, 1]);
  });
});

describe('EnumTypeNode execAddChild — undo/redo cycle', () => {
  it('returns an undo/redo pair that removes and re-adds the new enumeral', () => {
    // The host's undo stack relies on these closures to reverse and replay the
    // mutation; a broken redo means the user loses their added enumeral.
    const node = EnumTypeNode.createDefault('E', null);
    const before = node.children.length;
    const result = node.execAddChild() as any;
    expect(result).not.toBeNull();
    expect(result.node.name).toBe('enum2');
    expect(node.children.length).toBe(before + 1);

    result.undo();
    expect(node.children.length).toBe(before);

    result.redo();
    expect(node.children.length).toBe(before + 1);
    expect(node.children[node.children.length - 1]).toBe(result.node);
  });
});

describe('EnumTypeNode execRemoveChild', () => {
  it('returns null when there are no children to remove', () => {
    // An empty enum (all enumerals deleted) must not allow removal.
    const node = EnumTypeNode.createDefault('E', null);
    node.removeChild(node.children[0]);
    expect(node.execRemoveChild()).toBeNull();
  });

  it('returns null when the child is not in this enum', () => {
    // A stale reference from another enum must not corrupt this one.
    const node = EnumTypeNode.createDefault('A', null);
    const foreign = EnumTypeNode.createDefault('B', null).children[0];
    expect(node.execRemoveChild(foreign)).toBeNull();
  });

  it('returns an undo/redo pair that restores and re-removes the enumeral', () => {
    const node = EnumTypeNode.createDefault('E', null);
    node.addChildNode();
    const child = node.children[0];

    const result = node.execRemoveChild(child) as any;
    expect(result).not.toBeNull();
    expect(node.children).not.toContain(child);

    result.undo();
    expect(node.children[0]).toBe(child);

    result.redo();
    expect(node.children).not.toContain(child);
  });
});
