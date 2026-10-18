// Copyright 2026 The MathWorks, Inc.
//
// A 1x1 cell, and where MATLAB states its Dimension. test/fixtures/cell1x1_binary.sldd and
// cell1x1_text.sldd are MATLAB's (R2027a, make_cell1x1.m). They hold a 1x1 cell at every place a
// cell goes: an entry's Value (holding a double, a char, a string, an object, an empty and a
// cell), a cell element (nested two deep), a struct field, a field of each element of a struct
// array, a field of a struct in a cell, and an MCOS object's cell and struct properties (Widget,
// in Other Data). The controls are a 1x2, a 2x1 and a 0x0 cell.
//
// MATLAB's rule, measured there and over every binary dictionary MATLAB wrote that this project
// reads: a 1x1 cell has no Dimension in a binary dictionary, at any place, and every other cell
// has one. A text dictionary gives every 1x1 cell `_dimensions` [1, 1].
//
// The node writer (MatlabVariableNode._serializeCellXml) wrote `Dimension="1*1"` on every 1x1
// cell it wrote: an entry's Value, each cell element under it, and a struct field of an entry.
// The property writer (DataNode._cellXml) already left it out. MATLAB reads both spellings as the
// same 1x1 cell (cell1x1.truth.json), so nothing read back wrong. The cost was bytes: a save that
// rebuilt an entry rewrote a tag nobody edited.
//
// cell1x1.truth.json is MATLAB's reading of three binary files and the text twin: its own file, a
// copy with Dimension="1*1" added to every 1x1 cell (the old spelling), and core's own
// regeneration of the file. It also lists the cell open tags of each. To ask MATLAB again after a
// change to what core writes here (the last case below fails until it is asked):
//
//   npm run build && node test/fixtures/make_cell1x1_core.mjs /tmp/cell1x1
//   mw -using Bmain matlab -nodesktop -batch "cd('<repo>/test/fixtures'); make_cell1x1('', 'read', '/tmp/cell1x1/cell1x1_core.sldd')"
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import { regenerateChunkXml, regenerateEntryXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const DIR = new URL('./fixtures/', import.meta.url);
const bytesOf = (name: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(name, DIR))));
const bufferOf = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const chunkOf = (zip: Uint8Array): string => new TextDecoder().decode(unzipSync(zip)['data/chunk0.xml']);

const BINARY = bytesOf('cell1x1_binary.sldd');
const TEXT = bytesOf('cell1x1_text.sldd');
const MATLAB_CHUNK = chunkOf(BINARY);
type Read = { name: string; class: string; size: number[]; same: boolean };
const TRUTH = JSON.parse(new TextDecoder().decode(bytesOf('cell1x1.truth.json'))) as {
  release: string;
  patchedAdded: number;
  files: { file: string; cellTags: string[]; entries: Read[] }[];
};

/** Every cell open tag MATLAB wrote, entry by entry, copied from cell1x1_binary.sldd. */
const MATLAB_TAGS: Record<string, string[]> = {
  c0: ['<P Name="Value" Class="cell" Dimension="0*0"/>'],
  c11: ['<P Name="Value" Class="cell">'],
  c11cell: ['<P Name="Value" Class="cell">', '<Element Class="cell">'],
  c11char: ['<P Name="Value" Class="cell">'],
  c11empty: ['<P Name="Value" Class="cell">'],
  c11obj: ['<P Name="Value" Class="cell">'],
  c11str: ['<P Name="Value" Class="cell">', '<P Source="saveobj" PropertyType="any" Class="cell">'],
  c12: ['<P Name="Value" Class="cell" Dimension="1*2">'],
  c21: ['<P Name="Value" Class="cell" Dimension="2*1">'],
  cNest: ['<P Name="Value" Class="cell" Dimension="1*2">', '<Element Class="cell" Dimension="1*2">', '<Element Class="cell">'],
  cOfS: ['<P Name="Value" Class="cell">', '<P Name="c" Class="cell">'],
  s11: ['<P Name="c" Class="cell">'],
  sArr: ['<P Name="c" Class="cell">', '<P Name="c" Class="cell">'],
  sNest: ['<P Name="c" Class="cell">', '<Element Class="cell">'],
  widget: ['<P Name="c" Class="cell">', '<P Name="Cells" Class="cell">'],
};
const NAMES = Object.keys(MATLAB_TAGS);
const OLD = 'Class="cell" Dimension="1*1"';

const cellTags = (xml: string): string[] => xml.match(/<(?:P|Element)\b[^>]*Class="cell"[^>]*>/g) ?? [];

/** One entry's `<Object Class="DD.ENTRY">` block in a chunk. */
function entryBlock(xml: string, name: string): string {
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  expect(at, name).toBeGreaterThan(-1);
  return xml.slice(xml.lastIndexOf('<Object Class="DD.ENTRY">', at), xml.indexOf('\n    </Object>', at));
}

function open(bytes: Uint8Array, filename: string): { session: any; root: any; entry: (name: string) => any } {
  const session = createSession();
  const root: any = ingest(session, bufferOf(bytes), { filename });
  session.setActiveContext(root);
  const entry = (name: string): any => {
    const hit = root.children.flatMap((s: any) => s.children).find((e: any) => e.name === name);
    expect(hit, name).toBeTruthy();
    return hit;
  };
  return { session, root, entry };
}

const savedChunk = (session: any, root: any): string => chunkOf(new Uint8Array(session.serializeSource(root.name).bytes));
const sectionOf = (name: string): string => (name === 'widget' ? 'other' : 'design');
const uuidFor = (k: number): string => '00000000-0000-4000-8c11-' + String(k).padStart(12, '0');

/** Each Cell's `_dimensions` in a text-shaped value, in document order. */
function cellDims(value: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(value)) value.forEach((v) => cellDims(v, out));
  else if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (v._array_type === 'Cell') out.push(v._dimensions);
    Object.values(v).forEach((x) => cellDims(x, out));
  }
  return out;
}

/** Every entry of a text dictionary's JSON, by name. */
function textEntries(text: string): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.name === 'string' && 'value' in o && 'metadata' in o) out.set(o.name, o);
      else Object.values(o).forEach(walk);
    }
  };
  walk(JSON.parse(text));
  return out;
}

describe('MATLAB states no Dimension on a 1x1 cell in a binary dictionary, at any place', () => {
  it("cell1x1_binary.sldd: an entry's Value, a cell element, a struct field and an object's property", () => {
    for (const name of NAMES) expect(cellTags(entryBlock(MATLAB_CHUNK, name)), name).toEqual(MATLAB_TAGS[name]);
    expect(MATLAB_CHUNK).not.toContain(OLD);
  });

  it('cell1x1_text.sldd: `_dimensions` [1, 1] on every 1x1 cell', () => {
    const text = textEntries(new TextDecoder().decode(TEXT));
    expect(cellDims(text.get('c11')!.value)).toEqual([[1, 1]]);
    expect(cellDims(text.get('cNest')!.value)).toEqual([[1, 2], [1, 2], [1, 1]]);
    expect(cellDims(text.get('sArr')!.value)).toEqual([[1, 1], [1, 1]]);
    expect(cellDims(text.get('c12')!.value)).toEqual([[1, 2]]);
  });
});

describe('the binary writers state no Dimension on a 1x1 cell, as MATLAB does', () => {
  for (const name of NAMES) {
    it(`${name}, written from the model, has MATLAB's cell tags`, () => {
      const { entry } = open(BINARY, 'cell1x1_binary.sldd');
      expect(cellTags(regenerateEntryXml(entry(name)))).toEqual(MATLAB_TAGS[name]);
    });
  }

  it('the whole chunk written from the model has every cell tag MATLAB wrote', () => {
    const { root } = open(BINARY, 'cell1x1_binary.sldd');
    const written = regenerateChunkXml(root);
    expect(cellTags(written)).toEqual(cellTags(MATLAB_CHUNK));
    expect(written).not.toContain(OLD);
  });

  it('a removal that leaves one element: c12 without its second, and cNest without its first', () => {
    const { session, root, entry } = open(BINARY, 'cell1x1_binary.sldd');
    expect(session.deleteNodeById(entry('c12').children[1].id)).toBe(true);
    expect(session.deleteNodeById(entry('cNest').children[0].id)).toBe(true);
    const saved = savedChunk(session, root);
    expect(cellTags(entryBlock(saved, 'c12'))).toEqual(['<P Name="Value" Class="cell">']);
    expect(cellTags(entryBlock(saved, 'cNest'))).toEqual(['<P Name="Value" Class="cell">', '<Element Class="cell" Dimension="1*2">', '<Element Class="cell">']);
  });

  it('a 1x1 cell typed in: {7} over c12', () => {
    const { session, root, entry } = open(BINARY, 'cell1x1_binary.sldd');
    session.setActive(root, entry('c12'));
    expect(session.editProperty(entry('c12').id, 'Value', '{7}')).toBe(true);
    const block = entryBlock(savedChunk(session, root), 'c12');
    expect(cellTags(block)).toEqual(['<P Name="Value" Class="cell">']);
    expect(block).toContain('<P Name="Value" Class="cell">\n            <Element Class="double">7.0</Element>\n        </P>');
  });

  it('an edit inside a 1x1 cell keeps its tag (control: the merge keeps it from the file)', () => {
    const { session, root, entry } = open(BINARY, 'cell1x1_binary.sldd');
    const element = entry('c11').children[0];
    session.setActive(root, element);
    expect(session.editProperty(element.id, 'Value', '5')).toBe(true);
    const field = entry('s11').children[0].children[0];
    session.setActive(root, field);
    expect(session.editProperty(field.id, 'Value', '6')).toBe(true);
    const saved = savedChunk(session, root);
    expect(cellTags(entryBlock(saved, 'c11'))).toEqual(MATLAB_TAGS.c11);
    expect(entryBlock(saved, 'c11')).toContain('<Element Class="double">5.0</Element>');
    expect(cellTags(entryBlock(saved, 's11'))).toEqual(MATLAB_TAGS.s11);
    expect(entryBlock(saved, 's11')).toContain('<Element Class="double">6.0</Element>');
  });

  it("every entry of the text twin, pasted into the binary dictionary, has MATLAB's cell tags", () => {
    const text = open(TEXT, 'cell1x1_text.sldd');
    const { session, root } = open(BINARY, 'cell1x1_binary.sldd');
    NAMES.forEach((name, k) => {
      const raw = text.entry(name).serialize() as Record<string, any>;
      const pasted = root.getSection(sectionOf(name)).parseEntry({ ...raw, name: 'p_' + name, metadata: { ...raw.metadata, uuid: uuidFor(k) } });
      expect(pasted, name).toBeTruthy();
    });
    const saved = savedChunk(session, root);
    // The Widget's sorted, because the text twin holds its properties in another order (it
    // writes only those away from the class default), and the paste keeps that order.
    const inOrder = (name: string, tags: string[]): string[] => (name === 'widget' ? [...tags].sort() : tags);
    for (const name of NAMES) expect(inOrder(name, cellTags(entryBlock(saved, 'p_' + name))), name).toEqual(inOrder(name, MATLAB_TAGS[name]));
  });

  it("every entry copied within the binary dictionary has MATLAB's cell tags", () => {
    const { session, root, entry } = open(BINARY, 'cell1x1_binary.sldd');
    NAMES.forEach((name, k) => {
      const raw = entry(name).serialize() as Record<string, any>;
      expect(root.getSection(sectionOf(name)).parseEntry({ ...raw, name: 'k_' + name, metadata: { ...raw.metadata, uuid: uuidFor(100 + k) } }), name).toBeTruthy();
    });
    const saved = savedChunk(session, root);
    for (const name of NAMES) expect(cellTags(entryBlock(saved, 'k_' + name)), name).toEqual(MATLAB_TAGS[name]);
  });

  it('what the writers write now reads back as the value read from MATLAB\'s file', () => {
    const { root, entry } = open(BINARY, 'cell1x1_binary.sldd');
    const written = regenerateChunkXml(root);
    const session = createSession();
    const reread: any = session.addDataSource('mem://cell1x1', parseBinarySlddParts(written, {}), { path: 'cell1x1_binary.sldd' });
    const again = (name: string): any => reread.children.flatMap((s: any) => s.children).find((e: any) => e.name === name);
    for (const name of NAMES) expect((again(name).serialize() as any).value, name).toEqual((entry(name).serialize() as any).value);
    expect(cellDims((again('c11').serialize() as any).value)).toEqual([[1, 1]]);
    expect(cellDims((again('cNest').serialize() as any).value)).toEqual([[1, 2], [1, 2], [1, 1]]);
  });
});

describe("the text writers keep MATLAB's `_dimensions` [1, 1] (control)", () => {
  it('every binary entry pasted into the text twin, and an edit inside a 1x1 cell there', () => {
    const binary = open(BINARY, 'cell1x1_binary.sldd');
    const { session, root, entry } = open(TEXT, 'cell1x1_text.sldd');
    NAMES.forEach((name, k) => {
      const raw = binary.entry(name).serialize() as Record<string, any>;
      expect(root.getSection(sectionOf(name)).parseEntry({ ...raw, name: 'p_' + name, metadata: { ...raw.metadata, uuid: uuidFor(200 + k) } }), name).toBeTruthy();
    });
    const element = entry('c11').children[0];
    session.setActive(root, element);
    expect(session.editProperty(element.id, 'Value', '5')).toBe(true);
    const matlab = textEntries(new TextDecoder().decode(TEXT));
    const saved = textEntries(session.serializeSource(root.name).text);
    for (const name of NAMES) expect(cellDims(saved.get('p_' + name)!.value), name).toEqual(cellDims(matlab.get(name)!.value));
    expect(saved.get('c11')!.value).toMatchObject({ _array_type: 'Cell', _dimensions: [1, 1], _elements: [5] });
  });
});

describe('a cell that is not a 1x1 of one element keeps its Dimension (control)', () => {
  // Only a hand edit leaves a text dictionary's cell whose `_dimensions` and elements disagree, or
  // a 1x1 stated at rank 3. Each part of the writer's test stands for one of these: a [1, 1] of two
  // elements, which with no Dimension would reopen as the 1x2 of its elements in a cell or a
  // struct; a [1, 1, 1]; a [2, 1] and a [0, 1] of one element. Each is written with the dims it was
  // read with, as before, and only the true 1x1 of one element states none.
  const C = (dims: number[], elements: unknown[]) => ({ _array_type: 'Cell', _dimensions: dims, _elements: elements, _mw_element_type: 'MATLABArray' });
  const HAND_EDITED: [name: string, value: unknown, tag: string][] = [
    ['twoInOne', C([1, 1], [1, 2]), '<P Name="Value" Class="cell" Dimension="1*1">'],
    ['rankThree', C([1, 1, 1], [7]), '<P Name="Value" Class="cell" Dimension="1*1*1">'],
    ['column', C([2, 1], [7]), '<P Name="Value" Class="cell" Dimension="2*1">'],
    ['noRows', C([0, 1], [7]), '<P Name="Value" Class="cell" Dimension="0*1">'],
    ['oneByOne', C([1, 1], [7]), '<P Name="Value" Class="cell">'],
  ];
  const handEdited = (): Uint8Array => {
    const json = JSON.parse(new TextDecoder().decode(bytesOf('rt_text.sldd')));
    const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    HAND_EDITED.forEach(([name, value], k) => entries.push({ name, metadata: { ...entries[0].metadata, uuid: uuidFor(300 + k) }, value }));
    return new TextEncoder().encode(JSON.stringify(json, null, '\t'));
  };

  it('written from the model of the text dictionary', () => {
    const { entry } = open(handEdited(), 'handEdited.sldd');
    for (const [name, , tag] of HAND_EDITED) expect(cellTags(regenerateEntryXml(entry(name))), name).toEqual([tag]);
  });

  it('pasted into a binary dictionary and saved', () => {
    const text = open(handEdited(), 'handEdited.sldd');
    const { session, root } = open(BINARY, 'cell1x1_binary.sldd');
    HAND_EDITED.forEach(([name], k) => {
      const raw = text.entry(name).serialize() as Record<string, any>;
      expect(root.getSection('design').parseEntry({ ...raw, name: 'p_' + name, metadata: { ...raw.metadata, uuid: uuidFor(400 + k) } }), name).toBeTruthy();
    });
    const saved = savedChunk(session, root);
    for (const [name, , tag] of HAND_EDITED) expect(cellTags(entryBlock(saved, 'p_' + name)), name).toEqual([tag]);
  });
});

describe("MATLAB's reading of each spelling (cell1x1.truth.json)", () => {
  it('reads every entry back as the value written, from its own file, the old spelling and core\'s', () => {
    expect(TRUTH.release).toBe('2027a');
    expect(TRUTH.files.map((f) => f.file)).toEqual(['cell1x1_binary.sldd', 'cell1x1_text.sldd', 'cell1x1_patched.sldd', 'cell1x1_core.sldd']);
    for (const f of TRUTH.files) {
      expect(f.entries.map((e) => e.name).sort(), f.file).toEqual([...NAMES].sort());
      expect(f.entries.filter((e) => !e.same).map((e) => e.name), f.file).toEqual([]);
      const read = Object.fromEntries(f.entries.map((e) => [e.name, e.class + ' ' + e.size.join('x')]));
      expect(read, f.file).toMatchObject({ c11: 'cell 1x1', c11cell: 'cell 1x1', cNest: 'cell 1x2', c12: 'cell 1x2', c21: 'cell 2x1', s11: 'struct 1x1', widget: 'Widget 1x1' });
    }
    const patched = TRUTH.files.find((f) => f.file === 'cell1x1_patched.sldd')!;
    expect(patched.cellTags.filter((t) => t.includes(OLD)).length).toBe(TRUTH.patchedAdded);
    expect(TRUTH.patchedAdded).toBe(cellTags(MATLAB_CHUNK).filter((t) => !t.includes('Dimension=') && !t.includes('Source="saveobj"')).length);
  });

  it('core writes now the cell tags MATLAB read in its regeneration of the file, which are MATLAB\'s own', () => {
    const { root } = open(BINARY, 'cell1x1_binary.sldd');
    const ours = TRUTH.files.find((f) => f.file === 'cell1x1_core.sldd')!;
    expect(ours.cellTags).toEqual(cellTags(MATLAB_CHUNK));
    expect(cellTags(regenerateChunkXml(root))).toEqual(ours.cellTags);
  });
});
