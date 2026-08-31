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
import '../src/datamodel/node/NodeClassMap.js';

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
  it('REGRESSION: keeps every element of a 3-D array, and writes them all back', () => {
    // A 3-D numeric is ordinary in a dictionary — a lookup table's breakpoint set
    // or a 3-D gain schedule. MATLAB writes Dimension="2*2*2" with the 8 elements
    // column-major. Each of the thirteen places that read this attribute did its
    // own `split('*')` and took [0] and [1], so rows*cols = 4 elements were read
    // and the other four were DROPPED — the entry displayed as a 2x2 holding only
    // the first page, and any save that rebuilt the chunk wrote a 2x2 back. Half
    // the array was gone from the file, with nothing reported.
    const v = value('<P Name="Value" Class="double" Dimension="2*2*2">1.0 2.0 3.0 4.0 5.0 6.0 7.0 8.0</P>');
    // Collapsed to 2x4, which is MATLAB's own reshape(A,2,[]): the page structure
    // is not representable downstream, but no element is lost.
    expect(v).toEqual({ _type: 'double', _value: 'Matrix(2,4)\n[[1.0, 3.0, 5.0, 7.0]; [2.0, 4.0, 6.0, 8.0]]' });
    // And the save path re-emits all eight, in the original column-major order.
    expect(saved(v)).toBe('<P Name="X" Class="double" Dimension="2*4">1.0 2.0 3.0 4.0 5.0 6.0 7.0 8.0</P>');
  });

  it('REGRESSION: reads a single-extent Dimension as a row vector', () => {
    // Dimension="3" (no separator) left cols undefined, so the value formatted as
    // the literal string "Matrix(3,undefined)" with an EMPTY body — all three
    // elements dropped on load — and re-saved as the scalar 0.0.
    const v = value('<P Name="Value" Class="double" Dimension="3">1.0 2.0 3.0</P>');
    expect(v).toEqual([1, 2, 3]);
    expect(saved(v)).toBe('<P Name="X" Class="double" Dimension="1*3">1.0 2.0 3.0</P>');
  });

  it('applies the same folding to typed, logical and empty arrays', () => {
    // Every branch that reads a Dimension goes through one helper, so a 3-D of any
    // class is folded identically rather than each path inventing its own answer.
    expect(value('<P Name="Value" Class="int16" Dimension="1*2*2">1 2 3 4</P>')).toEqual({
      _type: 'int16',
      _value: '[1, 2, 3, 4]',
    });
    expect(value('<P Name="Value" Class="logical" Dimension="2*2*2">1 0 1 0 1 0 1 0</P>')).toEqual({
      _type: 'logical',
      _value: '[1, 0, 1, 0, 1, 0, 1, 0]',
    });
    // An empty 3-D keeps its zero extent, so it still reads as empty and not as a
    // 0-element array of some non-zero shape.
    expect(value('<P Name="Value" Class="double" Dimension="0*2*2"></P>')).toEqual({
      _type: 'double',
      _emptyDims: [0, 4],
    });
  });

  it('folds a 3-D nested inside a cell and inside an object property alike', () => {
    // The three decode paths (entry value, cell element, object property) are
    // separate code; a fold applied in only one of them would lose data through
    // the other two.
    const cellValue = value(
      '<P Name="Value" Class="cell" Dimension="1*1">' +
        '<Element Class="double" Dimension="2*2*2">1.0 2.0 3.0 4.0 5.0 6.0 7.0 8.0</Element></P>',
    ) as Record<string, any>;
    expect(cellValue._elements[0]._value).toBe('Matrix(2,4)\n[[1.0, 3.0, 5.0, 7.0]; [2.0, 4.0, 6.0, 8.0]]');

    const propValue = value(
      '<P Name="Value"><Element Class="Simulink.Parameter">' +
        '<P Name="V" Class="double" Dimension="2*2*2">1.0 2.0 3.0 4.0 5.0 6.0 7.0 8.0</P></Element></P>',
    ) as Record<string, any>;
    expect(propValue._elements[0]._properties.V._value).toBe(
      'Matrix(2,4)\n[[1.0, 3.0, 5.0, 7.0]; [2.0, 4.0, 6.0, 8.0]]',
    );
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

  it('decodes a property holding several objects with no declared dimension', () => {
    // Without a Dimension there is no array shape to report, so each element is
    // decoded on its own and the property becomes a plain list.
    const things = props(
      '<P Name="Things">' +
        '<Element Class="Simulink.Signal"><P Name="A" Class="double">1.0</P></Element>' +
        '<Element Class="Simulink.Signal"><P Name="A" Class="double">2.0</P></Element></P>',
    ).Things as Record<string, any>[];
    expect(things).toHaveLength(2);
    expect(things.map((t) => t._elements[0]._properties.A)).toEqual([1, 2]);
  });

  it('treats classless elements of a dimensioned property as bare structs', () => {
    // <Element> with no Class is a struct element. Reporting an empty _array_class
    // is what tells the row builder there is no object type to show.
    const rows = props(
      '<P Name="Rows" Dimension="1*2">' +
        '<Element><P Name="a" Class="double">1.0</P></Element>' +
        '<Element><P Name="a" Class="double">2.0</P></Element></P>',
    ).Rows;
    expect(rows).toEqual({
      _array_class: '',
      _dimensions: [1, 2],
      _mw_element_type: 'MATLABArray',
      _elements: [{ _properties: { a: 1 } }, { _properties: { a: 2 } }],
    });
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
