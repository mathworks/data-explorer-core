// Copyright 2026 The MathWorks, Inc.
//
// A 1xN char row in a binary dictionary, and when MATLAB states its Dimension.
// test/fixtures/char_rowdim_binary.sldd is MATLAB's (R2027a, make_char_rowdim.m): rows of
// 1 to 4096 characters at every place a row goes. That covers an entry's Value, a cell
// element, a struct field, a struct in a cell and a cell in a struct, a Simulink.Parameter's
// Description, a string's elements, and the char, string, struct and cell properties of an
// MCOS object (Widget, in Other Data). char_rowdim.truth.json is MATLAB's reading of the
// file. It also reads a copy with every row Dimension taken out and one added to a
// 100-char row, and every value in both reads back as written.
//
// MATLAB's rule, measured there: a row carries `Dimension="1*N"` exactly when N is over
// 512, and N counts MATLAB char elements (UTF-16 code units), not bytes. `é` x512 has none
// and x513 has one. 256 `&<` pairs, 2,560 bytes once escaped, have none. A newline or a
// CRLF does not trigger it. A char MATLAB writes as its codes (Format="decimal") always
// has a Dimension, and that is unchanged here.
//
// The writers gave a row no Dimension at any length (charNeedsShape is false for every
// 1xN), so each entry a save rebuilt lost MATLAB's Dimension on every row over 512. MATLAB
// reads both forms as the same value, so nothing read back wrong. The cost was bytes: a
// save rewrote text nobody edited.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { regenerateEntryXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { charRowDimension, MATLAB_CHAR_ROW_DIM_THRESHOLD } from '../src/datamodel/parser/XmlUtils.js';
import DataNode from '../src/datamodel/node/DataNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const DIR = new URL('./fixtures/', import.meta.url);
const bytesOf = (name: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(name, DIR))));
const chunkOf = (zip: Uint8Array): string => new TextDecoder().decode(unzipSync(zip)['data/chunk0.xml']);
const bufferOf = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

const FIXTURE = bytesOf('char_rowdim_binary.sldd');
const MATLAB_CHUNK = chunkOf(FIXTURE);
const TRUTH = JSON.parse(new TextDecoder().decode(bytesOf('char_rowdim.truth.json'))) as {
  release: string;
  patchedRemoved: number;
  files: { file: string; entries: { name: string; class: string; size: number[]; same: boolean }[] }[];
};

/** One entry's `<Object>` block as a save writes it: its own lines, the last newline included. */
function entryBlock(xml: string, name: string): string {
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  expect(at, name).toBeGreaterThan(-1);
  const open = xml.lastIndexOf('<Object Class="DD.ENTRY">', at);
  const close = xml.indexOf('</Object>', at) + '</Object>'.length;
  return xml.slice(xml.lastIndexOf('\n', open) + 1, close) + '\n';
}

/** Every run of one character past 16 as `<a x513>`, so a failure's diff is readable. */
const collapse = (xml: string): string => xml.replace(/(.)\1{16,}/gs, (run, c: string) => `<${c} x${run.length}>`);

const decode = (body: string): string =>
  body.replace(/&#xD;/g, '\r').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

interface CharTag {
  tag: string;
  dimension: string | null;
  length: number;
}

/** Every char written as text in `xml` (not a Format="decimal" one): its open tag, Dimension and length. */
function charTags(xml: string): CharTag[] {
  const out: CharTag[] = [];
  for (const m of xml.matchAll(/(<(?:P|Element)\b[^>]*? Class="char"(?: Dimension="([^"]*)")?)>([^<]*)</g)) {
    if (/Format=/.test(m[1]) || / Name="(?:Name|UUID|Namespace|LastMod|LastModBy|IsDerived)"/.test(m[1])) continue;
    out.push({ tag: m[1] + '>', dimension: m[2] ?? null, length: decode(m[3]).length });
  }
  return out;
}

function open(): { session: any; root: any; entry: (name: string) => any } {
  const session = createSession();
  const root: any = ingest(session, bufferOf(FIXTURE), { filename: 'char_rowdim_binary.sldd' });
  const all = (): any[] => root.children.flatMap((s: any) => s.children);
  return { session, root, entry: (name) => all().find((n: any) => n.name === name) };
}

const savedBlock = (session: any, root: any, name: string): string =>
  entryBlock(chunkOf(session.serializeSource(root.name)!.bytes as Uint8Array), name);

const NAMES = TRUTH.files[0].entries.map((e) => e.name);
/** The entries holding a row over 512, at some depth. */
const LONG = NAMES.filter((n) => charTags(entryBlock(MATLAB_CHUNK, n)).some((t) => t.length > 512));
const SHORT = NAMES.filter((n) => !LONG.includes(n));

describe('MATLAB states a char row\'s Dimension exactly when it is over 512 characters', () => {
  it('the fixture is MATLAB\'s, and MATLAB reads every value back as written, Dimension or none', () => {
    expect(TRUTH.release).toBe('2027a');
    expect(TRUTH.files.map((f) => f.file)).toEqual(['char_rowdim_binary.sldd', 'char_rowdim_patched.sldd']);
    const inChunk = [...MATLAB_CHUNK.matchAll(/<P Name="Name" Class="char">([^<]*)<\/P>/g)].map((m) => m[1]);
    expect([...NAMES].sort()).toEqual([...inChunk].sort());
    for (const f of TRUTH.files) {
      expect(f.entries.map((e) => e.name), f.file).toEqual(NAMES);
      for (const e of f.entries) {
        expect(e.same, `${f.file} ${e.name}`).toBe(true);
      }
    }
    // The patched copy had every row Dimension taken out, and each is one of these.
    expect(charTags(MATLAB_CHUNK).filter((t) => t.dimension !== null).length).toBe(TRUTH.patchedRemoved);
  });

  it('in every row of MATLAB\'s file, at every place, and the boundary is at each place', () => {
    const tags = charTags(MATLAB_CHUNK);
    for (const t of tags) {
      expect(t.dimension, t.tag + ' of ' + t.length).toBe(t.length > 512 ? '1*' + t.length : null);
    }
    expect(tags.filter((t) => t.dimension !== null).length).toBe(24);
    // 512 and 513 side by side, at an entry Value, a cell element, a struct field, a
    // Parameter Description, a string element and an object's cell: the threshold is one
    // rule, not one per place.
    for (const name of ['rd_512', 'rd_513', 'rd_cell', 'rd_struct', 'rd_structOfCell', 'rd_strArr', 'rd_widget']) {
      expect(charTags(entryBlock(MATLAB_CHUNK, name)).some((t) => t.length === 512 || t.length === 513), name).toBe(true);
    }
    expect(charTags(entryBlock(MATLAB_CHUNK, 'rd_p512'))).toContainEqual({ tag: '<P Name="Description" Class="char">', dimension: null, length: 512 });
    expect(charTags(entryBlock(MATLAB_CHUNK, 'rd_p513'))).toContainEqual({
      tag: '<P Name="Description" Class="char" Dimension="1*513">', dimension: '1*513', length: 513,
    });
    expect(LONG.length).toBe(16);
  });
});

describe('an entry the writer rebuilds is MATLAB\'s entry, byte for byte', () => {
  const { entry } = open();

  for (const name of LONG.filter((n) => n !== 'rd_cellOfStruct')) {
    it(`${name}: every row over 512 keeps Dimension="1*N"`, () => {
      const ours = regenerateEntryXml(entry(name));
      const matlab = entryBlock(MATLAB_CHUNK, name);
      expect(collapse(ours)).toBe(collapse(matlab));
      expect(ours).toBe(matlab);
    });
  }

  it('rd_cellOfStruct: the struct field of 513 in a 1x1 cell keeps its Dimension', () => {
    // Only the char tags are compared here. This writer gives the 1x1 cell around the struct
    // a Dimension="1*1" that MATLAB does not write, which is a separate difference.
    expect(charTags(regenerateEntryXml(entry('rd_cellOfStruct')))).toEqual(charTags(entryBlock(MATLAB_CHUNK, 'rd_cellOfStruct')));
  });

  it('rows of 512 or fewer carry none, with é, an escaped & or a newline in them (a guard)', () => {
    // Passes before and after the change. A Dimension here would be one MATLAB does not write.
    expect(SHORT).toEqual(['rd_1', 'rd_100', 'rd_511', 'rd_512', 'rd_e512', 'rd_nl100', 'rd_amp512', 'rd_p512']);
    for (const name of SHORT) {
      expect(regenerateEntryXml(entry(name)), name).toBe(entryBlock(MATLAB_CHUNK, name));
    }
  });
});

describe('a save after an edit writes each row as MATLAB does', () => {
  const a = (n: number): string => 'a'.repeat(n);

  it('an edit of one element of a cell keeps the Dimension of the long rows beside it', () => {
    const { session, root, entry } = open();
    const cell = entry('rd_cell');
    const last = cell.children[4];
    session.setActive(root, last);
    expect(session.editProperty(last.id, 'Value', "'edited'")).toBe(true);
    const matlab = charTags(entryBlock(MATLAB_CHUNK, 'rd_cell'));
    expect(charTags(savedBlock(session, root, 'rd_cell'))).toEqual([
      ...matlab.slice(0, 4),
      { tag: '<Element Class="char">', dimension: null, length: 6 },
    ]);
  });

  it('a 513-character value typed into an entry is saved as MATLAB writes rd_513', () => {
    const { session, root, entry } = open();
    const n = entry('rd_100');
    session.setActive(root, n);
    expect(session.editProperty(n.id, 'Value', "'" + a(513) + "'")).toBe(true);
    expect(charTags(savedBlock(session, root, 'rd_100'))).toEqual(charTags(entryBlock(MATLAB_CHUNK, 'rd_513')));
  });

  it('and shortened to 512 it is saved as MATLAB writes rd_512 (a guard)', () => {
    // Passes before and after: no writer stated a row's Dimension before the change.
    const { session, root, entry } = open();
    const n = entry('rd_513');
    session.setActive(root, n);
    expect(session.editProperty(n.id, 'Value', "'" + a(512) + "'")).toBe(true);
    expect(charTags(savedBlock(session, root, 'rd_513'))).toEqual(charTags(entryBlock(MATLAB_CHUNK, 'rd_512')));
  });

  it('a Parameter Description typed at 513 characters is saved as MATLAB writes rd_p513\'s', () => {
    const { session, root, entry } = open();
    const p = entry('rd_p512');
    session.setActive(root, p);
    expect(session.editProperty(p.id, 'Description', 'd'.repeat(513))).toBe(true);
    const description = (xml: string): CharTag[] => charTags(xml).filter((t) => t.tag.startsWith('<P Name="Description"'));
    expect(description(savedBlock(session, root, 'rd_p512'))).toEqual(description(entryBlock(MATLAB_CHUNK, 'rd_p513')));
  });

  it('an object saved after an edit of another property keeps every row of its char, string, struct and cell', () => {
    const { session, root, entry } = open();
    const w = entry('rd_widget');
    const scalar = w.children.find((c: any) => c.name === 'Scalar');
    session.setActive(root, scalar);
    expect(session.editProperty(scalar.id, 'Value', '2')).toBe(true);
    const saved = savedBlock(session, root, 'rd_widget');
    expect(saved).toContain('<P Name="Scalar" Class="double">2.0</P>');
    expect(charTags(saved)).toEqual(charTags(entryBlock(MATLAB_CHUNK, 'rd_widget')));
  });
});

describe('charRowDimension is the threshold rule, and only for a row', () => {
  it('states the length of a row over 512, in UTF-16 code units', () => {
    expect(MATLAB_CHAR_ROW_DIM_THRESHOLD).toBe(512);
    expect(charRowDimension('a'.repeat(512), [1, 512])).toBe('');
    expect(charRowDimension('a'.repeat(513), [1, 513])).toBe(' Dimension="1*513"');
    expect(charRowDimension('é'.repeat(513), [1, 513])).toBe(' Dimension="1*513"');
    // A surrogate pair is two MATLAB characters, as MATLAB's char is a 16-bit code unit.
    expect(charRowDimension('a'.repeat(511) + '\u{1F600}', [1, 513])).toBe(' Dimension="1*513"');
    expect(charRowDimension('a'.repeat(510) + '\u{1F600}', [1, 512])).toBe('');
  });

  it('says nothing of a shape that is not a row, which charNeedsShape states', () => {
    expect(charRowDimension('a'.repeat(600), [2, 300])).toBe('');
    expect(charRowDimension('a'.repeat(600), [600, 1])).toBe('');
    expect(charRowDimension('a'.repeat(600), [1, 600, 1])).toBe('');
  });
});

describe('an mxchar with no Matrix() header is a row, and is written as one', () => {
  // MATLAB writes the mxchar envelope only for a char that is not a row, so one with no
  // header comes from a hand-edited text dictionary, in a value an object holds. It is read
  // as a row (MatlabVariableNode.parseMxChar), and the property and cell writers write it as
  // a row, with MATLAB's Dimension past 512.
  const mxchar = (n: number) => ({ _type: 'mxchar', _value: 'a'.repeat(n) });

  it('as a property', () => {
    expect(DataNode.serializePropertyXml('t', mxchar(513), 0, null)).toBe('<P Name="t" Class="char" Dimension="1*513">' + 'a'.repeat(513) + '</P>');
    expect(DataNode.serializePropertyXml('t', mxchar(512), 0, null)).toBe('<P Name="t" Class="char">' + 'a'.repeat(512) + '</P>');
  });

  it('as a cell element', () => {
    expect(DataNode._serializeCellElementXml(mxchar(513), 0)).toBe('<Element Class="char" Dimension="1*513">' + 'a'.repeat(513) + '</Element>');
    expect(DataNode._serializeCellElementXml(mxchar(512), 0)).toBe('<Element Class="char">' + 'a'.repeat(512) + '</Element>');
  });
});
