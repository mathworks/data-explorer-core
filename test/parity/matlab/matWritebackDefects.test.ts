// Copyright 2026 The MathWorks, Inc.
//
// Two losses of the MAT-file save that the live gate (probe_mat_writeback.{mjs,m}) found, held
// here without MATLAB, fixed. Neither was visible to core: its reader carried neither thing
// either, so the save's own re-parse (MatFileWriter's self-check) agreed with what it wrote, and
// the strict checker broke no load rule. Only MATLAB, loading the save beside the original, read
// a different value. test/matFreshFidelity.test.ts now holds every variable of every fixture to
// the file's own element, by a walker that does not use the package's reader.
//
// Measured against MATLAB R2027a (27.1.0.3409468), before the fix:
//   A. complex(zeros(0,0)) and the other complex empties of dispcat.mat, written fresh, loaded
//      real: isreal was true where the original's is false. The node rebuilt its variable from
//      its elements, and an empty has none to be complex (MatlabVariableNode._isComplexValue).
//   B. a 0x0 or 1x0 struct array with a field `a`, written fresh, loaded with no field:
//      fieldnames was {} where the original's is {'a'}. The reader held `fields: {}` for a
//      struct array of no element (MatParser), and a struct field or a cell member edited
//      beside one wrote it fresh, so an ordinary edit lost the names.
// Each test asks for MATLAB's own element: what the save writes for each is the element MATLAB
// wrote, byte for byte but for the storage type of an empty double's two parts (MATLAB's
// miUINT8, MatWriter's miDOUBLE, which MATLAB loads as the same complex empty: the gate's
// sibling cases).
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

describe('the losses of the MAT-file save the live gate found, fixed', () => {
  it('A: a complex empty, its node marked edited, is written complex', () => {
    const session = createSession();
    const root: any = session.addMatSource('dispcat.mat', DISPCAT);
    const names = ['dx_complex_0x0', 'dx_complex_1x0', 'dx_complex_int16_1x0', 'e_single_complex_1x0'];
    // The state an edit leaves a node in (DataNode._valueEdited, MatlabVariableNode's stale
    // _var), which MatFileWriter writes fresh.
    for (const name of names) {
      const node = root.children.find((c: any) => c.name === name);
      expect(complexOf(elementOf(DISPCAT, name)), name).toBe(true);
      node._markModified();
      expect([name, node._var.isComplex, node._classColumn()]).toEqual([name, true, expect.stringContaining('(complex)')]);
    }
    const saved = (session.serializeSource('dispcat.mat') as { bytes: Uint8Array }).bytes;
    for (const name of names) {
      // Its class, flags, dims and name as MATLAB wrote them, and its two parts, empty.
      const [was, is] = [subElementsOf(elementOf(DISPCAT, name)), subElementsOf(elementOf(saved, name))];
      expect(is.slice(0, 3), name).toEqual(was.slice(0, 3));
      expect(is.slice(3).map((p) => p.data.byteLength), name).toEqual([0, 0]);
      expect(complexOf(elementOf(saved, name)), name).toBe(true);
    }
    // The int16 and the single ones are MATLAB's bytes exactly: MATLAB stores their parts in their
    // own class's type, as MatWriter does.
    for (const name of ['dx_complex_int16_1x0', 'e_single_complex_1x0']) {
      expect(elementOf(saved, name), name).toEqual(elementOf(DISPCAT, name));
    }
  });

  it("B: an empty struct array with a field, written fresh, keeps its field names, as MATLAB's own element has them", () => {
    // Written fresh itself: MATLAB's own element, byte for byte.
    const session = createSession();
    const root: any = session.addMatSource('dispcat.mat', DISPCAT);
    for (const name of ['dx_struct_0x0_fields', 'dx_struct_1x0']) {
      root.children.find((c: any) => c.name === name)._markModified();
    }
    const fresh = (session.serializeSource('dispcat.mat') as { bytes: Uint8Array }).bytes;
    for (const name of ['dx_struct_0x0_fields', 'dx_struct_1x0']) {
      expect(fieldNamesOf(elementOf(DISPCAT, name)), name).toEqual(['a']);
      expect(elementOf(fresh, name), name).toEqual(elementOf(DISPCAT, name));
    }

    // And written fresh beside an edited field, as the gate's sibling_struct_field case writes it.
    const empty = structVar('', ['inner'], [], [0, 0]);
    const x = numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [1] });
    const file = matFile([structVar('s', ['es', 'x'], [{ es: empty, x }])]);
    const edited = createSession();
    const top: any = edited.addMatSource('f.mat', file);
    const field = top.children[0].children.find((c: any) => c.name === 'x');
    edited.setActive(top, field);
    expect(edited.editProperty(field.id, 'Value', '2')).toBe(true);
    const saved = (edited.serializeSource('f.mat') as { bytes: Uint8Array }).bytes;

    // es as the file holds it, and as the save writes it: a 0x0 struct with the field `inner`
    // both times.
    const esOf = (file_: Uint8Array | ArrayBuffer) => {
      const s = elementOf(file_, 's');
      expect(fieldNamesOf(s)).toEqual(['es', 'x']);
      return fieldElement(s, 0);
    };
    expect([fieldNamesOf(esOf(file)), subElementsOf(esOf(file))[1].data]).toEqual([['inner'], new Uint8Array(8)]);
    expect([fieldNamesOf(esOf(saved)), subElementsOf(esOf(saved))[1].data]).toEqual([['inner'], new Uint8Array(8)]);
    // And the reader reads the names back, as it reads them out of the file.
    const es = parseMat(arrayBufferOf(saved)).variables[0].fields!.es as { fields: Record<string, unknown> };
    expect(Object.keys(es.fields)).toEqual(['inner']);
  });
});
