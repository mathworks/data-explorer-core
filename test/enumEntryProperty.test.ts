// Copyright 2026 The MathWorks, Inc.
//
// An enumeration value at an entry or an object property keeps its enumeral, as one in a cell
// has since the cell reader learned to (test/cellEnumElement.test.ts).
//
// MATLAB states an enumeration value as a wrapper marked IsEnum="1" around one `<Element
// Class="GearMode" EnumerationName="Reverse" EnumerationType="int32">-1</Element>` per
// enumeral, and an empty one as the wrapper alone, self-closed, its class and Dimension on it:
// `<P Name="Value" IsEnum="1" Class="dSomeColors" Dimension="0*2"/>`. BinarySlddParser's
// parseEntryValue and parsePropContent never asked for IsEnum. So the enumeral read as an
// object of class GearMode with no properties, its name, type and value gone at the read,
// and the empty as a numeric empty of class GearMode. A scalar showed `<1x1 GearMode>`, an
// empty `[ ]`, editable, and every save wrote `<P Name="Value"><Element
// Class="GearMode"></Element></P>`, or the empty without IsEnum.
//
// The values are MATLAB's: custom_object_binary.sldd's gearValue, gearRow and widget.Mode,
// derived_class_binary.sldd's dpGain.Mode and dpPlain.Mode. Three shapes the fixtures do not
// hold are added in MATLAB's own spelling of them: an empty enumeration entry, as MATLAB-written
// dictionaries spell one (the shape test/undoRestoresValue.test.ts adds too); the same empty
// and gearRow's 1x3 as properties of widget; and a Simulink.Parameter whose Value is an
// enumeration value, which is params.sldd's pInt16 with gearValue's Value moved into it, the
// way a Parameter holds any value MATLAB writes at an entry.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, ingest } from '../src/index.js';
import { parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import { regenerateChunkXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { flatten } from './parity/loadFile.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const HOST = './fixtures/custom_object_binary.sldd';
const DERIVED = './fixtures/derived_class_binary.sldd';
const PARAMS = './parity/artifacts/binary/params.sldd';
const TEXT_HOST = './fixtures/custom_object_text.sldd';

const bytesAt = (rel: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(rel, import.meta.url))));
const chunkOf = (zip: Uint8Array) => strFromU8(unzipSync(zip)['data/chunk0.xml']);
const buffer = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

/** The lines of the `<P>` whose opening line is `open`: itself if self-closed, else through its own `</P>`. */
function spanOf(xml: string, open: string): string {
  const from = xml.indexOf(open);
  expect(from, open).toBeGreaterThanOrEqual(0);
  const eol = xml.indexOf('\n', from);
  if (xml.slice(from, eol).endsWith('/>')) {
    return xml.slice(from, eol);
  }
  const indent = open.length - open.trimStart().length;
  const close = '\n' + ' '.repeat(indent) + '</P>';
  return xml.slice(from, xml.indexOf(close, from) + close.length);
}

/** The DD.ENTRY object named `name` in `xml`. */
function entryOf(xml: string, name: string): string {
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  expect(at, name).toBeGreaterThan(-1);
  const from = xml.lastIndexOf('    <Object Class="DD.ENTRY">', at);
  return xml.slice(from, xml.indexOf('\n    </Object>', at) + '\n    </Object>'.length);
}

const HOST_XML = chunkOf(bytesAt(HOST));
const GEAR_VALUE = spanOf(HOST_XML, '        <P Name="Value" IsEnum="1">');
const GEAR_ROW = spanOf(HOST_XML, '        <P Name="Value" IsEnum="1" Dimension="1*3">');
const MODE = spanOf(HOST_XML, '                <P Name="Mode" IsEnum="1">');

/** `lines`, re-indented so that the first sits at `indent` spaces. */
function indented(lines: string, indent: number): string {
  const all = lines.split('\n');
  const by = indent - (all[0].length - all[0].trimStart().length);
  return all.map((l) => (by >= 0 ? ' '.repeat(by) + l : l.slice(-by))).join('\n');
}

const EMPTY_ENTRY = '        <P Name="Value" IsEnum="1" Class="GearMode" Dimension="0*2"/>';
const MODES = '                <P Name="Modes" IsEnum="1" Class="GearMode" Dimension="0*2"/>';
const MODE_ROW = indented(GEAR_ROW, 16).replace('<P Name="Value"', '<P Name="ModeRow"');
const PARAM_VALUE = indented(GEAR_VALUE, 16);

/** A new DD.ENTRY named `name`, numbered `n`, whose Value is `value`. */
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

/** params.sldd's pInt16, a Simulink.Parameter, with its Value an enumeration value. */
function gearParamValue(): string {
  const pInt16 = entryOf(chunkOf(bytesAt(PARAMS)), 'pInt16');
  const value = pInt16.slice(pInt16.indexOf('        <P Name="Value">'), pInt16.lastIndexOf('\n    </Object>'));
  const int16 = '                <P Name="Value" Class="int16">5</P>';
  expect(value).toContain(int16);
  return value.replace(int16, PARAM_VALUE).replace('<P Name="DataType" Class="char">int16</P>', '<P Name="DataType" Class="char">Enum: GearMode</P>');
}

/** The host with the added entries and properties. */
function hostXml(): string {
  const tail = '    <Object Class="DD.Dictionary">';
  expect(HOST_XML).toContain(tail);
  const added = [entry('gearEmpty', 1, EMPTY_ENTRY), entry('gearParam', 2, gearParamValue())].join('\n') + '\n';
  return HOST_XML.replace(MODE, MODE + '\n' + MODES + '\n' + MODE_ROW).replace(tail, added + tail);
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

/** What a row shows: the row a host gets of it, and of each of its own rows. */
function shown(node: any): unknown {
  return {
    row: [node.className, node.displayValue, node.dims, node.valueEditable],
    members: (node.children || []).map((c: any) => [c.displayName, c.className, c.displayValue, c.dims, c.valueEditable]),
  };
}

/** Every value this file adds or reads, each as the node it opens as, and the span MATLAB wrote it as. */
type Site = { label: string; node: (root: any) => any; span: (xml: string) => string; expected: string };
const SITES: Site[] = [
  { label: 'a scalar entry', node: (r) => entryNode(r, 'gearValue'), span: (x) => spanOf(entryOf(x, 'gearValue'), '        <P Name="Value"'), expected: GEAR_VALUE },
  { label: 'a 1x3 entry', node: (r) => entryNode(r, 'gearRow'), span: (x) => spanOf(entryOf(x, 'gearRow'), '        <P Name="Value"'), expected: GEAR_ROW },
  { label: 'an empty entry', node: (r) => entryNode(r, 'gearEmpty'), span: (x) => spanOf(entryOf(x, 'gearEmpty'), '        <P Name="Value"'), expected: EMPTY_ENTRY },
  {
    label: "a Simulink.Parameter's Value",
    node: (r) => entryNode(r, 'gearParam'),
    span: (x) => spanOf(entryOf(x, 'gearParam'), '                <P Name="Value"'),
    expected: PARAM_VALUE,
  },
  { label: 'a scalar property', node: (r) => childOf(entryNode(r, 'widget'), 'Mode'), span: (x) => spanOf(entryOf(x, 'widget'), '                <P Name="Mode"'), expected: MODE },
  { label: 'an empty property', node: (r) => childOf(entryNode(r, 'widget'), 'Modes'), span: (x) => spanOf(entryOf(x, 'widget'), '                <P Name="Modes"'), expected: MODES },
  { label: 'a 1x3 property', node: (r) => childOf(entryNode(r, 'widget'), 'ModeRow'), span: (x) => spanOf(entryOf(x, 'widget'), '                <P Name="ModeRow"'), expected: MODE_ROW },
];

describe('an enumeration value at an entry or a property opens as its enumeral', () => {
  it('as the reader keeps it: IsEnum on the value, and each enumeral\'s name, type and value', () => {
    const entries: any[] = (parseBinarySlddParts(hostXml(), {}) as any).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const valueOf = (name: string) => entries.find((e) => e.name === name).value;
    const enumeral = (name: string, value: string) => ({ _properties: {}, _enumeration: { name, type: 'int32', value } });
    const scalar = { _array_class: 'GearMode', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [enumeral('Reverse', '-1')], _is_enum: '1' };
    const row = { ...scalar, _dimensions: [1, 3], _elements: [enumeral('Park', '0'), enumeral('Drive', '1'), enumeral('Reverse', '-1')] };
    const empty = { ...scalar, _dimensions: [0, 2], _elements: [] };
    const widget = valueOf('widget')._elements[0]._properties;
    expect([valueOf('gearValue'), valueOf('gearRow'), valueOf('gearEmpty')]).toEqual([scalar, row, empty]);
    expect([widget.Mode, widget.ModeRow, widget.Modes]).toEqual([scalar, row, empty]);
    expect(valueOf('gearParam')._elements[0]._properties.Value).toEqual(scalar);
  });

  it('and shows it, taking no editor, as one in a cell does', () => {
    const { root } = open(hostXml());
    const row = ['GearMode', '<1x3 GearMode>', [1, 3], false];
    const members = [
      ['(1)', 'GearMode', 'GearMode.Park', [1, 1], false],
      ['(2)', 'GearMode', 'GearMode.Drive', [1, 1], false],
      ['(3)', 'GearMode', 'GearMode.Reverse', [1, 1], false],
    ];
    const named = (prefix: string) => members.map(([n, ...rest]) => [prefix + n, ...rest]);
    expect(shown(entryNode(root, 'gearValue'))).toEqual({ row: ['GearMode', 'GearMode.Reverse', [1, 1], false], members: [] });
    expect(shown(entryNode(root, 'gearRow'))).toEqual({ row, members: named('gearRow') });
    expect(shown(entryNode(root, 'gearEmpty'))).toEqual({ row: ['GearMode', '<0x2 GearMode>', [0, 2], false], members: [] });
    const widget = entryNode(root, 'widget');
    expect(shown(childOf(widget, 'Mode'))).toEqual({ row: ['GearMode', 'GearMode.Reverse', [1, 1], false], members: [] });
    expect(shown(childOf(widget, 'ModeRow'))).toEqual({ row, members: named('ModeRow') });
    expect(shown(childOf(widget, 'Modes'))).toEqual({ row: ['GearMode', '<0x2 GearMode>', [0, 2], false], members: [] });
    // An enumeration value has no Description in the file to hold one.
    for (const name of ['gearValue', 'gearRow', 'gearEmpty']) {
      expect(entryNode(root, name).descriptionEditable, name).toBe(false);
    }
    // A Parameter shows its Value as its own; an enumeral is not text that reads back as one.
    const param = entryNode(root, 'gearParam');
    expect([param.className, param.displayValue, param.valueEditable]).toEqual(['Simulink.Parameter', 'GearMode.Reverse', false]);
  });

  it('in the dictionaries MATLAB wrote with one at a property', () => {
    const { root } = open(chunkOf(bytesAt(DERIVED)), DERIVED);
    expect(shown(childOf(entryNode(root, 'dpGain'), 'Mode'))).toEqual({ row: ['GearMode', 'GearMode.Reverse', [1, 1], false], members: [] });
    expect(shown(childOf(entryNode(root, 'dpPlain'), 'Mode'))).toEqual({ row: ['GearMode', 'GearMode.Drive', [1, 1], false], members: [] });
  });

  it('and a value typed into one is refused, since nothing here writes an enumeration value', () => {
    const { root } = open(hostXml());
    for (const name of ['gearValue', 'gearRow', 'gearEmpty']) {
      const node = entryNode(root, name);
      expect(node.setProperty('Value', '[1 2 3]'), name).toMatchObject({ error: true });
    }
    const mode = childOf(entryNode(root, 'widget'), 'Mode');
    expect(mode.setProperty('Value', 'GearMode.Reverse')).toMatchObject({ error: true });
  });

  it("and so is one typed into a Simulink.Parameter's Value that is one: nothing changes, and nothing is left to undo", () => {
    // The Parameter takes no editor for it, but the edit was taken anyway: `2` replaced the
    // enumeral with a double, an undo did not put it back, and the save wrote `Class="double">2.0`.
    const { session, root } = open(hostXml());
    const param = entryNode(root, 'gearParam');
    // The writer is asked as well as the save, which writes an unedited entry as its own bytes.
    const now = () => ({
      shown: [param.displayValue, param.valueEditable],
      saved: spanOf(entryOf(chunkOf(session.serializeSource(root.name)!.bytes!), 'gearParam'), '                <P Name="Value"'),
      written: spanOf(entryOf(regenerateChunkXml(root), 'gearParam'), '                <P Name="Value"'),
    });
    const before = now();
    expect(before).toEqual({ shown: ['GearMode.Reverse', false], saved: PARAM_VALUE, written: PARAM_VALUE });
    session.setActive(root, param);
    expect(session.editProperty(param.id, 'Value', '2')).toMatchObject({ error: true });
    expect(param.setProperty('Value', 'GearMode.Drive')).toMatchObject({ error: true });
    expect(now()).toEqual(before);
    expect(session.canUndo()).toBe(false);
  });
});

type Edit = 'untouched' | 'with another property edited' | 'renamed';
const EDITS: Edit[] = ['untouched', 'with another property edited', 'renamed'];

describe('and is saved as MATLAB wrote it', () => {
  for (const edit of EDITS) {
    it(edit, () => {
      const first = open(hostXml());
      const before = SITES.map((s) => shown(s.node(first.root)));
      if (edit === 'with another property edited') {
        expect(childOf(entryNode(first.root, 'widget'), 'Scalar').setProperty('Value', '2.5')).toBe(true);
        expect(entryNode(first.root, 'gearParam').setProperty('Description', 'edited')).toBe(true);
      }
      const renames: [string, string][] = edit === 'renamed' ? [['gearValue', 'gearValue2'], ['gearRow', 'gearRow2'], ['gearEmpty', 'gearEmpty2'], ['gearParam', 'gearParam2'], ['widget', 'widget2']] : [];
      for (const [from, to] of renames) {
        expect(entryNode(first.root, from).setProperty('Name', to)).toBe(true);
      }
      const saved = chunkOf(first.session.serializeSource(first.root.name)!.bytes!);
      const named = (xml: string) => renames.reduce((x, [from, to]) => x.replace('<P Name="Name" Class="char">' + to + '</P>', '<P Name="Name" Class="char">' + from + '</P>'), xml);
      const back = named(saved);
      // A save writes an unedited entry as its own bytes, so the writer is asked too, from the model.
      const regenerated = named(regenerateChunkXml(first.root));
      for (const site of SITES) {
        expect(site.span(back), site.label).toBe(site.expected);
        expect(site.span(regenerated), `${site.label}, written from the model`).toBe(site.expected);
      }
      // And reopened, it is the value that was saved.
      const again = open(back);
      expect(SITES.map((s) => shown(s.node(again.root)))).toEqual(before);
    });
  }

  it('in the dictionaries MATLAB wrote with one at a property, untouched', () => {
    const xml = chunkOf(bytesAt(DERIVED));
    const { session, root } = open(xml, DERIVED);
    const saved = chunkOf(session.serializeSource(root.name)!.bytes!);
    const regenerated = regenerateChunkXml(root);
    for (const name of ['dpGain', 'dpPlain']) {
      const modeOpen = '                <P Name="Mode" IsEnum="1">';
      expect(spanOf(entryOf(saved, name), modeOpen), name).toBe(spanOf(entryOf(xml, name), modeOpen));
      expect(spanOf(entryOf(regenerated, name), modeOpen), `${name}, written from the model`).toBe(spanOf(entryOf(xml, name), modeOpen));
    }
  });

  it('and so is a copy of it pasted into a binary dictionary', () => {
    const { session, root } = open(hostXml());
    const design = root.getSection('design');
    SITES.slice(0, 4).forEach((site, k) => {
      const payload: any = JSON.parse(JSON.stringify(site.node(root).serialize()));
      payload.name = payload.name + 'Copy';
      payload.metadata = { ...payload.metadata, uuid: '00000000-0000-4000-9000-' + String(k + 1).padStart(12, '0') };
      design.parseEntry(payload);
    });
    const saved = chunkOf(session.serializeSource(root.name)!.bytes!);
    expect(spanOf(entryOf(saved, 'gearValueCopy'), '        <P Name="Value"')).toBe(GEAR_VALUE);
    expect(spanOf(entryOf(saved, 'gearRowCopy'), '        <P Name="Value"')).toBe(GEAR_ROW);
    expect(spanOf(entryOf(saved, 'gearEmptyCopy'), '        <P Name="Value"')).toBe(EMPTY_ENTRY);
    expect(spanOf(entryOf(saved, 'gearParamCopy'), '                <P Name="Value"')).toBe(PARAM_VALUE);
  });

  it('and pasted into a text dictionary, it is written as MATLAB writes it there, an empty one as before', () => {
    // A text dictionary spells an enumeration value as one element holding the numbers its
    // enumerals stand for, in their class, under `_enum_value`, in a bag that is 1x1 whatever
    // the value's size (MatWriter.enumTextForm): custom_object_text.sldd, this fixture's twin,
    // holds gearValue, gearRow and widget.Mode so, with an `_id` on each element, which this
    // package writes on no object. How it spells an empty one waits on MATLAB reading one back,
    // so that is what it was before: `[]` at an entry and '' at a property.
    const { session, txt } = pasteIntoText(['gearValue', 'gearRow', 'gearEmpty', 'gearParam', 'widget']);
    const text = session.serializeSource(txt.name)!.text!;
    const valueOf = (name: string) => textEntries(text).find((e) => e.name === name).value;
    const twin = (name: string) => withoutId(textEntries(strFromU8(bytesAt(TEXT_HOST))).find((e) => e.name === name).value);
    const scalar = { _array_class: 'GearMode', _dimensions: [1, 1], _elements: [{ _enum_value: { _type: 'int32', _value: '-1' } }], _mw_element_type: 'MATLABArray' };
    const row = { ...scalar, _elements: [{ _enum_value: { _type: 'int32', _value: '[0, 1, -1]' } }] };
    expect(valueOf('gearValueCopy')).toEqual(scalar);
    expect(valueOf('gearRowCopy')).toEqual(row);
    expect([twin('gearValue'), twin('gearRow')]).toEqual([scalar, row]);
    expect(JSON.stringify(valueOf('gearValueCopy'))).toBe(JSON.stringify(twin('gearValue')));
    expect(valueOf('gearEmptyCopy')).toEqual([]);
    expect(valueOf('gearParamCopy')._elements[0]._properties.Value).toEqual(scalar);
    const widget = valueOf('widgetCopy')._elements[0]._properties;
    expect([widget.Mode, widget.ModeRow, widget.Modes]).toEqual([scalar, row, '']);
    // MATLAB writes the element alone at a property, which names the same value.
    expect(twin('widget')._elements[0]._properties.Mode).toEqual({ _enum_value: scalar._elements[0]._enum_value, _object_class: 'GearMode' });
    expect(text).not.toMatch(/_is_enum|_enumeration/);
  });

  it('and one that is not a row, or has more than two dimensions, as MATLAB spells it there', () => {
    // A column as a typed column of its numbers, as a customer dictionary's text twin holds a
    // 7x1 of uint8 enumerals; past two dimensions, MATLAB's MAT stream of them, which is
    // MATLAB's own bytes for dNJSON_SLDDApi.sldd's matEnum3D, the text twin of
    // dSLDD_JSONApi.sldd's eight enumerals below.
    const enumeral = (cls: string, name: string, type: string, value: string) =>
      `            <Element Class="${cls}" EnumerationName="${name}" EnumerationType="${type}">${value}</Element>`;
    const column = ['        <P Name="Value" IsEnum="1" Dimension="7*1">', ...Array.from({ length: 7 }, () => enumeral('ShiftMode', 'Off', 'uint8', '0')), '        </P>'].join('\n');
    const nd = [
      '        <P Name="Value" IsEnum="1" Dimension="2*2*2">',
      ...[['Red', '0'], ['Blue', '2'], ['Yellow', '1'], ['Red', '0'], ['Blue', '2'], ['Red', '0'], ['BONUS', '10'], ['Yellow', '1']].map(([n, v]) => enumeral('dSomeColors', n, 'int32', v)),
      '        </P>',
    ].join('\n');
    const tail = '    <Object Class="DD.Dictionary">';
    const xml = HOST_XML.replace(tail, [entry('enumColumn', 11, column), entry('matEnum3D', 12, nd)].join('\n') + '\n' + tail);
    const { session, txt } = pasteIntoText(['enumColumn', 'matEnum3D'], xml);
    const valueOf = (name: string) => textEntries(session.serializeSource(txt.name)!.text!).find((e) => e.name === name).value;
    expect(valueOf('enumColumnCopy')).toEqual({
      _array_class: 'ShiftMode',
      _dimensions: [1, 1],
      _elements: [{ _enum_value: { _type: 'uint8', _value: 'Matrix(7,1)\n[0U, 0U, 0U, 0U, 0U, 0U, 0U]' } }],
      _mw_element_type: 'MATLABArray',
    });
    expect(valueOf('matEnum3DCopy')).toEqual({ _array_class: 'dSomeColors', _dimensions: [1, 1], _elements: [{ _enum_value: { _type: 'cdata', _value: MATLAB_ENUM_3D } }], _mw_element_type: 'MATLABArray' });
  });

  it('and pasted into a text dictionary, it shows what the save writes and a reopen reads', () => {
    // Held as the binary reader holds it, the pasted value showed its enumeral, which the
    // text form does not name, so the same entry showed `<1x1 GearMode>` once saved and reopened.
    const names = ['gearValue', 'gearRow', 'gearEmpty', 'gearParam', 'widget'];
    const { session, txt } = pasteIntoText(names);
    const design = txt.getSection('design');
    const pasted = names.map((name) => tree(design.children.find((e: any) => e.name === name + 'Copy')));
    const again: any = ingest(createSession(), buffer(strToU8(session.serializeSource(txt.name)!.text!)), { filename: 'reopened_text.sldd' });
    const reopened = names.map((name) => tree(again.getSection('design').children.find((e: any) => e.name === name + 'Copy')));
    expect(pasted).toEqual(reopened);
    expect(pasted[0]).toEqual([['gearValueCopy', 'GearMode', '<1x1 GearMode>', [1, 1], false]]);
  });

  it('and one a text dictionary holds itself, copied out of it and pasted back or re-read from its text, shows and is saved as the original', () => {
    // What changes on the way into a text dictionary is what the binary reader says is its own
    // (XmlUtils.ENUM_KEY). MATLAB's spelling there goes as it came: custom_object_text.sldd's
    // gearValue, gearRow and widget.Mode, each with the `_id` MATLAB stamps, its spelling of an
    // empty one, `{_type: 'GearMode', _value: '[]'}` (dNJSON_SLDDApi.sldd's matEmptyEnum
    // entries), and of a 2x2x2, the MAT stream of matEnum3D.
    const json = JSON.parse(strFromU8(bytesAt(TEXT_HOST)));
    const entries: any[] = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const like = (name: string, n: number, value: unknown) => {
      const e = JSON.parse(JSON.stringify(entries.find((x) => x.name === 'gearValue')));
      return { ...e, name, metadata: { ...e.metadata, uuid: '00000000-0000-4000-b000-' + String(n).padStart(12, '0') }, value };
    };
    entries.push(like('gearEmpty', 1, { _type: 'GearMode', _value: '[]' }));
    entries.push(like('matEnum3D', 2, { _array_class: 'dSomeColors', _dimensions: [1, 1], _elements: [{ _enum_value: { _type: 'cdata', _value: MATLAB_ENUM_3D }, _id: '1' }], _mw_element_type: 'MATLABArray' }));
    const session = createSession();
    const txt: any = ingest(session, buffer(strToU8(JSON.stringify(json, null, '\t'))), { filename: 'custom_object_text.sldd' });
    const design = txt.getSection('design');
    const names = ['gearValue', 'gearRow', 'gearEmpty', 'matEnum3D', 'widget'];
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
    const savedAs = (name: string) => JSON.stringify(textEntries(text).find((e) => e.name === name).value, null, '\t');
    for (const name of names) {
      expect([savedAs(name + 'Copy'), savedAs(name + 'Sync')], name).toEqual([savedAs(name), savedAs(name)]);
    }
    expect(JSON.parse(savedAs('gearEmpty'))).toEqual({ _type: 'GearMode', _value: '[]' });
    expect(JSON.parse(savedAs('gearValue'))._elements).toEqual([{ _enum_value: { _type: 'int32', _value: '-1' }, _id: '1' }]);
  });
});

/** MATLAB's MAT stream of int32 [0 1; 2 0] and [2 10; 0 1], a 2x2x2, as its text dictionary holds it: dNJSON_SLDDApi.sldd's matEnum3D. */
const MATLAB_ENUM_3D =
  '  %)30     .    6     8    (    #          %    #     (    "     @         !          4    @          (    !          (         "@    $    \u0000\u0000';

/** The entries of a text dictionary's `text`. */
const textEntries = (text: string): any[] => JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;

/** `value` with every `_id` MATLAB stamps on an object gone. */
function withoutId(value: any): any {
  if (Array.isArray(value)) {
    return value.map(withoutId);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== '_id').map(([k, v]) => [k, withoutId(v)]));
}

/** Each of `names` copied out of the binary host and pasted into the text one, as `<name>Copy`. */
function pasteIntoText(names: string[], xml = hostXml()): { session: ReturnType<typeof createSession>; txt: any } {
  const session = createSession();
  const bin: any = ingest(session, buffer(zipSync({ ...unzipSync(bytesAt(HOST)), 'data/chunk0.xml': strToU8(xml) })), { filename: 'custom_object_binary.sldd' });
  const txt: any = ingest(session, buffer(bytesAt(TEXT_HOST)), { filename: 'custom_object_text.sldd' });
  const design = txt.getSection('design');
  names.forEach((name, k) => {
    const payload: any = JSON.parse(JSON.stringify(entryNode(bin, name).serialize()));
    payload.name = name + 'Copy';
    payload.metadata = { ...design.children[0].metadata, uuid: '00000000-0000-4000-a000-' + String(k + 1).padStart(12, '0') };
    design.parseEntry(payload);
  });
  return { session, txt };
}

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
