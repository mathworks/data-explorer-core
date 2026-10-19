// Copyright 2026 The MathWorks, Inc.
//
// A struct with no elements is written as MATLAB writes it: self-closed, or around the `<Field
// Name="…"/>` of each field it declares.
//
// StructNode.serializeXml wrote every struct of one element or fewer as one `<Element>`, so a
// 0x0, 0x2, 2x0 or 0x0x2 struct entry, saved untouched, became `<P Name="Value" Class="struct"
// Dimension="0*2">` around an `<Element>` it never had: reopened, a struct of one element in a
// shape that holds none, and a struct with declared fields lost them. MATLAB writes them as
// test/parity/artifacts/binary/cases.sldd's structEmpty is, `<P Name="Value" Class="struct"
// Dimension="0*0"/>`, and as a binary dictionary MATLAB wrote holds its structNoEmptyField, `<P Name="Value"
// Class="struct" Dimension="1*0">` around `<Field Name="a"/>` and `<Field Name="b"/>`; the
// other shapes below are that file's structEmptyArray2, 3 and 4, in its spelling.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, ingest } from '../src/index.js';
import { regenerateChunkXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { flatten } from './parity/loadFile.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const HOST = './parity/artifacts/binary/cases.sldd';
const bytesAt = (rel: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(rel, import.meta.url))));
const chunkOf = (zip: Uint8Array) => strFromU8(unzipSync(zip)['data/chunk0.xml']);
const buffer = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const HOST_XML = chunkOf(bytesAt(HOST));

/** The Value of the DD.ENTRY named `name` in `xml`, from its `<P Name="Value"` through the entry's close. */
function valueOf(xml: string, name: string): string {
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  expect(at, name).toBeGreaterThan(-1);
  const end = xml.indexOf('\n    </Object>', at);
  return xml.slice(xml.indexOf('        <P Name="Value"', at), end);
}

/** Each struct entry with no elements, as MATLAB writes it, its size and its fields. */
const STRUCTS: [string, string, number[], string[]][] = [
  ['structEmpty', '        <P Name="Value" Class="struct" Dimension="0*0"/>', [0, 0], []],
  ['structEmptyArray2', '        <P Name="Value" Class="struct" Dimension="0*2"/>', [0, 2], []],
  ['structEmptyArray3', '        <P Name="Value" Class="struct" Dimension="2*0"/>', [2, 0], []],
  ['structEmptyArray4', '        <P Name="Value" Class="struct" Dimension="0*0*2"/>', [0, 0, 2], []],
  [
    'structNoEmptyField',
    '        <P Name="Value" Class="struct" Dimension="1*0">\n            <Field Name="a"/>\n            <Field Name="b"/>\n        </P>',
    [1, 0],
    ['a', 'b'],
  ],
];
// An empty struct as a field of a struct entry, written by the same writer.
const NESTED =
  '        <P Name="Value" Class="struct">\n' +
  '            <Element>\n' +
  '                <P Name="x" Class="double">1.0</P>\n' +
  '                <P Name="none" Class="struct" Dimension="0*0"/>\n' +
  '                <P Name="named" Class="struct" Dimension="0*1">\n' +
  '                    <Field Name="c"/>\n' +
  '                </P>\n' +
  '            </Element>\n' +
  '        </P>';

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

/** cases.sldd, whose own structEmpty is the first shape, with the others added. */
function hostXml(): string {
  expect(valueOf(HOST_XML, 'structEmpty')).toBe(STRUCTS[0][1]);
  const tail = '    <Object Class="DD.Dictionary">';
  const added = [...STRUCTS.slice(1).map(([name, value], k) => entry(name, k + 1, value)), entry('structNested', 9, NESTED)];
  return HOST_XML.replace(tail, added.join('\n') + '\n' + tail);
}

function open(chunk: string): { session: ReturnType<typeof createSession>; root: any } {
  const files = unzipSync(bytesAt(HOST));
  files['data/chunk0.xml'] = strToU8(chunk);
  const session = createSession();
  const root: any = ingest(session, buffer(zipSync(files)), { filename: 'cases.sldd' });
  return { session, root };
}

const entryNode = (root: any, name: string) => flatten(root).find((n: any) => n?.isEntry && n.name === name);
/** What a session holds of a struct: its size, its rows, and the fields its value declares. */
const held = (n: any) => [n.className, n.dims, n.children.length, n.serializeValue()._fields, n.serializeValue()._elements];

describe('a struct entry with no elements is written as MATLAB writes it', () => {
  for (const edit of ['untouched', 'renamed']) {
    it(edit, () => {
      const first = open(hostXml());
      const before = STRUCTS.map(([name]) => held(entryNode(first.root, name)));
      expect(before).toEqual(STRUCTS.map(([, , dims, fields]) => ['struct', dims, 0, fields, []]));
      if (edit === 'renamed') {
        for (const [name] of STRUCTS) {
          expect(entryNode(first.root, name).setProperty('Name', name + 'X')).toBe(true);
        }
      }
      const saved = chunkOf(first.session.serializeSource(first.root.name)!.bytes!).replace(/char">(struct\w+)X</g, 'char">$1<');
      // A save writes an unedited entry as its own bytes, so the writer is asked too.
      const regenerated = regenerateChunkXml(first.root).replace(/char">(struct\w+)X</g, 'char">$1<');
      for (const [name, value] of STRUCTS) {
        expect(valueOf(saved, name), name).toBe(value);
        expect(valueOf(regenerated, name), `${name}, written from the model`).toBe(value);
      }
      // And reopened, each is the struct it was, with no element and its fields.
      const again = open(saved);
      expect(STRUCTS.map(([name]) => held(entryNode(again.root, name)))).toEqual(before);
    });
  }

  it('and so is one that is a field of a struct entry, untouched or edited elsewhere in the entry', () => {
    const { session, root } = open(hostXml());
    const nested = entryNode(root, 'structNested');
    expect(nested.children.map((c: any) => [c.name, c.dims, c.children.length])).toEqual([['x', [1, 1], 0], ['none', [0, 0], 0], ['named', [0, 1], 0]]);
    expect(valueOf(chunkOf(session.serializeSource(root.name)!.bytes!), 'structNested')).toBe(NESTED);
    expect(nested.children[0].setProperty('Value', '2')).toBe(true);
    const saved = chunkOf(session.serializeSource(root.name)!.bytes!);
    expect(valueOf(saved, 'structNested')).toBe(NESTED.replace('Class="double">1.0<', 'Class="double">2.0<'));
  });

  it('and so is a copy of one pasted into a binary dictionary', () => {
    const { session, root } = open(hostXml());
    const design = root.getSection('design');
    STRUCTS.forEach(([name], k) => {
      const payload: any = JSON.parse(JSON.stringify(entryNode(root, name).serialize()));
      payload.name = name + 'Copy';
      payload.metadata = { ...payload.metadata, uuid: '00000000-0000-4000-9000-' + String(k + 1).padStart(12, '0') };
      design.parseEntry(payload);
    });
    const saved = chunkOf(session.serializeSource(root.name)!.bytes!);
    for (const [name, value] of STRUCTS) {
      expect(valueOf(saved, name + 'Copy'), name).toBe(value);
    }
  });
});
