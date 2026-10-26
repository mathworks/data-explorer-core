// Copyright 2026 The MathWorks, Inc.
//
// A complex vector whose elements are removed down to one: x = [1+2i 3+4i 5+6i];
// x(3) = []; x(2) = []. The ruling F2-5 (2026-10-15): the scalar left is complex, and keeps
// the class of the array it was (an int16 vector stays int16). A survivor whose imaginary
// part is zero by core's own narrowing rule (_isComplexValue) — an element edited to a real
// number — is saved as real. Undo puts the array back exactly: its class, its element type
// and its orientation.
//
// MatlabVariableNode._updateArrayAfterRemove made the value a scalar and left its type the
// array's class, 'double' or 'int16', holding the complex element's TEXT. A binary
// dictionary wrote that as `<P Name="Value" Class="char">1+2i</P>` (a double vector) or
// `Class="int16">1` (an int16 one), and undo rebuilt the survivor's row as a real element.
//
// The vectors are a binary dictionary's own (test/fixtures/mcos/complex_binary.sldd,
// MATLAB-written), and the text format is reached as a host reaches it too: the entry's
// serialize() put into a text dictionary (complex.sldd) and saved there, its stream read by
// the MAT reader itself rather than by the node layer. A text dictionary's own complex vector,
// a MAT stream, is cut the same way.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { isMatCdata, uudecode } from '../src/datamodel/parser/CdataCodec.js';
import { parseMatrix } from '../src/datamodel/parser/MatParser.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const fixture = (name: string): ArrayBuffer => {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/mcos/${name}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
};
const arrayBuffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

/** A MAT stream's variable, as the MAT reader decodes it. */
function streamVariable(cdata: any): any {
  const bytes = uudecode(cdata._value);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const v = parseMatrix(dv, 16, dv.getUint32(12, true));
  return { className: v.className, dimensions: v.dimensions, isComplex: v.isComplex, value: v.value };
}

/** The MAT streams in a saved text entry's value, decoded, or the value itself where it holds none. */
function streamsIn(x: unknown): unknown {
  const found: unknown[] = [];
  const walk = (o: unknown) => {
    if (o === null || typeof o !== 'object') return;
    if (isMatCdata(o as Record<string, unknown>)) found.push(streamVariable(o));
    else Object.values(o as Record<string, unknown>).forEach(walk);
  };
  walk(x);
  return found.length ? found : x;
}

/** An entry's `<P Name="Value" …>` as a binary dictionary's chunk holds it. */
function valueTag(xml: string, name: string): string {
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  expect(at, name).toBeGreaterThan(-1);
  const block = xml.slice(xml.lastIndexOf('<Object ', at), xml.indexOf('</Object>', at));
  return (block.match(/<P Name="Value"[^>]*(?:\/>|>[^<]*<\/P>)/) || [''])[0];
}

interface Saved {
  /** What the save wrote for the entry `name`. */
  written(name: string): unknown;
  /** The entry `name` in the file the save wrote, reopened. */
  reopened(name: string): any;
}

interface Format {
  label: string;
  save(session: any, root: any, names: string[]): Saved;
}

const BINARY: Format = {
  label: 'saved in the binary dictionary',
  save(session, root) {
    const bytes: Uint8Array = session.serializeSource(root.name).bytes;
    const xml = new TextDecoder().decode(unzipSync(bytes)['data/chunk0.xml']);
    const design = ingest(createSession(), arrayBuffer(bytes), { filename: root.name }).getSection('design');
    return { written: (name) => valueTag(xml, name), reopened: (name) => design.children.find((e: any) => e.name === name) };
  },
};

const TEXT: Format = {
  label: 'put into a text dictionary and saved there',
  save(_session, root, names) {
    const session = createSession();
    const txt: any = ingest(session, fixture('complex.sldd'), { filename: 'complex.sldd' });
    const design = txt.getSection('design');
    const meta = design.children.find((e: any) => e.name === 'pScalar').metadata;
    names.forEach((name, k) => {
      const entry = root.getSection('design').children.find((e: any) => e.name === name);
      const payload: any = JSON.parse(JSON.stringify(entry.serialize()));
      payload.name = name + 'Pasted';
      payload.metadata = { ...meta, uuid: `00000000-0000-4000-8000-${String(k + 1).padStart(12, '0')}` };
      design.parseEntry(payload);
    });
    const saved = session.serializeSource(txt.name);
    expect(saved.kind).toBe('text');
    const entries: any[] = JSON.parse(saved.text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const reopened = ingest(createSession(), arrayBuffer(new TextEncoder().encode(saved.text)), { filename: 'complex.sldd' }).getSection('design');
    return {
      written: (name) => streamsIn(entries.find((x) => x.name === name + 'Pasted').value),
      reopened: (name) => reopened.children.find((e: any) => e.name === name + 'Pasted'),
    };
  },
};

function openBinary(): { session: any; root: any; design: any } {
  const session = createSession();
  const root: any = ingest(session, fixture('complex_binary.sldd'), { filename: 'complex_binary.sldd' });
  return { session, root, design: root.getSection('design') };
}

// The complex vectors of complex_binary.sldd: a double row, a double column, an int16 row.
const VECTORS = [
  { name: 'pRow', cls: 'double', dims: [1, 3], tag: '<P Name="Value" Class="double" IsComplex="1">1.0+2.0i</P>' },
  { name: 'pCol', cls: 'double', dims: [3, 1], tag: '<P Name="Value" Class="double" IsComplex="1">1.0+2.0i</P>' },
  { name: 'pInt16Row', cls: 'int16', dims: [1, 3], tag: '<P Name="Value" Class="int16" IsComplex="1">1+2i</P>' },
];

/** What `format` writes for the complex scalar 1+2i of class `cls`. */
const scalarWritten = (format: Format, cls: string, tag: string): unknown =>
  format === BINARY ? tag : [{ className: cls, dimensions: [1, 1], isComplex: true, value: [{ re: 1, im: 2 }] }];

/** An array's shape and every element row, as the node holds them. */
const arrayShape = (v: any) => ({
  kind: v._kind,
  type: v._scalarType,
  elementType: v._elementType,
  dims: v._dims,
  rows: v.children.map((c: any) => [c._scalarType, c._scalarValue]),
});

describe('a text dictionary\'s own complex vector gives up an element, as a binary dictionary\'s does', () => {
  // A MAT stream holding a plain value, which takes edits (the C-012 ruling, revised 2026-10-24).
  for (const { name, cls } of [
    { name: 'pRow', cls: 'double' },
    { name: 'pInt16Row', cls: 'int16' },
  ]) {
    it(`${name}: cut to one element, is a complex ${cls} scalar, reopens as one, and undoes back to the stream it was read from`, () => {
      const session = createSession();
      const txt: any = ingest(session, fixture('complex.sldd'), { filename: 'complex.sldd' });
      const save = () => {
        const text: string = session.serializeSource(txt.name).text;
        const entries: any[] = JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
        const reopened = ingest(createSession(), arrayBuffer(new TextEncoder().encode(text)), { filename: 'complex.sldd' }).getSection('design');
        return { written: entries.find((x) => x.name === name).value, reopened: reopened.children.find((e: any) => e.name === name) };
      };
      const v = txt.getSection('design').children.find((e: any) => e.name === name)._valueNode;
      const asRead = arrayShape(v);
      expect(asRead).toMatchObject({ kind: 'array', type: cls, elementType: 'complex', dims: [1, 3] });
      const writtenAsRead = save().written;
      expect(v.canRemoveChild()).toBe(true);

      const cut3 = v.execRemoveChild(v.children[2]);
      const cut2 = v.execRemoveChild(v.children[1]);
      expect([v._kind, v._scalarType, v._scalarValue, v._complexClass()]).toEqual(['scalar', 'complex', '1+2i', cls]);
      const saved = save();
      expect(streamsIn(saved.written)).toEqual(scalarWritten(TEXT, cls, ''));
      const back = saved.reopened._valueNode;
      expect([back._kind, back._scalarType, back._complexClass(), back.displayValue, back.valueEditable]).toEqual(['scalar', 'complex', cls, '1+2i', true]);

      cut2.undo();
      cut3.undo();
      expect(arrayShape(v)).toEqual(asRead);
      expect(save().written).toEqual(writtenAsRead);
    });
  }

  it('its own complex scalars are streams of the form these tests expect of one', () => {
    const entries: any[] = JSON.parse(new TextDecoder().decode(new Uint8Array(fixture('complex.sldd')))).__MW_TEXT_PARTS__[
      '__MW_TEXT_PART__/data/chunk0'
    ].__MW_TEXT_content.entries;
    const own = (name: string) => streamsIn(entries.find((x) => x.name === name).value);
    expect(own('pScalar')).toEqual([{ className: 'double', dimensions: [1, 1], isComplex: true, value: [{ re: 3, im: 4 }] }]);
    expect(own('pInt8')).toEqual([{ className: 'int8', dimensions: [1, 1], isComplex: true, value: [{ re: 3, im: -4 }] }]);
  });
});

for (const format of [BINARY, TEXT]) {
  describe(`a complex vector cut to one element, ${format.label}`, () => {
    for (const vec of VECTORS) {
      it(`${vec.name}: is a complex ${vec.cls} scalar, reopens as one, and undoes back to the array`, () => {
        const { session, root, design } = openBinary();
        const entry = design.children.find((e: any) => e.name === vec.name);
        const v = entry._valueNode;
        const asRead = arrayShape(v);
        expect(asRead).toMatchObject({ kind: 'array', type: vec.cls, elementType: 'complex', dims: vec.dims });
        const writtenAsRead = format.save(session, root, [vec.name]).written(vec.name);

        const cut3 = v.execRemoveChild(v.children[2]);
        const cut2 = v.execRemoveChild(v.children[1]);
        expect([v._kind, v._scalarType, v._scalarValue, v._complexClass()]).toEqual(['scalar', 'complex', '1+2i', vec.cls]);
        expect(entry.displayValue).toBe('1+2i');

        const saved = format.save(session, root, [vec.name]);
        expect(saved.written(vec.name)).toEqual(scalarWritten(format, vec.cls, vec.tag));
        const back = saved.reopened(vec.name)._valueNode;
        expect([back._kind, back._scalarType, back._complexClass(), back.displayValue]).toEqual(['scalar', 'complex', vec.cls, '1+2i']);

        // One undo is the two-element array again, the survivor's row a complex element.
        cut2.undo();
        expect(arrayShape(v)).toEqual({ ...asRead, dims: vec.dims[0] === 1 ? [1, 2] : [2, 1], rows: asRead.rows.slice(0, 2) });
        cut3.undo();
        expect(arrayShape(v)).toEqual(asRead);
        expect(format.save(session, root, [vec.name]).written(vec.name)).toEqual(writtenAsRead);
      });
    }

    it('a survivor edited to a real number is a real scalar of the array\'s class, and undoes back', () => {
      const names = ['pRow', 'pInt16Row'];
      const { session, root, design } = openBinary();
      const cases = [
        { name: 'pRow', cls: 'double', tag: '<P Name="Value" Class="double">7.0</P>' },
        { name: 'pInt16Row', cls: 'int16', tag: '<P Name="Value" Class="int16">7</P>' },
      ];
      const values = cases.map((c) => design.children.find((e: any) => e.name === c.name)._valueNode);
      values.forEach((v: any) => expect(v.children[0].setProperty('Value', '7')).toBe(true));
      const edited = values.map(arrayShape);
      const before = format.save(session, root, names);
      const writtenEdited = names.map((n) => before.written(n));
      const cuts = values.map((v: any) => [v.execRemoveChild(v.children[2]), v.execRemoveChild(v.children[1])]);
      cases.forEach((c, k) => expect([values[k]._kind, values[k]._scalarType, values[k]._scalarValue, values[k]._isComplexValue()], c.name).toEqual(['scalar', c.cls, 7, false]));
      const saved = format.save(session, root, names);
      for (const c of cases) {
        if (format === BINARY) {
          expect(saved.written(c.name), c.name).toBe(c.tag);
        } else {
          expect(JSON.stringify(saved.written(c.name)), c.name).not.toMatch(/cdata|isComplex/);
        }
        expect(saved.reopened(c.name).displayValue, c.name).toBe('7');
      }
      cuts.forEach(([cut3, cut2]) => {
        cut2.undo();
        cut3.undo();
      });
      expect(values.map(arrayShape)).toEqual(edited);
      const after = format.save(session, root, names);
      expect(names.map((n) => after.written(n))).toEqual(writtenEdited);
    });

    it('a collapsed int16 scalar, its entry renamed, is still an int16', () => {
      const { session, root, design } = openBinary();
      const entry = design.children.find((e: any) => e.name === 'pInt16Row');
      const v = entry._valueNode;
      v.execRemoveChild(v.children[2]);
      v.execRemoveChild(v.children[1]);
      expect(entry.setProperty('Name', 'pInt16Renamed')).toBe(true);
      expect(v._complexClass()).toBe('int16');
      expect(format.save(session, root, ['pInt16Renamed']).written('pInt16Renamed')).toEqual(
        scalarWritten(format, 'int16', '<P Name="Value" Class="int16" IsComplex="1">1+2i</P>'),
      );
    });
  });
}

describe('a value typed over a collapsed complex scalar follows the rule for an edited one', () => {
  // An edited complex scalar keeps the class it had, as a number typed over it does (the D11
  // ruling, _applyParsed): the class a collapse kept, int16, holds the next value too.
  it('a bare int16 entry, cut to one element and then given 5+6i, is a complex int16', () => {
    const { session, root, design } = openBinary();
    const meta = design.children.find((e: any) => e.name === 'zRow').metadata;
    design.parseEntry({
      name: 'zInt16Row',
      value: { _type: 'cdata', _value: '1+2i 3-4i', _class: 'int16', _dimensions: [1, 2] },
      metadata: { ...meta, uuid: '00000000-0000-4000-8000-000000000099' },
    });
    const v = design.children.find((e: any) => e.name === 'zInt16Row');
    expect([v._kind, v._scalarType, v._elementType]).toEqual(['array', 'int16', 'complex']);
    const asRead = arrayShape(v);
    const writtenAsRead = BINARY.save(session, root, []).written('zInt16Row');
    const cut = v.execRemoveChild(v.children[1]);
    expect([v._scalarType, v._complexClass()]).toEqual(['complex', 'int16']);
    expect(BINARY.save(session, root, []).written('zInt16Row')).toBe('<P Name="Value" Class="int16" IsComplex="1">1+2i</P>');
    expect(v.setProperty('Value', '5+6i')).toBe(true);
    expect([v._scalarType, v._complexClass()]).toEqual(['complex', 'int16']);
    expect(BINARY.save(session, root, []).written('zInt16Row')).toBe('<P Name="Value" Class="int16" IsComplex="1">5+6i</P>');
    // A session undoes that edit by setting the text it showed back (DataModel.editProperty),
    // which is a value typed like any other. The removal's undo after it is still the int16
    // array the removal cut.
    expect(v.setProperty('Value', '1+2i')).toBe(true);
    cut.undo();
    expect(arrayShape(v)).toEqual(asRead);
    expect(BINARY.save(session, root, []).written('zInt16Row')).toBe(writtenAsRead);
  });
});

describe("a Parameter's Dimensions and Complexity follow a removal that collapses its Value (ruling A7)", () => {
  // The maintainer's ruling A7 (2026-10-15 evening): "a Parameter's Dimensions and Complexity
  // rows are refreshed after an element removal collapses its Value. A plain bug." MATLAB keeps
  // them as the Value's (measured, R2027a, 2026-10-15): p = Simulink.Parameter([1+2i 3+4i 5+6i]);
  // p.Value(2:3) = [] leaves Dimensions [1 1] and Complexity 'complex', for the int16 row and the
  // column too, and of [7 3+4i 5+6i], whose survivor is real, Complexity 'real'. They stayed [1 3]
  // and 'complex', in the rows and in the save.
  const cellOf = (cell: unknown): string =>
    cell !== null && typeof cell === 'object' ? String((cell as { text: unknown }).text) : String(cell ?? '');
  /** The Parameter's Dimensions and Complexity: its rows, and what its save writes. */
  const shapeOf = (entry: any) => {
    const row = entry.toRow();
    const props = entry.serializeValue()._elements[0]._properties;
    return { rows: [cellOf(row.dimensions), cellOf(row.complexity)], saved: [props.Dimensions, props.Complexity] };
  };
  const SCALAR = (complexity: string) => ({ rows: ['[1 1]', complexity], saved: [[1, 1], complexity] });
  const strFromChunk = (bytes: Uint8Array): string => new TextDecoder().decode(unzipSync(bytes)['data/chunk0.xml']);

  for (const vec of VECTORS) {
    it(`${vec.name}: [1 1] and complex once cut to one element; undone, as read; redone, [1 1] again`, () => {
      const { session, root, design } = openBinary();
      const entry = design.children.find((e: any) => e.name === vec.name);
      const asRead = shapeOf(entry);
      expect(asRead.saved).toEqual([vec.dims, 'complex']);
      const v = entry._valueNode;
      const cut3 = v.execRemoveChild(v.children[2]);
      const cut2 = v.execRemoveChild(v.children[1]);
      expect(shapeOf(entry)).toEqual(SCALAR('complex'));
      const chunk = strFromChunk(session.serializeSource(root.name).bytes);
      const at = chunk.indexOf(`<P Name="Name" Class="char">${vec.name}</P>`);
      const own = chunk.slice(at, chunk.indexOf('</Object>', at));
      expect(own).toContain('<P Name="Dimensions" Class="double" Dimension="1*2">1.0 1.0</P>');
      expect(own).toContain('<P Name="Complexity" Class="char">complex</P>');
      cut2.undo();
      cut3.undo();
      expect(shapeOf(entry)).toEqual(asRead);
      cut3.redo();
      cut2.redo();
      expect(shapeOf(entry)).toEqual(SCALAR('complex'));
    });
  }

  it('a survivor an element edit made real: Complexity real, and undone, complex as read', () => {
    const { design } = openBinary();
    const entry = design.children.find((e: any) => e.name === 'pRow');
    const asRead = shapeOf(entry);
    const v = entry._valueNode;
    expect(v.children[0].setProperty('Value', '7')).toBe(true);
    const cut3 = v.execRemoveChild(v.children[2]);
    const cut2 = v.execRemoveChild(v.children[1]);
    expect(entry.displayValue).toBe('7');
    expect(shapeOf(entry)).toEqual(SCALAR('real'));
    cut2.undo();
    cut3.undo();
    expect(shapeOf(entry)).toEqual(asRead);
  });
});
