// Copyright 2026 The MathWorks, Inc.
//
// A classed or shaped empty keeps its class and its extents wherever it sits in a binary
// dictionary: at an entry, an object's property or a struct field, and a cell's element.
//
// MATLAB writes an empty as its class and a Dimension holding a 0, and nothing else: `<P
// Name="Elements_internal" Class="Simulink.BusElement" Dimension="0*0"/>` (22,225 times in the
// local corpus, every empty bus and connection bus there), `<P Name="intarray" Class="int16"
// Dimension="0*0"/>`, `<P Name="Value" Class="char" Dimension="0*2"/>`. BinarySlddParser read
// one at a property through parseTypedValue, whose zero-total branch answered a classless `[]`
// for a numeric class and `''`, a char, for every other, and through charValue, which answered
// `''` for every empty char at all three places. So the class or the extents were gone at the
// read: the bus's Elements_internal showed as a char and was saved `Class="char"`, the int16 as
// a double, the 0x2 char as the 0x0 one. A cell's element was read with its class and size
// already, under the bare header of its extents (`{_type: 'int16', _value: 'Matrix(0,0)'}`), and
// a property and an entry read the same now, as the maintainer decided; a char reads as the
// shaped char it is at every place, and a double 0x0 as `[]` at every place. An entry's was
// `{_type, _emptyDims}`, which a copy carried as `[]` and a paste into a binary dictionary wrote
// as a double 0x0; a cell's 0x0 logical `{_type: 'logical', _value: '[]'}`, and its double 0x0
// under the header.
//
// What a text dictionary is given for one is the spelling MATLAB reads back there, which MATLAB
// was asked for (test/textEmptyReadback.test.ts grades it against MATLAB's answers): the describe
// 'a text dictionary is given the spelling MATLAB reads back' pins it here.
//
// The host is custom_object_binary.sldd, with the shapes added in MATLAB's spelling of them, at
// each place; the buses are params.sldd's MyBus and MyConnBus with their elements taken out,
// spelled as every empty bus in the corpus is.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, ingest } from '../src/index.js';
import { parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import { regenerateChunkXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import DataNode from '../src/datamodel/node/DataNode.js';
import { flatten } from './parity/loadFile.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const HOST = './fixtures/custom_object_binary.sldd';
const PARAMS = './parity/artifacts/binary/params.sldd';
const TEXT_HOST = './fixtures/custom_object_text.sldd';

const bytesAt = (rel: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(rel, import.meta.url))));
const chunkOf = (zip: Uint8Array) => strFromU8(unzipSync(zip)['data/chunk0.xml']);
const buffer = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

/** The DD.ENTRY object named `name` in `xml`. */
function entryOf(xml: string, name: string): string {
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  expect(at, name).toBeGreaterThan(-1);
  const from = xml.lastIndexOf('    <Object Class="DD.ENTRY">', at);
  return xml.slice(from, xml.indexOf('\n    </Object>', at) + '\n    </Object>'.length);
}

/** The line of `xml` that starts, after its indent, with `open`. */
function lineOf(xml: string, open: string): string {
  const line = xml.split('\n').find((l) => l.trimStart().startsWith(open));
  expect(line, open).toBeDefined();
  return line!.trim();
}

/**
 * Each shape: its class and Dimension as MATLAB writes it, the node it opens as, and the form every place holds it in.
 * A logical's and an object array's empty show the size-and-class summary MATLAB's Workspace browser shows for them
 * (`1×0 logical`, `0×0 WidgetPart`), with the short class name, and a numeric one `[ ]` (the 2026-10-15 display ruling).
 */
type Shape = { name: string; cls: string; dim: string; dims: number[]; display: string; form: unknown };
const SHAPES: Shape[] = [
  { name: 'I16', cls: 'int16', dim: '0*0', dims: [0, 0], display: '[ ]', form: { _type: 'int16', _value: 'Matrix(0,0)' } },
  { name: 'I8', cls: 'int8', dim: '0*3', dims: [0, 3], display: '[ ]', form: { _type: 'int8', _value: 'Matrix(0,3)' } },
  { name: 'Lg', cls: 'logical', dim: '1*0', dims: [1, 0], display: '<1x0 logical>', form: { _type: 'logical', _value: 'Matrix(1,0)' } },
  { name: 'D2', cls: 'double', dim: '0*2', dims: [0, 2], display: '[ ]', form: { _type: 'double', _value: 'Matrix(0,2)' } },
  { name: 'D0', cls: 'double', dim: '0*0', dims: [0, 0], display: '[ ]', form: [] },
  { name: 'Lg0', cls: 'logical', dim: '0*0', dims: [0, 0], display: '<0x0 logical>', form: { _type: 'logical', _value: 'Matrix(0,0)' } },
  { name: 'Parts0', cls: 'WidgetPart', dim: '0*0', dims: [0, 0], display: '<0x0 WidgetPart>', form: { _type: 'WidgetPart', _value: 'Matrix(0,0)' } },
  { name: 'Params0', cls: 'Simulink.Parameter', dim: '1*0', dims: [1, 0], display: '<1x0 Parameter>', form: { _type: 'Simulink.Parameter', _value: 'Matrix(1,0)' } },
  { name: 'Ch', cls: 'char', dim: '0*2', dims: [0, 2], display: "''", form: { _type: 'mxchar', _value: 'Matrix(0,2)\n[]' } },
  { name: 'Ch20', cls: 'char', dim: '2*0', dims: [2, 0], display: "''", form: { _type: 'mxchar', _value: 'Matrix(2,0)\n[[]; []]' } },
  { name: 'Ch3', cls: 'char', dim: '0*0*2', dims: [0, 0, 2], display: '<0x0x2 char>', form: { _type: 'mxchar', _value: 'Matrix(0,0,2)\n[]' } },
];
/**
 * The form as the binary reader holds it: saying it was read out of a binary dictionary
 * (XmlUtils.BINARY_EMPTY_KEY), which a text dictionary's own spelling of the same value does not.
 * A double 0x0 is `[]` in both, and says nothing.
 */
const read = (s: Shape) => (Array.isArray(s.form) ? s.form : { ...(s.form as object), _binary_empty: true });
const pSpelling = (s: Shape) => `<P Name="${s.name}" Class="${s.cls}" Dimension="${s.dim}"/>`;
const eSpelling = (s: Shape) => `<Element Class="${s.cls}" Dimension="${s.dim}"/>`;
const CHARS = SHAPES.filter((s) => s.cls === 'char');

const HOST_XML = chunkOf(bytesAt(HOST));
const NOTHING = '                <P Name="Nothing" Class="double" Dimension="0*0"/>';

/** A new DD.ENTRY named `name`, numbered `n`, whose Value line is `value`. */
function entry(name: string, n: number, value: string): string {
  return [
    '    <Object Class="DD.ENTRY">',
    `        <P Name="Name" Class="char">${name}</P>`,
    `        <P Name="UUID" Class="char">00000000-0000-4000-8000-${String(n).padStart(12, '0')}</P>`,
    '        <P Name="Namespace" Class="char">dacaf35e-55a5-454d-a7c1-93db038a210e</P>',
    '        <P Name="LastMod" Class="char">20260903T181348.010950</P>',
    '        <P Name="LastModBy" Class="char">someone</P>',
    '        <P Name="IsDerived" Class="char">0</P>',
    value,
    '    </Object>',
  ].join('\n');
}

/** widget with each shape as a property and in a cell property, and each as an entry of its own, `e` + name. */
function hostXml(): string {
  expect(HOST_XML).toContain(NOTHING);
  const props = SHAPES.map((s) => '                ' + pSpelling(s));
  const cell = [
    `                <P Name="Empties" Class="cell" Dimension="1*${SHAPES.length}">`,
    ...SHAPES.map((s) => '                    ' + eSpelling(s)),
    '                </P>',
  ];
  const entries = SHAPES.map((s, k) => entry('e' + s.name, k + 1, `        <P Name="Value" Class="${s.cls}" Dimension="${s.dim}"/>`));
  const tail = '    <Object Class="DD.Dictionary">';
  return HOST_XML.replace(NOTHING, [NOTHING, ...props, ...cell].join('\n')).replace(tail, entries.join('\n') + '\n' + tail);
}

function open(chunk: string, rel = HOST): { session: ReturnType<typeof createSession>; root: any } {
  const files = unzipSync(bytesAt(rel));
  files['data/chunk0.xml'] = strToU8(chunk);
  const session = createSession();
  const root: any = ingest(session, buffer(zipSync(files)), { filename: rel.split('/').pop()! });
  return { session, root };
}

const entryNode = (root: any, name: string) => flatten(root).find((n: any) => n?.isEntry && n.name === name);
const childOf = (node: any, name: string) => node.children.find((c: any) => c.name === name);
const shown = (n: any) => [n.className, n.displayValue, n.dims];

describe('a classed or shaped empty keeps its class and extents, at each place', () => {
  const entries = (): any[] =>
    (parseBinarySlddParts(hostXml(), {}) as any).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;

  it('in one form at an entry, a property and a cell, a char in its own', () => {
    const all = entries();
    const widget = all.find((e) => e.name === 'widget').value._elements[0]._properties;
    const cell = widget.Empties._elements;
    SHAPES.forEach((s, k) => {
      expect(widget[s.name], 'property ' + s.name).toEqual(read(s));
      expect(cell[k], 'cell ' + s.name).toEqual(read(s));
      expect(all.find((e) => e.name === 'e' + s.name).value, 'entry ' + s.name).toEqual(read(s));
    });
    // A double 0x0 at a property is still `[]`, which is what it is.
    expect(widget.Nothing).toEqual([]);
  });

  it('and opens as an empty of its class and size', () => {
    const { root } = open(hostXml());
    const widget = entryNode(root, 'widget');
    const cell = childOf(widget, 'Empties');
    SHAPES.forEach((s, k) => {
      const expected = [s.cls, s.display, s.dims];
      expect(shown(childOf(widget, s.name)), 'property ' + s.name).toEqual(expected);
      expect(shown(cell.children[k]), 'cell ' + s.name).toEqual(expected);
      expect(shown(entryNode(root, 'e' + s.name)), 'entry ' + s.name).toEqual(expected);
    });
  });
});

type Edit = 'untouched' | 'with another property edited' | 'renamed';
const EDITS: Edit[] = ['untouched', 'with another property edited', 'renamed'];

describe('and is saved as MATLAB wrote it', () => {
  for (const edit of EDITS) {
    it(edit, () => {
      const first = open(hostXml());
      if (edit === 'with another property edited') {
        expect(childOf(entryNode(first.root, 'widget'), 'Scalar').setProperty('Value', '2.5')).toBe(true);
      }
      const renames = edit === 'renamed' ? ['widget', ...SHAPES.map((s) => 'e' + s.name)] : [];
      for (const name of renames) {
        expect(entryNode(first.root, name).setProperty('Name', name + 'X')).toBe(true);
      }
      const saved = chunkOf(first.session.serializeSource(first.root.name)!.bytes!);
      const named = (xml: string) => renames.reduce((x, name) => x.replace('<P Name="Name" Class="char">' + name + 'X</P>', '<P Name="Name" Class="char">' + name + '</P>'), xml);
      const back = named(saved);
      // A save writes an unedited entry as its own bytes, so the writer is asked too, from the model.
      for (const [what, xml] of [['saved', back], ['written from the model', named(regenerateChunkXml(first.root))]]) {
        const widget = entryOf(xml, 'widget');
        const cell = widget.slice(widget.indexOf('<P Name="Empties"'));
        SHAPES.forEach((s, k) => {
          expect(lineOf(widget, `<P Name="${s.name}" `), `${what}: property ${s.name}`).toBe(pSpelling(s));
          expect(cell.split('\n')[k + 1].trim(), `${what}: cell ${s.name}`).toBe(eSpelling(s));
          expect(lineOf(entryOf(xml, 'e' + s.name), '<P Name="Value"'), `${what}: entry ${s.name}`).toBe(`<P Name="Value" Class="${s.cls}" Dimension="${s.dim}"/>`);
        });
      }
      // And reopened, each is the value it was.
      const again = open(back);
      SHAPES.forEach((s) => expect(shown(childOf(entryNode(again.root, 'widget'), s.name)), s.name).toEqual([s.cls, s.display, s.dims]));
    });
  }

  it('and so is a copy of an entry holding one, pasted into a binary dictionary', () => {
    // A copy of the entry carries the empty as read, its class and size with it, as a copy of
    // the object carries its properties': the entry's old form was copied as `[]`, which a
    // binary dictionary wrote as a double 0x0.
    const { session, root } = open(hostXml());
    const design = root.getSection('design');
    SHAPES.forEach((s, k) => {
      const payload: any = JSON.parse(JSON.stringify(entryNode(root, 'e' + s.name).serialize()));
      expect(payload.value, s.name).toEqual(read(s));
      payload.name = 'e' + s.name + 'Copy';
      payload.metadata = { ...payload.metadata, uuid: '00000000-0000-4000-9000-' + String(k + 10).padStart(12, '0') };
      design.parseEntry(payload);
    });
    const saved = chunkOf(session.serializeSource(root.name)!.bytes!);
    for (const s of SHAPES) {
      expect(lineOf(entryOf(saved, 'e' + s.name + 'Copy'), '<P Name="Value"'), s.name).toBe(`<P Name="Value" Class="${s.cls}" Dimension="${s.dim}"/>`);
    }
  });

  it('and so is a copy of the object pasted into a binary dictionary', () => {
    const { session, root } = open(hostXml());
    const payload: any = JSON.parse(JSON.stringify(entryNode(root, 'widget').serialize()));
    payload.name = 'widgetCopy';
    payload.metadata = { ...payload.metadata, uuid: '00000000-0000-4000-9000-000000000001' };
    root.getSection('design').parseEntry(payload);
    const copy = entryOf(chunkOf(session.serializeSource(root.name)!.bytes!), 'widgetCopy');
    for (const s of SHAPES) {
      expect(lineOf(copy, `<P Name="${s.name}" `), s.name).toBe(pSpelling(s));
    }
  });
});

describe('an empty bus or connection bus', () => {
  const PARAMS_XML = chunkOf(bytesAt(PARAMS));
  /** The `<P Name="Elements_internal"…>` of entry `name`, through its close. */
  const elementsOf = (xml: string, name: string): string => {
    const e = entryOf(xml, name);
    const from = e.indexOf('                <P Name="Elements_internal"');
    const line = e.slice(from, e.indexOf('\n', from));
    return line.endsWith('/>') ? line : e.slice(from, e.indexOf('\n                </P>', from) + '\n                </P>'.length);
  };
  const EMPTY_BUS = '                <P Name="Elements_internal" Class="Simulink.BusElement" Dimension="0*0"/>';
  const EMPTY_CONN = '                <P Name="Elements_internal" Class="Simulink.ConnectionElement" Dimension="0*0"/>';
  const emptied = () => PARAMS_XML.replace(elementsOf(PARAMS_XML, 'MyBus'), EMPTY_BUS).replace(elementsOf(PARAMS_XML, 'MyConnBus'), EMPTY_CONN);

  it('opens with no element and is saved as MATLAB wrote it, untouched, renamed, or an element added and removed', () => {
    for (const step of ['untouched', 'renamed', 'added and removed']) {
      const { session, root } = open(emptied(), PARAMS);
      for (const name of ['MyBus', 'MyConnBus']) {
        const bus = entryNode(root, name);
        expect(bus.children, name).toEqual([]);
        // The inspector's row for it shows an empty, where it showed the '' it was read as.
        expect(JSON.stringify(bus.toPIObject()), name).toContain('"Other.Elements_internal":"[ ]"');
        if (step === 'renamed') {
          expect(bus.setProperty('Name', name + 'X')).toBe(true);
        }
        if (step === 'added and removed') {
          const added = bus.addChildNode();
          expect(added).toBeTruthy();
          bus.removeChildNode(added);
        }
      }
      const saved = chunkOf(session.serializeSource(root.name)!.bytes!).replace(/char">(MyBus|MyConnBus)X</g, 'char">$1<');
      expect([elementsOf(saved, 'MyBus'), elementsOf(saved, 'MyConnBus')], step).toEqual([EMPTY_BUS, EMPTY_CONN]);
    }
  });

  it('and one whose elements are all removed, or a new one, is saved as an empty of its element class', () => {
    const { session, root } = open(PARAMS_XML, PARAMS);
    for (const name of ['MyBus', 'MyConnBus']) {
      const bus = entryNode(root, name);
      for (const child of [...bus.children]) {
        bus.removeChildNode(child);
      }
    }
    session.setActive(root, root.getSection('design'));
    const added = session.addEntry('design', 'Simulink.Bus', 'NewBus');
    expect(added).toBeTruthy();
    const saved = chunkOf(session.serializeSource(root.name)!.bytes!);
    expect([elementsOf(saved, 'MyBus'), elementsOf(saved, 'MyConnBus'), elementsOf(saved, 'NewBus')]).toEqual([EMPTY_BUS, EMPTY_CONN, EMPTY_BUS]);
  });

  it('an object array holding no element is written so too, where its size says it holds none', () => {
    const empty = { _array_class: 'WidgetPart', _dimensions: [0, 3], _mw_element_type: 'MATLABArray', _elements: [] };
    expect(DataNode.serializePropertyXml('Parts', empty, 0, null)).toBe('<P Name="Parts" Class="WidgetPart" Dimension="0*3"/>');
  });
});

describe('a typed `[]` is the 0x0 of its class', () => {
  it('in a text dictionary, as MATLAB writes one, and in a copy of it pasted into a binary one', () => {
    const json = JSON.parse(strFromU8(bytesAt(TEXT_HOST)));
    const widget = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === 'widget');
    widget.value._elements[0]._properties.I16 = { _type: 'int16', _value: '[]' };
    const text = JSON.stringify(json, null, '\t');
    const session = createSession();
    const txt: any = ingest(session, buffer(strToU8(text)), { filename: 'custom_object_text.sldd' });
    expect(shown(childOf(entryNode(txt, 'widget'), 'I16'))).toEqual(['int16', '[ ]', [0, 0]]);
    // An untouched save writes it as read.
    const saved = JSON.parse(session.serializeSource(txt.name)!.text!).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    expect(saved.find((e: any) => e.name === 'widget').value._elements[0]._properties.I16).toEqual({ _type: 'int16', _value: '[]' });
    // And a copy into a binary dictionary is written as the 0x0 int16 it is, where it was a 0.
    const bin = open(HOST_XML);
    const payload: any = JSON.parse(JSON.stringify(entryNode(txt, 'widget').serialize()));
    payload.name = 'widgetCopy';
    payload.metadata = { ...entryNode(bin.root, 'widget').metadata, uuid: '00000000-0000-4000-9000-000000000002' };
    bin.root.getSection('design').parseEntry(payload);
    const copy = entryOf(chunkOf(bin.session.serializeSource(bin.root.name)!.bytes!), 'widgetCopy');
    expect(lineOf(copy, '<P Name="I16" ')).toBe('<P Name="I16" Class="int16" Dimension="0*0"/>');
  });

  it("and a binary dictionary's 0x0 logical in a cell, which its reader holds as one", () => {
    const xml = hostXml().replace('<P Name="Value" Class="cell" Dimension="2*2">', '<P Name="Value" Class="cell" Dimension="1*1">\n            <Element Class="logical" Dimension="0*0"/>\n        </P>\n        <P Name="Was" Class="cell" Dimension="2*2">');
    const { session, root } = open(xml);
    const member = entryNode(root, 'partCell').children[0];
    expect(shown(member)).toEqual(['logical', '<0x0 logical>', [0, 0]]);
    const saved = entryOf(chunkOf(session.serializeSource(root.name)!.bytes!), 'partCell');
    expect(saved).toContain('        <P Name="Value" Class="cell" Dimension="1*1">\n            <Element Class="logical" Dimension="0*0"/>\n        </P>');
    // The save keeps the unedited entry's bytes; the writer writes the same from the model.
    expect(entryOf(regenerateChunkXml(root), 'partCell'), 'written from the model').toContain('        <P Name="Value" Class="cell" Dimension="1*1">\n            <Element Class="logical" Dimension="0*0"/>\n        </P>');
  });
});

describe('a text dictionary is given the spelling MATLAB reads back', () => {
  // MATLAB was asked (test/parity/matlab/probe_text_empty_readback.m, graded by
  // test/textEmptyReadback.test.ts): a numeric or logical empty under the header of its extents
  // reads back as the class and size it is at an entry, a property, a field and a cell, and so
  // does a char's shaped literal; a 0x0 is MATLAB's own spelling of one. An object array's empty
  // reads back right in no spelling, so it is MATLAB's own: `[]` at a property and as an entry's
  // value, `{"_type": cls, "_value": "[]"}` in a field and a cell. An N-D one is as it was. What
  // was written before was `[]` at a property and an entry for a numeric class and '' for any
  // other, a char '' at every place, and in a cell the header, an object array's too: an int8
  // 0x3 reopened in MATLAB as a double 0x0, a logical 1x0 as a char.
  const object = (s: Shape) => s.cls === 'WidgetPart' || s.cls === 'Simulink.Parameter';
  const zero = (s: Shape) => s.dims.length === 2 && s.dims[0] === 0 && s.dims[1] === 0;
  type At = 'entry' | 'property' | 'field' | 'cell';
  const spelling = (s: Shape, at: At): unknown => {
    if (object(s)) {
      return at === 'field' || at === 'cell' ? { _type: s.cls, _value: '[]' } : [];
    }
    if (s.dims.length > 2) {
      return '';
    }
    if (zero(s)) {
      return s.cls === 'double' ? [] : { _type: s.cls, _value: '[]' };
    }
    return s.form;
  };
  /** What a reopen holds for it: its class and size, an object array's class where its spelling states one. */
  const reopened = (s: Shape, at: At): unknown[] =>
    object(s) ? (at === 'field' || at === 'cell' ? [s.cls, [0, 0]] : ['double', [0, 0]]) : s.dims.length > 2 ? ['char', [0, 0]] : [s.cls, s.dims];
  /** hostXml, with each shape a field of the struct property `Fields` too. */
  const withFields = (): string =>
    hostXml().replace(
      NOTHING,
      [
        NOTHING,
        '                <P Name="Fields" Class="struct">',
        '                    <Element>',
        ...SHAPES.map((s) => '                        ' + pSpelling(s)),
        '                    </Element>',
        '                </P>',
      ].join('\n'),
    );

  it('pasted there from a binary one, at an entry, a property, a field and a cell, and so reopened', () => {
    const session = createSession();
    const bin: any = ingest(session, buffer(zipSync({ ...unzipSync(bytesAt(HOST)), 'data/chunk0.xml': strToU8(withFields()) })), { filename: 'custom_object_binary.sldd' });
    const txt: any = ingest(session, buffer(bytesAt(TEXT_HOST)), { filename: 'custom_object_text.sldd' });
    const design = txt.getSection('design');
    const names = ['widget', ...SHAPES.map((s) => 'e' + s.name)];
    names.forEach((name, k) => {
      const payload: any = JSON.parse(JSON.stringify(entryNode(bin, name).serialize()));
      payload.name = name + 'Copy';
      payload.metadata = { ...design.children[0].metadata, uuid: '00000000-0000-4000-a000-' + String(k + 1).padStart(12, '0') };
      design.parseEntry(payload);
    });
    const text = session.serializeSource(txt.name)!.text!;
    const entries: any[] = JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const valueOf = (name: string) => entries.find((e) => e.name === name).value;
    const widget = valueOf('widgetCopy')._elements[0]._properties;
    SHAPES.forEach((s, k) => {
      expect(widget[s.name], 'property ' + s.name).toEqual(spelling(s, 'property'));
      expect(widget.Fields._elements[0][s.name], 'field ' + s.name).toEqual(spelling(s, 'field'));
      expect(widget.Empties._elements[k], 'cell ' + s.name).toEqual(spelling(s, 'cell'));
      expect(valueOf('e' + s.name + 'Copy'), 'entry ' + s.name).toEqual(spelling(s, 'entry'));
    });
    // And the key that says each was read out of a binary dictionary is the binary reader's own.
    expect(text).not.toContain('_binary_empty');
    const again: any = ingest(createSession(), buffer(strToU8(text)), { filename: 'reopened_text.sldd' });
    const w = entryNode(again, 'widgetCopy');
    SHAPES.forEach((s, k) => {
      expect([childOf(w, s.name).className, childOf(w, s.name).dims], 'property ' + s.name).toEqual(reopened(s, 'property'));
      const f = childOf(childOf(w, 'Fields'), s.name);
      expect([f.className, f.dims], 'field ' + s.name).toEqual(reopened(s, 'field'));
      const c = childOf(w, 'Empties').children[k];
      expect([c.className, c.dims], 'cell ' + s.name).toEqual(reopened(s, 'cell'));
      const e = entryNode(again, 'e' + s.name + 'Copy');
      expect([e.className, e.dims], 'entry ' + s.name).toEqual(reopened(s, 'entry'));
    });
  });

  it("and so is a host's `{_type, _emptyDims}`, pasted into either dictionary and copied into a text one", () => {
    // The form an entry's empty took before the binary reader held it under its header, which a
    // host still hands in: pasted into a text dictionary, a rank-2 one was given its MAT stream,
    // and copied out of a binary one `[]`, a double 0x0 (MatlabVariableNode.serializeValue).
    const host: [unknown, unknown][] = [
      [{ _type: 'int8', _emptyDims: [0, 3] }, { _type: 'int8', _value: 'Matrix(0,3)' }],
      [{ _type: 'logical', _emptyDims: [0, 5] }, { _type: 'logical', _value: 'Matrix(0,5)' }],
      [{ _type: 'double', _emptyDims: [2, 0] }, { _type: 'double', _value: 'Matrix(2,0)' }],
      [{ _type: 'int16', _emptyDims: [0, 0] }, { _type: 'int16', _value: '[]' }],
      [{ _type: 'double', _emptyDims: [0, 0] }, []],
    ];
    const session = createSession();
    const bin: any = ingest(session, buffer(zipSync({ ...unzipSync(bytesAt(HOST)), 'data/chunk0.xml': strToU8(hostXml()) })), { filename: 'custom_object_binary.sldd' });
    const txt: any = ingest(session, buffer(bytesAt(TEXT_HOST)), { filename: 'custom_object_text.sldd' });
    const design = txt.getSection('design');
    host.forEach(([value], k) => {
      design.parseEntry({ name: 'h' + k, metadata: { ...design.children[0].metadata, uuid: '00000000-0000-4000-a100-' + String(k + 1).padStart(12, '0') }, value });
      const pasted = bin.getSection('design').parseEntry({ name: 'b' + k, metadata: { ...entryNode(bin, 'eI8').metadata, uuid: '00000000-0000-4000-a200-' + String(k + 1).padStart(12, '0') }, value });
      const copy: any = JSON.parse(JSON.stringify(pasted.serialize()));
      copy.name = 'c' + k;
      copy.metadata = { ...design.children[0].metadata, uuid: '00000000-0000-4000-a300-' + String(k + 1).padStart(12, '0') };
      design.parseEntry(copy);
    });
    const entries: any[] = JSON.parse(session.serializeSource(txt.name)!.text!).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    host.forEach(([value, spelled], k) => {
      expect(entries.find((e) => e.name === 'h' + k).value, 'pasted ' + JSON.stringify(value)).toEqual(spelled);
      expect(entries.find((e) => e.name === 'c' + k).value, 'copied ' + JSON.stringify(value)).toEqual(spelled);
    });
  });

  it("but a host's struct or cell `{_type, _emptyDims}` keeps its MAT stream there, and reopens as the struct or cell it is", () => {
    // No reader holds a struct's or a cell's empty under the header of its extents: the binary
    // one holds it as its array (BinarySlddParser.structValue, cellValue). Taken for that
    // reader's empty, a host's struct 0x3 or cell 0x2 pasted into a text dictionary was saved
    // `[]` as an entry and reopened as a double 0x0, and '' at a field; its MAT stream, which a
    // text dictionary was given for one before, reopens as the struct or cell it is.
    const host: { _type: string; _emptyDims: number[] }[] = [
      { _type: 'struct', _emptyDims: [0, 3] },
      { _type: 'cell', _emptyDims: [0, 2] },
      { _type: 'struct', _emptyDims: [2, 0] },
      { _type: 'cell', _emptyDims: [0, 0] },
    ];
    const inField = (v: unknown) => ({ _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ f: v }], _fields: ['f'], _mw_element_type: 'MATLABArray' });
    const inCell = (v: unknown) => ({ _array_type: 'Cell', _dimensions: [1, 1], _elements: [v], _mw_element_type: 'MATLABArray' });
    const session = createSession();
    const txt: any = ingest(session, buffer(bytesAt(TEXT_HOST)), { filename: 'custom_object_text.sldd' });
    const design = txt.getSection('design');
    const paste = (name: string, n: number, value: unknown) =>
      design.parseEntry({ name, metadata: { ...design.children[0].metadata, uuid: '00000000-0000-4000-a400-' + String(n).padStart(12, '0') }, value: JSON.parse(JSON.stringify(value)) });
    host.forEach((value, k) => {
      paste('s' + k, 3 * k + 1, value);
      paste('f' + k, 3 * k + 2, inField(value));
      paste('c' + k, 3 * k + 3, inCell(value));
    });
    const text = session.serializeSource(txt.name)!.text!;
    const entries: any[] = JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const valueOf = (name: string) => entries.find((e) => e.name === name).value;
    const again: any = ingest(createSession(), buffer(strToU8(text)), { filename: 'reopened_text.sldd' });
    const of = (n: any) => [n.className, n.dims];
    // Each place's written `_type`, then the class and size it reopens as.
    const got = host.map((value, k) => [
      JSON.stringify(value),
      valueOf('s' + k)?._type,
      valueOf('f' + k)?._elements?.[0]?.f?._type,
      valueOf('c' + k)?._elements?.[0]?._type,
      of(entryNode(again, 's' + k)),
      of(childOf(entryNode(again, 'f' + k), 'f')),
      of(entryNode(again, 'c' + k).children[0]),
    ]);
    const want = host.map((value) => {
      const opened = [value._type, value._emptyDims];
      return [JSON.stringify(value), 'cdata', 'cdata', 'cdata', opened, opened, opened];
    });
    expect(got).toEqual(want);
  });

  it('and shows there what the save writes and a reopen reads', () => {
    // Held as the binary reader holds it, a pasted 0x0x2 char showed `<0x0x2 char>` and an int8
    // 0x3 property `[ ]` at 0x3, and the save wrote '' and `[]`, which reopened as a 0x0.
    const session = createSession();
    const bin: any = ingest(session, buffer(zipSync({ ...unzipSync(bytesAt(HOST)), 'data/chunk0.xml': strToU8(hostXml()) })), { filename: 'custom_object_binary.sldd' });
    const txt: any = ingest(session, buffer(bytesAt(TEXT_HOST)), { filename: 'custom_object_text.sldd' });
    const design = txt.getSection('design');
    const names = ['widget', ...SHAPES.map((s) => 'e' + s.name)];
    const pasted = names.map((name, k) => {
      const payload: any = JSON.parse(JSON.stringify(entryNode(bin, name).serialize()));
      payload.name = name + 'Copy';
      payload.metadata = { ...design.children[0].metadata, uuid: '00000000-0000-4000-a000-' + String(k + 1).padStart(12, '0') };
      return tree(design.parseEntry(payload));
    });
    const again: any = ingest(createSession(), buffer(strToU8(session.serializeSource(txt.name)!.text!)), { filename: 'reopened_text.sldd' });
    expect(names.map((name) => tree(entryNode(again, name + 'Copy')))).toEqual(pasted);
    expect(pasted[names.indexOf('eCh3')]).toEqual([['eCh3Copy', 'char', "''", [0, 0], true]]);
  });

  it('and one the text dictionary holds itself is written as it holds it', () => {
    const json = JSON.parse(strFromU8(bytesAt(TEXT_HOST)));
    const widget = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === 'widget');
    widget.value._elements[0]._properties.Own = { _type: 'int8', _value: 'Matrix(0,3)' };
    widget.value._elements[0]._properties.OwnChar = { _type: 'mxchar', _value: 'Matrix(0,2)\n[]' };
    const session = createSession();
    const txt: any = ingest(session, buffer(strToU8(JSON.stringify(json))), { filename: 'custom_object_text.sldd' });
    const props = JSON.parse(session.serializeSource(txt.name)!.text!).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === 'widget').value._elements[0]._properties;
    expect([props.Own, props.OwnChar]).toEqual([{ _type: 'int8', _value: 'Matrix(0,3)' }, { _type: 'mxchar', _value: 'Matrix(0,2)\n[]' }]);
  });

  it('and so is a copy of it pasted there, or its entry re-read from the text, shown as the original', () => {
    // The same spelling as the binary reader's, but not saying it was read out of a binary
    // dictionary (XmlUtils.BINARY_EMPTY_KEY), so it goes as it came. Taken for the binary
    // reader's, a copy pasted into the same text dictionary, or an entry a host re-read from the
    // text, was given what a binary dictionary's empty is given: an int8 0x3 entry or property
    // shown and saved as a double 0x0, `[]`, a 0x2 char as '', and a cell's logical 0x0 as `{_type:
    // 'logical', _value: '[]'}`. MATLAB's own `{_type: 'int16', _value: '[]'}` beside them.
    const OWN: Record<string, unknown> = {
      I8: { _type: 'int8', _value: 'Matrix(0,3)' },
      Ch: { _type: 'mxchar', _value: 'Matrix(0,2)\n[]' },
      Lg0: { _type: 'logical', _value: 'Matrix(0,0)' },
      Parts0: { _type: 'WidgetPart', _value: 'Matrix(0,0)' },
      I16: { _type: 'int16', _value: '[]' },
    };
    const json = JSON.parse(strFromU8(bytesAt(TEXT_HOST)));
    const entries: any[] = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const props = entries.find((e) => e.name === 'widget').value._elements[0]._properties;
    for (const [k, v] of Object.entries(OWN)) {
      props['Own' + k] = v;
    }
    props.OwnCell = { _array_type: 'Cell', _dimensions: [1, Object.keys(OWN).length], _elements: Object.values(OWN) };
    Object.entries(OWN).forEach(([k, v], n) => {
      const e = JSON.parse(JSON.stringify(entries.find((x) => x.name === 'gearValue')));
      entries.push({ ...e, name: 'e' + k, metadata: { ...e.metadata, uuid: '00000000-0000-4000-b000-' + String(n + 1).padStart(12, '0') }, value: v });
    });
    const session = createSession();
    const txt: any = ingest(session, buffer(strToU8(JSON.stringify(json, null, '\t'))), { filename: 'custom_object_text.sldd' });
    const design = txt.getSection('design');
    const names = ['widget', ...Object.keys(OWN).map((k) => 'e' + k)];
    names.forEach((name, k) => {
      const ways: [string, unknown][] = [['Copy', entryNode(txt, name).serialize()], ['Sync', entries.find((e) => e.name === name)]];
      ways.forEach(([way, record], w) => {
        const payload: any = JSON.parse(JSON.stringify(record));
        payload.name = name + way;
        payload.metadata = { ...payload.metadata, uuid: '00000000-0000-4000-c000-' + String(2 * k + w + 1).padStart(12, '0') };
        const shownAs = JSON.stringify(tree(design.parseEntry(payload))).split(name + way).join(name);
        expect(shownAs, name + way).toBe(JSON.stringify(tree(entryNode(txt, name))));
      });
    });
    const text = session.serializeSource(txt.name)!.text!;
    const saved: any[] = JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const savedAs = (name: string) => JSON.stringify(saved.find((e) => e.name === name).value, null, '\t');
    for (const name of names) {
      expect([savedAs(name + 'Copy'), savedAs(name + 'Sync')], name).toEqual([savedAs(name), savedAs(name)]);
    }
    const widget = JSON.parse(savedAs('widget'))._elements[0]._properties;
    for (const [k, v] of Object.entries(OWN)) {
      expect([JSON.parse(savedAs('e' + k)), widget['Own' + k]], k).toEqual([v, v]);
    }
    expect(widget.OwnCell._elements).toEqual(Object.values(OWN));
    expect(shown(childOf(entryNode(txt, 'widget'), 'OwnI8'))).toEqual(['int8', '[ ]', [0, 3]]);
    expect(text).not.toContain('_binary_empty');
  });
});

describe('an empty of a class that XML must escape, or a function handle', () => {
  // A class reaches the writers as the reader decoded it, `My&Class` for MATLAB's
  // `Class="My&amp;Class"`, and was written back unescaped: `Class="My&Class"`, which is not XML.
  // And `{_type: 'function_handle'}` is a handle's text, so a handle array's empty under the bare
  // header showed `@Matrix(0,0)` at 1x1 and was saved as `>NaN<`; it is an empty of its class.
  const ODD = [
    // An empty of an object class shows its summary, and so takes no editor (the 2026-10-15 display ruling).
    { name: 'Amp', cls: 'My&amp;Class', shown: ['My&Class', '<0x0 My&Class>', [0, 0]], editable: false },
    { name: 'Fh', cls: 'function_handle', shown: ['function_handle', '[ ]', [0, 0]], editable: false },
  ];
  const xml = (): string => {
    const props = ODD.map((o) => `                <P Name="${o.name}" Class="${o.cls}" Dimension="0*0"/>`);
    const cell = [`                <P Name="Odd" Class="cell" Dimension="1*${ODD.length}">`, ...ODD.map((o) => `                    <Element Class="${o.cls}" Dimension="0*0"/>`), '                </P>'];
    const entries = ODD.map((o, k) => entry('e' + o.name, k + 40, `        <P Name="Value" Class="${o.cls}" Dimension="0*0"/>`));
    const tail = '    <Object Class="DD.Dictionary">';
    return HOST_XML.replace(NOTHING, [NOTHING, ...props, ...cell].join('\n')).replace(tail, entries.join('\n') + '\n' + tail);
  };

  it('opens as an empty of its class, and is saved as MATLAB wrote it, untouched and with another property edited', () => {
    for (const edit of [false, true]) {
      const { session, root } = open(xml());
      const widget = entryNode(root, 'widget');
      const cell = childOf(widget, 'Odd');
      ODD.forEach((o, k) => {
        for (const node of [childOf(widget, o.name), cell.children[k], entryNode(root, 'e' + o.name)]) {
          expect([...shown(node), node.valueEditable], o.name).toEqual([...o.shown, o.editable]);
        }
      });
      if (edit) {
        expect(childOf(widget, 'Scalar').setProperty('Value', '2.5')).toBe(true);
      }
      const saved = chunkOf(session.serializeSource(root.name)!.bytes!);
      const w = entryOf(saved, 'widget');
      const c = w.slice(w.indexOf('<P Name="Odd"'));
      ODD.forEach((o, k) => {
        expect(lineOf(w, `<P Name="${o.name}" `), o.name).toBe(`<P Name="${o.name}" Class="${o.cls}" Dimension="0*0"/>`);
        expect(c.split('\n')[k + 1].trim(), o.name).toBe(`<Element Class="${o.cls}" Dimension="0*0"/>`);
        expect(lineOf(entryOf(saved, 'e' + o.name), '<P Name="Value"'), o.name).toBe(`<P Name="Value" Class="${o.cls}" Dimension="0*0"/>`);
      });
      // And the file saved is one an XML reader reads back, as it was.
      const again = open(saved);
      expect(shown(childOf(entryNode(again.root, 'widget'), 'Amp'))).toEqual(ODD[0].shown);
    }
  });
});

describe('an integer or single value edited to `[]` keeps its class, as it shows, in what is saved', () => {
  // The edit keeps the class (classAfterEdit), and an entry of a binary dictionary was saved so,
  // being written from the node: `<P Name="Value" Class="int8" Dimension="0*0"/>`. A property was
  // written from its value's JSON form, which was a bare `[]` for an empty of every class: an
  // int8 or int16 property edited to `[]` showed as int8 or int16 and was saved `Class="double"
  // Dimension="0*0"/>`, and so was a text dictionary's entry or property, as `[]`. Each reopened as
  // a double.
  const editTo = (session: any, root: any, node: any, text: string) => {
    session.setActive(root, node);
    expect(session.editProperty(node.id, 'Value', text)).toBe(true);
  };
  const cls = (name: string) => SHAPES.find((s) => s.name === name.replace(/^e/, ''))!.cls;

  it('at a property and an entry of a binary dictionary', () => {
    const { session, root } = open(hostXml());
    const props = ['I8', 'I16'];
    const entries = ['eI8', 'eI16'];
    for (const name of props) {
      editTo(session, root, childOf(entryNode(root, 'widget'), name), '[]');
    }
    for (const name of entries) {
      editTo(session, root, entryNode(root, name), '[]');
    }
    const shownIn = (r: any) => [...props.map((p) => shown(childOf(entryNode(r, 'widget'), p))), ...entries.map((e) => shown(entryNode(r, e)))];
    const expected = [...props, ...entries].map((n) => [cls(n), '[ ]', [0, 0]]);
    expect(shownIn(root)).toEqual(expected);
    const saved = chunkOf(session.serializeSource(root.name)!.bytes!);
    for (const name of props) {
      expect(lineOf(entryOf(saved, 'widget'), `<P Name="${name}" `), name).toBe(`<P Name="${name}" Class="${cls(name)}" Dimension="0*0"/>`);
    }
    for (const name of entries) {
      expect(lineOf(entryOf(saved, name), '<P Name="Value"'), name).toBe(`<P Name="Value" Class="${cls(name)}" Dimension="0*0"/>`);
    }
    expect(shownIn(open(saved).root)).toEqual(expected);
  });

  it('and at a property and an entry of a text dictionary, as MATLAB writes the 0x0 of its class there', () => {
    const json = JSON.parse(strFromU8(bytesAt(TEXT_HOST)));
    const entries: any[] = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const props = entries.find((e) => e.name === 'widget').value._elements[0]._properties;
    props.I8 = { _type: 'int8', _value: '[1, 2]' };
    props.Sg = { _type: 'single', _value: '[1.5F, 2F]' };
    const e = JSON.parse(JSON.stringify(entries.find((x) => x.name === 'gearValue')));
    entries.push({ ...e, name: 'eI8', metadata: { ...e.metadata, uuid: '00000000-0000-4000-d000-000000000001' }, value: { _type: 'int8', _value: '[1, 2]' } });
    const session = createSession();
    const txt: any = ingest(session, buffer(strToU8(JSON.stringify(json, null, '\t'))), { filename: 'custom_object_text.sldd' });
    for (const name of ['I8', 'Sg']) {
      editTo(session, txt, childOf(entryNode(txt, 'widget'), name), '[]');
    }
    editTo(session, txt, entryNode(txt, 'eI8'), '[]');
    const shownIn = (r: any) => [shown(childOf(entryNode(r, 'widget'), 'I8')), shown(childOf(entryNode(r, 'widget'), 'Sg')), shown(entryNode(r, 'eI8'))];
    const edited = [['int8', '[ ]', [0, 0]], ['single', '[ ]', [0, 0]], ['int8', '[ ]', [0, 0]]];
    expect(shownIn(txt)).toEqual(edited);
    const text = session.serializeSource(txt.name)!.text!;
    const saved: any[] = JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const widget = saved.find((x) => x.name === 'widget').value._elements[0]._properties;
    expect([widget.I8, widget.Sg, saved.find((x) => x.name === 'eI8').value]).toEqual([
      { _type: 'int8', _value: '[]' },
      { _type: 'single', _value: '[]' },
      { _type: 'int8', _value: '[]' },
    ]);
    expect(shownIn(ingest(createSession(), buffer(strToU8(text)), { filename: 'reopened_text.sldd' }))).toEqual(edited);
  });

  it('and a double edited to `[]` is still `[]`', () => {
    const { session, root } = open(hostXml());
    editTo(session, root, childOf(entryNode(root, 'widget'), 'Scalar'), '[]');
    expect(shown(childOf(entryNode(root, 'widget'), 'Scalar'))).toEqual(['double', '[ ]', [0, 0]]);
    const saved = chunkOf(session.serializeSource(root.name)!.bytes!);
    expect(lineOf(entryOf(saved, 'widget'), '<P Name="Scalar" ')).toBe('<P Name="Scalar" Class="double" Dimension="0*0"/>');
  });
});

/** What `node` and every row under it shows. */
function tree(node: any): unknown[] {
  const out: unknown[] = [];
  const walk = (n: any) => {
    out.push([n.displayName, n.className, n.displayValue, n.dims, n.valueEditable]);
    for (const c of n.children || []) {
      walk(c);
    }
  };
  walk(node);
  return out;
}
