// Copyright 2026 The MathWorks, Inc.
//
// A number typed into a value of an integer class is stored and written as MATLAB converts
// it to that class: rounded to the nearest integer, a tie away from zero, and saturated at
// the class's range, with NaN as 0. int16(70000) is 32767, int16(-70000) is -32768,
// int8(2.5) is 3, int8(-2.5) is -3, uint8(-1) is 0 and int16(NaN) is 0. A complex value's
// parts are converted the same way, each on its own.
//
// Each writer converted its own way, and none of them MATLAB's. A MAT stream
// (MatWriter.numericPayload) went through DataView, which wraps modulo the class's width
// and truncates: on an int16 array, 70000 was written as 4464 and 3.7 as 3, and a complex
// element typed as 70000+1i was saved as 4464+1i. A binary dictionary's XML
// (XmlUtils.formatNumericXml) used Math.round, which rounds a tie up, not away from zero,
// and saturates nothing: -2.5 went out as -2 and 70000 as 70000. A text dictionary's literal
// went out as typed: an int16 entry set to 3.7 was saved as `"_value": "3.7"`. And the node
// held what was typed, so the edited element showed 70000 where MATLAB holds 32767.
//
// Every class, in each place a typed number is stored into one: an entry, an element of an
// array, a cell's member, a struct's field and a part of a complex element, in a text and
// a binary dictionary.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { parseMatrix, type MatVariable } from '../src/datamodel/parser/MatParser.js';
import { encodeCdata, encodeMatVariable } from '../src/datamodel/parser/MatWriter.js';
import { toIntegerClass } from '../src/datamodel/parser/XmlUtils.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

const CLASSES: { cls: string; lo: bigint; hi: bigint }[] = [
  { cls: 'int8', lo: -128n, hi: 127n },
  { cls: 'uint8', lo: 0n, hi: 255n },
  { cls: 'int16', lo: -32768n, hi: 32767n },
  { cls: 'uint16', lo: 0n, hi: 65535n },
  { cls: 'int32', lo: -2147483648n, hi: 2147483647n },
  { cls: 'uint32', lo: 0n, hi: 4294967295n },
  { cls: 'int64', lo: -9223372036854775808n, hi: 9223372036854775807n },
  { cls: 'uint64', lo: 0n, hi: 18446744073709551615n },
];

/**
 * What is typed, for a class: one past each end of its range, ties and other fractions of
 * either sign, NaN and the infinities, a double past every class, a double past 2^53 that
 * is a whole number, the range's own ends and a number inside it.
 */
const typedFor = ({ lo, hi }: { lo: bigint; hi: bigint }): string[] => [
  String(hi + 1n),
  String(lo - 1n),
  '2.5',
  '-2.5',
  '3.7',
  '-3.7',
  '0.4',
  '-0.4',
  'NaN',
  'Inf',
  '-Inf',
  '1e30',
  '-1e30',
  // 2^60, which String spells 1152921504606847000: a 64-bit class holds it exactly.
  '1.152921504606847e18',
  String(hi),
  String(lo),
  '42',
];

/**
 * MATLAB's conversion of the number `typed` spells to a class of range [lo, hi], as the
 * digits of the result. A decimal is rounded as written, which is the double's rounding
 * for every decimal above; an exponent is a whole double, which BigInt holds exactly.
 */
function matlabInt(typed: string, lo: bigint, hi: bigint): string {
  let v: bigint;
  if (typed === 'NaN') {
    v = 0n;
  } else if (typed === 'Inf') {
    v = hi;
  } else if (typed === '-Inf') {
    v = lo;
  } else if (/e/.test(typed)) {
    v = BigInt(Number(typed));
  } else {
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(typed)!;
    const magnitude = BigInt(m[2]) + (m[3] !== undefined && m[3][0] >= '5' ? 1n : 0n);
    v = m[1] === '-' ? -magnitude : magnitude;
  }
  return String(v < lo ? lo : v > hi ? hi : v);
}

/** A complex element as this package shows one: `3+4i`, `3-4i`, `0+0i`. */
const complexText = (re: string, im: string): string => re + (im.startsWith('-') ? '' : '+') + im + 'i';

// Where a value of the class sits, and how each dictionary spells it there.
const POSITIONS = ['Scalar', 'Row', 'Cell', 'Struct', 'Complex'] as const;
type Position = (typeof POSITIONS)[number];

/** MATLAB's text-dictionary literal of one number of `cls`: a 'U' on an unsigned one. */
const lit = (cls: string, n: string): string => (cls.startsWith('u') ? n + 'U' : n);

function textValue(cls: string, at: Position): unknown {
  switch (at) {
    case 'Scalar':
      return { _type: cls, _value: lit(cls, '7') };
    case 'Row':
      return { _type: cls, _value: '[' + ['1', '2', '3'].map((n) => lit(cls, n)).join(', ') + ']' };
    case 'Cell':
      return { _array_type: 'Cell', _dimensions: [1, 1], _elements: [{ _type: cls, _value: lit(cls, '7') }], _mw_element_type: 'MATLABArray' };
    case 'Struct':
      return {
        _array_type: 'Struct',
        _dimensions: [1, 1],
        _elements: [{ f: { _type: cls, _value: lit(cls, '7') } }],
        _fields: ['f'],
        _mw_element_type: 'MATLABArray',
      };
    case 'Complex':
      // A text dictionary holds a complex value as its MAT stream.
      return {
        _type: 'cdata',
        _value: encodeCdata({
          name: '',
          className: cls,
          dimensions: [1, 2],
          isComplex: true,
          isLogical: false,
          value: [{ re: 1, im: 2 }, { re: 3, im: 4 }],
          fields: null,
        } as MatVariable),
      };
  }
}

function binaryValue(cls: string, at: Position): string {
  switch (at) {
    case 'Scalar':
      return `<P Name="Value" Class="${cls}">7</P>`;
    case 'Row':
      return `<P Name="Value" Class="${cls}" Dimension="1*3">1 2 3</P>`;
    case 'Cell':
      return `<P Name="Value" Class="cell">\n            <Element Class="${cls}">7</Element>\n        </P>`;
    case 'Struct':
      return `<P Name="Value" Class="struct">\n            <Element>\n                <P Name="f" Class="${cls}">7</P>\n            </Element>\n        </P>`;
    case 'Complex':
      return `<P Name="Value" Class="${cls}" IsComplex="1" Dimension="1*2">1+2i 3+4i</P>`;
  }
}

const ENTRIES = CLASSES.flatMap(({ cls }) => POSITIONS.map((at) => ({ cls, at, name: cls + at })));
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;

/** MATLAB's typed_text.sldd with one entry for each class and position. */
function textDictionary(): ArrayBuffer {
  const json = JSON.parse(strFromU8(fixture('typed_text.sldd')));
  const content = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content;
  ENTRIES.forEach(({ cls, at, name }, i) => {
    content.entries.push({
      name,
      metadata: {
        uuid: uuid(i),
        namespace: 'dacaf35e-55a5-454d-a7c1-93db038a210e',
        lastmod: '20260903T181347.929139',
        modifiedby: 'weiwang',
        isderived: '0',
      },
      value: textValue(cls, at),
    });
  });
  return buffer(strToU8(JSON.stringify(json, null, '\t')));
}

/** MATLAB's typed_binary.sldd with the same entries. */
function binaryDictionary(): ArrayBuffer {
  const zip = unzipSync(fixture('typed_binary.sldd'));
  const objects = ENTRIES.map(({ cls, at, name }, i) =>
    [
      '    <Object Class="DD.ENTRY">',
      `        <P Name="Name" Class="char">${name}</P>`,
      `        <P Name="UUID" Class="char">${uuid(i)}</P>`,
      '        <P Name="Namespace" Class="char">dacaf35e-55a5-454d-a7c1-93db038a210e</P>',
      '        <P Name="LastMod" Class="char">20260903T181348.010950</P>',
      '        <P Name="LastModBy" Class="char">weiwang</P>',
      '        <P Name="IsDerived" Class="char">0</P>',
      `        ${binaryValue(cls, at)}`,
      '    </Object>',
    ].join('\n'),
  );
  const xml = strFromU8(zip['data/chunk0.xml']);
  const at = xml.indexOf('    <Object Class="DD.Dictionary">');
  expect(at).toBeGreaterThan(-1);
  zip['data/chunk0.xml'] = strToU8(xml.slice(0, at) + objects.join('\n') + '\n' + xml.slice(at));
  return buffer(zipSync(zip));
}

const FORMATS = [
  { format: 'text', file: 'ints_text.sldd', build: textDictionary },
  { format: 'binary', file: 'ints_binary.sldd', build: binaryDictionary },
];

/** The node of an entry that holds the class's number: the entry, its element, its member, its field. */
function holder(root: any, name: string, at: Position): any {
  const entry = root.getSection('design').children.find((e: any) => e.name === name);
  expect(entry, name).toBeDefined();
  if (at === 'Scalar') {
    return entry;
  }
  if (at === 'Struct') {
    return entry.children.find((c: any) => c.name === 'f');
  }
  return entry.children[0];
}

/** What a save writes, opened again in a session of its own. */
function saveAndReopen(session: any, root: any): any {
  const saved = session.serializeSource(root.name);
  const bytes = saved.kind === 'binary' ? saved.bytes : strToU8(saved.text);
  return ingest(createSession(), buffer(bytes), { filename: root.name });
}

describe('the dictionaries hold a value of every integer class in every position', () => {
  for (const { format, file, build } of FORMATS) {
    it(format, () => {
      const root = ingest(createSession(), build(), { filename: file });
      for (const { cls, at, name } of ENTRIES) {
        const node = holder(root, name, at);
        // Bar a text dictionary's complex value, a MAT stream, which is shown and not edited
        // (the C-012 ruling, 2026-10-15).
        expect(node.valueEditable, name).toBe(!(format === 'text' && at === 'Complex'));
        if (at === 'Complex') {
          expect([node.parent.className, node.parent._elementType, node.displayValue], name).toEqual([cls, 'complex', '1+2i']);
        } else {
          expect([node.className, node.displayValue], name).toEqual([cls, at === 'Row' ? '1' : '7']);
        }
      }
    });
  }
});

describe('a number typed into a value of an integer class is MATLAB\'s conversion of it, shown and saved', () => {
  for (const { format, file, build } of FORMATS) {
    const count = typedFor(CLASSES[0]).length;
    for (let k = 0; k < count; k++) {
      it(`${format}: ${typedFor(CLASSES[0])[k]} (and its twin at each class's range)`, () => {
        const session = createSession();
        const root = ingest(session, build(), { filename: file });
        const want = new Map<string, string>();
        for (const range of CLASSES) {
          const typed = typedFor(range);
          const re = typed[k];
          // The imaginary part is another of the same list, so every part is converted.
          const im = typed[(k + 5) % typed.length];
          for (const at of POSITIONS) {
            const name = range.cls + at;
            const node = holder(root, name, at);
            const text = at === 'Complex' ? complexText(re, im) : re;
            const shows =
              at === 'Complex'
                ? complexText(matlabInt(re, range.lo, range.hi), matlabInt(im, range.lo, range.hi))
                : matlabInt(re, range.lo, range.hi);
            session.setActive(root, node);
            if (format === 'text' && at === 'Complex') {
              // A MAT stream, which is shown and not edited (the C-012 ruling, 2026-10-15).
              expect(session.editProperty(node.id, 'Value', text), `${name} = ${text}`).toMatchObject({ error: true });
              want.set(name, node.displayValue);
              continue;
            }
            expect(session.editProperty(node.id, 'Value', text), `${name} = ${text}`).toBe(true);
            expect(node.displayValue, `${name} = ${text}`).toBe(shows);
            want.set(name, shows);
          }
        }
        const reopened = saveAndReopen(session, root);
        for (const { cls, at, name } of ENTRIES) {
          const node = holder(reopened, name, at);
          expect(node.displayValue, `${name}, reopened`).toBe(want.get(name));
          expect((at === 'Complex' ? node.parent : node).className, `${name}, reopened`).toBe(cls);
        }
      });
    }
  }
});

describe('an element edit leaves the rest of its array as it was', () => {
  for (const { format, file, build } of FORMATS) {
    it(format, () => {
      const session = createSession();
      const root = ingest(session, build(), { filename: file });
      for (const { cls, hi } of CLASSES) {
        const row = holder(root, cls + 'Row', 'Row');
        session.setActive(root, row);
        expect(session.editProperty(row.id, 'Value', String(hi + 1n))).toBe(true);
        expect(row.parent.displayValue, cls).toBe(`[${hi} 2 3]`);
      }
      const reopened = saveAndReopen(session, root);
      for (const { cls, hi } of CLASSES) {
        expect(holder(reopened, cls + 'Row', 'Row').parent.displayValue, cls).toBe(`[${hi} 2 3]`);
      }
    });
  }
});

describe('a whole value typed into an entry of an integer class is converted element by element', () => {
  for (const { format, file, build } of FORMATS) {
    it(format, () => {
      const session = createSession();
      const root = ingest(session, build(), { filename: file });
      const want = new Map<string, string>();
      for (const { cls, lo, hi } of CLASSES) {
        const entry = holder(root, cls + 'Scalar', 'Scalar');
        const typed = [String(hi + 1n), '-2.5', '2.5', 'NaN', '-Inf'];
        session.setActive(root, entry);
        expect(session.editProperty(entry.id, 'Value', '[' + typed.join(' ') + ']'), cls).toBe(true);
        const shows = '[' + typed.map((t) => matlabInt(t, lo, hi)).join(' ') + ']';
        expect([entry.className, entry.displayValue], cls).toEqual([cls, shows]);
        want.set(cls, shows);
      }
      const reopened = saveAndReopen(session, root);
      for (const { cls } of CLASSES) {
        const entry = holder(reopened, cls + 'Scalar', 'Scalar');
        expect([entry.className, entry.displayValue], cls).toEqual([cls, want.get(cls)]);
      }
    });
  }
});

// The writers below the node: a value that reaches one unconverted — a host's value, pasted
// as it is — is converted there, the same way.

/** The values of a MatVariable as digits, read back out of the element MatWriter wrote. */
function writtenAndRead(v: MatVariable): string[] {
  const bytes = encodeMatVariable(v);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const read = parseMatrix(view, 8, view.getUint32(4, true));
  return (read.value as unknown[]).map((x) =>
    x !== null && typeof x === 'object' ? complexText(String((x as any).re), String((x as any).im)) : String(x),
  );
}

describe('a MAT stream holds MATLAB\'s conversion of each number it is given', () => {
  for (const range of CLASSES) {
    const { cls, lo, hi } = range;
    // As numbers, which is how a 32-bit class carries one, and for a 64-bit class as the
    // exact decimal text it carries an integer a double cannot hold in.
    const given: (number | string)[] = [70000, -70000, 2.5, -2.5, 3.7, -3.7, NaN, Infinity, -Infinity, 1e30, 42];
    const typed = ['70000', '-70000', '2.5', '-2.5', '3.7', '-3.7', 'NaN', 'Inf', '-Inf', '1e30', '42'];
    if (cls.endsWith('64')) {
      given.push(String(hi + 1n), String(lo - 1n), String(hi));
      typed.push(String(hi + 1n), String(lo - 1n), String(hi));
    }
    const want = typed.map((t) => matlabInt(t, lo, hi));

    it(`${cls}, real`, () => {
      const v = { name: '', className: cls, dimensions: [1, given.length], isComplex: false, isLogical: false, value: given, fields: null };
      expect(writtenAndRead(v as MatVariable)).toEqual(want);
    });

    it(`${cls}, both parts of a complex value`, () => {
      const pairs = given.map((re, i) => ({ re, im: given[(i + 3) % given.length] }));
      const v = { name: '', className: cls, dimensions: [1, pairs.length], isComplex: true, isLogical: false, value: pairs, fields: null };
      expect(writtenAndRead(v as MatVariable)).toEqual(want.map((re, i) => complexText(re, want[(i + 3) % want.length])));
    });
  }
});

describe('a host\'s value pasted with numbers its class cannot hold is written converted', () => {
  // Pasted where a writer spells it: a text dictionary's literal into a binary one (the XML
  // writer), and a binary dictionary's complex text into a text one (the MAT stream) and
  // into a binary one (the XML writer again). A literal pasted into a text dictionary is
  // written back as the literal it was, as every value a text dictionary did not edit is,
  // so no writer converts it there.
  const pasted = (cls: string) => [
    { name: cls + 'Lit', value: { _type: cls, _value: '[' + ['70000', '-70000', '2.5', '-2.5', 'NaN'].map((n) => lit(cls, n)).join(', ') + ']' } },
    { name: cls + 'Cplx', value: { _type: 'cdata', _value: '70000+3.7i -2.5-70000i', _dimensions: [1, 2], _class: cls } },
  ];
  for (const { format, file, build } of FORMATS) {
    it(`into a ${format} dictionary`, () => {
      const session = createSession();
      const root = ingest(session, build(), { filename: file });
      const section = root.getSection('design');
      let seq = 100;
      for (const { cls } of CLASSES) {
        for (const { name, value } of pasted(cls)) {
          if (format === 'text' && name.endsWith('Lit')) {
            continue;
          }
          section.parseEntry({
            name,
            metadata: { uuid: uuid(seq++), namespace: 'dacaf35e-55a5-454d-a7c1-93db038a210e', lastmod: '20261012T000000.000000', modifiedby: 'host', isderived: '0' },
            value,
          });
        }
      }
      const reopened = saveAndReopen(session, root);
      const entry = (name: string) => reopened.getSection('design').children.find((e: any) => e.name === name);
      for (const { cls, lo, hi } of CLASSES) {
        const m = (t: string) => matlabInt(t, lo, hi);
        if (format === 'binary') {
          expect(entry(cls + 'Lit').displayValue, cls).toBe('[' + ['70000', '-70000', '2.5', '-2.5', 'NaN'].map(m).join(' ') + ']');
        }
        const cplx = entry(cls + 'Cplx');
        expect(cplx.className, cls).toBe(cls);
        expect(cplx.children.map((c: any) => c.displayValue), cls).toEqual([
          complexText(m('70000'), m('3.7')),
          complexText(m('-2.5'), m('-70000')),
        ]);
      }
    });
  }
});

// MATLAB has no negative zero in an integer class: int8(-0) is 0. A typed `-0` is the exact
// token '-0' (XmlUtils.parseExactNum: String(-0) is '0', so the double does not spell it), and
// a token the class held came back as it was given, so `-0` typed into an int8, int16 or int32
// value was shown as `-0` and written as `"_value": "-0"` into a text dictionary and
// `<P Class="int8">-0</P>` into a binary one, as `-0U` into a uint64. A complex element typed
// `-0-0i` kept its text, a part of -0 being === 0. `-0.0` held the double -0, shown as 0.
const NEGATIVE_ZEROS = ['-0', '-00', '-0.0', '-0e5', '-0.4'];

/** A standalone negative zero in what a writer wrote: `-0`, `-00`, `-0U`, `-0e5`, not `-0.4`. */
const NEGATIVE_ZERO = /(?<![\w.])-0+(?![\d.])/;

/** The text a save wrote for one entry's value: its JSON, or its `<P Name="Value">`. */
function writtenValue(saved: any, name: string): string {
  if (saved.kind === 'binary') {
    const xml = strFromU8(unzipSync(saved.bytes)['data/chunk0.xml']);
    const at = xml.indexOf(`<P Name="Name" Class="char">${name}</P>`);
    expect(at, name).toBeGreaterThan(-1);
    const from = xml.indexOf('<P Name="Value"', at);
    return xml.slice(from, xml.indexOf('</Object>', from));
  }
  const json = JSON.parse(saved.text);
  const content = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content;
  return JSON.stringify(content.entries.find((e: any) => e.name === name).value);
}

describe('a negative zero typed into a value of an integer class is 0', () => {
  it('is 0 as the conversion makes it, a number or a token, for every class', () => {
    for (const { cls } of CLASSES) {
      for (const given of ['-0', '-00', -0, '0', 0]) {
        expect(Object.is(toIntegerClass(given, cls), 0), `${cls}(${Object.is(given, -0) ? '-0 (a double)' : JSON.stringify(given)})`).toBe(true);
      }
      // A token is the integer it spells, whatever its spelling.
      expect(toIntegerClass('007', cls), cls).toBe(7);
    }
  });

  for (const { format, file, build } of FORMATS) {
    it(format, () => {
      for (const typed of NEGATIVE_ZEROS) {
        const session = createSession();
        const root = ingest(session, build(), { filename: file });
        for (const { at, name } of ENTRIES) {
          const node = holder(root, name, at);
          const text = at === 'Complex' ? typed + typed + 'i' : typed;
          session.setActive(root, node);
          if (format === 'text' && at === 'Complex') {
            // A MAT stream, which is shown and not edited (the C-012 ruling, 2026-10-15).
            expect(session.editProperty(node.id, 'Value', text), `${name} = ${text}`).toMatchObject({ error: true });
            continue;
          }
          expect(session.editProperty(node.id, 'Value', text), `${name} = ${text}`).toBe(true);
          expect(node.displayValue, `${name} = ${text}`).toBe(at === 'Complex' ? '0+0i' : '0');
        }
        const saved = session.serializeSource(root.name);
        for (const { at, name } of ENTRIES) {
          // A text dictionary's complex value is its MAT stream, whose bytes hold no -0 in an
          // integer class and whose text is not numbers: it is graded by opening it again.
          if (!(format === 'text' && at === 'Complex')) {
            expect(writtenValue(saved, name), `${name} = ${typed}, written`).not.toMatch(NEGATIVE_ZERO);
          }
        }
        const reopened = saveAndReopen(session, root);
        for (const { at, name } of ENTRIES) {
          const shows = format === 'text' && at === 'Complex' ? '1+2i' : at === 'Complex' ? '0+0i' : '0';
          expect(holder(reopened, name, at).displayValue, `${name} = ${typed}, reopened`).toBe(shows);
        }
      }
    });
  }
});
