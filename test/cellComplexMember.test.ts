// Copyright 2026 The MathWorks, Inc.
//
// A complex member of a cell literal, typed in. MATLAB makes a complex double of it; this
// parser split it at its spaces and held what was left as text.
//
// `{3 + 4i}` was three members, `3`, the char `'+'` and the char `'0+4i'`; `{3+ 4i}` was the
// chars `'3+'` and `'0+4i'`; and a complex member written without spaces, `{1+2i}`, `{i, j}`,
// `{2i 3}`, was held as its text, a char. A save wrote that char into the file, in either
// format: `"1+2i"` in a text dictionary, `<Element Class="char">1+2i</Element>` in a binary
// one. MATLAB R2027a makes a 1x1 complex double of `{3 + 4i}` and writes a complex member as
// a MAT stream (text) or `<Element Class="double" IsComplex="1">` (binary). Followed under
// the maintainer's "follow MATLAB" ruling (group F, 2026-10-18, item CPLX-CELL).
//
// MATLAB's rule inside brackets and braces is about whitespace: a `+` or `-` with whitespace
// after it, or with none before it, is binary and joins the terms either side of it
// (`3 + 4i`, `3+ 4i`, `1 - 2i`); one with whitespace before it and none after it is unary
// and starts a new member (`3 +4i`, `1 -2`). This parser does no arithmetic, so a joined
// span that is not a complex literal (`1 + 2`, `a + b`) is refused rather than held as text,
// which would store a char where MATLAB holds `3`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import MatlabValueParser from '../src/datamodel/parser/MatlabValueParser.js';
import { formatComplexNum, parseComplexNum } from '../src/datamodel/parser/XmlUtils.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Member = number | { re: number; im: number };

/**
 * Each literal and what MATLAB R2027a makes of it: `eval` of the literal, then class,
 * complexity, size and parts (measure1.log of the group F scoping, quoted above each row).
 */
const MATLAB_MAKES: { literal: string; dims: number[]; members: Member[] }[] = [
  // LIT {3 + 4i}       -> cell [1 1] {double complex [1 1] [3,4i]}
  { literal: '{3 + 4i}', dims: [1, 1], members: [{ re: 3, im: 4 }] },
  // LIT {3 +4i}        -> cell [1 2] {double [1 1] [3] ; double complex [1 1] [0,4i]}
  { literal: '{3 +4i}', dims: [1, 2], members: [3, { re: 0, im: 4 }] },
  // LIT {3+ 4i}        -> cell [1 1] {double complex [1 1] [3,4i]}
  { literal: '{3+ 4i}', dims: [1, 1], members: [{ re: 3, im: 4 }] },
  // LIT {3+4i}         -> cell [1 1] {double complex [1 1] [3,4i]}
  { literal: '{3+4i}', dims: [1, 1], members: [{ re: 3, im: 4 }] },
  // LIT {i, j}         -> cell [1 2] {double complex [1 1] [0,1i] ; double complex [1 1] [0,1i]}
  { literal: '{i, j}', dims: [1, 2], members: [{ re: 0, im: 1 }, { re: 0, im: 1 }] },
  // LIT {1i}           -> cell [1 1] {double complex [1 1] [0,1i]}
  { literal: '{1i}', dims: [1, 1], members: [{ re: 0, im: 1 }] },
  // LIT {-i}           -> cell [1 1] {double complex [1 1] [-0,-1i]}
  // MATLAB's real part is -0, this parser's +0 (as at the top level): compared sign-blind.
  { literal: '{-i}', dims: [1, 1], members: [{ re: -0, im: -1 }] },
  // LIT {1 - 2i, 3}    -> cell [1 2] {double complex [1 1] [1,-2i] ; double [1 1] [3]}
  { literal: '{1 - 2i, 3}', dims: [1, 2], members: [{ re: 1, im: -2 }, 3] },
  // LIT {3 + 4j}       -> cell [1 1] {double complex [1 1] [3,4i]}
  { literal: '{3 + 4j}', dims: [1, 1], members: [{ re: 3, im: 4 }] },
  // LIT {2i 3}         -> cell [1 2] {double complex [1 1] [0,2i] ; double [1 1] [3]}
  { literal: '{2i 3}', dims: [1, 2], members: [{ re: 0, im: 2 }, 3] },
  // LIT {1 +2i}        -> cell [1 2] {double [1 1] [1] ; double complex [1 1] [0,2i]}
  { literal: '{1 +2i}', dims: [1, 2], members: [1, { re: 0, im: 2 }] },
  // LIT {1+2i; 3}      -> cell [2 1] {double complex [1 1] [1,2i] ; double [1 1] [3]}
  { literal: '{1+2i; 3}', dims: [2, 1], members: [{ re: 1, im: 2 }, 3] },
  // LIT {Inf+1i}       -> cell [1 1] {double complex [1 1] [Inf,1i]}
  { literal: '{Inf+1i}', dims: [1, 1], members: [{ re: Infinity, im: 1 }] },
  // LIT {NaN+1i}       -> cell [1 1] {double complex [1 1] [NaN,1i]}
  { literal: '{NaN+1i}', dims: [1, 1], members: [{ re: NaN, im: 1 }] },
];

/**
 * The spellings this package shows a complex part in that MATLAB does not read (an
 * infinite part as `Infi`, and as `Infinityi`, which a MAT stream's element showed through
 * 1.40.0): read as the value shown, so that the text a value shows can be typed back
 * (parseComplex). In a cell each was held as a char.
 */
const SHOWN_SPELLINGS: { literal: string; dims: number[]; members: Member[] }[] = [
  { literal: '{1+Infi}', dims: [1, 1], members: [{ re: 1, im: Infinity }] },
  { literal: '{1+Infinityi}', dims: [1, 1], members: [{ re: 1, im: Infinity }] },
  { literal: '{1, 1NaNi}', dims: [1, 2], members: [1, { re: 1, im: NaN }] },
];

/** A part compared sign-blind on zero (see `{-i}`), NaN equal to NaN. */
const part = (n: unknown): unknown => (typeof n === 'number' ? n + 0 : n);

/** One member as the parser holds it, in the form of a MATLAB_MAKES member, or the raw value when it is neither. */
function memberOf(raw: any): unknown {
  if (typeof raw === 'number') {
    return raw;
  }
  // A complex member is the complex-text bag a binary dictionary's reader gives one.
  if (raw && typeof raw === 'object' && raw._type === 'cdata' && typeof raw._value === 'string') {
    const parts = parseComplexNum(raw._value);
    return parts ? { re: part(parts.re), im: part(parts.im) } : raw;
  }
  return raw;
}

const expected = (m: Member): unknown => (typeof m === 'number' ? m : { re: part(m.re), im: part(m.im) });

/** A member as the table shows its row: the Class column and the Value. */
const shownAs = (m: Member): [string, string] =>
  typeof m === 'number'
    ? ['double', String(m)]
    : ['double (complex)', formatComplexNum(part(m.re), m.im)];

describe('a complex member of a cell literal is what MATLAB makes of it', () => {
  it.each([...MATLAB_MAKES, ...SHOWN_SPELLINGS])('$literal parses to the members MATLAB holds', ({ literal, dims, members }) => {
    const parsed = MatlabValueParser.parse(literal);
    expect(parsed, literal).not.toBeNull();
    expect(parsed!.type).toBe('cell');
    expect(parsed!.dims).toEqual(dims);
    expect((parsed!.value as unknown[]).map(memberOf)).toEqual(members.map(expected));
  });

  it('holds a complex member as the complex-text bag the binary reader gives one, never as a char', () => {
    expect((MatlabValueParser.parse('{1+2i}')!.value as unknown[])[0]).toEqual({ _type: 'cdata', _value: '1+2i' });
    expect((MatlabValueParser.parse('{3 + 4i}')!.value as unknown[])[0]).toEqual({ _type: 'cdata', _value: '3+4i' });
  });

  it('refuses a joined span it cannot read, and keeps reading what it always read', () => {
    // MATLAB: `{1 + 2}` is {3}, `{'a' + 1}` is {98}, `{a + b}` adds two variables. Held as
    // text, each was a cell of chars and operators MATLAB never makes.
    for (const literal of ['{1 + 2}', '{1 - 2}', '{3+ 4}', '{a + b}', "{'a' + 1}", '{[1 2] + 3}', '{1 + 2i + 3}']) {
      expect(MatlabValueParser.parse(literal), literal).toBeNull();
    }
    // Controls, each read as before: names separated by a comma or a space, a unary minus
    // after a space (MATLAB: `{1 -2}` is {1, -2}), an exponent's sign, and a string sum.
    expect(MatlabValueParser.parse('{a, b}')).toEqual({ type: 'cell', value: ['a', 'b'], dims: [1, 2] });
    expect(MatlabValueParser.parse('{a b}')).toEqual({ type: 'cell', value: ['a', 'b'], dims: [1, 2] });
    expect(MatlabValueParser.parse('{1 -2}')).toEqual({ type: 'cell', value: [1, -2], dims: [1, 2] });
    expect(MatlabValueParser.parse('{1e+5 -1e-5}')).toEqual({ type: 'cell', value: [100000, -0.00001], dims: [1, 2] });
    expect(MatlabValueParser.parse('{"a" + "b", 2}')).toEqual({ type: 'cell', value: [['ab'], 2], dims: [1, 2] });
  });
});

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const entryOf = (root: any, name: string): any => root.getSection('design').children.find((e: any) => e.name === name);

const FORMATS = [
  { format: 'text', file: 'cellarr_text.sldd' },
  { format: 'binary', file: 'cellarr_binary.sldd' },
] as const;

/** The dictionary MATLAB wrote with `cCplx = {1 + 2i}` (probe_cell_arrays.m), opened, with cCplx selected. */
function openCCplx(file: string): { session: any; root: any; entry: any } {
  const session = createSession();
  const root = ingest(session, buffer(fixture(file)), { filename: file }) as any;
  const entry = entryOf(root, 'cCplx');
  session.setActive(root, entry);
  return { session, root, entry };
}

/** Save, and reopen what was saved. */
function saveAndReopen(session: any, root: any, file: string): { saved: any; reopened: any } {
  const saved = session.serializeSource(root.name);
  const bytes = saved.kind === 'text' ? strToU8(saved.text) : saved.bytes;
  const reopened = ingest(createSession(), buffer(bytes), { filename: file }) as any;
  return { saved, reopened };
}

/** The saved text dictionary's JSON value for an entry. */
const textValue = (saved: any, name: string): any =>
  JSON.parse(saved.text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === name).value;

/** The saved (or read) binary dictionary's `<P Name="Value">` for an entry. */
function binaryValue(bytes: Uint8Array, name: string): string {
  const xml = strFromU8(unzipSync(bytes)['data/chunk0.xml']);
  const object = xml.split('<Object Class="DD.ENTRY">').find((o) => o.includes(`<P Name="Name" Class="char">${name}</P>`))!;
  return object.match(/<P Name="Value"[\s\S]*?<\/P>/)![0];
}

/** Each member's row as the table shows it. */
const rows = (entry: any): [string, string][] => entry.children.map((c: any) => [c.toRow().Class, String(c.displayValue)]);

for (const { format, file } of FORMATS) {
  describe(`a complex member typed into a cell, ${format} dictionary`, () => {
    it.each(MATLAB_MAKES)('$literal, typed as the Value, holds MATLAB\'s members', ({ literal, dims, members }) => {
      const { session, entry } = openCCplx(file);
      expect(session.editProperty(entry.id, 'Value', literal), literal).toBe(true);
      expect(entry.children).toHaveLength(dims[0] * dims[1]);
      expect(rows(entry)).toEqual(members.map(shownAs));
    });

    it('saves {1, 3 + 4i} as MATLAB writes a complex member, and reopens it complex', () => {
      const { session, root, entry } = openCCplx(file);
      expect(session.editProperty(entry.id, 'Value', '{1, 3 + 4i}')).toBe(true);
      expect(entry.displayValue).toBe('{1, 3+4i}');
      expect(rows(entry)).toEqual([['double', '1'], ['double (complex)', '3+4i']]);

      const { saved, reopened } = saveAndReopen(session, root, file);
      if (format === 'text') {
        // A MAT stream, as MATLAB writes one even inside a cell; the char `"3+4i"` was the defect.
        const element = textValue(saved, 'cCplx')._elements[1];
        expect(element._type).toBe('cdata');
        expect(element._value).not.toBe('3+4i');
      } else {
        const value = binaryValue(saved.bytes, 'cCplx');
        expect(value).toContain('<Element Class="double" IsComplex="1">3.0+4.0i</Element>');
        expect(value).not.toContain('Class="char"');
      }
      const again = entryOf(reopened, 'cCplx');
      expect(again.displayValue).toBe('{1, 3+4i}');
      expect(rows(again)).toEqual([['double', '1'], ['double (complex)', '3+4i']]);
    });

    it('writes {1 + 2i}, MATLAB\'s own spelling of cCplx, as the bytes MATLAB wrote for it', () => {
      const { session, root, entry } = openCCplx(file);
      expect(entry.displayValue).toBe('{1+2i}');
      expect(session.editProperty(entry.id, 'Value', '{1 + 2i}')).toBe(true);
      const { saved } = saveAndReopen(session, root, file);
      if (format === 'text') {
        const matlab = JSON.parse(strFromU8(fixture(file))).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find(
          (e: any) => e.name === 'cCplx',
        ).value;
        expect(textValue(saved, 'cCplx')._elements).toEqual(matlab._elements);
      } else {
        const element = (bytes: Uint8Array): string => binaryValue(bytes, 'cCplx').match(/<Element[\s\S]*?<\/Element>/)![0];
        expect(element(saved.bytes)).toBe(element(fixture(file)));
        expect(element(saved.bytes)).toBe('<Element Class="double" IsComplex="1">1.0+2.0i</Element>');
      }
    });

    it("refuses {1 + 2}, {a + b} and {a, b}, leaving the value as it was, and still takes {'a', 'b'} and {1 -2}", () => {
      for (const literal of ['{1 + 2}', '{a + b}']) {
        const { session, entry } = openCCplx(file);
        const result = session.editProperty(entry.id, 'Value', literal);
        expect(result, literal).toMatchObject({ error: true, reason: 'Cannot edit "cCplx": Invalid MATLAB expression.' });
        expect(entry.displayValue).toBe('{1+2i}');
        expect(rows(entry)).toEqual([['double (complex)', '1+2i']]);
      }
      // A bare word typed into a cell is a name or a call, which this editor does not evaluate: it
      // was taken as a char ({a, b} as {'a', 'b'}, {missing} as {'missing'}); it is refused, named
      // (MatlabValueParser.parseTyped). Quoted, the chars are taken as before.
      const bare = openCCplx(file);
      expect(bare.session.editProperty(bare.entry.id, 'Value', '{a, b}')).toMatchObject({
        error: true,
        reason: 'Cannot edit "cCplx": a is a name or a call, which this editor does not evaluate: a char is typed in quotes, a string in double quotes.',
      });
      expect(rows(bare.entry)).toEqual([['double (complex)', '1+2i']]);
      const names = openCCplx(file);
      expect(names.session.editProperty(names.entry.id, 'Value', "{'a', 'b'}")).toBe(true);
      expect(rows(names.entry)).toEqual([['char', "'a'"], ['char', "'b'"]]);
      const numbers = openCCplx(file);
      expect(numbers.session.editProperty(numbers.entry.id, 'Value', '{1 -2}')).toBe(true);
      expect(rows(numbers.entry)).toEqual([['double', '1'], ['double', '-2']]);
    });
  });
}

describe('a complex member with an infinite part, typed as this package shows it', () => {
  // MATLAB's {complex(1, Inf)} (the complex_inf fixtures) shows `{1+Infi}`. That is not
  // MATLAB syntax, but it is read, so that the text a value shows can be typed back
  // (parseComplex); in a cell it was held as the char '1+Infi'.
  for (const { format, file } of [
    { format: 'text', file: 'complex_inf/complex_inf_text.sldd' },
    { format: 'binary', file: 'complex_inf/complex_inf_binary.sldd' },
  ]) {
    it(`is written as the bytes MATLAB wrote for complex(1, Inf), ${format} dictionary`, () => {
      const session = createSession();
      const root = ingest(session, buffer(fixture(file)), { filename: file.split('/')[1] }) as any;
      const entry = entryOf(root, 'zInfCell');
      session.setActive(root, entry);
      expect(entry.displayValue).toBe('{1+Infi}');
      expect(session.editProperty(entry.id, 'Value', '{1 + Infi}')).toBe(true);
      expect(rows(entry)).toEqual([['double (complex)', '1+Infi']]);
      const saved = session.serializeSource(root.name);
      if (format === 'text') {
        const matlab = JSON.parse(strFromU8(fixture(file))).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find(
          (e: any) => e.name === 'zInfCell',
        ).value;
        expect(textValue(saved, 'zInfCell')._elements).toEqual(matlab._elements);
      } else {
        const element = (bytes: Uint8Array): string => binaryValue(bytes, 'zInfCell').match(/<Element[\s\S]*?<\/Element>/)![0];
        expect(element(saved.bytes)).toBe(element(fixture(file)));
        expect(element(saved.bytes)).toBe('<Element Class="double" IsComplex="1">1.0+Infi</Element>');
      }
    });
  }
});
