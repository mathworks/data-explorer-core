// Copyright 2026 The MathWorks, Inc.
//
// The session's undo of a Value edit puts back the value the edit replaced, not the text
// that value showed.
//
// DataModel.editProperty captured the prior value as the Property Inspector's display text
// (readPropertyValue) and undid the edit by setting the property back to that text. Where
// the text is not the value, the undo made a different one. Every empty shows `[ ]`,
// whatever its size and class, and `[ ]` reads back as a 0x0 double. So an entry holding
// zeros(1,0), zeros(0,2), int8(zeros(0,3)), an empty of an enumeration class or a 0x0x2
// empty, set to [1 2 3] and undone, was a 0x0 double, and the next save wrote
// `Class="double" Dimension="0*0"`. MATLAB writes every one of these shapes, and four
// corpus dictionaries hold them as entries.
//
// The binary dictionary below is MATLAB's typed_binary.sldd with entries added, each
// spelled as MATLAB-written dictionaries spell that empty.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

const EMPTIES: [string, string][] = [
  ['emptyRow', '<P Name="Value" Class="double" Dimension="1*0"/>'],
  ['emptyCol', '<P Name="Value" Class="double" Dimension="0*1"/>'],
  ['empty0x2', '<P Name="Value" Class="double" Dimension="0*2"/>'],
  ['empty2x0', '<P Name="Value" Class="double" Dimension="2*0"/>'],
  ['int8Empty', '<P Name="Value" Class="int8" Dimension="0*3"/>'],
  ['enumEmpty', '<P Name="Value" IsEnum="1" Class="dSomeColors" Dimension="0*2"/>'],
  ['ndEmpty', '<P Name="Value" Class="double" Dimension="0*0*2"/>'],
];

/** typed_binary.sldd with one entry for each of EMPTIES. */
function withEmpties(): ArrayBuffer {
  const zip = unzipSync(fixture('typed_binary.sldd'));
  const objects = EMPTIES.map(([name, value], i) =>
    [
      '    <Object Class="DD.ENTRY">',
      `        <P Name="Name" Class="char">${name}</P>`,
      `        <P Name="UUID" Class="char">00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}</P>`,
      '        <P Name="Namespace" Class="char">dacaf35e-55a5-454d-a7c1-93db038a210e</P>',
      '        <P Name="LastMod" Class="char">20260903T181348.010950</P>',
      '        <P Name="LastModBy" Class="char"></P>',
      '        <P Name="IsDerived" Class="char">0</P>',
      `        ${value}`,
      '    </Object>',
    ].join('\n'),
  );
  const xml = strFromU8(zip['data/chunk0.xml']);
  const at = xml.indexOf('    <Object Class="DD.Dictionary">');
  expect(at).toBeGreaterThan(-1);
  zip['data/chunk0.xml'] = strToU8(xml.slice(0, at) + objects.join('\n') + '\n' + xml.slice(at));
  return buffer(zipSync(zip));
}

/** An entry's Value element as a save writes it. */
function valueTag(entry: any): string {
  const xml = serializeEntryToXml(entry);
  const from = xml.indexOf('<P Name="Value"');
  return xml.slice(from, xml.indexOf('\n', from));
}

/** What a session shows of a value: its row, its class and its size. */
const shown = (node: any): unknown[] => [node.displayValue, node.className, node.dims];

describe('the dictionary holds the empties as MATLAB spells them', () => {
  it('each opens with its own class and size', () => {
    const design = ingest(createSession(), withEmpties(), { filename: 'empties_binary.sldd' }).getSection('design');
    const dims = EMPTIES.map(([name]) => design.children.find((e: any) => e.name === name).dims);
    expect(dims).toEqual([[1, 0], [0, 1], [0, 2], [2, 0], [0, 3], [0, 2], [0, 0, 2]]);
  });
});

describe('undoing a Value edit of an empty that is not 0x0 restores it, in a binary dictionary', () => {
  for (const [name] of EMPTIES) {
    it(name, () => {
      const session = createSession();
      const root = ingest(session, withEmpties(), { filename: 'empties_binary.sldd' });
      const entry = root.getSection('design').children.find((e: any) => e.name === name);
      const before = { tag: valueTag(entry), shown: shown(entry) };
      session.setActive(root, entry);
      expect(session.editProperty(entry.id, 'Value', '[1 2 3]')).toBe(true);
      expect(valueTag(entry)).toContain('Dimension="1*3"');
      session.undo();
      expect(valueTag(entry)).toBe(before.tag);
      expect(shown(entry)).toEqual(before.shown);
      session.redo();
      expect(valueTag(entry)).toContain('Dimension="1*3"');
      session.undo();
      expect(valueTag(entry)).toBe(before.tag);
      expect(shown(entry)).toEqual(before.shown);
    });
  }

  it('and the file saved after every edit is undone holds the values an untouched save does', () => {
    const fresh = createSession();
    const untouched = fresh.serializeSource(ingest(fresh, withEmpties(), { filename: 'empties_binary.sldd' }).name);
    const session = createSession();
    const root = ingest(session, withEmpties(), { filename: 'empties_binary.sldd' });
    for (const [name] of EMPTIES) {
      const entry = root.getSection('design').children.find((e: any) => e.name === name);
      session.setActive(root, entry);
      expect(session.editProperty(entry.id, 'Value', '[1 2 3]')).toBe(true);
    }
    for (let i = 0; i < EMPTIES.length; i++) {
      session.undo();
    }
    const values = (zip: Uint8Array): string[] =>
      [...strFromU8(unzipSync(zip)['data/chunk0.xml']).matchAll(/<P Name="Value"[^\n]*/g)].map((m) => m[0]);
    expect(values(session.serializeSource(root.name).bytes)).toEqual(values(untouched.bytes));
  });

  it('as it already did for a value whose text is the value', () => {
    const session = createSession();
    const root = ingest(session, withEmpties(), { filename: 'empties_binary.sldd' });
    const entry = root.getSection('design').children.find((e: any) => e.name === 'i32Col');
    const before = valueTag(entry);
    session.setActive(root, entry);
    expect(session.editProperty(entry.id, 'Value', '[1 2 3]')).toBe(true);
    session.undo();
    expect(valueTag(entry)).toBe(before);
  });
});

describe('undoing a Value edit of an N-D empty restores it, in a text dictionary', () => {
  it('pasted there from a binary one, saved, opened again, edited and undone', () => {
    // A text dictionary holds an N-D empty as a MAT stream (MatWriter.textDictionaryForm).
    const binary = ingest(createSession(), withEmpties(), { filename: 'empties_binary.sldd' });
    const payload: any = JSON.parse(JSON.stringify(binary.getSection('design').children.find((e: any) => e.name === 'ndEmpty').serialize()));
    const first = createSession();
    const text = ingest(first, buffer(fixture('typed_text.sldd')), { filename: 'typed_text.sldd' });
    text.getSection('design').parseEntry(payload);
    const saved = new TextEncoder().encode(first.serializeSource(text.name).text);

    const session = createSession();
    const root = ingest(session, buffer(saved), { filename: 'typed_text.sldd' });
    const entry = root.getSection('design').children.find((e: any) => e.name === 'ndEmpty');
    const value = (): string => JSON.stringify(entry.serialize().value);
    const before = { value: value(), shown: shown(entry) };
    expect(before.shown[2]).toEqual([0, 0, 2]);
    expect(JSON.parse(before.value)._type).toBe('cdata');
    session.setActive(root, entry);
    expect(session.editProperty(entry.id, 'Value', '[1 2 3]')).toBe(true);
    expect(entry.dims).toEqual([1, 3]);
    session.undo();
    expect(value()).toBe(before.value);
    expect(shown(entry)).toEqual(before.shown);
    session.redo();
    expect(entry.dims).toEqual([1, 3]);
    session.undo();
    expect(value()).toBe(before.value);
    expect(shown(entry)).toEqual(before.shown);
  });
});
