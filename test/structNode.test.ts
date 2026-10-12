// Copyright 2026 The MathWorks, Inc.
//
// StructNode carries a MATLAB struct variable: a dimensioned grid of elements,
// each element holding the same named fields. It supports both scalar (1x1) and
// multi-element struct arrays, plus add/remove field mutations with undo. The
// JSON and XML serialization paths are on the save path — a bug there is silent
// data corruption in the user's .sldd file.
import { describe, it, expect } from 'vitest';
import StructNode from '../src/datamodel/node/data/StructNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';
import { loadFile } from './parity/loadFile.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, ingest } from '../src/index.js';

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
    // losing the 2-D structure that MATLAB shows. The element list arrives in
    // MATLAB's own COLUMN-major order, so element 2 is S(2,1), not S(1,2).
    const node = parseStruct(['x'], [{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }], [2, 2]);
    expect(node.children.map((c) => c.displayName)).toEqual([
      'S(1,1)', 'S(2,1)', 'S(1,2)', 'S(2,2)',
    ]);
  });

  it('labels a 2x3 struct array in MATLAB column-major order', () => {
    // MATLAB-authored truth (gen_truth.m, struct2x3): the linear order is
    // (1,1)(2,1)(1,2)(2,2)(1,3)(2,3), so a label must name the value MATLAB
    // stores at that subscript — a = row*10 + col here.
    const node = parseStruct(['a'], [11, 21, 12, 22, 13, 23].map((n) => ({
      a: { _type: 'double', _value: String(n) },
    })), [2, 3]);
    const pairs = node.children.map((c) => [c.displayName, c.children[0].displayValue]);
    expect(pairs).toEqual([
      ['S(1,1)', '11'], ['S(2,1)', '21'], ['S(1,2)', '12'],
      ['S(2,2)', '22'], ['S(1,3)', '13'], ['S(2,3)', '23'],
    ]);
  });

  it('emits three-part subscripts for a rank-3 struct array', () => {
    // truth.json structNd is 2x3x2; MATLAB's own subscripts run
    // (1,1,1)(2,1,1)(1,2,1)…(2,3,2) and never mention a row 3.
    const elems = Array.from({ length: 12 }, (_, i) => ({ a: i + 1 }));
    const node = parseStruct(['a'], elems, [2, 3, 2]);
    const labels = node.children.map((c) => c.displayName);
    expect(labels[0]).toBe('S(1,1,1)');
    expect(labels[1]).toBe('S(2,1,1)');
    expect(labels[11]).toBe('S(2,3,2)');
    expect(labels.some((s) => /\(3,|\(4,/.test(s))).toBe(false);
  });

  it('uses linear subscripts for a vector struct array', () => {
    const node = parseStruct(['a'], [{ a: 1 }, { a: 2 }], [2, 1]);
    expect(node.children.map((c) => c.displayName)).toEqual(['S(1)', 'S(2)']);
  });

  it('types each element of a struct array as a struct, and each field by its own value', () => {
    // The counterpart of the numeric rule (an int32 array's elements are int32s, see
    // matlabVariableNode.test.ts): a struct array's elements are structs, but the
    // inheritance stops there. Fields hold unrelated values — one int32, one char —
    // so each one's Data Type is its own, never the container's.
    const node = parseStruct(['n', 'tag'], [
      { n: { _type: 'int32', _value: '5' }, tag: 'lo' },
      { n: { _type: 'int32', _value: '6' }, tag: 'hi' },
    ], [1, 2]);
    expect(node.children.map((c) => [c.displayName, c.dataType])).toEqual([
      ['S(1)', 'struct'],
      ['S(2)', 'struct'],
    ]);
    expect(node.children[0].children.map((c) => [c.name, c.dataType])).toEqual([
      ['n', 'int32'],
      ['tag', 'char'],
    ]);
  });
});

// Defect 13. The shape was reachable only through the display string, so any
// consumer wanting MATLAB's size() had to parse the string it was also checking.
describe('StructNode shape as data', () => {
  it('reports every extent, normalized the way MATLAB size() reports it', () => {
    expect(parseStruct(['a'], [{ a: 1 }], [2, 3]).dims).toEqual([2, 3]);
    const nd = parseStruct(['a'], Array.from({ length: 12 }, (_, i) => ({ a: i + 1 })), [2, 3, 2]);
    expect(nd.dims).toEqual([2, 3, 2]);
    // A trailing singleton past the second extent is not part of size().
    expect(parseStruct(['a'], [{ a: 1 }], [2, 3, 1]).dims).toEqual([2, 3]);
    // A struct value with no _dimensions at all is a scalar, as is a 1-extent one.
    expect((StructNode.parse({ _fields: ['a'], _elements: [{ a: 1 }] } as never, 's', null)).dims)
      .toEqual([1, 1]);
    expect(parseStruct(['a'], [{ a: 1 }, { a: 2 }, { a: 3 }], [3]).dims).toEqual([1, 3]);
  });

  it('spells the display value out of that same shape', () => {
    const nd = parseStruct(['a'], Array.from({ length: 12 }, (_, i) => ({ a: i + 1 })), [2, 3, 2]);
    expect(nd.displayValue).toBe('<2x3x2 struct>');
    expect(nd.displayValue).toBe('<' + nd.dims.join('x') + ' struct>');
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

// --- renaming a field ------------------------------------------------------

describe('StructNode field rename', () => {
  it('renames the field on every element of a struct array', () => {
    // A struct array has ONE field list shared by all its elements, so renaming a
    // field is a whole-array operation. The rename used to rewrite that shared
    // list while renaming the child of only the element the user was editing, so
    // every OTHER element then serialized its value under a field name it no
    // longer had — undefined, and the value simply gone from the saved .sldd.
    const node = parseStruct(['x', 'y'], [{ x: 1, y: 2 }, { x: 3, y: 4 }], [2, 1]);
    const firstElement = node.children[0];

    expect((firstElement.children[0] as any).setProperty('Name', 'renamed')).toBe(true);

    const json = JSON.parse(JSON.stringify(node.serializeValue()));
    expect(json._fields).toEqual(['renamed', 'y']);
    expect(json._elements).toEqual([
      { renamed: 1, y: 2 },
      { renamed: 3, y: 4 },
    ]);
    // The XML save path has to agree — it names each <P> from the child node.
    expect(node.serializeXml('P', { Name: 'S' }, 0)).not.toContain('Name="x"');
  });

  it('renames from a non-first element and restores on rename back', () => {
    const node = parseStruct(['x', 'y'], [{ x: 1, y: 2 }, { x: 3, y: 4 }], [2, 1]);
    const secondElement = node.children[1];

    (secondElement.children[1] as any).setProperty('Name', 'why');
    expect(JSON.parse(JSON.stringify(node.serializeValue()))._elements).toEqual([
      { x: 1, why: 2 },
      { x: 3, why: 4 },
    ]);

    // Renaming back is how undo of a rename is spelled, so it has to land exactly.
    (secondElement.children[1] as any).setProperty('Name', 'y');
    expect(JSON.parse(JSON.stringify(node.serializeValue()))._elements).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });

  it('renames a field of a scalar struct', () => {
    const node = parseStruct(['a', 'b'], [{ a: 1, b: 2 }]);
    (node.children[0] as any).setProperty('Name', 'a2');
    const json = JSON.parse(JSON.stringify(node.serializeValue()));
    expect(json._fields).toEqual(['a2', 'b']);
    expect(json._elements).toEqual([{ a2: 1, b: 2 }]);
  });

  it('a renamed struct ENTRY is written as it was read: the name is not in its value', () => {
    // MATLAB's sObjArr holds a Simulink.Parameter array whose elements carry an `_id`,
    // which a struct rebuilt from its nodes does not write. A rename used to rebuild it.
    const design = loadFile('../fixtures/cellarr_text.sldd').getSection('design');
    const entry = design.children.find((e: any) => e.name === 'sObjArr');
    const before = JSON.parse(JSON.stringify(entry.serialize())).value;
    expect(JSON.stringify(before)).toContain('"_id"');
    expect(entry.setProperty('Name', 'sObjArrRenamed')).toBe(true);
    expect(JSON.parse(JSON.stringify(entry.serialize())).value).toEqual(before);
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

  it('pushes onto the empty list parse derives for a struct with no fields', () => {
    // A bare { _elements: [{}] } declares no _fields, and parse derives one from the
    // element bag — empty, here, because the bag is. So the list addChildNode pushes
    // onto always exists: `serial._fields` is an ARRAY for every parsed struct, which
    // is what lets serializeElement and the rename/remove/restore hooks read it without
    // each re-deciding what a missing key means. See structFieldsAcrossBuilds.test.ts.
    const node = StructNode.parse({
      _array_type: 'Struct',
      _dimensions: [1, 1],
      _elements: [{}],
    }, 'S', null);
    expect((node as any).serial._fields).toEqual([]);
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

// A dictionary struct's field names are the FILE's words, in both formats. Three places
// used them as keys of a plain object:
//   - the binary reader gathered an element's <P Name="…"> children into `{}`, so a field
//     called `__proto__` was the prototype setter's argument and vanished on open;
//   - StructNode.serializeElement rebuilt each element into `{}` on save, so a text
//     dictionary's `__proto__` field lost its value there while `_fields` still named it;
//   - StructNode.parse read each declared field off the element by plain indexing, so a
//     field the list names and the element does not hold read an INHERITED member: the
//     row showed `function Object() { [native code] }` for `constructor`, and the reopened
//     `__proto__` field above showed `[object Object]`.
// Each is now a field like any other. Derived from rt_text.sldd / rt_bin.sldd, whose
// gadget.Specs is a 1x1 struct of `mass` (1500) and `color` ('red').
describe('a dictionary struct field named after an Object.prototype member', () => {
  const INHERITED = [
    'toString', 'valueOf', 'constructor', 'hasOwnProperty', 'isPrototypeOf',
    'propertyIsEnumerable', 'toLocaleString', '__proto__', '__defineGetter__',
  ];
  const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));

  // `color` renamed, in the element and (text) in the declared field list.
  const VENUES = {
    text: (name: string): string => fixture('rt_text.sldd').toString('utf8')
      .replace('"color": "red"', `${JSON.stringify(name)}: "red"`)
      .replace(/"_fields": \[\s*"mass",\s*"color"\s*\]/, `"_fields": ["mass", ${JSON.stringify(name)}]`),
    binary: (name: string): Uint8Array => {
      const files = unzipSync(new Uint8Array(fixture('rt_bin.sldd')));
      files['data/chunk0.xml'] = strToU8(strFromU8(files['data/chunk0.xml'])
        .replace('<P Name="color" Class="char">red</P>', `<P Name="${name}" Class="char">red</P>`));
      return zipSync(files);
    },
  };

  const specsRows = (source: any) => {
    const specs = source.flatten().find((n: any) => n.name === 'Specs');
    return specs.children.map((c: any) => [c.name, c.displayValue]);
  };

  it.each(['text', 'binary'] as const)('opens, edits, saves and reopens one in a %s dictionary', (venue) => {
    for (const name of [...INHERITED, 'colour']) {
      const session = createSession();
      const source: any = ingest(session, VENUES[venue](name), { filename: 'gadget.sldd' });
      expect([name, specsRows(source)]).toEqual([name, [['mass', '1500'], [name, "'red'"]]]);

      const specs = source.flatten().find((n: any) => n.name === 'Specs');
      expect(specs.children.find((c: any) => c.name === 'mass').setProperty('Value', '1600')).toBe(true);
      const saved = session.serializeSource(source.name)!;
      const reopened = ingest(createSession(), saved.kind === 'text' ? saved.text : saved.bytes, { filename: 'gadget.sldd' });
      expect([name, specsRows(reopened)]).toEqual([name, [['mass', '1600'], [name, "'red'"]]]);
    }
  });

  it('reads a declared field the element does not hold as absent, whatever it is called', () => {
    const declaring = (name: string) => fixture('rt_text.sldd').toString('utf8')
      .replace(/"_fields": \[\s*"mass",\s*"color"\s*\]/, `"_fields": ["mass", "color", ${JSON.stringify(name)}]`);
    const third = (name: string) => specsRows(ingest(createSession(), declaring(name), { filename: 'gadget.sldd' }))[2];
    const absent = third('other')[1];
    for (const name of INHERITED) {
      expect(third(name)).toEqual([name, absent]);
    }
  });
});
