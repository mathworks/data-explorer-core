// Copyright 2026 The MathWorks, Inc.
//
// A -0 in a typed literal. MATLAB keeps the sign of a negative zero wherever its text
// dictionary spells the value as a typed literal, and drops it where it spells a bare JSON
// number. Measured (R2027a, test/numbers/make_negative_zero.m, negzero.truth.json): its
// text writer puts -0, [-0 1], {-0}, struct('a',-0) and Simulink.Parameter(-0) down as `0`,
// `[0, 1]`, `[0]`, `"a": 0` and `"Value": 0`, which read back +0, but single(-0) as `-0.0F`,
// [-0;1] as `Matrix(2,1)\n[-0.0, 1.0]`, [-0 Inf] as `[-0.0, Inf]`, and each of those reads
// back -0. So does this package's own spelling of a single, `-0F` and `[-0F, 1F]`
// (negzero_spelled.sldd). A compressed-binary dictionary spells every -0 `-0.0`.
//
// This package wrote a typed literal's -0 as 0: a single as `0F` (formatNumLiteral's single
// arm, String(-0)), a double as `0.0` (formatDoubleXml). The binary reader holds a single, a
// column, a matrix and a row beside a non-finite as that literal, so the sign went at the
// read, before anything was edited: in the value shown, in a paste into a text dictionary,
// and in the binary dictionary's own save, which wrote `0.0` where MATLAB had `-0.0`. A text
// dictionary lost it too, at the first edit of any other element of the same array.
//
// A bare double keeps the JSON spelling, `0`, the one MATLAB's own text writer gives a -0
// there; and a -0 is shown as 0 everywhere, as MATLAB shows it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { regenerateEntryXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { formatMatlabNum, formatNumLiteral } from '../src/datamodel/parser/XmlUtils.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const DIR = new URL('./numbers/', import.meta.url);
const bufferOf = (name: string): ArrayBuffer => {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(name, DIR))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
};
const textBuffer = (text: string): ArrayBuffer => {
  const u8 = new TextEncoder().encode(text);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
};
const entriesOfText = (text: string): any[] =>
  JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
const chunkOf = (zip: Uint8Array): string => new TextDecoder().decode(unzipSync(zip)['data/chunk0.xml']);

interface TruthEntry {
  name: string;
  class: string;
  size: number[];
  negative: boolean[];
  same: boolean;
}
const TRUTH = JSON.parse(new TextDecoder().decode(new Uint8Array(bufferOf('negzero.truth.json')))) as {
  release: string;
  files: { file: string; entries: TruthEntry[] }[];
};
/** How many -0s MATLAB read in `name`, out of `file`. */
const matlabMinusZeros = (file: string, name: string): number =>
  TRUTH.files.find((f) => f.file === file)!.entries.find((e) => e.name === name)!.negative.filter(Boolean).length;

const MATLAB_TEXT = new TextDecoder().decode(new Uint8Array(bufferOf('negzero_text.sldd')));
const SPELLED = entriesOfText(new TextDecoder().decode(new Uint8Array(bufferOf('negzero_spelled.sldd'))));
const MATLAB_CHUNK = chunkOf(new Uint8Array(bufferOf('negzero_binary.sldd')));
const valueIn = (entries: any[], name: string): unknown => entries.find((e) => e.name === name)!.value;

// The values MATLAB's text writer spells as a typed literal, keeping the sign; and the ones it
// spells as a bare JSON number, dropping it. posz and poszS are +0, the controls.
const TYPED = ['negzCol', 'negzMat', 'negzInfRow', 'negzS', 'negzSRow', 'negzSCol', 'negzSCell'];
const BARE = ['negz', 'negzRow', 'negzCell', 'negzStruct'];
const ALL = [...TYPED, ...BARE, 'negzP', 'posz', 'poszS'];

/** Every number a node holds, its element rows', its fields' and a Parameter's Value included. */
function numbersOf(node: any): unknown[] {
  if (node.children.length > 0) {
    return node.children.flatMap(numbersOf);
  }
  const v = node.Value;
  return Array.isArray(v) ? v : [v];
}
const minusZeros = (node: any): number => numbersOf(node).filter((x) => Object.is(x, -0)).length;
/** `of(name)` for each name, keyed by it, so that a failure names every entry that differs. */
const each = <T>(names: string[], of: (name: string) => T): Record<string, T> => Object.fromEntries(names.map((n) => [n, of(n)]));

/** The number-bearing tags of one entry's `<Object>`, found by its Name, as written. */
function numberTags(xml: string, name: string): string[] {
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  expect(at, name).toBeGreaterThan(-1);
  const end = xml.indexOf('<Object Class="DD.', at);
  const block = xml.slice(at, end < 0 ? undefined : end);
  return block.match(/<(?:P Name="\w+"|Element) Class="(?:double|single)"[^>]*>[^<]*<\/(?:P|Element)>/g) ?? [];
}

const binaryDesign = (): { session: any; root: any; design: any } => {
  const session = createSession();
  const root: any = ingest(session, bufferOf('negzero_binary.sldd'), { filename: 'negzero_binary.sldd' });
  return { session, root, design: root.getSection('design') };
};
const textDesign = (): { session: any; root: any; design: any } => {
  const session = createSession();
  const root: any = ingest(session, bufferOf('negzero_text.sldd'), { filename: 'negzero_text.sldd' });
  return { session, root, design: root.getSection('design') };
};
const entryIn = (design: any, name: string): any => design.children.find((c: any) => c.name === name);

describe('the -0 fixtures are what these tests need', () => {
  it('MATLAB read back every value it wrote, in each of the three files', () => {
    expect(TRUTH.release).toBe('2027a');
    expect(TRUTH.files.map((f) => f.file)).toEqual(['negzero_binary.sldd', 'negzero_text.sldd', 'negzero_spelled.sldd']);
    for (const f of TRUTH.files) {
      expect(f.entries.map((e) => e.name).sort(), f.file).toEqual([...ALL].sort());
      for (const e of f.entries) expect(e.same, `${f.file} ${e.name}`).toBe(true);
    }
  });

  it('a binary dictionary keeps every -0; a text one keeps the typed ones and drops the bare ones', () => {
    for (const name of [...TYPED, ...BARE, 'negzP']) expect(matlabMinusZeros('negzero_binary.sldd', name), name).toBe(1);
    for (const file of ['negzero_text.sldd', 'negzero_spelled.sldd']) {
      for (const name of TYPED) expect(matlabMinusZeros(file, name), `${file} ${name}`).toBe(1);
      for (const name of [...BARE, 'negzP']) expect(matlabMinusZeros(file, name), `${file} ${name}`).toBe(0);
    }
    for (const f of TRUTH.files) for (const name of ['posz', 'poszS']) expect(matlabMinusZeros(f.file, name), `${f.file} ${name}`).toBe(0);
  });

  it('negzero_spelled.sldd is MATLAB\'s file with the single literals in this package\'s spelling', () => {
    expect(valueIn(SPELLED, 'negzS')).toEqual({ _type: 'single', _value: '-0F' });
    expect(valueIn(SPELLED, 'negzSRow')).toEqual({ _type: 'single', _value: '[-0F, 1F]' });
    expect(valueIn(entriesOfText(MATLAB_TEXT), 'negzSRow')).toEqual({ _type: 'single', _value: '[-0.0F, 1.0F]' });
    expect(valueIn(SPELLED, 'negzCol')).toEqual(valueIn(entriesOfText(MATLAB_TEXT), 'negzCol'));
  });
});

describe('a -0 read out of a binary dictionary keeps its sign', () => {
  const { design } = binaryDesign();

  it('in the value read, as MATLAB reads the same file', () => {
    expect(each(ALL, (n) => minusZeros(entryIn(design, n)))).toEqual(each(ALL, (n) => matlabMinusZeros('negzero_binary.sldd', n)));
  });

  it('in the typed literal it is held as, spelled as a text dictionary MATLAB reads as -0 spells it', () => {
    const names = [...TYPED, 'poszS'];
    expect(each(names, (n) => JSON.parse(JSON.stringify(entryIn(design, n).serialize().value)))).toEqual(each(names, (n) => valueIn(SPELLED, n)));
  });

  it('in an entry the save rebuilds, as MATLAB writes it, -0.0', () => {
    expect(each(ALL, (n) => numberTags(regenerateEntryXml(entryIn(design, n)), n))).toEqual(each(ALL, (n) => numberTags(MATLAB_CHUNK, n)));
  });

  it('when another element of the array is edited and the dictionary saved', () => {
    const { session, root, design: d } = binaryDesign();
    for (const name of ['negzSRow', 'negzCol', 'negzMat']) {
      const last = entryIn(d, name).children.at(-1);
      session.setActive(root, last);
      expect(session.editProperty(last.id, 'Value', '9'), name).toBe(true);
    }
    const saved = chunkOf(session.serializeSource(root.name)!.bytes as Uint8Array);
    expect(each(['negzSRow', 'negzCol', 'negzMat'], (n) => numberTags(saved, n))).toEqual({
      negzSRow: ['<P Name="Value" Class="single" Dimension="1*2">-0.0 9.0</P>'],
      negzCol: ['<P Name="Value" Class="double" Dimension="2*1">-0.0 9.0</P>'],
      negzMat: ['<P Name="Value" Class="double" Dimension="2*2">-0.0 2.0 1.0 9.0</P>'],
    });
  });
});

describe('a -0 pasted out of a binary dictionary into a text one', () => {
  // A paste is the entry's record through JSON, as a host's clipboard carries it.
  const { design: from } = binaryDesign();
  const { session, root, design } = textDesign();
  const meta = entryIn(design, 'posz').metadata;
  ALL.forEach((name, i) => {
    const record: any = JSON.parse(JSON.stringify(entryIn(from, name).serialize()));
    record.name = name + '_pasted';
    record.metadata = { ...meta, uuid: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}` };
    design.parseEntry(record);
  });
  const saved = session.serializeSource(root.name)!;
  const written = entriesOfText(saved.text);
  const reopened: any = ingest(createSession(), textBuffer(saved.text), { filename: 'negzero_text.sldd' }).getSection('design');

  it('is written in a typed literal as -0, a spelling MATLAB reads back as -0', () => {
    expect(saved.kind).toBe('text');
    const names = [...TYPED, 'poszS'];
    expect(each(names, (n) => valueIn(written, n + '_pasted'))).toEqual(each(names, (n) => valueIn(SPELLED, n)));
  });

  it('and reopens as -0', () => {
    const names = [...TYPED, 'poszS'];
    expect(each(names, (n) => minusZeros(entryIn(reopened, n + '_pasted')))).toEqual(each(names, (n) => matlabMinusZeros('negzero_spelled.sldd', n)));
  });

  it('but as a bare JSON number is written 0, as MATLAB\'s own text writer writes it', () => {
    // A guard, which passes on either side of the change: MATLAB puts these -0s down as 0.
    // The numbers are compared, not the wrapper, which this package writes with a `_fields`
    // MATLAB's struct has not.
    const matlab = entriesOfText(MATLAB_TEXT);
    const body = (v: any): unknown => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v._elements : v);
    for (const name of [...BARE, 'posz']) {
      expect(body(valueIn(written, name + '_pasted')), name).toEqual(body(valueIn(matlab, name)));
    }
    const valueProp = (v: any): unknown => v._elements[0]._properties.Value;
    expect(valueProp(valueIn(written, 'negzP_pasted'))).toBe(0);
    expect(valueProp(valueIn(matlab, 'negzP'))).toBe(0);
    for (const name of [...BARE, 'negzP']) expect(minusZeros(entryIn(reopened, name + '_pasted')), name).toBe(0);
  });
});

describe('a text dictionary\'s own -0', () => {
  it('reads as -0 wherever MATLAB\'s file spells it', () => {
    // A guard, which passes on either side of the change: the text reader always kept a
    // spelled -0. It was the writer that dropped it.
    const { design } = textDesign();
    expect(each(ALL, (n) => minusZeros(entryIn(design, n)))).toEqual(each(ALL, (n) => matlabMinusZeros('negzero_text.sldd', n)));
  });

  it('keeps its sign when another element of the array is edited and the dictionary saved', () => {
    const { session, root, design } = textDesign();
    for (const name of ['negzSRow', 'negzCol', 'negzMat']) {
      const last = entryIn(design, name).children.at(-1);
      session.setActive(root, last);
      expect(session.editProperty(last.id, 'Value', '9'), name).toBe(true);
    }
    const written = entriesOfText(session.serializeSource(root.name)!.text);
    expect(each(['negzSRow', 'negzCol', 'negzMat'], (n) => valueIn(written, n))).toEqual({
      negzSRow: { _type: 'single', _value: '[-0F, 9F]' },
      negzCol: { _type: 'double', _value: 'Matrix(2,1)\n[-0.0, 9.0]' },
      negzMat: { _type: 'double', _value: 'Matrix(2,2)\n[[-0.0, 1.0]; [2.0, 9.0]]' },
    });
  });
});

describe('a -0 is shown as 0, as MATLAB shows it', () => {
  it('in every entry and element row of either file', () => {
    // A guard, which passes on either side of the change: the display formatter
    // (formatMatlabNum) stays sign-blind, and only a typed literal's spelling changed.
    for (const { design } of [binaryDesign(), textDesign()]) {
      for (const name of ALL) {
        const e = entryIn(design, name);
        const shown = [e, ...e.children].map((n: any) => String(n.displayValue));
        for (const s of shown) expect(s, name).not.toMatch(/-0(?![.\d])|-0\.0/);
      }
    }
    expect(formatMatlabNum(-0)).toBe('0');
  });

  it('while a typed literal spells it -0F and -0.0', () => {
    expect(formatNumLiteral(-0, 'single')).toBe('-0F');
    expect(formatNumLiteral(-0, 'double')).toBe('-0.0');
    expect(formatNumLiteral(0, 'single')).toBe('0F');
    expect(formatNumLiteral(0, 'double')).toBe('0.0');
  });
});
