// Copyright 2026 The MathWorks, Inc.
//
// Defects 43 and 44 — the logical ARRAY, in and out.
//
// 43, the way in: `[true false true]` was not a literal MatlabValueParser knew. That is
// MATLAB's OWN spelling of a logical array — mat2str prints it, and it is the text the
// corpus's boolVec cell displays — so committing the value the cell was already showing
// answered "Invalid MATLAB expression", and the only spelling that WAS accepted, [1 0 1],
// silently retyped the entry from logical to double. A value's own displayed text has to
// be acceptable input; that invariant is what defects 25, 42 and this one all broke.
//
// 44, the way back out: all three sites in the binary .sldd reader that decode a
// `Class="logical" Dimension="..."` body split it and joined it straight back into a flat
// list, so the logical class alone skipped BOTH halves of what the numeric branch beside
// it does. A 2x2 came back a 1x4 with its values in column-major order, a 3x1 came back a
// 1x3, and an N-D came back flat. The two defects are one test file because 44 was only
// reachable once 43 was fixed: before it, no logical matrix could be typed at all, and
// there is none in the MATLAB corpus to have caught it on read.
//
// MATLAB's class rules for the literals, which the parser now matches exactly:
//   [true false true]  logical      [1 0 1]     double     [true 1 false]  double
// The mixed case promotes, and the pure-numeric case is double because a bare decimal
// literal is a double in MATLAB.
import { describe, it, expect } from 'vitest';
import MatlabValueParser from '../src/datamodel/parser/MatlabValueParser.js';
import { serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import {
  loadModel,
  entryByName,
  serializeModel,
  reparseEntry,
  type SlddFormat,
} from './parity/fidelity/roundTripHarness.js';

describe('defect 43: the parser reads MATLAB\'s own logical-array spelling', () => {
  it('takes [true false true] as a logical row', () => {
    expect(MatlabValueParser.parse('[true false true]')).toEqual({
      type: 'logical',
      value: [1, 0, 1],
      dims: [1, 3],
    });
    // Comma-separated is the same literal in MATLAB, so it has to be here too.
    expect(MatlabValueParser.parse('[true, false, true]')?.type).toBe('logical');
  });

  it('keeps [1 0 1] a DOUBLE, as MATLAB does', () => {
    // Not a cosmetic difference: this is the spelling that used to be the only one
    // accepted, and it must not be treated as logical just because the entry it is
    // typed into happens to be one. `x = [1 0 1]` in MATLAB is a double.
    expect(MatlabValueParser.parse('[1 0 1]')).toEqual({
      type: 'double',
      value: [1, 0, 1],
      dims: [1, 3],
    });
  });

  it('promotes a MIXED literal to double, as MATLAB does', () => {
    // `[true 1 false]` is a double in MATLAB — one numeric element promotes the lot.
    expect(MatlabValueParser.parse('[true 1 false]')).toEqual({
      type: 'double',
      value: [1, 1, 0],
      dims: [1, 3],
    });
  });

  it('shapes a logical column and matrix from the same literal grammar', () => {
    expect(MatlabValueParser.parse('[true; false; true]')).toEqual({
      type: 'logical',
      value: [1, 0, 1],
      dims: [3, 1],
    });
    // Row-major in, as everywhere else in this parser: row 1 is [true false].
    expect(MatlabValueParser.parse('[true false; false true]')).toEqual({
      type: 'logical',
      value: [1, 0, 0, 1],
      dims: [2, 2],
    });
  });

  it('collapses [true] to a 1x1, because that is what it is', () => {
    expect(MatlabValueParser.parse('[true]')).toEqual({
      type: 'logical',
      value: [1],
      dims: [1, 1],
    });
    // And the bare scalar keeps working — it always did.
    expect(MatlabValueParser.parse('true')).toEqual({ type: 'logical', value: true });
  });
});

// Both flavours: the two .sldd writers spell a typed value independently, and defect 44
// lived in exactly the gap that split — the json channel was right the whole time.
for (const format of ['json', 'binary'] as SlddFormat[]) {
  describe(`defects 43/44: a logical array survives an edit and the write — ${format}`, () => {
    function editAndReread(typed: string): { before: any; after: any; fresh: any } {
      const uri = `test://lgl-${format}-${typed}.sldd`;
      const model = loadModel(format, 'cases.sldd', uri);
      const node = entryByName(model, uri, 'boolVec');
      const before = { display: node.displayValue, dataType: node.dataType };
      expect(node.setProperty('Value', typed), typed).toBe(true);
      const after = { display: node.displayValue, dataType: node.dataType, serial: node.serial };
      const fresh = reparseEntry(serializeModel(model, format), format, 'cases.sldd', 'boolVec');
      return { before, after, fresh };
    }

    it('accepts the text the cell is already showing, unchanged', () => {
      // The whole of defect 43 in one assertion: retype what you were shown and nothing
      // about the value moves — not its text, not its class, not its shape.
      const { before, after, fresh } = editAndReread('[true false true]');
      expect(before).toEqual({ display: '[true false true]', dataType: 'logical' });
      expect(after.display).toBe('[true false true]');
      expect(after.dataType).toBe('logical');
      expect(fresh.displayValue).toBe('[true false true]');
      expect(fresh.dataType).toBe('logical');
      expect(fresh.children.map((c: any) => c.displayValue)).toEqual(['true', 'false', 'true']);
    });

    it('retypes to double when the typed literal IS a double', () => {
      // MATLAB parity, not a leftover: the user typed [1 0 1], and in MATLAB that
      // assignment makes the variable a double. What was wrong before was doing this
      // SILENTLY as the only way to edit a logical at all.
      const { after, fresh } = editAndReread('[1 0 1]');
      expect(after.dataType).toBe('double');
      expect(fresh.dataType).toBe('double');
      expect(fresh.displayValue).toBe('[1 0 1]');
    });

    it('keeps a logical COLUMN a 3x1 (defect 44)', () => {
      const { fresh } = editAndReread('[true; false; true]');
      expect(fresh.displayValue).toBe('[true; false; true]');
      expect(fresh.dataType).toBe('logical');
      expect(fresh.serial).toEqual({ _type: 'logical', _value: 'Matrix(3,1)\n[1, 0, 1]' });
    });

    it('keeps a logical MATRIX a 2x2, in the right element order (defect 44)', () => {
      // The values are deliberately asymmetric under transpose — [[1,0];[0,1]] would
      // survive a transpose unnoticed, so the display text is what is asserted and the
      // off-diagonal pair is what makes it meaningful.
      const { fresh } = editAndReread('[true false; false true]');
      expect(fresh.displayValue).toBe('[true false; false true]');
      expect(fresh.dataType).toBe('logical');
      expect(fresh.serial).toEqual({ _type: 'logical', _value: 'Matrix(2,2)\n[[1, 0]; [0, 1]]' });
      expect(fresh.children.map((c: any) => c.displayValue)).toEqual([
        'true',
        'false',
        'false',
        'true',
      ]);
    });

    it('collapses [true] to a logical SCALAR, serialized as a bare true', () => {
      const { fresh } = editAndReread('[true]');
      expect(fresh.displayValue).toBe('true');
      expect(fresh.dataType).toBe('logical');
      // Not a one-element array: a 1x1 logical is stored the way every other logical
      // scalar is, or the dictionary carries a shape MATLAB does not have.
      expect(fresh.serial).toEqual({});
      expect(fresh.children.length).toBe(0);
    });
  });
}

describe("defect 45: a Simulink.Parameter's logical Value keeps its class and shape", () => {
  // Found by asking the same question of the other write path once defect 43 made the
  // literal typeable: ParameterNode's Value setter had an arm for a double array and none
  // for a logical one, so a logical array fell to the scalar tail and was stored as the
  // parser's bare JS list. A plain JSON array carries neither the class nor the extents,
  // which is why the 2x2 below is the case that matters — it lost both.
  function setValue(typed: string): { display: string; serial: unknown; fresh: any } {
    const uri = `test://lgl-param-${typed}.sldd`;
    const model = loadModel('json', 'cases.sldd', uri);
    const node: any = entryByName(model, uri, 'aParam');
    expect(node.setProperty('Value', typed), typed).toBe(true);
    const serial = node._getSerializedProperties().Value;
    const fresh = reparseEntry(serializeModel(model, 'json'), 'json', 'cases.sldd', 'aParam');
    return { display: node.displayValue, serial, fresh };
  }

  it('writes a logical row as the typed envelope, not a bare JSON list', () => {
    const { display, serial, fresh } = setValue('[true false true]');
    expect(serial).toEqual({ _type: 'logical', _value: '[1, 0, 1]' });
    expect(display).toBe('[true false true]');
    expect(fresh.displayValue).toBe('[true false true]');
  });

  it('keeps a logical MATRIX 2x2 rather than flattening it to a 1x4 double', () => {
    const { serial, fresh } = setValue('[true false; false true]');
    expect(serial).toEqual({ _type: 'logical', _value: 'Matrix(2,2)\n[[1, 0]; [0, 1]]' });
    expect(fresh.displayValue).toBe('[true false; false true]');
  });

  it('keeps a logical column a 3x1', () => {
    const { serial } = setValue('[true; false; true]');
    expect(serial).toEqual({ _type: 'logical', _value: 'Matrix(3,1)\n[1, 0, 1]' });
  });

  it('stores [true] as a bare true, like the scalar literal it is', () => {
    // A one-element list would be written `[1]` — a JSON array, read back as a 1x1
    // double. Both spellings of the same 1x1 have to land on the same bytes.
    expect(setValue('[true]').serial).toBe(true);
    expect(setValue('true').serial).toBe(true);
  });

  it('still writes a double array as a double', () => {
    // The guard on the arm above: [1 0 1] is a double literal in MATLAB, and the double
    // path (a bare JSON list for a row) must not have moved.
    expect(setValue('[1 0 1]').serial).toEqual([1, 0, 1]);
  });
});

describe('defect 44: the bytes MATLAB reads carry the shape', () => {
  // The re-parse above proves our reader and our writer agree; it cannot prove either
  // agrees with MATLAB. This asserts the XML text itself, which is what the binary
  // dictionary stores and what MATLAB's own reader consumes: the extents in a
  // Dimension attribute and the body in MATLAB's COLUMN-major order.
  function valueXml(typed: string): string {
    const uri = `test://lgl-bytes-${typed}.sldd`;
    const model = loadModel('binary', 'cases.sldd', uri);
    const node = entryByName(model, uri, 'boolVec');
    expect(node.setProperty('Value', typed), typed).toBe(true);
    const line = serializeEntryToXml(node)
      .split('\n')
      .find((l) => l.includes('Name="Value"'));
    return (line || '').trim();
  }

  it('writes Dimension and a column-major body for a matrix', () => {
    // [true false; false true] stored column-major is 1 0 0 1 — and a transposed write
    // would be 1 0 0 1 as well, which is why the column case below is the real check.
    expect(valueXml('[true false; false true]')).toBe(
      '<P Name="Value" Class="logical" Dimension="2*2">1 0 0 1</P>',
    );
    // Asymmetric under transpose: row-major would be 1 1 0 0.
    expect(valueXml('[true true; false false]')).toBe(
      '<P Name="Value" Class="logical" Dimension="2*2">1 0 1 0</P>',
    );
  });

  it('writes Dimension for a column and for a row', () => {
    expect(valueXml('[true; false; true]')).toBe(
      '<P Name="Value" Class="logical" Dimension="3*1">1 0 1</P>',
    );
    // A row states its shape too here — Dimension is what tells MATLAB it is not a 3x1.
    expect(valueXml('[true false true]')).toBe(
      '<P Name="Value" Class="logical" Dimension="1*3">1 0 1</P>',
    );
  });
});
