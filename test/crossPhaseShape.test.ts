// Copyright 2026 The MathWorks, Inc.
//
// The cross-phase lock. Phase 6 widened the shape channel (the reader keeps every
// extent), Phase 7 decided how shape PRINTS, Phase 8 exposed shape to consumers as
// `dims`. Each phase was verified on its own and each was sound on its own — but a
// value's shape travels through FOUR channels, and nothing checked that the four
// agree:
//
//   1. parse      what the reader kept, against MATLAB's own size()
//   2. display    what the Value column says
//   3. accessor   what `dims` hands a consumer
//   4. write      the Dimension= the serializer spells, and the element count
//                 underneath it
//
// Channels 1-3 did agree everywhere. Channel 4 did not, in three places no
// isolated phase check could see, because each phase looked only at the writer it
// had touched. All three are pinned below against MATLAB-authored bytes or a
// direct MATLAB answer.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFile, findEntry } from './parity/loadFile.js';
import * as NodeRegistry from '../src/datamodel/node/NodeRegistry.js';

const truth = JSON.parse(
  readFileSync(fileURLToPath(new URL('./parity/artifacts/truth.json', import.meta.url)), 'utf8'),
);

// Object arrays live under truth.objArr, not truth.vars: MATLAB refuses to store
// one in either .sldd flavour or an .slx model workspace (truth.notes.slddRejected
// / slxRejected), so gen_truth.m records them separately and cases.mat is the only
// artifact that carries them.
function truthOf(name: string): any {
  return truth.vars[name] ?? truth.objArr[name];
}

const FORMATS: Array<[string, string, string]> = [
  ['mat', './artifacts/mat/cases.mat', 'cases.mat'],
  ['text', './artifacts/text/cases.sldd', 'cases.sldd'],
  ['binary', './artifacts/binary/cases.sldd', 'cases.sldd'],
  ['slx', './artifacts/slx/cases.slx', 'cases.slx'],
];

function entryOf(rel: string, filename: string, name: string): any {
  return findEntry(loadFile(rel, filename), name);
}

// The Dimension= the writer spelled on the value's OWN tag — the outermost one,
// never a nested property's.
function outerDimension(xml: string): string | null {
  const m = /^\s*<[A-Za-z]+[^>]*?\sDimension="([^"]*)"/.exec(xml);
  return m ? m[1] : null;
}

function countElements(xml: string): number {
  return (xml.match(/<Element[\s>]/g) || []).length;
}

describe('cross-phase: shape tells one story in all four channels', () => {
  // nd2x3x2, cellNd and structNd are the three MATLAB-authored rank-3 values that
  // exist in all four formats. `dims` must be MATLAB's size(), the display must be
  // the angle form spelled out of that same size, and the writer must name every
  // extent with one element per element underneath it.
  for (const [fmt, rel, filename] of FORMATS) {
    for (const name of ['nd2x3x2', 'cellNd', 'structNd']) {
      it(`${fmt} ${name}: parse, display, dims and write agree`, () => {
        const t = truthOf(name);
        expect(t.size).toEqual([2, 3, 2]);
        // MATLAB itself refuses a bracketed literal at rank 3, which is why the
        // display convention summarizes rather than rendering page 1 as a 2-D
        // literal that a genuine 2x3 would produce too.
        expect(t.mat2str_error).toBe('Input matrix must be 2-D.');

        const n = entryOf(rel, filename, name);

        // channels 1 + 3
        expect(n.dims).toEqual(t.size);
        // channel 2, spelled out of that same size
        expect(n.displayValue).toBe('<' + t.size.join('x') + ' ' + t.class + '>');
        // a summary is not a value you can retype
        expect(n.valueEditable).toBe(false);
        // every element is present as a child row
        expect(n.children.length).toBe(t.numel);

        // channel 4
        const xml = n.serializeXml('P', { Name: 'Value' }, 0);
        expect(outerDimension(xml)).toBe(t.size.join('*'));
        if (name !== 'nd2x3x2') {
          // A numeric body is flat text; cell and struct carry one <Element> per
          // element, so Dimension= and the element count must not contradict.
          expect(countElements(xml)).toBe(t.numel);
        }
      });
    }
  }

  // The four channels agreeing within one format is not enough. The SAME MATLAB
  // value read out of four different files must also serialize the same way — and
  // this is what caught the struct write hole, because .sldd routes struct XML
  // through StructNode while .mat/.slx route it through MatlabVariableNode, and
  // only StructNode had ever been checked.
  for (const name of ['structNd', 'struct2x3', 'structScalar']) {
    it(`${name}: every format writes the same struct XML`, () => {
      const xmls = FORMATS.map(([, rel, filename]) =>
        entryOf(rel, filename, name).serializeXml('P', { Name: 'Value' }, 0),
      );
      for (let i = 1; i < xmls.length; i++) {
        expect(xmls[i], FORMATS[i][0] + ' disagrees with ' + FORMATS[0][0]).toBe(xmls[0]);
      }
      // And the shared answer is MATLAB's own spelling, not merely a consistent
      // one. Verified against the bytes MATLAB wrote in
      // test/parity/artifacts/binary/cases.sldd:
      //   struct2x3 -> <P Name="Value" Class="struct" Dimension="2*3"> with six
      //   <Element><P Name="a" Class="double">1.0</P></Element>
      //   structNd  -> the same with Dimension="2*3*2" and twelve <Element>s
      const t = truthOf(name);
      expect(xmls[0]).toContain('Class="struct"');
      expect(countElements(xmls[0])).toBe(Math.max(1, t.numel));
      if (t.numel > 1) {
        expect(outerDimension(xmls[0])).toBe(t.size.join('*'));
      }
    });
  }

  it('a .mat-sourced struct writes its fields, not the scalar 0', () => {
    // MatlabVariableNode._serializeScalarXml had no struct arm, so a struct fell
    // through to the numeric tail and the WHOLE entry serialized as
    // `Class="struct">0`. Phase 6 Task 6.4 closed the JSON twin of this hole in
    // _serializeScalar and DESIGN.md recorded defect 15 as fixed — but the binary
    // dictionary writer goes through serializeXml, so copying a .mat or .slx
    // struct into a compressed-binary dictionary still emptied it.
    //
    // This is not merely lossy. Asked directly, MATLAB will not even OPEN a
    // dictionary carrying that byte sequence: substituting
    // `<P Name="Value" Class="struct">0</P>` for struct2x3's value in MATLAB's own
    // binary cases.sldd gives
    //   Simulink.data.dictionary.open -> "Failed to open file '...'."
    // while the same rezip with MATLAB's bytes untouched opens and reads
    // `struct [2 3]`. So the old output corrupted the file, it did not just
    // truncate a value.
    const n = entryOf('./artifacts/mat/cases.mat', 'cases.mat', 'struct2x3');
    const xml = n.serializeXml('P', { Name: 'Value' }, 0);
    expect(xml).not.toContain('Class="struct">0<');
    expect(outerDimension(xml)).toBe('2*3');
    expect(countElements(xml)).toBe(6);
    // MATLAB's element order is column-major, so the six elements carry a=1..6 in
    // that order (truth.vars.struct2x3.linearValues).
    for (const v of ['1.0', '2.0', '3.0', '4.0', '5.0', '6.0']) {
      expect(xml).toContain('<P Name="a" Class="double">' + v + '</P>');
    }
  });

  it('an object array spells every extent it claims to have', () => {
    // Phase 8 gave ObjectNode a `dims` accessor and stopped the MCOS decoder
    // truncating rank, so the node now reports [2,3,2] and displays
    // <2x3x2 Simulink.Parameter>. Its XML writer still spelled
    // dims[0] + '*' + dims[1], so the attribute promised six elements over the
    // twelve <Element>s beneath it — the node contradicting itself, which is the
    // interaction Phase 8's isolated check could not see (pre-Phase-8 every
    // channel said [2,3]: wrong, but consistent).
    //
    // MATLAB gives no ground truth for an object array's Dimension=, because it
    // refuses object arrays in both .sldd flavours and in the .slx model workspace
    // (truth.notes.slddRejected / slxRejected). But a Dimension= that contradicts
    // the body beneath it is wrong under any reading: Phase 6 established that for
    // the struct analogue, where MATLAB's XML reader SEGFAULTS on a Dimension="2*3"
    // carrying twelve <Element>s. MATLAB's struct-array spelling — every extent
    // named, one <Element> per element — is the one form it is known to accept for
    // "an N-D array of things", so that is the form used here.
    const t = truthOf('obj2x3x2');
    expect(t.size).toEqual([2, 3, 2]);
    const n = entryOf('./artifacts/mat/cases.mat', 'cases.mat', 'obj2x3x2');
    expect(n.dims).toEqual(t.size);
    expect(n.displayValue).toBe('<2x3x2 ' + t.class + '>');
    const xml = n.serializeXml('Value', undefined, 0);
    expect(outerDimension(xml)).toBe('2*3*2');
    // Twelve top-level <Element>s, one per object. Counted at the outer indent
    // only: each element's own properties nest further <Element> tags.
    expect((xml.match(/^ {4}<Element /gm) || []).length).toBe(12);
  });

  it('a rank-2 object array is untouched by that widening', () => {
    // The regression control for the line above: rank 2 must keep spelling exactly
    // two extents, which is also all MATLAB ever wrote for these.
    const n = entryOf('./artifacts/mat/cases.mat', 'cases.mat', 'obj2x3');
    expect(n.dims).toEqual([2, 3]);
    expect(outerDimension(n.serializeXml('Value', undefined, 0))).toBe('2*3');
    const col = entryOf('./artifacts/mat/cases.mat', 'cases.mat', 'objCol');
    expect(col.dims).toEqual([3, 1]);
    expect(outerDimension(col.serializeXml('Value', undefined, 0))).toBe('3*1');
  });

  it('the binary dictionary keeps Inf and -Inf, as the other three formats do', () => {
    // Not a shape defect, but the same class of cross-format disagreement the
    // sweep is looking for, and found the same way: one value, four readers, one
    // answer that differs. BinarySlddParser split its numeric body with
    // `.map(Number)` in two places and `.map(parseMatlabNum)` in a third.
    // Number('Inf') is NaN — JavaScript spells infinity 'Infinity' — so MATLAB's
    // own bytes for nonFinVec in test/parity/artifacts/binary/cases.sldd,
    //   <P Name="Value" Class="double" Dimension="1*5">1.0 Inf -Inf NaN 5.0</P>
    // read back as [1 NaN NaN NaN 5]: both infinities destroyed on load and
    // indistinguishable afterwards from a real NaN. mat, text and slx were all
    // correct, which is why no single-format test caught it.
    expect(truth.vars.nonFinVec.mat2str).toBe('[1 Inf -Inf NaN 5]');
    for (const [fmt, rel, filename] of FORMATS) {
      const n = entryOf(rel, filename, 'nonFinVec');
      expect(n.displayValue, fmt).toBe('[1 Inf -Inf NaN 5]');
      expect(
        n.children.map((c: any) => c.displayValue),
        fmt,
      ).toEqual(['1', 'Inf', '-Inf', 'NaN', '5']);
    }
  });

  it('a non-finite value survives the write it was read back from', () => {
    // A bare JSON array cannot carry Inf — JSON.stringify writes `null` — so once
    // the binary reader keeps Inf, the value must not stay a bare array or the
    // next save destroys it anyway. The typed literal is the spelling MATLAB
    // itself uses in an uncompressed-text dictionary: its own text artifact
    // carries nonFinVec as {"_type":"double","_value":"[1.0, Inf, -Inf, NaN, 5.0]"}.
    const n = entryOf('./artifacts/binary/cases.sldd', 'cases.sldd', 'nonFinVec');
    expect(JSON.stringify(n.serializeValue())).not.toContain('null');
    expect(n.serializeXml('P', { Name: 'Value' }, 0)).toContain('1.0 Inf -Inf NaN 5.0');
  });
});

// The `Matrix(...)` serial string had TWO writers with two different spellings, and
// only one of them was a spelling MATLAB can read. Phase 6 widened both to rank 3
// independently — BinarySlddParser.formatMatrix (the .sldd reader's output) and
// MatlabVariableNode._buildMatrixString (the node's write-back) — which is how the
// divergence survived: each phase check compared a writer against itself.
//
// MATLAB was asked directly, by patching one entry's value string in a copy of its
// own test/parity/artifacts/text/cases.sldd and opening each with
// Simulink.data.dictionary.open (script preserved at
// test/parity/matlab/probe_matrix_serial.m):
//
//   Matrix(2,3)\n[[1.0, 2.0, 3.0]; [4.0, 5.0, 6.0]]  -> double  [2 3]  1 4 2 5 3 6
//   Matrix(2,3)\n[[1, 2, 3]; [4, 5, 6]]              -> double  [2 3]  (.0 optional)
//   Matrix(2,3)\n[1, 2, 3]\n[4, 5, 6]                -> double  [1 0]  ** EMPTY **
//   Matrix(1,3)\n[1.0, 2.0, 3.0]                     -> double  [1 3]
//   Matrix(1,3)\n[[1.0, 2.0, 3.0]]                   -> double  [1 3]
//   Matrix(3,1)\n[[1.0]; [2.0]; [3.0]]               -> double  [3 1]
//   Matrix(1,3)\n[1, 0, 1]        (_type logical)    -> logical [1 3]
//   Matrix(2,3)\n[[1, 2, 3]; [4, 5, 6]] (_type int16)-> int16   [2 3]
//   Matrix(1,3)\n[...U, 1U, 0U]   (_type uint64)     -> uint64  [1 3]
//
// So MATLAB reads the bracketed group form at every shape and every class, and the
// newline-joined form as an EMPTY matrix — editing any multi-row matrix silently
// destroyed it. One shared writer now, XmlUtils.formatMatrixSerial, so the two
// cannot disagree again.
//
// What MATLAB reads and what MATLAB WRITES are two questions, and the row vector is
// where they part: it reads `Matrix(1,3)\n[1, 2, 3]` correctly, but it writes that
// value bare, `[1, 2, 3]`, keeping the header for the column where the shape is the
// only thing distinguishing the two orientations. The writer now agrees (defect 21) —
// so does BinarySlddParser's read path, which always had.
describe('cross-phase: one Matrix() spelling, the one MATLAB reads', () => {
  const MAT2X3 = 'Matrix(2,3)\n[[1.0, 2.0, 3.0]; [4.0, 5.0, 6.0]]';

  it('every format rebuilds mat2x3 into the bytes MATLAB itself wrote', () => {
    // MATLAB's own spelling, read out of its uncompressed-text dictionary rather
    // than transcribed: test/parity/artifacts/text/cases.sldd carries mat2x3 as
    // {"_type": "double", "_value": "Matrix(2,3)\n[[1.0, 2.0, 3.0]; [4.0, 5.0, 6.0]]"}.
    for (const [fmt, rel, filename] of FORMATS) {
      const n = entryOf(rel, filename, 'mat2x3');
      // An untouched .sldd value replays _rawInput verbatim, so the writer only
      // runs once the entry is modified — which is exactly when the old spelling
      // reached the file.
      n._markModified();
      const out = n.serializeValue() as any;
      expect(out._type, fmt).toBe('double');
      expect(out._value, fmt).toBe(MAT2X3);
      // The old form's signature: a second newline, one per row.
      expect(String(out._value).split('\n').length, fmt).toBe(2);
    }
  });

  it('an N-D matrix takes the cdata form, in every format, and reads back whole', () => {
    // Not the `Matrix(2,3,2)` literal this used to require. MATLAB has no inline
    // spelling of its own at rank >= 3 — mat2str errors "Input matrix must be
    // 2-D." — and it does not merely lack one: it READS every candidate back as an
    // empty 1x0, including the bracketed-group form it accepts at rank 2
    // (probe_rank3_serial.m). Its own dictionary writes a cdata MAT stream for
    // every rank >= 3 value of every class (probe_nd_rich.m), which is what the
    // writer now produces. The literal survives only as the fallback for a value
    // the MAT writer refuses (an MCOS opaque), which is why this asserts the form
    // AND that nothing was lost inside it.
    for (const [fmt, rel, filename] of FORMATS) {
      const n = entryOf(rel, filename, 'nd2x3x2');
      n._markModified();
      const out = n.serializeValue() as any;
      expect(out._type, fmt).toBe('cdata');
      const back = NodeRegistry.parseValue(out, 'nd2x3x2', null) as any;
      expect(back._dims, fmt).toEqual([2, 3, 2]);
      // Every element against the subscript MATLAB gives it, not against a
      // traversal order: the tree lists a numeric array's children row-major while
      // MATLAB's linear order is column-major (defect 14), so a check that only
      // compared sequences would pass on a value permuted into the wrong cells.
      const t = truthOf('nd2x3x2');
      const want = new Map<string, string>(
        t.linearSubs.map((s: string, i: number) => [s, String(t.linearValues[i])]),
      );
      expect(new Map(back.children.map((c: any) => [c.displayName, c.displayValue])), fmt).toEqual(want);
      // And the round trip moved nothing: same children, same order, as the node
      // the bytes were written from.
      expect(back.children.map((c: any) => c.displayName), fmt).toEqual(
        n.children.map((c: any) => c.displayName),
      );
    }
  });

  it('a typed class keeps the suffix MATLAB spells it with', () => {
    // formatNumLiteral's suffixes are MATLAB's own: its text dictionary writes a
    // uint64 vector as [18446744073709551615U, 1U, 0U] and a single as
    // 3.14159274F, and it read a suffixed Matrix() body back at the right class in
    // the probe above. The old writer used formatMatlabNum for every class, so the
    // suffix was dropped and the body no longer said what class it held.
    const n = NodeRegistry.parseValue(
      { _type: 'uint8', _value: 'Matrix(2,2)\n[[1, 2]; [3, 4]]' },
      'u8mat',
      null,
    ) as any;
    n._markModified();
    expect((n.serializeValue() as any)._value).toBe('Matrix(2,2)\n[[1U, 2U]; [3U, 4U]]');
  });

  it('a 64-bit vector write-back is exact, digit for digit', () => {
    // This test used to pin a KNOWN-WRONG value: our elements were JS numbers, so
    // 18446744073709551615 was already 18446744073709552000 by the time any writer saw
    // it, and the sweep that added this case owned only the CLASS half (the U suffix,
    // without which MATLAB reads the entry back as double).
    //
    // Both halves are right now. A token a double cannot hold is carried as its own
    // decimal TEXT from the reader to the writer (XmlUtils.parseExactNum), which matters
    // more than a rounding nit: 18446744073709552000 is OUT of uint64 range, and MATLAB
    // does not clamp such a token — it abandons the REST of the body, so the `1` here
    // came back as 0 too (defects 29 and 30, measured by probe_writeback_bin).
    const u = entryOf('./artifacts/text/cases.sldd', 'cases.sldd', 'u64Vec');
    expect(truth.vars.u64Vec.mat2str).toBe('[18446744073709551615 1 0]');
    u._markModified();
    // Bare, no `Matrix(1,3)` header: a row vector states no shape, which is MATLAB's
    // own spelling for this very entry (defect 21). With the digits exact, this string
    // is now MATLAB's own bytes for the entry.
    expect((u.serializeValue() as any)._value).toBe('[18446744073709551615U, 1U, 0U]');
  });

  it('our own reader reads the spelling our writer emits', () => {
    // The other half of a round trip: a writer whose output only MATLAB can read
    // would be no better than one only we can read.
    const n = entryOf('./artifacts/mat/cases.mat', 'cases.mat', 'mat2x3');
    n._markModified();
    const written = n.serializeValue();
    const reparsed = NodeRegistry.parseValue(written, 'mat2x3', null) as any;
    expect(reparsed.dims).toEqual([2, 3]);
    expect(reparsed.displayValue).toBe('[1 2 3; 4 5 6]');
    expect(reparsed.serializeValue()).toEqual(written);
  });
});
