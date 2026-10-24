// Copyright 2026 The MathWorks, Inc.
//
// violationsAddedBySplice, asked directly, where the short way (checking only what a save
// changed) is not the answer and the long way (both files whole) is, or where it cannot tell:
//
//   * a record kept as its own bytes that `renamed` names: violationsAdded would compare its
//     violations under the other name, so both files are checked whole, and the answer is the
//     whole-file one;
//   * a record kept whose name the budget does not reach: where it stands cannot be judged, so the
//     written side holds a `budget` note, which is always added, as the whole-file check's is;
//   * a written file that says it keeps a record the read one does not have: a plan this package
//     did not make, refused with a RangeError rather than answered.
//
// test/matSpliceVerdict.test.ts holds every save's verdict to the whole-file one over every
// fixture; these are the cases no save of a fixture reaches.

import { describe, it, expect } from 'vitest';
import { zlibSync } from 'fflate';
import { checkMatFile, violationsAdded, violationsAddedBySplice } from '../src/datamodel/parser/MatFileCheck.js';
import type { MatFileOfRecords, MatReadRecord, MatSplicedRecord } from '../src/datamodel/parser/MatFileCheck.js';
import { CLASS, MI, charVar, matFile, numericVar, u32le } from './tools/matBytes.js';

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const compressed = (el: Uint8Array): Uint8Array => {
  const z = zlibSync(el);
  return concat([u32le(MI.COMPRESSED), u32le(z.length), z]);
};
const x = (name: string, real = [1, 2, 3]): Uint8Array => numericVar({ name, cls: CLASS.DOUBLE, dimensions: [1, real.length], real });
const HEADER = new Uint8Array(matFile([])).slice(0, 128);

const readOf = (records: Uint8Array[]): MatFileOfRecords<MatReadRecord> => ({ header: HEADER, records: records.map((bytes) => ({ bytes })) });
const whole = (read: MatFileOfRecords<MatReadRecord>, written: MatFileOfRecords<MatSplicedRecord>, renamed: ReadonlyMap<string, string>, options = {}) =>
  violationsAdded(
    checkMatFile(concat([read.header, ...read.records.map((r) => r.bytes)]), options),
    checkMatFile(concat([written.header, ...written.records.map((r) => ('kept' in r ? read.records[r.kept].bytes : r.written))]), options),
    renamed,
  );
const keyed = (found: { code: string; variable?: string }[]) => found.map((v) => v.code + ' ' + (v.variable ?? '')).sort();

describe('violationsAddedBySplice takes the long way', () => {
  it('where a kept record holds a name `renamed` maps, and answers as the whole-file check does', () => {
    // `t` is kept as its bytes, and breaks char-type in both files; `renamed` says the written
    // file's `t` is the read file's `u`, a variable the read file holds clean. Compared under
    // that name, as violationsAdded compares it, `t`'s violation is one the read file did not
    // have at `u`: added. The short way would have cancelled it against itself.
    const t = charVar('t', 'abc', 18);
    const u = x('u');
    const read = readOf([t, u]);
    const written: MatFileOfRecords<MatSplicedRecord> = { header: HEADER, records: [{ kept: 0 }, { written: x('v'), replaces: 1 }] };
    const renamed = new Map([['t', 'u']]);
    const answer = violationsAddedBySplice(read, written, renamed);
    expect(keyed(answer)).toEqual(keyed(whole(read, written, renamed)));
    expect(keyed(answer)).toEqual(['char-type t']);
  });

  it('where one header is read past and the other is not, and answers as the whole-file check does', () => {
    // A read file whose header declares big-endian bytes: checkMatFile notes it and reads no
    // record. Written with a header this package reads past, the record it kept is checked for
    // the first time, and what it breaks is added.
    const bigEndian = HEADER.slice();
    bigEndian.set([0x01, 0x00, 0x4d, 0x49], 124);
    const t = charVar('t', 'abc', 18);
    const read: MatFileOfRecords<MatReadRecord> = { header: bigEndian, records: [{ bytes: t }] };
    const written: MatFileOfRecords<MatSplicedRecord> = { header: HEADER, records: [{ kept: 0 }] };
    const answer = violationsAddedBySplice(read, written);
    expect(keyed(answer)).toEqual(keyed(whole(read, written, new Map())));
    expect(keyed(answer)).toEqual(['char-type t']);
    // And the other way round: nothing past the written header is read, so nothing is added but
    // what the header itself says.
    const back = violationsAddedBySplice({ header: HEADER, records: [{ bytes: t }] }, { header: bigEndian, records: [{ kept: 0 }] });
    expect(keyed(back)).toEqual(keyed(whole({ header: HEADER, records: [{ bytes: t }] }, { header: bigEndian, records: [{ kept: 0 }] }, new Map())));
    expect(back.map((v) => v.code)).toEqual(['big-endian']);
  });

  it('and, renaming nothing kept, cancels what a kept record breaks in both', () => {
    const t = charVar('t', 'abc', 18);
    const read = readOf([t, x('u')]);
    const written: MatFileOfRecords<MatSplicedRecord> = { header: HEADER, records: [{ kept: 0 }, { written: x('v'), replaces: 1 }] };
    const renamed = new Map([['v', 'u']]);
    expect(violationsAddedBySplice(read, written, renamed)).toEqual([]);
    expect(whole(read, written, renamed)).toEqual([]);
  });
});

describe('violationsAddedBySplice past its budget', () => {
  it('notes a kept record whose name it cannot inflate within the budget, where it now stands', () => {
    // A compressed record of 4096 doubles, kept, and nothing the caller inflated for it: its
    // name is read by inflating it, past 1000 bytes.
    const big = compressed(x('z', new Array(4096).fill(0)));
    const read = readOf([x('a'), big]);
    const written: MatFileOfRecords<MatSplicedRecord> = { header: HEADER, records: [{ written: x('b'), replaces: 0 }, { kept: 1 }] };
    const options = { maxInflatedBytes: 1000 };
    const answer = violationsAddedBySplice(read, written, new Map([['b', 'a']]), options);
    expect(answer).toHaveLength(1);
    expect(answer[0]).toMatchObject({ code: 'budget', at: 128 + x('b').length });
    expect(answer[0].message).toMatch(/^The check stopped at byte \d+, at more than the 1000 bytes one check inflates, so nothing from there on was checked\.$/);
    // The whole-file check stops at the same record, and says so too.
    expect(keyed(whole(read, written, new Map([['b', 'a']]), options))).toEqual(['budget ']);
    // Within the budget, there is nothing to say.
    expect(violationsAddedBySplice(read, written, new Map([['b', 'a']]))).toEqual([]);
  });

  it('reads a kept record\'s name out of what the caller inflated for it, spending nothing', () => {
    const el = x('z', new Array(4096).fill(0));
    const big = compressed(el);
    const read: MatFileOfRecords<MatReadRecord> = { header: HEADER, records: [{ bytes: x('a') }, { bytes: big, inflated: el }] };
    const written: MatFileOfRecords<MatSplicedRecord> = { header: HEADER, records: [{ written: x('b'), replaces: 0 }, { kept: 1 }] };
    expect(violationsAddedBySplice(read, written, new Map([['b', 'a']]), { maxInflatedBytes: 1000 })).toEqual([]);
  });
});

describe('violationsAddedBySplice refuses a plan it was not given', () => {
  it('throws a RangeError for a record kept that the read file does not have', () => {
    const read = readOf([x('a')]);
    const written: MatFileOfRecords<MatSplicedRecord> = { header: HEADER, records: [{ kept: 0 }, { kept: 3 }] };
    expect(() => violationsAddedBySplice(read, written)).toThrow(new RangeError('A record kept as record 3 of a file of 1.'));
  });
});
