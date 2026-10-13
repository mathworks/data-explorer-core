// Copyright 2026 The MathWorks, Inc.
// Unit tests for ObjectNode — the generic node for a MATLAB class instance whose
// class the data model has no typed node for (Simulink.VariableUsage, a user
// class, …). Two things make it delicate. Its children are CLASS PROPERTIES, not
// struct fields, so their names are fixed by the class definition; and it has to
// write back — a loaded object emits its raw value verbatim unless serializeValue
// rebuilds the property bag from the live child nodes (issue #3), which silently
// discards edits.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
// Importing the class map registers the NodeRegistry the element dispatch uses.
import '../src/datamodel/node/data/NodeClassMap.js';
import ObjectNode from '../src/datamodel/node/data/ObjectNode.js';
import { createSession, ingest, serializeEntryToXml } from '../src/index.js';
import { regenerateChunkXml, regenerateEntryXml } from '../src/datamodel/parser/BinarySlddSerializer.js';

// A top-level value object: { _array_class, _elements: [{ _properties }] }.
function valueObject(cls: string, elements: Record<string, unknown>[], dimensions?: number[]) {
  return {
    _array_class: cls,
    _array_type: 'MATLABArray',
    _dimensions: dimensions ?? [1, elements.length],
    _mw_element_type: 'MATLABArray',
    _elements: elements.map((props) => ({ _properties: props })),
  };
}

const parse = (raw: Record<string, unknown>, name = 'obj') => ObjectNode.parse(raw, name, null) as any;

describe('ObjectNode — scalar object', () => {
  it('expands its properties as children', () => {
    const n = parse(valueObject('Simulink.VariableUsage', [{ Name: 'Ka', Source: 'f14' }]));
    expect(n.className).toBe('Simulink.VariableUsage');
    expect(n.children.map((c: any) => c.name)).toEqual(['Name', 'Source']);
  });

  it('also accepts the nested-object shape, which has no _elements wrapper', () => {
    // Reached when a struct field or cell element is itself an object; both shapes
    // must expand identically or a nested object stops opening in the tree.
    const n = parse({ _object_class: 'My.Thing', _properties: { A: 1, B: 'x' } });
    expect(n.className).toBe('My.Thing');
    expect(n.children.map((c: any) => c.name)).toEqual(['A', 'B']);
  });

  it('shows a dimensions-and-class summary instead of a value', () => {
    // An object has no scalar value to print, so the cell describes its shape;
    // the angle brackets are what makes BaseNode treat it as non-editable.
    const n = parse(valueObject('My.Thing', [{ A: 1 }]));
    expect(n.displayValue).toBe('<1x1 My.Thing>');
    expect(n.valueEditable).toBe(false);
  });

  it('reads 1x1 when the value carries no dimensions vector', () => {
    // A nested object has no _dimensions key; it is a scalar by construction.
    expect(parse({ _object_class: 'Z', _properties: {} }).displayValue).toBe('<1x1 Z>');
    expect(parse({ _array_class: 'Z', _elements: [] }).displayValue).toBe('<1x1 Z>');
  });

  it('marks its children as class properties, so none can be renamed', () => {
    // A struct field can be renamed; a class property cannot — its name is part
    // of the class definition.
    const n = parse(valueObject('My.Thing', [{ A: 1 }]));
    expect(n.isObjectPropertyBag).toBe(true);
    expect(n.children[0].nameEditable).toBe(false);
  });

  it('uses the generic object icon, and the service-interface icon when derived', () => {
    const n = parse(valueObject('Simulink.ServiceBus', [{}]));
    // ws3d, the class-instance glyph — not wsDefault, which is the plain-variable
    // one and made an object of a customer class look like a double.
    expect(n.icon).toBe('ws3d');
    // A derived Simulink.ServiceBus is Architectural Data, not a plain object.
    n.metadata = { isderived: '1' };
    expect(n.icon).toBe('serviceInterfaces');
  });

  it('offers the object property set in the table and inspector', () => {
    const n = parse(valueObject('My.Thing', [{ A: 1 }]));
    expect(n.getProperties().map((p: any) => p.key)).toEqual(['Name', 'Value', 'DataType', 'Description']);
    expect(n.getPILayout()).toEqual([
      { group: 'General', items: expect.arrayContaining(n.getProperties()) },
    ]);
    // Kind and Class are inspector-only, so they appear in the PI layout but the
    // table gets them from toRow's own fallbacks.
    expect(n.getPILayout()[0].items.map((p: any) => p.key)).toEqual([
      'Name', 'Value', 'DataType', 'Kind', 'Class', 'Description',
    ]);
  });
});

describe('ObjectNode — object array', () => {
  it('expands one element child per array element, named by subscript', () => {
    const n = parse(valueObject('Simulink.VariableUsage', [{ Name: 'Ka' }, { Name: 'Kf' }], [2, 1]), 'usages');
    expect(n._isElementArray).toBe(true);
    expect(n.children.map((c: any) => c.displayName)).toEqual(['usages(1)', 'usages(2)']);
    // Each element expands into its own property rows.
    expect(n.children[0].children.map((c: any) => c.name)).toEqual(['Name']);
  });

  it('grays element names, since a subscript is not a user-assigned identifier', () => {
    const n = parse(valueObject('My.Thing', [{ A: 1 }, { A: 2 }], [2, 1]), 'arr');
    expect(n.children.map((c: any) => c.isElementName)).toEqual([true, true]);
  });

  it('uses row,column subscripts for a matrix, in MATLAB column-major order', () => {
    // The element list arrives in MATLAB's own order, so element 2 is m(2,1).
    const n = parse(valueObject('My.Thing', [{ N: 1 }, { N: 2 }, { N: 3 }, { N: 4 }], [2, 2]), 'm');
    expect(n.children.map((c: any) => c.displayName)).toEqual(['m(1,1)', 'm(2,1)', 'm(1,2)', 'm(2,2)']);
  });

  it('routes each element back through the registry, so a known class stays typed', () => {
    // An array of Simulink.Parameter must produce ParameterNodes, exactly as a
    // standalone scalar parameter would — the array wrapper must not downgrade
    // elements to generic objects.
    const n = parse(valueObject('Simulink.Parameter', [{ Value: 1 }, { Value: 2 }], [2, 1]), 'arr');
    expect(n.children.map((c: any) => c.constructor.name)).toEqual(['ParameterNode', 'ParameterNode']);
  });

  it('treats a single-element array as a scalar, expanding properties directly', () => {
    // A 1x1 object is not an array: its properties are the rows the user sees.
    const n = parse(valueObject('My.Thing', [{ A: 1 }]));
    expect(n._isElementArray).toBeUndefined();
    expect(n.children.map((c: any) => c.name)).toEqual(['A']);
  });

  it('expands nothing for an empty object or an empty array', () => {
    expect(parse({ _array_class: 'X', _elements: [] }).children).toEqual([]);
    expect(parse({ _array_class: 'X' }).children).toEqual([]);
    expect(parse({ _object_class: 'Y' }).children).toEqual([]);
  });
});

describe('ObjectNode.serializeValue', () => {
  it('rebuilds _properties from the live children after an edit', () => {
    // Without this the loaded raw value is emitted verbatim and the edit vanishes.
    const n = parse(valueObject('My.Thing', [{ A: 1, B: 'x' }]));
    expect(n.children[0].setProperty('Value', '42')).toBe(true);
    expect(n.serializeValue()).toMatchObject({
      _array_class: 'My.Thing',
      _elements: [{ _properties: { A: 42, B: 'x' } }],
    });
  });

  it('keeps the element identity keys the dictionary uses', () => {
    // `_id` is the dictionary's handle for the object; dropping it on write-back
    // would orphan the entry.
    const raw = {
      _array_class: 'My.Thing',
      _array_type: 'MATLABArray',
      _dimensions: [1, 1],
      _mw_element_type: 'MATLABArray',
      _elements: [{ _id: 'e0', _properties: { A: 1 } }],
    };
    const n = parse(raw);
    n.children[0].setProperty('Value', '2');
    const out = n.serializeValue() as any;
    expect(out._elements[0]._id).toBe('e0');
    expect(out._mw_element_type).toBe('MATLABArray');
  });

  it('keeps the nested-object shape when writing a nested object back', () => {
    const n = parse({ _object_class: 'My.Thing', _properties: { A: 1 } });
    n.children[0].setProperty('Value', '9');
    expect(n.serializeValue()).toEqual({ _object_class: 'My.Thing', _properties: { A: 9 } });
  });

  it('returns the raw value untouched when nothing was expanded', () => {
    // An empty object has no children to rebuild from, so the loaded value is
    // still the most accurate thing to write.
    const raw = { _array_class: 'X', _elements: [] };
    expect(parse(raw).serializeValue()).toBe(raw);
  });

  it('rebuilds one entry per element for an array, editing only the touched one', () => {
    const n = parse(valueObject('My.Thing', [{ N: 1 }, { N: 2 }], [2, 1]), 'arr');
    n.children[0].children[0].setProperty('Value', '99');
    expect(n.serializeValue()).toMatchObject({
      _dimensions: [2, 1],
      _elements: [{ _properties: { N: 99 } }, { _properties: { N: 2 } }],
    });
  });

  it('normalises a typed element back to a bare property bag', () => {
    // A ParameterNode serializes as { _array_class, _elements: [{_properties}] };
    // nesting that whole wrapper inside the outer array would double-wrap it.
    const n = parse(valueObject('Simulink.Parameter', [{ Value: 1 }, { Value: 2 }], [2, 1]), 'arr');
    n.children[0].setProperty('Value', '5');
    expect(n.serializeValue()).toMatchObject({
      _array_class: 'Simulink.Parameter',
      _elements: [{ _properties: { Value: 5 } }, { _properties: { Value: 2 } }],
    });
  });
});

describe('ObjectNode.serializeXml', () => {
  it('emits one <Element> per array element, with a Dimension attribute', () => {
    const n = parse(valueObject('Simulink.VariableUsage', [{ Name: 'Ka' }, { Name: 'Kf' }], [2, 1]), 'usages');
    expect(n.serializeXml('P', { Name: 'usages' }, 0)).toBe(
      '<P Name="usages" Dimension="2*1">\n' +
        '    <Element Class="Simulink.VariableUsage">\n' +
        '        <P Name="Name" Class="char">Ka</P>\n' +
        '    </Element>\n' +
        '    <Element Class="Simulink.VariableUsage">\n' +
        '        <P Name="Name" Class="char">Kf</P>\n' +
        '    </Element>\n' +
        '</P>',
    );
  });

  it('derives the Dimension from the element count when the value carries none', () => {
    const n = parse({ _array_class: 'My.Thing', _elements: [{ _properties: {} }, { _properties: {} }] }, 'arr');
    expect(n.serializeXml('P', undefined, 0)).toContain('<P Dimension="2*1">');
  });

  it('falls back to the single-element form for a scalar object', () => {
    // Only an array needs the multi-<Element> shape; a scalar must keep emitting
    // exactly what DataNode writes, or a round-trip would change the file.
    const n = parse(valueObject('My.Thing', [{ A: 1 }]));
    expect(n.serializeXml('P', { Name: 'obj' }, 0)).not.toContain('Dimension=');
  });
});

// A `_`-named key in an object's property bag is not a property — a MATLAB identifier cannot
// begin with `_` — so _addPropertyChildren gives it no row. Two kinds reach a bag. MATLAB's
// own: a `table` in a text dictionary carries `_overridden_arrayProps`, `_overridden_data`,
// `_overridden_metaDim`, `_overridden_rowDim` and `_overridden_varDim` beside its
// properties. And the reader's: a binary dictionary's saveobj envelope, filed under
// SAVEOBJ_KEY (`_saveobj`), which for a class with no typed node is the object's whole state.
// A write rebuilds the bag from the rows, so these keys can only come from the bag the rows
// were read from, and the node looked for that bag in `serial._properties`, which `parse` never
// set. So every one was dropped: from a text dictionary's object entry on any save, from a
// table inside a struct on the first edit anywhere in the struct, and an object of an
// unregistered saveobj class went to a binary dictionary as an empty <Element>.
describe('ObjectNode keeps the `_`-named keys of its property bag', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
  const content = (json: any) => json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content;
  // A file need not hold a bag's `_`-named keys first, so here they sit between properties.
  const bag = () => ({ Alpha: 1, _overridden_data: [], Beta: 'x', _hidden: { k: 2 }, gamma: 3 });
  const SHAPES: Array<[string, () => Record<string, unknown>]> = [
    ['a value object', () => valueObject('My.Thing', [bag()])],
    ['a nested object', () => ({ _object_class: 'My.Thing', _properties: bag() })],
  ];
  const propsOf = (out: any) => (out._object_class ? out._properties : out._elements[0]._properties);

  it.each(SHAPES)('writes each one back where %s had it, untouched and after an edit', (_, raw) => {
    const n = parse(raw());
    expect(n.children.map((c: any) => c.name)).toEqual(['Alpha', 'Beta', 'gamma']);
    expect(JSON.stringify(propsOf(n.serializeValue()))).toBe(JSON.stringify(bag()));
    expect(n.children[0].setProperty('Value', '7')).toBe(true);
    expect(JSON.stringify(propsOf(n.serializeValue()))).toBe(JSON.stringify({ ...bag(), Alpha: 7 }));
  });

  it('writes a `__proto__` key back as the own key it was read as', () => {
    // JSON.parse makes it an own key; an assignment into the rebuilt bag would hand it to
    // Object.prototype's setter instead (parser/ownKeys.ts).
    const text = '{"_object_class":"My.Thing","_properties":{"A":1,"__proto__":{"B":2},"c":3}}';
    const n = parse(JSON.parse(text));
    expect(n.children[0].setProperty('Value', '2')).toBe(true);
    const out = n.serializeValue() as any;
    expect(Object.getPrototypeOf(out._properties)).toBe(Object.prototype);
    expect(JSON.stringify(out)).toBe(text.replace('"A":1', '"A":2'));
  });

  it('saves a text dictionary object entry with every one in its place, untouched and after an edit', () => {
    const json = JSON.parse(read('./fixtures/rt_text.sldd').toString('utf8'));
    const value = content(json).entries[0].value;
    const { Engine, Name, Specs, Tags, Wheels } = value._elements[0]._properties;
    Engine._properties = { _first: 'e', ...Engine._properties };
    value._elements[0]._properties = { Engine, Name, _overridden_data: [], Specs, Tags, Wheels, _zz: { _type: 'int8', _value: '3' } };
    const written = JSON.stringify(value);

    const session = createSession();
    const source: any = ingest(session, JSON.stringify(json, null, '\t'), { filename: 'gadget.sldd' });
    const saved = () => JSON.stringify(content(JSON.parse((session.serializeSource(source.name) as { text: string }).text)).entries[0].value);
    expect(saved()).toBe(written);
    const wheels = source.flatten().find((n: any) => n.name === 'Wheels');
    expect(wheels.setProperty('Value', '5')).toBe(true);
    expect(saved()).toBe(written.replace('"Wheels":4', '"Wheels":5'));
  });

  it('saves a table inside a struct with its `_overridden_*` keys after an edit elsewhere in the struct', () => {
    // The shape MATLAB writes for a struct with a table field. The struct replays its raw
    // value until something in it is edited; from then on each field is rebuilt from its
    // node, and the table's node is an ObjectNode.
    const table = {
      _array_class: 'table',
      _dimensions: [1, 1],
      _elements: [{
        _id: '3',
        _properties: {
          _overridden_arrayProps: [], _overridden_data: [], _overridden_metaDim: [], _overridden_rowDim: [], _overridden_varDim: [],
          data: { _array_type: 'Cell', _dimensions: [1, 2], _elements: [1, 2] },
          ndims: 2, nrows: 1, nvars: 2,
          rownames: { _array_type: 'Cell', _dimensions: [0, 0], _elements: [] },
          varnames: { _array_type: 'Cell', _dimensions: [1, 2], _elements: ['Var1', 'Var2'] },
        },
      }],
    };
    const json = JSON.parse(read('./fixtures/rt_text.sldd').toString('utf8'));
    const entries = content(json).entries;
    entries.push({
      name: 'mixed',
      metadata: { ...entries[0].metadata, uuid: 'a43e9523-8ba6-426a-b689-6e7d85901371' },
      value: { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ fTable: table, fVar: 1 }], _mw_element_type: 'MATLABArray' },
    });
    const text = JSON.stringify(json, null, '\t');
    const tableOf = (value: any) => JSON.stringify(value._elements[0].fTable);

    for (const [edited, to] of [['fVar', '42'], ['nrows', '2']]) {
      const session = createSession();
      const source: any = ingest(session, text, { filename: 'gadget.sldd' });
      const entry = source.flatten().find((n: any) => n.name === 'mixed');
      expect(entry.flatten().find((n: any) => n.name === edited).setProperty('Value', to)).toBe(true);
      const expected = edited === 'nrows' ? JSON.stringify(table).replace('"nrows":1', '"nrows":2') : JSON.stringify(table);
      const saved = content(JSON.parse((session.serializeSource(source.name) as { text: string }).text)).entries;
      expect([edited, tableOf(saved.find((e: any) => e.name === 'mixed').value)]).toEqual([edited, expected]);
      // The entry alone, as a host re-serializes the one entry it changed.
      expect([edited, tableOf((entry.serialize() as any).value)]).toEqual([edited, expected]);
    }
  });

  it('saves every bag of custom_object_text.sldd with one added, and nothing else differently', () => {
    // Its 12 bags span every route into ObjectNode: a top-level object entry, a nested object,
    // the elements of an object array, a Simulink.Parameter nested in an object, and objects
    // inside a cell. One marker per bag, last in the bag.
    const original = read('./fixtures/custom_object_text.sldd').toString('utf8');
    const json = JSON.parse(original);
    let added = 0;
    const mark = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(mark); return; }
      if (!v || typeof v !== 'object') { return; }
      const o = v as Record<string, unknown>;
      if (o._properties && typeof o._properties === 'object' && !Array.isArray(o._properties)) {
        (o._properties as Record<string, unknown>)._zz = 'marker' + added++;
      }
      Object.values(o).forEach(mark);
    };
    mark(json);
    expect(added).toBe(12);

    const save = (text: string) => {
      const session = createSession();
      const source: any = ingest(session, text, { filename: 'custom_object.sldd' });
      return (session.serializeSource(source.name) as { text: string }).text;
    };
    const saved = save(JSON.stringify(json, null, '\t'));
    const kept = [...saved.matchAll(/"_zz": "marker(\d+)"/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
    expect(kept).toEqual([...Array(12).keys()]);
    const stripped = JSON.stringify(JSON.parse(saved), (k, v) => (k === '_zz' ? undefined : v));
    expect(stripped).toBe(JSON.stringify(JSON.parse(save(original))));
  });

  describe('of a class that serializes through saveobj and has no typed node', () => {
    // parity/artifacts/binary/cases.sldd's aVariant is a Simulink.VariantVariable, whose
    // whole state is its saveobj envelope. Under a class name this package does not model,
    // the same bytes are an ObjectNode with no rows, and the envelope is the bag's one key.
    const CLASS = 'my.SaveobjCls';
    const files = unzipSync(new Uint8Array(read('./parity/artifacts/binary/cases.sldd')));
    const chunk = strFromU8(files['data/chunk0.xml']).replace(
      '<Element Class="Simulink.VariantVariable">', `<Element Class="${CLASS}">`,
    );
    const bytes = zipSync({ ...files, 'data/chunk0.xml': strToU8(chunk) });
    // The aVariant entry's <P Name="Value"> as the file holds it.
    const valueOf = (xml: string): string => {
      const start = xml.indexOf('<P Name="Value">', xml.indexOf('<P Name="Name" Class="char">aVariant</P>'));
      return xml.slice(start, xml.indexOf('\n        </P>', start) + '\n        </P>'.length);
    };
    const written = valueOf(chunk);

    it('reads the class as an object with no rows', () => {
      expect(written).toContain(`<Element Class="${CLASS}">`);
      expect(written).toContain('<P Source="saveobj" PropertyType="any" Class="struct">');
      const source: any = ingest(createSession(), bytes, { filename: 'cases.sldd' });
      const entry = source.flatten().find((n: any) => n.name === 'aVariant');
      expect([entry.constructor.name, entry.children.length]).toEqual(['ObjectNode', 0]);
    });

    it('writes the envelope back on a binary save, as the file had it', () => {
      const session = createSession();
      const source: any = ingest(session, bytes, { filename: 'cases.sldd' });
      const saved = session.serializeSource(source.name) as { bytes: Uint8Array };
      expect(valueOf(strFromU8(unzipSync(saved.bytes)['data/chunk0.xml']))).toBe(written);
      // A save writes the unedited entry as its own bytes; the writer writes the same.
      expect(valueOf(regenerateChunkXml(source))).toBe(written);
    });

    it('writes the envelope into the entry a host splices in, untouched and renamed', () => {
      const source: any = ingest(createSession(), bytes, { filename: 'cases.sldd' });
      const entry = source.flatten().find((n: any) => n.name === 'aVariant');
      expect(valueOf(serializeEntryToXml(entry))).toBe(written);
      expect(valueOf(regenerateEntryXml(entry))).toBe(written);
      expect(entry.setProperty('Name', 'aVariant2')).toBe(true);
      expect(valueOf(serializeEntryToXml(entry).replace('>aVariant2<', '>aVariant<'))).toBe(written);
    });
  });

  describe('in a binary dictionary, where the saveobj envelope is the only one with an XML spelling', () => {
    // MATLAB writes a table's `_overridden_*` keys into a text dictionary and not into a binary
    // one: the corpus's binary twin of parity/dNJSON_SLDDApi.sldd holds the same table with none
    // of them. Nor can the XML spell them, because no `_`-named key but SAVEOBJ_KEY has a <P>
    // spelling (DataNode.pxAttrs), so one goes out as `<P Name="_overridden_data" …>`, a property
    // the class does not have. A host pastes a text dictionary's entry into a binary one from its
    // JSON (entry.serialize(), then section.parseEntry), so the keys do arrive in a binary
    // dictionary's nodes, and here they are pasted along every route a table takes into the
    // XML: its own entry, a struct field, a cell element, an object array's element, an
    // object's property in both of its shapes, and a Parameter's Value.
    const RESERVED = ['_overridden_arrayProps', '_overridden_data', '_overridden_metaDim', '_overridden_rowDim', '_overridden_varDim'];
    const PROPS = ['data', 'ndims', 'nrows', 'nvars', 'rownames', 'varnames'];
    const tableProps = () => ({
      ...Object.fromEntries(RESERVED.map((k) => [k, []])),
      data: { _array_type: 'Cell', _dimensions: [1, 2], _elements: [1, 2] },
      ndims: 2, nrows: 1, nvars: 2,
      rownames: { _array_type: 'Cell', _dimensions: [0, 0], _elements: [] },
      varnames: { _array_type: 'Cell', _dimensions: [1, 2], _elements: ['Var1', 'Var2'] },
    });
    const table = () => ({ _array_class: 'table', _dimensions: [1, 1], _elements: [{ _id: '3', _properties: tableProps() }] });
    const struct = (fields: Record<string, unknown>[]) => ({ _array_type: 'Struct', _dimensions: [1, fields.length], _elements: fields, _mw_element_type: 'MATLABArray' });
    const gravity = content(JSON.parse(read('./parity/artifacts/text/params.sldd').toString('utf8'))).entries.find((e: any) => e.name === 'gravity').value;
    const inParameter = JSON.parse(JSON.stringify(gravity));
    inParameter._elements[0]._properties.Value = table();
    const VALUES: Record<string, [unknown, number]> = {
      tbl: [table(), 1],
      inStruct: [struct([{ fTable: table(), fVar: 1 }]), 1],
      inCell: [{ _array_type: 'Cell', _dimensions: [1, 2], _elements: [table(), 1] }, 1],
      tableArray: [{ _array_class: 'table', _dimensions: [1, 2], _elements: [{ _properties: tableProps() }, { _properties: tableProps() }] }, 2],
      inObject: [valueObject('My.Thing', [{ T: table(), x: 1 }]), 1],
      inNestedObject: [valueObject('My.Thing', [{ T: { _object_class: 'table', _properties: tableProps() }, x: 1 }]), 1],
      inParameter: [inParameter, 1],
    };
    const text = (() => {
      const json = JSON.parse(read('./fixtures/rt_text.sldd').toString('utf8'));
      const entries = content(json).entries;
      Object.entries(VALUES).forEach(([name, [value]], i) => {
        entries.push({ name, metadata: { ...entries[0].metadata, uuid: `a43e9523-8ba6-426a-b689-6e7d8590${1000 + i}` }, value });
      });
      return JSON.stringify(json, null, '\t');
    })();
    // The <P> names directly under every table element in `xml`, one list per table.
    const tablePs = (xml: string): string[][] =>
      xml.split('<Element Class="table">').slice(1).map((after) => {
        const depth = (after.match(/^\n( *)/) as RegExpMatchArray)[1];
        const body = after.slice(0, after.indexOf('\n' + depth.slice(4) + '</Element>'));
        return [...body.matchAll(new RegExp('^' + depth + '<P Name="([^"]+)"', 'gm'))].map((m) => m[1]);
      });

    it.each(Object.keys(VALUES))('writes none of a table\'s from %s pasted in, and the copy keeps them', (name) => {
      const tables = VALUES[name][1];
      const entry = ingest(createSession(), text, { filename: 'gadget.sldd' }).flatten().find((n: any) => n.name === name) as any;
      const payload = JSON.parse(JSON.stringify(entry.serialize()));
      expect(JSON.stringify(payload).split('"_overridden_').length - 1).toBe(RESERVED.length * tables);

      const session = createSession();
      const binary: any = ingest(session, read('./parity/artifacts/binary/cases.sldd'), { filename: 'cases.sldd' });
      const design = binary.getSection('design');
      const pasted = design.parseEntry({ ...payload, name: name + 'Pasted', metadata: { ...design.children[0].metadata, uuid: 'b43e9523-8ba6-426a-b689-6e7d85901372' } });
      const fragment = serializeEntryToXml(pasted);
      const chunk = strFromU8(unzipSync((session.serializeSource(binary.name) as { bytes: Uint8Array }).bytes)['data/chunk0.xml']);
      expect(tablePs(fragment)).toEqual(Array(tables).fill(PROPS));
      expect(chunk).toContain('<P Name="Name" Class="char">' + name + 'Pasted</P>');
      expect(chunk).not.toContain('_overridden_');
    });

    it('writes none of them from a text dictionary\'s entry either, where the object writes its own XML', () => {
      // Not a host's route, since a host writes XML for a binary dictionary only, but the XML
      // writer cannot spell them for any dictionary. Left out: an object nested in another
      // node's property bag, which that node's XML spells from the object's JSON, and which in
      // a text dictionary has to keep them.
      const source: any = ingest(createSession(), text, { filename: 'gadget.sldd' });
      for (const name of ['tbl', 'inStruct', 'inCell', 'tableArray']) {
        const xml = serializeEntryToXml(source.flatten().find((n: any) => n.name === name));
        expect([name, tablePs(xml)]).toEqual([name, Array(VALUES[name][1]).fill(PROPS)]);
      }
    });
  });
});

// An object's element is an object in every file MATLAB writes, but a text dictionary is JSON
// anyone can edit, and an element can be `null`. ObjectNode.parse read `_properties` off it,
// which threw ("Cannot read properties of null (reading '_properties')"), and the throw failed
// the open of the whole dictionary: for a scalar of a class with no node of its own, and for an
// object array of any class. A typed scalar opened, but its save rebuilt the element, as
// `{"_properties":{}}`, or as a `_custom_save` envelope of null for a class that saves through
// saveobj. The null is now kept as read. The element shows as one with no property rows; an
// untouched or renamed save and a copy write the null back, and so does a save after an edit
// of a sibling element. Written as XML, for a binary dictionary, which has no spelling of a
// null element, it is written wherever it sits as `{"_properties":{}}` is written there.
describe('an object value with a null element', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
  const control = read('./fixtures/rt_text.sldd').toString('utf8');
  const content = (json: any) => json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content;
  // rt_text.sldd with one more entry per value, in order.
  const withEntries = (values: Record<string, unknown>): string => {
    const json = JSON.parse(control);
    const entries = content(json).entries;
    Object.entries(values).forEach(([name, value], i) => {
      entries.push({ name, metadata: { ...entries[0].metadata, uuid: `a43e9523-8ba6-426a-b689-6e7d8591${1000 + i}` }, value });
    });
    return JSON.stringify(json, null, '\t');
  };
  const open = (text: string) => {
    const session = createSession();
    const source: any = ingest(session, text, { filename: 'gadget.sldd' });
    const entry = (name: string) => source.flatten().find((n: any) => n.name === name);
    const saved = () => (session.serializeSource(source.name) as { text: string }).text;
    const savedValue = (name: string) => content(JSON.parse(saved())).entries.find((e: any) => e.name === name).value;
    return { source, entry, saved, savedValue };
  };
  // Every row under an entry, by path, with the value it shows.
  const rowsOf = (node: any, path = node.name): string[] =>
    [path + ' = ' + String(node.displayValue), ...node.children.flatMap((c: any) => rowsOf(c, path + '/' + c.displayName))];
  const scalar = (cls: string, element: unknown = null) => ({ _array_class: cls, _dimensions: [1, 1], _elements: [element], _mw_element_type: 'MATLABArray' });
  const array = (cls: string, props: Record<string, unknown>, second: unknown = null) => ({
    _array_class: cls, _dimensions: [1, 2], _elements: [{ _properties: props }, second], _mw_element_type: 'MATLABArray',
  });
  // A registered class, one with its own typed node, and a class with no node of its own; each
  // with a first array element to edit and the edit.
  const CLASSES: Array<[string, string, Record<string, unknown>, (element: any) => unknown]> = [
    ['Simulink.Parameter', 'ParameterNode', { Value: 1 }, (element) => element.setProperty('Value', '5')],
    ['Widget', 'ObjectNode', { A: 1 }, (element) => element.children[0].setProperty('Value', '7')],
    ['Simulink.Signal', 'SignalNode', { Description: 'd' }, (element) => element.setProperty('Description', 'e')],
  ];

  it.each(CLASSES)('%s: opens, as a scalar and as an array, with no property rows for the null, and saves untouched byte for byte', (cls, nodeClass, props) => {
    const values = { nullScalar: scalar(cls), nullArray: array(cls, props) };
    const text = withEntries(values);
    const { source, entry, saved } = open(text);
    expect(rowsOf(entry('gadget'))).toEqual(rowsOf(open(control).entry('gadget')));
    expect([entry('nullScalar').constructor.name, entry('nullScalar').children.length]).toEqual([nodeClass, 0]);
    const element = entry('nullArray').children[1];
    expect([element.displayName, element.constructor.name, element.children.length]).toEqual(['nullArray(2)', nodeClass, 0]);
    expect(saved()).toBe(text);
    // A copy, as a host takes one, and a rename, which leaves a value as it was read.
    for (const [name, value] of Object.entries(values)) {
      expect(JSON.stringify(entry(name).serialize().value)).toBe(JSON.stringify(value));
    }
    for (const name of Object.keys(values)) {
      expect(entry(name).setProperty('Name', name + 'R')).toBe(true);
    }
    const renamed = content(JSON.parse(saved())).entries;
    for (const [name, value] of Object.entries(values)) {
      expect(JSON.stringify(renamed.find((e: any) => e.name === name + 'R').value)).toBe(JSON.stringify(value));
    }
    expect(source.flatten().length).toBe(open(text).source.flatten().length);
  });

  it.each(CLASSES)('%s: an array keeps its null element when the other element is edited', (cls, _, props, edit) => {
    // The same edit of the same array whose second element is an element with no properties.
    const empty = open(withEntries({ arr: array(cls, props, { _properties: {} }) }));
    expect(edit(empty.entry('arr').children[0])).toBe(true);
    const edited = empty.savedValue('arr')._elements[0];
    expect(edited).not.toEqual({ _properties: props });

    const { entry, savedValue } = open(withEntries({ arr: array(cls, props) }));
    expect(edit(entry('arr').children[0])).toBe(true);
    expect(savedValue('arr')._elements).toEqual([edited, null]);
    expect(entry('arr').serialize().value._elements).toEqual([edited, null]);
  });

  it.each(CLASSES.filter(([, nodeClass]) => nodeClass !== 'ObjectNode'))('%s: an edit of the null scalar itself writes what the same edit writes of an element holding no properties', (cls) => {
    // The null is kept while nothing changes the value, and no longer.
    const [nulls, empties] = [null, { _properties: {} }].map((element) => {
      const { entry, savedValue } = open(withEntries({ s: scalar(cls, element) }));
      expect(entry('s').setProperty('Description', 'x')).toBe(true);
      return [savedValue('s'), entry('s').serialize().value];
    });
    expect(nulls).toEqual(empties);
    expect(nulls[0]._elements).toEqual([{ _properties: { Description: 'x' } }]);
  });

  it.each(CLASSES)('%s: is written as XML as an element holding no properties, and pasted into a binary dictionary', (cls, _, props) => {
    const values = { nullScalar: scalar(cls), nullArray: array(cls, props) };
    const empties = { nullScalar: scalar(cls, { _properties: {} }), nullArray: array(cls, props, { _properties: {} }) };
    const nulls = open(withEntries(values));
    const control = open(withEntries(empties));
    for (const name of Object.keys(values)) {
      const xml = serializeEntryToXml(nulls.entry(name));
      expect(xml).toBe(serializeEntryToXml(control.entry(name)));
      const session = createSession();
      const binary: any = ingest(session, read('./parity/artifacts/binary/cases.sldd'), { filename: 'cases.sldd' });
      const design = binary.getSection('design');
      const pasted = design.parseEntry(JSON.parse(JSON.stringify(nulls.entry(name).serialize())));
      expect(JSON.stringify(pasted.serialize().value)).toBe(JSON.stringify((values as any)[name]));
      const chunk = strFromU8(unzipSync((session.serializeSource(binary.name) as { bytes: Uint8Array }).bytes)['data/chunk0.xml']);
      expect(chunk).toContain(xml);
    }
  });

  it('every typed class keeps a null scalar element through an untouched save and a copy, and writes it as XML as an element holding no properties', async () => {
    const { getRegisteredClasses } = await import('../src/datamodel/node/data/NodeClassMap.js');
    // The three registered names that are not an object's class: they are the Add gallery's.
    const classes = getRegisteredClasses().filter((c) => !['MatlabVariable', 'Constant', 'MatlabStruct'].includes(c));
    expect(classes.length).toBeGreaterThan(20);
    const values = Object.fromEntries(classes.map((c, i) => ['e' + i, scalar(c)]));
    const text = withEntries(values);
    const nulls = open(text);
    expect(nulls.saved()).toBe(text);
    const control = open(withEntries(Object.fromEntries(classes.map((c, i) => ['e' + i, scalar(c, { _properties: {} })]))));
    for (const [name, value] of Object.entries(values)) {
      expect([value._array_class, JSON.stringify(nulls.entry(name).serialize().value)]).toEqual([value._array_class, JSON.stringify(value)]);
      expect([value._array_class, serializeEntryToXml(nulls.entry(name))]).toEqual([value._array_class, serializeEntryToXml(control.entry(name))]);
    }
  });

  it('opens and saves one nested as an object\'s property, a Parameter\'s Value and a cell\'s element', () => {
    const nested = (element: unknown) => ({
      inObject: { _array_class: 'Widget', _dimensions: [1, 1], _elements: [{ _properties: { P: scalar('Gadget', element), x: 1 } }], _mw_element_type: 'MATLABArray' },
      inParameter: { _array_class: 'Simulink.Parameter', _dimensions: [1, 1], _elements: [{ _properties: { Value: scalar('Gadget', element) } }], _mw_element_type: 'MATLABArray' },
      inCell: { _array_type: 'Cell', _dimensions: [1, 2], _elements: [scalar('Gadget', element), 1], _mw_element_type: 'MATLABArray' },
    });
    const text = withEntries(nested(null));
    const nulls = open(text);
    const control = open(withEntries(nested({ _properties: {} })));
    expect(nulls.saved()).toBe(text);
    for (const name of Object.keys(nested(null))) {
      expect(rowsOf(nulls.entry(name))).toEqual(rowsOf(control.entry(name)));
      expect(JSON.stringify(nulls.entry(name).serialize().value)).toBe(JSON.stringify((nested(null) as any)[name]));
      expect(serializeEntryToXml(nulls.entry(name))).toBe(serializeEntryToXml(control.entry(name)));
    }
    // Beside an edit, the null stays: the object's other property.
    expect(nulls.entry('inObject').children.find((c: any) => c.name === 'x').setProperty('Value', '2')).toBe(true);
    expect(nulls.savedValue('inObject')._elements[0]._properties).toEqual({ P: scalar('Gadget'), x: 2 });
  });

  // A typed class writes the properties it writes for an element holding none, an AliasType its
  // BaseType, a ConfigSet its Name. As an entry, a cell entry's element or a struct entry's
  // field, the null is written by its node's own XML, which does that. Nested where a writer
  // writes it from the node's value, which is an object's property, a Parameter's Value, and an
  // edited struct there, it was written from the kept null, as an empty `<Element Class="…"/>`:
  // one value, two XML spellings, by where it sat. An unedited struct there is written from its
  // value as read, where the null and `{"_properties":{}}` are both an empty element.
  it('every typed class\'s null element, nested where it is written from its value, is written as XML as an element holding no properties is', async () => {
    const { getRegisteredClasses } = await import('../src/datamodel/node/data/NodeClassMap.js');
    const classes = getRegisteredClasses().filter((c) => !['MatlabVariable', 'Constant', 'MatlabStruct'].includes(c));
    const object = (cls: string, props: Record<string, unknown>) => ({ _array_class: cls, _dimensions: [1, 1], _elements: [{ _properties: props }], _mw_element_type: 'MATLABArray' });
    const struct = (fields: Record<string, unknown>) => ({ _array_type: 'Struct', _dimensions: [1, 1], _elements: [fields], _mw_element_type: 'MATLABArray' });
    // Each route, with the sibling `x` an edit changes where it has one.
    const ROUTES: Record<string, (v: unknown, x?: number) => unknown> = {
      inObject: (v, x = 1) => object('Widget', { P: v, x }),
      inParameter: (v) => object('Simulink.Parameter', { Value: v }),
      inObjectsObject: (v, x = 1) => object('Widget', { P: object('Gadget', { Q: v, x }) }),
      inObjectArray: (v, x = 1) => ({ _array_class: 'Widget', _dimensions: [1, 2], _elements: [{ _properties: { P: v, x } }, { _properties: { x: 1 } }], _mw_element_type: 'MATLABArray' }),
      inParameterStruct: (v, x = 1) => object('Simulink.Parameter', { Value: struct({ s: v, x }) }),
      inObjectStruct: (v, x = 1) => object('Widget', { P: struct({ s: v, x }) }),
    };
    const SHAPES: Record<string, (cls: string, element: unknown) => unknown> = {
      scalar: (cls, element) => scalar(cls, element),
      array: (cls, element) => ({ _array_class: cls, _dimensions: [1, 2], _elements: [element, element], _mw_element_type: 'MATLABArray' }),
    };
    const cases = Object.keys(ROUTES).flatMap((route) => Object.keys(SHAPES).flatMap((shape) => classes.map((cls, i) => ({ name: `${route}_${shape}_${i}`, route, shape, cls }))));
    const valueOf = (c: (typeof cases)[number], element: unknown, x?: number) => ROUTES[c.route](SHAPES[c.shape](c.cls, element), x);
    const valuesOf = (element: unknown) => Object.fromEntries(cases.map((c) => [c.name, valueOf(c, element)]));
    const text = withEntries(valuesOf(null));
    const nulls = open(text);
    const control = open(withEntries(valuesOf({ _properties: {} })));
    expect(nulls.saved()).toBe(text);
    // The deepest row named `x`: the sibling an edit changes.
    const xOf = (node: any): any => node.children.map(xOf).find(Boolean) ?? (node.name === 'x' && node.children.length === 0 ? node : undefined);
    // An edit stamps the entry's LastMod to the second, so the two are compared without it.
    const unstamped = (xml: string) => xml.replace(/<P Name="LastMod" Class="char">[^<]*<\/P>/, '');
    const paste = (from: ReturnType<typeof open>) => {
      const session = createSession();
      const binary: any = ingest(session, read('./parity/artifacts/binary/cases.sldd'), { filename: 'cases.sldd' });
      const design = binary.getSection('design');
      const pasted: Record<string, any> = Object.fromEntries(cases.map((c) => [c.name, design.parseEntry(JSON.parse(JSON.stringify(from.entry(c.name).serialize())))]));
      const chunk = () => strFromU8(unzipSync((session.serializeSource(binary.name) as { bytes: Uint8Array }).bytes)['data/chunk0.xml']);
      return { pasted, chunk };
    };
    const [nullsPasted, controlPasted] = [paste(nulls), paste(control)];
    for (const c of cases) {
      const label = [c.name, c.cls];
      expect([...label, JSON.stringify(nulls.entry(c.name).serialize().value)]).toEqual([...label, JSON.stringify(valueOf(c, null))]);
      expect([...label, serializeEntryToXml(nulls.entry(c.name))]).toEqual([...label, serializeEntryToXml(control.entry(c.name))]);
      expect([...label, serializeEntryToXml(nullsPasted.pasted[c.name])]).toEqual([...label, serializeEntryToXml(controlPasted.pasted[c.name])]);
    }
    // With the sibling edited: in the binary dictionary, and in the text one, whose save keeps
    // the null.
    for (const c of cases.filter((c) => c.route !== 'inParameter')) {
      const label = [c.name, c.cls];
      for (const from of [nullsPasted, controlPasted]) {
        expect([...label, xOf(from.pasted[c.name]).setProperty('Value', '2')]).toEqual([...label, true]);
      }
      expect([...label, unstamped(serializeEntryToXml(nullsPasted.pasted[c.name]))]).toEqual([...label, unstamped(serializeEntryToXml(controlPasted.pasted[c.name]))]);
      expect([...label, xOf(nulls.entry(c.name)).setProperty('Value', '2')]).toEqual([...label, true]);
    }
    const saved = content(JSON.parse(nulls.saved())).entries;
    const chunk = nullsPasted.chunk();
    for (const c of cases) {
      const label = [c.name, c.cls];
      const x = c.route === 'inParameter' ? undefined : 2;
      expect([...label, JSON.stringify(saved.find((e: any) => e.name === c.name).value)]).toEqual([...label, JSON.stringify(valueOf(c, null, x))]);
      expect([...label, chunk.includes(serializeEntryToXml(nullsPasted.pasted[c.name]))]).toEqual([...label, true]);
    }
  });
});

// The text twin of the saveobj case above. A text dictionary spells the envelope of an object
// whose class saves through saveobj as `_custom_save`, beside the element's `_properties` and
// not in it, and MATLAB writes no `_properties` there at all (XmlUtils' CUSTOM_SAVE_KEY). Of a
// class with no typed node, ObjectNode looked for the envelope only in the bag, as a binary
// dictionary files it, so written as XML, as a host writes an entry pasted into a binary
// dictionary, the object went out as an empty `<Element Class="…"></Element>`, its whole state
// gone. So did the same object as an object's property, a Parameter's Value or a cell's element
// there, which the raw object writer (DataNode._objectXml) writes from the element. The text
// dictionary's own save and a copy keep `_custom_save` as read.
describe('of a class that serializes through saveobj and has no typed node, read from a text dictionary', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
  const CLASS = 'my.SaveobjCls';
  const content = (json: any) => json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content;
  const ENVELOPE_TAG = '<P Source="saveobj" PropertyType="any" Class="struct">';
  // parity/artifacts/binary/cases.sldd's aVariant, relabelled as in the binary case above: its
  // envelope as the binary reader holds it, and its <P Name="Value"> as the file holds it.
  const files = unzipSync(new Uint8Array(read('./parity/artifacts/binary/cases.sldd')));
  const chunk = strFromU8(files['data/chunk0.xml']).replace('<Element Class="Simulink.VariantVariable">', `<Element Class="${CLASS}">`);
  const relabelled = zipSync({ ...files, 'data/chunk0.xml': strToU8(chunk) });
  const valueOf = (xml: string, name: string): string => {
    const start = xml.indexOf('<P Name="Value">', xml.indexOf(`<P Name="Name" Class="char">${name}</P>`));
    return xml.slice(start, xml.indexOf('\n        </P>', start) + '\n        </P>'.length);
  };
  const written = valueOf(chunk, 'aVariant');
  const binaryEntry: any = ingest(createSession(), relabelled, { filename: 'cases.sldd' }).flatten().find((n: any) => n.name === 'aVariant');
  const envelope = binaryEntry.serial._rawVal._elements[0]._properties._saveobj;
  // The object in a text dictionary's spelling, and in the binary reader's.
  const textSpelling = (cls = CLASS) => ({ _array_class: cls, _dimensions: [1, 1], _elements: [{ _custom_save: envelope, _id: '1' }], _mw_element_type: 'MATLABArray' });
  const binarySpelling = (cls = CLASS) => ({ _array_class: cls, _dimensions: [1, 1], _elements: [{ _properties: { _saveobj: envelope } }], _mw_element_type: 'MATLABArray' });
  const ROUTES: Record<string, (o: unknown) => unknown> = {
    saver: (o) => o,
    inObject: (o) => valueObject('Widget', [{ P: o, x: 1 }]),
    inParameter: (o) => ({ _array_class: 'Simulink.Parameter', _dimensions: [1, 1], _elements: [{ _properties: { Value: o } }], _mw_element_type: 'MATLABArray' }),
    inParameterCell: (o) => ({ _array_class: 'Simulink.Parameter', _dimensions: [1, 1], _elements: [{ _properties: { Value: { _array_type: 'Cell', _dimensions: [1, 2], _elements: [o, 1] } } }], _mw_element_type: 'MATLABArray' }),
    inCell: (o) => ({ _array_type: 'Cell', _dimensions: [1, 2], _elements: [o, 1], _mw_element_type: 'MATLABArray' }),
    inStruct: (o) => ({ _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ s: o, x: 1 }], _mw_element_type: 'MATLABArray' }),
  };
  const textWith = (spelling: () => unknown): string => {
    const json = JSON.parse(read('./fixtures/rt_text.sldd').toString('utf8'));
    const entries = content(json).entries;
    Object.entries(ROUTES).forEach(([name, route], i) => {
      entries.push({ name, metadata: { ...entries[0].metadata, uuid: `a43e9523-8ba6-426a-b689-6e7d8593${1000 + i}` }, value: route(spelling()) });
    });
    return JSON.stringify(json, null, '\t');
  };
  const text = textWith(() => textSpelling());

  it('saves the text dictionary untouched as read, and a copy keeps `_custom_save`', () => {
    const session = createSession();
    const source: any = ingest(session, text, { filename: 'gadget.sldd' });
    expect((session.serializeSource(source.name) as { text: string }).text).toBe(text);
    for (const name of Object.keys(ROUTES)) {
      const copy = JSON.stringify(source.flatten().find((n: any) => n.name === name).serialize().value);
      expect([name, copy.split('"_custom_save":').length - 1, copy.includes('"_saveobj"')]).toEqual([name, 1, false]);
    }
  });

  it('writes the envelope into the XML of each, as the binary spelling of the same object is written', () => {
    const source: any = ingest(createSession(), text, { filename: 'gadget.sldd' });
    const twin: any = ingest(createSession(), textWith(() => binarySpelling()), { filename: 'gadget.sldd' });
    for (const name of Object.keys(ROUTES)) {
      const xml = serializeEntryToXml(source.flatten().find((n: any) => n.name === name));
      expect([name, xml.split(ENVELOPE_TAG).length - 1]).toEqual([name, 1]);
      expect([name, xml]).toEqual([name, serializeEntryToXml(twin.flatten().find((n: any) => n.name === name))]);
    }
  });

  it('pasted into a binary dictionary, writes the envelope as that dictionary holds it, untouched and renamed, and saves it', () => {
    const source: any = ingest(createSession(), text, { filename: 'gadget.sldd' });
    const payload = JSON.parse(JSON.stringify(source.flatten().find((n: any) => n.name === 'saver').serialize()));
    const session = createSession();
    const binary: any = ingest(session, relabelled, { filename: 'cases.sldd' });
    const design = binary.getSection('design');
    const pasted = design.parseEntry({ ...payload, name: 'saverPasted', metadata: { ...design.children[0].metadata, uuid: 'b43e9523-8ba6-426a-b689-6e7d85901372' } });
    expect(valueOf(serializeEntryToXml(pasted), 'saverPasted')).toBe(written);
    const saved = strFromU8(unzipSync((session.serializeSource(binary.name) as { bytes: Uint8Array }).bytes)['data/chunk0.xml']);
    expect(valueOf(saved, 'saverPasted')).toBe(written);
    expect(pasted.setProperty('Name', 'saverRenamed')).toBe(true);
    expect(valueOf(serializeEntryToXml(pasted), 'saverRenamed')).toBe(written);
  });

  it('so does a typed class that saves through saveobj, wherever it is written from its value, whose node writes the text spelling', () => {
    // Simulink.VariantVariable's own node holds the envelope in its bag, and writes its value
    // in the text spelling whatever the dictionary (DataNode._serializeSimulinkObject), so as an
    // object's property, a Parameter's Value, or a cell or a struct there, it reached the raw
    // object writer as `_custom_save` too.
    const routes: Record<string, (o: unknown) => unknown> = {
      ...ROUTES,
      inParameterStruct: (o) => ({ _array_class: 'Simulink.Parameter', _dimensions: [1, 1], _elements: [{ _properties: { Value: { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ s: o, x: 1 }] } } }], _mw_element_type: 'MATLABArray' }),
    };
    const json = JSON.parse(read('./fixtures/rt_text.sldd').toString('utf8'));
    const entries = content(json).entries;
    Object.entries(routes).forEach(([name, route], i) => {
      entries.push({ name, metadata: { ...entries[0].metadata, uuid: `a43e9523-8ba6-426a-b689-6e7d8594${1000 + i}` }, value: route(textSpelling('Simulink.VariantVariable')) });
    });
    const source: any = ingest(createSession(), JSON.stringify(json, null, '\t'), { filename: 'gadget.sldd' });
    for (const name of Object.keys(routes)) {
      const xml = serializeEntryToXml(source.flatten().find((n: any) => n.name === name));
      expect([name, xml.split(ENVELOPE_TAG).length - 1]).toEqual([name, 1]);
      expect([name, xml.includes('<Element Class="Simulink.VariantVariable">')]).toEqual([name, true]);
    }
  });
});
