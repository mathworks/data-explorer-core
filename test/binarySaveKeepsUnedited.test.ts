// Copyright 2026 The MathWorks, Inc.
//
// A save of a compressed-binary dictionary writes what nobody edited as the bytes it was
// read from (BinarySlddSerializer, parser/EntrySource).
//
// Every assertion below is made against the FILE, read here with fflate and string
// searches, never against core's own reader: the claim is about bytes, and a reader that
// read two spellings as one value would agree with a save that respelled them.
//
// What it pins:
//   * a save that edits nothing gives back every member of every binary dictionary in the
//     fixtures and the parity artifacts, byte for byte;
//   * an edited, deleted or added entry changes only itself: every other entry is its own
//     bytes in its own place, an added one goes after the last entry the file had and
//     before the dictionary-level objects, and those objects are regenerated only when the
//     fields they hold changed;
//   * the bytes are claimed only by what the reader paired and verified: a record (a
//     paste, a host's undo record, a JSON copy of the content) is regenerated, and a chunk
//     whose spans cannot be paired with its entries is regenerated whole, as before;
//   * and only while the entry still says what they say: a raw entry changed before the model
//     is built, or a node whose name, metadata or section is changed around the API, is
//     written from the model in its own place;
//   * an entry's span is its element, found by its tags: text that spells a tag in a comment,
//     an instruction, a CDATA section or an attribute value neither ends nor nests it, and
//     every save of such a chunk is well-formed;
//   * every edit path marks its entry, since the mark is what decides it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { XMLValidator } from 'fast-xml-parser';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { entrySpans, parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import { readDictionaryXmlFast, type ReadEntrySpans } from '../src/datamodel/parser/DictionaryXmlFast.js';
import * as serializer from '../src/datamodel/parser/BinarySlddSerializer.js';
import * as layout from '../src/datamodel/parser/ChunkLayout.js';
import { DATA_PART_KEY, TEXT_CONTENT, TEXT_PARTS } from '../src/datamodel/parser/SlddParts.js';
import { WRITTEN_METADATA } from '../src/datamodel/parser/EntrySource.js';
import { NS_DESIGN, NS_OTHER } from '../src/datamodel/SectionConstants.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CHUNK = 'data/chunk0.xml';
const DECL = '<?xml version="1.0" encoding="UTF-8"?>';

// The clock is frozen for every case in this file. An entry written from the model carries the
// LastMod it was read with, and one with none (every entry of object_array_binary.sldd and of
// compressed.sldd) is stamped with the time now, to the second (regenerateEntryXml). So two
// writes of such an entry that straddled a second boundary differed, and every comparison of
// two of them here — the sweep's audit of each round against the file as opened, a forged
// record against its own regeneration, a chunk regenerated whole against its save — failed
// whenever the clock crossed one in between, which a loaded machine does now and then.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const text = (u8: Uint8Array): string => new TextDecoder().decode(u8);

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
const BINARY = binaryDictionaries();

function open(path: string): { session: any; root: any; bytes: Uint8Array } {
  const bytes = new Uint8Array(readFileSync(path));
  const session = createSession();
  const root: any = ingest(session, buffer(bytes), { filename: path.split('/').pop()! });
  return { session, root, bytes };
}

/** A dictionary read from a chunk, with no package around it. */
function fromChunk(xml: string, session: any = createSession()): { session: any; root: any } {
  const root: any = session.addDataSource('mem://' + Math.random().toString(36).slice(2), parseBinarySlddParts(xml, {}), { path: 'x.sldd' });
  return { session, root };
}

const savedChunk = (session: any, root: any): string => text(unzipSync(session.serializeSource(root.name).bytes)[CHUNK]);

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

const entries = (root: any): any[] => root.children.flatMap((s: any) => s.children);

// An entry as MATLAB writes one, with a Value the writers spell differently (`1.0E+6` is
// written back from the model as `1000000.0`), so a regenerated entry is never mistaken
// for a kept one.
function entryXml(name: string, uuid: string, namespace: string, value = '1.0E+6', indent = '    ', nl = '\n'): string {
  const p = indent + '    ';
  return `${indent}<Object Class="DD.ENTRY">${nl}`
    + `${p}<P Name="Name" Class="char">${name}</P>${nl}`
    + `${p}<P Name="UUID" Class="char">${uuid}</P>${nl}`
    + `${p}<P Name="Namespace" Class="char">${namespace}</P>${nl}`
    + `${p}<P Name="LastMod" Class="char">20260101T000000.000000</P>${nl}`
    + `${p}<P Name="LastModBy" Class="char">u</P>${nl}`
    + `${p}<P Name="IsDerived" Class="char">0</P>${nl}`
    + `${p}<P Name="Value" Class="double">${value}</P>${nl}`
    + `${indent}</Object>${nl}`;
}
const DICTIONARY = '    <Object Class="DD.Dictionary">\n        <P Name="AccessBaseWorkspace" Class="logical">0</P>\n    </Object>\n';
const chunk = (body: string, tail = '</DataSource>\n'): string =>
  `${DECL}\n<DataSource FormatVersion="1" MinRelease="R2014a" Arch="maca64">\n${body}${tail}`;

describe('the dictionaries these tests read', () => {
  it('are every binary dictionary in the fixtures and the parity artifacts', () => {
    expect(BINARY.length).toBeGreaterThanOrEqual(22);
  });

  it('include ones a save from the model would rewrite, so identity below is not vacuous', () => {
    const rewritten = BINARY.filter((path) => {
      const { root, bytes } = open(path);
      return serializer.regenerateChunkXml(root) !== text(unzipSync(bytes)[CHUNK]);
    });
    expect(rewritten.length).toBeGreaterThanOrEqual(9);
  });
});

describe('a save that edits nothing writes every member of the package back as it was read', () => {
  for (const path of BINARY) {
    it(relative(HERE, path), () => {
      const { session, root, bytes } = open(path);
      const before = unzipSync(bytes);
      const after = unzipSync(session.serializeSource(root.name).bytes);
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
      expect(text(after[CHUNK])).toBe(text(before[CHUNK]));
      for (const name of Object.keys(before)) {
        expect(Buffer.from(after[name]).equals(Buffer.from(before[name])), name).toBe(true);
      }
    });
  }

  it('and the one-entry fragment of an unedited entry is its bytes, as a line', () => {
    const { root, bytes } = open(join(HERE, 'fixtures', 'mcos', 'complex_binary.sldd'));
    const xml = text(unzipSync(bytes)[CHUNK]);
    const spans = spansOf(xml);
    const all = entries(root);
    expect(all.length).toBe(spans.length);
    all.forEach((entry: any, i: number) => {
      expect(serializer.serializeEntryToXml(entry)).toBe('    ' + xml.slice(spans[i][0], spans[i][1]) + '\n');
    });
  });
});

describe('the frame of the chunk is kept', () => {
  it('entries of different sections stay in the order the file has them', () => {
    // Design, Other, Design: written from the model, the Other entry moved behind both.
    const xml = chunk(
      entryXml('a', 'u-a', NS_DESIGN) + entryXml('o', 'u-o', NS_OTHER) + entryXml('b', 'u-b', NS_DESIGN) + DICTIONARY,
    );
    const { session, root } = fromChunk(xml);
    expect(root.getSection('other').children.map((e: any) => e.name)).toEqual(['o']);
    expect(savedChunk(session, root)).toBe(xml);
    const regenerated = serializer.regenerateChunkXml(root);
    expect(regenerated.indexOf('>o</P>')).toBeGreaterThan(regenerated.indexOf('>b</P>'));
  });

  it('a CRLF chunk indented by two keeps its line ends, its indentation and its missing newline', () => {
    const body = entryXml('a', 'u-a', NS_DESIGN, '2.5E-3', '  ', '\r\n') + entryXml('b', 'u-b', NS_DESIGN, '7.0', '  ', '\r\n');
    const xml = `${DECL}\r\n<DataSource FormatVersion="1" MinRelease="R2014a">\r\n${body}</DataSource>`;
    const { session, root } = fromChunk(xml);
    expect(savedChunk(session, root)).toBe(xml);
  });

  it('a value that spells `Object` in its text, or an escaped tag, is still one entry\'s', () => {
    const xml = chunk(
      entryXml('a', 'u-a', NS_DESIGN).replace(/<P Name="Value" Class="double">[^<]*<\/P>/, '<P Name="Value" Class="char">Object &lt;Object&gt; &lt;/Object&gt;</P>')
      + entryXml('b', 'u-b', NS_DESIGN) + DICTIONARY,
    );
    const { session, root } = fromChunk(xml);
    expect(entries(root).map((e: any) => e.name)).toEqual(['a', 'b']);
    expect(savedChunk(session, root)).toBe(xml);
    expect(serializer.regenerateChunkXml(root)).not.toBe(xml);
  });

  it('a dictionary with no DD.Dictionary object is not given one', () => {
    const xml = chunk(entryXml('a', 'u-a', NS_DESIGN));
    const { session, root } = fromChunk(xml);
    expect(savedChunk(session, root)).toBe(xml);
    expect(serializer.regenerateChunkXml(root)).toContain('DD.Dictionary');
  });

  it('an entry whose value is NaN, or a negative zero, keeps its bytes like any other', () => {
    // The reader's value of a NaN scalar is the number NaN, which is not `===` to itself.
    // These bytes have no LastModBy line, which a regeneration writes, so a regenerated
    // entry shows even where the value is spelled the same.
    const drop = (e: string): string => e.replace(/\n\s*<P Name="LastModBy" Class="char">u<\/P>/, '');
    const xml = chunk(drop(entryXml('a', 'u-a', NS_DESIGN, 'NaN')) + drop(entryXml('b', 'u-b', NS_DESIGN, '-0.0')) + DICTIONARY);
    const { session, root } = fromChunk(xml);
    expect(serializer.regenerateChunkXml(root)).not.toBe(xml);
    expect(savedChunk(session, root)).toBe(xml);
  });
});

// What the writers write is laid out with LF and four spaces a level. A file laid out
// otherwise — one in the local corpus is CRLF with two — would get an edited or added entry,
// or regenerated dictionary-level objects, in a layout of its own inside the file's.
//
// The oracle here is line by line: each line of the writers' text re-indented, a level for
// every four spaces, and joined with the file's line end. That holds for text no value
// spans two lines of, which is all of it here; a value that does is pinned on its own below.
function relaid(lf: string, nl: string, level: string): string {
  return lf.split('\n').map((line) => {
    const n = line.length - line.trimStart().length;
    expect(n % 4, `four spaces a level: ${JSON.stringify(line)}`).toBe(0);
    return level.repeat(n / 4) + line.slice(n);
  }).join(nl);
}
const objectOf = (entry: any): string => serializer.regenerateEntryXml(entry).slice(4, -1);
const nameOf = (fragment: string): string => /<P Name="Name" Class="char">([^<]*)<\/P>/.exec(fragment)![1];

describe('what the model writes is laid out as the file it goes into is', () => {
  const CRLF_DICTIONARY = '  <Object Class="DD.Dictionary">\r\n    <P Name="AccessBaseWorkspace" Class="logical">0</P>\r\n  </Object>\r\n';
  const crlfChunk = (body: string): string =>
    `${DECL}\r\n<DataSource FormatVersion="1" MinRelease="R2014a">\r\n${body}${CRLF_DICTIONARY}</DataSource>`;

  it('a CRLF chunk indented by two: an edited entry, an added one and the dictionary objects are CRLF, two a level', () => {
    const a = relaid(entryXml('a', 'u-a', NS_DESIGN, '2.5E-3'), '\r\n', '  ');
    const b = relaid(entryXml('b', 'u-b', NS_DESIGN, '7.0'), '\r\n', '  ');
    const xml = crlfChunk(a + b);
    const { session, root } = fromChunk(xml);
    const [first, second] = entries(root);
    expect(first.setProperty('Name', 'aRenamed')).toBe(true);
    const added = root.addEntry('Simulink.Parameter', 'pAdded', 'design');
    root.allowAccessBWS = true;

    const out = savedChunk(session, root);
    const spans = spansOf(xml);
    expect(out).toBe(
      xml.slice(0, spans[0][0]) + relaid(objectOf(first), '\r\n', '  ')
      + xml.slice(spans[0][1], spans[1][1])
      + '\r\n  ' + relaid(objectOf(added), '\r\n', '  ')
      + '\r\n  <Object Class="DD.Dictionary">\r\n    <P Name="AccessBaseWorkspace" Class="logical">1</P>\r\n  </Object>\r\n</DataSource>',
    );
    // No line of it ends in a bare LF.
    expect(out.replace(/\r\n/g, '').includes('\n')).toBe(false);
    const reread: any = fromChunk(out).root;
    expect(entries(reread).map((e: any) => e.name)).toEqual(['aRenamed', 'b', 'pAdded']);
    expect(reread.allowAccessBWS).toBe(true);
    expect(entries(reread)[1].serialize()).toEqual(second.serialize());
  });

  it('a chunk written on one line takes an edited and an added entry on that line', () => {
    // object_array_binary.sldd has no line break at all.
    const { session, root, bytes } = open(join(HERE, 'fixtures', 'object_array_binary.sldd'));
    const xml = text(unzipSync(bytes)[CHUNK]);
    expect(xml.includes('\n')).toBe(false);
    const spans = spansOf(xml);
    const first = entries(root).find((e: any) => e.name === nameOf(xml.slice(spans[0][0], spans[0][1])));
    expect(first.setProperty('Name', 'renamedOnOneLine')).toBe(true);
    const added = root.addEntry('Simulink.Parameter', 'pAdded', 'design');
    const out = savedChunk(session, root);
    expect(out).toBe(
      xml.slice(0, spans[0][0]) + relaid(objectOf(first), '', '')
      + xml.slice(spans[0][1], spans.at(-1)![1]) + relaid(objectOf(added), '', '') + xml.slice(spans.at(-1)![1]),
    );
    expect(out.includes('\n')).toBe(false);
    expect(entries(fromChunk(out).root).map((e: any) => e.name)).toContain('renamedOnOneLine');
  });

  it('an entry added to a CRLF chunk with no entries goes on a line of its own, indented by two', () => {
    const xml = crlfChunk('');
    const { session, root } = fromChunk(xml);
    const added = root.addEntry('Simulink.Parameter', 'pFirst', 'design');
    const at = xml.indexOf('  <Object Class="DD.Dictionary">');
    expect(savedChunk(session, root)).toBe(xml.slice(0, at) + '  ' + relaid(objectOf(added), '\r\n', '  ') + '\r\n' + xml.slice(at));
  });

  it('the text of a value is the value\'s: its line breaks and its leading spaces are not layout', () => {
    const value = 'line one\n    line two';
    const a = relaid(entryXml('a', 'u-a', NS_DESIGN, ''), '\r\n', '  ')
      .replace('<P Name="Value" Class="double"></P>', `<P Name="Value" Class="char">${value}</P>`);
    const xml = crlfChunk(a);
    const { session, root } = fromChunk(xml);
    const [entry] = entries(root);
    expect(entry.setProperty('Name', 'aRenamed')).toBe(true);
    const out = savedChunk(session, root);
    expect(out).toContain(`<P Name="Value" Class="char">${value}</P>`);
    expect(entries(fromChunk(out).root)[0].serialize().value).toEqual(entries(fromChunk(xml).root)[0].serialize().value);
  });

  // MATLAB writes a CR inside a char as `&#xD;`, the reader decodes it, and the writer writes
  // it back as the reference: the layout pass, which rewrites only whitespace between tags,
  // never meets it as a line end.
  it('a CR in a value, written `&#xD;`, is kept by an edited entry in a CRLF chunk, every line end CRLF', () => {
    const a = relaid(entryXml('a', 'u-a', NS_DESIGN, ''), '\r\n', '  ')
      .replace('<P Name="Value" Class="double"></P>', '<P Name="Value" Class="char">a&#xD;b</P>');
    const b = relaid(entryXml('b', 'u-b', NS_DESIGN, '7.0'), '\r\n', '  ');
    const xml = crlfChunk(a + b);
    for (const target of ['a', 'b']) {
      const { session, root } = fromChunk(xml);
      const entry = entries(root).find((e: any) => e.name === target);
      expect(entry.setProperty('Name', target + 'Renamed')).toBe(true);
      const out = savedChunk(session, root);
      expect(out).toContain('<P Name="Value" Class="char">a&#xD;b</P>');
      expect(out.split('\r\n').filter((line) => /[\r\n]/.test(line))).toEqual([]);
      const reread = entries(fromChunk(out).root);
      expect(reread.find((e: any) => e.name === (target === 'a' ? 'aRenamed' : 'a')).serialize().value)
        .toEqual(entries(fromChunk(xml).root)[0].serialize().value);
    }
    expect(JSON.stringify(entries(fromChunk(xml).root)[0].serialize().value)).toContain('a\\rb');
  });

  it('every entry of every binary fixture, laid out CRLF by two or on one line, reads back as it does from the writers\' layout', () => {
    let checked = 0;
    for (const path of BINARY) {
      const { root } = open(path);
      const objects = entries(root).map(objectOf);
      const reread = (body: string[], nl: string, indent: string): any[] => entries(fromChunk(
        `${DECL}${nl}<DataSource FormatVersion="1" MinRelease="R2014a">${nl}${body.map((o) => indent + o + nl).join('')}</DataSource>`,
      ).root).map((e: any) => e.serialize());
      const asWritten = reread(objects, '\n', '    ');
      // Asked to lay them out as the writers do, the layout pass gives back their own text.
      expect(objects.map((o) => layout.inLayout(o, { nl: '\n', base: '    ', unit: '    ' }))).toEqual(objects);
      expect(reread(objects.map((o) => layout.inLayout(o, { nl: '\r\n', base: '  ', unit: '  ' })), '\r\n', '  ')).toEqual(asWritten);
      expect(reread(objects.map((o) => layout.inLayout(o, { nl: '', base: '', unit: '' })), '', '')).toEqual(asWritten);
      checked += objects.length;
    }
    expect(checked).toBeGreaterThan(200);
  });
});

// cellarr_binary.sldd, because a regeneration rewrites 11 of its 14 entries: an untouched
// entry written from the model here would not pass for its own bytes.
describe('an edit changes its own entry and nothing else', () => {
  const PATH = join(HERE, 'fixtures', 'cellarr_binary.sldd');

  it('rename one, delete the first, add one: the rest are their bytes, in place', () => {
    const { session, root, bytes } = open(PATH);
    const xml = text(unzipSync(bytes)[CHUNK]);
    const spans = spansOf(xml);
    const all = entries(root);
    expect(all.length).toBe(spans.length);

    const renamed = all[2];
    expect(renamed.setProperty('Name', renamed.name + 'Renamed')).toBe(true);
    expect(session.deleteNodeById(all[0].id)).toBe(true);
    const added = root.addEntry('Simulink.Parameter', 'pAdded', 'design');
    expect(added).not.toBeNull();

    const objectOf = (line: string): string => line.slice(4, -1);
    const lead = (i: number): string => (i === 0 ? '\n    ' : xml.slice(spans[i - 1][1], spans[i][0]));
    // The expected chunk, cut out of the file: the first entry and the whitespace before
    // it gone, the renamed one regenerated, the added one after the last, then the tail.
    let expected = xml.slice(0, spans[0][0] - lead(0).length);
    for (let i = 1; i < spans.length; i++) {
      expected += lead(i) + (i === 2 ? objectOf(serializer.regenerateEntryXml(renamed)) : xml.slice(spans[i][0], spans[i][1]));
    }
    expected += lead(spans.length - 1) + objectOf(serializer.regenerateEntryXml(added));
    expected += xml.slice(spans[spans.length - 1][1]);

    const out = savedChunk(session, root);
    expect(out).toBe(expected);
    expect(out.indexOf('pAdded')).toBeLessThan(out.indexOf('<Object Class="DD.Dictionary">'));

    // N - 1 + 1 entries, read back in the order written.
    const reread: any = fromChunk(out).root;
    expect(entries(reread).map((e: any) => e.name)).toEqual([...all.slice(1).map((e: any) => e.name), 'pAdded']);
    expect(entries(reread).length).toBe(spans.length);
  });

  it('an entry deleted and restored by undo is its bytes again, in its place', () => {
    const { session, root, bytes } = open(PATH);
    const xml = text(unzipSync(bytes)[CHUNK]);
    const victim = entries(root)[5];
    session.setActiveContext(root);
    expect(session.deleteNodeById(victim.id)).toBe(true);
    expect(savedChunk(session, root)).not.toBe(xml);
    session.undo();
    expect(entries(root)).toContain(victim);
    expect(savedChunk(session, root)).toBe(xml);
  });

  it('an edited entry is regenerated in its own place', () => {
    const { session, root, bytes } = open(PATH);
    const xml = text(unzipSync(bytes)[CHUNK]);
    const spans = spansOf(xml);
    const target = entries(root)[4];
    expect(target.setProperty('Name', 'renamedInPlace')).toBe(true);
    const out = savedChunk(session, root);
    expect(out).toBe(
      xml.slice(0, spans[4][0]) + serializer.regenerateEntryXml(target).slice(4, -1) + xml.slice(spans[4][1]),
    );
  });
});

describe('the dictionary-level objects are rewritten only when what they say changed', () => {
  const PATH = join(HERE, 'fixtures', 'cellarr_binary.sldd');

  it('turning base-workspace access on rewrites the objects after the entries, and nothing before them', () => {
    const { session, root, bytes } = open(PATH);
    const xml = text(unzipSync(bytes)[CHUNK]);
    const spans = spansOf(xml);
    const end = spans[spans.length - 1][1];
    root.allowAccessBWS = !root.allowAccessBWS;
    const out = savedChunk(session, root);
    expect(out.slice(0, end)).toBe(xml.slice(0, end));
    expect(out.slice(end)).toContain(`<P Name="AccessBaseWorkspace" Class="logical">${root.allowAccessBWS ? '1' : '0'}</P>`);
    expect(out.endsWith('</DataSource>' + xml.slice(xml.lastIndexOf('</DataSource>') + '</DataSource>'.length))).toBe(true);
    const reread: any = fromChunk(out).root;
    expect(reread.allowAccessBWS).toBe(root.allowAccessBWS);
    root.allowAccessBWS = !root.allowAccessBWS;
    expect(savedChunk(session, root)).toBe(xml);
  });

  it('adding a referenced dictionary writes it, and keeps every entry', () => {
    const { session, root, bytes } = open(PATH);
    const xml = text(unzipSync(bytes)[CHUNK]);
    const end = spansOf(xml).at(-1)![1];
    const read = [...root.dictionaryReferences];
    root.dictionaryReferences.push('other.sldd');
    const out = savedChunk(session, root);
    expect(out.slice(0, end)).toBe(xml.slice(0, end));
    expect(fromChunk(out).root.dictionaryReferences).toEqual([...read, 'other.sldd']);
  });
});

describe('a chunk with no entries', () => {
  it('is written back whole when none are added', () => {
    const xml = chunk(DICTIONARY);
    const { session, root } = fromChunk(xml);
    expect(savedChunk(session, root)).toBe(xml);
  });

  it('takes an added entry straight after the DataSource tag, before the dictionary object', () => {
    const xml = chunk(DICTIONARY);
    const { session, root } = fromChunk(xml);
    const added = root.addEntry('Simulink.Parameter', 'pFirst', 'design');
    const at = xml.indexOf('\n    <Object Class="DD.Dictionary">');
    expect(savedChunk(session, root)).toBe(
      xml.slice(0, at) + '\n' + serializer.regenerateEntryXml(added).slice(0, -1) + xml.slice(at),
    );
  });

  it('is generated when it is a self-closed DataSource, which has no inside to put one in', () => {
    const xml = `${DECL}\n<DataSource FormatVersion="1" MinRelease="R2014a"/>`;
    const { session, root } = fromChunk(xml);
    expect(savedChunk(session, root)).toBe(xml);
    root.addEntry('Simulink.Parameter', 'pFirst', 'design');
    const out = savedChunk(session, root);
    expect(out).toBe(serializer.regenerateChunkXml(root));
    expect(entries(fromChunk(out).root).map((e: any) => e.name)).toEqual(['pFirst']);
  });

  // A package whose chunk is empty is still a package: the format is the reader's, not the
  // chunk's length. One whose chunk was the empty string was taken for a text dictionary and
  // saved as one, with no bytes for a host to write; one of whitespace was always saved as a
  // package, with a chunk generated whole, since neither holds a document to keep.
  it('is saved as a package, with a chunk generated whole, when the chunk is empty', () => {
    for (const body of ['', '\n']) {
      const zip = zipSync({ [CHUNK]: new TextEncoder().encode(body), 'metadata/coreProperties.xml': new TextEncoder().encode('<x/>') });
      const session = createSession();
      const root: any = ingest(session, buffer(zip), { filename: 'empty.sldd' });
      const out = session.serializeSource(root.name);
      expect(out.kind, JSON.stringify(body)).toBe('binary');
      const members = unzipSync(out.bytes);
      expect(text(members[CHUNK])).toBe(serializer.regenerateChunkXml(root));
      expect(text(members['metadata/coreProperties.xml'])).toBe('<x/>');
      expect(entries(fromChunk(text(members[CHUNK])).root)).toEqual([]);
    }
  });

  // The place a first entry goes is found by reading the markup, as the spans are. A search of
  // the text for `<DataSource` met this declaration's attribute value first, and the save wrote
  // the added entry into the declaration: a document that lost the entry on its next read.
  // The declaration is not one XML allows (an encoding name is letters, digits and `._-`), and
  // the fast reader reads the document all the same. Input the readers accept that is not
  // well-formed is kept as read where nobody edited it, and a save does not repair it: so the
  // saved document is no better formed than this one. What these pin is that the declaration is
  // kept as read, and that what the save writes into the file (an added entry, base-workspace
  // access) is kept.
  const declaration = '<?xml version="1.0" encoding="<DataSource>"?>';
  const declared = `${declaration}\n<DataSource FormatVersion="1" MinRelease="R2014a">\n${DICTIONARY}</DataSource>\n`;

  it('keeps an entry added where the XML declaration spells <DataSource>, and keeps that declaration as read', () => {
    const xml = declared;
    const sink: ReadEntrySpans = { spans: [], clean: true, read: false };
    expect(readDictionaryXmlFast(xml, sink)).not.toBeNull();
    expect(sink.read).toBe(true);
    const at = xml.indexOf('\n    <Object Class="DD.Dictionary">');

    const untouched = fromChunk(xml);
    expect(savedChunk(untouched.session, untouched.root)).toBe(xml);

    const { session, root } = fromChunk(xml);
    const added = root.addEntry('Simulink.Parameter', 'pFirst', 'design');
    const out = savedChunk(session, root);
    // The declaration as read, and the entry straight after the DataSource tag itself.
    expect(out.startsWith(declaration + '\n<DataSource FormatVersion="1" MinRelease="R2014a">\n'), 'the declaration, as read').toBe(true);
    expect(out).toBe(xml.slice(0, at) + '\n' + serializer.regenerateEntryXml(added).slice(0, -1) + xml.slice(at));
    // And the entry is kept: reopened, the file holds it.
    expect(entries(fromChunk(out).root).map((e: any) => e.name)).toEqual(['pFirst']);
  });

  it('keeps that declaration as read when base-workspace access is set there, and the access is kept', () => {
    const xml = declared;
    const at = xml.indexOf('\n    <Object Class="DD.Dictionary">');
    const toggled = fromChunk(xml);
    toggled.root.allowAccessBWS = true;
    const written = savedChunk(toggled.session, toggled.root);
    expect(written.startsWith(xml.slice(0, at)), 'the declaration, as read').toBe(true);
    expect(fromChunk(written).root.allowAccessBWS).toBe(true);
  });
});

describe('only bytes the reader paired are claimed', () => {
  const PATH = join(HERE, 'fixtures', 'mcos', 'complex_binary.sldd');
  // MATLAB wrote pNonFinite's NaN imaginary part as `1.0NaNi`, which a regeneration
  // spells `1.0+NaNi`: an entry for which kept and regenerated bytes differ.
  const NAME = 'pNonFinite';

  it('the entry used here is one whose regeneration differs from its bytes', () => {
    const { root, bytes } = open(PATH);
    const entry = entries(root).find((e: any) => e.name === NAME);
    expect(text(unzipSync(bytes)[CHUNK])).toContain('1.0NaNi');
    expect(serializer.regenerateEntryXml(entry)).not.toBe(serializer.serializeEntryToXml(entry));
  });

  it('a record carrying rawXml is regenerated, not written as that text', () => {
    const { root } = open(PATH);
    const design = root.getSection('design');
    const forged = '<Object Class="DD.ENTRY"><P Name="Name" Class="char">x</P></Object>';
    const node = design.parseEntry({ name: 'x', value: { _type: 'double', _value: '1' }, metadata: { uuid: 'u' }, rawXml: forged });
    expect(serializer.serializeEntryToXml(node)).toBe(serializer.regenerateEntryXml(node));
    expect(serializer.serializeEntryToXml(node)).not.toContain(forged);
  });

  it('an entry rebuilt from its serialize() record, as a paste or a host undo does, is regenerated', () => {
    const { session, root } = open(PATH);
    const design = root.getSection('design');
    const entry = entries(root).find((e: any) => e.name === NAME);
    const record = JSON.parse(JSON.stringify(entry.serialize()));
    const index = design.children.indexOf(entry);
    design.removeChild(entry);
    const rebuilt = design.parseEntry(record);
    design.removeChild(rebuilt);
    design.addChild(rebuilt, index);
    expect(rebuilt.status).toBe('');
    expect(serializer.serializeEntryToXml(rebuilt)).toBe(serializer.regenerateEntryXml(rebuilt));
    expect(savedChunk(session, root)).toContain(serializer.regenerateEntryXml(rebuilt).slice(4, -1));
  });

  it('a JSON copy of the reader\'s content claims nothing, and is regenerated whole', () => {
    const { bytes } = open(PATH);
    const content = parseBinarySlddParts(text(unzipSync(bytes)[CHUNK]), {});
    const copy = JSON.parse(JSON.stringify(content));
    const session = createSession();
    const copied: any = session.addDataSource('mem://copy', copy, { path: 'copy.sldd' });
    expect(serializer.buildDataChunkXml(copied)).toBe(serializer.regenerateChunkXml(copied));
  });

  // The reader's own content object, changed in place before a model is built from it: the
  // object is the one the bytes were recorded on, and it no longer says what they say.
  const changes: [string, (raw: any, other: any) => void][] = [
    ['renamed', (raw) => { raw.name = 'hostRenamed'; }],
    ['given another UUID', (raw) => { raw.metadata.uuid = 'u-host'; }],
    ['moved to another section', (raw) => { raw.metadata.namespace = NS_OTHER; }],
    ['made derived, which moves it to the architecture section', (raw) => { raw.metadata.isderived = '1'; }],
    ['given another value', (raw, other) => { raw.value = structuredClone(other.value); }],
    // Every other metadata field the writer writes, by the key it reads: the LastModBy a host
    // set here used to show in the model and be dropped by the save.
    ...WRITTEN_METADATA.filter((key) => !['uuid', 'namespace', 'isderived'].includes(key)).map(
      (key): [string, (raw: any) => void] => [`given another ${key}`, (raw) => { raw.metadata[key] = `host-${key}`; }],
    ),
  ];
  for (const [what, change] of changes) {
    it(`an entry of the reader's content ${what} in place before the model is built is regenerated, and the others kept`, () => {
      const xml = chunk(entryXml('a', 'u-a', NS_DESIGN, '1.0E+6') + entryXml('b', 'u-b', NS_DESIGN, '2.0E+6') + DICTIONARY);
      const spans = spansOf(xml);
      const content: any = parseBinarySlddParts(xml, {});
      const raw = content[TEXT_PARTS][DATA_PART_KEY][TEXT_CONTENT].entries;
      change(raw[0], raw[1]);
      const root: any = createSession().addDataSource('mem://changed', content, { path: 'x.sldd' });
      const changed = entries(root).find((e: any) => e.metadata.uuid !== 'u-b' || e.name !== 'b');
      const kept = entries(root).find((e: any) => e !== changed);
      expect(serializer.serializeEntryToXml(changed)).toBe(serializer.regenerateEntryXml(changed));
      expect(serializer.serializeEntryToXml(kept)).toBe('    ' + xml.slice(spans[1][0], spans[1][1]) + '\n');
      expect(serializer.buildDataChunkXml(root)).toBe(
        xml.slice(0, spans[0][0]) + objectOf(changed) + xml.slice(spans[0][1]),
      );
    });
  }

  // A chunk this reader cannot pair is written as it always was: regenerated whole.
  const cases: [string, string][] = [
    ['an entry holding an object of its own', chunk(
      entryXml('a', 'u-a', NS_DESIGN)
      + entryXml('b', 'u-b', NS_DESIGN, '2.0').replace('<P Name="Value"', '<Object Class="X"><P Name="Q" Class="char">q</P></Object><P Name="Value"')
      + DICTIONARY,
    )],
    ['an entry whose open tag MATLAB would not write', chunk(
      entryXml('a', 'u-a', NS_DESIGN) + entryXml('b', 'u-b', NS_DESIGN).replace('<Object Class="DD.ENTRY">', '<Object  Class="DD.ENTRY">') + DICTIONARY,
    )],
    ['an object between two entries', chunk(entryXml('a', 'u-a', NS_DESIGN) + DICTIONARY + entryXml('b', 'u-b', NS_DESIGN))],
    // A copy of the entry in a comment, an instruction or an attribute, and the entry itself in
    // quotes MATLAB does not write. A text search took the copy for the entry: one span and one
    // entry, the same Name and UUID, and the span not the entry's. The scan sees no entry in the
    // copy, and stops at the entry's own tag.
    ['a comment before the first entry holding a copy of it, and the entry in single quotes', chunk(
      `    <!-- ${entryXml('a', 'u-a', NS_DESIGN).trim()} -->\n`
      + entryXml('a', 'u-a', NS_DESIGN).replace('<Object Class="DD.ENTRY">', '<Object Class=\'DD.ENTRY\'>') + DICTIONARY,
    )],
    ['a processing instruction before the first entry holding a copy of it, and the entry in single quotes', chunk(
      `    <?copy ${entryXml('a', 'u-a', NS_DESIGN).trim()} ?>\n`
      + entryXml('a', 'u-a', NS_DESIGN).replace('<Object Class="DD.ENTRY">', '<Object Class=\'DD.ENTRY\'>') + DICTIONARY,
    )],
    ['a comment after the last entry', chunk(entryXml('a', 'u-a', NS_DESIGN) + '    <!-- a note -->\n' + DICTIONARY)],
    ['a DataSource attribute holding a copy of the entry, and the entry in single quotes',
      `${DECL}\n<DataSource FormatVersion="1" MinRelease="R2014a" Copy='${entryXml('a', 'u-a', NS_DESIGN).trim()}'>\n`
      + entryXml('a', 'u-a', NS_DESIGN).replace('<Object Class="DD.ENTRY">', '<Object Class=\'DD.ENTRY\'>') + DICTIONARY + '</DataSource>\n',
    ],
    // The reader decodes the reference to `ab`; the pairing reads the Name with XML's five
    // named entities only, so the two disagree and the chunk is regenerated, as before.
    ['a Name holding a numeric character reference', chunk(entryXml('a&#98;', 'u-a', NS_DESIGN) + DICTIONARY)],
    // The reader takes the entry's own Name; the first `<P Name="Name"` in the span is a
    // struct field's, because the Value comes first.
    ['a span whose first Name is not the entry\'s', chunk(
      '    <Object Class="DD.ENTRY">\n'
      + '        <P Name="Value" Class="struct"><Element><P Name="Name" Class="char">inner</P></Element></P>\n'
      + '        <P Name="Name" Class="char">a</P>\n'
      + `        <P Name="Namespace" Class="char">${NS_DESIGN}</P>\n`
      + '    </Object>\n' + DICTIONARY,
    )],
    ['a span whose first UUID is not the entry\'s', chunk(
      '    <Object Class="DD.ENTRY">\n'
      + '        <P Name="Value" Class="struct"><Element><P Name="UUID" Class="char">inner</P></Element></P>\n'
      + '        <P Name="Name" Class="char">a</P>\n'
      + '        <P Name="UUID" Class="char">u-a</P>\n'
      + `        <P Name="Namespace" Class="char">${NS_DESIGN}</P>\n`
      + '    </Object>\n' + DICTIONARY,
    )],
  ];
  for (const [what, xml] of cases) {
    it(`${what}: regenerated whole, as before`, () => {
      const { root } = fromChunk(xml);
      expect(entries(root).length).toBeGreaterThan(0);
      // Regeneration respells every entry here (1.0E+6), so agreeing with it is not an accident.
      expect(serializer.regenerateChunkXml(root)).not.toBe(xml);
      expect(serializer.buildDataChunkXml(root)).toBe(serializer.regenerateChunkXml(root));
      for (const entry of entries(root)) {
        expect(serializer.serializeEntryToXml(entry)).toBe(serializer.regenerateEntryXml(entry));
      }
    });
  }

  it('a truncated chunk, which the reader reads only part of, claims nothing', () => {
    const whole = chunk(entryXml('a', 'u-a', NS_DESIGN) + entryXml('b', 'u-b', NS_DESIGN) + DICTIONARY);
    const xml = whole.slice(0, whole.indexOf('<P Name="Value"', whole.indexOf('>b</P>')));
    const { root } = fromChunk(xml);
    expect(serializer.buildDataChunkXml(root)).toBe(serializer.regenerateChunkXml(root));
  });
});

// A node is a plain object, and a host can change what it is called, what its metadata says
// and which section holds it without the API that marks it. The save asks, as it is about to
// write an entry's bytes, whether the node still says what it said when they were attached,
// and writes it from the model where it does not: in its own place, as an edit is.
describe('a node changed around the API is written from the model, not as the bytes it was read from', () => {
  const XML = chunk(entryXml('a', 'u-a', NS_DESIGN, '1.0E+6') + entryXml('b', 'u-b', NS_DESIGN, '2.0E+6') + DICTIONARY);
  const SPANS = spansOf(XML);
  const inPlace = (changed: any): string => XML.slice(0, SPANS[0][0]) + objectOf(changed) + XML.slice(SPANS[0][1]);

  const bypasses: [string, (entry: any, root: any) => void, (reread: any) => void][] = [
    ['renamed by assignment to its name', (e) => { e.name = 'aAssigned'; },
      (r) => expect(entries(r).map((e: any) => e.name)).toEqual(['aAssigned', 'b'])],
    ...WRITTEN_METADATA.map((key): [string, (entry: any) => void, (reread: any) => void] => [
      `its metadata's ${key} set`, (e) => { e.metadata[key] = key === 'namespace' ? NS_OTHER : key === 'isderived' ? '1' : `host-${key}`; },
      () => {},
    ]),
    ['given a copy of its metadata with another LastModBy', (e) => { e.metadata = { ...e.metadata, lastModifiedBy: 'someoneElse' }; },
      (r) => expect(entries(r)[0].metadata.lastModifiedBy).toBe('someoneElse')],
    ['moved to another section by removeChild and addChild', (e, root) => {
      root.getSection('design').removeChild(e);
      root.getSection('other').addChild(e);
    }, () => {}],
  ];
  for (const [what, act, reread] of bypasses) {
    it(what, () => {
      const { session, root } = fromChunk(XML);
      const [a, b] = entries(root);
      act(a, root);
      expect(a.status, 'the API was not used').toBe('');
      expect(serializer.serializeEntryToXml(a)).toBe(serializer.regenerateEntryXml(a));
      expect(serializer.serializeEntryToXml(b)).toBe('    ' + XML.slice(SPANS[1][0], SPANS[1][1]) + '\n');
      const out = savedChunk(session, root);
      expect(out).toBe(inPlace(a));
      reread(fromChunk(out).root);
    });
  }

  it('its metadata\'s LastModBy set reads back as set', () => {
    const { session, root } = fromChunk(XML);
    entries(root)[0].metadata.lastModifiedBy = 'someoneElse';
    expect(entries(fromChunk(savedChunk(session, root)).root)[0].metadata.lastModifiedBy).toBe('someoneElse');
  });

  it('moved into a section of another dictionary, it is written there from the model', () => {
    const from = fromChunk(XML);
    const to = fromChunk(chunk(entryXml('c', 'u-c', NS_DESIGN, '3.0E+6') + DICTIONARY));
    const [a] = entries(from.root);
    from.root.getSection('design').removeChild(a);
    to.root.getSection('design').addChild(a);
    expect(serializer.serializeEntryToXml(a)).toBe(serializer.regenerateEntryXml(a));
    expect(savedChunk(to.session, to.root)).toContain(objectOf(a));
  });

  // What the check asks is what the node says, not which objects say it.
  it('put back where it was, or given an equal copy of its metadata, it is its bytes again', () => {
    const { session, root } = fromChunk(XML);
    const [a, b] = entries(root);
    const design = root.getSection('design');
    design.removeChild(a);
    root.getSection('other').addChild(a);
    root.getSection('other').removeChild(a);
    design.addChild(a, 0);
    b.metadata = { ...b.metadata };
    a.name = 'aAssigned';
    a.name = 'a';
    expect(savedChunk(session, root)).toBe(XML);
  });

  // The list the check holds a node to is the writer's: every metadata key the writer reads, for
  // every entry of every binary fixture, an added entry and one pasted from a text dictionary's
  // record, is one the kept bytes are held to.
  it('holds a node to every metadata field the entry writer reads', () => {
    const read = new Set<string>();
    const watched = (entry: any): void => {
      const metadata = entry.metadata;
      entry.metadata = new Proxy(metadata, { get: (t, k, r) => { read.add(String(k)); return Reflect.get(t, k, r); } });
      serializer.regenerateEntryXml(entry);
      entry.metadata = metadata;
    };
    let watchedEntries = 0;
    for (const path of BINARY) {
      for (const entry of entries(open(path).root)) {
        watched(entry);
        watchedEntries++;
      }
    }
    const { root } = fromChunk(XML);
    watched(root.addEntry('Simulink.Parameter', 'pAdded', 'design'));
    watched(root.getSection('design').parseEntry({ name: 'pasted', value: { _type: 'double', _value: '1' }, metadata: { uuid: 'u-p', namespace: NS_DESIGN, lastmod: '20260101T000000.000000', modifiedby: 'u', isderived: '0' } }));
    expect(watchedEntries).toBeGreaterThan(200);
    expect([...read].filter((key) => !WRITTEN_METADATA.includes(key))).toEqual([]);
    expect([...read].sort()).toEqual([...WRITTEN_METADATA].sort());
  });
});

// A document read by a tokenizer of the test's own, one that follows XML rather than core:
// comments, CDATA sections and processing instructions end where XML ends them, and an
// attribute value is skipped in either quote. Every element must close, by name, in order,
// under one root. Small inputs only, so a regex is fine here.
const MARKUP = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_:][-\w.:]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|</g;
function expectWellFormed(xml: string, what: string): void {
  expect(XMLValidator.validate(xml), what).toBe(true);
  const open: string[] = [];
  let roots = 0;
  let opened = 0;
  let closed = 0;
  for (const m of xml.matchAll(MARKUP)) {
    expect(m[0], `${what}: a < that starts no markup`).not.toBe('<');
    const [, slash, name, attrs] = m;
    if (name === undefined) continue;
    if (slash) {
      expect(open.pop(), `${what}: </${name}>`).toBe(name);
      if (name === 'Object') closed++;
    } else if (!attrs.endsWith('/')) {
      if (open.length === 0) roots++;
      open.push(name);
      if (name === 'Object') opened++;
    }
  }
  expect(open, what).toEqual([]);
  expect(roots, what).toBe(1);
  expect(closed, what).toBe(opened);
}

describe('an entry is found by its tags, not by text that spells one', () => {
  // XML lets text that spells a tag sit inside an entry in five places: a processing
  // instruction, a comment, a CDATA section, and an attribute value in either quote. None of
  // the binary dictionaries measured holds one, and a hand-edited or generated file can hold
  // any. A text search for the entry's tags met that text as markup: a `</Object>` ended the
  // entry's span early, and an `<Object` was taken for an object nested in it. A span cut
  // short in the last entry passed every check of the pairing, so renaming or deleting that
  // entry wrote the rest of it after the regenerated one, with a `</Object>` too many. Each
  // entry here is one element, whatever its text spells: an untouched save keeps it, and
  // every edit leaves a well-formed file.
  const CLOSE = '</Object>';
  const OPEN = '<Object Class="DD.ENTRY">';
  const before = '<P Name="IsDerived" Class="char">';
  const holders: [string, (inner: string, entry: string) => string][] = [
    ['a processing instruction', (inner, e) => e.replace(before, `<?note ${inner} ?>${before}`)],
    ['a comment', (inner, e) => e.replace(before, `<!-- ${inner} -->${before}`)],
    ['a CDATA section', (inner, e) => e.replace(before, `<![CDATA[${inner}]]>${before}`)],
    ['an attribute value in double quotes', (inner, e) =>
      e.replace(before, `<P Name="IsDerived" Class="char" Note="${inner.replace(/"/g, "'")}">`)],
    ['an attribute value in single quotes', (inner, e) =>
      e.replace(before, `<P Name="IsDerived" Class="char" Note='${inner.replace(/'/g, '"')}'>`)],
  ];
  const where: [string, string][] = [['the middle entry', 'b'], ['the last entry', 'c']];

  type Act = [string, (session: any, root: any, target: any) => void, (names: string[], target: string) => string[]];
  const acts: Act[] = [
    ['saved untouched', () => {}, (names) => names],
    ['renamed', (_s, _r, t) => expect(t.setProperty('Name', t.name + 'Renamed')).toBe(true),
      (names, target) => names.map((n) => (n === target ? n + 'Renamed' : n))],
    ['deleted', (s, _r, t) => expect(s.deleteNodeById(t.id)).toBe(true), (names, target) => names.filter((n) => n !== target)],
    ['given another value', (_s, _r, t) => expect(t.setProperty('Value', '5')).toBe(true), (names) => names],
    ['joined by an added entry', (_s, r) => expect(r.addEntry('Simulink.Parameter', 'pAdded', 'design')).not.toBeNull(),
      (names) => [...names, 'pAdded']],
  ];

  /** Every save of `xml` is well-formed; the untouched one is `xml`, and an edit keeps the other entries' bytes. */
  function everySave(xml: string, pieces: Record<string, string>, target: string): void {
    expectWellFormed(xml, 'the file as read');
    const names = Object.keys(pieces);
    expect(entries(fromChunk(xml).root).map((e: any) => e.name)).toEqual(names);
    for (const [what, act, expected] of acts) {
      const { session, root } = fromChunk(xml);
      act(session, root, entries(root).find((e: any) => e.name === target));
      const out = savedChunk(session, root);
      if (what === 'saved untouched') expect(out).toBe(xml);
      expectWellFormed(out, `${target} ${what}`);
      expect(entries(fromChunk(out).root).map((e: any) => e.name), what).toEqual(expected(names, target));
      for (const name of names.filter((n) => n !== target || what === 'joined by an added entry')) {
        expect(out, `${what}: ${name} as read`).toContain(pieces[name]);
      }
    }
  }

  for (const [holder, put] of holders) {
    for (const [text, inner] of [['`</Object>`', CLOSE], ['`<Object`', OPEN]]) {
      for (const [position, target] of where) {
        it(`${holder} holding ${text} in ${position}`, () => {
          const pieces: Record<string, string> = {
            a: entryXml('a', 'u-a', NS_DESIGN),
            b: entryXml('b', 'u-b', NS_DESIGN, '2.0E+6'),
            c: entryXml('c', 'u-c', NS_DESIGN, '3.0E+6'),
          };
          pieces[target] = put(inner, pieces[target]);
          everySave(chunk(pieces.a + pieces.b + pieces.c + DICTIONARY), Object.fromEntries(
            Object.entries(pieces).map(([k, v]) => [k, v.trim()]),
          ), target);
        });
      }
    }
  }

  // The two such chunks this file used to expect regenerated whole: the search could not see
  // past them. The scan reads them as the one element each entry is.
  it('a CDATA section in a value, holding the text of a close tag', () => {
    const a = entryXml('a', 'u-a', NS_DESIGN);
    const b = entryXml('b', 'u-b', NS_DESIGN).replace(/<P Name="Value" Class="double">[^<]*<\/P>/, '<P Name="Value" Class="char"><![CDATA[x</Object>y]]></P>');
    everySave(chunk(a + b + DICTIONARY), { a: a.trim(), b: b.trim() }, 'b');
  });

  it('a comment holding the text of a close tag, in the only entry', () => {
    const a = entryXml('a', 'u-a', NS_DESIGN).replace('<P Name="Value"', '<!-- </Object> --><P Name="Value"');
    everySave(chunk(a + DICTIONARY), { a: a.trim() }, 'a');
  });

  it('a real dictionary with a processing instruction holding `</Object>` in its last entry', () => {
    const members = unzipSync(new Uint8Array(readFileSync(join(HERE, 'fixtures', 'arch_binary.sldd'))));
    const xml = text(members[CHUNK]);
    const last = xml.lastIndexOf(OPEN);
    const at = xml.indexOf(before, last);
    expect(xml.indexOf('<P Name="Name" Class="char">NumericType</P>', last)).toBeGreaterThan(last);
    const crafted = xml.slice(0, at) + '<?note </Object> ?>' + xml.slice(at);
    // Everything up to the end of the entry before it is the file's in every save.
    const kept = crafted.lastIndexOf(CLOSE, last) + CLOSE.length;
    const bytes = zipSync({ ...members, [CHUNK]: new TextEncoder().encode(crafted) });
    const fresh = (): { session: any; root: any; target: any } => {
      const session = createSession();
      const root: any = ingest(session, buffer(bytes), { filename: 'arch_binary.sldd' });
      return { session, root, target: entries(root).find((e: any) => e.name === 'NumericType') };
    };
    expectWellFormed(crafted, 'the file as read');
    const saves: [string, (s: any, r: any, t: any) => void][] = [
      ['saved untouched', () => {}],
      ['renamed', (_s, _r, t) => expect(t.setProperty('Name', 'NumericTypeRenamed')).toBe(true)],
      ['deleted', (s, _r, t) => expect(s.deleteNodeById(t.id)).toBe(true)],
      ['edited', (_s, _r, t) => expect(t.setProperty('Description', 'edited')).toBe(true)],
      ['joined by an added entry', (_s, r) => expect(r.addEntry('Simulink.Parameter', 'pAdded', 'design')).not.toBeNull()],
    ];
    for (const [what, act] of saves) {
      const { session, root, target } = fresh();
      act(session, root, target);
      const out = savedChunk(session, root);
      if (what === 'saved untouched') expect(out).toBe(crafted);
      expectWellFormed(out, what);
      expect(out.slice(0, kept)).toBe(crafted.slice(0, kept));
    }
  });

  // XML's own end for these is not where the file ends, so the reader refuses the whole
  // document and there is nothing to pair; what can still be saved is well-formed.
  it('an unterminated comment in an entry leaves nothing paired, and the saves well-formed', () => {
    const xml = chunk(entryXml('a', 'u-a', NS_DESIGN) + entryXml('b', 'u-b', NS_DESIGN).replace(before, `<!-- open ${before}`) + DICTIONARY);
    expect(entrySpans(xml).clean).toBe(false);
    for (const add of [false, true]) {
      const { session, root } = fromChunk(xml);
      if (add) root.addEntry('Simulink.Parameter', 'pAdded', 'design');
      const out = savedChunk(session, root);
      expect(out).toBe(serializer.regenerateChunkXml(root));
      expectWellFormed(out, add ? 'an entry added' : 'saved untouched');
    }
  });
});

describe('the span scan reads XML, and refuses what it cannot account for', () => {
  const doc = (body: string): string => `${DECL}\n<DataSource>${body}</DataSource>`;
  const ENTRY = '<Object Class="DD.ENTRY"><P Name="Name" Class="char">a</P></Object>';

  it('an entry is exactly its element, whatever its comments, instructions, CDATA and attributes spell', () => {
    const inner = '<P Name="Name" Class="char" A="</Object>" B=\'<Object Class="DD.ENTRY">\'>a</P>'
      + '<!-- </Object> --><?p </Object> ?><![CDATA[</Object>]]><P Name="Value" Class="char">&lt;/Object&gt;</P>';
    const xml = doc(`<Object Class="DD.ENTRY">${inner}</Object><Object Class="DD.Dictionary"/>`);
    expect(entrySpans(xml)).toEqual({ spans: [[xml.indexOf('<Object'), xml.indexOf('<Object Class="DD.Dictionary"')]], clean: true });
  });

  // Each of these is a document a span cannot be trusted in: the reader may read it, but not
  // as this scan would. The spans before the point it stopped are kept, and nothing is paired.
  const refused: [string, string][] = [
    ['an unterminated comment', doc(`${ENTRY}<!-- ${ENTRY}`)],
    ['an unterminated processing instruction', doc(`${ENTRY}<?p ${ENTRY}`)],
    ['an unterminated CDATA section', doc(`${ENTRY}<![CDATA[ ${ENTRY}`)],
    ['a stray <', doc(`${ENTRY}<Object Class="DD.ENTRY"><P Name="Name" Class="char">a < b</P></Object>`)],
    ['a close tag that closes another element', doc(`${ENTRY}<Object Class="DD.ENTRY"><P Name="Name" Class="char">b</Q></Object>`)],
    ['an element still open at the end', doc(`${ENTRY}<Object Class="DD.ENTRY"><P Name="Name" Class="char">b</P>`).replace('</DataSource>', '')],
    ['an attribute with no quotes', doc(`${ENTRY}<Object Class="DD.ENTRY"><P Name=Name Class="char">b</P></Object>`)],
    // The reader ends a processing instruction at the first `?>` outside quotes, and XML at
    // the first. Read as XML reads it this is two well-formed objects; the reader takes both,
    // and the second's open tag, for the instruction in the first.
    ['a processing instruction the reader would read past its end', doc(`${ENTRY}<Object Class="DD.ENTRY"><?p " ?></Object><Object Class="X"><?q " ?></Object>`)],
    ['an object nested in an entry', doc(`${ENTRY}<Object Class="DD.ENTRY"><Object Class="X"/></Object>`)],
    ['an entry tag MATLAB does not write', doc(`${ENTRY}<Object  Class="DD.ENTRY"><P Name="Name" Class="char">b</P></Object>`)],
    ['an object tag that could spell an entry through an entity', doc(`${ENTRY}<Object Class="DD.EN&#84;RY"><P Name="Name" Class="char">b</P></Object>`)],
    ['a second root', doc(ENTRY) + doc(ENTRY)],
  ];
  for (const [what, xml] of refused) {
    it(what, () => {
      const { spans, clean } = entrySpans(xml);
      expect(clean).toBe(false);
      expect(spans[0]).toEqual([xml.indexOf(ENTRY), xml.indexOf(ENTRY) + ENTRY.length]);
    });
  }

  it('a DOCTYPE, before any entry, leaves no span at all', () => {
    expect(entrySpans(`${DECL}\n<!DOCTYPE DataSource>\n<DataSource>${ENTRY}</DataSource>`)).toEqual({ spans: [], clean: false });
  });

  // Every step moves forward, and none searches past where the scan stops: a document of
  // repeated openings with nothing to close them costs one pass, not one pass per opening.
  it('stays linear on markup that never closes', () => {
    for (const s of [
      doc('<!--'.repeat(500_000)),
      doc('<?p "'.repeat(400_000)),
      doc('<![CDATA['.repeat(250_000)),
      doc('<P A="'.repeat(400_000)),
      doc('<Object Class="DD.ENTRY">'.repeat(100_000)),
      doc(`${ENTRY}<P`.repeat(30_000) + '>'),
    ]) {
      const t0 = performance.now();
      expect(entrySpans(s).clean).toBe(false);
      expect(performance.now() - t0).toBeLessThan(2000);
    }
  });
});

// The fast reader records each entry's span as it reads, and the scan above finds them for a
// chunk it declines: two halves of one answer, held to each other here.
describe('the fast reader records each entry where the scan finds it', () => {
  const recorded = (xml: string): { spans: (readonly [number, number])[]; clean: boolean } | null => {
    const sink: ReadEntrySpans = { spans: [], clean: true, read: false };
    return readDictionaryXmlFast(xml, sink) !== null && sink.read ? { spans: sink.spans, clean: sink.clean } : null;
  };

  it('in every binary fixture it reads', () => {
    let read = 0;
    for (const path of BINARY) {
      const xml = text(unzipSync(new Uint8Array(readFileSync(path)))[CHUNK]);
      const fast = recorded(xml);
      if (fast === null) continue;
      read++;
      expect(fast, relative(HERE, path)).toEqual(entrySpans(xml));
      expect(fast.clean, relative(HERE, path)).toBe(true);
    }
    expect(read).toBeGreaterThanOrEqual(20);
  });

  // Chunks the fast reader reads, each with something the pairing declines or has to see past.
  const ENTRY = (name: string): string => `<Object Class="DD.ENTRY"><P Name="Name" Class="char">${name}</P></Object>`;
  const doc = (body: string): string => `${DECL}\n<DataSource>\n${body}\n</DataSource>\n`;
  const read: [string, string][] = [
    ['an object nested in an entry', doc(ENTRY('a') + '<Object Class="DD.ENTRY"><Object Class="X"/><P Name="Name" Class="char">b</P></Object>' + ENTRY('c'))],
    ['an entry closed by `</Object >`', doc(ENTRY('a') + '<Object Class="DD.ENTRY"><P Name="Name" Class="char">b</P></Object >' + ENTRY('c'))],
    ['an entry tag in single quotes', doc(ENTRY('a') + "<Object Class='DD.ENTRY'><P Name=\"Name\" Class=\"char\">b</P></Object>" + ENTRY('c'))],
    ['an entry tag with an attribute of its own', doc(ENTRY('a') + '<Object Class="DD.ENTRY" Note="1"><P Name="Name" Class="char">b</P></Object>' + ENTRY('c'))],
    ['an object tag that could spell an entry through an entity', doc(ENTRY('a') + '<Object Class="DD.EN&#84;RY"><P Name="Name" Class="char">b</P></Object>' + ENTRY('c'))],
    ['a self-closed entry', doc(ENTRY('a') + '<Object Class="DD.ENTRY"/>' + ENTRY('c'))],
    ['an attribute value holding `<Object`', doc(ENTRY('a') + '<Object Class="DD.ENTRY"><P Name="Name" Class="char" Note="<Object">b</P></Object>' + ENTRY('c'))],
    ['the dictionary object between two entries', doc(ENTRY('a') + '<Object Class="DD.Dictionary"><P Name="AccessBaseWorkspace" Class="logical">0</P></Object>' + ENTRY('c'))],
    ['an entry inside another element', doc(ENTRY('a') + `<P Name="X">${ENTRY('b')}</P>` + ENTRY('c'))],
  ];
  for (const [what, xml] of read) {
    it(what, () => {
      const fast = recorded(xml);
      expect(fast).not.toBeNull();
      expect(fast).toEqual(entrySpans(xml));
    });
  }

  it('records nothing for a chunk whose line ends it normalizes, and the scan answers there', () => {
    const xml = doc(ENTRY('a') + ENTRY('b')).replace(/\n/g, '\r\n');
    const sink: ReadEntrySpans = { spans: [], clean: true, read: false };
    expect(readDictionaryXmlFast(xml, sink)).not.toBeNull();
    expect(sink.read).toBe(false);
    const { session, root } = fromChunk(xml);
    expect(entries(root).map((e: any) => e.name)).toEqual(['a', 'b']);
    expect(savedChunk(session, root)).toBe(xml);
  });

  it('a value holding `<Object` in an attribute, which the fast reader reads: every save is well-formed', () => {
    const a = entryXml('a', 'u-a', NS_DESIGN);
    const b = entryXml('b', 'u-b', NS_DESIGN).replace('<P Name="IsDerived" Class="char">', '<P Name="IsDerived" Class="char" Note="<Object">');
    const xml = chunk(a + b + DICTIONARY);
    expect(recorded(xml)).toEqual({ spans: [[xml.indexOf(a.trim()), xml.indexOf(a.trim()) + a.trim().length], [xml.indexOf(b.trim()), xml.indexOf(b.trim()) + b.trim().length]], clean: true });
    const { session, root } = fromChunk(xml);
    expect(savedChunk(session, root)).toBe(xml);
    for (const target of ['a', 'b']) {
      const fresh = fromChunk(xml);
      const entry = entries(fresh.root).find((e: any) => e.name === target);
      expect(entry.setProperty('Name', target + 'Renamed')).toBe(true);
      expectWellFormed(savedChunk(fresh.session, fresh.root), `${target} renamed`);
      const gone = fromChunk(xml);
      expect(gone.session.deleteNodeById(entries(gone.root).find((e: any) => e.name === target).id)).toBe(true);
      expectWellFormed(savedChunk(gone.session, gone.root), `${target} deleted`);
    }
  });
});

describe('every edit path marks its entry, which is what decides whether its bytes are kept', () => {
  // Status is the gate. A mutation that changed an entry's regeneration and left its
  // status '' would now be dropped on save, so each structural and property path is
  // driven here through the API a host calls, and the entry is checked for the mark.
  const PATH = join(HERE, 'parity', 'artifacts', 'binary', 'params.sldd');
  const byClass = (root: any, cls: string): any => entries(root).find((e: any) => e.className === cls);

  type Case = [string, (session: any, root: any) => any];
  const cases: Case[] = [
    ['an entry renamed', (_s, root) => {
      const e = entries(root)[0];
      expect(e.setProperty('Name', e.name + 'X')).toBe(true);
      return e;
    }],
    ['a Parameter\'s Value set', (_s, root) => {
      const e = byClass(root, 'Simulink.Parameter');
      expect(e.setProperty('Value', '42')).toBe(true);
      return e;
    }],
    ['a bus element renamed', (_s, root) => {
      const e = byClass(root, 'Simulink.Bus');
      expect(e.children[0].setProperty('Name', 'elemRenamed')).toBe(true);
      return e;
    }],
    ['a bus element added', (s, root) => {
      const e = byClass(root, 'Simulink.Bus');
      expect(s.addChildTo(e.id)).not.toBeNull();
      return e;
    }],
    ['a bus element deleted', (s, root) => {
      const e = byClass(root, 'Simulink.Bus');
      expect(s.deleteNodeById(e.children[0].id)).toBe(true);
      return e;
    }],
    ['a bus element deleted, then restored by undo', (s, root) => {
      const e = byClass(root, 'Simulink.Bus');
      s.setActiveContext(root);
      expect(s.deleteNodeById(e.children[0].id)).toBe(true);
      s.undo();
      return e;
    }],
    ['an enumeral added', (s, root) => {
      const e = byClass(root, 'Simulink.data.dictionary.EnumTypeDefinition');
      expect(s.addChildTo(e.id)).not.toBeNull();
      return e;
    }],
    ['an enumeral deleted', (s, root) => {
      const e = byClass(root, 'Simulink.data.dictionary.EnumTypeDefinition');
      expect(s.deleteNodeById(e.children[0].id)).toBe(true);
      return e;
    }],
    ['a struct field added', (s, root) => {
      const e = entries(root).find((x: any) => x.name === 'myStruct');
      expect(s.addChildTo(e.id)).not.toBeNull();
      return e;
    }],
    ['a struct field deleted', (s, root) => {
      const e = entries(root).find((x: any) => x.name === 'myStruct');
      expect(s.deleteNodeById(e.children[0].id)).toBe(true);
      return e;
    }],
    ['a struct field deleted, then restored by undo', (s, root) => {
      const e = entries(root).find((x: any) => x.name === 'myStruct');
      s.setActiveContext(root);
      expect(s.deleteNodeById(e.children[1].id)).toBe(true);
      s.undo();
      return e;
    }],
    ['a nested struct field\'s value set', (_s, root) => {
      const e = entries(root).find((x: any) => x.name === 'nestedStruct');
      const leaf = e.flatten().find((n: any) => n !== e && (!n.children || n.children.length === 0));
      expect(leaf.setProperty('Value', '7')).toBe(true);
      return e;
    }],
    ['a vector element added', (s, root) => {
      const e = entries(root).find((x: any) => x.name === 'rowVec');
      expect(s.addChildTo(e.id)).not.toBeNull();
      return e;
    }],
    ['a vector element deleted', (s, root) => {
      const e = entries(root).find((x: any) => x.name === 'rowVec');
      expect(s.deleteNodeById(e.children[0].id)).toBe(true);
      return e;
    }],
    ['a vector element\'s value set', (_s, root) => {
      const e = entries(root).find((x: any) => x.name === 'colVec');
      expect(e.children[1].setProperty('Value', '9')).toBe(true);
      return e;
    }],
    ['a cell element added', (s, root) => {
      const e = entries(root).find((x: any) => x.name === 'myCell');
      expect(s.addChildTo(e.id)).not.toBeNull();
      return e;
    }],
    ['a cell element deleted, then restored by undo', (s, root) => {
      const e = entries(root).find((x: any) => x.name === 'myCell');
      s.setActiveContext(root);
      expect(s.deleteNodeById(e.children[0].id)).toBe(true);
      s.undo();
      return e;
    }],
    ['a plain variable\'s value set', (_s, root) => {
      const e = entries(root).find((x: any) => x.name === 'scalarD');
      expect(e.setProperty('Value', '5')).toBe(true);
      return e;
    }],
    ['a property edited through the session, then undone', (s, root) => {
      const e = byClass(root, 'Simulink.Parameter');
      s.setActiveContext(root);
      s.setActiveEntry(e);
      expect(s.editProperty(e.id, 'Description', 'edited')).toBe(true);
      s.undo();
      return e;
    }],
  ];
  for (const [what, act] of cases) {
    it(what, () => {
      const { session, root } = open(PATH);
      const xml = text(unzipSync(open(PATH).bytes)[CHUNK]);
      const entry = act(session, root);
      expect(entry, what).toBeTruthy();
      expect(entry.status).toBe('Modified');
      expect(serializer.serializeEntryToXml(entry)).toBe(serializer.regenerateEntryXml(entry));
      expect(savedChunk(session, root)).not.toBe(xml);
    });
  }

  it('an entry added is New, and written from the model', () => {
    const { root } = open(PATH);
    const added = root.addEntry('Simulink.Signal', 'sAdded', 'design');
    expect(added.status).toBe('New');
    expect(serializer.serializeEntryToXml(added)).toBe(serializer.regenerateEntryXml(added));
  });

});

// The census form of the table above, over every binary fixture. Each attempt is made on an
// entry nobody has edited yet: a file is opened afresh for every round, and a round makes at
// most one attempt on each entry, so no attempt is ever hidden behind an earlier one's mark.
// The attempts are every editable cell of every node of every entry, each set to up to three
// values, and every node's add-a-child and delete-this-node. An accepted attempt that changes
// what the model would write and leaves its entry unmarked is a change the save would drop;
// so is one that changes ANOTHER entry and leaves that one unmarked, which the audit after
// each round looks for.
describe('no accepted edit of any binary fixture leaves the entry it changes unmarked', () => {
  type Attempt = { node: number; act: 'set' | 'add' | 'delete'; col?: string; value?: string };
  const nodesOf = (entry: any): any[] => {
    const out: any[] = [];
    const queue = [entry];
    while (queue.length > 0) {
      const node = queue.shift();
      out.push(node);
      queue.push(...(node.children || []));
    }
    return out;
  };
  const valuesFor = (col: string, cell: any): string[] => {
    const current = typeof cell === 'string' ? cell : String(cell?.label ?? cell?.text ?? '');
    if (col === 'Name') return [current + 'Zq'];
    const options = cell?.options;
    const values = Array.isArray(options) && options.length > 1
      ? options.map((o: any) => String(o?.value ?? o)).slice(0, 3)
      : /^-?\d/.test(current) ? ['3', '-0.5', '[1 2]'] : [current + 'x', '', 'x'];
    return [...new Set(values)].filter((v) => v !== current).slice(0, 3);
  };
  const attemptsOf = (entry: any): Attempt[] => {
    const out: Attempt[] = [];
    nodesOf(entry).forEach((node, i) => {
      let row: any;
      try {
        row = node.toRow();
      } catch {
        row = null;
      }
      for (const [col, cell] of Object.entries(row ?? {})) {
        if (col === 'ID' || col === 'Status' || col === 'parent') continue;
        const editable = col === 'Value' ? row._valueEditable : (cell as any)?.editable;
        if (!editable) continue;
        for (const value of valuesFor(col, cell)) out.push({ node: i, act: 'set', col, value });
      }
      out.push({ node: i, act: 'add' });
      if (i > 0) out.push({ node: i, act: 'delete' });
    });
    return out;
  };
  const tryIt = (session: any, node: any, a: Attempt): boolean => {
    try {
      if (a.act === 'set') return node.setProperty(a.col, a.value) === true;
      if (a.act === 'add') return session.addChildTo(node.id) != null;
      return session.deleteNodeById(node.id) === true;
    } catch {
      return false;
    }
  };

  for (const path of BINARY) {
    it(relative(HERE, path), () => {
      const plan = entries(open(path).root).map(attemptsOf);
      const rounds = Math.max(0, ...plan.map((p) => p.length));
      let accepted = 0;
      let changing = 0;
      const holes: string[] = [];
      const unchecked: [number, Attempt][] = [];
      const run = (pick: (i: number) => Attempt | undefined): void => {
        const { session, root } = open(path);
        const all = entries(root);
        const asOpened = all.map((e: any) => serializer.regenerateEntryXml(e));
        all.forEach((entry: any, i: number) => {
          const a = pick(i);
          if (!a) return;
          if (entry.status !== '') {
            unchecked.push([i, a]);
            return;
          }
          const node = nodesOf(entry)[a.node];
          const before = serializer.regenerateEntryXml(entry);
          if (!tryIt(session, node, a)) return;
          accepted++;
          if (serializer.regenerateEntryXml(entry) === before) return;
          changing++;
          if (entry.status === '') holes.push(`${entry.name} node ${a.node} ${a.act} ${a.col ?? ''}=${a.value ?? ''}`);
        });
        all.forEach((entry: any, i: number) => {
          if (entry.status === '' && entries(root).includes(entry) && serializer.regenerateEntryXml(entry) !== asOpened[i]) {
            holes.push(`${entry.name}, unmarked, changed by another entry's edit`);
          }
        });
      };
      for (let round = 0; round < rounds; round++) run((i) => plan[i][round]);
      // An attempt that found its entry already marked, by another entry's edit in its round,
      // is made again on a file of its own.
      for (const [entry, a] of unchecked.splice(0)) run((i) => (i === entry ? a : undefined));
      expect(unchecked).toEqual([]);
      expect(holes).toEqual([]);
      expect(accepted).toBeGreaterThan(0);
    }, 120_000);
  }
});
