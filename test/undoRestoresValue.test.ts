// Copyright 2026 The MathWorks, Inc.
//
// The session's undo of a Value edit puts back the value the edit replaced, not the text
// that value showed.
//
// DataModel.editProperty captured the prior value as the Property Inspector's display text
// (readPropertyValue) and undid the edit by setting the property back to that text. Where
// the text is not the value, the undo made a different one. Every empty shows `[ ]`,
// whatever its size and class, and `[ ]` reads back as a 0x0 double. So an entry holding
// zeros(1,0), zeros(0,2), int8(zeros(0,3)) or a 0x0x2 empty, set to [1 2 3] and undone, was
// a 0x0 double, and the next save wrote `Class="double" Dimension="0*0"`. MATLAB writes every
// one of these shapes, and four corpus dictionaries hold them as entries. An empty of an
// enumeration class was one of them until its IsEnum was read: it shows `<0x2 dSomeColors>`
// now, and takes no editor, as one in a cell does.
//
// The binary dictionary below is MATLAB's typed_binary.sldd with entries added, each
// spelled as MATLAB-written dictionaries spell that empty.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { regenerateEntryXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
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

/** The empties a value can be typed into: all but the enumeration array (see the last case below). */
const EDITABLE = EMPTIES.filter(([name]) => name !== 'enumEmpty');

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

/**
 * An entry's Value element as the writer writes it from the model. Not as a save writes
 * it: a save writes an unedited entry as the bytes it was read from, which would compare
 * the file's bytes before the edit with the writer's after it.
 */
function valueTag(entry: any): string {
  const xml = regenerateEntryXml(entry);
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
  for (const [name] of EDITABLE) {
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
    for (const [name] of EDITABLE) {
      const entry = root.getSection('design').children.find((e: any) => e.name === name);
      session.setActive(root, entry);
      expect(session.editProperty(entry.id, 'Value', '[1 2 3]')).toBe(true);
    }
    for (let i = 0; i < EDITABLE.length; i++) {
      session.undo();
    }
    const values = (zip: Uint8Array): string[] =>
      [...strFromU8(unzipSync(zip)['data/chunk0.xml']).matchAll(/<P Name="Value"[^\n]*/g)].map((m) => m[0]);
    expect(values(session.serializeSource(root.name).bytes)).toEqual(values(untouched.bytes));
  });

  it('and an empty enumeration array takes no editor, so a value typed into it is refused and nothing changes', () => {
    const session = createSession();
    const root = ingest(session, withEmpties(), { filename: 'empties_binary.sldd' });
    const entry = root.getSection('design').children.find((e: any) => e.name === 'enumEmpty');
    const before = { tag: valueTag(entry), shown: shown(entry) };
    expect(before).toEqual({ tag: '<P Name="Value" IsEnum="1" Class="dSomeColors" Dimension="0*2"/>', shown: ['<0x2 dSomeColors>', 'dSomeColors', [0, 2]] });
    expect(entry.valueEditable).toBe(false);
    session.setActive(root, entry);
    expect(session.editProperty(entry.id, 'Value', '[1 2 3]')).toMatchObject({ error: true });
    expect({ tag: valueTag(entry), shown: shown(entry) }).toEqual(before);
    expect(session.canUndo()).toBe(false);
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
    // Opened again, it is read from that stream, which is shown and not edited (the C-012
    // ruling, 2026-10-15; test/cdataDisplayOnly.test.ts): the edit is refused, nothing changes.
    expect(session.editProperty(entry.id, 'Value', '[1 2 3]')).toMatchObject({ error: true });
    expect(value()).toBe(before.value);
    expect(shown(entry)).toEqual(before.shown);
  });
});

// The 2026-10-15 ruling (C-040 option B, the agenda's "Committing an empty's shown [ ]
// unchanged makes it a double 0x0", F1-13): one text stands for many values — `[ ]` for every
// numeric empty, whatever its size and class, as MATLAB's Workspace browser shows them — so
// committing a cell's displayed text unchanged is no edit. The value, its `_rawInput` and its
// bytes are kept, and no undo step is recorded. It was an edit: `[ ]` read back as a 0x0 double.
describe("committing a Value's shown text unchanged is no edit", () => {
  // A cell holding a 0x3 double, in MATLAB's spelling of an entry's 1x3 cell (`cell_mixed` in
  // test/fixtures/display/dispcat_bin.sldd's source) and of a 0x3 double in one
  // (cellPropertyWriteBack.test.ts).
  const CELL =
    '<P Name="Value" Class="cell" Dimension="1*2">\n' +
    '            <Element Class="double">1.0</Element>\n' +
    '            <Element Class="double" Dimension="0*3"/>\n' +
    '        </P>';

  /** withEmpties(), and one entry more: a cell whose literal shows `{1, [ ]}`. */
  function withCell(): ArrayBuffer {
    const zip = unzipSync(new Uint8Array(withEmpties()));
    const xml = strFromU8(zip['data/chunk0.xml']);
    const at = xml.indexOf('    <Object Class="DD.Dictionary">');
    const entry = [
      '    <Object Class="DD.ENTRY">',
      '        <P Name="Name" Class="char">cellOfEmpty</P>',
      '        <P Name="UUID" Class="char">00000000-0000-4000-8000-000000000100</P>',
      '        <P Name="Namespace" Class="char">dacaf35e-55a5-454d-a7c1-93db038a210e</P>',
      '        <P Name="LastMod" Class="char">20260903T181348.010950</P>',
      '        <P Name="LastModBy" Class="char"></P>',
      '        <P Name="IsDerived" Class="char">0</P>',
      `        ${CELL}`,
      '    </Object>',
    ].join('\n');
    zip['data/chunk0.xml'] = strToU8(xml.slice(0, at) + entry + '\n' + xml.slice(at));
    return buffer(zipSync(zip));
  }

  const NAMES = [...EDITABLE.map(([name]) => name), 'cellOfEmpty'];

  for (const name of NAMES) {
    it(name, () => {
      // One dictionary for both sessions: withCell() zips with the time it runs.
      const file = new Uint8Array(withCell());
      const fresh = createSession();
      const untouched = fresh.serializeSource(ingest(fresh, buffer(file), { filename: 'empties_binary.sldd' }).name).bytes;
      const session = createSession();
      const root = ingest(session, buffer(file), { filename: 'empties_binary.sldd' });
      const entry = root.getSection('design').children.find((e: any) => e.name === name);
      const before = { raw: entry._rawInput, tag: valueTag(entry), shown: shown(entry) };
      expect(entry.valueEditable, `${name} takes an editor`).toBe(true);
      if (name === 'cellOfEmpty') {
        expect(entry.displayValue).toBe('{1, [ ]}');
      }
      session.setActive(root, entry);
      expect(session.editProperty(entry.id, 'Value', entry.displayValue)).toBe(true);
      expect(entry._rawInput, `${name} keeps what it was read as`).toBe(before.raw);
      expect({ tag: valueTag(entry), shown: shown(entry) }).toEqual({ tag: before.tag, shown: before.shown });
      expect(session.canUndo(), 'no undo step').toBe(false);
      expect(session.serializeSource(root.name).bytes).toEqual(untouched);
    });
  }

  it("and a binary dictionary's complex empty (C-040) keeps its class, its shape and its IsComplex", () => {
    const file = new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/display/dispcat_bin.sldd', import.meta.url))));
    for (const name of ['dx_complex_1x0', 'dx_complex_int16_1x0']) {
      const session = createSession();
      const root = ingest(session, buffer(file), { filename: 'dispcat_bin.sldd' });
      const entry = root.getSection('design').children.find((e: any) => e.name === name);
      const before = { raw: entry._rawInput, tag: valueTag(entry), shown: shown(entry) };
      expect(before.tag, name).toContain('IsComplex="1" Dimension="1*0"');
      session.setActive(root, entry);
      expect(session.editProperty(entry.id, 'Value', '[ ]'), name).toBe(true);
      expect(entry._rawInput, name).toBe(before.raw);
      expect({ tag: valueTag(entry), shown: shown(entry) }, name).toEqual({ tag: before.tag, shown: before.shown });
      expect(session.canUndo(), name).toBe(false);
      expect(session.serializeSource(root.name).bytes, name).toEqual(file);
    }
  });

  it('while a text that differs from it is an edit, as before', () => {
    const session = createSession();
    const root = ingest(session, withCell(), { filename: 'empties_binary.sldd' });
    const entry = root.getSection('design').children.find((e: any) => e.name === 'emptyRow');
    session.setActive(root, entry);
    expect(session.editProperty(entry.id, 'Value', '[]')).toBe(true);
    expect(session.canUndo()).toBe(true);
    expect(valueTag(entry)).toBe('<P Name="Value" Class="double" Dimension="0*0"/>');
  });
});
