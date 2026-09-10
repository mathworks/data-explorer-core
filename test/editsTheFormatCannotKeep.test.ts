// Copyright 2026 The MathWorks, Inc.
//
// One rule, stated once: THE MODEL DOES NOT ACCEPT AN EDIT ITS OWN SERIALIZER DROPS.
//
// Two cells used to break it, and both broke it the same way — a node declares a
// property because the COLUMN exists, the generic setProperty tail writes it onto the
// node because the field is there, and serialize() has nowhere to put it. The row then
// shows text the file will not hold, until the next read of that file takes it away. A
// cell that reverts on reload is worse than a cell that refuses, because the user has
// already moved on.
//
//   • Description on a plain MATLAB variable (or a struct). Those serialize as
//     `{name, metadata, value}` — no property bag, so no Description. A Simulink object
//     has one and keeps it, which is what makes this a per-node answer and not a
//     per-column one.
//   • The Name of a Simulink.Parameter's Value row. That row is the class's `Value`
//     property, exactly as an object's property rows are: serialize writes it under the
//     key `Value` whatever the node is called, so a rename is discarded in silence.
//
// The fix for both is the same shape as the model's existing refusals: the node says
// whether the cell can be typed into (so the table never opens an editor), and
// setProperty says no if it is asked anyway.
import { describe, it, expect } from 'vitest';
import ParameterNode from '../src/datamodel/node/data/ParameterNode.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import StructNode from '../src/datamodel/node/data/StructNode.js';
import * as NodeClassMap from '../src/datamodel/node/data/NodeClassMap.js';

void NodeClassMap;

type Any = any;

// The raw shape the .sldd parsers hand ParameterNode.parse.
const parseParam = (props: Record<string, unknown>): Any =>
  ParameterNode.parse(
    {
      _array_class: 'Simulink.Parameter',
      _dimensions: [1, 1],
      _mw_element_type: 'MATLABArray',
      _elements: [{ _id: '1', _properties: Object.assign({ Complexity: 'real', Dimensions: [1, 1] }, props) }],
    } as unknown as Record<string, unknown>,
    'p',
    null,
  );

describe('a Description the entry has nowhere to put', () => {
  it('is refused on a plain MATLAB variable, and the cell never offers an editor', () => {
    const v: Any = MatlabVariableNode.parse(5, 'Number', null);
    expect(v.toRow()._descriptionEditable).toBe(false);

    const result = v.setProperty('Description', 'why this exists');
    expect(result).not.toBe(true);
    expect((result as Any).error).toBe(true);
    expect(v.Description ?? '').toBe('');
    // The whole point: nothing about the node changed, so nothing shows and nothing is
    // dropped later.
    expect(v.toRow().Description).toBe('');
    expect(JSON.stringify(v.serializeValue())).not.toContain('why this exists');
  });

  it('is refused on a struct, which serializes the same way', () => {
    const s: Any = StructNode.parse(
      { _dimensions: [1, 1], _fields: ['a'], _elements: [{ a: 1 }] } as unknown as Record<string, unknown>,
      'S',
      null,
    );
    expect(s.toRow()._descriptionEditable).toBe(false);
    expect(s.setProperty('Description', 'notes')).not.toBe(true);
  });

  it('is kept on a Simulink object, which has a property bag for it', () => {
    const p = parseParam({ Value: 5 });
    expect(p.toRow()._descriptionEditable).toBe(true);
    expect(p.setProperty('Description', 'gain of the outer loop')).toBe(true);
    expect(p.toRow().Description).toBe('gain of the outer loop');
    expect(JSON.stringify(p.serializeValue())).toContain('gain of the outer loop');
  });

  it('is kept on an object whose VALUE cell is read-only', () => {
    // The bug this replaces: the table decided the Description cell from
    // `_valueEditable`, so a Parameter holding more elements than a one-line literal
    // carries — whose Value displays as the summary `<1x12 double>` and rightly takes no
    // editor — could not be described either. The two questions are unrelated, and are
    // now answered separately.
    const p = parseParam({ Value: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
    expect(p.displayValue).toBe('<1x12 double>');
    expect(p.toRow()._valueEditable).toBe(false);
    expect(p.toRow()._descriptionEditable).toBe(true);
  });
});

describe("the Name of a Simulink.Parameter's Value row", () => {
  const valueRowOf = (p: Any): Any => {
    expect(p.children.length, 'the fixture value must be one the Value row expands').toBe(1);
    return p.children[0];
  };

  it('cannot be typed into: it is the class property name, not an identifier', () => {
    const row = valueRowOf(parseParam({ Value: [1, 2, 3] }));
    expect(row.name).toBe('Value');
    expect(row.nameEditable).toBe(false);
    expect(row.toRow().Name.editable).toBe(false);
  });

  it('is refused when set anyway, rather than renamed and dropped on save', () => {
    const p = parseParam({ Value: [1, 2, 3] });
    const row = valueRowOf(p);
    const result = row.setProperty('Name', 'Value_renamed');
    expect(result).not.toBe(true);
    expect((result as Any).error).toBe(true);
    expect(row.name).toBe('Value');
    // What made the old behaviour silent: the key is 'Value' in the file whatever the
    // node is called, so a rename left no trace to notice.
    expect(JSON.stringify(p.serializeValue())).not.toContain('Value_renamed');
  });

  it('leaves a struct field renameable — a field name IS the identifier', () => {
    const s: Any = StructNode.parse(
      { _dimensions: [1, 1], _fields: ['a'], _elements: [{ a: 1 }] } as unknown as Record<string, unknown>,
      'S',
      null,
    );
    const field = s.children[0];
    expect(field.nameEditable).toBe(true);
    expect(field.setProperty('Name', 'b')).toBe(true);
    expect(field.name).toBe('b');
  });
});
