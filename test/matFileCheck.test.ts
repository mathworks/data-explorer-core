// Copyright 2026 The MathWorks, Inc.
// The contract of the strict MAT-file checker (src/datamodel/parser/MatFileCheck.ts).
//
// `checkMatFile` claims to say whether MATLAB loads a file, and the claim is only as good as
// the ground truth it is held to. So the first block holds it to MATLAB's own verdicts: the
// files in test/fixtures/mat-check are copies of files MATLAB R2027a wrote, most of them
// edited one byte range at a time, and verdicts.json records what `S = load(f)` did with
// each (loads; fails; loads with a variable silently missing; loads with a value or a name
// changed) and the violation codes the checker gives it. Every file MATLAB did not load as
// stored must have a violation, and every file it did load must have none, except the short
// list of deliberate differences below, each with its reason. There is no MATLAB failure in
// the corpus the checker does not see.
//
// The second block runs it over every Level-5 `.mat` already in this repo. MATLAB wrote all
// of them, so a violation there is a false positive, or a finding about the fixture.
//
// The rest is one rule at a time on bytes built here (test/tools/matBytes.ts), including the
// ones no probe broke, and the two promises the save path leans on: the check never throws,
// and its work is bounded however the bytes lie.

import { describe, it, expect, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, gzipSync, zlibSync } from 'fflate';
import { checkMatFile, violationsAdded, type MatViolation, type MatViolationCode } from '../src/datamodel/parser/MatFileCheck.js';
import { setNativeInflate } from '../src/datamodel/parser/Inflate.js';
import {
  CLASS,
  MI,
  arrayFlags,
  cellVar,
  charVar,
  dims,
  element,
  matFile,
  matrix,
  numericVar,
  sparseVar,
  structVar,
  u32le,
  varName,
} from './tools/matBytes.js';

const TEST = fileURLToPath(new URL('.', import.meta.url));
const CORPUS = join(TEST, 'fixtures', 'mat-check');

interface Verdict {
  file: string;
  probe: string;
  matlab: 'loads' | 'fails' | 'drops' | 'alters';
  what: string;
  matlabSays?: string;
  codes: MatViolationCode[];
  deliberate?: string;
}

const verdicts = JSON.parse(readFileSync(join(CORPUS, 'verdicts.json'), 'utf8')) as Verdict[];

const read = (path: string): Uint8Array => new Uint8Array(readFileSync(path));
const codesOf = (violations: MatViolation[]): MatViolationCode[] => [...new Set(violations.map((v) => v.code))].sort();
const codes = (bytes: Uint8Array): MatViolationCode[] => codesOf(checkMatFile(bytes));

afterEach(() => {
  setNativeInflate(undefined);
});

/**
 * The files MATLAB loads that the checker flags anyway, and why. They are the whole list: a
 * file that loads and is flagged without being named here fails the corpus test.
 */
const DELIBERATE: Record<string, string> = {
  // MATLAB loads a name stored twice without a word, and which copy a caller gets depends on
  // how it asks: `load(f)` keeps the last, `load(f, name)` the first. A save that wrote one
  // would be writing that ambiguity, so it is a violation.
  'duplicate-name-later-copy.mat': 'duplicate-name',
  'duplicate-name-earlier-copy.mat': 'duplicate-name',
  'duplicate-object-names.mat': 'duplicate-name',
  // Eight zero bytes after the subsystem load, because MATLAB's load stops reading at the
  // subsystem. They are no record all the same, MATLAB writes nothing after the subsystem, and
  // its `save -append` reads past it (it revived a variable stored there), so they are a
  // `framing` violation like zero bytes anywhere else.
  'trailing-zeros-after-subsystem.mat': 'framing',
};

describe('the MATLAB-verdict corpus', () => {
  it('is what verdicts.json says it is', () => {
    const files = readdirSync(CORPUS).filter((f) => f.endsWith('.mat')).sort();
    expect(files).toEqual(verdicts.map((v) => v.file).sort());
    expect(verdicts.filter((v) => v.matlab !== 'loads').length).toBeGreaterThanOrEqual(36);
    expect(Object.keys(DELIBERATE).sort()).toEqual(verdicts.filter((v) => v.deliberate).map((v) => v.file).sort());
  });

  for (const engine of ['the detected inflate engine', 'fflate'] as const) {
    describe(`with ${engine}`, () => {
      for (const v of verdicts) {
        it(`${v.file}: MATLAB ${v.matlab}`, () => {
          if (engine === 'fflate') setNativeInflate(null);
          const found = checkMatFile(read(join(CORPUS, v.file)));
          expect(codesOf(found)).toEqual(v.codes);
          if (v.matlab !== 'loads') {
            expect(found.length).toBeGreaterThan(0);
          } else if (DELIBERATE[v.file]) {
            expect(codesOf(found)).toEqual([DELIBERATE[v.file]]);
          } else {
            expect(found).toEqual([]);
          }
        });
      }
    });
  }

  it('names the variable each per-variable violation is in', () => {
    const after = checkMatFile(read(join(CORPUS, 'variable-after-subsystem.mat')));
    expect(after).toEqual([expect.objectContaining({ code: 'subsystem-not-last', variable: 'd_scalar' })]);
    const chars = checkMatFile(read(join(CORPUS, 'char-every-encoding.mat')));
    expect(chars.map((v) => v.variable)).toEqual(['ch_utf32', 'ch_na_utf32', 'ch_cjk_u16', 'ch_cjk_utf32', 'ch_emoji_u16', 'ch_emoji_utf32']);
    const crash = checkMatFile(read(join(CORPUS, 'non-utf8-name.mat')));
    expect(crash).toEqual([expect.objectContaining({ code: 'name', message: expect.stringContaining('crashes') })]);
  });
});

/** Every `.mat` under test/ but the corpus above, which has verdicts of its own. */
function repoMatFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (path !== CORPUS) repoMatFiles(path, out);
    } else if (name.endsWith('.mat')) {
      out.push(path);
    }
  }
  return out.sort();
}

describe('the MATLAB-written .mat fixtures in this repo', () => {
  const files = repoMatFiles(TEST);
  // A Level-5 file holds version 0x0100 (bytes 00 01); the one -v7.3 fixture holds 00 02.
  const level5 = files.filter((f) => {
    const b = read(f);
    return b[124] === 0x00 && b[125] === 0x01;
  });

  it('are found', () => {
    expect(level5.length).toBeGreaterThanOrEqual(35);
    expect(files.length - level5.length).toBe(1);
  });

  for (const file of level5) {
    it(`${file.slice(TEST.length)} has no violation`, () => {
      expect(checkMatFile(read(file))).toEqual([]);
    });
  }

  it('says a -v7.3 file is no Level-5 one', () => {
    const v73 = files.find((f) => !level5.includes(f))!;
    expect(checkMatFile(read(v73))).toEqual([expect.objectContaining({ code: 'not-level5', message: expect.stringContaining('-v7.3') })]);
  });
});

// ---- Bytes built here -------------------------------------------------------------------

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A record holding `el` compressed, as `save -v7` writes one: `wrap` is the stream's framing. */
function compressed(el: Uint8Array, wrap: (b: Uint8Array) => Uint8Array = zlibSync): Uint8Array {
  const z = wrap(el);
  return concat([u32le(MI.COMPRESSED), u32le(z.length), z]);
}

/** A record of raw bytes under a tag of `type`, with `n` declared (its length by default). */
function rawRecord(type: number, body: Uint8Array, n = body.length): Uint8Array {
  return concat([u32le(type), u32le(n), body]);
}

/** A subsystem record: an unnamed uint8 [1 N] array whose bytes are a MAT stream of `elements`. */
function subsystem(elements: Uint8Array[] = [numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [1] })]): Uint8Array {
  const stream = concat([new Uint8Array([0x00, 0x01, 0x49, 0x4d, 0, 0, 0, 0]), ...elements]);
  return matrix([arrayFlags(CLASS.UINT8), dims([1, stream.length]), varName(''), element(MI.UINT8, stream)]);
}

/**
 * A MAT-file of `records`, its header's subsystem offset pointing at `records[subsystemAt]`, or
 * holding `offset` when that is a number, or 0.
 */
function file(records: Uint8Array[], subsystemAt?: number, offset?: number): Uint8Array {
  const bytes = new Uint8Array(matFile(records));
  const at = subsystemAt === undefined ? offset ?? 0 : 128 + records.slice(0, subsystemAt).reduce((n, r) => n + r.length, 0);
  new DataView(bytes.buffer).setUint32(116, at, true);
  return bytes;
}

const x = (name = 'x', real = [1, 2, 3]): Uint8Array => numericVar({ name, cls: CLASS.DOUBLE, dimensions: [1, real.length], real });

/** The one violation `bytes` has, which has to be one. */
function only(bytes: Uint8Array): MatViolation {
  const found = checkMatFile(bytes);
  expect(found).toHaveLength(1);
  return found[0];
}

describe('bytes this test builds', () => {
  it('are read where they are, in a view into a larger buffer', () => {
    const bytes = file([x(), compressed(charVar('t', 'abc', 18))]);
    const larger = new Uint8Array(bytes.length + 64);
    larger.set(bytes, 32);
    expect(checkMatFile(larger.subarray(32, 32 + bytes.length))).toEqual(checkMatFile(bytes));
    expect(codes(bytes)).toEqual(['char-type']);
  });

  it('are clean when they follow every rule', () => {
    const s = structVar('s', ['a', 'bb'], [{ a: x(''), bb: charVar('', 'héllo', MI.UTF16) }]);
    const c = cellVar('c', [x(''), charVar('', 'a\u{1F600}b', MI.UTF8, [1, 4]), matrix([])]);
    const sp = sparseVar({ name: 'sp', dimensions: [2, 2], ir: [0, 1], jc: [0, 1, 2], real: [1, 2] });
    const i8 = numericVar({ name: 'i8', cls: CLASS.INT8, dimensions: [1, 2], real: [-5, 7] });
    const narrowed = numericVar({ name: 'd', cls: CLASS.DOUBLE, dimensions: [1, 3], dataType: MI.UINT8, real: [1, 2, 3] });
    expect(checkMatFile(file([x(), s, compressed(c), sp, i8, narrowed, compressed(subsystem())], 6))).toEqual([]);
    expect(checkMatFile(file([]))).toEqual([]);
  });
});

describe('the header', () => {
  it('short-file: fewer than 128 bytes', () => {
    expect(only(new Uint8Array(100))).toMatchObject({ code: 'short-file', at: 0 });
  });

  it('not-level5: a version or an endian mark that is not a Level-5 file\'s', () => {
    const v = (b124: number, b125: number, b126 = 0x49, b127 = 0x4d) => {
      const bytes = file([x()]);
      bytes.set([b124, b125, b126, b127], 124);
      return only(bytes);
    };
    expect(v(0x00, 0x00)).toMatchObject({ code: 'not-level5', at: 124 });
    expect(v(0x00, 0x02).message).toContain('-v7.3');
    expect(v(0x00, 0x01, 0x58, 0x58)).toMatchObject({ code: 'not-level5', at: 126 });
    // 'MI' wants the version as 01 00: 00 01 with 'MI' is a version and a mark that disagree.
    expect(v(0x00, 0x01, 0x4d, 0x49).message).toContain('disagree');
  });

  it('big-endian: noted, and nothing after the header checked', () => {
    const bytes = file([rawRecord(MI.DOUBLE, new Uint8Array(8))]);
    bytes.set([0x01, 0x00, 0x4d, 0x49], 124);
    expect(only(bytes)).toMatchObject({ code: 'big-endian', at: 126 });
  });

  it('level4-lookalike: a zero 16-bit half in the first four bytes', () => {
    for (const lead of [[0, 0, 0x41, 0x41], [0x41, 0x41, 0, 0]]) {
      const bytes = file([x()]);
      bytes.set(lead, 0);
      expect(only(bytes)).toMatchObject({ code: 'level4-lookalike', at: 0 });
    }
    const one = file([x()]);
    one.set([0, 0x41, 0x41, 0], 0);
    expect(checkMatFile(one)).toEqual([]);
  });
});

describe('framing', () => {
  it('a record cut short', () => {
    const bytes = file([x(), x('y')]);
    expect(only(bytes.subarray(0, bytes.length - 8))).toMatchObject({ code: 'framing', at: 128 + x().length });
  });

  it('bytes after the last record: 1-7 of anything, or zeros MATLAB reads as a type-0 tag', () => {
    for (const tail of [new Uint8Array([1, 2, 3]), new Uint8Array(5), new Uint8Array(8), new Uint8Array(100)]) {
      const at = 128 + x().length;
      expect(only(concat([file([x()]), tail]))).toMatchObject({ code: 'framing', at });
    }
  });

  it('zero padding after a compressed record, which is never padded', () => {
    const z = compressed(x());
    const pad = new Uint8Array((8 - (z.length % 8)) % 8 || 8);
    const found = checkMatFile(file([z, pad, compressed(x('y'))]));
    expect(found).toEqual([expect.objectContaining({ code: 'framing', at: 128 + z.length })]);
  });

  it('a plain record missing its final pad', () => {
    // A 1x1 uint8 whose data takes the small tag ends on a word boundary anyway, so take one
    // whose data is 3 bytes, padded to 8, and cut the pad.
    const el = numericVar({ name: 'u', cls: CLASS.UINT8, dimensions: [1, 3], real: [1, 2, 3] });
    const cut = el.subarray(0, el.length - 5);
    new DataView(cut.buffer, cut.byteOffset).setUint32(4, cut.length - 8, true);
    expect(codes(file([cut]))).toEqual(['framing', 'nbytes']);
  });

  it('bytes after the subsystem\'s record, which MATLAB\'s load never reads', () => {
    const found = checkMatFile(concat([file([x(), subsystem()], 1), new Uint8Array(8)]));
    expect(found).toEqual([expect.objectContaining({ code: 'framing', message: expect.stringContaining('after the subsystem') })]);
  });
});

describe('records', () => {
  it('top-level-type: a record that is neither miMATRIX nor miCOMPRESSED', () => {
    const found = checkMatFile(file([rawRecord(MI.DOUBLE, new Uint8Array(8)), x()]));
    expect(found).toEqual([expect.objectContaining({ code: 'top-level-type', at: 128 })]);
  });

  it('empty-matrix: an miMATRIX of 0 bytes, plain or compressed', () => {
    expect(only(file([rawRecord(MI.MATRIX, new Uint8Array(0)), x()]))).toMatchObject({ code: 'empty-matrix', at: 128 });
    expect(only(file([compressed(rawRecord(MI.MATRIX, new Uint8Array(0)))]))).toMatchObject({ code: 'empty-matrix', at: 128 });
    // A matrix inside another may be empty: MATLAB reads it as [].
    expect(checkMatFile(file([cellVar('c', [matrix([])])]))).toEqual([]);
  });

  it('compressed-wrapper: raw deflate, gzip, or no zlib header', () => {
    for (const wrap of [deflateSync, gzipSync, (b: Uint8Array) => concat([new Uint8Array([0x78, 0x00]), deflateSync(b)])]) {
      expect(only(file([compressed(x(), wrap)]))).toMatchObject({ code: 'compressed-wrapper', at: 128 });
    }
  });

  it('compressed-wrapper: a stream cut short, or bytes after it in the record', () => {
    const z = zlibSync(x());
    expect(only(file([rawRecord(MI.COMPRESSED, z.subarray(0, z.length - 6))])).message).toContain('does not inflate');
    const after = only(file([rawRecord(MI.COMPRESSED, concat([z, new Uint8Array(4)]))]));
    expect(after.message).toContain('checksum');
    // The stream inflated, so the variable it holds is known, and said.
    expect(after.variable).toBe('x');
  });

  it('compressed-wrapper: a payload that is not one matrix and nothing else', () => {
    const el = x();
    expect(only(file([compressed(concat([el, new Uint8Array(8)]))])).message).toContain('after its matrix');
    expect(only(file([compressed(rawRecord(MI.DOUBLE, new Uint8Array(8)))])).message).toContain('miDOUBLE');
    expect(only(file([compressed(compressed(el))])).message).toContain('another compressed record');
    // Cut short, the matrix is said to be, and so is the sub-element it ends inside.
    const cut = checkMatFile(file([compressed(el.subarray(0, el.length - 8))]));
    expect(codesOf(cut)).toEqual(['compressed-wrapper', 'nbytes']);
    expect(cut[0].message).toContain('cut short');
    expect(only(file([compressed(new Uint8Array(4))])).message).toContain('fewer than one element');
  });
});

describe('where records are', () => {
  it('subsystem-offset: pointing where no record starts, past the file, or at a variable', () => {
    const records = [x(), x('y'), subsystem()];
    for (const offset of [129, 64, 1 << 20]) {
      const found = checkMatFile(file(records, undefined, offset));
      expect(codesOf(found)).toEqual(['anonymous-record', 'subsystem-offset']);
      expect(found[0]).toMatchObject({ code: 'subsystem-offset', at: 116 });
    }
    const atVariable = checkMatFile(file(records, 1));
    expect(atVariable[0].message).toContain('variable "y"');
  });

  it('subsystem-offset: pointing at an unnamed record that holds no subsystem data', () => {
    // MATLAB reads the record there as the objects' data, and stops listing variables at it.
    expect(codes(file([x(), x('')], 1))).toEqual(['anonymous-record', 'subsystem-offset']);
  });

  it('subsystem-offset: 0, with a subsystem in the file (and 8 spaces are 0)', () => {
    const bytes = file([x(), subsystem()]);
    expect(codes(bytes)).toEqual(['anonymous-record', 'subsystem-offset']);
    bytes.fill(0x20, 116, 124);
    expect(codes(bytes)).toEqual(['anonymous-record', 'subsystem-offset']);
  });

  it('subsystem-not-last: each variable after the subsystem, named', () => {
    const found = checkMatFile(file([x(), subsystem(), x('late'), compressed(x('later'))], 1));
    expect(found.map((v) => [v.code, v.variable])).toEqual([['subsystem-not-last', 'late'], ['subsystem-not-last', 'later']]);
    expect(found[0].message).toContain('silently');
  });

  it('anonymous-record: an unnamed record where no subsystem is, and what it hides', () => {
    const found = checkMatFile(file([x(), x(''), x('y'), x('z')]));
    expect(found).toEqual([expect.objectContaining({ code: 'anonymous-record', at: 128 + x().length })]);
    expect(found[0].message).toContain('the 2 record(s) after it');
  });

  it('duplicate-name: a name stored twice, at the later copy', () => {
    const found = checkMatFile(file([x(), x('y'), compressed(x())]));
    expect(found).toEqual([expect.objectContaining({ code: 'duplicate-name', variable: 'x', at: 128 + 2 * x().length })]);
  });
});

describe('names', () => {
  it('name: not an identifier, a keyword, or not UTF-8', () => {
    for (const bad of ['1abc', 'has space', '_x', 'café', 'x-y']) {
      expect(only(file([x(bad)]))).toMatchObject({ code: 'name', variable: bad });
    }
    expect(only(file([x('end')])).message).toContain('"end_"');
    const latin1 = matrix([arrayFlags(CLASS.DOUBLE), dims([1, 1]), element(MI.INT8, new Uint8Array([0x63, 0x61, 0x66, 0xe9])), element(MI.DOUBLE, new Uint8Array(8))]);
    expect(only(file([latin1])).message).toContain('crashes');
  });

  it('takes any identifier, however long', () => {
    expect(checkMatFile(file([x('a'), x('A_1'), x('n'.repeat(70)), x('endx')]))).toEqual([]);
  });
});

describe('char data', () => {
  it('char-type: miUTF32, miUINT8, miINT8, or no text type at all', () => {
    for (const type of [18, MI.UINT8, MI.INT8, MI.DOUBLE]) {
      expect(only(file([charVar('t', 'abc', type)]))).toMatchObject({ code: 'char-type', variable: 't' });
    }
  });

  it('char-type: miUINT16 above U+00FF, which MATLAB keeps the low byte of, or fails on', () => {
    expect(checkMatFile(file([charVar('t', 'héllo', MI.UINT16)]))).toEqual([]);
    expect(only(file([charVar('t', '日本語', MI.UINT16)])).message).toContain('U+65E5');
    expect(only(file([charVar('t', 'a\u{1F600}b', MI.UINT16, [1, 4])])).message).toContain('U+D83D');
  });

  it('char-type: miUTF8 that is not UTF-8, and a complex char array', () => {
    const notUtf8 = matrix([arrayFlags(CLASS.CHAR), dims([1, 2]), varName('t'), element(MI.UTF8, new Uint8Array([0xc3, 0x28]))]);
    expect(only(file([notUtf8])).message).toContain('not valid UTF-8');
    const twoParts = matrix([arrayFlags(CLASS.CHAR, { complex: true }), dims([1, 1]), varName('t'), element(MI.UTF16, new Uint8Array(2)), element(MI.UTF16, new Uint8Array(2))]);
    expect(only(file([twoParts])).message).toContain('complex');
  });

  it('utf8-count: miUTF8 whose UTF-16 length is not the element count', () => {
    expect(only(file([charVar('t', 'héllo', MI.UTF8, [1, 6])]))).toMatchObject({ code: 'utf8-count' });
    // An emoji is two UTF-16 units: dims [1 3] for 'a', U+1F600, 'b' is one short.
    expect(only(file([charVar('t', 'a\u{1F600}b', MI.UTF8, [1, 3])]))).toMatchObject({ code: 'utf8-count' });
    expect(checkMatFile(file([charVar('t', 'a\u{1F600}b', MI.UTF8, [1, 4])]))).toEqual([]);
  });

  it('data-size: miUTF16 or miUINT16 of another length than the element count', () => {
    expect(only(file([charVar('t', 'abc', MI.UTF16, [1, 4])]))).toMatchObject({ code: 'data-size' });
    expect(only(file([charVar('t', 'abc', MI.UINT16, [1, 2])]))).toMatchObject({ code: 'data-size' });
  });

  it('applies at any depth, and says whose it is', () => {
    const deep = structVar('s', ['c'], [{ c: cellVar('', [x(''), charVar('', 'abc', 18)]) }]);
    expect(only(file([compressed(deep)]))).toMatchObject({ code: 'char-type', variable: 's', at: 128 });
  });
});

describe('numeric data', () => {
  it('int-storage: every class but double in its own type only', () => {
    const cases: [number, number, { logical?: boolean }][] = [
      [CLASS.INT8, MI.UINT8, {}],
      [CLASS.UINT8, MI.INT8, {}],
      [CLASS.INT32, MI.INT16, {}],
      [CLASS.UINT64, MI.DOUBLE, {}],
      [CLASS.SINGLE, MI.DOUBLE, {}],
      [CLASS.UINT8, MI.DOUBLE, { logical: true }],
    ];
    for (const [cls, dataType, opts] of cases) {
      const v = numericVar({ name: 'v', cls, dimensions: [1, 2], dataType, real: [1, 2], ...opts });
      expect(only(file([v]))).toMatchObject({ code: 'int-storage', variable: 'v' });
    }
    const imag = numericVar({ name: 'v', cls: CLASS.INT16, dimensions: [1, 1], real: [1], imag: [2] });
    expect(checkMatFile(file([imag]))).toEqual([]);
  });

  it('takes a double in any numeric type', () => {
    for (const dataType of [MI.INT8, MI.UINT8, MI.INT16, MI.UINT16, MI.INT32, MI.UINT32, MI.SINGLE, MI.INT64, MI.UINT64]) {
      const v = numericVar({ name: 'v', cls: CLASS.DOUBLE, dimensions: [1, 2], dataType, real: [1, 2], imag: [3, 4] });
      expect(checkMatFile(file([v]))).toEqual([]);
    }
  });

  it('data-size: more or fewer elements than the dimensions say', () => {
    expect(only(file([numericVar({ name: 'v', cls: CLASS.DOUBLE, dimensions: [1, 3], real: [1, 2] })]))).toMatchObject({ code: 'data-size' });
    expect(only(file([numericVar({ name: 'v', cls: CLASS.INT8, dimensions: [1, 1], real: [1, 2] })]))).toMatchObject({ code: 'data-size' });
    const ragged = numericVar({ name: 'v', cls: CLASS.INT16, dimensions: [1, 1], rawReal: new Uint8Array(3), real: [] });
    expect(only(file([ragged]))).toMatchObject({ code: 'data-size' });
  });

  it('element: a double whose data is no numeric type', () => {
    const v = numericVar({ name: 'v', cls: CLASS.DOUBLE, dimensions: [1, 1], dataType: MI.UTF8, rawReal: new Uint8Array(8), real: [] });
    expect(only(file([v]))).toMatchObject({ code: 'element' });
  });

  it('sparse: column starts one per column and one more, non-zeros as many as row indices', () => {
    expect(only(file([sparseVar({ name: 'sp', dimensions: [2, 2], ir: [0, 1], jc: [0, 2], real: [1, 2] })]))).toMatchObject({ code: 'data-size' });
    expect(only(file([sparseVar({ name: 'sp', dimensions: [2, 2], ir: [0, 1], jc: [0, 1, 2], real: [1] })]))).toMatchObject({ code: 'data-size' });
    const logical = sparseVar({ name: 'sp', dimensions: [2, 2], ir: [0], jc: [0, 1, 1], real: [1], logical: true });
    expect(only(file([logical]))).toMatchObject({ code: 'int-storage' });
    const single = sparseVar({ name: 'sp', dimensions: [2, 2], ir: [0], jc: [0, 1, 1], real: [1], cls: CLASS.SINGLE, sparseFlag: true, dataType: MI.SINGLE });
    expect(checkMatFile(file([single]))).toEqual([]);
    const int8 = sparseVar({ name: 'sp', dimensions: [2, 2], ir: [0], jc: [0, 1, 1], real: [1], cls: CLASS.INT8, sparseFlag: true, dataType: MI.INT8 });
    expect(only(file([int8])).message).toContain('double, single and logical');
  });
});

describe('the shape of a matrix', () => {
  const body = (subs: Uint8Array[]) => file([matrix(subs)]);
  const flags = arrayFlags(CLASS.DOUBLE);
  const d11 = dims([1, 1]);
  const one = element(MI.DOUBLE, new Uint8Array(8));

  it('nbytes: bytes after the last sub-element, or a sub-element past the matrix\'s end', () => {
    expect(only(body([flags, d11, varName('v'), one, new Uint8Array(8)]))).toMatchObject({ code: 'nbytes', variable: 'v' });
    const over = matrix([flags, d11, varName('v'), one]);
    new DataView(over.buffer).setUint32(over.length - 12, 16, true);
    expect(only(file([over]))).toMatchObject({ code: 'nbytes' });
  });

  it('nbytes: a container holding fewer members than it declares', () => {
    expect(only(file([cellVar('c', [x(''), x('')], [1, 3])])).message).toContain('2 of the 3');
    const short = structVar('s', ['a', 'b'], [{ a: x(''), b: x('') }], [1, 2]);
    expect(only(file([short])).message).toContain('2 of the 4');
  });

  it('element: array flags, dimensions or a name of the wrong type', () => {
    expect(only(body([element(MI.INT32, new Uint8Array(8)), d11, varName('v'), one]))).toMatchObject({ code: 'element' });
    expect(only(body([flags, element(MI.UINT32, new Uint8Array(8)), varName('v'), one]))).toMatchObject({ code: 'element' });
    expect(only(body([flags, dims([3]), varName('v'), one]))).toMatchObject({ code: 'element' });
    expect(only(body([flags, dims([1, -1]), varName('v'), one]))).toMatchObject({ code: 'element' });
    expect(only(body([flags, d11, element(MI.UTF8, new TextEncoder().encode('v')), one]))).toMatchObject({ code: 'element' });
  });

  it('element: an array class MATLAB has none of', () => {
    for (const cls of [0, 18, 255]) {
      const f = new Uint8Array(16);
      f.set(arrayFlags(CLASS.DOUBLE));
      f[8] = cls;
      expect(only(body([f, d11, varName('v'), one])).message).toContain(`class is ${cls}`);
    }
  });

  it('element: a small tag declaring more than its 4 bytes', () => {
    const small = new Uint8Array(8);
    new DataView(small.buffer).setUint32(0, (5 << 16) | MI.DOUBLE, true);
    expect(only(body([flags, d11, varName('v'), small]))).toMatchObject({ code: 'element' });
    // MATLAB's own small tags read as they should.
    const tiny = new Uint8Array(8);
    new DataView(tiny.buffer).setUint32(0, (1 << 16) | MI.UINT8, true);
    tiny[4] = 7;
    const name = new Uint8Array(8);
    new DataView(name.buffer).setUint32(0, (2 << 16) | MI.INT8, true);
    name.set([0x61, 0x62], 4);
    expect(checkMatFile(body([flags, d11, name, tiny]))).toEqual([]);
  });

  it('element: a cell member, struct field or object part that is not a matrix', () => {
    expect(only(file([cellVar('c', [one])]))).toMatchObject({ code: 'element' });
    // Padded to 8, so the struct around it is a whole number of words, as a plain record is.
    const z = compressed(x(''));
    const member = concat([z, new Uint8Array((8 - (z.length % 8)) % 8)]);
    expect(only(file([structVar('s', ['a'], [{ a: member }])]))).toMatchObject({ code: 'element' });
  });

  it('element: a struct with field names and a field-name length of 0', () => {
    const s = matrix([arrayFlags(CLASS.STRUCT), d11, varName('s'), element(MI.INT32, new Uint8Array(4)), element(MI.INT8, new TextEncoder().encode('a'))]);
    expect(only(file([s]))).toMatchObject({ code: 'element' });
  });

  it('reads an opaque as MATLAB writes one: no dimensions, then two names and one matrix', () => {
    const name = (s: string) => element(MI.INT8, new TextEncoder().encode(s));
    const handle = numericVar({ name: '', cls: CLASS.UINT32, dimensions: [6, 1], real: [0xdd000000, 2, 1, 1, 1, 1] });
    const opaque = (parts: Uint8Array[]) => matrix([arrayFlags(CLASS.OPAQUE), varName('o'), ...parts]);
    expect(checkMatFile(file([opaque([name('MCOS'), name('string'), handle]), subsystem()], 1))).toEqual([]);
    expect(only(file([opaque([name('MCOS'), element(MI.INT8, new Uint8Array(0)), handle]), subsystem()], 1))).toMatchObject({ code: 'element' });
    expect(only(file([opaque([name('MCOS'), name('string')]), subsystem()], 1)).message).toContain('0 of the 1');
  });

  it('checks the subsystem\'s stream too, for no variable', () => {
    const found = checkMatFile(file([x(), compressed(subsystem([charVar('', 'abc', 18)]))], 1));
    expect(found).toEqual([expect.objectContaining({ code: 'char-type', at: 128 + x().length })]);
    expect(found[0].variable).toBeUndefined();
    expect(found[0].message).toContain('in the subsystem');
  });
});

describe('bounded, and never a throw', () => {
  it('budget: past the matrices it may walk, a note where it stopped and nothing after', () => {
    const c = cellVar('c', Array.from({ length: 10 }, () => x('')));
    const bad = charVar('t', 'abc', 18);
    expect(checkMatFile(file([c, bad]))).toEqual([expect.objectContaining({ code: 'char-type' })]);
    const found = checkMatFile(file([c, bad]), { maxElements: 5 });
    expect(found).toEqual([expect.objectContaining({ code: 'budget' })]);
    // At the member it stopped at, inside the cell's record, and before the char array.
    expect(found[0].at).toBeGreaterThan(128);
    expect(found[0].at).toBeLessThan(128 + c.length);
    expect(found[0].message).toContain('5 matrices');
  });

  it('budget: past the bytes it may inflate', () => {
    const big = compressed(numericVar({ name: 'z', cls: CLASS.DOUBLE, dimensions: [1, 4096], real: new Array(4096).fill(0) }));
    expect(checkMatFile(file([x(), big]))).toEqual([]);
    const found = checkMatFile(file([x(), big]), { maxInflatedBytes: 1000 });
    expect(found).toEqual([expect.objectContaining({ code: 'budget', at: 128 + x().length })]);
  });

  it('budget: past the nesting it reads', () => {
    let deep = x('');
    for (let i = 0; i < 200; i++) deep = cellVar('', [deep]);
    const top = cellVar('c', [deep]);
    expect(codes(file([top]))).toEqual(['budget']);
  });

  it('spends a member that is an empty matrix, so a billion of them stops', () => {
    const empties = cellVar('c', Array.from({ length: 1000 }, () => matrix([])));
    expect(checkMatFile(file([empties]))).toEqual([]);
    expect(codesOf(checkMatFile(file([empties]), { maxElements: 100 }))).toEqual(['budget']);
  });

  it('never throws on a file cut at any length', () => {
    for (const name of ['matlab-objects.mat', 'plain-uncompressed.mat', 'matlab-append-v6-onto-v7.mat']) {
      const whole = read(join(CORPUS, name));
      for (let n = 0; n <= whole.length; n++) {
        const found = checkMatFile(whole.subarray(0, n));
        expect(found.some((v) => v.message.includes('an error in the check itself'))).toBe(false);
        // A file of objects cut anywhere is broken: before its subsystem the header's offset
        // points past its end, and in it the subsystem's record is cut short. A file without
        // one is whole again when it is cut between two records.
        if (name === 'matlab-objects.mat' && n < whole.length) expect(found.length).toBeGreaterThan(0);
      }
    }
  });

  it('never throws on a file with any byte changed', () => {
    // A fixed seed, so a failure reproduces.
    let seed = 0x2f6b1d;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x80000000;
    };
    for (const name of ['plain-uncompressed.mat', 'objects-uncompressed.mat', 'matlab-plain.mat']) {
      const whole = read(join(CORPUS, name));
      for (let trial = 0; trial < 400; trial++) {
        const bytes = whole.slice();
        for (let k = 0; k < 1 + Math.floor(random() * 4); k++) {
          bytes[128 + Math.floor(random() * (bytes.length - 128))] = Math.floor(random() * 256);
        }
        const found = checkMatFile(bytes);
        expect(found.some((v) => v.message.includes('an error in the check itself'))).toBe(false);
      }
    }
  });
});

describe('violationsAdded: what a rewrite added', () => {
  const bad = (name: string) => charVar(name, 'abc', 18);

  it('matches by code and variable, wherever the record moved', () => {
    const before = checkMatFile(file([x(), bad('t')]));
    const after = checkMatFile(file([x('a_longer_name'), x('y'), compressed(bad('t'))]));
    expect(after[0].at).not.toBe(before[0].at);
    expect(violationsAdded(before, after)).toEqual([]);
    expect(violationsAdded(before, checkMatFile(file([x()])))).toEqual([]);
  });

  it('counts, and follows a rename', () => {
    const before = checkMatFile(file([x(), bad('t')]));
    const twice = checkMatFile(file([x(), bad('t'), x('y'), bad('u')]));
    expect(violationsAdded(before, twice)).toEqual([expect.objectContaining({ code: 'char-type', variable: 'u' })]);
    const renamed = checkMatFile(file([x(), bad('t2')]));
    expect(violationsAdded(before, renamed)).toHaveLength(1);
    expect(violationsAdded(before, renamed, new Map([['t2', 't']]))).toEqual([]);
  });

  it('always adds a budget note', () => {
    const c = cellVar('c', Array.from({ length: 10 }, () => x('')));
    const before = checkMatFile(file([c]), { maxElements: 5 });
    const after = checkMatFile(file([c]), { maxElements: 5 });
    expect(violationsAdded(before, after)).toEqual([expect.objectContaining({ code: 'budget' })]);
  });
});
