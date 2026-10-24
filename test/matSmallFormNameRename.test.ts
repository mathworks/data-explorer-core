// Copyright 2026 The MathWorks, Inc.
//
// A MAT-file variable whose name MATLAB wrote in the small element form, renamed and saved.
//
// MATLAB writes a name of 1 to 4 bytes as a small data element: one word holding its type and its
// byte count, then the bytes, padded to 8 (the MAT-file spec's "small data element format"). So
// every variable named `x`, `Kp` or `gain` in a file MATLAB wrote carries its name so. A rename
// writes the record as the element it was with only the name subelement replaced
// (MatWriter.elementNamed), which has to find where that subelement ends in either form. The
// synthesized test files are long-form only (test/tools/matBytes.ts), so the small form was never
// asked of the rename.
//
// Held here: such a variable renamed through the session and saved reopens as the same value
// under its new name, and every byte of its element but the name is the element it was read as,
// compressed again where it was; the name written is MATLAB's form for its length, small for 1
// to 4 bytes. And elementNamed hands back nothing for bytes that are not one whole miMATRIX
// element whose name it can find, which is what a rename is refused for (MatFileWriter.renameWhy).

import { describe, it, expect } from 'vitest';
import { unzlibSync, zlibSync } from 'fflate';
import { createSession } from '../src/index.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { elementNamed } from '../src/datamodel/parser/MatWriter.js';
import { arrayFlags, CLASS, dims, element, matFile, matrix, MI, numericData, u32le, varName } from './tools/matBytes.js';

/** A data element in the small form: type and byte count in one word, then the 1 to 4 bytes, padded. */
function smallElement(type: number, data: Uint8Array): Uint8Array {
  if (data.length < 1 || data.length > 4) throw new Error('smallElement: 1 to 4 bytes');
  const out = new Uint8Array(8);
  new DataView(out.buffer).setUint32(0, (data.length << 16) | type, true);
  out.set(data, 4);
  return out;
}

const text = (s: string) => new TextEncoder().encode(s);

/** A 1x3 double named `name` in the small form, as MATLAB writes a short name. */
const shortNamed = (name: string) => matrix([arrayFlags(CLASS.DOUBLE), dims([1, 3]), smallElement(MI.INT8, text(name)), numericData(MI.DOUBLE, [1.5, -2, 4])]);

/** `el` as a compressed record, as a `-v7` save writes every variable. */
const compressed = (el: Uint8Array) => {
  const z = zlibSync(el);
  const out = new Uint8Array(8 + z.length);
  out.set(u32le(MI.COMPRESSED), 0);
  out.set(u32le(z.length), 4);
  out.set(z, 8);
  return out;
};

const other = matrix([arrayFlags(CLASS.DOUBLE), dims([1, 1]), varName('other'), numericData(MI.DOUBLE, [7])]);

/** The element `record` holds, inflated where it was compressed. */
const elementOf = (record: { bytes: Uint8Array; compressed: boolean }) => (record.compressed ? unzlibSync(record.bytes.subarray(8)) : record.bytes.slice());

/** The miMATRIX element `el` with its name subelement, at byte 48 of a 1x3 double, cut out. */
const withoutName = (el: Uint8Array, nameLength: number) => [...el.subarray(8, 8 + 16 + 16), ...el.subarray(8 + 32 + nameLength)];

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

function renamedAndSaved(bytes: ArrayBuffer, from: string, to: string): Uint8Array {
  const session = createSession();
  const root: any = session.addMatSource('f.mat', bytes);
  const node = root.children.find((c: any) => c.name === from);
  expect(node, from).toBeDefined();
  session.setActive(root, node);
  expect(session.editProperty(node.id, 'Name', to)).toBe(true);
  const out = session.serializeSource('f.mat')!;
  return (out as { bytes: Uint8Array }).bytes;
}

describe('a variable whose name is in the small form, renamed and saved', () => {
  for (const [form, wrap] of [['uncompressed (-v6)', (e: Uint8Array) => e], ['compressed (-v7)', compressed]] as const) {
    describe(form, () => {
      const file = matFile([wrap(shortNamed('ab')), wrap(other)]);

      it('the file reads it under its small-form name', () => {
        expect(parseMat(file).variables.map((v) => [v.name, v.value])).toEqual([['ab', [1.5, -2, 4]], ['other', 7]]);
      });

      for (const to of ['speedGain', 'q', 'abcd', 'abcde']) {
        it(`renamed to ${to}, it reopens as the same value, its element the one it was but for its name, in the form MATLAB writes a name of ${to.length} bytes`, () => {
          const saved = renamedAndSaved(file, 'ab', to);
          const back = parseMat(saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer);
          expect(back.variables.map((v) => [v.name, v.value])).toEqual([[to, [1.5, -2, 4]], ['other', 7]]);
          const [renamed, kept] = back.records;
          expect(renamed.compressed).toBe(form.startsWith('compressed'));
          // The other record is its own bytes.
          expect(sameBytes(kept.bytes, parseMat(file).records[1].bytes)).toBe(true);
          const el = elementOf(renamed);
          const nameLength = to.length <= 4 ? 8 : 8 + to.length + ((8 - (to.length % 8)) % 8);
          expect(withoutName(el, nameLength)).toEqual(withoutName(shortNamed('ab'), 8));
          expect([...el.subarray(40, 40 + nameLength)]).toEqual([...(to.length <= 4 ? smallElement(MI.INT8, text(to)) : element(MI.INT8, text(to)))]);
        });
      }
    });
  }
});

describe('elementNamed of bytes that are not one whole miMATRIX element whose name it can find', () => {
  const whole = shortNamed('ab');
  const cases: Record<string, Uint8Array> = {
    'fewer than a tag': whole.subarray(0, 4),
    'another element type': element(MI.DOUBLE, new Uint8Array(8)),
    'cut short of its own size': whole.subarray(0, 24),
    'an element that ends before its name': matrix([arrayFlags(CLASS.DOUBLE), dims([1, 1])]),
    'an element holding only its flags': matrix([arrayFlags(CLASS.DOUBLE)]),
    'an empty miMATRIX': matrix([]),
  };
  for (const [what, bytes] of Object.entries(cases)) {
    it(`is null for ${what}`, () => {
      expect(elementNamed(bytes, 'x')).toBeNull();
    });
  }

  it('and is the element renamed for the whole one, in either name form', () => {
    for (const el of [whole, matrix([arrayFlags(CLASS.DOUBLE), dims([1, 3]), varName('ab'), numericData(MI.DOUBLE, [1.5, -2, 4])])]) {
      const named = elementNamed(el, 'renamed')!;
      expect(parseMat(matFile([named])).variables.map((v) => [v.name, v.value])).toEqual([['renamed', [1.5, -2, 4]]]);
    }
  });
});
