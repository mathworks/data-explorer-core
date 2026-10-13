// Copyright 2026 The MathWorks, Inc.
//
// An empty in a cell of a binary dictionary keeps its class and its size.
//
// MATLAB states an empty array of an object class as the class and a Dimension on the element
// that holds it, with no body: at a property `<P Name="Elements_internal"
// Class="Simulink.BusElement" Dimension="0*0"/>`, which the local corpus holds 11,114 times
// (and the same with Simulink.ConnectionElement 11,111 times), and in a cell, less the Name,
// `<Element Class="WidgetPart" Dimension="0*0"/>`. BinarySlddParser.parseCellElement asked a class it does not know for
// elements to read as objects, found none, and fell to its last arm, the element's text: ''.
// So the empty opened as a 0x0 char and every save wrote `<Element Class="char"></Element>`.
//
// No dictionary MATLAB wrote holds such an element in a cell, so the elements below are
// MATLAB's property spelling moved into one, the way cellEnumElement.test.ts moves an
// enumeration value.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, ingest } from '../src/index.js';
import { parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import { flatten } from './parity/loadFile.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const HOST = './fixtures/custom_object_binary.sldd';
const bytesAt = (rel: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(rel, import.meta.url))));
const chunkOf = (zip: Uint8Array) => strFromU8(unzipSync(zip)['data/chunk0.xml']);
const buffer = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const HOST_XML = chunkOf(bytesAt(HOST));

const HOST_CELLS =
  '                <P Name="Cells" Class="cell" Dimension="1*3">\n' +
  '                    <Element Class="double">1.0</Element>\n' +
  '                    <Element Class="char">two</Element>\n' +
  '                    <Element Class="logical">1</Element>\n' +
  '                </P>';
const PART_CELL_OPEN = '        <P Name="Value" Class="cell" Dimension="2*2">';

/** The span of the `<P>` whose opening line is `open`, through its own closing line. */
function spanOf(xml: string, open: string): string {
  const from = xml.indexOf(open + '\n');
  expect(from, open).toBeGreaterThanOrEqual(0);
  const indent = open.length - open.trimStart().length;
  const close = '\n' + ' '.repeat(indent) + '</P>';
  return xml.slice(from, xml.indexOf(close, from) + close.length);
}

/** A cell `<P>` named `name` at `indent` spaces holding the one-line `elements`. */
function cellP(name: string, elements: string[], indent: number): string {
  const p = ' '.repeat(indent);
  return (
    p + '<P Name="' + name + '" Class="cell" Dimension="1*' + elements.length + '">\n' +
    elements.map((e) => p + '    ' + e).join('\n') + '\n' +
    p + '</P>'
  );
}

/** `elements` in widget.Cells, an object property, or in partCell's Value, an entry's cell. */
function chunkWith(venue: 'property' | 'entry', elements: string[]): string {
  return venue === 'property'
    ? HOST_XML.replace(HOST_CELLS, cellP('Cells', elements, 16))
    : HOST_XML.replace(spanOf(HOST_XML, PART_CELL_OPEN), cellP('Value', elements, 8));
}

function open(chunk: string): { session: ReturnType<typeof createSession>; root: any } {
  const files = unzipSync(bytesAt(HOST));
  files['data/chunk0.xml'] = strToU8(chunk);
  const session = createSession();
  const root: any = ingest(session, buffer(zipSync(files)), { filename: 'custom_object_binary.sldd' });
  return { session, root };
}

function cellOf(root: any, venue: 'property' | 'entry'): any {
  return venue === 'property'
    ? flatten(root).find((n: any) => n.name === 'Cells')
    : flatten(root).find((n: any) => n?.isEntry && n.name === 'partCell');
}

/** The cell's elements as parsed. */
function parsed(venue: 'property' | 'entry', elements: string[]): unknown[] {
  const entries = (parseBinarySlddParts(chunkWith(venue, elements), {}) as any).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0']
    .__MW_TEXT_content.entries;
  const cell = venue === 'property'
    ? entries.find((e: any) => e.name === 'widget').value._elements[0]._properties.Cells
    : entries.find((e: any) => e.name === 'partCell').value;
  return cell._elements;
}

/** What each member of the cell shows, and the elements a save writes, untouched. */
function roundTrip(venue: 'property' | 'entry', elements: string[]): { shown: unknown[]; saved: string } {
  const { session, root } = open(chunkWith(venue, elements));
  const shown = cellOf(root, venue).children.map((c: any) => [c.className, c.displayValue, c.dims]);
  const saved = chunkOf(session.serializeSource(root.name)!.bytes!);
  return { shown, saved };
}

const VENUES = ['property', 'entry'] as const;

describe('an empty array of an object class in a cell', () => {
  const ELEMENTS = [
    '<Element Class="WidgetPart" Dimension="0*0"/>',
    // A class with a node of its own, which an empty must not reach.
    '<Element Class="Simulink.Parameter" Dimension="1*0"/>',
  ];

  it('reads as an empty of its class, the way an empty of a numeric class in a cell does', () => {
    // Saying it was read out of a binary dictionary, as every empty the reader reads does
    // (XmlUtils.BINARY_EMPTY_KEY).
    expect(parsed('property', ELEMENTS)).toEqual([
      { _type: 'WidgetPart', _value: 'Matrix(0,0)', _binary_empty: true },
      { _type: 'Simulink.Parameter', _value: 'Matrix(1,0)', _binary_empty: true },
    ]);
  });

  for (const venue of VENUES) {
    it(`opens with its class and size, and is saved as MATLAB wrote it, in ${venue === 'property' ? 'an object property' : "an entry's cell"}`, () => {
      const { shown, saved } = roundTrip(venue, ELEMENTS);
      expect(shown).toEqual([
        ['WidgetPart', '[ ]', [0, 0]],
        ['Simulink.Parameter', '[ ]', [1, 0]],
      ]);
      expect(saved).toContain(cellP(venue === 'property' ? 'Cells' : 'Value', ELEMENTS, venue === 'property' ? 16 : 8));
    });
  }
});

describe('an empty logical in a cell', () => {
  // MATLAB writes an empty logical as it writes an empty of a numeric class, `<Element
  // Class="logical" Dimension="1*0"/>`. The reader answered every one of them `{_type:
  // 'logical', _value: '[]'}`, whose only size is 0x0: a 1x0 or a 0x3 was saved as
  // `Dimension="0*0"` from an object property, and from an entry's cell as `Dimension="1*1">0`,
  // a false. The 0x0 itself keeps that shape (binarySlddValues.test.ts pins it).
  const ELEMENTS = ['<Element Class="logical" Dimension="1*0"/>', '<Element Class="logical" Dimension="0*3"/>'];

  it('reads with its extents, as an empty of a numeric class in a cell does', () => {
    expect(parsed('property', ELEMENTS)).toEqual([
      { _type: 'logical', _value: 'Matrix(1,0)', _binary_empty: true },
      { _type: 'logical', _value: 'Matrix(0,3)', _binary_empty: true },
    ]);
  });

  for (const venue of VENUES) {
    it(`opens with its size, and is saved as MATLAB wrote it, in ${venue === 'property' ? 'an object property' : "an entry's cell"}`, () => {
      const { shown, saved } = roundTrip(venue, ELEMENTS);
      expect(shown).toEqual([
        ['logical', '[ ]', [1, 0]],
        ['logical', '[ ]', [0, 3]],
      ]);
      expect(saved).toContain(cellP(venue === 'property' ? 'Cells' : 'Value', ELEMENTS, venue === 'property' ? 16 : 8));
    });
  }
});
