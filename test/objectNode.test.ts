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
    });

    it('writes the envelope into the entry a host splices in, untouched and renamed', () => {
      const source: any = ingest(createSession(), bytes, { filename: 'cases.sldd' });
      const entry = source.flatten().find((n: any) => n.name === 'aVariant');
      expect(valueOf(serializeEntryToXml(entry))).toBe(written);
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
