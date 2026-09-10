// Copyright 2026 The MathWorks, Inc.
//
// Defect 49 — a shaped value inside a cell lost its shape, in the file as well as
// on screen. Typing `{[1;2]}` into a cell gave back `{[1 2]}`: a 2x1 double became
// a 1x2, and `saveChanges` wrote the 1x2.
//
// The cause is this repo's recurring one — a rule applied on one path and not on its
// twin. `MatlabValueParser.tokenizeCellElements` read each element with its own code
// per bracket kind instead of with the parser's own `parse`, and the `[` arm pushed
// `parseArray(...).value`: the flat element list, with `dims` dropped on the floor. A
// bare JSON list has nowhere to carry [2,1] and reads back as a row — exactly what
// MatlabVariableNode._serializeArray says in the comment above its own typed-literal
// fallback, one directory away. The `{` arm was right the whole time, because a nested
// cell had to keep a wrapper to carry `nested.dims`.
//
// Every element type that has a shape or a class the bare form cannot state was
// affected, which is why this file checks six of them and not just the numeric column:
// a numeric matrix, a logical array (retyped to double), a char matrix (flattened to a
// 1xN row), a string array (retyped to char, then flattened) and a 1x1 string (retyped
// to char) all went the same way. The spellings asserted here are MATLAB's own, read
// off a dictionary MATLAB wrote itself — see test/parity/matlab/probe_cell_shapes.m,
// whose header lists the file's exact bytes for each case.
import { describe, it, expect } from 'vitest';
import MatlabValueParser from '../src/datamodel/parser/MatlabValueParser.js';
import {
  loadModel,
  entryByName,
  serializeModel,
  reparseEntry,
  type SlddFormat,
} from './parity/fidelity/roundTripHarness.js';

/** The single element of a 1x1 cell literal, as the raw value a node is built from. */
function element(literal: string): unknown {
  const parsed = MatlabValueParser.parse(literal);
  expect(parsed, literal).not.toBeNull();
  expect(parsed!.type, literal).toBe('cell');
  return (parsed!.value as unknown[])[0];
}

describe('defect 49: a cell element is spelled the way MATLAB spells it', () => {
  it('states a numeric COLUMN as a typed Matrix literal — the reported case', () => {
    expect(element('{[1;2]}')).toEqual({ _type: 'double', _value: 'Matrix(2,1)\n[1.0, 2.0]' });
    // The flat list is what it used to push, and reading that back is the 1x2 the
    // user was shown. It is still the right answer for a value that IS a 1x2.
    expect(element('{[1 2]}')).toEqual([1, 2]);
  });

  it('states a numeric MATRIX, in row-major groups', () => {
    // Asymmetric under transpose on purpose: [[1,2];[3,4]] would survive a transposed
    // write unnoticed if the values were symmetric.
    expect(element('{[1 2; 3 4]}')).toEqual({
      _type: 'double',
      _value: 'Matrix(2,2)\n[[1.0, 2.0]; [3.0, 4.0]]',
    });
  });

  it('leaves the two shapes the bare form already states alone', () => {
    // A row and the empty array, which is where MATLAB itself writes a bare list —
    // so keeping the typed literal off them is parity, not laziness, and it keeps
    // every existing file from churning on save.
    expect(element('{[]}')).toEqual([]);
    expect(element('{1}')).toBe(1);
    expect(element('{-2.5}')).toBe(-2.5);
  });

  it('keeps a logical array LOGICAL, at either orientation', () => {
    // Both orientations are tagged, unlike the double row: a bare JSON list reads
    // back as a double, so the class is the thing the envelope is carrying here and
    // the shape is only half the story. `{[true false]}` used to be written `[1, 0]`
    // — a double row, two changes to the value at once.
    expect(element('{[true; false]}')).toEqual({
      _type: 'logical',
      _value: 'Matrix(2,1)\n[1, 0]',
    });
    expect(element('{[true false]}')).toEqual({ _type: 'logical', _value: '[1, 0]' });
    // A scalar needs no envelope — a JSON boolean is already a logical.
    expect(element('{true}')).toBe(true);
    expect(element('{false}')).toBe(false);
    // The guard on the arm above: [1 0] is a DOUBLE literal in MATLAB, and it must
    // not be promoted to logical just because its values look like flags.
    expect(element('{[1 0]}')).toEqual([1, 0]);
  });

  it('keeps a char MATRIX 2-D, as char codes in MATLAB order', () => {
    // ['ab';'cd'] is a 2x2 char, and the codes are laid out one bracketed group per
    // ROW: 97 98 / 99 100. Flattened to the bare string it became the 1x4 'acbd' —
    // MATLAB's column-major storage order, read back as a row, so the text itself
    // came out scrambled and not merely reshaped.
    expect(element("{['ab'; 'cd']}")).toEqual({
      _type: 'mxchar',
      _value: 'Matrix(2,2)\n[[97, 98]; [99, 100]]',
    });
    // A 1xN char row is a bare JSON string in MATLAB's own file — charNeedsShape.
    expect(element("{'ab'}")).toBe('ab');
    expect(element("{'a,b'}")).toBe('a,b');
  });

  it('keeps a string array a STRING, with its dimensions', () => {
    expect(element('{["a"; "b"]}')).toEqual({
      _array_type: 'String',
      _dimensions: [2, 1],
      _elements: ['a', 'b'],
      _mw_element_type: 'MATLABArray',
    });
    // A string ROW is wrapped as well — the opposite of the double row, because the
    // bare list would say double.
    expect(element('{["a" "b"]}')).toEqual({
      _array_type: 'String',
      _dimensions: [1, 2],
      _elements: ['a', 'b'],
      _mw_element_type: 'MATLABArray',
    });
    // And a 1x1 string is the one-element LIST, which is MATLAB's spelling and also
    // what serializeValue writes for a string scalar at the top level. Bare text
    // would be a char: `{"a"}` used to display and save as `{'a'}`.
    expect(element('{"a"}')).toEqual(['a']);
    expect(element('{["a"]}')).toEqual(['a']);
  });

  it('still wraps a nested CELL the way it always did', () => {
    // The arm that was already right. Kept under test because the rewrite routed it
    // through the shared converter, so it could have been broken by the fix.
    expect(element('{{1;2}}')).toEqual({
      _array_type: 'Cell',
      _dimensions: [2, 1],
      _elements: [1, 2],
      _mw_element_type: 'MATLABArray',
    });
    expect(element('{{}}')).toEqual({
      _array_type: 'Cell',
      _dimensions: [0, 0],
      _elements: [],
      _mw_element_type: 'MATLABArray',
    });
    // Two levels down, which is the whole point of parsing an element recursively:
    // the inner column keeps its shape as well.
    expect(element('{{[1;2]}}')).toEqual({
      _array_type: 'Cell',
      _dimensions: [1, 1],
      _elements: [{ _type: 'double', _value: 'Matrix(2,1)\n[1.0, 2.0]' }],
      _mw_element_type: 'MATLABArray',
    });
  });

  it('keeps the behaviours the rewrite could have dropped', () => {
    // A bare identifier stays text: the parser cannot evaluate `f(x)` or resolve a
    // name, and refusing the cell would reject a value the table can show.
    expect(element('{abc}')).toBe('abc');
    // An exact-integer token collapses to its double inside a cell, because a bare
    // decimal literal is a double in MATLAB and a cell element has no class beside
    // it to say otherwise (defect 42). A token that escaped would be written as a
    // JSON string and read back as char.
    expect(element('{18446744073709551615}')).toBe(18446744073709551615);
    expect(typeof element('{18446744073709551615}')).toBe('number');
    // Separators inside a quoted element are content, not delimiters.
    expect(element("{'a;b'}")).toBe('a;b');
    expect(MatlabValueParser.parse("{'it''s', 'ok'}")).toEqual({
      type: 'cell',
      value: ["it's", 'ok'],
      dims: [1, 2],
    });
    // The row/column COUNT is unchanged. The element order is not, and that is defect
    // 50's fix rather than this one's: written row by row, stored column by column.
    expect(MatlabValueParser.parse('{1, 2; 3, 4}')).toEqual({
      type: 'cell',
      value: [1, 3, 2, 4],
      dims: [2, 2],
    });
    // A malformed bracketed or quoted span is still a rejection of the whole cell.
    expect(MatlabValueParser.parse('{[1 "a"]}')).toBeNull();
    expect(MatlabValueParser.parse('{[1 2}')).toBeNull();
    expect(MatlabValueParser.parse("{'abc}")).toBeNull();
    expect(MatlabValueParser.parse('{{[}}')).toBeNull();
  });
});

// The parse assertions above are about the raw shape; these are about what a USER
// sees and what the FILE gets. They are the half that made this a defect rather than
// an internal detail: _serializeCell rebuilds each element from its child node, so a
// child built from a shapeless list is written back shapeless.
//
// Both flavours, for the reason defect 44 needed both: the JSON and XML channels
// spell a value independently, and a shape kept in one can be dropped by the other.
for (const format of ['json', 'binary'] as SlddFormat[]) {
  describe(`defect 49: a shaped cell element survives the edit and the write — ${format}`, () => {
    // One source per edit. The uri is the model's key, so a repeated one would edit
    // the PREVIOUS edit's node instead of a fresh copy of the fixture — which reads
    // as a transposed result the second time round and has nothing to do with the
    // value being tested.
    let seq = 0;
    function editAndReread(typed: string): { display: string; children: string[]; fresh: any } {
      const uri = `test://cellshape-${format}-${seq++}.sldd`;
      const model = loadModel(format, 'cases.sldd', uri);
      const node = entryByName(model, uri, 'cellFlat');
      expect(node.setProperty('Value', typed), typed).toBe(true);
      const fresh = reparseEntry(serializeModel(model, format), format, 'cases.sldd', 'cellFlat');
      return {
        display: String(node.displayValue),
        children: node.children.map((c: any) => String(c.displayValue)),
        fresh,
      };
    }

    // The user's own report: type it, and it must still be there after the save.
    it('a numeric column stays a column', () => {
      const { display, fresh } = editAndReread('{[1;2]}');
      expect(display).toBe('{[1; 2]}');
      expect(fresh.displayValue).toBe('{[1; 2]}');
      expect(fresh.children.map((c: any) => String(c.displayValue))).toEqual(['[1; 2]']);
      expect(fresh.children[0].dataType).toBe('double');
    });

    it('a numeric matrix stays a matrix, with its elements in place', () => {
      const { fresh } = editAndReread('{[1 2; 3 4]}');
      expect(fresh.displayValue).toBe('{[1 2; 3 4]}');
    });

    it('a logical array stays logical', () => {
      const { fresh } = editAndReread('{[true; false]}');
      expect(fresh.displayValue).toBe('{[true; false]}');
      expect(fresh.children[0].dataType).toBe('logical');
    });

    it('a char matrix keeps its rows', () => {
      const { fresh } = editAndReread("{['ab'; 'cd']}");
      expect(fresh.displayValue).toBe("{['ab'; 'cd']}");
      expect(fresh.children[0].dataType).toBe('char');
    });

    it('a string array stays a string array', () => {
      const { display, fresh } = editAndReread('{["a"; "b"]}');
      // The edit itself is right in both channels — this is the 2x1 that used to
      // come back as `{["a" "b"]}`.
      expect(display).toBe('{["a"; "b"]}');
      if (format === 'binary') {
        // Then the XML channel loses it, and NOT because of anything above: a string
        // nested in a cell is written as an MCOS payload this repo does not decode
        // for an unnamed value, so it re-reads as an opaque summary with no text.
        // That is the known limitation DESIGN.md records for a string in a struct
        // field or cell element (and it degrades the same way with the shape fix
        // reverted). Pinned rather than skipped, so the day the payload is decoded
        // this line fails and the real assertion below takes over.
        expect(String(fresh.displayValue)).toBe('{<1x1 string>}');
        return;
      }
      expect(String(fresh.displayValue)).toBe('{["a"; "b"]}');
      expect(fresh.children[0].dataType).toBe('string');
    });

    it('a 1x1 string stays a string', () => {
      const { display, fresh } = editAndReread('{"a"}');
      expect(display).toBe('{"a"}');
      if (format === 'binary') {
        expect(String(fresh.displayValue)).toBe('{<1x1 string>}');
        return;
      }
      expect(fresh.children[0].dataType).toBe('string');
      expect(String(fresh.displayValue)).toBe('{"a"}');
    });

    // The invariant that ties the two halves together, and the cheapest way to state
    // the whole defect: what the table SHOWS has to be acceptable input that means
    // the same thing. `{[1;2]}` showing as `{[1 2]}` broke it in the worst way, by
    // being acceptable input for a different value.
    it('every shape round-trips through its own displayed text', () => {
      for (const typed of [
        '{[1;2]}',
        '{[1 2]}',
        '{[1 2; 3 4]}',
        '{[true; false]}',
        '{[true false]}',
        "{['ab'; 'cd']}",
        "{'ab'}",
        '{["a"; "b"]}',
        '{"a"}',
        '{{[1;2]}}',
      ]) {
        const first = editAndReread(typed);
        const second = editAndReread(first.display);
        expect(second.display, typed).toBe(first.display);
        // On the binary channel a string element does not survive the write at all
        // (see 'a string array stays a string array'), so what re-reads is the
        // opaque summary rather than the value. The DISPLAY invariant above is the
        // one this test is about and it holds in both channels.
        if (format === 'binary' && typed.indexOf('"') >= 0) {
          expect(String(second.fresh.displayValue), typed).toBe('{<1x1 string>}');
          continue;
        }
        expect(String(second.fresh.displayValue), typed).toBe(first.display);
      }
    });

    // Defect 50, which this file found while pinning 49 and which is fixed in the commit
    // after it: the parser assembled a cell's OWN element list row-major while every
    // reader stores one column-major, so editing a multi-ROW cell transposed it. Kept
    // here as well as in cellElementOrder.test.ts — that file owns the rule and states it
    // against MATLAB's subscripts, this one is the shape-fix's neighbour and would notice
    // if a later change to cellElementRaw reintroduced the transpose one type at a time.
    it('a multi-row cell keeps its layout, and so does a vector', () => {
      const { display, fresh } = editAndReread('{1, 2; 3, 4}');
      expect(display).toBe('{1, 2; 3, 4}');
      expect(String(fresh.displayValue)).toBe('{1, 2; 3, 4}');
      // A vector was unaffected even before the fix, which is why this hid: a 1xN and
      // an Nx1 flatten to the same list in either order.
      expect(editAndReread('{1, 2, 3}').display).toBe('{1, 2, 3}');
      expect(editAndReread('{1; 2; 3}').display).toBe('{1; 2; 3}');
    });
  });
}
