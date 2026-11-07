// Copyright 2026 The MathWorks, Inc.
//
// A new top-level entry put into a binary .sldd whose data/chunk0.xml holds no DD.Dictionary and
// no DD.DICTIONARYREFERENCE object: an add from the gallery, a paste, a drop, or a compare's Copy
// to Right (pasteEntriesXml), each of which reaches insertNewEntry and so findEntryInsertionPoint.
// Two of this repo's own fixtures are such chunks, in the two shapes a writer gives them:
// compressed.sldd on one line, `…<Object Class="DD.ENTRY">…</Object></DataSource>`, and
// arch_binary.sldd one tag a line, ending `    </Object>\n</DataSource>\n`. The insert used to be
// refused ("Could not locate the insertion point."), since only the dictionary-level objects were
// looked for; the entry now goes just before `</DataSource>`, after every object the chunk holds.
//
// What is pinned for each fixture: the chunk holds the new entry as an `<Object Class="DD.ENTRY">`
// inside `<DataSource>`, every byte outside what was inserted is as it was, a re-read gives the
// old entries and the new one, and the save a host makes of it (the gate, then the package zipped
// around the chunk) keeps it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SavedChunk,
  addNewEntryXml,
  changedEntryKeys,
  createSession,
  deleteEntriesByNameXml,
  findEntryInsertionPoint,
  parseBinarySlddParts,
  pasteEntriesXml,
  pasteEntryXml,
  readBinarySlddPackage,
  savedChunkRefusal,
  scanChunkEntries,
  writeBinarySlddPackage,
} from '../src/index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (name: string) => readBinarySlddPackage(new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)))));
const COMPRESSED = fixture('compressed.sldd');
const ARCH_BINARY = fixture('arch_binary.sldd');

const CLOSE = '</DataSource>';
const ENTRY_OPEN = '<Object Class="DD.ENTRY">';

let opened = 0;
/** The chunk read into a fresh session, as a host holds an open binary dictionary. */
function open(chunkXml: string, parts: Record<string, Uint8Array>) {
  const session = createSession();
  const srcId = `binedit:test://insertion-${opened++}.sldd`;
  const model: any = session.addDataSource(srcId, parseBinarySlddParts(chunkXml, parts), { path: 'x.sldd' });
  return { session, srcId, model };
}

/** Every section's entry names, by section. */
const namesBySection = (model: any): Record<string, string[]> =>
  Object.fromEntries((model.children as any[]).map((s: any) => [s.name, (s.children as any[]).map((e: any) => e.name)]));

/** The entry names of a chunk, in document order, as the save gate's scan reads them. */
const chunkNames = (xml: string): (string | null)[] => {
  const scan = scanChunkEntries(xml);
  expect(scan.clean, 'the chunk scans').toBe(true);
  return scan.entries.map((e) => e.name);
};

/**
 * What `after` inserted into `before`, checked to be an insertion of whole entry objects at the
 * insertion point the chunk had, inside `<DataSource>` and before its close, with every other byte
 * as it was.
 */
function insertedAt(before: string, after: string): string {
  const at = findEntryInsertionPoint(before);
  expect(at, 'the chunk has an insertion point').not.toBeNull();
  const length = after.length - before.length;
  expect(length).toBeGreaterThan(0);
  expect(after.slice(0, at!)).toBe(before.slice(0, at!));
  expect(after.slice(at! + length)).toBe(before.slice(at!));
  expect(before.slice(at!).trimStart().startsWith(CLOSE)).toBe(true);
  expect(before.slice(0, at!)).toMatch(/<DataSource[^>]*>/);
  const fragment = after.slice(at!, at! + length);
  expect(fragment.trimStart().startsWith(ENTRY_OPEN)).toBe(true);
  expect(fragment.trimEnd().endsWith('</Object>')).toBe(true);
  return fragment;
}

/** A host's save of `chunk` over the file read as `before`: the gate, then the package; and its re-read. */
function save(before: string, chunk: string, parts: Record<string, Uint8Array>, model: any) {
  expect(savedChunkRefusal(new SavedChunk(before), chunk, changedEntryKeys(before, chunk), model)).toBeNull();
  const written = readBinarySlddPackage(writeBinarySlddPackage(chunk, parts, 6));
  expect(written.chunkXml).toBe(chunk);
  expect(Object.keys(written.parts)).toEqual(Object.keys(parts));
  for (const [member, bytes] of Object.entries(parts)) expect(written.parts[member]).toEqual(bytes);
  return open(written.chunkXml, written.parts);
}

describe('findEntryInsertionPoint in a chunk with no dictionary object', () => {
  it('a one-line chunk: just before </DataSource>, after the prolog', () => {
    const xml = COMPRESSED.chunkXml;
    expect(xml).not.toContain('\n');
    expect(xml).not.toContain('DD.Dictionary');
    expect(xml).not.toContain('DD.DICTIONARYREFERENCE');
    const at = findEntryInsertionPoint(xml);
    expect(at).toBe(xml.lastIndexOf(CLOSE));
    expect(xml.slice(0, at!).endsWith('</Object>')).toBe(true);
  });

  it('a multi-line chunk: at the start of the </DataSource> line', () => {
    const xml = ARCH_BINARY.chunkXml;
    expect(xml).not.toContain('DD.Dictionary');
    expect(xml).not.toContain('DD.DICTIONARYREFERENCE');
    expect(xml.endsWith('    </Object>\n' + CLOSE + '\n')).toBe(true);
    const at = findEntryInsertionPoint(xml);
    expect(at).toBe(xml.lastIndexOf(CLOSE));
    expect(xml.slice(0, at!).endsWith('    </Object>\n')).toBe(true);
  });

  it('an indented </DataSource>: at the start of its line', () => {
    const xml = ARCH_BINARY.chunkXml.replace('\n' + CLOSE, '\n  ' + CLOSE);
    expect(xml).not.toBe(ARCH_BINARY.chunkXml);
    expect(findEntryInsertionPoint(xml)).toBe(xml.lastIndexOf('\n  ' + CLOSE) + 1);
  });

  it('</DataSource> after other text on its line: right before the tag', () => {
    const xml = ARCH_BINARY.chunkXml.replace('\n' + CLOSE, ' ' + CLOSE);
    expect(xml).not.toBe(ARCH_BINARY.chunkXml);
    expect(findEntryInsertionPoint(xml)).toBe(xml.lastIndexOf(CLOSE));
  });

  it('an empty <DataSource></DataSource> on one line: between its tags', () => {
    const xml = '<?xml version="1.0" encoding="utf-8"?><DataSource FormatVersion="4">' + CLOSE;
    expect(findEntryInsertionPoint(xml)).toBe(xml.lastIndexOf(CLOSE));
  });

  it('still null with no </DataSource> at all', () => {
    expect(findEntryInsertionPoint(COMPRESSED.chunkXml.replace(CLOSE, ''))).toBeNull();
    expect(findEntryInsertionPoint(ARCH_BINARY.chunkXml.replace(CLOSE, ''))).toBeNull();
    expect(findEntryInsertionPoint('<?xml version="1.0" encoding="utf-8"?><DataSource FormatVersion="4"/>')).toBeNull();
  });
});

describe.each([
  ['compressed.sldd', COMPRESSED],
  ['arch_binary.sldd', ARCH_BINARY],
])('a new entry in %s, whose chunk has no dictionary object', (_name, pkg) => {
  const xml = pkg.chunkXml;

  it('is added from the gallery, before </DataSource>, and saves', () => {
    const { model } = open(xml, pkg.parts);
    const before = namesBySection(model);
    const { newText, selectId } = addNewEntryXml(xml, model.getSection('design'), 'Simulink.Parameter');
    const added = model.getSection('design').children.at(-1);
    expect(selectId).toBe(added.id);
    expect(insertedAt(xml, newText)).toContain(`<P Name="Name" Class="char">${added.name}</P>`);
    expect(chunkNames(newText)).toEqual([...chunkNames(xml), added.name]);

    const reread = open(newText, pkg.parts).model;
    expect(namesBySection(reread)).toEqual({ ...before, design: [...before.design, added.name] });
    expect(reread.getSection('design').children.at(-1).className).toBe('Simulink.Parameter');

    const saved = save(xml, newText, pkg.parts, model);
    expect(namesBySection(saved.model)).toEqual(namesBySection(reread));
    // A save of the re-read dictionary, which nothing has edited since, writes the chunk it read.
    const bytes = (saved.session.serializeSource(saved.srcId) as { bytes: Uint8Array }).bytes;
    expect(readBinarySlddPackage(bytes).chunkXml).toBe(newText);
  });

  it('is pasted, before </DataSource>, and saves', () => {
    const { model } = open(xml, pkg.parts);
    const before = namesBySection(model);
    const source = (model.children as any[]).flatMap((s: any) => s.children as any[])[0];
    const { newText } = pasteEntryXml(xml, model.getSection('design'), source.serialize() as Record<string, unknown>);
    const pasted = model.getSection('design').children.at(-1);
    insertedAt(xml, newText);
    expect(chunkNames(newText)).toEqual([...chunkNames(xml), pasted.name]);
    expect(namesBySection(open(newText, pkg.parts).model)).toEqual({ ...before, design: [...before.design, pasted.name] });
    save(xml, newText, pkg.parts, model);
  });

  it('several dropped at once go in together, in order, before </DataSource>', () => {
    const { model } = open(xml, pkg.parts);
    const source = (model.children as any[]).flatMap((s: any) => s.children as any[])[0];
    const payload = source.serialize() as Record<string, unknown>;
    const { newText, selectIds } = pasteEntriesXml(xml, model.getSection('design'), [payload, payload]);
    expect(selectIds.length).toBe(2);
    const fragment = insertedAt(xml, newText);
    expect(fragment.split(ENTRY_OPEN).length - 1).toBe(2);
    const names = (model.getSection('design').children as any[]).slice(-2).map((e: any) => e.name);
    expect(chunkNames(newText)).toEqual([...chunkNames(xml), ...names]);
    save(xml, newText, pkg.parts, model);
  });

  it('a move into the same file, every entry taken out first, puts them back before </DataSource>', () => {
    // A same-document drop: the host takes the sources out of the text, then pastes them.
    const { model } = open(xml, pkg.parts);
    const entries = (model.children as any[]).flatMap((s: any) => s.children as any[]);
    const payloads = entries.map((e: any) => e.serialize() as Record<string, unknown>);
    const emptied = deleteEntriesByNameXml(xml, entries.map((e: any) => e.name));
    expect(chunkNames(emptied)).toEqual([]);
    const target = open(emptied, pkg.parts).model.getSection('design');
    const { newText } = pasteEntriesXml(emptied, target, payloads);
    insertedAt(emptied, newText);
    expect(chunkNames(newText)).toEqual(entries.map((e: any) => e.name));
  });
});
