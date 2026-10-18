// Copyright 2026 The MathWorks, Inc.
//
// An edited entry of a compressed-binary dictionary is saved as the bytes it was read from, with
// only what the edit changed written from the model (parser/EntryMerge; the maintainer's rulings
// D1-D3 of 2026-10-13, built as S2 in group F).
//
// Every expectation is cut from the file with string slicing, never produced by core's reader:
// the claim is about bytes, and a reader that read two spellings as one value would agree with a
// save that respelled them. What the model writes for the part an edit changed is the writers'
// own business, and is asked of them (regenerateEntryXml) only where a test needs to say which
// part that is.
//
// What it pins:
//   * a rename changes the Name and LastMod lines of the entry and nothing else, a value MATLAB
//     spelled `1.0NaNi` included (D3), and a property the reader does not read is kept (D13);
//   * an edit of one property, one struct field or the elements of a bus or a cell changes that
//     part alone: its siblings, the elements that survive and the open tags around them are the
//     file's bytes, and the elements are paired by where they were read from, never by position
//     (D1);
//   * an edit and its undo give back the bytes with only the LastMod line new (D2);
//   * what cannot be merged with certainty is written from the model whole, as every edited
//     entry was: markup the scan cannot read, a duplicate name, an origin left in the text;
//   * no origin the writers spell for the merge reaches a saved file;
//   * the merge of a 5 MB entry costs a small multiple of writing it from the model;
//   * and the three functions a host that splices chunk text needs: spliceEntryObject,
//     keptPartsViolations and readEntryFragment.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import * as core from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import * as serializer from '../src/datamodel/parser/BinarySlddSerializer.js';
import * as entrySource from '../src/datamodel/parser/EntrySource.js';
import { matlabTimestampNow } from '../src/datamodel/parser/XmlUtils.js';
import { NS_DESIGN } from '../src/datamodel/SectionConstants.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CHUNK = 'data/chunk0.xml';
const DECL = '<?xml version="1.0" encoding="UTF-8"?>';

// The clock is frozen, so the LastMod an edit stamps is one string, and two writes agree.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const text = (u8: Uint8Array): string => new TextDecoder().decode(u8);
const fixture = (...parts: string[]): string => join(HERE, 'fixtures', ...parts);

function open(path: string): { session: any; root: any; xml: string } {
  const bytes = new Uint8Array(readFileSync(path));
  const session = core.createSession();
  const root: any = ingest(session, buffer(bytes), { filename: path.split('/').pop()! });
  session.setActiveContext(root);
  return { session, root, xml: text(unzipSync(bytes)[CHUNK]) };
}

/**
 * A binary fixture as an earlier core save left it: every cell MATLAB wrote with no Dimension, a
 * string's saveobj cell aside, given `Dimension="1*1"`, the spelling the writers gave a 1x1 cell
 * until they wrote it as MATLAB does (cellOneByOneDimension.test.ts). MATLAB reads it as the same
 * value (cell1x1.truth.json). The writers now spell those tags otherwise than the file does, which
 * is what lets a test see a part written from the model where the file's bytes belong.
 */
function openOlderSave(path: string): { session: any; root: any; xml: string } {
  const parts = unzipSync(new Uint8Array(readFileSync(path)));
  const xml = text(parts[CHUNK]).replace(/(<(?:P Name="[^"]*"|Element) Class="cell")>/g, '$1 Dimension="1*1">');
  expect(xml).not.toBe(text(parts[CHUNK]));
  parts[CHUNK] = strToU8(xml);
  const session = core.createSession();
  const root: any = ingest(session, buffer(zipSync(parts)), { filename: path.split('/').pop()! });
  session.setActiveContext(root);
  return { session, root, xml };
}

/** A dictionary read from a chunk, with no package around it. */
function fromChunk(xml: string): { session: any; root: any; xml: string } {
  const session = core.createSession();
  const root: any = session.addDataSource('mem://' + Math.random().toString(36).slice(2), parseBinarySlddParts(xml, {}), { path: 'x.sldd' });
  session.setActiveContext(root);
  return { session, root, xml };
}

const savedChunk = (session: any, root: any): string => text(unzipSync(session.serializeSource(root.name).bytes)[CHUNK]);
const entries = (root: any): any[] => root.children.flatMap((s: any) => s.children);
const entryNamed = (root: any, name: string): any => entries(root).find((e: any) => e.name === name);

/** Where each entry's `<Object>` sits in a chunk: MATLAB's open tag to the first close. */
function spansOf(xml: string): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  for (;;) {
    const s = xml.indexOf('<Object Class="DD.ENTRY">', at);
    if (s < 0) return out;
    const e = xml.indexOf('</Object>', s) + '</Object>'.length;
    out.push([s, e]);
    at = e;
  }
}

/** The span of the entry whose Name line names it. */
function spanOf(xml: string, name: string): [number, number] {
  const span = spansOf(xml).find(([s, e]) => xml.slice(s, e).includes(`<P Name="Name" Class="char">${name}</P>`));
  expect(span, `an entry named ${name}`).toBeDefined();
  return span!;
}
const objectOf = (xml: string, name: string): string => xml.slice(...spanOf(xml, name));

/** `object` with its Name line naming `name`, and its LastMod line the frozen clock's stamp. */
function renamedAndStamped(object: string, name: string | null): string {
  let out = object.replace(/<P Name="LastMod" Class="char">[^<]*<\/P>/, `<P Name="LastMod" Class="char">${matlabTimestampNow()}</P>`);
  if (name !== null) {
    out = out.replace(/<P Name="Name" Class="char">[^<]*<\/P>/, `<P Name="Name" Class="char">${name}</P>`);
  }
  return out;
}

/** `xml` with the entry `name`'s object replaced. */
function withObject(xml: string, name: string, object: string): string {
  const [s, e] = spanOf(xml, name);
  return xml.slice(0, s) + object + xml.slice(e);
}

/** The writers' text for an entry's object, as the save lays a regenerated entry out in an LF chunk indented by four. */
const regenerated = (entry: any): string => serializer.regenerateEntryXml(entry).slice(4, -1);

// An entry as MATLAB lays one out, around a Value of our choosing, indented by four.
function entryXml(name: string, uuid: string, value: string): string {
  return '    <Object Class="DD.ENTRY">\n'
    + `        <P Name="Name" Class="char">${name}</P>\n`
    + `        <P Name="UUID" Class="char">${uuid}</P>\n`
    + `        <P Name="Namespace" Class="char">${NS_DESIGN}</P>\n`
    + '        <P Name="LastMod" Class="char">20260101T000000.000000</P>\n'
    + '        <P Name="LastModBy" Class="char">u</P>\n'
    + '        <P Name="IsDerived" Class="char">0</P>\n'
    + `        ${value}\n`
    + '    </Object>\n';
}
const DICTIONARY = '    <Object Class="DD.Dictionary">\n        <P Name="AccessBaseWorkspace" Class="logical">0</P>\n    </Object>\n';
const chunk = (body: string): string => `${DECL}\n<DataSource FormatVersion="1" MinRelease="R2014a">\n${body}${DICTIONARY}</DataSource>\n`;

describe('a rename changes only the Name and LastMod lines', () => {
  it('of every entry of cellarr_binary.sldd as an earlier save left it, eleven of whose fourteen the writers spell otherwise', () => {
    const { xml, root: probe } = openOlderSave(fixture('cellarr_binary.sldd'));
    const names = entries(probe).map((e: any) => e.name);
    expect(names.length).toBe(14);
    let respelled = 0;
    for (const name of names) {
      const { session, root } = openOlderSave(fixture('cellarr_binary.sldd'));
      const entry = entryNamed(root, name);
      expect(entry.setProperty('Name', name + 'Renamed')).toBe(true);
      const expected = renamedAndStamped(objectOf(xml, name), name + 'Renamed');
      if (regenerated(entry) !== expected) respelled++;
      expect(savedChunk(session, root), name).toBe(withObject(xml, name, expected));
    }
    expect(respelled).toBeGreaterThanOrEqual(11);
  });

  it('and an untouched `1.0NaNi`, which the writers spell `1.0+NaNi`, is kept as MATLAB wrote it (D3)', () => {
    const { session, root, xml } = open(fixture('mcos', 'complex_binary.sldd'));
    const entry = entryNamed(root, 'pNonFinite');
    const before = objectOf(xml, 'pNonFinite');
    expect(before).toContain('Inf-Infi NaN+1.0i 1.0NaNi -Inf+2.0i');
    expect(entry.setProperty('Name', 'pNonFiniteRenamed')).toBe(true);
    expect(regenerated(entry)).toContain('1.0+NaNi');
    const out = savedChunk(session, root);
    expect(objectOf(out, 'pNonFiniteRenamed')).toBe(renamedAndStamped(before, 'pNonFiniteRenamed'));
    expect(serializer.serializeEntryToXml(entry)).toBe('    ' + renamedAndStamped(before, 'pNonFiniteRenamed') + '\n');
  });

  it('and a property the reader does not read, which no model writes, is kept as it is (D13)', () => {
    const unread = '<P Name="Unread" Class="char">kept as read</P>';
    const xml = chunk(entryXml('a', 'u-a', '<P Name="Value" Class="double">1.0E+6</P>')
      .replace('        <P Name="IsDerived"', `        ${unread}\n        <P Name="IsDerived"`));
    const { session, root } = fromChunk(xml);
    const entry = entryNamed(root, 'a');
    expect(entry.setProperty('Name', 'aRenamed')).toBe(true);
    // The entry is merged property by property, and the writers write none of it.
    expect(regenerated(entry)).not.toContain('Unread');
    expect(regenerated(entry)).toContain('<P Name="Value" Class="double">1000000.0</P>');
    expect(objectOf(xml, 'a')).toContain(unread);
    expect(objectOf(savedChunk(session, root), 'aRenamed')).toBe(renamedAndStamped(objectOf(xml, 'a'), 'aRenamed'));
  });
});

describe('an edit of one property keeps the bytes of every other', () => {
  // A Simulink.Parameter as a hand edit or another tool might leave it: every sibling of the
  // property edited spelled otherwise than the writers spell it, each read as the writers' own
  // spelling is (`1.0E+10` is written `10000000000.0`, an empty char `/>`, and a Description
  // past 512 characters gains its Dimension).
  const LONG = 'a description of six hundred characters '.repeat(15);
  const element = [
    '<P Name="Value">',
    '            <Element Class="Simulink.Parameter">',
    '                <P Name="Value" Class="double">1.0E-5</P>',
    '                <P Name="Min" Class="double">-1.0E-5</P>',
    '                <P Name="Max" Class="double">1.0E+10</P>',
    `                <P Name="Description" Class="char">${LONG}</P>`,
    '                <P Name="DataType" Class="char">auto</P>',
    '                <P Name="Unit" Class="char"></P>',
    '            </Element>',
    '        </P>',
  ].join('\n');
  const xml = chunk(entryXml('p', 'u-p', element) + entryXml('q', 'u-q', '<P Name="Value" Class="double">1.0E+6</P>'));

  it('a Description edit: the numbers, the empty Unit and the rest are the file\'s', () => {
    expect(LONG.length).toBe(600);
    const { session, root } = fromChunk(xml);
    const p = entryNamed(root, 'p');
    session.setActive(root, p);
    expect(session.editProperty(p.id, 'Description', 'short now')).toBe(true);
    const before = objectOf(xml, 'p');
    const expected = renamedAndStamped(before, null).replace(
      `<P Name="Description" Class="char">${LONG}</P>`,
      '<P Name="Description" Class="char">short now</P>',
    );
    expect(regenerated(p)).not.toBe(expected);
    expect(savedChunk(session, root)).toBe(withObject(xml, 'p', expected));
  });

  it('a Min edit: the 600-character Description keeps the bytes it was read as', () => {
    const { session, root } = fromChunk(xml);
    const p = entryNamed(root, 'p');
    expect(p.setProperty('Min', '-2')).toBe(true);
    const out = objectOf(savedChunk(session, root), 'p');
    const before = objectOf(xml, 'p');
    const changed = out.split('\n').filter((line) => !before.split('\n').includes(line)).map((l) => l.trim());
    expect(changed).toEqual([`<P Name="LastMod" Class="char">${matlabTimestampNow()}</P>`, '<P Name="Min" Class="double">-2.0</P>']);
    expect(out).toContain(`<P Name="Description" Class="char">${LONG}</P>`);
    expect(out).toContain('<P Name="Max" Class="double">1.0E+10</P>');
  });
});

describe('a struct field edit changes only that field', () => {
  it('cellarr_binary.sldd\'s cStructArr{1}(2).a, inside a cell whose open tag the writers respell', () => {
    const { session, root, xml } = openOlderSave(fixture('cellarr_binary.sldd'));
    const entry = entryNamed(root, 'cStructArr');
    const field = entry.children[0].children[1].children[0];
    expect(field.name).toBe('a');
    session.setActive(root, field);
    expect(session.editProperty(field.id, 'Value', '5')).toBe(true);
    const before = objectOf(xml, 'cStructArr');
    const second = before.lastIndexOf('<P Name="a" Class="double">2.0</P>');
    const expected = renamedAndStamped(before.slice(0, second) + '<P Name="a" Class="double">5.0</P>' + before.slice(second + '<P Name="a" Class="double">2.0</P>'.length), null);
    expect(before).toContain('<P Name="Value" Class="cell" Dimension="1*1">');
    expect(regenerated(entry)).toContain('<P Name="Value" Class="cell">');
    expect(savedChunk(session, root)).toBe(withObject(xml, 'cStructArr', expected));
  });
});

describe('a bus\'s elements are paired by where they were read from, never by position (D1)', () => {
  // bus_types_binary.sldd's btBus, four elements, with the empty Description of the second and
  // the fourth spelled `></P>` rather than MATLAB's `/>` (which a hand edit may do, and which reads
  // the same), so that a survivor written from the model shows, and so does a survivor merged with
  // the element read at its new place rather than with the one it was read as: every removal
  // below that moves an element moves a `></P>` onto a `/>` or the other way round. Were all four
  // respelled alike, an element paired by position would get the same text from the wrong one.
  const EMPTY = '<P Name="Description" Class="char"/>';
  const RESPELT = '<P Name="Description" Class="char"></P>';
  const { xml: file } = open(fixture('bus_types_binary.sldd'));
  const original = objectOf(file, 'btBus');
  const busObject = original.split(EMPTY).reduce((acc, piece, k) => acc + (k === 2 || k === 4 ? RESPELT : EMPTY) + piece);
  const xml = file.replace(original, busObject);
  // Each element's `<Element …>…</Element>` with the whitespace before it.
  const elements = (object: string): string[] => {
    const out: string[] = [];
    let at = 0;
    for (;;) {
      const s = object.indexOf('<Element Class="Simulink.BusElement">', at);
      if (s < 0) return out;
      const e = object.indexOf('</Element>', s) + '</Element>'.length;
      out.push(object.slice(object.lastIndexOf('\n', s), e));
      at = e;
    }
  };
  const ORIGINAL = elements(busObject);
  // The object with only these elements, in this order, under a Dimension of their count.
  const keeping = (kept: number[], extra = ''): string => {
    const first = busObject.indexOf(ORIGINAL[0]);
    const last = busObject.indexOf(ORIGINAL[3]) + ORIGINAL[3].length;
    const body = kept.map((k) => ORIGINAL[k]).join('') + extra;
    const count = kept.length + (extra ? 1 : 0);
    return renamedAndStamped(busObject.slice(0, first) + body + busObject.slice(last), null)
      .replace('<P Name="Elements_internal" Dimension="4*1">', `<P Name="Elements_internal" Dimension="${count}*1">`);
  };
  const busIn = (root: any): any => entryNamed(root, 'btBus');

  for (const [label, removed] of [['the first', [0]], ['a middle one', [1]], ['the first and the third', [0, 2]], ['the last', [3]]] as [string, number[]][]) {
    it(`removing ${label}: the survivors are their bytes, under the model's Dimension`, () => {
      const { session, root } = fromChunk(xml);
      const bus = busIn(root);
      // Four elements, the second and the fourth spelled as the writers do not spell them.
      expect(ORIGINAL.length).toBe(4);
      expect(ORIGINAL.map((e) => e.includes(RESPELT))).toEqual([false, true, false, true]);
      expect(ORIGINAL.map((e) => e.includes(EMPTY))).toEqual([true, false, true, false]);
      expect(bus.children.map((c: any) => c.name)).toEqual(['plain', 'aliased', 'geared', 'matrix']);
      expect(regenerated(bus)).not.toContain(RESPELT);
      const victims = removed.map((k) => bus.children[k]);
      for (const v of victims) expect(session.deleteNodeById(v.id)).toBe(true);
      const kept = [0, 1, 2, 3].filter((k) => !removed.includes(k));
      expect(savedChunk(session, root)).toBe(withObject(xml, 'btBus', keeping(kept)));
    });
  }

  it('adding one: the four are their bytes, and the new one, written from the model, follows them', () => {
    const { session, root } = fromChunk(xml);
    const bus = busIn(root);
    const added = session.addChildTo(bus.id);
    expect(added).not.toBeNull();
    const out = objectOf(savedChunk(session, root), 'btBus');
    const written = elements(out);
    expect(written.slice(0, 4)).toEqual(ORIGINAL);
    expect(written.length).toBe(5);
    expect(written[4]).toContain(`<P Name="Name" Class="char">${added.name}</P>`);
    expect(out).toContain('<P Name="Elements_internal" Dimension="5*1">');
    expect(out.replace(written[4], '')).toBe(keeping([0, 1, 2, 3]).replace('Dimension="4*1"', 'Dimension="5*1"'));
  });

  it('removing the first and editing what is now first edits the element read second', () => {
    const { session, root } = fromChunk(xml);
    const bus = busIn(root);
    expect(session.deleteNodeById(bus.children[0].id)).toBe(true);
    const now = bus.children[0];
    expect(now.name).toBe('aliased');
    session.setActive(root, now);
    expect(session.editProperty(now.id, 'Description', 'the second, edited')).toBe(true);
    const edited = ORIGINAL[1].replace(RESPELT, '<P Name="Description" Class="char">the second, edited</P>');
    const expected = keeping([1, 2, 3]).replace(ORIGINAL[1], edited);
    expect(savedChunk(session, root)).toBe(withObject(xml, 'btBus', expected));
  });

  it('an element removed and restored by undo: the bytes, the LastMod line new (D2)', () => {
    const { session, root } = fromChunk(xml);
    const bus = busIn(root);
    expect(session.deleteNodeById(bus.children[1].id)).toBe(true);
    session.undo();
    expect(bus.children.length).toBe(4);
    expect(savedChunk(session, root)).toBe(withObject(xml, 'btBus', keeping([0, 1, 2, 3])));
  });
});

describe('a cell\'s elements are paired by where they were read from, never by position (D1)', () => {
  // The parity artifact cases.sldd's cellNest, {1.0, {2.0, {3.0}}}, as an earlier save left it:
  // its innermost cell, 1x1, says `Dimension="1*1"`, where the writers spell none, as MATLAB does.
  // Removing the 1.0 moves the nested cell from the second place to the first: it keeps its bytes
  // only if it is merged with the element it was read as, not with the 1.0 that was read first.
  const CASES = join(HERE, 'parity', 'artifacts', 'binary', 'cases.sldd');
  const FIRST = '\n            <Element Class="double">1.0</Element>';

  it('removing the first: the nested cell that survives is its bytes, under the model\'s Dimension', () => {
    const { session, root, xml } = openOlderSave(CASES);
    const entry = entryNamed(root, 'cellNest');
    const before = objectOf(xml, 'cellNest');
    expect(before.split(FIRST).length).toBe(2);
    expect(before).toContain('<Element Class="cell" Dimension="1*1">');
    expect(entry.children.length).toBe(2);
    expect(session.deleteNodeById(entry.children[0].id)).toBe(true);
    expect(entry.children.length).toBe(1);
    // The writers spell the survivor's innermost cell otherwise than the file does.
    expect(regenerated(entry)).toContain('<Element Class="cell">');
    expect(regenerated(entry)).not.toContain('Dimension="1*1"');
    const expected = renamedAndStamped(before.replace(FIRST, ''), null)
      .replace('<P Name="Value" Class="cell" Dimension="1*2">', '<P Name="Value" Class="cell">');
    expect(savedChunk(session, root)).toBe(withObject(xml, 'cellNest', expected));
  });
});

describe('an edit and its undo give back the bytes, the LastMod line new (D2)', () => {
  it('a struct field in a cell, edited and undone', () => {
    const { session, root, xml } = openOlderSave(fixture('cellarr_binary.sldd'));
    const entry = entryNamed(root, 'cStructArr');
    const field = entry.children[0].children[1].children[0];
    session.setActive(root, field);
    expect(session.editProperty(field.id, 'Value', '5')).toBe(true);
    session.undo();
    expect(entry.status).toBe('Modified');
    const expected = renamedAndStamped(objectOf(xml, 'cStructArr'), null);
    expect(expected).not.toBe(objectOf(xml, 'cStructArr'));
    expect(savedChunk(session, root)).toBe(withObject(xml, 'cStructArr', expected));
  });
});

describe('what cannot be merged with certainty is written from the model whole', () => {
  // Each beside a control, the same entry without what stops the merge, which keeps its bytes.
  const renamedOut = (xml: string): { out: string; entry: any } => {
    const { session, root } = fromChunk(xml);
    const entry = entryNamed(root, 'a');
    expect(entry.setProperty('Name', 'aRenamed')).toBe(true);
    return { out: objectOf(savedChunk(session, root), 'aRenamed'), entry };
  };

  it('an entry holding markup the scan does not read (a processing instruction)', () => {
    const plain = chunk(entryXml('a', 'u-a', '<P Name="Value" Class="double">1.0E+6</P>'));
    expect(renamedOut(plain).out).toBe(renamedAndStamped(objectOf(plain, 'a'), 'aRenamed'));
    const xml = plain.replace('        <P Name="UUID"', '        <?dex kept?>\n        <P Name="UUID"');
    const { out, entry } = renamedOut(xml);
    expect(entrySource.entrySourceOf(entry)?.fragment).toBe(objectOf(xml, 'a'));
    expect(objectOf(xml, 'a')).toContain('<?dex kept?>');
    expect(out).toBe(regenerated(entry));
  });

  it('a parent with a duplicate Name: that parent is the model\'s, and its siblings are the file\'s', () => {
    const value = [
      '<P Name="Value">',
      '            <Element Class="Simulink.Parameter">',
      '                <P Name="Value" Class="double">1.0E+6</P>',
      '                <P Name="Description" Class="char">one</P>',
      '                <P Name="Description" Class="char">two</P>',
      '            </Element>',
      '        </P>',
    ].join('\n');
    const xml = chunk(entryXml('p', 'u-p', value));
    // Renamed, the parent is nobody's edit: kept with both its Descriptions, as read (D13).
    {
      const { session, root } = fromChunk(xml);
      expect(entryNamed(root, 'p').setProperty('Name', 'pRenamed')).toBe(true);
      expect(objectOf(savedChunk(session, root), 'pRenamed')).toBe(renamedAndStamped(objectOf(xml, 'p'), 'pRenamed'));
    }
    // An edit inside it writes the element whole from the model.
    const { session, root } = fromChunk(xml);
    const p = entryNamed(root, 'p');
    expect(p.setProperty('Name', 'pRenamed')).toBe(true);
    session.setActive(root, p);
    expect(session.editProperty(p.id, 'Description', 'three')).toBe(true);
    const out = objectOf(savedChunk(session, root), 'pRenamed');
    const fromModel = regenerated(p);
    const element = (object: string): string => object.slice(object.indexOf('<Element'), object.lastIndexOf('</Element>') + '</Element>'.length);
    expect(element(out)).toBe(element(fromModel));
    expect(out).toContain('<P Name="Value" Class="double">1000000.0</P>');
    expect(out.replace(element(out), '')).toBe(renamedAndStamped(objectOf(xml, 'p'), 'pRenamed').replace(element(objectOf(xml, 'p')), ''));
  });

  it('bytes that spell the origin attribute the merge pairs by', () => {
    // An attribute the reader does not read is kept in a part nobody edited (D13)...
    const other = chunk(entryXml('a', 'u-a', '<P Name="Value" Class="double" dex-other="0">1.0E+6</P>'));
    expect(renamedOut(other).out).toBe(renamedAndStamped(objectOf(other, 'a'), 'aRenamed'));
    // ...but not the merge's own: the entry is the model's, and no origin is written.
    const xml = chunk(entryXml('a', 'u-a', `<P Name="Value" Class="double" ${entrySource.ORIGIN_ATTR}="0">1.0E+6</P>`));
    const { out, entry } = renamedOut(xml);
    expect(out).toBe(regenerated(entry));
    expect(out).not.toContain('dex-core-origin');
  });
});

function binaryDictionaries(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.sldd')) {
        const head = readFileSync(p).subarray(0, 2);
        if (head[0] === 0x50 && head[1] === 0x4b) out.push(p);
      }
    }
  };
  walk(join(HERE, 'fixtures'));
  walk(join(HERE, 'parity', 'artifacts'));
  return out.sort();
}

describe('no origin reaches a saved file', () => {
  it('of any binary fixture, every entry renamed, and every entry with children losing its first', () => {
    const files = binaryDictionaries();
    expect(files.length).toBeGreaterThanOrEqual(22);
    // And the cell fixtures as an earlier save left them, since the writers now spell their 1x1
    // cells as MATLAB does: without them, few entries' merge differs from their regeneration.
    const opens: [string, () => { session: any; root: any }][] = [
      ...files.map((path): [string, () => { session: any; root: any }] => [path, () => open(path)]),
      ...['cellarr_binary.sldd', 'cellstr_binary.sldd', 'typed_binary.sldd'].map((name): [string, () => { session: any; root: any }] => [`${name} as an earlier save left it`, () => openOlderSave(fixture(name))]),
    ];
    let merged = 0;
    for (const [path, opened] of opens) {
      for (const edit of ['rename', 'remove'] as const) {
        const { session, root } = opened();
        for (const entry of entries(root)) {
          if (edit === 'rename') entry.setProperty('Name', entry.name + 'S2');
          else if (entry.children?.length > 1 && entry.canRemoveChild?.()) session.deleteNodeById(entry.children[0].id);
        }
        const saved = unzipSync(session.serializeSource(root.name).bytes);
        for (const [name, bytes] of Object.entries(saved)) {
          expect(text(bytes).includes(entrySource.ORIGIN_ATTR), `${path} ${edit} ${name}`).toBe(false);
        }
        for (const entry of entries(root)) {
          if (entry.status !== 'Modified' || !entrySource.entrySourceOf(entry)?.fragment) continue;
          const written = serializer.serializeEntryToXml(entry);
          expect(written.includes(entrySource.ORIGIN_ATTR)).toBe(false);
          if (written !== serializer.regenerateEntryXml(entry)) merged++;
        }
      }
    }
    // Not vacuous: entries whose merge differs from their regeneration were written.
    expect(merged).toBeGreaterThan(30);
  });
});

describe('the merge of a large entry', () => {
  it('a rename of a 5 MB bus costs a small multiple of writing it from the model', () => {
    vi.useRealTimers();
    const element = (i: number): string => [
      '                    <Element Class="Simulink.BusElement">',
      '                        <P Name="Min_internal" Class="double" Dimension="0*0"/>',
      '                        <P Name="Max_internal" Class="double" Dimension="0*0"/>',
      '                        <P Name="DimensionsMode" Class="char">Fixed</P>',
      '                        <P Name="SamplingMode" Class="char">Sample based</P>',
      '                        <P Name="SampleTime" Class="double">-1.0</P>',
      `                        <P Name="Description" Class="char">element number ${i} of a large bus</P>`,
      '                        <P Name="DocUnits" Class="char"></P>',
      `                        <P Name="Name" Class="char">e${i}</P>`,
      '                        <P Name="DataType_internal" Class="char">double</P>',
      '                        <P Name="Complexity" Class="char">real</P>',
      '                        <P Name="Dimensions" Class="double">1.0</P>',
      '                    </Element>\n',
    ].join('\n');
    const N = 6000;
    let body = '';
    for (let i = 0; i < N; i++) body += element(i);
    const value = '<P Name="Value">\n            <Element Class="Simulink.Bus">\n                <P Name="Alignment" Class="double">-1.0</P>\n'
      + `                <P Name="Elements_internal" Dimension="${N}*1">\n${body}                </P>\n            </Element>\n        </P>`;
    const xml = chunk(entryXml('big', 'u-big', value));
    expect(xml.length).toBeGreaterThan(5_000_000);
    const { root } = fromChunk(xml);
    const entry = entryNamed(root, 'big');
    const time = (fn: () => unknown): number => {
      const t = performance.now();
      fn();
      return performance.now() - t;
    };
    const regenerate = Math.min(time(() => serializer.regenerateEntryXml(entry)), time(() => serializer.regenerateEntryXml(entry)));
    expect(entry.setProperty('Name', 'bigRenamed')).toBe(true);
    let written = '';
    const first = time(() => { written = serializer.serializeEntryToXml(entry); });
    const again = time(() => serializer.serializeEntryToXml(entry));
    expect(written).toBe('    ' + objectOf(xml, 'big').replace('<P Name="Name" Class="char">big</P>', '<P Name="Name" Class="char">bigRenamed</P>')
      .replace(/<P Name="LastMod" Class="char">[^<]*<\/P>/, /<P Name="LastMod" Class="char">[^<]*<\/P>/.exec(written)![0]) + '\n');
    // Measured on the development machine: regenerate 70 ms; the first merged write 490 ms (it
    // reads the bytes again for B, which is then kept), each later one 300-340 ms. The bounds
    // leave room for a loaded machine without letting a quadratic merge through.
    expect(first, `first ${first} ms against a regeneration of ${regenerate} ms`).toBeLessThan(25 * regenerate + 1000);
    expect(again, `again ${again} ms against a regeneration of ${regenerate} ms`).toBeLessThan(15 * regenerate + 500);
  }, 120_000);
});

describe('for a host that splices chunk text (D12)', () => {
  // Three renames of one entry, each spliced into the chunk the last one left, in a chunk laid out
  // with LF and four spaces, one written on one line, and one with CRLF and two spaces.
  const crlf = (xml: string): string => xml.replace(/\n( *)/g, (_m, s: string) => '\r\n' + ' '.repeat(s.length / 2));
  const layouts: [string, () => { session: any; root: any; xml: string }][] = [
    ['LF, four spaces', () => openOlderSave(fixture('cellarr_binary.sldd'))],
    ['one line', () => open(fixture('object_array_binary.sldd'))],
    ['CRLF, two spaces', () => fromChunk(crlf(openOlderSave(fixture('cellarr_binary.sldd')).xml))],
  ];
  for (const [label, make] of layouts) {
    it(`spliceEntryObject keeps every byte around the entry, ${label}`, () => {
      const { root, xml } = make();
      const target = entries(root)[0];
      const original = target.name;
      const [s, e] = spanOf(xml, original);
      let current = xml;
      let name = original;
      for (let i = 1; i <= 3; i++) {
        const before = name;
        name = original + 'R' + i;
        expect(target.setProperty('Name', name)).toBe(true);
        const next = core.spliceEntryObject(current, target, before);
        expect(next).not.toBeNull();
        current = next!;
      }
      const before = xml.slice(s, e);
      // The bytes before and after the entry, and the entry's: its Name and LastMod lines new, or,
      // for an entry read with no LastMod line (object_array_binary.sldd's), the model's after
      // its Namespace line.
      const namespace = /<P Name="Namespace" Class="char">[^<]*<\/P>/.exec(before)![0];
      const object = /<P Name="LastMod"/.test(before)
        ? renamedAndStamped(before, name)
        : before.replace(`>${original}</P>`, `>${name}</P>`).replace(namespace, namespace + `<P Name="LastMod" Class="char">${matlabTimestampNow()}</P>`);
      expect(current).toBe(xml.slice(0, s) + object + xml.slice(e));
    });
  }

  it('spliceEntryObject answers null for an entry the chunk does not hold', () => {
    const { root, xml } = open(fixture('cellarr_binary.sldd'));
    expect(core.spliceEntryObject(xml, entries(root)[0], 'noSuchEntry')).toBeNull();
  });

  it('keptPartsViolations: none for what the save writes, and the path of an untouched part changed', () => {
    const { session, root, xml } = openOlderSave(fixture('cellarr_binary.sldd'));
    const unedited = entryNamed(root, 'cStruct');
    expect(core.keptPartsViolations(unedited, objectOf(xml, 'cStruct'))).toEqual([]);
    expect(core.keptPartsViolations(unedited, objectOf(xml, 'cStruct').replace('IsDerived" Class="char">0', 'IsDerived" Class="char">1'))).toEqual([
      'the entry, which nobody edited, is not the bytes it was read from',
    ]);
    const entry = entryNamed(root, 'cStructArr');
    const field = entry.children[0].children[1].children[0];
    session.setActive(root, field);
    expect(session.editProperty(field.id, 'Value', '5')).toBe(true);
    const written = objectOf(savedChunk(session, root), 'cStructArr');
    expect(core.keptPartsViolations(entry, written)).toEqual([]);
    // The edited field may be anything; an untouched one may not.
    expect(core.keptPartsViolations(entry, written.replace('<P Name="a" Class="double">5.0</P>', '<P Name="a" Class="double">6.0</P>'))).toEqual([]);
    expect(core.keptPartsViolations(entry, written.replace('<P Name="a" Class="double">1.0</P>', '<P Name="a" Class="double">1.5</P>'))).toEqual([
      'P[Value]/Element[0]/Element[0]',
    ]);
    expect(core.keptPartsViolations(entry, written.replace('<P Name="UUID" Class="char">', '<P Name="UUID" Class="char">x'))).toEqual(['P[UUID]']);
    // The regenerated entry, whose cell open tag the writers spell otherwise than the file, changes an untouched part.
    expect(core.keptPartsViolations(entry, regenerated(entry))).toEqual(['P[Value] (open tag)']);
  });

  it('readEntryFragment rebuilds an entry with the bytes it came from, as an undo that rebuilds from text does', () => {
    const { session, root, xml } = openOlderSave(fixture('cellarr_binary.sldd'));
    const old = entryNamed(root, 'cObjArr');
    const section = old.parent;
    const fragment = objectOf(xml, 'cObjArr');
    section.removeChild(old);
    const rebuilt = core.readEntryFragment(fragment, { section, inheritPlaceFrom: old }) as any;
    expect(rebuilt).not.toBeNull();
    expect(rebuilt.parent).toBe(section);
    expect(serializer.serializeEntryToXml(rebuilt)).toBe('    ' + fragment + '\n');
    expect(savedChunk(session, root)).toBe(xml);
    // And edited, it merges with those bytes.
    expect(rebuilt.setProperty('Name', 'cObjArrRenamed')).toBe(true);
    expect(objectOf(savedChunk(session, root), 'cObjArrRenamed')).toBe(renamedAndStamped(fragment, 'cObjArrRenamed'));
    // On its own, it is read into a dictionary nothing else holds, and holds no place.
    const alone = core.readEntryFragment(fragment) as any;
    expect(alone.name).toBe('cObjArr');
    expect(alone.parent?.parent).not.toBe(root);
    expect(core.readEntryFragment('<Object Class="DD.ENTRY">')).toBeNull();
  });
});
