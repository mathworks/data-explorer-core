// Copyright 2026 The MathWorks, Inc.
//
// Add on an empty array. MATLAB's `x.field = 0` makes a 1x1 struct of every empty of numbers or
// logicals, whatever its class, size and rank: `[]`, int8(zeros(1,0)), zeros(0,3), zeros(0,0,2),
// false(1,0), a complex one (R2027a). So Add makes one of each, its field `field` holding 0, and its
// undo puts back the empty as it was read, its class and size and its bytes. The undo gave back a 0x0
// double, whatever the empty had been: int8(zeros(1,0)) came back a double. An empty of objects or of
// an enumeration takes no field (MATLAB:emptyObjectDotAssignment), and Add is refused there, saying so.
import { describe, it, expect } from 'vitest';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import { EDIT_BASH_FORMATS, addTo, nodeAt, openEditBash, redo, reopened, saved, shownRow, typeInto, undo, type Opened } from './tools/editBash.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

/** What the value at `path` is: its class and size, and its fields' names and values where a struct. */
function valueOf(o: Opened, path: string) {
  const n = nodeAt(o, path);
  return { cls: n.className, dims: n.dims, fields: n.className === 'struct' ? n.children.map((c: any) => [c.name, c.displayValue]) : [] };
}

// Each empty of the fixtures, where it stands: as a variable, a struct field and a cell member.
const EMPTIES = ['i8Empty1x0', 'sLeaves.i8Empty1x0', 'cLeaves{34}', 'dEmpty0x3', 'sLeaves.dEmpty0x3', 'cLeaves{33}'];

describe.each(EDIT_BASH_FORMATS)('Add on an empty array, %s', (format) => {
  it.each(EMPTIES)('%s becomes the struct MATLAB makes of it given a field, and its undo the empty read', (path) => {
    const o = openEditBash(format);
    // What a save writes: a MAT-file whole, and a dictionary's entry, whose last-modified stamp an
    // edit and its undo set to the time of the undo (DataNode._editMarks keeps the stamp so).
    const written = () => (format.startsWith('mat') ? saved(o) : new TextEncoder().encode(JSON.stringify(nodeAt(o, path).serializeValue())));
    const before = { value: valueOf(o, path), written: written() };
    expect(nodeAt(o, path)._emptyAddRefusal()).toBeNull();
    expect(o.session.addChildRefusal(nodeAt(o, path).id)).toBeNull();
    expect(addTo(o, path)?.matlabPath).toBe(path + '.field');
    const made = { cls: 'struct', dims: [1, 1], fields: [['field', '0']] };
    expect(valueOf(o, path)).toEqual(made);
    expect(valueOf(reopened(o), path)).toEqual(made);
    undo(o);
    expect(valueOf(o, path)).toEqual(before.value);
    expect(sameBytes(written(), before.written)).toBe(true);
    redo(o);
    expect(valueOf(o, path)).toEqual(made);
  });

  it('takes Add on a [] read from a file as the struct it becomes, and an undo puts back the [] read', () => {
    const typed = openEditBash(format);
    expect(typeInto(typed, 'dScalar', 'Value', '[]')).toBe(true);
    const o = reopened(typed);
    const written = () => (format.startsWith('mat') ? saved(o) : new TextEncoder().encode(JSON.stringify(nodeAt(o, 'dScalar').serializeValue())));
    const read = written();
    const field = addTo(o, 'dScalar');
    expect(field?.matlabPath).toBe('dScalar.field');
    const added = written();
    undo(o);
    expect(shownRow(o, 'dScalar')).toEqual({ Value: '[ ]', Class: 'double' });
    expect(sameBytes(written(), read)).toBe(true);
    redo(o);
    expect(nodeAt(o, 'dScalar.field')).toBe(field);
    expect(sameBytes(written(), added)).toBe(true);
  });
});

describe('Add on an empty array of each class and shape', () => {
  const empty = (cls: string, dims: number[], complex = false): any => {
    const node = new MatlabVariableNode('x', null, {});
    node._kind = 'array';
    node._elements = [];
    node._dims = dims;
    node._scalarType = cls;
    node._elementType = complex ? 'complex' : cls;
    return node;
  };

  it.each([
    ['int8', [1, 0]],
    ['uint64', [0, 0]],
    ['single', [0, 1]],
    ['logical', [1, 0]],
    ['double', [1, 0]],
    ['double', [0, 3]],
    ['double', [0, 0, 2]],
  ])('makes a struct of a %s %j, as x.field = 0 does', (cls, dims) => {
    const node = empty(cls as string, dims as number[]);
    expect([node.canAddChild(), node._emptyAddRefusal()]).toEqual([true, null]);
    expect(node.addChildNode().name).toBe('field');
    expect([node.className, node.dims]).toEqual(['struct', [1, 1]]);
  });

  it('makes a struct of a complex empty', () => {
    const node = empty('double', [1, 0], true);
    expect(node.canAddChild()).toBe(true);
    expect(node.addChildNode().name).toBe('field');
  });

  it.each(['Simulink.Parameter', 'matlab.lang.OnOffSwitchState'])('refuses an empty of %s, which MATLAB gives no field', (cls) => {
    const node = empty(cls, [1, 0]);
    expect(node.canAddChild()).toBe(false);
    expect(node.addChildNode()).toBeNull();
    expect(node._emptyAddRefusal()).toBe(`it is an empty 1x0 ${cls} array, to which MATLAB gives no field, and an Add makes no new ${cls} element here`);
  });
});
