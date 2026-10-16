// Copyright 2026 The MathWorks, Inc.
//
// A text dictionary's MAT stream (`{"_type": "cdata"}`) that does not decode: C-014, under the
// maintainer's ruling of 2026-10-16 on damaged input ("warn and show what was read; never refuse
// the file and never crash").
//
// parseCdata already showed such a value as the char of its six-bit text, and the untouched save
// already wrote the text back. But it said nothing: a binary dictionary's hex of the same damaged
// bytes warns "... could not be read, because ...; it is shown as not decoded and saved
// unchanged.", and the text twin opened with no warning at all. And the char it showed took
// edits, where every other value a text dictionary holds as a stream is display-only (the C-012
// ruling of 2026-10-15). An edit would have replaced the stream with the six-bit text typed over.
//
// Now the value warns, for its entry, through the same per-entry harvest a hex value's failure
// goes through (EncodedValue.recordDecodeFailure, which SlddNode.parse collects), and the message
// says what is shown: its encoded text. The char is display-only, and the save is unchanged.
//
// The damage is built in the test from MATLAB's own streams, so a failure here is about the
// decode failure and not about a fixture.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { uudecode, uuencode } from '../src/datamodel/parser/CdataCodec.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import { parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import type { ParseWarning } from '../src/datamodel/parser/ParseWarning.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fixtureText = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');
const buffer = (text: string): ArrayBuffer => {
  const u8 = new TextEncoder().encode(text);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
};

function open(text: string, filename: string): { session: any; source: any } {
  const session = createSession();
  const source = ingest(session, buffer(text), { filename }) as any;
  return { session, source };
}

const entryOf = (source: any, name: string): any => source.getSection('design').children.find((e: any) => e.name === name);
const subtree = (node: any): any[] => [node, ...node.children.flatMap(subtree)];

/** The six-bit text of a cdata value in `text`, damaged by `corrupt`, and `text` with it replaced. */
function damage(text: string, cdata: string, corrupt: (bytes: Uint8Array) => void): { text: string; cdata: string } {
  const bytes = uudecode(cdata);
  corrupt(bytes);
  const damaged = uuencode(bytes);
  // Spliced into the file's own text, so everything else in it is MATLAB's bytes. Each string is
  // spelled as JSON spells it, which is how the file holds it.
  const from = JSON.stringify(cdata);
  expect(text.indexOf(from)).toBeGreaterThan(0);
  expect(text.indexOf(from)).toBe(text.lastIndexOf(from));
  return { text: text.replace(from, () => JSON.stringify(damaged)), cdata: damaged };
}

/** The cdata of each `{"_type": "cdata"}` in a text dictionary, in file order. */
const cdataOf = (text: string): string[] =>
  [...text.matchAll(/"_type": "cdata",\s*"_value": ("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1]) as string);

// The array flags word of the stream's one array: preamble (8 bytes), miMATRIX tag (8), the
// flags subelement's tag (8). Overwritten, the class byte is 255 and every flag is set.
const flagsWord = (b: Uint8Array): void => new DataView(b.buffer, b.byteOffset, b.byteLength).setUint32(24, 0xffffffff, true);

const STREAM_REASON = /is stored as a MAT-file stream, which this editor can show but not edit, so it is read-only\.$/;
const SHOWN_AS_TEXT = 'it is shown as its encoded text and saved unchanged.';

/** The one warning a damaged cdata value under entry `part` gives, because `because`. */
const warningFor = (part: string, because: string): ParseWarning => ({
  code: 'part-unreadable',
  message: `"${part}" holds a value stored encoded that could not be read, because ${because}; ${SHOWN_AS_TEXT}`,
  part,
});

describe('a text dictionary value whose MAT stream does not decode warns, and is shown as its text', () => {
  // test/fixtures/sparse/sparse_text.sldd, MATLAB-written: entry c is the cell {sparse, [9 10]},
  // its first element a stream. With that stream's flags word overwritten, the array reads as
  // class 255 and the node builder throws.
  const original = fixtureText('sparse/sparse_text.sldd');
  const stream = cdataOf(original)[0];
  const { text, cdata } = damage(original, stream, flagsWord);

  it('opens, and says which entry could not be read and why', () => {
    const { source } = open(text, 'sparse_text.sldd');
    expect(source.warnings).toEqual([
      warningFor('c', "its MAT stream did not decode (Cannot read properties of null (reading 're'))"),
    ]);
    // Every other entry is read as it is in the intact file.
    const intact = open(original, 'sparse_text.sldd').source;
    const others = (s: any) => s.getSection('design').children.filter((e: any) => e.name !== 'c').map((e: any) => [e.name, e.displayValue]);
    expect(others(source)).toEqual(others(intact));
    expect(others(source).length).toBeGreaterThan(5);
  });

  it('shows the value as the char of its text, display-only, and the JSON element beside it as it was', () => {
    const { source } = open(text, 'sparse_text.sldd');
    const c = entryOf(source, 'c');
    const [stored, beside] = c.children;
    expect([stored.className, stored._scalarValue]).toEqual(['char', cdata]);
    for (const n of subtree(stored)) {
      expect(n.valueEditable, n.id).toBe(false);
      expect(n.canAddChild(), n.id).toBe(false);
      expect(n.canRemoveChild(), n.id).toBe(false);
      expect(n.setProperty('Value', "'x'"), n.id).toMatchObject({ error: true, reason: expect.stringMatching(/^'c\{1\}' /) });
      expect(n.setProperty('Value', "'x'").reason, n.id).toMatch(STREAM_REASON);
    }
    expect([stored._scalarValue, stored.status]).toEqual([cdata, c.status]);
    // [9 10] is JSON, so it is edited as it was.
    expect(beside.valueEditable).toBe(true);
    expect(beside.setProperty('Value', '[1 2]')).toBe(true);
  });

  it('an untouched save writes the file back byte for byte', () => {
    const { session, source } = open(text, 'sparse_text.sldd');
    expect(session.serializeSource(source.name).text).toBe(text);
  });

  it('a renamed entry is saved with the stream it was read with', () => {
    const { session, source } = open(text, 'sparse_text.sldd');
    expect(entryOf(source, 'c').setProperty('Name', 'c2')).toBe(true);
    const saved = session.serializeSource(source.name).text as string;
    expect(cdataOf(saved)).toEqual(cdataOf(text));
    expect(open(saved, 'sparse_text.sldd').source.warnings).toEqual([
      warningFor('c2', "its MAT stream did not decode (Cannot read properties of null (reading 're'))"),
    ]);
  });
});

describe('a damaged stream that is a whole entry warns for that entry, and the entry can still be renamed', () => {
  // test/fixtures/nd_text.sldd, MATLAB-written: A a 2x3x2 double held as a stream, at the top of
  // its entry.
  const original = fixtureText('nd_text.sldd');

  it('A, its flags word overwritten', () => {
    const { text, cdata } = damage(original, cdataOf(original)[0], flagsWord);
    const { source } = open(text, 'nd_text.sldd');
    const a = entryOf(source, 'A');
    expect(source.warnings).toHaveLength(1);
    expect(source.warnings[0]).toMatchObject({ code: 'part-unreadable', part: 'A' });
    expect(source.warnings[0].message).toMatch(/^"A" holds a value stored encoded that could not be read, because /);
    expect(source.warnings[0].message.endsWith(SHOWN_AS_TEXT)).toBe(true);
    expect([a.className, a._scalarValue, a.valueEditable]).toEqual(['char', cdata, false]);
    expect(a.setProperty('Value', "'x'").reason).toMatch(STREAM_REASON);
    expect(a.setProperty('Name', 'A2')).toBe(true);
  });
});

describe('every stream preamble the reader refuses is warned about, with that reason', () => {
  // The two cases matStreamSites.test.ts refuses at every site, now through a dictionary open.
  // Byte 3 is the 'M' of the version and endian mark; bytes 4-7 are the reserved word.
  const CORRUPT: [string, (b: Uint8Array) => void, string][] = [
    ['the endian mark', (b) => (b[3] = 0x4c), 'its bytes are not a MAT stream (they do not open with 00 01 49 4D)'],
    ['the reserved word', (b) => (b[5] = 1), "its MAT stream's reserved bytes 4-7 are not zero"],
  ];
  const original = fixtureText('sparse/sparse_text.sldd');
  for (const [what, corrupt, reason] of CORRUPT) {
    it(what, () => {
      const { text, cdata } = damage(original, cdataOf(original)[0], corrupt);
      const { session, source } = open(text, 'sparse_text.sldd');
      expect(source.warnings).toEqual([warningFor('c', reason)]);
      const stored = entryOf(source, 'c').children[0];
      expect([stored.className, stored._scalarValue, stored.valueEditable]).toEqual(['char', cdata, false]);
      expect(session.serializeSource(source.name).text).toBe(text);
    });
  }
});

describe('what the harvest leaves as it was', () => {
  it('a hex value that does not decode is still shown as not decoded, and says so', () => {
    // The binary twin of the damage above: its message is the one recordDecodeFailure's default
    // spells.
    const sparse = fixtureText('sparse/sparse_text.sldd');
    const bytes = uudecode(cdataOf(sparse)[0]);
    flagsWord(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n<DataSource FormatVersion="1" MinRelease="R2014a">\n    <Object Class="DD.ENTRY">\n' +
      '        <P Name="Name" Class="char">v</P>\n        <P Name="UUID" Class="char">u</P>\n' +
      `        <P Name="Value" Class="double" Encoding="hex" EncodedLength="${bytes.length}">${hex}</P>\n    </Object>\n</DataSource>`;
    const warnings: ParseWarning[] = [];
    createSession().addDataSource('mem://hex', parseBinarySlddParts(xml, {}, warnings), { path: 'v.sldd' }, warnings);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/^"v" holds a value stored encoded that could not be read, because .*; it is shown as not decoded and saved unchanged\.$/);
  });

  it('a damaged stream read outside a dictionary open is not reported against the next one opened', () => {
    const sparse = fixtureText('sparse/sparse_text.sldd');
    const { cdata } = damage(sparse, cdataOf(sparse)[0], flagsWord);
    // A paste builds its node the same way, with no dictionary read around it.
    expect(MatlabVariableNode.parseCdata({ _type: 'cdata', _value: cdata }, 'pasted', null).className).toBe('char');
    expect(open(sparse, 'sparse_text.sldd').source.warnings).toBeUndefined();
  });

  it('no intact text dictionary in test/fixtures has a stream that warns', () => {
    // Every MATLAB-written stream the repo holds decodes, so the warning fires on no intact file.
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith('.sldd') && readFileSync(path)[0] === 0x7b) files.push(path);
      }
    };
    walk(FIXTURES);
    let streams = 0;
    for (const path of files) {
      const text = readFileSync(path, 'utf8');
      streams += cdataOf(text).length;
      const { source } = open(text, path.split('/').pop()!);
      const shownAsText = (source.warnings ?? []).filter((w: ParseWarning) => w.message.endsWith(SHOWN_AS_TEXT));
      expect(shownAsText, path).toEqual([]);
    }
    // The walk saw the text dictionaries and the streams in them: 23 and 99 when this was written.
    expect(files.length).toBeGreaterThanOrEqual(23);
    expect(streams).toBeGreaterThanOrEqual(99);
  });
});
