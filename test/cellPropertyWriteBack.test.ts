// Copyright 2026 The MathWorks, Inc.
//
// A cell that is an object's PROPERTY (or a struct field) is written from its raw value by
// DataNode._serializeCellElementXml, one element at a time, on every save of a binary
// dictionary: an untouched one, and one that edited any other property of the object. That
// writer knew numbers, booleans, chars, flat numeric rows, typed scalars and vectors,
// complex text and encoded streams, and nothing else. Every other shape the reader hands it
// (BinarySlddParser.parseCellElement) went out wrong: a nested cell, a struct and an object
// as `<Element Class="char">[object Object]</Element>`, a 2x2 double as `0.0`, a 2x2 int8
// as `0`, a string as `Class="double"` with the text as its body.
//
// The ground truth here is MATLAB's own spelling of each element. A cell element is read by
// the same parseCellElement wherever the cell sits, so the elements of every entry-level
// cell in four dictionaries MATLAB wrote are lifted, unchanged but for their indent, into an
// object property of a fifth (custom_object_binary.sldd's widget.Cells) and into a struct
// field of it. Saved, the cell must come back as MATLAB's bytes, and reopened, as the same
// values.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, ingest } from '../src/index.js';
import { regenerateChunkXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { flatten } from './parity/loadFile.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const HOST = './fixtures/custom_object_binary.sldd';
const SOURCES = [
  './fixtures/cellarr_binary.sldd',
  './fixtures/cellstr_binary.sldd',
  './fixtures/typed_binary.sldd',
  './parity/artifacts/binary/cases.sldd',
];

const bytesAt = (rel: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(rel, import.meta.url))));
const chunkOf = (zip: Uint8Array) => strFromU8(unzipSync(zip)['data/chunk0.xml']);
const buffer = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

/**
 * The direct `<Element>` children of the `<P>` whose lines are `lines` (its opening line
 * first, its closing line last), each as the lines it spans. Its elements sit 4 spaces in.
 */
function childElements(lines: string[]): string[] {
  const indent = ' '.repeat(lines[0].length - lines[0].trimStart().length + 4);
  const out: string[] = [];
  for (let i = 1; i < lines.length - 1; i++) {
    expect(lines[i].startsWith(indent + '<Element'), lines[i]).toBe(true);
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

/** Every element of every entry-level cell Value in `xml`, named by its entry. */
function entryCellElements(xml: string): { entry: string; element: string }[] {
  const out: { entry: string; element: string }[] = [];
  const lines = xml.split('\n');
  let entry = '';
  for (let i = 0; i < lines.length; i++) {
    const name = /^ {8}<P Name="Name" Class="char">([^<]*)<\/P>$/.exec(lines[i]);
    if (name) {
      entry = name[1];
    }
    if (/^ {8}<P Name="Value" Class="cell"[^/]*>$/.test(lines[i])) {
      const end = lines.indexOf('        </P>', i);
      out.push(...childElements(lines.slice(i, end + 1)).map((element) => ({ entry, element })));
      i = end;
    }
  }
  return out;
}

const MATLAB_ELEMENTS = SOURCES.flatMap((rel) =>
  entryCellElements(chunkOf(bytesAt(rel))).map((e) => ({ ...e, entry: rel.split('/').pop() + ' ' + e.entry })),
);

/** `lines`, `by` spaces deeper. */
const deeper = (lines: string, by: number) =>
  lines
    .split('\n')
    .map((l) => ' '.repeat(by) + l)
    .join('\n');

const HOST_CELLS =
  '                <P Name="Cells" Class="cell" Dimension="1*3">\n' +
  '                    <Element Class="double">1.0</Element>\n' +
  '                    <Element Class="char">two</Element>\n' +
  '                    <Element Class="logical">1</Element>\n' +
  '                </P>';
const HOST_NESTED_LEAF = '                                <P Name="leaf" Class="double">7.0</P>';

/** A cell property at `indent` spaces holding `elements`, each lifted from 12 spaces. */
function cellProperty(name: string, elements: string[], indent: number): string {
  const p = ' '.repeat(indent);
  return (
    p + '<P Name="' + name + '" Class="cell" Dimension="1*' + elements.length + '">\n' +
    elements.map((e) => deeper(e, indent + 4 - 12)).join('\n') + '\n' +
    p + '</P>'
  );
}

type Venue = { label: string; name: string; indent: number; build: (xml: string, elements: string[]) => string };
const VENUES: Venue[] = [
  {
    label: 'an object property',
    name: 'Cells',
    indent: 16,
    build: (xml, elements) => {
      expect(xml).toContain(HOST_CELLS);
      return xml.replace(HOST_CELLS, cellProperty('Cells', elements, 16));
    },
  },
  {
    label: 'a struct field of an object property',
    name: 'c',
    indent: 32,
    build: (xml, elements) => {
      expect(xml).toContain(HOST_NESTED_LEAF);
      return xml.replace(HOST_NESTED_LEAF, HOST_NESTED_LEAF + '\n' + cellProperty('c', elements, 32));
    },
  },
];

/** The span of the `<P>` whose opening line is `open`, through its own closing line. */
function spanOf(xml: string, open: string): string {
  const from = xml.indexOf(open);
  expect(from, open).toBeGreaterThanOrEqual(0);
  const indent = open.length - open.trimStart().length;
  const close = '\n' + ' '.repeat(indent) + '</P>';
  return xml.slice(from, xml.indexOf(close, from) + close.length);
}

function open(chunk: string): { session: ReturnType<typeof createSession>; root: any } {
  const files = unzipSync(bytesAt(HOST));
  files['data/chunk0.xml'] = strToU8(chunk);
  const session = createSession();
  const root: any = ingest(session, buffer(zipSync(files)), { filename: 'custom_object_binary.sldd' });
  return { session, root };
}

const widgetOf = (root: any) => flatten(root).find((n: any) => n?.isEntry && n.name === 'widget');

/** The cell node a venue's property is, and what each of its elements reads as. */
function readBack(root: any, venue: Venue): { raw: unknown; shown: unknown[] } {
  const cell = flatten(widgetOf(root)).find((n: any) => n.name === venue.name);
  expect(cell, venue.label).toBeTruthy();
  return {
    raw: cell.serializeValue(),
    shown: cell.children.map((c: any) => [c.name, c.className, c.displayValue, c.dims]),
  };
}

/**
 * Every element the cell reader decodes that no dictionary MATLAB wrote holds in a cell, in
 * the grammar parseCellElement reads, each spelled as the property writer spells the same
 * value at a `<P>`: so the reader, not MATLAB, is the ground truth for these, and what is
 * asserted is that a save gives back what it read.
 */
const SYNTHETIC: { entry: string; element: string }[] = [
  ['a double', '<Element Class="double">1.0</Element>'],
  ['a 2x2 double', '<Element Class="double" Dimension="2*2">1.0 3.0 2.0 4.0</Element>'],
  ['a 2x2 int8', '<Element Class="int8" Dimension="2*2">1 3 2 4</Element>'],
  ['a uint64 column past 2^53', '<Element Class="uint64" Dimension="2*1">18446744073709551615 1</Element>'],
  ['a 1x1x2 single', '<Element Class="single" Dimension="1*1*2">1.5 2.5</Element>'],
  ['a 2x2 logical', '<Element Class="logical" Dimension="2*2">1 0 0 1</Element>'],
  ['a 0x3 double', '<Element Class="double" Dimension="0*3"/>'],
  ['a 3x0 int16', '<Element Class="int16" Dimension="3*0"/>'],
  ['a 0x0 logical', '<Element Class="logical" Dimension="0*0"/>'],
  ['a 1x0 logical', '<Element Class="logical" Dimension="1*0"/>'],
  ['a 0x3 logical', '<Element Class="logical" Dimension="0*3"/>'],
  ['an empty object array', '<Element Class="WidgetPart" Dimension="0*0"/>'],
  ['an empty 1x0 Simulink.Parameter array', '<Element Class="Simulink.Parameter" Dimension="1*0"/>'],
  ['an empty cell', '<Element Class="cell" Dimension="0*0">\n            </Element>'],
  [
    'a 2x1 string',
    '<Element>\n' +
      '                <Element Class="string">\n' +
      '                    <P Source="saveobj" PropertyType="any" Class="cell" Dimension="2*1">\n' +
      '                        <Element Class="char">a</Element>\n' +
      '                        <Element Class="char">b</Element>\n' +
      '                    </P>\n' +
      '                </Element>\n' +
      '            </Element>',
  ],
  ['an empty struct with a field', '<Element Class="struct" Dimension="0*0">\n                <Field Name="a"/>\n            </Element>'],
  ['an object with no properties', '<Element>\n                <Element Class="WidgetPart"/>\n            </Element>'],
  [
    'an object of a user class',
    '<Element>\n' +
      '                <Element Class="WidgetPart">\n' +
      '                    <P Name="PartId" Class="double">9.0</P>\n' +
      '                    <P Name="Label" Class="char">inner</P>\n' +
      '                </Element>\n' +
      '            </Element>',
  ],
  [
    'a cell of a struct of a cell of a matrix',
    '<Element Class="cell" Dimension="1*2">\n' +
      '                <Element Class="struct">\n' +
      '                    <Element>\n' +
      '                        <P Name="c" Class="cell" Dimension="1*2">\n' +
      '                            <Element Class="int8" Dimension="2*2">1 3 2 4</Element>\n' +
      '                            <Element Class="cell">\n' +
      '                                <Element Class="char">deep</Element>\n' +
      '                            </Element>\n' +
      '                        </P>\n' +
      '                    </Element>\n' +
      '                </Element>\n' +
      '                <Element Class="char">x</Element>\n' +
      '            </Element>',
  ],
].map(([entry, element]) => ({ entry, element: '            ' + element }));

type Edit = 'untouched' | 'with another property edited' | 'with one of its elements edited';
const EDITS: Edit[] = ['untouched', 'with another property edited', 'with one of its elements edited'];
const EDITED_FROM = '<Element Class="double">1.0</Element>';
const EDITED_TO = '<Element Class="double">42.0</Element>';

/**
 * `elements`, at `venue`, opened, edited as `edit` says, saved and reopened: what was written
 * in each element's place where it is not what was read, and the values before and after.
 */
function roundTrip(elements: { entry: string; element: string }[], venue: Venue, edit: Edit) {
  const chunk = venue.build(chunkOf(bytesAt(HOST)), elements.map((e) => e.element));
  const written = spanOf(chunk, ' '.repeat(venue.indent) + '<P Name="' + venue.name + '" Class="cell" Dimension="1*' + elements.length + '">');
  const expected = elements.map((e) => deeper(e.element, venue.indent + 4 - 12));

  const first = open(chunk);
  if (edit === 'with another property edited') {
    const scalar = widgetOf(first.root).children.find((c: any) => c.name === 'Scalar');
    expect(scalar.setProperty('Value', '2.5')).toBe(true);
  }
  if (edit === 'with one of its elements edited') {
    const k = elements.findIndex((e) => e.element.trim() === EDITED_FROM);
    expect(k).toBeGreaterThanOrEqual(0);
    const cell = flatten(widgetOf(first.root)).find((n: any) => n.name === venue.name);
    expect(cell.children[k].setProperty('Value', '42')).toBe(true);
    expected[k] = ' '.repeat(venue.indent + 4) + EDITED_TO;
  }
  const before = readBack(first.root, venue);
  const saved = chunkOf(first.session.serializeSource(first.root.name)!.bytes!);
  const back = spanOf(saved, written.split('\n')[0]);
  // Element by element, so a failure names the element and what was written in its place.
  const ours = childElements(back.split('\n'));
  const wrong = elements.flatMap(({ entry }, k) =>
    ours[k] === expected[k] ? [] : [entry + '\n  read:    ' + expected[k].trim() + '\n  written: ' + (ours[k] ?? '').trim()],
  );
  // And as the writer writes it from the model. A save writes an unedited entry as the bytes
  // it was read from, so for one the save alone no longer reaches the writer.
  const regenerated = childElements(spanOf(regenerateChunkXml(first.root), written.split('\n')[0]).split('\n'));
  wrong.push(...elements.flatMap(({ entry }, k) =>
    regenerated[k] === expected[k] ? [] : [entry + ' (written from the model)\n  read:    ' + expected[k].trim() + '\n  written: ' + (regenerated[k] ?? '').trim()],
  ));
  return { wrong, count: ours.length, before, after: readBack(open(saved).root, venue) };
}

describe('a cell in an object property is saved as MATLAB wrote it, element for element', () => {
  it('lifts a MATLAB element of every shape the cell reader decodes', () => {
    // Lower bounds and named shapes, so a regenerated fixture cannot quietly shrink this.
    const all = MATLAB_ELEMENTS.map((e) => e.element).join('\n');
    expect(MATLAB_ELEMENTS.length).toBeGreaterThanOrEqual(40);
    for (const shape of [
      '<Element Class="cell" Dimension="1*2">', // a nested cell
      '<Element Class="cell">', // a 1x1 nested cell, which MATLAB writes with no Dimension
      '<Element Class="struct">', // a struct
      '<Element Class="struct" Dimension="2*2">', // a struct array
      '<Element Class="Simulink.Parameter">', // an object, inside a classless <Element>
      '<Element Dimension="1*2">', // an object array
      '<Element Class="string">', // a string
      'Class="cell" Dimension="1*2">\n', // a string array's saveobj cell
      '<Element Class="double" Dimension="2*3*2">', // an N-D double
      '<Element Class="char" Dimension="2*2">', // a char matrix
      '<Element Class="double" IsComplex="1" Dimension="2*2*2">', // complex N-D
      '<Element Class="int32" Dimension="1*2">', // a typed row
      EDITED_FROM, // the element the edit case retypes
    ]) {
      expect(all, shape).toContain(shape);
    }
  });

  for (const venue of VENUES) {
    for (const edit of EDITS) {
      it(`in ${venue.label}, ${edit}`, () => {
        const { wrong, count, before, after } = roundTrip(MATLAB_ELEMENTS, venue, edit);
        expect(wrong).toEqual([]);
        expect(count).toBe(MATLAB_ELEMENTS.length);
        // And reopened, it is the value that was saved.
        expect(after).toEqual(before);
      });
    }
  }
});

describe('and every other shape the cell reader decodes is saved as it was read', () => {
  for (const venue of VENUES) {
    for (const edit of EDITS) {
      it(`in ${venue.label}, ${edit}`, () => {
        const { wrong, count, before, after } = roundTrip(SYNTHETIC, venue, edit);
        expect(wrong).toEqual([]);
        expect(count).toBe(SYNTHETIC.length);
        expect(after).toEqual(before);
      });
    }
  }
});
