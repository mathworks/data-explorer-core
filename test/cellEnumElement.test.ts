// Copyright 2026 The MathWorks, Inc.
//
// An enumeration value in a cell of a binary dictionary keeps its value.
//
// MATLAB states an enumeration value as `<P Name="Mode" IsEnum="1">` around one `<Element
// Class="GearMode" EnumerationName="Reverse" EnumerationType="int32">-1</Element>` per
// enumeral. BinarySlddParser.parseCellElement never asked for IsEnum, so in a cell the wrapper
// read as a classless object holder and its element as an object of class GearMode with no
// properties: the name, the type and the value were gone at the read. The member showed `<1x1
// GearMode>`, and every save of the dictionary wrote `<Element><Element Class="GearMode"/>
// </Element>` in its place, an untouched save included.
//
// No dictionary MATLAB wrote holds an enumeration in a cell: none of the fixtures, the parity
// artifacts or the local corpus. So the ground truth is MATLAB's own spelling of the same
// values one level up, moved into a cell the way MATLAB moves an object into one:
// custom_object_binary.sldd's widget.Part is `<P Name="Part">` around `<Element
// Class="WidgetPart">`, and its partCell holds the same object as a cell element, `<Element>`
// around the same `<Element Class="WidgetPart">`. The `<P>` loses its Name and keeps the rest.
// The values moved are widget.Mode, a scalar, and gearRow's 1x3 Value; the empty is MATLAB's
// spelling of an empty enumeration entry (`<P Name="Value" IsEnum="1" Class="dSomeColors"
// Dimension="0*2"/>`, test/undoRestoresValue.test.ts), moved the same way, of GearMode.
//
// An enumeration entry or object property reads the same way (the last describe pins that;
// test/enumEntryProperty.test.ts has the rest of it).
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
const TEXT_HOST = './fixtures/custom_object_text.sldd';

const bytesAt = (rel: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(rel, import.meta.url))));
const chunkOf = (zip: Uint8Array) => strFromU8(unzipSync(zip)['data/chunk0.xml']);
const buffer = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const HOST_XML = chunkOf(bytesAt(HOST));

/** The span of the `<P>` whose opening line is `open`, through its own closing line. */
function spanOf(xml: string, open: string): string {
  const from = xml.indexOf(open + '\n');
  expect(from, open).toBeGreaterThanOrEqual(0);
  const indent = open.length - open.trimStart().length;
  const close = '\n' + ' '.repeat(indent) + '</P>';
  return xml.slice(from, xml.indexOf(close, from) + close.length);
}

/** `lines`, re-indented so that the first sits at `indent` spaces. */
function indented(lines: string, indent: number): string {
  const all = lines.split('\n');
  const by = indent - (all[0].length - all[0].trimStart().length);
  return all.map((l) => (by >= 0 ? ' '.repeat(by) + l : l.slice(-by))).join('\n');
}

/** A `<P>` MATLAB wrote, as the cell element it is in a cell: its Name gone, at 12 spaces. */
function asCellElement(p: string): string {
  const lines = p.split('\n');
  lines[0] = lines[0].replace(/<P Name="[^"]*"/, '<Element');
  lines[lines.length - 1] = lines[lines.length - 1].replace('</P>', '</Element>');
  return indented(lines.join('\n'), 12);
}

const SCALAR = asCellElement(spanOf(HOST_XML, '                <P Name="Mode" IsEnum="1">'));
const ROW = asCellElement(spanOf(HOST_XML, '        <P Name="Value" IsEnum="1" Dimension="1*3">'));
const EMPTY = '            <Element IsEnum="1" Class="GearMode" Dimension="0*2"/>';
const DOUBLE = '            <Element Class="double">1.0</Element>';
const EDITED = '<Element Class="double">42.0</Element>';

const HOST_CELLS =
  '                <P Name="Cells" Class="cell" Dimension="1*3">\n' +
  '                    <Element Class="double">1.0</Element>\n' +
  '                    <Element Class="char">two</Element>\n' +
  '                    <Element Class="logical">1</Element>\n' +
  '                </P>';
const HOST_NESTED_LEAF = '                                <P Name="leaf" Class="double">7.0</P>';
const HOST_PART_CELL = spanOf(HOST_XML, '        <P Name="Value" Class="cell" Dimension="2*2">');

/** A cell `<P>` named `name` at `indent` spaces holding `elements`, each lifted from 12 spaces. */
function cellP(name: string, elements: string[], indent: number): string {
  const p = ' '.repeat(indent);
  return (
    p + '<P Name="' + name + '" Class="cell" Dimension="1*' + elements.length + '">\n' +
    elements.map((e) => indented(e, indent + 4)).join('\n') + '\n' +
    p + '</P>'
  );
}

type Venue = { label: string; name: string; indent: number; build: (xml: string, elements: string[]) => string; cell: (root: any) => any };
const widgetOf = (root: any) => flatten(root).find((n: any) => n?.isEntry && n.name === 'widget');
const VENUES: Venue[] = [
  {
    label: 'an object property',
    name: 'Cells',
    indent: 16,
    build: (xml, elements) => {
      expect(xml).toContain(HOST_CELLS);
      return xml.replace(HOST_CELLS, cellP('Cells', elements, 16));
    },
    cell: (root) => flatten(widgetOf(root)).find((n: any) => n.name === 'Cells'),
  },
  {
    label: 'a struct field of an object property',
    name: 'c',
    indent: 32,
    build: (xml, elements) => {
      expect(xml).toContain(HOST_NESTED_LEAF);
      return xml.replace(HOST_NESTED_LEAF, HOST_NESTED_LEAF + '\n' + cellP('c', elements, 32));
    },
    cell: (root) => flatten(widgetOf(root)).find((n: any) => n.name === 'c'),
  },
  {
    label: "an entry's Value",
    name: 'Value',
    indent: 8,
    build: (xml, elements) => xml.replace(HOST_PART_CELL, cellP('Value', elements, 8)),
    cell: (root) => flatten(root).find((n: any) => n?.isEntry && n.name === 'partCell'),
  },
];

function open(chunk: string): { session: ReturnType<typeof createSession>; root: any } {
  const files = unzipSync(bytesAt(HOST));
  files['data/chunk0.xml'] = strToU8(chunk);
  const session = createSession();
  const root: any = ingest(session, buffer(zipSync(files)), { filename: 'custom_object_binary.sldd' });
  return { session, root };
}

/** The direct `<Element>` children of the `<P>` whose lines are `lines`, each as the lines it spans. */
function childElements(lines: string[]): string[] {
  const indent = ' '.repeat(lines[0].length - lines[0].trimStart().length + 4);
  const out: string[] = [];
  for (let i = 1; i < lines.length - 1; i++) {
    const start = i;
    if (!/(\/>|<\/Element>)$/.test(lines[i])) {
      while (lines[i] !== indent + '</Element>') {
        i++;
      }
    }
    out.push(lines.slice(start, i + 1).join('\n'));
  }
  return out;
}

/** What a member shows: the row a host gets of it, and of each of its own rows. */
function shown(node: any): unknown {
  return {
    row: [node.displayName, node.className, node.displayValue, node.dims, node.valueEditable],
    members: (node.children || []).map((c: any) => [c.displayName, c.className, c.displayValue, c.dims, c.valueEditable]),
  };
}

const CELL = [DOUBLE, SCALAR, ROW, EMPTY];

describe('an enumeration value in a cell opens as its enumeral', () => {
  it('lifts MATLAB elements of the three shapes', () => {
    expect(SCALAR).toBe(
      '            <Element IsEnum="1">\n' +
        '                <Element Class="GearMode" EnumerationName="Reverse" EnumerationType="int32">-1</Element>\n' +
        '            </Element>',
    );
    expect(ROW.split('\n')[0]).toBe('            <Element IsEnum="1" Dimension="1*3">');
    expect(ROW.split('\n').length).toBe(5);
  });

  for (const venue of VENUES) {
    it(`in ${venue.label}`, () => {
      const { root } = open(venue.build(HOST_XML, CELL));
      const cell = venue.cell(root);
      const [, scalar, row, empty] = cell.children;
      const at = (k: number) => cell.children[k].displayName;
      expect(shown(scalar)).toEqual({ row: [at(1), 'GearMode', 'GearMode.Reverse', [1, 1], false], members: [] });
      expect(shown(row)).toEqual({
        row: [at(2), 'GearMode', '<1x3 GearMode>', [1, 3], false],
        members: [
          [at(2) + '(1)', 'GearMode', 'GearMode.Park', [1, 1], false],
          [at(2) + '(2)', 'GearMode', 'GearMode.Drive', [1, 1], false],
          [at(2) + '(3)', 'GearMode', 'GearMode.Reverse', [1, 1], false],
        ],
      });
      expect(shown(empty)).toEqual({ row: [at(3), 'GearMode', '<0x2 GearMode>', [0, 2], false], members: [] });
      expect(cell.displayValue).toBe('{1, GearMode.Reverse, <1x3 GearMode>, <0x2 GearMode>}');
    });
  }

  it('whatever its class is called', () => {
    // `Constant` is a class this package has a node of its own for, and a name an enumeration
    // class can have; that node knows nothing of enumerals.
    const constant = SCALAR.replace('Class="GearMode"', 'Class="Constant"');
    const { session, root } = open(VENUES[0].build(HOST_XML, [DOUBLE, constant]));
    const member = VENUES[0].cell(root).children[1];
    expect([member.className, member.displayValue, member.valueEditable]).toEqual(['Constant', 'Constant.Reverse', false]);
    const saved = chunkOf(session.serializeSource(root.name)!.bytes!);
    expect(saved).toContain(cellP('Cells', [DOUBLE, constant], 16));
    // A save writes an unedited entry's own bytes; the writer writes the same from the model.
    expect(regenerateChunkXml(root)).toContain(cellP('Cells', [DOUBLE, constant], 16));
  });

  it('and a cell whose literal shows one takes no editor, since the literal would read back as text', () => {
    // `{1, GearMode.Reverse}` holds no summary, so only the enumeral stands between it and an
    // editor whose unchanged commit reads `GearMode.Reverse` back as a char.
    const { session, root } = open(VENUES[0].build(HOST_XML, [DOUBLE, SCALAR]));
    const cell = VENUES[0].cell(root);
    expect(cell.displayValue).toBe('{1, GearMode.Reverse}');
    expect(cell.valueEditable).toBe(false);
    expect(cell.setProperty('Value', cell.displayValue)).toMatchObject({ error: true });
    const saved = chunkOf(session.serializeSource(root.name)!.bytes!);
    expect(saved).toContain(cellP('Cells', [DOUBLE, SCALAR], 16));
    expect(regenerateChunkXml(root)).toContain(cellP('Cells', [DOUBLE, SCALAR], 16));
  });
});

type Edit = 'untouched' | 'with another property edited' | 'with one of its elements edited';
const EDITS: Edit[] = ['untouched', 'with another property edited', 'with one of its elements edited'];

describe('and is saved as MATLAB wrote it', () => {
  for (const venue of VENUES) {
    for (const edit of EDITS) {
      it(`in ${venue.label}, ${edit}`, () => {
        const chunk = venue.build(HOST_XML, CELL);
        const first = open(chunk);
        const expected = CELL.map((e) => indented(e, venue.indent + 4));
        if (edit === 'with another property edited') {
          const scalar = widgetOf(first.root).children.find((c: any) => c.name === 'Scalar');
          expect(scalar.setProperty('Value', '2.5')).toBe(true);
        }
        if (edit === 'with one of its elements edited') {
          expect(venue.cell(first.root).children[0].setProperty('Value', '42')).toBe(true);
          expected[0] = ' '.repeat(venue.indent + 4) + EDITED;
        }
        const before = shown(venue.cell(first.root));
        const raw = venue.cell(first.root).serializeValue();
        const saved = chunkOf(first.session.serializeSource(first.root.name)!.bytes!);
        const back = spanOf(saved, ' '.repeat(venue.indent) + '<P Name="' + venue.name + '" Class="cell" Dimension="1*' + CELL.length + '">');
        expect(childElements(back.split('\n'))).toEqual(expected);
        // And as the writer writes it from the model, which is what a save of an unedited
        // entry no longer asks it for.
        const regenerated = spanOf(regenerateChunkXml(first.root), ' '.repeat(venue.indent) + '<P Name="' + venue.name + '" Class="cell" Dimension="1*' + CELL.length + '">');
        expect(childElements(regenerated.split('\n')), 'written from the model').toEqual(expected);
        // And reopened, it is the value that was saved.
        const again = open(saved);
        expect(shown(venue.cell(again.root))).toEqual(before);
        expect(venue.cell(again.root).serializeValue()).toEqual(raw);
      });
    }
  }

  it('and so is a copy of it pasted into a binary dictionary', () => {
    const { session, root } = open(VENUES[0].build(HOST_XML, CELL));
    const payload: any = JSON.parse(JSON.stringify(widgetOf(root).serialize()));
    payload.name = 'widgetCopy';
    payload.metadata = { ...payload.metadata, uuid: '00000000-0000-4000-8000-000000000001' };
    root.getSection('design').parseEntry(payload);
    const saved = chunkOf(session.serializeSource(root.name)!.bytes!);
    const copy = saved.slice(saved.indexOf('<P Name="Name" Class="char">widgetCopy</P>'));
    expect(copy).toContain(cellP('Cells', CELL, 16));
  });

  it('and pasted into a text dictionary, it is written as MATLAB writes one there, with no key a text dictionary has no reader for', () => {
    // A text dictionary spells an enumeration value as one element holding the numbers its
    // enumerals stand for, under `_enum_value`, in a 1x1 bag (MatWriter.enumTextForm), as
    // custom_object_text.sldd holds gearValue and gearRow. An empty one is its class under the
    // header of its extents, which MATLAB reads back in a cell as the 0x2 it is, where the bag it
    // was written as before was not a spelling MATLAB was asked about (MatWriter.heldTextSpelling,
    // test/textEmptyReadback.test.ts).
    const session = createSession();
    const bin: any = ingest(session, buffer(zipSync({ ...unzipSync(bytesAt(HOST)), 'data/chunk0.xml': strToU8(VENUES[0].build(HOST_XML, CELL)) })), { filename: 'custom_object_binary.sldd' });
    const txt: any = ingest(session, buffer(bytesAt(TEXT_HOST)), { filename: 'custom_object_text.sldd' });
    const design = txt.getSection('design');
    const payload: any = JSON.parse(JSON.stringify(widgetOf(bin).serialize()));
    payload.name = 'widgetCopy';
    payload.metadata = { ...design.children[0].metadata, uuid: '00000000-0000-4000-8000-000000000002' };
    design.parseEntry(payload);
    const text = session.serializeSource(txt.name)!.text!;
    const entries: any[] = JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const cells = entries.find((e) => e.name === 'widgetCopy').value._elements[0]._properties.Cells;
    const enumValue = (value: string) => ({ _array_class: 'GearMode', _dimensions: [1, 1], _elements: [{ _enum_value: { _type: 'int32', _value: value } }], _mw_element_type: 'MATLABArray' });
    expect(cells._elements.slice(1)).toEqual([enumValue('-1'), enumValue('[0, 1, -1]'), { _type: 'GearMode', _value: 'Matrix(0,2)' }]);
    expect(JSON.stringify(cells)).not.toMatch(/_is_enum|_enumeration/);
  });
});

describe('the parsed cell element keeps what MATLAB wrote', () => {
  /** The decoded value of entry `name` in `xml`. */
  const valueOf = (xml: string, name: string): any =>
    (parseBinarySlddParts(xml, {}) as any).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find(
      (e: any) => e.name === name,
    ).value;

  it('IsEnum on the element, and each enumeral\'s name, type and value', () => {
    const cells = valueOf(VENUES[0].build(HOST_XML, CELL), 'widget')._elements[0]._properties.Cells;
    expect(cells._elements.slice(1)).toEqual([
      {
        _array_class: 'GearMode',
        _dimensions: [1, 1],
        _mw_element_type: 'MATLABArray',
        _elements: [{ _properties: {}, _enumeration: { name: 'Reverse', type: 'int32', value: '-1' } }],
        _is_enum: '1',
      },
      {
        _array_class: 'GearMode',
        _dimensions: [1, 3],
        _mw_element_type: 'MATLABArray',
        _elements: [
          { _properties: {}, _enumeration: { name: 'Park', type: 'int32', value: '0' } },
          { _properties: {}, _enumeration: { name: 'Drive', type: 'int32', value: '1' } },
          { _properties: {}, _enumeration: { name: 'Reverse', type: 'int32', value: '-1' } },
        ],
        _is_enum: '1',
      },
      { _array_class: 'GearMode', _dimensions: [0, 2], _mw_element_type: 'MATLABArray', _elements: [], _is_enum: '1' },
    ]);
  });

  it('and an enumeration entry or object property reads as one in a cell does', () => {
    const [, scalar, row] = valueOf(VENUES[0].build(HOST_XML, CELL), 'widget')._elements[0]._properties.Cells._elements;
    expect(valueOf(HOST_XML, 'gearValue')).toEqual(scalar);
    expect(valueOf(HOST_XML, 'widget')._elements[0]._properties.Mode).toEqual(scalar);
    expect(valueOf(HOST_XML, 'gearRow')).toEqual(row);
  });
});
