// Copyright 2026 The MathWorks, Inc.
//
// Value decoding in the compressed-binary (.sldd zip) reader, driven by synthesized
// data/chunk0.xml rather than a MATLAB-authored fixture.
//
// The parity artifacts only exercise the shapes MATLAB happened to write when they
// were captured: 2-D doubles, scalar structs, cells of char, a handful of Simulink
// objects. But this reader decodes a `Class`/`Dimension`/`IsComplex` attribute
// triple that MATLAB emits for EVERY MATLAB type, and the same value then has to
// survive re-serialization: an entry the user never touches is rebuilt from the
// parsed model by BinarySlddSerializer on any save that rewrites the whole chunk.
// So a value this reader mis-decodes is not just displayed wrong, it is WRITTEN
// wrong — the parse and the save must round-trip.
//
// Two real defects were found here and are pinned below, both marked REGRESSION,
// and both silent data loss on save.
import { describe, it, expect } from 'vitest';
import { zipSync } from 'fflate';
import { parseBinarySldd, parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import DataNode from '../src/datamodel/node/DataNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const DECL = '<?xml version="1.0" encoding="UTF-8"?>';

/** A whole data/chunk0.xml holding the given <Object> bodies. */
function chunk(...objects: string[]): string {
  return `${DECL}\n<DataSource FormatVersion="1" MinRelease="R2014a">\n${objects.join('\n')}\n</DataSource>`;
}

/** One DD.ENTRY named `name`, carrying the given raw property XML. */
function entryObject(name: string, propsXml: string): string {
  return (
    `    <Object Class="DD.ENTRY">\n` +
    `        <P Name="Name" Class="char">${name}</P>\n` +
    propsXml +
    `\n    </Object>`
  );
}

/** The parsed content block of a chunk (entries + dictionary bookkeeping). */
function content(xml: string, meta: Record<string, Uint8Array> = {}): Record<string, any> {
  const parsed = parseBinarySlddParts(xml, meta) as Record<string, any>;
  return parsed.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content;
}

/** The decoded value of a single entry whose <P Name="Value"> is `valueXml`. */
function value(valueXml: string): unknown {
  return content(chunk(entryObject('e', `        ${valueXml}`))).entries[0].value;
}

/**
 * What the save path writes for a decoded value. This is the other half of every
 * fidelity claim below: the reader's output is only correct if DataNode can turn
 * it back into the property it came from.
 */
function saved(decoded: unknown): string {
  return DataNode.serializePropertyXml('X', decoded, 0, null);
}

describe('parseBinarySlddParts — Dimension attributes that are not R*C', () => {
  it('REGRESSION: keeps every element of a 3-D array, and its rank', () => {
    // A 3-D numeric is ordinary in a dictionary — a lookup table's breakpoint set
    // or a 3-D gain schedule. MATLAB writes Dimension="2*2*2" with the 8 elements
    // column-major. Each of the thirteen places that read this attribute did its
    // own `split('*')` and took [0] and [1], so rows*cols = 4 elements were read
    // and the other four were DROPPED — the entry displayed as a 2x2 holding only
    // the first page, and any save that rebuilt the chunk wrote a 2x2 back. Half
    // the array was gone from the file, with nothing reported.
    const v = value('<P Name="Value" Class="double" Dimension="2*2*2">1.0 2.0 3.0 4.0 5.0 6.0 7.0 8.0</P>');
    // This used to fold to 2x4 (MATLAB's own reshape(A,2,[])), which kept every
    // element but reported a shape MATLAB never had -- `size(A)` is [2 2 2], so
    // every subscript was wrong and a Matrix(2,4) went back into the file. The
    // serial string carries all three extents now, one bracketed group per row
    // with the two pages in order.
    expect(v).toEqual({
      _type: 'double',
      _value: 'Matrix(2,2,2)\n[[1.0, 3.0]; [2.0, 4.0]; [5.0, 7.0]; [6.0, 8.0]]',
    });
    // And the save path re-emits all eight in MATLAB's own column-major order
    // under MATLAB's own Dimension spelling -- byte-identical to what MATLAB wrote.
    expect(saved(v)).toBe('<P Name="X" Class="double" Dimension="2*2*2">1.0 2.0 3.0 4.0 5.0 6.0 7.0 8.0</P>');
  });

  it('REGRESSION: reads a single-extent Dimension as a row vector', () => {
    // Dimension="3" (no separator) left cols undefined, so the value formatted as
    // the literal string "Matrix(3,undefined)" with an EMPTY body — all three
    // elements dropped on load — and re-saved as the scalar 0.0.
    const v = value('<P Name="Value" Class="double" Dimension="3">1.0 2.0 3.0</P>');
    expect(v).toEqual([1, 2, 3]);
    expect(saved(v)).toBe('<P Name="X" Class="double" Dimension="1*3">1.0 2.0 3.0</P>');
  });

  it('reads typed, logical and empty N-D arrays through the same helper', () => {
    // Every branch that reads a Dimension goes through one helper, so a 3-D of any
    // class is read identically rather than each path inventing its own answer.
    // A 1x2x2 used to take the row-vector shortcut and come back as the flat
    // 4-vector [1, 2, 3, 4] -- a 1x4 MATLAB never had. Only rank 2 may do that.
    expect(value('<P Name="Value" Class="int16" Dimension="1*2*2">1 2 3 4</P>')).toEqual({
      _type: 'int16',
      _value: 'Matrix(1,2,2)\n[[1, 2]; [3, 4]]',
    });
    // Logical used to be the one class that carried no shape at all here, at any rank:
    // this line pinned the flat spelling and said a change to it should be a deliberate
    // one. Defect 44 is that change. The flat form was not merely shapeless -- it also
    // skipped the column-major transpose the line above performs, so MATLAB's own eight
    // values came back in an order nobody had typed. Same helper, same answer as int16
    // now.
    expect(value('<P Name="Value" Class="logical" Dimension="2*2*2">1 0 1 0 1 0 1 0</P>')).toEqual({
      _type: 'logical',
      _value: 'Matrix(2,2,2)\n[[1, 1]; [0, 0]; [1, 1]; [0, 0]]',
    });
    // Rank 2 as well, where the loss was visible in the UI: a 2x2 read back a 1x4.
    // The values are asymmetric under transpose, so this pins the ORDER too.
    expect(value('<P Name="Value" Class="logical" Dimension="2*2">1 0 1 0</P>')).toEqual({
      _type: 'logical',
      _value: 'Matrix(2,2)\n[[1, 1]; [0, 0]]',
    });
    // And a logical row keeps the bare, headerless spelling MATLAB writes for it --
    // unchanged by the fix, which is the point of asserting it beside the other two.
    expect(value('<P Name="Value" Class="logical" Dimension="1*3">1 0 1</P>')).toEqual({
      _type: 'logical',
      _value: '[1, 0, 1]',
    });
    // An empty 3-D keeps every extent, so it still reads as empty AND reports the
    // 0x2x2 that MATLAB's size() reports, not a folded 0x4.
    expect(value('<P Name="Value" Class="double" Dimension="0*2*2"></P>')).toEqual({
      _type: 'double',
      _emptyDims: [0, 2, 2],
    });
  });

  it('reads a 3-D nested inside a cell and inside an object property alike', () => {
    // The three decode paths (entry value, cell element, object property) are
    // separate code; a rule applied in only one of them would lose shape through
    // the other two.
    const nd = 'Matrix(2,2,2)\n[[1.0, 3.0]; [2.0, 4.0]; [5.0, 7.0]; [6.0, 8.0]]';
    const cellValue = value(
      '<P Name="Value" Class="cell" Dimension="1*1">' +
        '<Element Class="double" Dimension="2*2*2">1.0 2.0 3.0 4.0 5.0 6.0 7.0 8.0</Element></P>',
    ) as Record<string, any>;
    expect(cellValue._elements[0]._value).toBe(nd);

    const propValue = value(
      '<P Name="Value"><Element Class="Simulink.Parameter">' +
        '<P Name="V" Class="double" Dimension="2*2*2">1.0 2.0 3.0 4.0 5.0 6.0 7.0 8.0</P></Element></P>',
    ) as Record<string, any>;
    expect(propValue._elements[0]._properties.V._value).toBe(nd);
  });

  it('leaves an ordinary R*C dimension exactly as it was', () => {
    // The regression guard for the two above: the common case must not move.
    const v = value('<P Name="Value" Class="double" Dimension="2*2">1.0 2.0 3.0 4.0</P>');
    expect(v).toEqual({ _type: 'double', _value: 'Matrix(2,2)\n[[1.0, 3.0]; [2.0, 4.0]]' });
    expect(saved(v)).toBe('<P Name="X" Class="double" Dimension="2*2">1.0 2.0 3.0 4.0</P>');
  });
});

describe('parseBinarySlddParts — cell elements', () => {
  /** The decoded elements of a one-property cell entry. */
  function cellElements(...elementsXml: string[]): unknown[] {
    const v = value(
      `<P Name="Value" Class="cell" Dimension="1*${elementsXml.length}">${elementsXml.join('')}</P>`,
    ) as Record<string, any>;
    expect(v._array_type).toBe('Cell');
    return v._elements;
  }

  it('decodes each numeric shape a cell can hold', () => {
    expect(
      cellElements(
        '<Element Class="double">2.5</Element>',
        '<Element Class="double" Dimension="1*3">1.0 2.0 3.0</Element>',
        '<Element Class="double" Dimension="2*2">1.0 2.0 3.0 4.0</Element>',
        '<Element Class="double" Dimension="0*0"></Element>',
        '<Element Class="double" IsComplex="1">1.0+2.0i</Element>',
      ),
    ).toEqual([
      2.5,
      [1, 2, 3],
      // An empty cell entry keeps its shape in the display string; there are no
      // elements to carry it any other way.
      { _type: 'double', _value: 'Matrix(2,2)\n[[1.0, 3.0]; [2.0, 4.0]]' },
      { _type: 'double', _value: 'Matrix(0,0)' },
      { _type: 'cdata', _value: '1.0+2.0i' },
    ]);
  });

  it('decodes logical and char elements, empty included', () => {
    expect(
      cellElements(
        '<Element Class="logical">1</Element>',
        '<Element Class="logical">0</Element>',
        '<Element Class="logical" Dimension="1*3">1 0 1</Element>',
        '<Element Class="logical" Dimension="0*0"></Element>',
        '<Element Class="char">a</Element>',
        '<Element Class="char"></Element>',
      ),
    ).toEqual([
      // A logical scalar is a real boolean, not a '1'/'0' envelope: the table
      // renders it as true/false and an edit round-trips through the same type.
      true,
      false,
      { _type: 'logical', _value: '[1, 0, 1]' },
      { _type: 'logical', _value: '[]' },
      'a',
      '',
    ]);
  });

  it('decodes a struct, a nested cell, and a nested object element', () => {
    const [struct, nested, nestedDim, obj] = cellElements(
      '<Element Class="struct"><Element><P Name="a" Class="double">1.0</P></Element></Element>',
      '<Element Class="cell"><Element Class="char">x</Element><Element Class="double">2.0</Element></Element>',
      '<Element Class="cell" Dimension="2*1"><Element Class="char">x</Element><Element Class="char">y</Element></Element>',
      '<Element><Element Class="Simulink.Parameter"><P Name="Value" Class="double">3.0</P></Element></Element>',
    );
    expect(struct).toEqual({
      _array_type: 'Struct',
      _dimensions: [1, 1],
      _elements: [{ a: 1 }],
      _fields: ['a'],
      _mw_element_type: 'MATLABArray',
    });
    // A nested cell with no Dimension is sized from its own element count.
    expect(nested).toMatchObject({ _array_type: 'Cell', _dimensions: [1, 2], _elements: ['x', 2] });
    // ...and one that declares a Dimension keeps the declared shape.
    expect(nestedDim).toMatchObject({ _array_type: 'Cell', _dimensions: [2, 1], _elements: ['x', 'y'] });
    expect(obj).toMatchObject({
      _array_class: 'Simulink.Parameter',
      _elements: [{ _properties: { Value: 3 } }],
    });
  });

  // REGRESSION. A `string` in a cell is the THIRD place this format nests one, and it
  // was the one place the reader had no branch for it: parseEntryValue has had the
  // Class="string" check since strings were supported, parsePropContent got its own for
  // a struct field / object property, and parseCellElement never got one. So the element
  // fell through to the generic nested-object tail and decoded as an OBJECT of class
  // `string` — `{"a"}` displayed as `{<1x1 string>}`, with the text stranded inside the
  // saveobj bag where no formatter looks. The JSON channel showed `{"a"}` the whole time,
  // so the same dictionary read two ways depending on which format it was saved in.
  //
  // The XML below is MATLAB's own bytes, read off a compressed-binary dictionary MATLAB
  // wrote for `{"a"}` and `{["a" "b"]}` (probe_cell_string.m): a cell element holding an
  // object is a CLASSLESS <Element> wrapping the object's own <Element Class="...">, which
  // is why the nested-object test above is right for a Simulink.Parameter and why only
  // `string` needs lifting out of that tail.
  it('REGRESSION: decodes a string element to its text, not an object summary', () => {
    const stringEl = (saveobjAttrs: string, ...chars: string[]): string =>
      '<Element><Element Class="string">' +
      `<P Source="saveobj" PropertyType="any" Class="cell"${saveobjAttrs}>` +
      chars.map((c) => `<Element Class="char">${c}</Element>`).join('') +
      '</P></Element></Element>';

    // A 1x1 string is the one-element LIST, which is exactly what the entry path and
    // the JSON channel both produce — so the cell's child is a string-kind node and
    // _serializeCellXml writes MATLAB's envelope back (see cellElementShape.test.ts).
    // MATLAB leaves the Dimension off the saveobj cell at 1x1, so that spelling is the
    // one that has to work.
    expect(cellElements(stringEl('', 'a'))).toEqual([['a']]);
    // A string ARRAY keeps its shape in the String envelope, as it does everywhere else.
    expect(cellElements(stringEl(' Dimension="1*2"', 'a', 'b'))).toEqual([
      {
        _array_type: 'String',
        _dimensions: [1, 2],
        _elements: ['a', 'b'],
        _mw_element_type: 'MATLABArray',
      },
    ]);
    // Two string elements side by side: each wrapper is decoded on its own, so the
    // cell keeps its length. MATLAB writes one wrapper per element (cStrTwo).
    expect(cellElements(stringEl('', 'a'), stringEl('', 'b'))).toEqual([['a'], ['b']]);
  });

  it('falls back to the element text for a class it does not decode', () => {
    // A cell can hold a type from a release we do not model. Showing the raw text
    // beats dropping the element, which would silently shorten the cell.
    expect(
      cellElements('<Element Class="SomeFutureType">hello</Element>', '<Element Class="SomeFutureType"></Element>'),
    ).toEqual(['hello', '']);
  });
});

describe('parseBinarySlddParts — MATLAB string properties', () => {
  /** A <P Name="Value"> wrapping an Element Class="string" with the given body. */
  const stringEntry = (body: string): unknown => value(`<P Name="Value"><Element Class="string">${body}</Element></P>`);

  it('decodes the saveobj cell to the strings it holds', () => {
    // A MATLAB string serializes as an object wrapping a Source="saveobj" cell of
    // chars. A scalar string is [text] so the single-value display path can read
    // it directly; a string ARRAY keeps its shape.
    expect(
      stringEntry('<P Name="s" Source="saveobj" Class="cell" Dimension="1*1"><Element Class="char">hi</Element></P>'),
    ).toEqual(['hi']);
    expect(
      stringEntry(
        '<P Name="s" Source="saveobj" Class="cell" Dimension="1*2">' +
          '<Element Class="char">a</Element><Element Class="char">b</Element></P>',
      ),
    ).toEqual({
      _array_type: 'String',
      _dimensions: [1, 2],
      _elements: ['a', 'b'],
      _mw_element_type: 'MATLABArray',
    });
    // No Dimension at all: take the elements as they come.
    expect(
      stringEntry('<P Name="s" Source="saveobj" Class="cell"><Element Class="char">a</Element></P>'),
    ).toEqual(['a']);
  });

  it('yields the empty string when the saveobj cell is missing or empty', () => {
    // Both shapes mean "" — the alternative is a bogus object envelope in the
    // Value column, which is what a missing Source="saveobj" used to produce
    // before this path existed.
    expect(stringEntry('<P Name="other" Class="char">x</P>')).toEqual(['']);
    expect(stringEntry('<P Name="s" Source="saveobj" Class="cell"></P>')).toEqual(['']);
  });
});

describe('parseBinarySlddParts — object properties', () => {
  /** The properties of a single-object entry value. */
  function props(propsXml: string): Record<string, unknown> {
    const v = value(`<P Name="Value"><Element Class="Simulink.Parameter">${propsXml}</Element></P>`) as Record<
      string,
      any
    >;
    return v._elements[0]._properties;
  }

  it('keeps a complex property as cdata, with its dimensions when it has any', () => {
    expect(props('<P Name="Value" Class="double" IsComplex="1">1.0+2.0i</P>').Value).toEqual({
      _type: 'cdata',
      _value: '1.0+2.0i',
    });
    expect(props('<P Name="Value" Class="double" IsComplex="1" Dimension="1*2">1.0+2.0i 3.0-4.0i</P>').Value).toEqual({
      _type: 'cdata',
      _value: '1.0+2.0i 3.0-4.0i',
      _dimensions: [1, 2],
    });
  });

  // REGRESSION. Several objects under a <P> carrying no Dimension used to decode to
  // a plain JS ARRAY of one-element wrappers. Nothing downstream understands that: it
  // is not a value object, so the serializer fell through to its numeric-array arm and
  // wrote `Class="double" Dimension="1*2">[object Object] [object Object]` — every
  // property of both objects gone from the file on the next save of an untouched entry.
  // It now decodes as the Nx1 object array it is, matching what the entry-level path
  // already did for the same undimensioned shape.
  it('decodes a property holding several objects with no declared dimension', () => {
    const things = props(
      '<P Name="Things">' +
        '<Element Class="Simulink.Signal"><P Name="A" Class="double">1.0</P></Element>' +
        '<Element Class="Simulink.Signal"><P Name="A" Class="double">2.0</P></Element></P>',
    ).Things as Record<string, any>;
    expect(things).toEqual({
      _array_class: 'Simulink.Signal',
      _dimensions: [2, 1],
      _mw_element_type: 'MATLABArray',
      _elements: [{ _properties: { A: 1 } }, { _properties: { A: 2 } }],
    });
    // The point: both objects survive a save, with their class.
    expect(saved(things)).toContain('<Element Class="Simulink.Signal">');
    expect(saved(things)).toContain('<P Name="A" Class="double">2.0</P>');
  });

  // REGRESSION. An <Element> with no Class is a STRUCT element, so a dimensioned
  // property full of them is a struct array — but this decoded to an object array
  // wrapper with `_array_class: ''`. That empty class is a shape nothing accepts:
  // it is falsy, so NodeClassMap does not route it to a node, and the serializer
  // skipped its object arm and wrote `Class="char">[object Object]`, losing every
  // field. It now decodes exactly as the same elements tagged `Class="struct"` do,
  // which is what makes them round-trip.
  it('decodes classless elements of a dimensioned property as the struct array they are', () => {
    const elems =
      '<Element><P Name="a" Class="double">1.0</P></Element><Element><P Name="a" Class="double">2.0</P></Element>';
    const expected = {
      _array_type: 'Struct',
      _dimensions: [1, 2],
      _elements: [{ a: 1 }, { a: 2 }],
      _fields: ['a'],
      _mw_element_type: 'MATLABArray',
    };
    expect(props(`<P Name="Rows" Dimension="1*2">${elems}</P>`).Rows).toEqual(expected);
    // Identical to the spelling MATLAB itself writes, and it writes back as a struct.
    expect(props(`<P Name="Rows" Class="struct" Dimension="1*2">${elems}</P>`).Rows).toEqual(expected);
    expect(saved(expected)).toBe(
      '<P Name="X" Class="struct" Dimension="1*2">\n' +
        '    <Element>\n        <P Name="a" Class="double">1.0</P>\n    </Element>\n' +
        '    <Element>\n        <P Name="a" Class="double">2.0</P>\n    </Element>\n' +
        '</P>',
    );
  });

  // REGRESSION. A single classless <Element> under a <P> — the same struct element,
  // written without the enclosing Class="struct" tag — decoded to a BARE field bag
  // ({ a: 1 }) with no envelope at all, which the serializer could only spell
  // `Class="char">[object Object]`.
  it('decodes a single classless element as a 1x1 struct, not a bare field bag', () => {
    const bag = props('<P Name="Bag"><Element><P Name="a" Class="double">1.0</P></Element></P>').Bag;
    expect(bag).toEqual({
      _array_type: 'Struct',
      _dimensions: [1, 1],
      _elements: [{ a: 1 }],
      _fields: ['a'],
      _mw_element_type: 'MATLABArray',
    });
    expect(saved(bag)).toContain('Class="struct"');
  });

  // REGRESSION. An object array whose FIRST element carried a Class but a later one
  // did not threw `Cannot read properties of undefined (reading '0')` out of the
  // parser: the per-element loop re-entered parseElement and indexed into the
  // single-element wrapper it returns, which a classless element does not produce.
  // Nothing between there and the host catches it, so the whole .sldd failed to open.
  it('does not throw when a later element of an object array carries no class', () => {
    const v = value(
      '<P Name="Value" Class="Simulink.Parameter" Dimension="2*1">' +
        '<Element Class="Simulink.Parameter"><P Name="V" Class="double">1.0</P></Element>' +
        '<Element><P Name="V" Class="double">2.0</P></Element></P>',
    ) as Record<string, any>;
    // The class comes off the wrapper (the first element), and the unclassed element
    // still contributes its properties rather than costing the file its read.
    expect(v._array_class).toBe('Simulink.Parameter');
    expect(v._elements.map((e: any) => e._properties.V)).toEqual([1, 2]);
  });

  // REGRESSION. A struct-valued property decoded correctly on a SCALAR object but
  // not on an element of an object ARRAY: the array path had its own copy of the
  // element loop that suppressed the struct arm, so `s` came back as a bare
  // { a: 1 } field bag with no Struct envelope. The save path has no way to tell
  // that from an opaque object and wrote `<P Name="s" Class="char">[object
  // Object]</P>` — the struct was destroyed on the next save of an untouched
  // entry. Both shapes now decode through the one element path.
  it('decodes a struct-valued property the same on an array element as on a scalar object', () => {
    const structProp = '<P Name="s" Class="struct"><Element><P Name="a" Class="double">1.0</P></Element></P>';
    const expected = {
      _array_type: 'Struct',
      _dimensions: [1, 1],
      _elements: [{ a: 1 }],
      _fields: ['a'],
      _mw_element_type: 'MATLABArray',
    };
    // On a scalar object property.
    expect((props(`<P Name="O"><Element Class="Simulink.BusElement">${structProp}</Element></P>`).O as any)
      ._elements[0]._properties.s).toEqual(expected);
    // And on each element of a dimensioned (object-array) property.
    const arr = props(
      `<P Name="O" Class="Simulink.BusElement" Dimension="2*1">` +
        `<Element Class="Simulink.BusElement">${structProp}</Element>` +
        `<Element Class="Simulink.BusElement">${structProp}</Element></P>`,
    ).O as Record<string, any>;
    expect(arr._elements.map((e: any) => e._properties.s)).toEqual([expected, expected]);
    // The point of the envelope: the save path writes it back AS a struct.
    expect(saved(arr)).toContain('<P Name="s" Class="struct">');
  });

  it('keeps a complex element property as cdata inside an object array too', () => {
    // The array path used to have its own element loop that skipped the
    // IsComplex="1" case entirely, so a complex property on an array element
    // decoded as bare text and lost its cdata envelope.
    const arr = props(
      '<P Name="O" Class="Simulink.Parameter" Dimension="1*2">' +
        '<Element Class="Simulink.Parameter"><P Name="V" Class="double" IsComplex="1">1.0+2.0i</P></Element>' +
        '<Element Class="Simulink.Parameter"><P Name="V" Class="double" IsComplex="1">3.0-4.0i</P></Element></P>',
    ).O as Record<string, any>;
    expect(arr._elements.map((e: any) => e._properties.V)).toEqual([
      { _type: 'cdata', _value: '1.0+2.0i' },
      { _type: 'cdata', _value: '3.0-4.0i' },
    ]);
  });

  it('decodes a bare property, an unknown class, and an empty typed one', () => {
    expect(props('<P Name="Bare">text</P>').Bare).toBe('text');
    // An unrecognized class keeps its text rather than becoming undefined.
    expect(props('<P Name="X" Class="SomeFutureType">zz</P>').X).toBe('zz');
    expect(props('<P Name="X" Class="SomeFutureType"></P>').X).toBe('');
    // An empty numeric is [], an empty char is '' — each the empty value of its
    // own type, so an edit starts from the right kind.
    expect(props('<P Name="X" Class="double" Dimension="0*0"></P>').X).toEqual([]);
    expect(props('<P Name="X" Class="char" Dimension="0*0"></P>').X).toBe('');
    // A dimensioned char is its text, not a per-character array.
    expect(props('<P Name="X" Class="char" Dimension="1*3">abc</P>').X).toBe('abc');
  });

  it('transposes a dimensioned numeric property out of column-major order', () => {
    // The file stores column-major; every display and every Matrix() string is
    // row-major. Getting this backwards transposes the user's matrix.
    expect(props('<P Name="X" Class="int16" Dimension="2*2">1 2 3 4</P>').X).toEqual({
      _type: 'int16',
      _value: 'Matrix(2,2)\n[[1, 3]; [2, 4]]',
    });
    expect(props('<P Name="X" Class="logical" Dimension="1*3">1 0 1</P>').X).toEqual({
      _type: 'logical',
      _value: '[1, 0, 1]',
    });
  });
});

describe('parseBinarySlddParts — document-level bookkeeping', () => {
  it('reads the dictionary flags and sub-dictionary references', () => {
    const c = content(
      chunk(
        '    <Object Class="DD.Dictionary"><P Name="AccessBaseWorkspace" Class="char">true</P></Object>',
        '    <Object Class="DD.DICTIONARYREFERENCE"><P Name="Subdictionary" Class="char">sub.sldd</P></Object>',
        // An empty Subdictionary names no file, so it is not a reference.
        '    <Object Class="DD.DICTIONARYREFERENCE"><P Name="Subdictionary" Class="char"></P></Object>',
      ),
    );
    expect(c['Dictionary References']).toEqual(['sub.sldd']);
    // MATLAB writes this flag as either 'true' or '1' depending on the release
    // that saved the dictionary; both mean the same thing.
    expect(c.AllowAccessBWS).toBe(true);
    expect(
      content(chunk('    <Object Class="DD.Dictionary"><P Name="AccessBaseWorkspace" Class="logical">1</P></Object>'))
        .AllowAccessBWS,
    ).toBe(true);
    expect(
      content(chunk('    <Object Class="DD.Dictionary"><P Name="AccessBaseWorkspace" Class="logical">0</P></Object>'))
        .AllowAccessBWS,
    ).toBe(false);
  });

  it('defaults the DataSource attributes that a save has to write back', () => {
    // These three are echoed verbatim into the rebuilt chunk. A missing one must
    // become the value MATLAB assumes, not the string "undefined".
    const bare = parseBinarySlddParts(`${DECL}\n<DataSource/>`, {}) as Record<string, any>;
    expect(bare.__dataSourceAttrs).toEqual({ FormatVersion: '1', MinRelease: 'R2014a', Arch: '' });
  });

  it('reads the MATLAB release out of the core properties part', () => {
    const enc = new TextEncoder();
    const withRelease = parseBinarySlddParts(`${DECL}\n<DataSource/>`, {
      'metadata/mwcoreProperties.xml': enc.encode('<x><matlabRelease>R2026a</matlabRelease></x>'),
    }) as Record<string, any>;
    expect(withRelease.__MW_TEXT_COREPROPERTIES__).toEqual({ release: 'R2026a' });
    // The part can be present but say nothing about the release.
    const without = parseBinarySlddParts(`${DECL}\n<DataSource/>`, {
      'metadata/mwcoreProperties.xml': enc.encode('<x/>'),
    }) as Record<string, any>;
    expect(without.__MW_TEXT_COREPROPERTIES__).toEqual({ release: '' });
    expect((parseBinarySlddParts(`${DECL}\n<DataSource/>`, {}) as Record<string, any>).__MW_TEXT_COREPROPERTIES__).toEqual(
      { release: '' },
    );
  });

  it('formats a MATLAB timestamp, and passes a too-short one through', () => {
    const [full, short] = content(
      chunk(
        entryObject('a', '        <P Name="LastMod" Class="char">20260704T015214.774221</P>'),
        entryObject('b', '        <P Name="LastMod" Class="char">2026</P>'),
      ),
    ).entries;
    expect(full.metadata.lastModifiedDate).toBe('2026-07-04T01:52:14Z');
    // Substring arithmetic on a short string yields plausible-looking garbage
    // ("2026--T::Z"), so anything too short to hold a date is shown as-is.
    expect(short.metadata.lastModifiedDate).toBe('2026');
    // The raw form is kept either way: it is what a save writes back for an entry
    // the user did not modify.
    expect(short.metadata._rawLastMod).toBe('2026');
  });

  it('pairs each entry with its own raw XML fragment', () => {
    // The host splices a single entry back into the file by finding its fragment,
    // so a fragment belonging to the wrong entry would overwrite the wrong span.
    const entries = content(
      chunk(entryObject('first', '        <P Name="X" Class="char">1</P>'), entryObject('second', '')),
    ).entries;
    expect(entries.map((e: any) => e.name)).toEqual(['first', 'second']);
    expect(entries[0].rawXml).toContain('<P Name="Name" Class="char">first</P>');
    expect(entries[0].rawXml).not.toContain('second');
    expect(entries[1].rawXml).toContain('second');
  });

  it('gives an entry no fragment rather than the wrong one when a tag is unclosed', () => {
    // A truncated write leaves the last <Object> unterminated. Scanning stops
    // there, so the entry parses (the XML parser recovers) but carries no
    // fragment — the host then rebuilds it from the model instead of splicing a
    // fragment that would run to the end of the file.
    const truncated =
      `${DECL}\n<DataSource>\n` +
      entryObject('a', '        <P Name="X" Class="char">1</P>') +
      `\n    <Object Class="DD.ENTRY"><P Name="Name" Class="char">b</P>\n</DataSource>`;
    const entries = content(truncated).entries;
    expect(entries.map((e: any) => e.name)).toEqual(['a', 'b']);
    expect(entries[0].rawXml).toContain('Name="Name"');
    expect(entries[1].rawXml).toBe('');
  });

  it('reports a missing data chunk by name', () => {
    // parseBinarySldd is called unguarded on file open and the message reaches the
    // user, so it has to say which part of the zip is absent.
    const notADictionary = zipSync({ 'metadata/coreProperties.xml': new TextEncoder().encode('<x/>') });
    const ab = notADictionary.buffer.slice(
      notADictionary.byteOffset,
      notADictionary.byteOffset + notADictionary.byteLength,
    ) as ArrayBuffer;
    expect(() => parseBinarySldd(ab)).toThrow('Missing data/chunk0.xml in binary SLDD');
  });
});

// A `Class`/`IsComplex` attribute is read as a KIND of thing, not matched against a
// transcript of what one build of MATLAB happened to write. Both rules below were closed
// enumerations, and each enumeration has a defect on record:
//
//   - `isNumericClass` listed its ten class names by hand, and `parseTypedValue` listed
//     nine of them AGAIN as `case` labels. int64/uint64 were missing from both, so a
//     64-bit struct FIELD fell through to the bare-text return and the writer, seeing a
//     bare string, spelled it `Class="char"` — MATLAB reopened the field as a char row of
//     digits (defect 27). The integer family is now one pattern asked in one place, so it
//     cannot omit a width and the two sites cannot disagree about one.
//   - `IsComplex` was compared to the literal `'1'` in three places. A spelling this
//     reader fails to recognize does not merely mis-display: the value loses its imaginary
//     parts AND is re-serialized without `IsComplex`, so they leave the file too — defect
//     53's exact shape. `'true'` is accepted as well now, the same latitude the `logical`
//     arm has always taken.
describe('parseBinarySlddParts — class and complexity read as kinds, not spellings', () => {
  // Every integer width MATLAB has, crossed with all three sites the format nests a typed
  // value at: an entry's own value, a struct FIELD, and a cell ELEMENT. The crossing is the
  // point — defect 27 was right at the entry site and wrong at the other two, so a table
  // that checked one site would have passed throughout.
  const INT_CLASSES = ['int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64'];

  for (const cls of INT_CLASSES) {
    it(`keeps the class of a ${cls} at the entry, field and cell sites`, () => {
      // The CLASS is the assertion, not the serial spelling of the digits: an unsigned
      // value carries a `U` suffix and a 64-bit one is held as exact text, both of which
      // are pinned elsewhere. What defect 27 destroyed was the class.
      const entry = value(`<P Name="Value" Class="${cls}">7</P>`);
      expect(entry, 'entry value').toMatchObject({ _type: cls });
      // And the save half, which is how 27 reached the file rather than only the screen:
      // a value whose class the reader dropped comes back out as Class="char".
      expect(saved(entry), 'entry value writes its class').toContain(`Class="${cls}"`);

      const field = value(
        `<P Name="Value" Class="struct"><Element><P Name="f" Class="${cls}">7</P></Element></P>`,
      ) as Record<string, any>;
      expect(field._elements[0].f, 'struct field').toMatchObject({ _type: cls });

      const cell = value(
        `<P Name="Value" Class="cell" Dimension="1*1"><Element Class="${cls}">7</Element></P>`,
      ) as Record<string, any>;
      expect(cell._elements[0], 'cell element').toMatchObject({ _type: cls });
    });
  }

  it('leaves a class it does not know as text rather than guessing a number', () => {
    // The pattern is deliberately not a catch-all, and this is the measurement that says
    // so. Admitting an unknown class into the numeric arms hands the save path a `_type`
    // it cannot format: `Class="half">1.5` comes back out as `2`, and a class whose body is
    // not numeric at all comes back out as `0`. Dropping the class and keeping the
    // characters is the less destructive failure, so it is the one this arm takes — which
    // is also why `half`, a real MATLAB numeric class, is NOT in the pattern.
    const field = value(
      '<P Name="Value" Class="struct"><Element><P Name="f" Class="half">1.5</P></Element></P>',
    ) as Record<string, any>;
    expect(field._elements[0].f).toBe('1.5');
  });

  for (const spelling of ['1', 'true']) {
    it(`reads IsComplex="${spelling}" as complex at the entry, field and cell sites`, () => {
      const entry = value(`<P Name="Value" Class="double" IsComplex="${spelling}">1.0+2.0i</P>`);
      expect(entry, 'entry value').toEqual({ _type: 'cdata', _value: '1.0+2.0i' });

      const field = value(
        `<P Name="Value" Class="struct"><Element>` +
          `<P Name="f" Class="double" IsComplex="${spelling}">1.0+2.0i</P></Element></P>`,
      ) as Record<string, any>;
      expect(field._elements[0].f, 'struct field').toEqual({ _type: 'cdata', _value: '1.0+2.0i' });

      // The cell element states its shape in the envelope, because the text form is the
      // only place a complex value's shape can be stated at all (defect 53).
      const cell = value(
        `<P Name="Value" Class="cell" Dimension="1*1">` +
          `<Element Class="double" IsComplex="${spelling}" Dimension="1*2">1.0+2.0i 3.0-4.0i</Element></P>`,
      ) as Record<string, any>;
      expect(cell._elements[0], 'cell element').toEqual({
        _type: 'cdata',
        _value: '1.0+2.0i 3.0-4.0i',
        _dimensions: [1, 2],
      });
    });
  }
});
