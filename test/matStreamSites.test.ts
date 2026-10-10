// Copyright 2026 The MathWorks, Inc.
//
// One MAT-stream entry point, MatParser.decodeMatStream, behind every site that reads
// `getByteStreamFromArray(value)`: a text dictionary's cdata (MatlabVariableNode.parseCdata),
// the Property Inspector's Other group (piOther), a classic `.mdl`'s MatData record
// (MdlParser), a binary dictionary's hex value (MatlabVariableNode.parseEncoded) and a
// `.slx` workspace part (readMxArrayRecords). Each site used to frame the stream itself,
// and two of them decoded six-bit text with their own uudecode.
//
// The sites' half of this file holds each one to decoding every stream its fixtures carry
// exactly as it did before, against the code they ran then (test/tools/legacyMatStream.ts),
// MatVariable for MatVariable, raw bytes included. The entry point's half pins what it
// refuses and why.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { decodeMatStream, matStreamFailure, type MatVariable } from '../src/datamodel/parser/MatParser.js';
import { readMxArrayRecords } from '../src/datamodel/parser/MxArrayParser.js';
import { parseMdl } from '../src/datamodel/parser/MdlParser.js';
import { isMatCdata, uudecode, uuencode } from '../src/datamodel/parser/CdataCodec.js';
import { encodedStream, encodedValueOf, type EncodedValue } from '../src/datamodel/parser/EncodedValue.js';
import { buildOtherRows } from '../src/datamodel/node/piOther.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';
import {
  legacyCdataUudecode,
  legacyCdataVariable,
  legacyEncodedStream,
  legacyFormatStream,
  legacyMdlUudecode,
  legacyPiVariable,
  legacyReadMxArrayRecords,
} from './tools/legacyMatStream.js';
import { CLASS, MI, mxArrayFile, numericVar, structVar, u32le } from './tools/matBytes.js';

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));

function filesUnder(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...filesUnder(path, ext));
    } else if (name.endsWith(ext)) {
      out.push(path);
    }
  }
  return out;
}

const FIXTURE_DIRS = [join(TEST_ROOT, 'fixtures'), join(TEST_ROOT, 'parity', 'artifacts')];
const fixtureFiles = (ext: string): string[] => FIXTURE_DIRS.flatMap((d) => filesUnder(d, ext));
const label = (path: string): string => path.slice(TEST_ROOT.length);

// ---- What the fixtures carry ---------------------------------------------------------

/** Every cdata MAT stream in every text dictionary: [where, the cdata envelope]. */
function textCdata(): [string, Record<string, unknown>][] {
  const out: [string, Record<string, unknown>][] = [];
  const walk = (x: unknown, at: string): void => {
    if (Array.isArray(x)) {
      x.forEach((e, i) => walk(e, `${at}[${i}]`));
    } else if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if (o._type === 'cdata' && isMatCdata(o)) {
        out.push([at, o]);
        return;
      }
      for (const [k, v] of Object.entries(o)) walk(v, `${at}.${k}`);
    }
  };
  for (const file of fixtureFiles('.sldd')) {
    const bytes = readFileSync(file);
    if (bytes[0] !== 0x7b) continue; // a zip, not the text format
    walk(JSON.parse(bytes.toString('utf8')), label(file));
  }
  return out;
}

/** Every encoded element of every binary dictionary: [where, the envelope its reader makes]. */
function hexValues(): [string, EncodedValue][] {
  const out: [string, EncodedValue][] = [];
  for (const file of fixtureFiles('.sldd')) {
    const bytes = new Uint8Array(readFileSync(file));
    if (bytes[0] !== 0x50) continue; // not a zip
    for (const [part, data] of Object.entries(unzipSync(bytes))) {
      if (!part.endsWith('.xml')) continue;
      const xml = new TextDecoder().decode(data);
      for (const m of xml.matchAll(/<(P|Element)\b([^>]*\bEncoding="[^"]*"[^>]*)>([^<]*)<\/\1>/g)) {
        const attrs: Record<string, string> = {};
        for (const a of m[2].matchAll(/(\w+)="([^"]*)"/g)) attrs['@_' + a[1]] = a[2];
        out.push([`${label(file)}::${part}@${m.index}`, encodedValueOf(attrs, m[3])!]);
      }
    }
  }
  return out;
}

/** Every `.mxarray` part of every `.slx`, as the exact-length buffer SlxParser hands over. */
function slxParts(): [string, ArrayBuffer][] {
  const out: [string, ArrayBuffer][] = [];
  for (const file of fixtureFiles('.slx')) {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(readFileSync(file)));
    } catch {
      continue;
    }
    for (const [part, data] of Object.entries(entries)) {
      if (part.endsWith('.mxarray')) out.push([`${label(file)}::${part}`, data.slice().buffer]);
    }
  }
  return out;
}

const UNESCAPE: Record<string, string> = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' };

/** The text of every classic `.mdl`'s MatData record, unescaped as MdlParser reads it. */
function mdlRecords(): [string, string, ArrayBuffer][] {
  const out: [string, string, ArrayBuffer][] = [];
  for (const file of fixtureFiles('.mdl')) {
    const bytes = readFileSync(file);
    const text = bytes.toString('latin1');
    for (const m of text.matchAll(/DataRecord\s*\{([\s\S]*?)\n\s*\}/g)) {
      const data = /Data\s+((?:"(?:[^"\\]|\\.)*"\s*)+)/.exec(m[1]);
      if (!data) continue;
      const chunks = [...data[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((c) => c[1]).join('');
      const record = chunks.replace(/\\(.)/g, (_, ch: string) => UNESCAPE[ch] ?? '\\' + ch);
      out.push([label(file), record, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)]);
    }
  }
  return out;
}

const TEXT_CDATA = textCdata();
const HEX = hexValues();
const SLX = slxParts();
const MDL = mdlRecords();

// The variables a classic workspace record holds, as MdlParser.classicWorkspace reads them
// off the decoded stream: a struct array of Name/Value pairs, or a `.slx`'s struct of
// variables.
function legacyWorkspace(record: string): MatVariable[] {
  const buffer = legacyMdlUudecode(record).buffer;
  const { outer } = legacyReadMxArrayRecords(buffer);
  if (!outer || !outer.fields) return [];
  const each = (f: MatVariable | MatVariable[]) => (Array.isArray(f) ? f : [f]);
  if (!outer.fields.Name || !outer.fields.Value) {
    return Object.entries(outer.fields).map(([name, f]) => ({ ...(Array.isArray(f) ? f[0] : f), name }));
  }
  const names = each(outer.fields.Name);
  const values = each(outer.fields.Value);
  const vars: MatVariable[] = [];
  for (let i = 0; i < names.length && i < values.length; i++) {
    const name = typeof names[i].value === 'string' ? (names[i].value as string) : '';
    if (name) vars.push({ ...values[i], name });
  }
  return vars;
}

describe('every site decodes the streams its fixtures carry exactly as it did', () => {
  it('reaches the streams it is meant to', () => {
    // Floors, measured at 163934c: a sweep that silently found nothing would pass.
    expect(TEXT_CDATA.length).toBeGreaterThanOrEqual(87);
    expect(HEX.length).toBeGreaterThanOrEqual(17);
    expect(SLX.length).toBeGreaterThanOrEqual(12);
    expect(MDL.length).toBeGreaterThanOrEqual(5);
  });

  it('a text dictionary\'s cdata (MatlabVariableNode.parseCdata)', () => {
    for (const [at, cdata] of TEXT_CDATA) {
      const before = legacyCdataVariable(cdata._value as string);
      const decoded = decodeMatStream(uudecode(cdata._value as string));
      expect(decoded.ok ? decoded.variable : null, at).toEqual(before);
      // And the node the site builds of it.
      const node = MatlabVariableNode.parseCdata(cdata, 'v', null);
      expect(node._matVar, at).toEqual(before);
    }
  });

  it('the Property Inspector\'s Other group (piOther), for cdata and hex alike', () => {
    // What it shows for a stream is what it showed, but for a sparse array: that is its
    // summary now, as everywhere (test/sparsePresentation.test.ts).
    const shownFor = (bytes: Uint8Array): unknown => {
      const v = legacyPiVariable(bytes);
      return v?.isSparse && !v.undecoded ? `<${v.dimensions.join('x')} sparse ${v.className}>` : legacyFormatStream(bytes);
    };
    let sparse = 0;
    for (const [at, cdata] of TEXT_CDATA) {
      const bytes = legacyCdataUudecode(cdata._value as string);
      const decoded = decodeMatStream(uudecode(cdata._value as string));
      expect(decoded.ok ? decoded.variable : null, at).toEqual(legacyPiVariable(bytes));
      expect(buildOtherRows({ X: cdata }, new Set())[0].value, at).toBe(shownFor(bytes));
      if (legacyPiVariable(bytes)?.isSparse) sparse++;
    }
    for (const [at, hex] of HEX) {
      const before = legacyEncodedStream(hex);
      const shown = buildOtherRows({ X: hex }, new Set())[0].value;
      expect(shown, at).toBe(before.bytes ? shownFor(before.bytes) : expect.stringMatching(/, not decoded>$/));
    }
    // Both kinds are reached: the sparse streams and the full ones beside them.
    expect([sparse > 0, sparse < TEXT_CDATA.length]).toEqual([true, true]);
  });

  it('a binary dictionary\'s hex value (MatlabVariableNode.parseEncoded)', () => {
    for (const [at, hex] of HEX) {
      const before = legacyEncodedStream(hex);
      const now = encodedStream(hex);
      expect(now.reason, at).toBe(before.reason);
      expect(now.bytes, at).toEqual(before.bytes);
      if (!before.bytes) continue;
      const legacy = legacyReadMxArrayRecords(before.bytes.slice().buffer);
      const decoded = decodeMatStream(now.bytes!);
      expect(decoded.ok, at).toBe(true);
      if (decoded.ok) {
        expect(decoded.variable, at).toEqual(legacy.outer);
        expect(decoded.trailingElements, at).toEqual(legacy.trailingElements);
      }
    }
  });

  it('a `.slx` workspace part (readMxArrayRecords, which SlxParser and parseMxArray call)', () => {
    for (const [at, buffer] of SLX) {
      const legacy = legacyReadMxArrayRecords(buffer);
      const now = readMxArrayRecords(buffer);
      expect(now.outer, at).toEqual(legacy.outer);
      expect(now.trailingElements, at).toEqual(legacy.trailingElements);
    }
  });

  it('a classic `.mdl`\'s workspace record (MdlParser)', () => {
    for (const [at, record, file] of MDL) {
      expect(Array.from(uudecode(record.replace(/[\r\n]/g, ''))), at).toEqual(Array.from(legacyMdlUudecode(record)));
      const workspace = parseMdl(file, at.split('/').pop()!).workspace;
      expect([...workspace], at).toEqual(legacyWorkspace(record));
      expect(workspace.length, at).toBeGreaterThan(0);
    }
  });

  it('a `.mdl` record whose text breaks a line inside the stream still decodes: the breaks are not data', () => {
    // MdlParser's own uudecode skipped CR and LF. A `\n` escape inside the quoted record is
    // one, and so is a file whose writer wrapped the record across lines.
    const [at, record, file] = MDL.find(([f]) => f.endsWith('mdlcases_R2017b.mdl'))!;
    const text = new TextDecoder('latin1').decode(file);
    const opening = /Data\s+"/.exec(text.slice(text.indexOf('DataRecord')))!;
    const cut = text.indexOf('DataRecord') + opening.index + opening[0].length + 12;
    const broken = text.slice(0, cut) + '\\n\\r\\n' + text.slice(cut);
    const bytes = new Uint8Array(broken.length);
    for (let i = 0; i < broken.length; i++) bytes[i] = broken.charCodeAt(i);
    const parsed = parseMdl(bytes.buffer, 'mdlcases_R2017b.mdl');
    expect(parsed.warnings, at).toEqual([]);
    expect([...parsed.workspace], at).toEqual(legacyWorkspace(record));
  });
});

// ---- The shared six-bit decoder --------------------------------------------------------

function randomText(seed: number, length: number, breaks: boolean): string {
  let state = seed;
  const next = (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  let s = '';
  for (let i = 0; i < length; i++) {
    const r = next();
    let code: number;
    if (r < 0.05) code = 0; // MATLAB's NUL padding
    else if (breaks && r < 0.08) code = next() < 0.5 ? 0x0a : 0x0d;
    else if (r < 0.1) code = Math.floor(next() * 0x20); // below the alphabet
    else if (r < 0.12) code = 0x60 + Math.floor(next() * 0x1f); // above it
    else code = 0x20 + Math.floor(next() * 0x40);
    s += String.fromCharCode(code);
  }
  return s;
}

describe('CdataCodec.uudecode is the one six-bit decoder', () => {
  it('decodes every text exactly as the text dictionary\'s decoder did', () => {
    for (let t = 0; t < 4000; t++) {
      const s = randomText(t + 1, t % 97, true);
      expect(Array.from(uudecode(s)), JSON.stringify(s)).toEqual(Array.from(legacyCdataUudecode(s)));
    }
  });

  it('and, with the line breaks taken out, exactly as the `.mdl` decoder did', () => {
    for (let t = 0; t < 4000; t++) {
      const s = randomText(t + 7, t % 97, true);
      expect(Array.from(uudecode(s.replace(/[\r\n]/g, ''))), JSON.stringify(s)).toEqual(Array.from(legacyMdlUudecode(s)));
    }
  });

  it('hands back a buffer of exactly the decoded length, which readMxArrayRecords is handed whole', () => {
    const bytes = uudecode('  %)3' + ' '.repeat(40));
    expect(bytes.byteOffset).toBe(0);
    expect(bytes.buffer.byteLength).toBe(bytes.length);
  });
});

// ---- The entry point -------------------------------------------------------------------

// A stream as getByteStreamFromArray writes one: preamble, one unnamed miMATRIX.
const SCALAR = new Uint8Array(mxArrayFile(numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [7] }).slice(8)));

function withBytes(base: Uint8Array, at: number, bytes: number[]): Uint8Array {
  const out = base.slice();
  out.set(bytes, at);
  return out;
}

describe('decodeMatStream', () => {
  it('reads the variable, and whatever elements follow it', () => {
    const trailing = new Uint8Array([...u32le(MI.UINT8), ...u32le(8), 1, 2, 3, 4, 5, 6, 7, 8]);
    const bytes = new Uint8Array(mxArrayFile(numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [7] }).slice(8), { trailing }));
    const decoded = decodeMatStream(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect([decoded.variable.className, decoded.variable.value]).toEqual(['double', 7]);
    expect(decoded.trailingElements.map((e) => Array.from(e))).toEqual([Array.from(trailing)]);
  });

  it('says why it refuses what is not a MAT stream, and never reads one as a number', () => {
    const reason = (bytes: Uint8Array) => {
      const decoded = decodeMatStream(bytes);
      return decoded.ok ? null : decoded.reason;
    };
    expect(reason(SCALAR.slice(0, 15))).toBe("it holds 15 bytes, fewer than a MAT stream's header");
    for (let i = 0; i < 4; i++) {
      expect(reason(withBytes(SCALAR, i, [SCALAR[i] ^ 0x01])), `byte ${i}`).toBe(
        'its bytes are not a MAT stream (they do not open with 00 01 49 4D)',
      );
    }
    // The reserved word: zero in every stream MATLAB was seen writing (87 text-dictionary
    // cdata, 17 hex values, 5 `.mdl` records and 12 `.slx` parts under test/, and 594 `.slx`
    // parts, 25 cdata and 4 hex values in the corpus).
    for (let i = 4; i < 8; i++) {
      expect(reason(withBytes(SCALAR, i, [1])), `byte ${i}`).toBe("its MAT stream's reserved bytes 4-7 are not zero");
    }
    expect(reason(withBytes(SCALAR, 8, [MI.UINT8]))).toBe('its MAT stream does not hold an array');
    expect(reason(withBytes(SCALAR, 12, [0, 0, 0, 0]))).toBe('its MAT array declares no bytes');
  });

  it('clamps a stream that ends early, as a container reads one; asked for whole, refuses it', () => {
    const field = numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [1] });
    const struct = new Uint8Array(mxArrayFile(structVar('', ['a'], [{ a: field }]).slice(8)));
    const declared = new DataView(struct.buffer).getUint32(12, true);
    const short = struct.slice(0, struct.length - 8);
    const lenient = decodeMatStream(short);
    expect(lenient.ok).toBe(true);
    const whole = decodeMatStream(short, { whole: true });
    expect(whole.ok ? null : whole.reason).toBe(`its MAT array declares ${declared} bytes and the stream holds ${short.length - 16}`);
    expect(matStreamFailure(short, true)).toBe(whole.ok ? null : whole.reason);
    expect(matStreamFailure(short)).toBeNull();
  });

  it('reads the stream where it sits in a larger buffer', () => {
    const big = new Uint8Array(SCALAR.length + 24);
    big.set(SCALAR, 8);
    const decoded = decodeMatStream(big.subarray(8, 8 + SCALAR.length));
    expect(decoded).toEqual(decodeMatStream(SCALAR));
    expect(decoded.ok && decoded.variable.value).toBe(7);
  });

  it('never throws, whatever follows a well-formed header', () => {
    let state = 99;
    const next = (): number => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state & 0xff;
    };
    for (let t = 0; t < 1500; t++) {
      const bytes = new Uint8Array(16 + (t % 200));
      for (let i = 16; i < bytes.length; i++) bytes[i] = next();
      bytes.set([0x00, 0x01, 0x49, 0x4d, 0, 0, 0, 0, 14, 0, 0, 0], 0);
      bytes.set(u32le(bytes.length - 16), 12);
      for (const whole of [false, true]) {
        const decoded = decodeMatStream(bytes, { whole });
        expect(typeof decoded.ok).toBe('boolean');
      }
    }
  });
});

// ---- Each site refuses what the entry point refuses ---------------------------------

describe('every site refuses a stream whose preamble is not MATLAB\'s', () => {
  // The two the sites never checked before: the version and endian mark, and the reserved
  // word. A site that framed the stream itself again would decode both.
  const CORRUPT: [string, (b: Uint8Array) => void, string][] = [
    // Byte 3, the 'M': the first four characters of a cdata, which say it is a stream at
    // all (CdataCodec.isMatCdata), encode only bytes 0-2.
    ['the endian mark', (b) => (b[3] = 0x4c), 'its bytes are not a MAT stream (they do not open with 00 01 49 4D)'],
    ['the reserved word', (b) => (b[5] = 1), "its MAT stream's reserved bytes 4-7 are not zero"],
  ];
  const [, cdata] = TEXT_CDATA.find(([at]) => at.includes('sparse_text.sldd'))!;
  const [, hex] = HEX[0];
  const [, part] = SLX[0];

  for (const [what, corrupt, reason] of CORRUPT) {
    it(`${what}: a text dictionary's cdata is the char it is, and the Other group shows nothing`, () => {
      const bytes = uudecode(cdata._value as string);
      corrupt(bytes);
      const value = { _type: 'cdata', _value: uuencode(bytes) };
      const node = MatlabVariableNode.parseCdata(value, 'v', null);
      expect([node.className, node._matVar], what).toEqual(['char', null]);
      expect(buildOtherRows({ X: value }, new Set())[0].value, what).toBe('');
      // And the untouched stream decodes at both sites, so the refusal is the header's.
      expect(MatlabVariableNode.parseCdata(cdata, 'v', null).className, what).not.toBe('char');
    });

    it(`${what}: a binary dictionary's hex value says why it is not decoded`, () => {
      const bytes = encodedStream(hex).bytes!.slice();
      corrupt(bytes);
      const digits = Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
      const damaged = encodedValueOf({ '@_Class': 'double', '@_Encoding': 'hex', '@_EncodedLength': String(bytes.length) }, digits)!;
      expect(encodedStream(damaged).reason, what).toBe(reason);
      expect(buildOtherRows({ X: damaged }, new Set())[0].value, what).toBe('<double, not decoded>');
    });

    it(`${what}: a .slx workspace part holds no workspace`, () => {
      const bytes = new Uint8Array(part).slice();
      corrupt(bytes);
      expect(readMxArrayRecords(bytes.buffer).outer, what).toBeNull();
      expect(readMxArrayRecords(part).outer, what).not.toBeNull();
    });
  }

  it('the endian mark: a .mdl workspace record does not decode, and the model says so', () => {
    // The record's third character carries the top bits of the 'I': '%' -> '&' makes it
    // 0x89 and leaves the bytes before it as they were.
    const [, , file] = MDL.find(([f]) => f.endsWith('mdlcases_R2017b.mdl'))!;
    const text = new TextDecoder('latin1').decode(file);
    const at = text.indexOf('"  %)', text.indexOf('DataRecord'));
    const damaged = text.slice(0, at) + '"  &)' + text.slice(at + 5);
    const bytes = Uint8Array.from(damaged, (ch) => ch.charCodeAt(0));
    const parsed = parseMdl(bytes.buffer, 'mdlcases_R2017b.mdl');
    expect(parsed.warnings.map((w) => [w.code, w.part])).toEqual([['part-unreadable', 'DataTag0']]);
    expect(parsed.workspace.length).toBe(0);
  });
});

describe('a hex value has to be whole elements to its last byte, or end at a zero tag', () => {
  const [, hex] = HEX[0];
  const whole = encodedStream(hex).bytes!;
  const join = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };
  const junk = new Uint8Array([1, 2, 3, 4]);

  it('one that ends inside an element\'s tag is refused', () => {
    expect(matStreamFailure(whole, true)).toBeNull();
    expect(matStreamFailure(join(whole, junk), true)).toBe("its MAT stream ends 4 bytes into an element's tag");
    // As a container reads it, the same bytes are read.
    expect(decodeMatStream(join(whole, junk)).ok).toBe(true);
  });

  it('one that ends at a zero tag has ended, whatever follows the tag', () => {
    const ended = join(whole, new Uint8Array(8), junk);
    expect(matStreamFailure(ended, true)).toBeNull();
    const decoded = decodeMatStream(ended, { whole: true });
    const plain = decodeMatStream(whole);
    expect(decoded.ok && plain.ok && decoded.trailingElements.length === plain.trailingElements.length).toBe(true);
  });
});
