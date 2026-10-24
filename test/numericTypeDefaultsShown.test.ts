// Copyright 2026 The MathWorks, Inc.
//
// What MATLAB reads of a Simulink.NumericType property a dictionary does not hold, shown in its
// row (mcosShown.withDefaultsShown). A binary dictionary System Composer wrote (arch_binary.sldd)
// holds its NumericType's DataTypeMode and IsAlias alone, and its rows showed nothing for its
// Signedness, WordLength, FractionLength, Slope, Bias, DataTypeOverride and DataScope, where its
// text twin (arch.sldd), which holds every one, showed them. And a hand-written one stating its
// FractionLength and no FixedExponent (typeLink.sldd) showed no Slope.
//
// MATLAB R2027a's view, measured on 2026-10-24 through the dictionary API: arch_binary.sldd's own
// data part, opened in a container MATLAB made (the fixture's own has no [Content_Types].xml, which
// MATLAB refuses), reads as Simulink.NumericType with nothing set reads; typeLink.sldd's ntFix16 as
// FixedExponent -3, Slope 0.125. Display only: what the dictionary holds, and so what a save
// writes and a copy carries, is not changed.
import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { bufferOf, fixture, rowsOf, sameBytes } from './tools/matPaste.js';

type Any = any;

// What MATLAB R2027a shows of Simulink.NumericType with nothing set, and of arch_binary.sldd's
// NumericType: the two are the same, every property.
const MATLAB_SHOWS: Record<string, string> = {
  dataTypeMode: 'Double',
  signedness: 'Signed',
  wordLength: '64',
  fractionLength: '0',
  slope: '1',
  bias: '0',
  dataTypeOverride: 'Inherit',
  isAlias: 'false',
  dataScope: 'Auto',
  headerFile: '',
};

function opened(path: string) {
  const session = createSession();
  const root: Any = ingest(session, bufferOf(fixture(path)), { filename: path.split('/').pop()! });
  const entry = (name: string): Any => root.children.flatMap((s: Any) => s.children).find((e: Any) => e.name === name);
  return { session, root, entry };
}

const shownOf = (node: Any): Record<string, string> => Object.fromEntries(rowsOf(node).map((r) => [r.slice(0, r.indexOf(' = ')), r.slice(r.indexOf(' = ') + 3)]));
const rowsShown = (node: Any) => Object.fromEntries(Object.keys(MATLAB_SHOWS).map((k) => [k, shownOf(node)[k]]));

describe("a NumericType's rows, of a property its dictionary does not hold", () => {
  it("show what MATLAB reads of it: System Composer's binary dictionary, as its text twin and as MATLAB", () => {
    const binary = opened('test/fixtures/arch_binary.sldd').entry('NumericType');
    expect(Object.keys(binary.serial._properties).sort()).toEqual(['DataTypeMode', 'IsAlias']);
    expect(rowsShown(binary)).toEqual(MATLAB_SHOWS);
    expect(rowsShown(opened('test/fixtures/arch.sldd').entry('NumericType'))).toEqual(MATLAB_SHOWS);
    expect(rowsShown(opened('test/fixtures/arch_binary_as_text.sldd').entry('NumericType'))).toEqual(MATLAB_SHOWS);
  });

  it('show the Slope of a FractionLength stated by hand with no FixedExponent, as MATLAB reads it', () => {
    const node = opened('test/fixtures/typeLink.sldd').entry('ntFix16');
    expect(rowsShown(node)).toMatchObject({ dataTypeMode: 'Fixed-point: binary point scaling', signedness: 'Signed', wordLength: '16', fractionLength: '3', slope: '0.125', bias: '0' });
  });

  it('are display only: the bag, a save and a copy are as the file holds them', () => {
    const { session, root, entry } = opened('test/fixtures/arch_binary.sldd');
    const node = entry('NumericType');
    const held = structuredClone(node.serial._properties);
    rowsOf(node);
    expect(node.serial._properties).toEqual(held);
    expect(node.serialize().value._elements[0]._properties).toEqual(held);
    // An unedited save writes every part of the file as the file holds it, the entry's among them.
    const saved = unzipSync(new Uint8Array((session.serializeSource(root.name) as Any).bytes));
    const original = unzipSync(fixture('test/fixtures/arch_binary.sldd'));
    expect(Object.keys(saved).sort()).toEqual(Object.keys(original).sort());
    for (const part of Object.keys(original)) {
      expect(sameBytes(saved[part], original[part]), part).toBe(true);
    }
  });
});
