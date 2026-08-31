// Copyright 2026 The MathWorks, Inc.
//
// StructNode carries a MATLAB struct variable: a dimensioned grid of elements,
// each element holding the same named fields. It supports both scalar (1x1) and
// multi-element struct arrays, plus add/remove field mutations with undo. The
// JSON and XML serialization paths are on the save path — a bug there is silent
// data corruption in the user's .sldd file.
import { describe, it, expect } from 'vitest';
import StructNode from '../src/datamodel/node/data/StructNode.js';
import '../src/datamodel/node/NodeClassMap.js';

// --- helpers ---------------------------------------------------------------

function parseStruct(fields: string[], elements: Record<string, unknown>[], dims?: number[]): StructNode {
  return StructNode.parse({
    _array_type: 'Struct',
    _dimensions: dims ?? [1, 1],
    _fields: fields,
    _mw_element_type: 'MATLABArray',
    _elements: elements,
  }, 'S', null);
}

// Force the node to the "Modified" code path (bypasses _rawInput shortcut).
function forceModified(node: StructNode): void {
  (node as any).status = 'Modified';
  (node as any)._rawInput = undefined;
}

// --- parse + model ---------------------------------------------------------

describe('StructNode parse', () => {
  it('wraps each element of a multi-element struct as an _isElementNode child', () => {
    const node = parseStruct(['x', 'y'], [{ x: 1, y: 2 }, { x: 3, y: 4 }], [2, 1]);
    expect(node.children.length).toBe(2);
    expect((node.children[0] as any)._isElementNode).toBe(true);
    // Each element child holds the field children.
    expect(node.children[0].children.map((c) => c.name)).toEqual(['x', 'y']);
  });

  it('uses row,column subscripts for a matrix-shaped struct array', () => {
    // Without correct subscript naming the user sees only a flat list index,
    // losing the 2-D structure that MATLAB shows.
    const node = parseStruct(['x'], [{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }], [2, 2]);
    expect(node.children.map((c) => (c as any)._displayName)).toEqual([
      'S(1,1)', 'S(1,2)', 'S(2,1)', 'S(2,2)',
    ]);
  });

  it('uses linear subscripts for a vector struct array', () => {
    const node = parseStruct(['a'], [{ a: 1 }, { a: 2 }], [2, 1]);
    expect(node.children.map((c) => (c as any)._displayName)).toEqual(['S(1)', 'S(2)']);
  });
});

// --- static accessors ------------------------------------------------------

describe('StructNode static accessors', () => {
  it('defaultName returns "Struct" for the Add Variable menu', () => {
    expect(StructNode.defaultName).toBe('Struct');
  });
});

// --- serializeValue (JSON save path) ---------------------------------------

describe('StructNode.serializeValue', () => {
  it('round-trips a multi-element struct array through element nodes', () => {
    // Each element node calls serializeElement, which reads child values per
    // field. If a field child is missing the serialized element gets undefined
    // for that key, so we verify all fields survive.
    const node = parseStruct(['x', 'y'], [{ x: 1, y: 2 }, { x: 3, y: 4 }], [2, 1]);
    forceModified(node);
    for (const child of node.children) { forceModified(child as StructNode); }
    const out = node.serializeValue() as any;
    expect(out._array_type).toBe('Struct');
    expect(out._dimensions).toEqual([2, 1]);
    expect(out._elements).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
    expect(out._fields).toEqual(['x', 'y']);
  });

  it('serializes an element node as a field→value record', () => {
    // This is the _isElementNode code path: the element itself writes the
    // record that gets slotted into the parent's _elements array.
    const node = parseStruct(['a'], [{ a: 10 }, { a: 20 }], [2, 1]);
    const elem = node.children[0] as StructNode;
    forceModified(elem);
    const elemOut = elem.serializeValue() as Record<string, unknown>;
    expect(elemOut).toEqual({ a: 10 });
  });

  it('preserves _mw_element_type on the serialized output', () => {
    const node = parseStruct(['f'], [{ f: 1 }]);
    forceModified(node);
    expect((node.serializeValue() as any)._mw_element_type).toBe('MATLABArray');
  });
});

// --- serializeXml (XML save path) ------------------------------------------

describe('StructNode.serializeXml', () => {
  it('wraps multi-element output in per-element Element tags with a Dimension', () => {
    // A multi-element struct needs each element's children in a separate
    // <Element> so the XML parser can reconstruct the array.
    const node = parseStruct(['x'], [{ x: 1 }, { x: 2 }], [2, 1]);
    const xml = node.serializeXml('P', { Name: 'S' }, 0);
    expect(xml).toContain('Dimension="2*1"');
    expect((xml.match(/<Element>/g) || []).length).toBe(2);
    expect((xml.match(/<\/Element>/g) || []).length).toBe(2);
  });

  it('emits an element node as a bare <Element> with its field children', () => {
    // The element-level XML must NOT carry a Class/Dimension — it is the inner
    // grouping node, not the outer struct wrapper.
    const node = parseStruct(['x'], [{ x: 1 }, { x: 2 }], [2, 1]);
    const elemXml = (node.children[0] as StructNode).serializeXml('Element', {}, 0);
    expect(elemXml).toMatch(/^<Element>\n/);
    expect(elemXml).toContain('<P Name="x"');
    expect(elemXml).not.toContain('Dimension');
  });
});

// --- canRemoveChild / removeChildNode --------------------------------------

describe('StructNode.removeChildNode', () => {
  it('silently ignores a child that does not belong to this node', () => {
    // Defensive guard: the undo system can present a detached child. Crashing
    // or mutating _fields for a foreign node would corrupt the struct.
    const node = parseStruct(['a'], [{ a: 1 }]);
    const foreign = parseStruct(['b'], [{ b: 2 }]);
    const before = node.children.length;
    (node as any).removeChildNode(foreign);
    expect(node.children.length).toBe(before);
  });
});

// --- canAddChild / addChildNode / execAddChild -----------------------------

describe('StructNode.addChildNode', () => {
  it('generates a unique name when "field" already exists', () => {
    // Without the collision avoidance loop, adding to a struct that already has
    // a child named "field" would produce a duplicate, and the duplicate name
    // would silently lose data on serialization.
    const node = parseStruct(['field'], [{ field: 1 }]);
    const added = (node as any).addChildNode();
    expect(added.name).toBe('field1');
    expect(node.children.map((c) => c.name)).toEqual(['field', 'field1']);
    expect((node as any).serial._fields).toEqual(['field', 'field1']);
  });

  it('initializes _fields when the struct had none', () => {
    // An empty struct parsed from a bare { _elements: [{}] } has no _fields
    // array. addChildNode must create one rather than pushing onto undefined.
    const node = StructNode.parse({
      _array_type: 'Struct',
      _dimensions: [1, 1],
      _elements: [{}],
    }, 'S', null);
    expect((node as any).serial._fields).toBeUndefined();
    (node as any).addChildNode();
    expect((node as any).serial._fields).toEqual(['field']);
  });
});

describe('StructNode.execAddChild', () => {
  it('returns an undo/redo pair and the new child node', () => {
    const node = parseStruct(['a'], [{ a: 1 }]);
    const result = (node as any).execAddChild();
    expect(result).not.toBeNull();
    expect(result.node.name).toBe('field');
    expect(node.children.map((c) => c.name)).toEqual(['a', 'field']);

    result.undo();
    expect(node.children.map((c) => c.name)).toEqual(['a']);

    result.redo();
    expect(node.children.map((c) => c.name)).toEqual(['a', 'field']);
  });

  it('returns null for a multi-element struct (fields are locked across elements)', () => {
    const node = parseStruct(['x'], [{ x: 1 }, { x: 2 }], [2, 1]);
    expect((node as any).execAddChild()).toBeNull();
  });
});

// --- execRemoveChild -------------------------------------------------------

describe('StructNode.execRemoveChild', () => {
  it('removes a field and returns undo/redo closures that round-trip correctly', () => {
    // Both the children list AND the _fields array must stay in sync; a
    // mismatch would silently drop or duplicate a field on the next save.
    const node = parseStruct(['a', 'b'], [{ a: 1, b: 2 }]);
    const child = node.children[0];
    const result = (node as any).execRemoveChild(child);
    expect(result).not.toBeNull();
    expect(node.children.map((c) => c.name)).toEqual(['b']);
    expect((node as any).serial._fields).toEqual(['b']);

    result.undo();
    expect(node.children.map((c) => c.name)).toEqual(['a', 'b']);
    expect((node as any).serial._fields).toEqual(['a', 'b']);

    result.redo();
    expect(node.children.map((c) => c.name)).toEqual(['b']);
    expect((node as any).serial._fields).toEqual(['b']);
  });

  it('returns null for a multi-element struct (cannot remove fields across elements)', () => {
    const node = parseStruct(['x'], [{ x: 1 }, { x: 2 }], [2, 1]);
    expect((node as any).execRemoveChild(node.children[0])).toBeNull();
  });

  it('returns null when the target child is not in the children list', () => {
    // canRemoveChild passes (1x1, has children), but indexOf returns -1 for a
    // foreign node — the early-return guard must produce null, not a broken
    // closure that operates on index -1.
    const node = parseStruct(['a'], [{ a: 1 }]);
    const foreign = parseStruct(['a'], [{ a: 9 }]);
    expect((node as any).execRemoveChild(foreign)).toBeNull();
  });
});
