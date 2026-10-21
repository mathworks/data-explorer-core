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
import { editMcosSubsystem, readMcosSubsystem, storedProperties, valueCellOf, objectIdOf } from '../src/datamodel/parser/McosSubsystemEdit.js';
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
