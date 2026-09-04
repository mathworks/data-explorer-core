// Copyright 2026 The MathWorks, Inc.
//
// Defect 42 — the EDIT path for a 64-bit integer.
//
// Defects 29/30 (.sldd) and Task 10.2 (.mat) fixed the four READERS: an integer a double
// cannot hold is carried as its own decimal TEXT, from the file to the display. The write
// path was still lossy, because it never went through that machinery — a committed cell
// re-enters the model through MatlabValueParser, whose `Number(str)` put every literal
// back through a double. So the value MATLAB wrote was displayed correctly, and then
// typing the very digits the cell showed stored something else:
//
//   maxU64     18446744073709551615  ->  18446744073709552000U
//   i64Unsafe  9007199254740993      ->  9007199254740992
//   u64Vec     [18446744073709551615 2 3] -> [18446744073709552000U, 2U, 3U]
//
// And 18446744073709552000 is not merely rounded, it is OUT of uint64 range — MATLAB's
// reader abandons the rest of the body when it hits one (see XmlUtils's defect 29/30
// note), so u64Vec's own neighbours were destroyed too.
//
// The exact form is only meaningful under a class that can hold it, which is why the
// narrowing is class-aware (XmlUtils.exactForClass) and why the double cases below are
// asserted to ROUND: `x = 18446744073709551615` in MATLAB stores the nearest double, so
// rounding there is parity, not a leftover bug. Keeping the text under a double would
// write a JSON string and read back as char.
import { describe, it, expect } from 'vitest';
import MatlabValueParser, { collapseExact } from '../src/datamodel/parser/MatlabValueParser.js';
import { exactForClass } from '../src/datamodel/parser/XmlUtils.js';
import {
  loadModel,
  entryByName,
  serializeModel,
  reparseEntry,
  type SlddFormat,
} from './parity/fidelity/roundTripHarness.js';

const MAX_U64 = '18446744073709551615';
const UNSAFE_I64 = '9007199254740993'; // 2^53 + 1: inside int64, outside a double

describe('defect 42: the parser keeps an integer a double cannot hold', () => {
  it('hands back exact decimal TEXT for a 64-bit literal', () => {
    expect(MatlabValueParser.parse(MAX_U64)).toEqual({ type: 'double', value: MAX_U64 });
    expect(MatlabValueParser.parse(UNSAFE_I64)).toEqual({ type: 'double', value: UNSAFE_I64 });
    expect(MatlabValueParser.parse('-' + MAX_U64)).toEqual({ type: 'double', value: '-' + MAX_U64 });
  });

  it('hands back a NUMBER for everything a double does hold', () => {
    // The round trip is the test, not the magnitude — so no existing path changes
    // behaviour and only the tokens that were actually being corrupted take the text
    // form. 2^53 itself is exact; 2^53 + 1 above is not.
    expect(MatlabValueParser.parse('9007199254740992')).toEqual({ type: 'double', value: 9007199254740992 });
    expect(MatlabValueParser.parse('5')).toEqual({ type: 'double', value: 5 });
    expect(MatlabValueParser.parse('-0.25')).toEqual({ type: 'double', value: -0.25 });
    expect(MatlabValueParser.parse('1e300')).toEqual({ type: 'double', value: 1e300 });
    // A cosmetic difference in the spelling must not on its own force the text form.
    expect(MatlabValueParser.parse('+007')).toEqual({ type: 'double', value: 7 });
  });

  it('keeps refusing what it refused before', () => {
    // The literal gate runs BEFORE the exactness decision, so widening the return type
    // cannot have widened the accept set. 'Infinity'/'0x10'/'1_000' are JavaScript, not
    // MATLAB, and writing one back would put an unevaluable value in the dictionary.
    for (const bad of ['Infinity', '0x10', '1_000', '1.2.3', 'abc', '']) {
      expect(MatlabValueParser.parse(bad), bad).toBeNull();
    }
    // MATLAB's own non-finite spellings still parse to the real non-finite numbers.
    expect(MatlabValueParser.parse('Inf')).toEqual({ type: 'double', value: Infinity });
    expect(MatlabValueParser.parse('-Inf')).toEqual({ type: 'double', value: -Infinity });
    expect(MatlabValueParser.parse('NaN')?.value).toBeNaN();
  });

  it('keeps a 64-bit ELEMENT of an array literal', () => {
    expect(MatlabValueParser.parse(`[${MAX_U64} 2 3]`)).toEqual({
      type: 'double',
      value: [MAX_U64, 2, 3],
      dims: [1, 3],
    });
  });

  it('does NOT leak a token out of a cell, whose elements are doubles', () => {
    // A cell element's class comes from its own literal and a bare decimal literal is a
    // double in MATLAB, so {18446744073709551615} holds a double. A token left here
    // would be stored and re-read as the CHAR '18446744073709551615'.
    expect(MatlabValueParser.parseCell(`{${MAX_U64}, 'a'}`)).toEqual({
      type: 'cell',
      value: [18446744073709552000, 'a'],
      dims: [1, 2],
    });
    expect(MatlabValueParser.parseCell(`{[${MAX_U64} 2]}`)).toEqual({
      type: 'cell',
      value: [[18446744073709552000, 2]],
      dims: [1, 1],
    });
  });
});

describe('defect 42: the exact form is narrowed to the class that can hold it', () => {
  it('collapseExact undoes the token for a class-blind consumer', () => {
    expect(collapseExact({ type: 'double', value: MAX_U64 }).value).toBe(18446744073709552000);
    expect(collapseExact({ type: 'double', value: [MAX_U64, 2], dims: [1, 2] }).value).toEqual([
      18446744073709552000, 2,
    ]);
  });

  it('collapseExact leaves a char/string value alone even when it is all digits', () => {
    // The parsed TYPE is the gate, not the JavaScript type of the value: '123' as a char
    // is text that happens to be digits, and turning it into 123 would retype the value.
    expect(collapseExact({ type: 'char', value: '123' })).toEqual({ type: 'char', value: '123' });
    expect(collapseExact({ type: 'string-array', value: ['12', 'ab'], dims: [1, 2] }).value).toEqual([
      '12',
      'ab',
    ]);
  });

  it('exactForClass keeps the text only under int64/uint64', () => {
    expect(exactForClass(MAX_U64, 'uint64')).toBe(MAX_U64);
    expect(exactForClass(UNSAFE_I64, 'int64')).toBe(UNSAFE_I64);
    expect(exactForClass(MAX_U64, 'double')).toBe(18446744073709552000);
    expect(exactForClass(MAX_U64, 'int32')).toBe(18446744073709552000);
    expect(exactForClass(MAX_U64, undefined)).toBe(18446744073709552000);
    // Numbers and ordinary text pass through, so it is safe to map over an element list.
    expect(exactForClass(5, 'double')).toBe(5);
    expect(exactForClass('m/s', 'uint64')).toBe('m/s');
  });
});

// Both .sldd flavours, because the two writers spell a typed value independently and a
// fix in one is not a fix in the other (that is how defect 30 stayed alive after 29).
for (const format of ['json', 'binary'] as SlddFormat[]) {
  describe(`defect 42: an edited 64-bit value survives the write — ${format}`, () => {
    // Round-trip one edit through serialize + re-parse and report what the fresh node
    // says. `displayValue` is the assertion because it is the same text the cell showed
    // before the edit: the user typed back what they were shown, so anything else here is
    // the defect.
    function editAndReread(name: string, typed: string): any {
      const uri = `test://d42-${format}-${name}.sldd`;
      const model = loadModel(format, 'cases.sldd', uri);
      const node = entryByName(model, uri, name);
      expect(node.setProperty('Value', typed), name).toBe(true);
      return reparseEntry(serializeModel(model, format), format, 'cases.sldd', name);
    }

    it('a uint64 scalar keeps all twenty digits', () => {
      const fresh = editAndReread('maxU64', MAX_U64);
      expect(fresh.displayValue).toBe(MAX_U64);
      expect(fresh.dataType).toBe('uint64');
    });

    it('an int64 scalar keeps 2^53 + 1', () => {
      const fresh = editAndReread('i64Unsafe', UNSAFE_I64);
      expect(fresh.displayValue).toBe(UNSAFE_I64);
      expect(fresh.dataType).toBe('int64');
    });

    it('a uint64 VECTOR keeps the exact element and its neighbours', () => {
      // The neighbours matter on their own: MATLAB's reader abandons the rest of a body
      // after an out-of-range token, so 2 and 3 came back as zeros from a defect in the
      // FIRST element.
      const fresh = editAndReread('u64Vec', `[${MAX_U64} 2 3]`);
      expect(fresh.displayValue).toBe(`[${MAX_U64} 2 3]`);
      expect(fresh.children.map((c: any) => c.displayValue)).toEqual([MAX_U64, '2', '3']);
    });

    it('one EDITED ELEMENT of a uint64 vector keeps its digits', () => {
      // The element editor is its own path (_setConstrainedValue), and the class it must
      // consult is the CONTAINER's — an element has no class of its own.
      const uri = `test://d42-el-${format}.sldd`;
      const model = loadModel(format, 'cases.sldd', uri);
      const node = entryByName(model, uri, 'u64Vec');
      expect(node.children[1].setProperty('Value', MAX_U64)).toBe(true);
      const fresh = reparseEntry(serializeModel(model, format), format, 'cases.sldd', 'u64Vec');
      expect(fresh.displayValue).toBe(`[${MAX_U64} ${MAX_U64} 0]`);
    });

    it('writes the typed literal MATLAB writes, suffix and all', () => {
      // The bytes, not just the re-parse: our own reader would forgive a spelling MATLAB
      // does not. MATLAB writes a uint64 with a 'U' suffix and an int64 bare — dropping
      // the suffix makes MATLAB read the body back as double.
      const uri = `test://d42-bytes-${format}.sldd`;
      const model = loadModel(format, 'cases.sldd', uri);
      expect(entryByName(model, uri, 'maxU64').setProperty('Value', MAX_U64)).toBe(true);
      expect(entryByName(model, uri, 'i64Unsafe').setProperty('Value', UNSAFE_I64)).toBe(true);
      expect(entryByName(model, uri, 'u64Vec').setProperty('Value', `[${MAX_U64} 2 3]`)).toBe(true);
      const text = new TextDecoder().decode(serializeModel(model, 'json'));
      expect(text).toContain(`"_value": "${MAX_U64}U"`);
      expect(text).toContain(`"_value": "${UNSAFE_I64}"`);
      expect(text).toContain(`"_value": "[${MAX_U64}U, 2U, 3U]"`);
      expect(text).not.toContain('18446744073709552000');
    });

    it('a DOUBLE entry still rounds, because that is what MATLAB stores', () => {
      // Parity, not a leftover: `kp = 9007199254740993` in MATLAB is a double literal, so
      // MATLAB stores 9007199254740992 too. The value also has to stay a JSON number —
      // written as a string it would be read back as char.
      const fresh = editAndReread('kp', UNSAFE_I64);
      expect(fresh.displayValue).toBe('9007199254740992');
      const uri = `test://d42-dbl-${format}.sldd`;
      const model = loadModel(format, 'cases.sldd', uri);
      expect(entryByName(model, uri, 'kp').setProperty('Value', UNSAFE_I64)).toBe(true);
      expect(new TextDecoder().decode(serializeModel(model, 'json'))).toContain(
        '"value": 9007199254740992',
      );
    });

    it("a Parameter's Value rounds too — its class comes from its expression", () => {
      // Simulink.Parameter has no class beside the value to consult, and MATLAB's own
      // `p.Value = 9007199254740993` stores the nearest double.
      const fresh = editAndReread('aParam', UNSAFE_I64);
      expect(fresh.displayValue).toBe('9007199254740992');
      expect(fresh.className).toBe('Simulink.Parameter');
    });
  });
}
