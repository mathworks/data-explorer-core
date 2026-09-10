// Copyright 2026 The MathWorks, Inc.
//
// A VALUE THAT NAMES A CLASS BUT CARRIES NO ELEMENT STILL MODELS AS AN ENTRY.
//
// A Simulink object in a dictionary is stored as an envelope — the class on the wrapper,
// the properties inside `_elements[0]._properties` — and every typed node's `static parse`
// unwraps it with the same expression:
//
//     const elem = rawVal._elements && rawVal._elements[0];
//     const props = ((elem && elem._properties) || {});
//
// The `|| {}` is the arm that runs when the envelope names a class and holds no element:
// a 0x0 empty object array, or an entry that was written incompletely. Without it the
// unwrap throws, and the throw does not cost one entry — `SlddNode.parse` walks the entry
// list in a plain `forEach`, so an exception inside any one entry's `parse` aborts the walk
// and the dictionary does not open at all. This package has already been bitten by that
// exact shape once, on the other side of the same envelope: see the comment on
// `objectArrayValue` in BinarySlddParser, where indexing a single-element wrapper "threw on
// a classless later element and took the whole file's read down with it".
//
// So the behaviour worth pinning is the degradation: one unreadable entry reads as an entry
// of its class with every property at its default — right name, right Class column, right
// icon, blank Value — and the other entries in the file are unaffected. Five classes in this
// cluster spell that unwrap verbatim, which is why it is asserted once, here, over all of
// them rather than five times in five files.
//
// Note this is reached through `parseValue`, the real dispatch, on purpose: its own rule is
// that a value object with more than one element expands into an array container, so a
// ZERO-element one falls through to the typed class — the routing and the fallback have to
// agree about that or the test would be exercising a path nothing takes.

import { describe, it, expect } from 'vitest';
import { parseValue } from '../src/datamodel/node/NodeClassMap.js';
import SectionNode from '../src/datamodel/node/container/SectionNode.js';
import SlddNode from '../src/datamodel/node/container/SlddNode.js';
import type DataNode from '../src/datamodel/node/DataNode.js';

// The envelope MATLAB writes for an empty (0x0) object array: the class is on the wrapper,
// and there is no element to carry properties.
function noElement(className: string): Record<string, unknown> {
  return {
    _array_class: className,
    _array_type: 'MATLABArray',
    _dimensions: [0, 0],
    _mw_element_type: 'MATLABArray',
    _elements: [],
  };
}

// Each class, with the answers a user would see in the table for an entry of it that
// carries no properties at all. The Data Type column differs per class because each
// derives it from a different property, which is precisely what the defaults decide.
const CLASSES: { className: string; node: string; icon: string; dataType: string; kind: string }[] = [
  { className: 'Simulink.NumericType', node: 'NumericTypeNode', icon: 'wsNumeric', dataType: '', kind: 'Numeric Type' },
  { className: 'Simulink.AliasType', node: 'AliasTypeNode', icon: 'wsAlias', dataType: '', kind: 'Alias Type' },
  // 'double' rather than blank: absent DataType is MATLAB's default for a ValueType, not
  // a missing value, so the column shows the type the entry actually has.
  { className: 'Simulink.ValueType', node: 'ValueTypeNode', icon: 'wsValue', dataType: 'double', kind: 'Value Type' },
  { className: 'Simulink.ConfigSet', node: 'ConfigSetNode', icon: 'settings', dataType: '', kind: 'Configuration Set' },
  // 'auto' for the same reason as ValueType's 'double' — see the constructor comment.
  { className: 'Simulink.Signal', node: 'SignalNode', icon: 'wsSignal', dataType: 'auto', kind: 'Simulink Signal' },
];

describe('an entry whose value names a class but holds no element', () => {
  it('models as an entry of that class with default properties, rather than throwing', () => {
    for (const c of CLASSES) {
      const node = parseValue(noElement(c.className), 'lonely', null) as DataNode;
      expect(node.constructor.name, c.className).toBe(c.node);
      // The Class column still names the class the file claimed; falling through to a
      // generic object node here would relabel the entry and lose its editing rules.
      expect(node.className, c.className).toBe(c.className);
      expect(node.kind, c.className).toBe(c.kind);
      expect(node.icon, c.className).toBe(c.icon);
    }
  });

  it('shows the same blank, non-editable Value the fully-populated entry shows', () => {
    // None of these classes has a scalar value, so an empty one must not fall back to a
    // placeholder like "<0x0 Simulink.Signal>" — the column is blank for every entry of
    // the class, populated or not.
    for (const c of CLASSES) {
      const row = (parseValue(noElement(c.className), 'lonely', null) as DataNode).toRow()!;
      expect(row.Value, c.className).toBe('');
      expect(row._valueEditable, c.className).toBe(false);
      expect(row.DataType, c.className).toBe(c.dataType);
      expect((row.Name as { label: string }).label, c.className).toBe('lonely');
    }
  });

  it('serializes back out without inventing properties the file did not have', () => {
    // A file that opens must also save. The empty envelope has to survive the round trip
    // rather than acquiring a bag of defaults, which would turn a read-only glitch into a
    // written-out one.
    for (const c of CLASSES) {
      const node = parseValue(noElement(c.className), 'lonely', null) as DataNode;
      const sv = node.serializeValue() as { _array_class: string; _elements: { _properties: Record<string, unknown> }[] };
      expect(sv._array_class, c.className).toBe(c.className);
      expect(sv._elements, c.className).toHaveLength(1);
      // AliasType writes its BaseType unconditionally and ConfigSet its Name (they follow
      // the entry, not the bag); no class invents anything else.
      const written = Object.keys(sv._elements[0]._properties).sort();
      const allowed = { 'Simulink.AliasType': ['BaseType'], 'Simulink.ConfigSet': ['Name'] }[c.className] ?? [];
      expect(written, c.className).toEqual(allowed);
    }
  });

  it('does not stop the entries around it from being read', () => {
    // The consequence that matters. `SlddNode.parse` walks the entry list with forEach, so
    // this is the difference between one odd row and a dictionary that will not open.
    const entry = (name: string, value: unknown) => ({
      name,
      value,
      metadata: { namespace: '', isderived: '0' },
    });
    const root = new SlddNode('d.sldd');
    const design = root.getSection('design') as SectionNode;
    design.parseEntry(entry('before', { _type: 'double', _value: '1' }));
    design.parseEntry(entry('lonely', noElement('Simulink.Signal')));
    design.parseEntry(entry('after', { _type: 'double', _value: '2' }));

    expect(design.children.map((c) => c.name)).toEqual(['before', 'lonely', 'after']);
    expect(design.children[1].className).toBe('Simulink.Signal');
    expect(root.NumberOfEntries).toBe(3);
  });
});
