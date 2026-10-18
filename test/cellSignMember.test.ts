// Copyright 2026 The MathWorks, Inc.
//
// A cell literal's member that opens with a sign, or with its imaginary part, typed in.
// MATLAB reads `{- 2}` as {-2}, `{1, - 2}` as {1, -2} and `{i + 1}` as {1+1i}. Since the
// complex-member change (#139) this parser refused all three, and `{i+1}` with no spaces was
// held as the char 'i+1', a value MATLAB never makes. Followed under the maintainer's ruling
// of 2026-10-18 (group G, follow-up 6): accept the sign and the `i + 1` forms as MATLAB
// does, and keep refusing arithmetic.
//
// MATLAB's rule inside braces: a `+` or `-` with whitespace after it is unary when no term
// stands before it, at the start of the row or after a comma (`{- 2}`, `{1, - 2}`), and binary
// after a term (`{[1] - 2}` is {-1}, `{'a' - 2}` is {95}). An imaginary term then a real one
// (`i + 1`, `2i - 3`) is one complex value, as the real-first `1 + 1i` is. This parser does
// no arithmetic, so a member it would have to compute stays refused.
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
 * Each literal and what MATLAB R2027a (27.1.0.3409468) makes of it: `eval` of the literal,
 * then class, complexity, size and parts. The measured row is quoted above each entry
 * (parity/matlab/probe_cell_sign_literals.m, which opens no file). MATLAB_COMPUTES's
 * `matlab` column is that probe's output too.
 */
const MATLAB_MAKES: { literal: string; dims: number[]; members: Member[] }[] = [
  // LIT {- 2}            -> cell [1 1] {double [1 1] [-2]}
  { literal: '{- 2}', dims: [1, 1], members: [-2] },
  // LIT {+ 2}            -> cell [1 1] {double [1 1] [2]}
  { literal: '{+ 2}', dims: [1, 1], members: [2] },
  // LIT {-  2}           -> cell [1 1] {double [1 1] [-2]}
  { literal: '{-  2}', dims: [1, 1], members: [-2] },
  // LIT {1, - 2}         -> cell [1 2] {double [1 1] [1] ; double [1 1] [-2]}
  { literal: '{1, - 2}', dims: [1, 2], members: [1, -2] },
  // LIT {1 , - 2}        -> cell [1 2] {double [1 1] [1] ; double [1 1] [-2]}
  { literal: '{1 , - 2}', dims: [1, 2], members: [1, -2] },
  // LIT {1 ,- 2}         -> cell [1 2] {double [1 1] [1] ; double [1 1] [-2]}
  { literal: '{1 ,- 2}', dims: [1, 2], members: [1, -2] },
  // LIT {1; - 2}         -> cell [2 1] {double [1 1] [1] ; double [1 1] [-2]}
  { literal: '{1; - 2}', dims: [2, 1], members: [1, -2] },
  // LIT {- 2 3}          -> cell [1 2] {double [1 1] [-2] ; double [1 1] [3]}
  { literal: '{- 2 3}', dims: [1, 2], members: [-2, 3] },
  // LIT {- 2, 3}         -> cell [1 2] {double [1 1] [-2] ; double [1 1] [3]}
  { literal: '{- 2, 3}', dims: [1, 2], members: [-2, 3] },
  // LIT {- 2 3i}         -> cell [1 2] {double [1 1] [-2] ; double complex [1 1] [0,3i]}
  { literal: '{- 2 3i}', dims: [1, 2], members: [-2, { re: 0, im: 3 }] },
  // LIT {- 2 + 3i}       -> cell [1 1] {double complex [1 1] [-2,3i]}
  { literal: '{- 2 + 3i}', dims: [1, 1], members: [{ re: -2, im: 3 }] },
  // LIT {- i}            -> cell [1 1] {double complex [1 1] [-0,-1i]}
  { literal: '{- i}', dims: [1, 1], members: [{ re: -0, im: -1 }] },
  // LIT {+ i}            -> cell [1 1] {double complex [1 1] [0,1i]}
  { literal: '{+ i}', dims: [1, 1], members: [{ re: 0, im: 1 }] },
  // LIT {- 2i}           -> cell [1 1] {double complex [1 1] [-0,-2i]}
  { literal: '{- 2i}', dims: [1, 1], members: [{ re: -0, im: -2 }] },
  // LIT {1, - 2i}        -> cell [1 2] {double [1 1] [1] ; double complex [1 1] [-0,-2i]}
  { literal: '{1, - 2i}', dims: [1, 2], members: [1, { re: -0, im: -2 }] },
  // LIT {- Inf}          -> cell [1 1] {double [1 1] [-Inf]}
  { literal: '{- Inf}', dims: [1, 1], members: [-Infinity] },
  // LIT {- NaN}          -> cell [1 1] {double [1 1] [NaN]}
  { literal: '{- NaN}', dims: [1, 1], members: [NaN] },
  // LIT {- 0}            -> cell [1 1] {double [1 1] [-0]}
  { literal: '{- 0}', dims: [1, 1], members: [-0] },
  // LIT {i + 1}          -> cell [1 1] {double complex [1 1] [1,1i]}
  { literal: '{i + 1}', dims: [1, 1], members: [{ re: 1, im: 1 }] },
  // LIT {2i - 3}         -> cell [1 1] {double complex [1 1] [-3,2i]}
  { literal: '{2i - 3}', dims: [1, 1], members: [{ re: -3, im: 2 }] },
  // LIT {i+1}            -> cell [1 1] {double complex [1 1] [1,1i]}
  { literal: '{i+1}', dims: [1, 1], members: [{ re: 1, im: 1 }] },
  // LIT {2i-3}           -> cell [1 1] {double complex [1 1] [-3,2i]}
  { literal: '{2i-3}', dims: [1, 1], members: [{ re: -3, im: 2 }] },
  // LIT {- 3; i + 1}     -> cell [2 1] {double [1 1] [-3] ; double complex [1 1] [1,1i]}
  { literal: '{- 3; i + 1}', dims: [2, 1], members: [-3, { re: 1, im: 1 }] },
  // LIT {i + 1, 2i - 3}  -> cell [1 2] {double complex [1 1] [1,1i] ; double complex [1 1] [-3,2i]}
  { literal: '{i + 1, 2i - 3}', dims: [1, 2], members: [{ re: 1, im: 1 }, { re: -3, im: 2 }] },
  // LIT {2i - 3, 4}      -> cell [1 2] {double complex [1 1] [-3,2i] ; double [1 1] [4]}
  { literal: '{2i - 3, 4}', dims: [1, 2], members: [{ re: -3, im: 2 }, 4] },
  // LIT {-2i + 3}        -> cell [1 1] {double complex [1 1] [3,-2i]}
  { literal: '{-2i + 3}', dims: [1, 1], members: [{ re: 3, im: -2 }] },
  // LIT {- 3i + 2}       -> cell [1 1] {double complex [1 1] [2,-3i]}
  { literal: '{- 3i + 2}', dims: [1, 1], members: [{ re: 2, im: -3 }] },
  // LIT {-i + 1}         -> cell [1 1] {double complex [1 1] [1,-1i]}
  { literal: '{-i + 1}', dims: [1, 1], members: [{ re: 1, im: -1 }] },
  // LIT {i + Inf}        -> cell [1 1] {double complex [1 1] [Inf,1i]}
  { literal: '{i + Inf}', dims: [1, 1], members: [{ re: Infinity, im: 1 }] },
  // LIT {i - Inf}        -> cell [1 1] {double complex [1 1] [-Inf,1i]}
  { literal: '{i - Inf}', dims: [1, 1], members: [{ re: -Infinity, im: 1 }] },
  // LIT {i + NaN}        -> cell [1 1] {double complex [1 1] [NaN,1i]}
  { literal: '{i + NaN}', dims: [1, 1], members: [{ re: NaN, im: 1 }] },
  // LIT {2j - 3}         -> cell [1 1] {double complex [1 1] [-3,2i]}
  { literal: '{2j - 3}', dims: [1, 1], members: [{ re: -3, im: 2 }] },
  // LIT {1j + 1}         -> cell [1 1] {double complex [1 1] [1,1i]}
  { literal: '{1j + 1}', dims: [1, 1], members: [{ re: 1, im: 1 }] },
  // LIT {2i - 1e3}       -> cell [1 1] {double complex [1 1] [-1000,2i]}
  { literal: '{2i - 1e3}', dims: [1, 1], members: [{ re: -1000, im: 2 }] },
  // LIT {2.5i + .5}      -> cell [1 1] {double complex [1 1] [0.5,2.5i]}
  { literal: '{2.5i + .5}', dims: [1, 1], members: [{ re: 0.5, im: 2.5 }] },
  // LIT {i - 0}          -> cell [1 1] {double complex [1 1] [0,1i]}
  { literal: '{i - 0}', dims: [1, 1], members: [{ re: 0, im: 1 }] },
  // LIT {-i - 0}         -> cell [1 1] {double complex [1 1] [-0,-1i]}
  { literal: '{-i - 0}', dims: [1, 1], members: [{ re: -0, im: -1 }] },
];

/**
 * What MATLAB computes and this parser cannot: the terms are added, a sign is applied to a
 * signed term, an array or a char, or a name is looked up. Each is refused, before this
 * change and after it. The rows after a bracketed or quoted term are the controls on "no term
 * before it": there the sign is binary, and taking it as a sign would make `{[1], -2}`.
 */
const MATLAB_COMPUTES: { literal: string; matlab: string }[] = [
  { literal: '{- 2 - 3}', matlab: 'cell [1 1] {double [1 1] [-5]}' },
  { literal: '{- 2 + 3}', matlab: 'cell [1 1] {double [1 1] [1]}' },
  { literal: '{1, - 2 - 3}', matlab: 'cell [1 2] {double [1 1] [1] ; double [1 1] [-5]}' },
  { literal: '{- -2}', matlab: 'cell [1 1] {double [1 1] [2]}' },
  { literal: '{- a}', matlab: "ERROR Unrecognized function or variable 'a'." },
  { literal: '{[1] - 2}', matlab: 'cell [1 1] {double [1 1] [-1]}' },
  { literal: "{'a' - 2}", matlab: 'cell [1 1] {double [1 1] [95]}' },
  { literal: '{"a" - 2}', matlab: 'ERROR Invalid data type. Argument must be numeric, char, or logical.' },
  { literal: '{[1 2] + 3}', matlab: 'cell [1 1] {double [1 2] [4 5]}' },
  { literal: '{- [1 2]}', matlab: 'cell [1 1] {double [1 2] [-1 -2]}' },
  { literal: "{- 'a'}", matlab: 'cell [1 1] {double [1 1] [-97]}' },
  { literal: '{1 - 2}', matlab: 'cell [1 1] {double [1 1] [-1]}' },
  { literal: '{a + b}', matlab: "ERROR Unrecognized function or variable 'a'." },
  { literal: '{1 + 2i + 3}', matlab: 'cell [1 1] {double complex [1 1] [4,2i]}' },
  { literal: '{i + 1i}', matlab: 'cell [1 1] {double complex [1 1] [0,2i]}' },
  { literal: '{i + 1 + 2}', matlab: 'cell [1 1] {double complex [1 1] [3,1i]}' },
  { literal: '{i + -1}', matlab: 'cell [1 1] {double complex [1 1] [-1,1i]}' },
  { literal: '{1 + -2i}', matlab: 'cell [1 1] {double complex [1 1] [1,-2i]}' },
  { literal: '{Infi + 1}', matlab: "ERROR Unrecognized function or variable 'Infi'." },
];

/** Read as before: a sign with whitespace before it and none after starts a member. */
const READ_AS_BEFORE: { literal: string; dims: number[]; members: Member[] }[] = [
  // LIT {-2}             -> cell [1 1] {double [1 1] [-2]}
  { literal: '{-2}', dims: [1, 1], members: [-2] },
  // LIT {i +1}           -> cell [1 2] {double complex [1 1] [0,1i] ; double [1 1] [1]}
  { literal: '{i +1}', dims: [1, 2], members: [{ re: 0, im: 1 }, 1] },
  // LIT {2i -3}          -> cell [1 2] {double complex [1 1] [0,2i] ; double [1 1] [-3]}
  { literal: '{2i -3}', dims: [1, 2], members: [{ re: 0, im: 2 }, -3] },
];

/**
 * A complex part compared sign-blind on zero: this package spells a part of -0 as 0
 * (formatComplexNum), as it does for `{-i}`, whose real part MATLAB also holds as -0.
 * A double member is compared exactly, -0 included.
 */
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

/**
 * A member as the table shows its row: the Class column and the Value. A double of -0
 * shows as `0`, as `{-0}` always has (the display is this package's, not MATLAB's).
 */
const shownAs = (m: Member): [string, string] =>
  typeof m === 'number'
    ? ['double', m === Infinity ? 'Inf' : m === -Infinity ? '-Inf' : String(m)]
    : ['double (complex)', formatComplexNum(part(m.re), m.im)];

describe('a cell member that opens with a sign or its imaginary part is what MATLAB makes of it', () => {
  it.each(MATLAB_MAKES)('$literal parses to the members MATLAB holds', ({ literal, dims, members }) => {
    const parsed = MatlabValueParser.parse(literal);
    expect(parsed, literal).not.toBeNull();
    expect(parsed!.type).toBe('cell');
    expect(parsed!.dims).toEqual(dims);
    expect((parsed!.value as unknown[]).map(memberOf)).toEqual(members.map(expected));
  });

  it('holds an imaginary-first member as the complex-text bag every complex member takes', () => {
    expect((MatlabValueParser.parse('{i + 1}')!.value as unknown[])[0]).toEqual({ _type: 'cdata', _value: '1+1i' });
    expect((MatlabValueParser.parse('{2i-3}')!.value as unknown[])[0]).toEqual({ _type: 'cdata', _value: '-3+2i' });
  });

  it.each(MATLAB_COMPUTES)('$literal is refused, since MATLAB computes it ($matlab)', ({ literal }) => {
    expect(MatlabValueParser.parse(literal), literal).toBeNull();
  });

  it.each(READ_AS_BEFORE)('$literal is read as before', ({ literal, dims, members }) => {
    const parsed = MatlabValueParser.parse(literal);
    expect(parsed, literal).not.toBeNull();
    expect(parsed!.dims).toEqual(dims);
    expect((parsed!.value as unknown[]).map(memberOf)).toEqual(members.map(expected));
  });

  it('leaves the top level and arrays as they were: refused, not read', () => {
    // The ruling is about cell literals. These are refused before and after, so nothing is
    // written wrong; reading them is a separate call.
    for (const literal of ['- 2', 'i + 1', '2i - 3', '[- 2]', '[1, - 2]', '[i + 1]']) {
      expect(MatlabValueParser.parse(literal), literal).toBeNull();
    }
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
  describe(`a cell member that opens with a sign or its imaginary part, typed in, ${format} dictionary`, () => {
    it.each(MATLAB_MAKES)('$literal, typed as the Value, holds MATLAB\'s members', ({ literal, dims, members }) => {
      const { session, entry } = openCCplx(file);
      expect(session.editProperty(entry.id, 'Value', literal), literal).toBe(true);
      expect(entry.children).toHaveLength(dims[0] * dims[1]);
      expect(rows(entry)).toEqual(members.map(shownAs));
    });

    // MATLAB R2027a read back the dictionaries this package saved after these two edits, in
    // both formats (a one-off read-back of those two saved files, which opened nothing else):
    //   READ g6_text.sldd   cCplx  -> cell [1 4] {double [1 1] [1] ; double [1 1] [-2] ; double complex [1 1] [1,1i] ; double complex [1 1] [-3,2i]}
    //   READ g6_binary.sldd cCplx  -> (the same)
    //   READ g6_text.sldd   cStr   -> cell [2 2] {double complex [1 1] [-2,3i] ; double complex [1 1] [Inf,1i] ; double complex [1 1] [3,-2i] ; double [1 1] [0]}
    //   READ g6_binary.sldd cStr   -> cell [2 2] {double complex [1 1] [-2,3i] ; double complex [1 1] [Inf,1i] ; double complex [1 1] [3,-2i] ; double [1 1] [-0]}
    // The text form's 0 for `- 0` is that format's own: MATLAB writes {-0} there as `0` too.
    it('saves {1, - 2, i + 1, 2i - 3} as MATLAB writes each member, and reopens it the same', () => {
      const { session, root, entry } = openCCplx(file);
      expect(session.editProperty(entry.id, 'Value', '{1, - 2, i + 1, 2i - 3}')).toBe(true);
      const shown = [['double', '1'], ['double', '-2'], ['double (complex)', '1+1i'], ['double (complex)', '-3+2i']];
      expect(rows(entry)).toEqual(shown);

      const { saved, reopened } = saveAndReopen(session, root, file);
      if (format === 'text') {
        // The reals bare, as MATLAB writes them; a complex member as a MAT stream, never its text.
        const elements = textValue(saved, 'cCplx')._elements;
        expect(elements.slice(0, 2)).toEqual([1, -2]);
        for (const element of elements.slice(2)) {
          expect(element._type).toBe('cdata');
          expect(element._value).not.toMatch(/^[-+\d.]+[+-][\d.]+i$/);
        }
      } else {
        const value = binaryValue(saved.bytes, 'cCplx');
        expect(value.match(/<Element[\s\S]*?<\/Element>/g)).toEqual([
          '<Element Class="double">1.0</Element>',
          '<Element Class="double">-2.0</Element>',
          '<Element Class="double" IsComplex="1">1.0+1.0i</Element>',
          '<Element Class="double" IsComplex="1">-3.0+2.0i</Element>',
        ]);
      }
      expect(rows(entryOf(reopened, 'cCplx'))).toEqual(shown);
    });

    it('saves the 2x2 {- 2 + 3i, -2i + 3; i + Inf, - 0} column-major, as MATLAB read it back', () => {
      const session = createSession();
      const root = ingest(session, buffer(fixture(file)), { filename: file }) as any;
      const entry = entryOf(root, 'cStr');
      session.setActive(root, entry);
      expect(session.editProperty(entry.id, 'Value', '{- 2 + 3i, -2i + 3; i + Inf, - 0}')).toBe(true);
      // MATLAB's read-back, column-major: -2+3i, Inf+1i, 3-2i, -0.
      const matlab: Member[] = [{ re: -2, im: 3 }, { re: Infinity, im: 1 }, { re: 3, im: -2 }, -0];
      expect(rows(entry)).toEqual(matlab.map(shownAs));

      const { saved, reopened } = saveAndReopen(session, root, file);
      if (format === 'text') {
        const value = textValue(saved, 'cStr');
        expect(value._dimensions).toEqual([2, 2]);
        expect(value._elements.map((e: any) => (typeof e === 'object' ? e._type : e))).toEqual(['cdata', 'cdata', 'cdata', 0]);
      } else {
        expect(binaryValue(saved.bytes, 'cStr').match(/<Element[\s\S]*?<\/Element>/g)).toEqual([
          '<Element Class="double" IsComplex="1">-2.0+3.0i</Element>',
          '<Element Class="double" IsComplex="1">Inf+1.0i</Element>',
          '<Element Class="double" IsComplex="1">3.0-2.0i</Element>',
          '<Element Class="double">-0.0</Element>',
        ]);
      }
      expect(rows(entryOf(reopened, 'cStr'))).toEqual(matlab.map(shownAs));
    });

    it('writes {2i + 1}, cCplx\'s own value typed imaginary first, as the bytes MATLAB wrote for it', () => {
      const { session, root, entry } = openCCplx(file);
      expect(session.editProperty(entry.id, 'Value', '{2i + 1}')).toBe(true);
      const { saved } = saveAndReopen(session, root, file);
      if (format === 'text') {
        const matlab = JSON.parse(strFromU8(fixture(file))).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find(
          (e: any) => e.name === 'cCplx',
        ).value;
        expect(textValue(saved, 'cCplx')._elements).toEqual(matlab._elements);
      } else {
        const element = (bytes: Uint8Array): string => binaryValue(bytes, 'cCplx').match(/<Element[\s\S]*?<\/Element>/)![0];
        expect(element(saved.bytes)).toBe(element(fixture(file)));
      }
    });

    it('refuses a sign after a term and a member it would have to compute, leaving the value as it was', () => {
      for (const literal of ['{[1] - 2}', "{'a' - 2}", '{- 2 - 3}', '{i + 1i}', '{- -2}']) {
        const { session, entry } = openCCplx(file);
        const result = session.editProperty(entry.id, 'Value', literal);
        expect(result, literal).toMatchObject({ error: true, reason: 'Invalid MATLAB expression' });
        expect(entry.displayValue).toBe('{1+2i}');
        expect(rows(entry)).toEqual([['double (complex)', '1+2i']]);
      }
    });
  });
}
