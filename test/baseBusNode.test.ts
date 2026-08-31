// Copyright 2026 The MathWorks, Inc.
//
// Coverage for BaseBusNode and BaseBusElementNode — the shared base classes that
// BusNode, ConnectionBusNode, and ServiceBusNode all inherit. Concrete subclasses
// test their own _createElementNode and element specifics; this suite pins the
// shared behaviors: the element-add/remove commands with undo/redo, the icon and
// serialization branches, and the parse-time edge cases (phantom elements,
// single-object form, the unknown-class default-bus fallback).
//
// Tests use BusNode as the concrete driver (it's the simplest subclass) but
// assert the BaseBusNode-level behavior.

import { describe, it, expect } from 'vitest';
import { BaseBusNode, BaseBusElementNode } from '../src/datamodel/node/data/BaseBusNode.js';
import { BusNode, BusElementNode } from '../src/datamodel/node/data/BusNode.js';
import { ConnectionBusNode } from '../src/datamodel/node/data/ConnectionBusNode.js';

// Minimal raw MATLABArray wrapper for a bus with the given elements.
function busRaw(elements: Record<string, unknown>[]): Record<string, unknown> {
  return {
    _array_class: 'Simulink.Bus',
    _array_type: 'MATLABArray',
    _dimensions: [1, 1],
    _mw_element_type: 'MATLABArray',
    _elements: [{
      _id: '1',
      _properties: {
        Elements_internal: elements.length > 0 ? {
          _array_class: 'Simulink.BusElement',
          _dimensions: [elements.length, 1],
          _elements: elements,
        } : [],
      },
    }],
  };
}

function busElem(id: string, name: string): Record<string, unknown> {
  return { _id: id, _properties: { Name: name } };
}

describe('BaseBusElementNode identity', () => {
  it('reports the bus-element icon and has no displayValue', () => {
    // The base element icon is the fallback when a subclass does not override it
    // (FunctionElementNode overrides to 'function', BusElementNode varies by
    // parent). Without it the tree would show a generic icon for elements the
    // subclass forgot to brand.
    const props = { Name: 'e' };
    const serial = { _rawElem: { _id: '2', _properties: props }, _properties: props };
    const elem = new BaseBusElementNode('e', null, props as Record<string, unknown>, serial as Record<string, unknown>);
    expect(elem.icon).toBe('typeBusElement');
    expect(elem.displayValue).toBe('');
    expect(elem.disabled).toBe(true);
  });
});

describe('BaseBusElementNode serialization', () => {
  it('writes a Description that was set after construction', () => {
    // Without _applyElementOverrides writing Description back, an edit entered in
    // the PI would be silently dropped on save.
    const props = { Name: 'e' };
    const rawElem = { _id: '2', _properties: { Name: 'e' } };
    const serial = { _rawElem: rawElem, _properties: props };
    const elem = new BaseBusElementNode('e', null, props as Record<string, unknown>, serial as Record<string, unknown>);
    elem.Description = 'added later';
    const sv = elem.serializeValue() as Record<string, unknown>;
    expect((sv._properties as Record<string, unknown>).Description).toBe('added later');
  });

  it('preserves a Description already present in serial', () => {
    const props = { Name: 'e', Description: 'original' };
    const rawElem = { _id: '2', _properties: { ...props } };
    const serial = { _rawElem: rawElem, _properties: props };
    const elem = new BaseBusElementNode('e', null, props as Record<string, unknown>, serial as Record<string, unknown>);
    const sv = elem.serializeValue() as Record<string, unknown>;
    expect((sv._properties as Record<string, unknown>).Description).toBe('original');
  });

  it('omits Description when it was never in serial and was not edited', () => {
    // A bus element that never had a Description should not gain one after a
    // round-trip — that would be a spurious diff on save.
    const props = { Name: 'e' };
    const serial = { _rawElem: { _id: '2', _properties: { Name: 'e' } }, _properties: props };
    const elem = new BaseBusElementNode('e', null, props as Record<string, unknown>, serial as Record<string, unknown>);
    const sv = elem.serializeValue() as Record<string, unknown>;
    expect('Description' in (sv._properties as Record<string, unknown>)).toBe(false);
  });
});

describe('BaseBusNode.icon', () => {
  it('uses the arch icon for derived buses and the workspace icon otherwise', () => {
    // The tree icon distinguishes architectural data from plain design data;
    // getting it wrong sends the wrong signal about where the entry lives.
    const bus = BusNode.createDefault('B', null);
    expect(bus.icon).toBe('wsBus');
    bus.metadata = { isderived: '1' };
    expect(bus.icon).toBe('typeBus');
  });

  it('ConnectionBusNode uses wsConnectionBus for Design Data and typeConnection for Architectural', () => {
    // A plain Design Data ConnectionBus needs the workspace icon; without it a
    // physical-connection bus looks identical to a DataInterface bus.
    const bus = ConnectionBusNode.createDefault('C', null);
    expect(bus.icon).toBe('wsConnectionBus');
    bus.metadata = { isderived: '1' };
    expect(bus.icon).toBe('typeConnection');
  });
});

describe('addChildNode name deconfliction', () => {
  it('auto-increments the name past existing children', () => {
    // When a user adds multiple elements, each must get a unique name; a
    // collision would overwrite a sibling on save.
    const bus = BusNode.createDefault('B', null);
    const c1 = bus.addChildNode();
    const c2 = bus.addChildNode();
    const c3 = bus.addChildNode();
    expect(c1!.name).toBe('a');
    expect(c2!.name).toBe('a1');
    expect(c3!.name).toBe('a2');
  });
});

describe('execAddChild / execRemoveChild undo-redo cycle', () => {
  it('execAddChild returns an undo/redo pair that restores and re-adds the child', () => {
    // The undo stack depends on these closures to reverse and re-apply the
    // mutation; if redo fails the user loses their added element after undo.
    const bus = BusNode.createDefault('B', null);
    const result = bus.execAddChild() as any;
    expect(result).not.toBeNull();
    expect(result.node.name).toBe('a');
    expect(bus.children).toContain(result.node);

    result.undo();
    expect(bus.children.length).toBe(0);

    result.redo();
    expect(bus.children.length).toBe(1);
    expect(bus.children[0]).toBe(result.node);
  });

  it('execRemoveChild returns null when there are no children', () => {
    const bus = BusNode.createDefault('B', null);
    expect(bus.execRemoveChild()).toBeNull();
  });

  it('execRemoveChild returns null for a child not in this bus', () => {
    // A stale reference from a different bus must not corrupt this one's children.
    const bus = BusNode.createDefault('B', null);
    bus.addChildNode();
    const foreign = BusNode.createDefault('Other', null);
    expect(bus.execRemoveChild(foreign)).toBeNull();
  });

  it('execRemoveChild returns an undo/redo pair that restores and re-removes', () => {
    const bus = BusNode.createDefault('B', null);
    bus.addChildNode();
    bus.addChildNode();
    const child = bus.children[0];

    const result = bus.execRemoveChild(child) as any;
    expect(result).not.toBeNull();
    expect(bus.children).not.toContain(child);

    result.undo();
    expect(bus.children[0]).toBe(child);

    result.redo();
    expect(bus.children).not.toContain(child);
  });
});

describe('BaseBusNode._createElementNode (base)', () => {
  it('returns null — concrete subclasses must override it', () => {
    // When a subclass forgets to override _createElementNode, addChildNode
    // returns null and no child is added. This is the base safety net.
    const serial = { _rawVal: { _elements: [{ _properties: {} }] }, _properties: {} };
    const node = new (BaseBusNode as any)('B', null, serial);
    expect(node._createElementNode('x', {}, {})).toBeNull();
    expect(node.addChildNode()).toBeNull();
  });
});

describe('_parseElements edge cases', () => {
  it('skips phantom elements with empty properties', () => {
    // A self-closing <Element Class="..."/> in binary XML round-trips as an
    // element with no properties — a bus with 0 elements. If these ghost entries
    // created real children, the tree would show stale empty rows.
    const raw = busRaw([
      { _id: '2', _properties: {} },
      busElem('3', 'real'),
    ]);
    const bus = BusNode.parse(raw, 'B', null);
    expect(bus.children.length).toBe(1);
    expect(bus.children[0].name).toBe('real');
  });

  it('handles the single-object form of Elements_internal', () => {
    // An .sldd may store a sole element as _object_class + _properties instead
    // of the _array_class + _elements array form. Without this branch, a bus
    // with exactly one element would parse as empty.
    const raw = {
      _array_class: 'Simulink.Bus',
      _array_type: 'MATLABArray',
      _dimensions: [1, 1],
      _mw_element_type: 'MATLABArray',
      _elements: [{
        _id: '1',
        _properties: {
          Elements_internal: {
            _object_class: 'Simulink.BusElement',
            _properties: { Name: 'solo' },
          },
        },
      }],
    };
    const bus = BusNode.parse(raw, 'B', null);
    expect(bus.children.length).toBe(1);
    expect(bus.children[0].name).toBe('solo');
  });
});

describe('serialization of Elements_internal', () => {
  it('emits an empty array when all children are removed', () => {
    // MATLAB produces Elements_internal = [] for a bus with no elements; if we
    // emitted the old shape instead, the XML serializer would write a phantom
    // self-closing <Element/> tag.
    const bus = BusNode.parse(busRaw([busElem('2', 'e1')]), 'B', null);
    bus.removeChild(bus.children[0]);
    const sv = bus.serializeValue() as Record<string, unknown>;
    const props = (sv._elements as Record<string, unknown>[])[0]._properties as Record<string, unknown>;
    expect(props.Elements_internal).toEqual([]);
  });

  it('always emits the canonical _array_class form even when the source used _object_class', () => {
    // The serializer branch that writes _elements expects _array_class; if it
    // got the _object_class form back, MATLAB would fail to load the file.
    const raw = {
      _array_class: 'Simulink.Bus',
      _array_type: 'MATLABArray',
      _dimensions: [1, 1],
      _mw_element_type: 'MATLABArray',
      _elements: [{
        _id: '1',
        _properties: {
          Elements_internal: {
            _object_class: 'Simulink.BusElement',
            _properties: { Name: 'solo' },
          },
        },
      }],
    };
    const bus = BusNode.parse(raw, 'B', null);
    const sv = bus.serializeValue() as Record<string, unknown>;
    const props = (sv._elements as Record<string, unknown>[])[0]._properties as Record<string, unknown>;
    const ei = props.Elements_internal as Record<string, unknown>;
    expect(ei._array_class).toBe('Simulink.BusElement');
    expect(ei._elements).toBeDefined();
  });
});

describe('_createDefaultBus', () => {
  it('falls back to empty properties for an unknown class name', () => {
    // Internal callers always pass a known class, but a typo in a subclass
    // shouldn't blow up — it should produce a bus with empty defaults.
    const node = (BaseBusNode as any)._createDefaultBus('x', null, BaseBusNode, 'Unknown.Class');
    const sv = node.serializeValue() as Record<string, unknown>;
    expect(sv._array_class).toBe('Unknown.Class');
    const props = (sv._elements as Record<string, unknown>[])[0]._properties as Record<string, unknown>;
    expect(props).toEqual({});
  });

  it('populates Simulink.ServiceBus defaults (Description + empty Elements_internal)', () => {
    const node = (BaseBusNode as any)._createDefaultBus('sb', null, BaseBusNode, 'Simulink.ServiceBus');
    const sv = node.serializeValue() as Record<string, unknown>;
    const props = (sv._elements as Record<string, unknown>[])[0]._properties as Record<string, unknown>;
    expect(props).toEqual({ Description: '', Elements_internal: [] });
  });
});

describe('BaseBusNode Description serialization', () => {
  it('writes Description when it was edited after construction', () => {
    const bus = BusNode.createDefault('B', null);
    bus.Description = 'bus description';
    const sv = bus.serializeValue() as Record<string, unknown>;
    const props = (sv._elements as Record<string, unknown>[])[0]._properties as Record<string, unknown>;
    expect(props.Description).toBe('bus description');
  });
});
