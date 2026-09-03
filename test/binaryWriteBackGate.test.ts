// Copyright 2026 The MathWorks, Inc.
//
// The TypeScript half of the binary write-path gate.
//
// `test/parity/matlab/probe_writeback_bin.{mjs,m}` is the real acceptance test: it
// rebuilds every entry of every MATLAB-authored binary dictionary in the corpus through
// our serializer and asks MATLAB to read the zip back, comparing to the leaf. Before it
// existed nothing had ever asked MATLAB that question about the XML channel — the
// fidelity suite only ever reopened `params.sldd` after a scalar string edit — and the
// first run found four real defects behind five failing cases:
//
//   27  a uint64 array in a STRUCT FIELD went out as `Class="char"`. isNumericClass
//       omitted the 64-bit classes, so parseTypedValue fell to its `default` arm and
//       returned bare body text the writer could only spell as char. The entry-level
//       path never had the gap, which is why the same value was right at the top level
//       and wrong one level down.
//   28  an object's `saveobj` payload was destroyed. MATLAB writes a saveobj-serializing
//       class's whole state as one UNNAMED <P Source="saveobj">; the reader keyed it
//       under the literal string 'undefined' and the writer emitted
//       `Name="undefined"`, at which MATLAB's loadobj finds no envelope and rebuilds an
//       EMPTY object — cases.sldd's aVariant reopened with 0 choices where MATLAB wrote
//       2, its whole condition table gone.
//   29  64-bit integers lost their exactness before any writer saw them: every read path
//       funnelled through parseFloat, and MATLAB's 64-bit range is wider than a double's
//       exact one BY CONSTRUCTION. i64Unsafe — 2^53 + 1, which MATLAB itself wrote —
//       reopened as 9007199254740992: in range, and silently off by one.
//   30  and a token that lands OUT of range is worse than off by one, because MATLAB does
//       not clamp it — it abandons the REST of the body. u64Vec's
//       [18446744073709551615, 1, 0] went out as 18446744073709552000 1 0 and reopened as
//       [18446744073709551615, 0, 0]: a perfectly representable neighbour destroyed by its
//       neighbour's overflow. A SCALAR hides this — maxU64 PASSed before the fix, because
//       MATLAB saturates a lone out-of-range token to intmax('uint64'), which for that one
//       value happens to be the right answer. Hence the assertions on whole array bodies.
//
// These pin each fix in a test that runs without MATLAB, so a regression is caught by
// `npm test` rather than by the next probe run.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import DataModel from '../src/core/DataModel.js';
import '../src/datamodel/node/NodeClassMap.js';
import { parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import { buildDataChunkXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import * as NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import { SAVEOBJ_KEY } from '../src/datamodel/parser/XmlUtils.js';
import { loadFile, findEntry } from './parity/loadFile.js';

// Every node in the subtree, not just the root. _markModified walks UP (a child edit
// marks its ancestors stale), so marking the root alone leaves every descendant
// pristine and the writer replays their stored bytes instead of re-deriving them —
// which is exactly the path a rebuild has to exercise. Guarded on the method because
// SlddNode and SectionNode do not have one.
function deepMark(n: any): void {
  if (typeof n._markModified === 'function') {
    n._markModified();
  }
  for (const c of n.children ?? []) {
    deepMark(c);
  }
}

// The rebuilt data/chunk0.xml of a MATLAB-authored binary dictionary, every entry of it
// marked modified so nothing is replayed. This is the byte stream probe_writeback_bin
// hands MATLAB, minus the zip around it.
let seq = 0;
function rebuildXml(fixture: string): string {
  // `fixture` is relative to test/, so the two corpora — the hand-checked fixtures and
  // the MATLAB-authored parity artifacts — are named the same way.
  const p = fileURLToPath(new URL('./' + fixture, import.meta.url));
  const zip = unzipSync(new Uint8Array(readFileSync(p)));
  const xml = new TextDecoder().decode(zip['data/chunk0.xml']);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) {
    if (k !== 'data/chunk0.xml') {
      meta[k] = v;
    }
  }
  const uri = 'mem://wbgate' + ++seq;
  DataModel.removeDataSource(uri);
  const model = DataModel.addDataSource(uri, parseBinarySlddParts(xml, meta), { path: fixture });
  deepMark(model);
  return buildDataChunkXml(model);
}

/** The one `<P ...>` or `<Entry ...>` tag whose text names `name`, for an eyeball assert. */
function tagsNaming(xml: string, name: string): string[] {
  const re = new RegExp('<P[^>]*Name="' + name + '"[^>]*>', 'g');
  return xml.match(re) ?? [];
}

describe('defect 27: a 64-bit class survives one level down', () => {
  it('a uint64 struct field is written Class="uint64", not Class="char"', () => {
    // typed_binary.sldd's sTyped is MATLAB's own struct with a uint64 ARRAY field. The
    // gate saw it reopen as a char row of digits: the field's class was gone, so MATLAB
    // read text where a uint64 belonged.
    const xml = rebuildXml('fixtures/typed_binary.sldd');
    const d = tagsNaming(xml, 'd');
    expect(d.length).toBe(1);
    expect(d[0]).toContain('Class="uint64"');
    expect(d[0]).not.toContain('Class="char"');
  });

  it('and its digits are MATLAB\'s own, in order', () => {
    // MATLAB's own bytes for the field, read out of the fixture rather than transcribed:
    // test/fixtures/typed_binary.sldd carries it as
    //   <P Name="d" Class="uint64" Dimension="1*2">7 8</P>
    // The rebuilt chunk has to say the same thing — the class attribute alone is not
    // enough, since a body permuted or rounded under a right class reads back wrong.
    const xml = rebuildXml('fixtures/typed_binary.sldd');
    const body = xml.match(/<P[^>]*Name="d"[^>]*>([^<]*)<\/P>/);
    expect(body).not.toBeNull();
    expect(body![1].trim()).toBe('7 8');
  });
});

describe('defect 28: a saveobj envelope survives the round trip', () => {
  it('the envelope goes back out as Source="saveobj", never as Name="undefined"', () => {
    // The reader has to invent a bag key for an UNNAMED <P>, and the writer has to turn
    // that key back into the attributes MATLAB wrote. Keyed 'undefined' the writer
    // emitted `Name="undefined"`, which MATLAB's loadobj cannot recognize as an
    // envelope at all — it built a VariantVariable with no choices.
    const xml = rebuildXml('parity/artifacts/binary/cases.sldd');
    expect(xml).toContain('Source="saveobj" PropertyType="any"');
    expect(xml).not.toContain('Name="undefined"');
    expect(xml).not.toContain('Name="' + SAVEOBJ_KEY + '"');
  });

  it('and grows no Specification sibling the class never had', () => {
    // Compounding 28: under an envelope the individual properties are not siblings of
    // it, so VariantVariableNode read nothing, substituted its own '' default, and wrote
    // that back as a real <P>. An empty char standing in for a value MATLAB keeps
    // INSIDE the envelope.
    const xml = rebuildXml('parity/artifacts/binary/cases.sldd');
    const variant = xml.match(/<Element Class="Simulink\.VariantVariable">[\s\S]*?<\/Element>/);
    expect(variant).not.toBeNull();
    expect(variant![0]).toContain('Source="saveobj"');
    expect(tagsNaming(variant![0], 'Specification')).toEqual([]);
  });

  it('the reserved bag key is not a property, so it gets no tree row', () => {
    // '_' is the whole rule: a MATLAB identifier cannot begin with one, so a reserved
    // key can never hide a real property and a real property can never be mistaken for
    // one. Shown, the envelope would appear as an editable `_saveobj` struct row.
    const sldd = loadFile('./artifacts/binary/cases.sldd', 'cases.sldd');
    const v: any = findEntry(sldd, 'aVariant');
    expect(v.className).toBe('Simulink.VariantVariable');
    expect((v.children ?? []).map((c: any) => c.name)).not.toContain(SAVEOBJ_KEY);
  });
});

describe('defects 29 and 30: a 64-bit integer keeps every digit', () => {
  // The test is the ROUND TRIP, not the class: a value a double holds exactly stays a
  // number, and only a token that does not survive String(Number(t)) takes the decimal
  // text form. So these assertions are about MATLAB's own extreme values, which are
  // outside a double's exact range by construction.
  const EXTREMES: Array<[string, string]> = [
    ['maxU64', '18446744073709551615'],
    ['i64Unsafe', '9007199254740993'],
  ];

  for (const [name, digits] of EXTREMES) {
    it(name + ' reads back as its own digits, from the binary dictionary', () => {
      const sldd = loadFile('./artifacts/binary/cases.sldd', 'cases.sldd');
      const n: any = findEntry(sldd, name);
      expect(String(n._scalarValue)).toBe(digits);
    });

    it(name + ' is written back as its own digits', () => {
      // Asserted on the digits rather than on the entry's own tag: an entry's <Name> and
      // its <Value> are siblings several levels apart in the chunk, so a name-anchored
      // regex would pin the file's layout instead of the value. What matters is that the
      // exact digits reach the stream — and that the rounded spelling never does, which
      // the sibling test below checks for every wrong value the gate measured.
      const xml = rebuildXml('parity/artifacts/binary/cases.sldd');
      expect(xml).toContain(digits);
    });
  }

  it('no rounded 64-bit token reaches the file', () => {
    // The specific wrong values the gate measured. Any one of them back in the stream
    // means a read or write path has started converting again.
    const xml = rebuildXml('parity/artifacts/binary/cases.sldd');
    for (const wrong of ['18446744073709552000', '9223372036854776000', '-9223372036854776000']) {
      expect(xml).not.toContain(wrong);
    }
  });

  it('an int64 vector keeps both extremes AND the neighbour between them', () => {
    // Defect 30 is why this asserts the whole body rather than one element: MATLAB
    // abandons the rest of a body at the first out-of-range token, so the `-1` was
    // collateral damage from its neighbour's overflow.
    const xml = rebuildXml('parity/artifacts/binary/cases.sldd');
    const body = xml.match(/<P[^>]*Class="int64"[^>]*Dimension="1\*3"[^>]*>([^<]*)<\/P>/);
    expect(body).not.toBeNull();
    expect(body![1].trim()).toBe('9223372036854775807 -9223372036854775808 -1');
  });

  it('a uint64 vector keeps its neighbour too', () => {
    const xml = rebuildXml('parity/artifacts/binary/cases.sldd');
    const body = xml.match(/<P[^>]*Class="uint64"[^>]*Dimension="1\*3"[^>]*>([^<]*)<\/P>/);
    expect(body).not.toBeNull();
    expect(body![1].trim()).toBe('18446744073709551615 1 0');
  });

  it('the text .sldd literal keeps its digits and its U suffix', () => {
    // The other flavour, and the other spelling: a text dictionary carries a typed
    // array as one literal with MATLAB's own class suffix. Both halves have to be
    // right — digits alone read back at the wrong class, a suffix alone reads back
    // out of range.
    const n: any = NodeRegistry.parseValue(
      { _type: 'uint64', _value: '[18446744073709551615U, 1U, 0U]' },
      'u64Vec',
      null,
    );
    n._markModified();
    expect((n.serializeValue() as any)._value).toBe('[18446744073709551615U, 1U, 0U]');
  });

  it('a 64-bit MATRIX keeps its digits through the Matrix() literal', () => {
    // The third shape. _parseMatrixNums is the re-parse point here, and it was the one
    // chokepoint with no class in scope until it was given one.
    const n: any = NodeRegistry.parseValue(
      { _type: 'int64', _value: 'Matrix(2,2)\n[[9223372036854775807, 1]; [-9223372036854775808, 0]]' },
      'i64mat',
      null,
    );
    n._markModified();
    expect((n.serializeValue() as any)._value).toBe(
      'Matrix(2,2)\n[[9223372036854775807, 1]; [-9223372036854775808, 0]]',
    );
  });

  it('a value a double DOES hold stays a number', () => {
    // The exactness rule must not spread: every currently-passing path keeps its
    // representation, so only the tokens that were actually being corrupted change.
    // '+7' and '007' canonicalize to '7', so a cosmetic difference in the stored
    // spelling never on its own forces the text form.
    const n: any = NodeRegistry.parseValue({ _type: 'uint64', _value: '42U' }, 'small', null);
    expect(typeof n._scalarValue).toBe('number');
    expect(n._scalarValue).toBe(42);
  });
});
