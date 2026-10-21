// Copyright 2026 The MathWorks, Inc.
//
// McosStreamEdit: a dictionary value's MAT stream split where a save rewrites it (the value, then
// the subsystem, then nothing), put back together with a new subsystem, re-encoded as hex with an
// EncodedLength that is its byte count, and the subsystem a save wrote held to the one it read
// with only the planned cells changed. On MATLAB's own streams (fixtures/sldd-stream-objects); the
// edits through the session are slddStreamObjects.test.ts's.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { mcosStreamParts, rewrittenHex, streamWithSubsystem } from '../src/datamodel/parser/McosStreamEdit.js';
import { subsystemCellsDiffer } from '../src/datamodel/parser/MatFileWriter.js';
import { editMcosSubsystem, readMcosSubsystem, storedProperties, valueCellOf, objectIdOf, type McosSubsystem } from '../src/datamodel/parser/McosSubsystemEdit.js';
import { decodeMatStream, type MatVariable } from '../src/datamodel/parser/MatParser.js';
import { encodedBytes, type EncodedValue } from '../src/datamodel/parser/EncodedValue.js';

const BINARY = new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/sldd-stream-objects/stream_objects_binary.sldd', import.meta.url))));
const CHUNK = new TextDecoder().decode(unzipSync(BINARY)['data/chunk0.xml']);

/** An entry's hex Value, as the reader holds one, and its bytes. */
function hexValueOf(name: string): { encoded: EncodedValue; bytes: Uint8Array } {
  const at = CHUNK.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  const m = /<P Name="Value" Class="([^"]*)" Encoding="hex" EncodedLength="(\d+)">([^<]*)<\/P>/.exec(CHUNK.slice(at));
  const encoded: EncodedValue = { _type: 'encoded', _attrs: { Class: m![1], Encoding: 'hex', EncodedLength: m![2] }, _value: m![3] };
  return { encoded, bytes: encodedBytes(encoded).bytes! };
}

const double = (x: number): MatVariable => ({ name: '', className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value: x, fields: null });

// sPh's p, its Value cell swapped for 7: the subsystem a save writes for `sPh.p.Value = 7`.
function sPhValueSeven(): { bytes: Uint8Array; valueEnd: number; original: Uint8Array; element: Uint8Array; cellIndex: number; objectId: number } {
  const { bytes } = hexValueOf('sPh');
  const parts = mcosStreamParts(bytes) as { ok: true; valueEnd: number; subsystem: Uint8Array };
  const variable = decodeMatStream(bytes).ok ? (decodeMatStream(bytes) as { variable: MatVariable }).variable : null;
  const p = (variable!.fields as Record<string, MatVariable>).p;
  const objectId = objectIdOf(p.mcosHandle, 0)!;
  const stored = storedProperties(parts.subsystem, objectId) as { ok: true; properties: { savedName: string; cellIndex: number | null }[] };
  const cellIndex = stored.properties.find((x) => x.savedName === 'Value')!.cellIndex!;
  const edited = editMcosSubsystem(parts.subsystem, objectId, [{ savedName: 'Value', cell: valueCellOf(double(7)) }]);
  expect(edited.ok).toBe(true);
  return { bytes, valueEnd: parts.valueEnd, original: parts.subsystem, element: (edited as { bytes: Uint8Array }).bytes, cellIndex, objectId };
}

describe('mcosStreamParts', () => {
  it('splits each of MATLAB\'s streams into its value and its subsystem, which ends it', () => {
    for (const name of ['arr', 'cPh', 'nested', 'pSp', 'pStruct', 'sPh', 'sTh', 'shared', 'sigH']) {
      const { bytes } = hexValueOf(name);
      const parts = mcosStreamParts(bytes);
      expect(parts.ok, name).toBe(true);
      const { valueEnd, subsystem } = parts as { valueEnd: number; subsystem: Uint8Array };
      expect(valueEnd + subsystem.length).toBe(bytes.length);
      expect(readMcosSubsystem(subsystem).ok, name).toBe(true);
    }
  });

  it('refuses a stream with nothing after its value, more after its subsystem, or no array there', () => {
    const { bytes } = hexValueOf('sPh');
    const { valueEnd } = mcosStreamParts(bytes) as { valueEnd: number };
    expect(mcosStreamParts(bytes.slice(0, valueEnd))).toEqual({ ok: false, message: 'it holds no objects after its value' });
    const longer = new Uint8Array(bytes.length + 8);
    longer.set(bytes);
    longer.set([14, 0, 0, 0, 0, 0, 0, 0], bytes.length);
    expect(mcosStreamParts(longer)).toEqual({ ok: false, message: 'it holds more after its objects, which a save would not write' });
    const notArray = bytes.slice();
    notArray[valueEnd] = 2;
    expect(mcosStreamParts(notArray)).toEqual({ ok: false, message: 'the element after its value is not an array' });
    expect(mcosStreamParts(bytes.slice(0, bytes.length - 8)).ok).toBe(false);
  });
});

describe('a stream put back together, and its hex', () => {
  it('is the value as it was and the new subsystem, which decodes whole', () => {
    const { bytes, valueEnd, element } = sPhValueSeven();
    const out = streamWithSubsystem(bytes, valueEnd, element);
    expect(out.length).toBe(valueEnd + element.length);
    expect(Array.from(out.subarray(0, valueEnd))).toEqual(Array.from(bytes.subarray(0, valueEnd)));
    const decoded = decodeMatStream(out, { whole: true });
    expect(decoded.ok && decoded.trailingElements.length).toBe(1);
  });

  it('as hex keeps the attributes as read, in their order, with EncodedLength its byte count, in MATLAB\'s layout', () => {
    const { encoded } = hexValueOf('sPh');
    const { bytes, valueEnd, element } = sPhValueSeven();
    const out = streamWithSubsystem(bytes, valueEnd, element);
    const hex = rewrittenHex(encoded, out, 2);
    expect(Object.keys(hex._attrs)).toEqual(['Class', 'Encoding', 'EncodedLength']);
    expect(hex._attrs).toEqual({ Class: 'struct', Encoding: 'hex', EncodedLength: String(out.length) });
    expect(Array.from(encodedBytes(hex).bytes!)).toEqual(Array.from(out));
    expect(hex._value).toMatch(/^(?:\n {16}[0-9A-F]{128})*\n {16}[0-9A-F]{2,128}$/);
    // The stream as it was, written so, is the text MATLAB wrote.
    expect(rewrittenHex(encoded, bytes, 2)).toEqual(encoded);
  });
});

describe('subsystemCellsDiffer', () => {
  it('finds nothing in a subsystem with the planned cell written', () => {
    const { original, element, cellIndex, objectId } = sPhValueSeven();
    expect(subsystemCellsDiffer(original, element, [{ objectId, cellIndex, savedName: 'Value', value: double(7) }], 'its objects')).toBeNull();
    expect(subsystemCellsDiffer(original, original, [], 'its objects')).toBeNull();
  });

  it('finds a cell written that reads as another value than planned', () => {
    const { original, element, cellIndex, objectId } = sPhValueSeven();
    expect(subsystemCellsDiffer(original, element, [{ objectId, cellIndex, savedName: 'Value', value: double(8) }], 'its objects')).toMatch(/Value/);
  });

  it('finds a cell changed that no edit planned', () => {
    const { original, element } = sPhValueSeven();
    expect(subsystemCellsDiffer(original, element, [], 'its objects')).toMatch(/^its objects read back with value cell \d+, which no edit wrote, changed$/);
  });

  it('finds a subsystem that does not read', () => {
    const { original } = sPhValueSeven();
    expect(subsystemCellsDiffer(original, original.slice(0, original.length - 8), [], 'its objects')).toMatch(/^its objects do not read back as a subsystem/);
  });
});

// The subsystem a save writes for sPh.p.Value = 7 with one byte changed where the rewrite copies the
// bytes it read (McosSubsystemEdit.rebuild): each still reads whole as a subsystem, so only the
// comparison of what was copied can find it.
describe('subsystemCellsDiffer, of every byte the rewrite copies around the cells', () => {
  const layersOf = (bytes: Uint8Array): McosSubsystem => (readMcosSubsystem(bytes) as { ok: true; subsystem: McosSubsystem }).subsystem;
  const planned = () => {
    const { original, element, cellIndex, objectId } = sPhValueSeven();
    return { original, element, cells: [{ objectId, cellIndex, savedName: 'Value', value: double(7) }] };
  };
  const changedAt = (bytes: Uint8Array, at: number, to: number): Uint8Array => {
    const out = bytes.slice();
    expect(out[at]).not.toBe(to);
    out[at] = to;
    return out;
  };
  // Where in the subsystem written each copied range is, and a byte of it to change: a word of a
  // flags sub-element no reader asks (its second, the nonzero count), or the type of a name, a type
  // or a class, which the reader compares by its bytes and not by its type.
  const ranges: [string, (s: McosSubsystem) => number, number][] = [
    ['the flags of their element', (s) => s.outer.subs[0].data + 4, 0xab],
    ['the name of their element', (s) => s.outer.subs[2].at, 2],
    ['the preamble of their payload', (s) => s.outer.subs[3].data + 4, 0xab],
    ['the flags of their struct', (s) => s.struct.subs[0].data + 4, 0xab],
    ['the name of their struct', (s) => s.struct.subs[2].at, 2],
    ['the flags of their FileWrapper__', (s) => s.opaque.subs[0].data + 4, 0xab],
    ['the name of their FileWrapper__', (s) => s.opaque.subs[1].at, 2],
    ['the type of their FileWrapper__', (s) => s.opaque.subs[2].at, 2],
    ['the class of their FileWrapper__', (s) => s.opaque.subs[3].at, 2],
    ['the flags of their cell array', (s) => s.cellArray.subs[0].data + 4, 0xab],
    ['the name of their cell array', (s) => s.cellArray.subs[2].at, 2],
    ['the bytes after their struct', (s) => s.struct.end + 100, 0xab],
  ];
  for (const [what, at, to] of ranges) {
    it(what, () => {
      const { original, element, cells } = planned();
      const tampered = changedAt(element, at(layersOf(element)), to);
      expect(readMcosSubsystem(tampered).ok).toBe(true);
      expect(subsystemCellsDiffer(original, tampered, cells, 'its objects')).toBe('its objects read back with ' + what + ', which no edit wrote, changed');
    });
  }

  it("the dims of their cell array, [N 1] said as [1 N], which declares as many cells", () => {
    const { original, element, cells } = planned();
    const dims = layersOf(element).cellArray.subs[1];
    const tampered = element.slice();
    const view = new DataView(tampered.buffer);
    const [rows, columns] = [view.getInt32(dims.data, true), view.getInt32(dims.data + 4, true)];
    expect(columns).toBe(1);
    view.setInt32(dims.data, columns, true);
    view.setInt32(dims.data + 4, rows, true);
    expect(readMcosSubsystem(tampered).ok).toBe(true);
    expect(subsystemCellsDiffer(original, tampered, cells, 'its objects')).toBe('its objects read back with the dims of their cell array, which no edit wrote, changed');
  });

  it('the bytes after their struct, eight fewer of them', () => {
    const { original, element, cells } = planned();
    const s = layersOf(element);
    const data = s.outer.subs[3];
    const payload = element.subarray(data.data, data.data + data.bytes - 8);
    // The element framed again around the shorter payload: its dims [1 N], its tag, its padding.
    const n = payload.length;
    const body = new Uint8Array(16 + 16 + 8 + 8 + n + ((8 - (n % 8)) % 8));
    const view = new DataView(body.buffer);
    body.set(element.subarray(s.outer.subs[0].at, s.outer.subs[0].end), 0);
    view.setUint32(16, 5, true);
    view.setUint32(20, 8, true);
    view.setInt32(24, 1, true);
    view.setInt32(28, n, true);
    body.set(element.subarray(s.outer.subs[2].at, s.outer.subs[2].end), 32);
    view.setUint32(40, 2, true);
    view.setUint32(44, n, true);
    body.set(payload, 48);
    const tampered = new Uint8Array(8 + body.length);
    new DataView(tampered.buffer).setUint32(0, 14, true);
    new DataView(tampered.buffer).setUint32(4, body.length, true);
    tampered.set(body, 8);
    expect(readMcosSubsystem(tampered).ok).toBe(true);
    expect(subsystemCellsDiffer(original, tampered, cells, 'its objects')).toBe('its objects read back with the bytes after their struct, which no edit wrote, changed');
  });

  it('a cell said written that is no value cell, or one said written twice', () => {
    const { original, element, cells } = planned();
    const valueCells = layersOf(original).valueCells;
    for (const cellIndex of [0, 1, 2 + valueCells, 2 + valueCells + 2, 1.5]) {
      expect(subsystemCellsDiffer(original, element, [...cells, { ...cells[0], cellIndex }], 'its objects')).toBe(
        'its objects were written with cell ' + cellIndex + ', which is not one of their ' + valueCells + ' value cells',
      );
    }
    expect(subsystemCellsDiffer(original, element, [cells[0], { ...cells[0] }], 'its objects')).toBe(
      'its objects were written with value cell ' + cells[0].cellIndex + ' twice',
    );
  });
});
