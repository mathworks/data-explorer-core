// Copyright 2026 The MathWorks, Inc.
//
// DataNode.serializePropertyXml and its helpers: the property-value writer every
// object entry funnels through on the way into a binary .sldd. It is a type
// dispatch over the raw JSON shapes the parsers produce (number, bool, string,
// array, the {_type,_value} typed literal, nested objects, structs, cells), and
// each branch has to emit something MATLAB will read back as the same value it
// read out. A slip here corrupts a saved file rather than a rendered pixel, and
// nothing upstream re-validates the XML, so these are the assertions that stand
// between a typo and a broken .sldd.
//
// Adjacent behaviour tested elsewhere: DataNode.setProperty name validation and
// the Min/Max constraint live in minMaxConstraint.test.ts; the metadata/Last
// Modified columns in metadataColumns.test.ts; and full entry round-trips in
// binarySlddRoundTrip.test.ts.
import { describe, it, expect } from 'vitest';
import DataNode from '../src/datamodel/node/DataNode.js';
import SlddNode from '../src/datamodel/node/container/SlddNode.js';
import '../src/datamodel/node/NodeClassMap.js';

const prop = (name: string, value: unknown, indent = 0) => DataNode.serializePropertyXml(name, value, indent, null);

describe('DataNode.serializePropertyXml — primitives', () => {
  it('writes an integral number as a double, so MATLAB does not read an integer', () => {
    expect(prop('Gain', 2)).toBe('<P Name="Gain" Class="double">2.0</P>');
    expect(prop('Gain', 1.5)).toBe('<P Name="Gain" Class="double">1.5</P>');
  });

  it('writes a boolean as logical 1/0', () => {
    expect(prop('Flag', true)).toBe('<P Name="Flag" Class="logical">1</P>');
    expect(prop('Flag', false)).toBe('<P Name="Flag" Class="logical">0</P>');
  });

  it('writes a string as char, escaping the XML metacharacters', () => {
    expect(prop('Unit', 'm/s')).toBe('<P Name="Unit" Class="char">m/s</P>');
    expect(prop('Desc', 'a < b & "c"')).toBe('<P Name="Desc" Class="char">a &lt; b &amp; &quot;c&quot;</P>');
  });

  it('collapses an empty, null, or undefined value to a self-closing char tag', () => {
    // MATLAB reads an empty <P Class="char"/> back as '', which is what all
    // three of these mean; emitting <P>...</P> with no text would be equivalent
    // but noisier, and emitting the literal text 'null' would be wrong.
    const expected = '<P Name="Unit" Class="char"/>';
    expect(prop('Unit', '')).toBe(expected);
    expect(prop('Unit', null)).toBe(expected);
    expect(prop('Unit', undefined)).toBe(expected);
  });

  it('escapes the property name as well as the value', () => {
    expect(prop('a&b', 1)).toBe('<P Name="a&amp;b" Class="double">1.0</P>');
  });

  it('indents by four spaces per level', () => {
    expect(prop('Gain', 1, 2)).toBe('        <P Name="Gain" Class="double">1.0</P>');
  });

  it('falls back to char for a value of no recognised shape', () => {
    expect(prop('Odd', { nothing: 'matches' })).toBe('<P Name="Odd" Class="char">[object Object]</P>');
  });
});

describe('DataNode.serializePropertyXml — plain arrays', () => {
  it('writes a JS array as a 1xN double row vector', () => {
    expect(prop('Dims', [1, 2, 3])).toBe('<P Name="Dims" Class="double" Dimension="1*3">1.0 2.0 3.0</P>');
  });

  it('writes an empty array as a self-closing 0*0 tag', () => {
    expect(prop('Dims', [])).toBe('<P Name="Dims" Class="double" Dimension="0*0"/>');
  });
});

describe('DataNode.serializePropertyXml — typed {_type,_value} literals', () => {
  it('writes a typed scalar in its own class, dropping the F/U literal suffix', () => {
    expect(prop('N', { _type: 'int32', _value: '5' })).toBe('<P Name="N" Class="int32">5</P>');
    expect(prop('N', { _type: 'single', _value: '1.5F' })).toBe('<P Name="N" Class="single">1.5</P>');
    expect(prop('N', { _type: 'uint8', _value: '200U' })).toBe('<P Name="N" Class="uint8">200</P>');
  });

  it('writes a typed vector with its dimension', () => {
    expect(prop('V', { _type: 'int32', _value: '[1, 2, 3]' })).toBe(
      '<P Name="V" Class="int32" Dimension="1*3">1 2 3</P>',
    );
  });

  it('writes a typed matrix in MATLAB column-major order', () => {
    // [1 2; 3 4] is stored by MATLAB as 1 3 2 4.
    expect(prop('M', { _type: 'double', _value: 'Matrix(2,2)\n[1, 2];[3, 4]' })).toBe(
      '<P Name="M" Class="double" Dimension="2*2">1.0 3.0 2.0 4.0</P>',
    );
  });

  it('reads a matrix whose rows are newline-separated, not semicolon-separated', () => {
    // The four writers that emit a Matrix(r,c) literal do not agree on the row
    // separator: BinarySlddParser joins rows with '; ', while
    // MatlabVariableNode._buildMatrixString, McosParser, and ParameterNode all
    // join with '\n'. A reader that splits on only ';' merges the newline form
    // into a single row, and the trailing ']' / leading '[' of the joint are
    // then eaten as one element — so 2x2 [1 2; 3 4] came out as 1 2 4, one
    // element short and misaligned from the second row onward.
    expect(prop('M', { _type: 'double', _value: 'Matrix(2,2)\n[1, 2]\n[3, 4]' })).toBe(
      '<P Name="M" Class="double" Dimension="2*2">1.0 3.0 2.0 4.0</P>',
    );
    expect(prop('M', { _type: 'int32', _value: 'Matrix(3,2)\n[1, 2]\n[3, 4]\n[5, 6]' })).toBe(
      '<P Name="M" Class="int32" Dimension="3*2">1 3 5 2 4 6</P>',
    );
  });

  it('reads a column vector, which is written as one bracketed list', () => {
    // formatMatrix special-cases cols === 1 into 'Matrix(3,1)\n[1, 2, 3]'.
    expect(prop('M', { _type: 'double', _value: 'Matrix(3,1)\n[1, 2, 3]' })).toBe(
      '<P Name="M" Class="double" Dimension="3*1">1.0 2.0 3.0</P>',
    );
  });

  it('writes a cdata value as a complex double', () => {
    expect(prop('C', { _type: 'cdata', _value: '1+2i' })).toBe(
      '<P Name="C" Class="double" IsComplex="1">1.0+2.0i</P>',
    );
  });

  it('keeps a non-finite typed value instead of turning it into NaN', () => {
    // parseFloat('Inf') is NaN, so the obvious reader silently rewrites Inf as
    // NaN — a different number, not a formatting difference.
    expect(prop('N', { _type: 'double', _value: 'Inf' })).toBe('<P Name="N" Class="double">Inf</P>');
    expect(prop('N', { _type: 'double', _value: '-Inf' })).toBe('<P Name="N" Class="double">-Inf</P>');
    expect(prop('V', { _type: 'double', _value: '[1, Inf, NaN]' })).toBe(
      '<P Name="V" Class="double" Dimension="1*3">1.0 Inf NaN</P>',
    );
    expect(prop('M', { _type: 'double', _value: 'Matrix(1,2)\n[Inf, 2]' })).toBe(
      '<P Name="M" Class="double" Dimension="1*2">Inf 2.0</P>',
    );
  });
});

describe('DataNode.serializePropertyXml — nested objects', () => {
  it('nests an object-valued property as an Element with its own properties', () => {
    const value = {
      _array_class: 'Simulink.NumericType',
      _dimensions: [1, 1],
      _elements: [{ _properties: { DataTypeMode: 'Double', Signedness: true } }],
    };
    expect(prop('Type', value)).toBe(
      '<P Name="Type">\n' +
        '    <Element Class="Simulink.NumericType">\n' +
        '        <P Name="DataTypeMode" Class="char">Double</P>\n' +
        '        <P Name="Signedness" Class="logical">1</P>\n' +
        '    </Element>\n' +
        '</P>',
    );
  });

  it('writes a property-less object as an empty Element, not an empty P', () => {
    // The Element carries the class name, which is the only information a
    // default-constructed object conveys — dropping it would lose the type.
    const bare = { _array_class: 'Simulink.CoderInfo', _dimensions: [1, 1], _elements: [] };
    expect(prop('CoderInfo', bare)).toBe(
      '<P Name="CoderInfo">\n    <Element Class="Simulink.CoderInfo"/>\n</P>',
    );
    const emptyProps = {
      _array_class: 'Simulink.CoderInfo',
      _dimensions: [1, 1],
      _elements: [{ _properties: {} }],
    };
    expect(prop('CoderInfo', emptyProps)).toBe(
      '<P Name="CoderInfo">\n    <Element Class="Simulink.CoderInfo"/>\n</P>',
    );
  });

  it('carries a Dimension attribute for an object array but not for a lone 1x1', () => {
    const twoUp = {
      _array_class: 'Simulink.BusElement',
      _dimensions: [1, 2],
      _elements: [{ _properties: { Name: 'a' } }, { _properties: { Name: 'b' } }],
    };
    const xml = prop('Elements', twoUp);
    expect(xml).toContain('<P Name="Elements" Dimension="1*2">');
    expect(xml.match(/<Element Class="Simulink.BusElement">/g)!.length).toBe(2);
    expect(prop('E', { ...twoUp, _dimensions: [1, 1], _elements: [twoUp._elements[0]] })).toContain('<P Name="E">');
  });

  it('wraps the singular _object_class form into the same Element shape', () => {
    // Some parse paths produce _object_class (one object) rather than
    // _array_class (an array of them); both must emit identical XML.
    const xml = prop('Info', { _object_class: 'Simulink.CoderInfo', _properties: { StorageClass: 'Auto' } });
    expect(xml).toBe(
      '<P Name="Info">\n' +
        '    <Element Class="Simulink.CoderInfo">\n' +
        '        <P Name="StorageClass" Class="char">Auto</P>\n' +
        '    </Element>\n' +
        '</P>',
    );
  });

  it('recurses, so an object inside an object keeps nesting and indenting', () => {
    const nested = {
      _array_class: 'Simulink.Parameter',
      _dimensions: [1, 1],
      _elements: [
        {
          _properties: {
            CoderInfo: { _object_class: 'Simulink.CoderInfo', _properties: { StorageClass: 'Auto' } },
          },
        },
      ],
    };
    expect(prop('P', nested)).toContain('                <P Name="StorageClass" Class="char">Auto</P>');
  });
});

describe('DataNode.serializePropertyXml — structs and cells', () => {
  it('writes a struct as an Element per element with a P per field', () => {
    const value = { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ a: 1, b: 'two' }] };
    expect(prop('S', value)).toBe(
      '<P Name="S" Class="struct">\n' +
        '    <Element>\n' +
        '        <P Name="a" Class="double">1.0</P>\n' +
        '        <P Name="b" Class="char">two</P>\n' +
        '    </Element>\n' +
        '</P>',
    );
  });

  it('carries a Dimension on a struct array but not on a 1x1 struct', () => {
    const value = { _array_type: 'Struct', _dimensions: [1, 2], _elements: [{ a: 1 }, { a: 2 }] };
    expect(prop('S', value)).toContain('<P Name="S" Class="struct" Dimension="1*2">');
  });

  it('writes each cell element in its own class', () => {
    const value = { _array_type: 'Cell', _dimensions: [1, 4], _elements: [1, true, 'txt', [1, 2]] };
    expect(prop('C', value)).toBe(
      '<P Name="C" Class="cell" Dimension="1*4">\n' +
        '    <Element Class="double">1.0</Element>\n' +
        '    <Element Class="logical">1</Element>\n' +
        '    <Element Class="char">txt</Element>\n' +
        '    <Element Class="double" Dimension="1*2">1.0 2.0</Element>\n' +
        '</P>',
    );
  });

  it('writes an empty array cell element as a self-closing 0*0 Element', () => {
    const value = { _array_type: 'Cell', _dimensions: [1, 1], _elements: [[]] };
    expect(prop('C', value)).toContain('<Element Class="double" Dimension="0*0"/>');
  });

  it('writes a typed cell element, non-finite values included', () => {
    const value = {
      _array_type: 'Cell',
      _dimensions: [1, 3],
      _elements: [{ _type: 'int32', _value: '5' }, { _type: 'int32', _value: '[1, 2]' }, { _type: 'double', _value: 'Inf' }],
    };
    const xml = prop('C', value);
    expect(xml).toContain('<Element Class="int32">5</Element>');
    expect(xml).toContain('<Element Class="int32" Dimension="1*2">1 2</Element>');
    expect(xml).toContain('<Element Class="double">Inf</Element>');
  });

  it('falls back to char for a cell element of no recognised shape', () => {
    const value = { _array_type: 'Cell', _dimensions: [1, 1], _elements: [{ unknown: true }] };
    expect(prop('C', value)).toContain('<Element Class="char">[object Object]</Element>');
  });
});

describe('DataNode.serializeXml — the object-entry entry point', () => {
  const objectNode = () => {
    const n = new DataNode('p', null, {
      _rawVal: { _array_class: 'Simulink.Parameter', _dimensions: [1, 1], _elements: [{}] },
      _properties: { Value: 5, Unit: 'm' },
    });
    return n;
  };

  it('wraps the node properties in a class-named Element', () => {
    expect(objectNode().serializeXml('entry', {}, 0)).toBe(
      '<entry>\n' +
        '    <Element Class="Simulink.Parameter">\n' +
        '        <P Name="Value" Class="double">5.0</P>\n' +
        '        <P Name="Unit" Class="char">m</P>\n' +
        '    </Element>\n' +
        '</entry>',
    );
  });

  it('carries an escaped Name attribute when one is supplied', () => {
    expect(objectNode().serializeXml('entry', { Name: 'a&b' }, 0)).toContain('<entry Name="a&amp;b">');
  });

  it('emits a bare self-closing tag for a node with no object payload', () => {
    // The base class has no value of its own; a node that reaches here without an
    // _array_class has nothing to write.
    expect(new DataNode('x', null, {}).serializeXml('P', {}, 1)).toBe('    <P/>');
  });
});

describe('DataNode — base serialization contract', () => {
  it('has no value of its own, so subclasses must supply one', () => {
    expect(new DataNode('x', null).serializeValue()).toBeNull();
  });

  it('wraps an entry with its name and metadata, but a nested node with neither', () => {
    // Only a section child is an entry; nested children serialize as bare values
    // because their name is already their key in the parent.
    const container = new DataNode('sec', null);
    (container as unknown as { isContainer: boolean }).isContainer = true;
    const entry = new DataNode('e', container);
    entry.metadata = { lastmod: '20260101T000000' };
    expect(entry.serialize()).toEqual({ name: 'e', metadata: { lastmod: '20260101T000000' }, value: null });
    expect(new DataNode('nested', new DataNode('parent', null)).serialize()).toBeNull();
  });

  it('merges overrides over the stored properties when re-emitting an object', () => {
    const n = new DataNode('p', null, {
      _rawVal: { _array_class: 'Simulink.Parameter', _elements: [{ _properties: { Value: 1 }, other: 'kept' }] },
      _properties: { Value: 1, Unit: 'm' },
    });
    const out = n._serializeSimulinkObject({ Value: 9 }) as Record<string, unknown>;
    const element = (out._elements as Record<string, unknown>[])[0];
    expect(element._properties).toEqual({ Value: 9, Unit: 'm' });
    // Everything else on the raw element survives untouched, so an unmodified
    // property cannot be lost by an edit to a different one.
    expect(element.other).toBe('kept');
    expect(out._array_class).toBe('Simulink.Parameter');
  });
});

describe('DataNode.setProperty — name validation', () => {
  it('rejects a name longer than 63 characters, the MATLAB maximum', () => {
    // MATLAB identifiers cap at 63 chars; allowing 64 would create a .sldd that
    // MATLAB cannot load.
    const n = new DataNode('Kp', null);
    const long = 'a'.repeat(64);
    const r = n.setProperty('name', long) as { error: boolean; reason: string; validValue: string };
    expect(r.error).toBe(true);
    expect(r.reason).toContain('63');
    expect(r.validValue).toBe('Kp');
    expect(n.name).toBe('Kp');
  });

  it('rejects a MATLAB keyword, since MATLAB would refuse to read it back', () => {
    const n = new DataNode('Kp', null);
    const r = n.setProperty('name', 'break') as { error: boolean; reason: string };
    expect(r.error).toBe(true);
    expect(r.reason).toContain('reserved');
    expect(r.reason).toContain('break');
    expect(n.name).toBe('Kp');
  });

  it('renames the entry in the parent _fields array on success', () => {
    // Struct fields carry a parallel _fields array in the parent serial; a rename
    // that forgets to update it would serialize the struct with the old field name,
    // corrupting the saved value.
    const parent = new DataNode('parent', null) as DataNode & { isContainer: boolean };
    parent.isContainer = true;
    parent.serial = { _fields: ['Kp', 'Ki'] } as any;
    const child = new DataNode('Kp', parent);
    parent.addChild(child);
    parent.addChild(new DataNode('Ki', parent));
    expect(child.setProperty('name', 'Kd')).toBe(true);
    expect(child.name).toBe('Kd');
    expect(parent.serial._fields).toEqual(['Kd', 'Ki']);
  });

  it('assigns a numeric field from a numeric string', () => {
    // A numeric property round-trips through Number(), so the stored value must
    // be the number 10 (not the string '10') or the next serialize would change type.
    const n = new DataNode('n', null) as DataNode & { myNum: number };
    n.myNum = 5;
    expect(n.setProperty('myNum', '10')).toBe(true);
    expect(n.myNum).toBe(10);
    expect(typeof n.myNum).toBe('number');
  });

  it('rejects a non-numeric string for a numeric field', () => {
    const n = new DataNode('n', null) as DataNode & { myNum: number };
    n.myNum = 5;
    const r = n.setProperty('myNum', 'abc') as { error: boolean; reason: string; validValue: string };
    expect(r.error).toBe(true);
    expect(r.reason).toContain('numeric');
    expect(r.validValue).toBe('5');
    expect(n.myNum).toBe(5);
  });

  it('assigns a boolean field from a string, coercing to strict equality', () => {
    // Only the literal 'true' must yield true; anything else (including 'True',
    // '1', 'yes') must yield false, because the serializer writes a JS boolean.
    const n = new DataNode('b', null) as DataNode & { flag: boolean };
    n.flag = true;
    expect(n.setProperty('flag', 'false')).toBe(true);
    expect(n.flag).toBe(false);
    expect(n.setProperty('flag', 'true')).toBe(true);
    expect(n.flag).toBe(true);
  });
});

describe('DataNode.nameEditable', () => {
  it('locks the name when a _displayName alias is set (struct-array elements)', () => {
    // A struct-array element's displayed name is a positional alias like 'S(2)';
    // renaming it would make the name diverge from the element index.
    const n = new DataNode('x', null);
    n._displayName = 'S(2)';
    expect(n.nameEditable).toBe(false);
  });

  it('locks the name when the parent is an object property bag', () => {
    // A class object's property names are fixed by the class definition; renaming
    // 'Gain' to 'Foo' would lose the property binding.
    class ObjBag extends DataNode {
      get isObjectPropertyBag(): boolean {
        return true;
      }
    }
    const bag = new ObjBag('obj', null);
    const child = new DataNode('Gain', bag);
    bag.addChild(child);
    expect(child.nameEditable).toBe(false);
  });
});

describe('DataNode.kind — classification and derived fallbacks', () => {
  it('prefers the classification token over the class', () => {
    // The systemcomposer catalog classifies some entries with a token that drives
    // Kind; without it, a Simulink.Bus would show 'Bus' rather than 'Struct Type'.
    const n = new DataNode('x', null, { _rawVal: { _array_class: 'Simulink.Bus' }, _properties: {} });
    n.classification = 'StructType';
    expect(n.kind).toBe('Struct Type');
  });

  it('falls back to DERIVED_KIND_BY_CLASS for a derived unclassified entry', () => {
    // A freshly pasted Bus in the Architectural Data section is derived but the
    // catalog has not classified it yet. It must show 'Data Interface', not 'Bus',
    // so the user sees the same label an already-classified entry would show.
    const sldd = new SlddNode('d.sldd');
    const arch = sldd.getSection('arch')!;
    const busValue = { _array_class: 'Simulink.Bus', _dimensions: [1, 1], _elements: [{ _properties: {} }] };
    const node = arch.parseEntry(
      { name: 'MyBus', value: busValue, metadata: { namespace: 'designdata', isderived: '1' } },
      null,
    )!;
    expect(node.isDerived).toBe(true);
    expect(node.classification).toBeUndefined();
    expect(node.kind).toBe('Data Interface');
  });

  it('falls back to KIND_BY_CLASS for a non-derived, unclassified entry', () => {
    const sldd = new SlddNode('d.sldd');
    const design = sldd.getSection('design')!;
    const busValue = { _array_class: 'Simulink.Bus', _dimensions: [1, 1], _elements: [{ _properties: {} }] };
    const node = design.parseEntry(
      { name: 'MyBus', value: busValue, metadata: { namespace: 'designdata', isderived: '0' } },
      null,
    )!;
    expect(node.kind).toBe('Bus');
  });
});

describe('DataNode.execAddChild / execRemoveChild — base no-ops', () => {
  it('execAddChild returns null: the base class has no add logic', () => {
    // Subclasses (BusNode, etc.) override this to create a child element; the base
    // must return null so a caller that checks the result knows nothing happened.
    expect(new DataNode('x', null).execAddChild()).toBeNull();
  });

  it('execRemoveChild returns null: the base class has no remove logic', () => {
    expect(new DataNode('x', null).execRemoveChild()).toBeNull();
  });
});

describe('DataNode._parseMatrixNums', () => {
  it('skips empty rows from doubled separators instead of injecting NaN', () => {
    // An empty row in the input (e.g. from a trailing ';' or doubled newlines) must
    // be skipped, not parsed as 0/NaN — any phantom element would shift every column
    // after it.
    const nums = DataNode._parseMatrixNums('[1, 2];;[3, 4]');
    expect(nums).toEqual([1, 2, 3, 4]);
  });
});
