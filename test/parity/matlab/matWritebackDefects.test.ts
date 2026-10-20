// Copyright 2026 The MathWorks, Inc.
//
// Two defects of the MAT-file save that the live gate (probe_mat_writeback.{mjs,m}) found, held
// here without MATLAB so that they stay in sight on every run until they are fixed. Neither is
// visible to core: its reader carries neither thing either, so the save's own re-parse
// (MatFileWriter's self-check) agrees with what it wrote, and the strict checker breaks no load
// rule. Only MATLAB, loading the save beside the original, reads a different value.
//
// Each test states the defect AS IT IS: the bytes the save writes today, beside the bytes
// MATLAB's own element holds. A fix makes it fail; it should then assert the bytes MATLAB
// wrote, and the gate's three failing cases (fresh_dispcat, sibling_struct_field,
// sibling_cell_member) pass.
//
// Measured against MATLAB R2027a (27.1.0.3409468):
//   A. complex(zeros(0,0)) and the other complex empties of dispcat.mat, written fresh, load
//      real: isreal is true where the original's is false.
//   B. a 0x0 or 1x0 struct array with a field `a`, written fresh, loads with no field:
//      fieldnames is {} where the original's is {'a'}. A struct field or a cell member edited
//      beside one writes it fresh, so an ordinary edit loses the names.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { unzlibSync } from 'fflate';
import { parseMat } from '../../../src/datamodel/parser/MatParser.js';
import { createSession } from '../../../src/index.js';
import { CLASS, matFile, numericVar, structVar } from '../../tools/matBytes.js';

const arrayBufferOf = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const DISPCAT = arrayBufferOf(new Uint8Array(readFileSync(new URL('../../fixtures/display/dispcat.mat', import.meta.url))));

/** The miMATRIX element (tag and body) of the top-level variable `name`, inflated. */
function elementOf(file: Uint8Array | ArrayBuffer, name: string): Uint8Array {
  const rec = parseMat(file instanceof Uint8Array ? arrayBufferOf(file) : file).records.find((r) => r.name === name)!;
  const view = new DataView(rec.bytes.buffer, rec.bytes.byteOffset, rec.bytes.byteLength);
  return view.getUint32(0, true) === 15 ? unzlibSync(rec.bytes.subarray(8, 8 + view.getUint32(4, true))) : rec.bytes;
}

/** The sub-elements of an miMATRIX element, in order: each one's type and data. */
function subElementsOf(el: Uint8Array): { type: number; data: Uint8Array }[] {
  const view = new DataView(el.buffer, el.byteOffset, el.byteLength);
  const out: { type: number; data: Uint8Array }[] = [];
  const end = 8 + view.getUint32(4, true);
  for (let at = 8; at < end; ) {
    const word = view.getUint32(at, true);
    if (word >>> 16) {
      out.push({ type: word & 0xffff, data: el.subarray(at + 4, at + 4 + (word >>> 16)) });
      at += 8;
    } else {
      const n = view.getUint32(at + 4, true);
      out.push({ type: word, data: el.subarray(at + 8, at + 8 + n) });
      at += 8 + Math.ceil(n / 8) * 8;
    }
  }
  return out;
}

/** A struct element's field names, read from its own field-name table. */
function fieldNamesOf(el: Uint8Array): string[] {
  const [, , , length, names] = subElementsOf(el);
  const len = new DataView(length.data.buffer, length.data.byteOffset, 4).getInt32(0, true);
  const out: string[] = [];
  for (let at = 0; at < names.data.byteLength; at += len) {
    out.push(new TextDecoder().decode(names.data.subarray(at, at + len)).replace(/\0+$/, ''));
  }
  return out;
}

/** The element of a struct's `index`th field (of its first element), with its own tag. */
function fieldElement(structElement: Uint8Array, index: number): Uint8Array {
  const { type, data } = subElementsOf(structElement)[5 + index];
  expect(type).toBe(14);
  const out = new Uint8Array(8 + data.byteLength);
  out.set(new Uint8Array(new Uint32Array([14, data.byteLength]).buffer));
  out.set(data, 8);
  return out;
}

/** An element's complex bit: byte 1 of its array-flags data. */
const complexOf = (el: Uint8Array) => (subElementsOf(el)[0].data[1] & 0x08) !== 0;

describe('KNOWN DEFECTS of the MAT-file save, found by the live gate', () => {
  it('A: a complex empty, its node marked edited, is written real', () => {
    const session = createSession();
    const root: any = session.addMatSource('dispcat.mat', DISPCAT);
    const node = root.children.find((c: any) => c.name === 'dx_complex_0x0');
    expect(complexOf(elementOf(DISPCAT, 'dx_complex_0x0'))).toBe(true);
    // The state an edit leaves the node in (DataNode._valueEdited, MatlabVariableNode's stale
    // _var), which MatFileWriter writes fresh. The node rebuilds its variable from its
    // elements, and an empty has none to be complex: _isComplexValue() is false, so the
    // variable's isComplex is, though _elementType still says 'complex' (the Class column
    // reads that, and says complex).
    node._markModified();
    expect(node._var.isComplex).toBe(false);
    const saved = (session.serializeSource('dispcat.mat') as { bytes: Uint8Array }).bytes;
    expect(complexOf(elementOf(saved, 'dx_complex_0x0'))).toBe(false);
  });

  it('B: an empty struct array with a field, written fresh beside an edited field, keeps no field name', () => {
    // MATLAB's own element first, so that the reader below is seen to read names at all.
    expect(fieldNamesOf(elementOf(DISPCAT, 'dx_struct_0x0_fields'))).toEqual(['a']);

    const empty = structVar('', ['inner'], [], [0, 0]);
    const x = numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [1] });
    const file = matFile([structVar('s', ['es', 'x'], [{ es: empty, x }])]);
    const session = createSession();
    const root: any = session.addMatSource('f.mat', file);
    const field = root.children[0].children.find((c: any) => c.name === 'x');
    session.setActive(root, field);
    expect(session.editProperty(field.id, 'Value', '2')).toBe(true);
    const saved = (session.serializeSource('f.mat') as { bytes: Uint8Array }).bytes;

    // es as the file holds it, and as the save writes it: a 0x0 struct both times, whose
    // field-name table the save leaves empty. The reader holds `fields: {}` for an empty struct
    // array, its names dropped, and the writer writes what the reader holds.
    const esOf = (file_: Uint8Array | ArrayBuffer) => {
      const s = elementOf(file_, 's');
      expect(fieldNamesOf(s)).toEqual(['es', 'x']);
      return fieldElement(s, 0);
    };
    expect([fieldNamesOf(esOf(file)), subElementsOf(esOf(file))[1].data]).toEqual([['inner'], new Uint8Array(8)]);
    expect([fieldNamesOf(esOf(saved)), subElementsOf(esOf(saved))[1].data]).toEqual([[], new Uint8Array(8)]);
  });
});
