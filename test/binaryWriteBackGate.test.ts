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
import '../src/datamodel/node/data/NodeClassMap.js';
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

let seq = 0;
/** A MATLAB-authored binary dictionary, parsed into a model. */
function loadBinaryModel(fixture: string): any {
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
  return DataModel.addDataSource(uri, parseBinarySlddParts(xml, meta), { path: fixture });
}

// The rebuilt data/chunk0.xml of a MATLAB-authored binary dictionary, every entry of it
// marked modified so nothing is replayed. This is the byte stream probe_writeback_bin
// hands MATLAB, minus the zip around it.
// `mutate` runs on the loaded model before the rebuild, for the cases that assert what an
// EDIT writes rather than what a replay preserves.
function rebuildXml(fixture: string, mutate?: (model: any) => void): string {
  const model = loadBinaryModel(fixture);
  if (mutate) {
    mutate(model);
  }
  deepMark(model);
  return buildDataChunkXml(model);
}

/** The node named `name` anywhere under `n` — the model rebuildXml built, not a loadFile tree. */
function findByName(n: any, name: string): any {
  if (n.name === name) {
    return n;
  }
  for (const c of n.children ?? []) {
    const found = findByName(c, name);
    if (found) {
      return found;
    }
  }
  return null;
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

describe('defect 46: an edit under a saveobj envelope goes where MATLAB reads it', () => {
  // The other half of 28. Once the envelope survived, an EDIT still did not reach it: the
  // new Specification was written only as a sibling <P>, and MATLAB's loadobj reads the
  // envelope, so a binary dictionary reopened with Specification '' after an edit to
  // 'myNewVar'. Our own reader reads the sibling too, so the in-process round trip agreed
  // with itself and only live MATLAB disagreed — writeback.live's variant case.
  //
  // aVariant's envelope wraps ONE <Element> whose fields are Choices, Specification, Bank,
  // in MATLAB's own order. "Inside the envelope" is asserted as "between Choices and Bank",
  // which pins the placement and that order together.
  function variantBlock(xml: string): string {
    const at = xml.indexOf('<Element Class="Simulink.VariantVariable">');
    expect(at).toBeGreaterThan(-1);
    return xml.slice(at, xml.indexOf('</Object>', at));
  }

  function edited(): string {
    return variantBlock(
      rebuildXml('parity/artifacts/binary/cases.sldd', (model) => {
        expect(findByName(model, 'aVariant').setProperty('Specification', 'myNewVar')).toBe(true);
      }),
    );
  }

  it('the new value is written INSIDE the envelope', () => {
    expect(edited()).toMatch(
      /<P Source="saveobj"[\s\S]*<P Name="Choices"[\s\S]*<P Name="Specification" Class="char">myNewVar<\/P>[\s\S]*<P Name="Bank"/,
    );
  });

  it('and the sibling stays, because it is the copy this reader can see', () => {
    // A CONTROL on what the fix must not change, not a regression test for 46 — the sibling
    // was always written, which was the whole problem. It is kept deliberately: nothing here
    // decodes the envelope back into a node property, so dropping it would make our own
    // round trip lose the edit that MATLAB now keeps. The envelope is for MATLAB, the
    // sibling is for us.
    //
    // Positional, not counted: a count of 2 is green either way, since the envelope declares
    // a Specification field whether or not anything wrote to it. The sibling is the one that
    // closes the <Element>, after the envelope's own </P>.
    expect(edited()).toMatch(/<\/P>\s*<P Name="Specification" Class="char">myNewVar<\/P>\s*<\/Element>/);
  });

  it('an UNedited entry writes neither, and MATLAB\'s own empty stays a 0x0 double', () => {
    // The control, and the reason the empty override is dropped rather than written: read
    // through the sibling that is not there, Specification is '' — a default, not a value.
    // Written back it would replace MATLAB's 0x0 double with an empty char.
    const block = variantBlock(rebuildXml('parity/artifacts/binary/cases.sldd'));
    expect(tagsNaming(block, 'Specification')).toHaveLength(1);
    expect(block).toContain('<P Name="Specification" Class="double" Dimension="0*0"/>');
  });

  it('a field the envelope does not declare leaves it untouched, and copies never mutate', () => {
    // On _mergeProps directly, not on the rebuilt XML: _getSerializedProperties offers
    // nothing but Specification, so an XML assertion about an undeclared field would be
    // green no matter what the guard did.
    const v: any = findByName(loadBinaryModel('parity/artifacts/binary/cases.sldd'), 'aVariant');
    const stored = (v.serial._properties as Record<string, unknown>)[SAVEOBJ_KEY] as any;

    // A declared field goes in — and into a COPY, since this runs during serialization and
    // the envelope is parse state shared with _rawVal.
    const written = v._mergeProps({ Specification: 'myNewVar' })[SAVEOBJ_KEY] as any;
    expect(written).not.toBe(stored);
    expect(written._elements[0].Specification).toBe('myNewVar');
    expect(stored._elements[0].Specification).toEqual([]);

    // An undeclared one does not: the same object back, so nothing was rebuilt or reached.
    expect(v._mergeProps({ NotAField: 'x' })[SAVEOBJ_KEY]).toBe(stored);
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

// A string Value edited into a MATLAB-authored Parameter, through the same rebuild the
// gate hands MATLAB. Two writers had to be wrong at once for this to reach a file, and
// the second was invisible while the first hid it:
//
//   * ParameterNode.setProperty had no arm for a string SCALAR, so `"abc"` fell to the
//     catch-all that stores the parser's bare JS string — this model's spelling for a
//     CHAR. The cell then displayed 'abc' and the value saved as char.
//   * serializePropertyXml had no arm for either string shape, so once the class was
//     kept, the one-element list took the NUMERIC-array branch and formatDoubleXml
//     spelled its text `NaN`, and the multi-element wrapper reached the char fallback
//     as the literal `[object Object]`.
//
// So the assertion is a reopen, not a text match: the value has to come back out of the
// rebuilt chunk as the string it went in as.
describe('a string Parameter value survives the binary write-back', () => {
  const stringParam = (model: any) => {
    const p = findByName(model, 'aParam');
    expect(p.setProperty('Value', '"abc"')).toBe(true);
    return p;
  };

  /**
   * The `<Object>` block of the named entry. Scoped rather than global, because the two
   * spellings this test refuses are legitimate elsewhere in this very dictionary: MATLAB
   * wrote a real `Class="double">NaN` entry into cases.sldd, so a chunk-wide
   * `not.toContain('NaN')` fails on MATLAB's own data.
   */
  const entryBlock = (xml: string, name: string): string => {
    const at = xml.indexOf('>' + name + '</P>');
    const open = xml.lastIndexOf('<Object ', at);
    return xml.slice(open, xml.indexOf('</Object>', at));
  };

  it('writes MATLAB\'s string envelope rather than a numeric or char body', () => {
    const block = entryBlock(rebuildXml('parity/artifacts/binary/cases.sldd', stringParam), 'aParam');
    expect(block).toContain('<Element Class="string">');
    expect(block).toContain('<Element Class="char">abc</Element>');
    // The two spellings the missing arms produced.
    expect(block).not.toContain('NaN');
    expect(block).not.toContain('[object Object]');
  });

  it('reopens as a string, and as the same text', () => {
    const xml = rebuildXml('parity/artifacts/binary/cases.sldd', stringParam);
    const uri = 'mem://strparam';
    DataModel.removeDataSource(uri);
    const reopened = DataModel.addDataSource(uri, parseBinarySlddParts(xml, {}), { path: 'cases.sldd' });
    // The double quotes ARE the assertion: 'abc' would be the char this used to save.
    expect(findByName(reopened, 'aParam').displayValue).toBe('"abc"');
  });
});

// Defect 52 — a `string` inside a CELL, in the binary channel only. The report was
// cosmetic (`{"a"}` displayed as `{<1x1 string>}`) and the write path was not: rebuilt,
// that element went out as an EMPTY `<Element Class="string">`, so the text was gone from
// the file. Both halves have one cause, and it is this repo's recurring one. Three sites
// in BinarySlddParser nest MATLAB's string object — parseEntryValue for an entry's own
// value, parsePropContent for a struct field or an object property, parseCellElement for a
// cell element — and only the first two had a `Class="string"` branch. Without it the
// element fell through to the generic nested-object tail and decoded as an OBJECT of class
// `string`, whose text sits in the saveobj bag where neither a formatter nor a writer
// looks: hence the summary on screen and the empty envelope in the file.
//
// The fixtures are MATLAB's own, written by `test/parity/matlab/probe_cell_string.m`,
// which also records the shape the missing branch keys on: a cell element holding an
// OBJECT is a classless `<Element>` wrapping the object's own `<Element Class="...">`.
// That shape is why the tail was right for every other class, and why the fix lifts
// `string` out of it rather than replacing it.
/**
 * The `<Object>` block of one entry, from a chunk either MATLAB or we wrote, with its
 * LastMod stamp dropped — a rebuild restamps a modified entry, by design, so the stamp is
 * the one line that cannot match and the only one whose mismatch means nothing.
 */
function entryObject(xml: string, name: string): string {
  const at = xml.indexOf('>' + name + '</P>');
  expect(at, name).toBeGreaterThan(-1);
  const open = xml.lastIndexOf('<Object ', at);
  const block = xml.slice(open, xml.indexOf('</Object>', at) + '</Object>'.length);
  return block.replace(/\s*<P Name="LastMod"[^>]*>[^<]*<\/P>/, '');
}

/** MATLAB's own chunk for a fixture, to diff a rebuild against. */
function matlabChunk(fixture: string): string {
  const p = fileURLToPath(new URL('./' + fixture, import.meta.url));
  const zip = unzipSync(new Uint8Array(readFileSync(p)));
  return new TextDecoder().decode(zip['data/chunk0.xml']);
}

describe('defect 52: a string in a cell keeps its text, in the file as well as on screen', () => {
  // MATLAB's own value for each, as `getValue()` reports it in probe_cell_string.m's
  // read-back — `cell[1 1] of {string[1 1]}` and so on.
  const CELLS: Array<[string, string]> = [
    ['cStr', '{"a"}'], // the reported case
    ['cStrArr', '{["a" "b"]}'], // a string ARRAY in a cell: the shape has to survive too
    ['cStrTwo', '{"a", "b"}'], // two elements, each wrapped on its own
    ['cMixed', '{1, "a", \'b\'}'], // beside a double and a char, neither of which it may become
  ];

  it('reads MATLAB\'s own bytes as strings, not as <1x1 string>', () => {
    const sldd = loadFile('../fixtures/cellstr_binary.sldd', 'cellstr_binary.sldd');
    for (const [name, display] of CELLS) {
      expect(String(findEntry(sldd, name).displayValue), name).toBe(display);
    }
    // The CLASS as well as the text: decoded as an object the child's whole value was the
    // summary string, so a text-only assertion could pass on a node with no string in it.
    expect(findEntry(sldd, 'cStr').children[0].dataType).toBe('string');
    expect(findEntry(sldd, 'cStrArr').children[0].dataType).toBe('string');
    // The control that keeps the fix narrow: a non-string object in a cell still goes
    // through the nested-object tail the string branch was lifted out of.
    expect(findEntry(sldd, 'cObj').children[0].className).toBe('Simulink.Parameter');
    // And the sibling site that already had its branch, so a regression there is visible
    // here too rather than only in the entry-level tests. Asserted on the FIELD, because a
    // struct entry summarizes: sStr's own display is `<1x1 struct>` whatever its field holds.
    const f = findEntry(sldd, 'sStr').children[0];
    expect(f.name).toBe('f');
    expect(String(f.displayValue)).toBe('"a"');
    expect(f.dataType).toBe('string');
  });

  it('and reads them the same way the TEXT channel does', () => {
    // The invariant the defect broke, stated BETWEEN the channels rather than as two
    // per-channel expectations: one dictionary saved in either format is one value. Two
    // separate expectations is what this repo had — the JSON channel was right the whole
    // time and said nothing about the XML one.
    const bin = loadFile('../fixtures/cellstr_binary.sldd', 'cellstr_binary.sldd');
    // Every ELEMENT too, not just the entry row: the element is where the class lives, and
    // `{<1x1 string>}` differs from `{"a"}` at the entry row only because the element's
    // display is interpolated into it. A container whose row agreed and whose contents did
    // not is exactly what this defect was.
    const txt = loadFile('../fixtures/cellstr_text.sldd', 'cellstr_text.sldd');
    const shown = (root: any, name: string): string[] => {
      const n = findEntry(root, name);
      return [String(n.displayValue), ...n.children.map((c: any) => String(c.displayValue))];
    };
    for (const [name] of [...CELLS, ['cObj']]) {
      expect(shown(bin, name), name).toEqual(shown(txt, name));
    }
    // sStr is compared on its own row alone, and deliberately not on its field. The channels
    // DISAGREE there, for a reason that has nothing to do with strings or with cells: the
    // build of MATLAB that wrote these two fixtures (27.1.0.3393633) no longer emits
    // `_fields` in a text dictionary, and StructNode.parse builds a scalar struct's field
    // children from `_fields` alone — so the text channel shows this struct with no field row
    // at all, while the binary channel derives the list from the element bag
    // (BinarySlddParser's `_fields: Object.keys(parsed[0])`). That is its own defect, with its
    // own blast radius — every struct in every current-MATLAB text .sldd — and it is not
    // asserted either way here.
    expect(String(findEntry(bin, 'sStr').displayValue)).toBe(
      String(findEntry(txt, 'sStr').displayValue),
    );
  });

  it('writes every saveobj payload back, rather than an empty envelope', () => {
    // The silent half, on the rebuild probe_writeback_bin hands MATLAB and with nothing
    // edited: before the fix, merely SAVING a dictionary that contained a string in a cell
    // deleted the text.
    const xml = rebuildXml('fixtures/cellstr_binary.sldd');
    expect(xml).not.toMatch(/<Element Class="string">\s*<\/Element>/);
    expect(xml).not.toContain('<Element Class="string"/>');
    // Counted, because "no empty envelope" is also true of a chunk that dropped the
    // elements entirely. Six strings in six places: cStr, cStrArr, cStrTwo x2, cMixed,
    // sStr — every nesting site the format has, in one file.
    const envelopes = xml.match(/<P Source="saveobj" PropertyType="any" Class="cell"/g) ?? [];
    expect(envelopes).toHaveLength(6);
    expect(xml.match(/<P Source="saveobj" PropertyType="any" Class="cell" Dimension="1\*2"/g))
      .toHaveLength(1); // cStrArr's, the only one that is not 1x1
  });

  it('and the rebuilt chunk reopens as the values MATLAB wrote', () => {
    // End to end, which is the assertion that would have failed loudest before the fix:
    // read MATLAB's file, write it back untouched, read that. Text-level checks can all
    // pass on a chunk whose envelope is intact but attached to the wrong element.
    const xml = rebuildXml('fixtures/cellstr_binary.sldd');
    const uri = 'mem://cellstr-reopen';
    DataModel.removeDataSource(uri);
    const reopened = DataModel.addDataSource(uri, parseBinarySlddParts(xml, {}), {
      path: 'cellstr_binary.sldd',
    });
    for (const [name, display] of CELLS) {
      expect(String(findByName(reopened, name).displayValue), name).toBe(display);
    }
  });

  it('byte for byte MATLAB\'s own, for the cells MATLAB writes a Dimension on', () => {
    // The strongest form available: the rebuilt entry IS MATLAB's bytes. Restricted to the
    // two multi-element cells because of one difference that predates this defect and has
    // nothing to do with strings — on a 1x1 cell we write `Dimension="1*1"` where MATLAB
    // writes no attribute at all (cObj's Simulink.Parameter cell has it too, and it
    // round-trips: parseEntryValue defaults an absent Dimension to 1x1). That is save
    // churn, not data loss, and pinning these two keeps the string bytes themselves exact
    // while leaving that one free.
    const ours = rebuildXml('fixtures/cellstr_binary.sldd');
    const theirs = matlabChunk('fixtures/cellstr_binary.sldd');
    for (const name of ['cStrTwo', 'cMixed']) {
      expect(entryObject(ours, name), name).toBe(entryObject(theirs, name));
    }
  });
});

// Defects 53, 54 and 55 — the generalization of 52, found by asking what ELSE the cell
// site is missing rather than what else is wrong with strings. `parseCellElement` is a
// hand-rolled copy of the class dispatch the entry site (`parseEntryValue`) and the
// property/field site (`parsePropContent`) share, so every idea added to the shared
// dispatch has to be added to the copy by hand — and the copy lagged by three:
//
//   53  a complex ARRAY in a cell lost its imaginary parts. The copy asked the SHAPE
//       before the complexity, and a complex body (`1.0+2.0i 3.0-4.0i`) read through
//       numericBody means parseFloat stopping at the `+`: `{[1+2i 3-4i]}` displayed
//       `{[1 3]}` and went back out as `Class="double" Dimension="1*2">1.0 3.0`, with
//       IsComplex gone too. A complex SCALAR was right the whole time — MATLAB writes one
//       with NO Dimension, so it fell past the shaped arm and reached the IsComplex check.
//       That control is the only reason this sat undetected.
//   54  a struct ARRAY in a cell was published as `<1x1 struct>`: the copy passed a
//       hardcoded [1, 1] where the shared dispatch reads the element's own Dimension. The
//       display was the harmless half — the envelope's dims are what the writer spells, so
//       a save wrote ONE struct with the elements a level too deep and the next open found
//       neither of them.
//   55  an object ARRAY in a cell showed only its first object, because the copy's tail
//       took `childElements[0]`. `{[Simulink.Parameter(1) Simulink.Parameter(2)]}` read as
//       though the cell held a scalar, and every object after the first was gone from the
//       file on any save.
//
// All three are binary-only; the TEXT channel was right for all of them, which is this
// repo's recurring shape — two channels spelling one value independently. So the invariant
// is pinned BETWEEN the channels here, not per channel.
//
// The fix is one idea, not three: "a dimensioned element set", which the shared dispatch
// already had in `parseArrayOfElements`. `test/parity/matlab/probe_cell_arrays.m` records
// the three spellings MATLAB uses for it and wrote both fixtures.
describe('defects 53-55: an array inside a cell keeps its shape, its parts and its count', () => {
  // MATLAB's own value for each, from probe_cell_arrays.m's read-back through
  // `getValue()` — `cell[1 1]{double[1 2]=[1+2i 3-4i]}` and so on.
  const DEFECTS: Array<[string, string]> = [
    ['cCplxArr', '{[1+2i 3-4i]}'], // 53, read `{[1 3]}`
    ['cCplxCol', '{[1+2i; 3-4i]}'], //   ... a column, to show the shape is not the trigger
    ['cCplxNd', '{<2x2x2 double>}'], //   ... and rank 3
    ['cStructArr', '{<1x2 struct>}'], // 54, read `{<1x1 struct>}`
    ['cStructArr2D', '{<2x2 struct>}'], //   ... 2-D, so the dims are read and not counted
    ['cObjArr', '{<1x2 Simulink.Parameter>}'], // 55, read `{1}` — the first object alone
  ];

  // The 1x1 of each row above. Each was right BEFORE the fix, and each is why its defect
  // was invisible; all three must still be right after it.
  const CONTROLS: Array<[string, string]> = [
    ['cCplx', '{1+2i}'], // 53's control: no Dimension, so it reached the IsComplex check
    ['cStruct', '{<1x1 struct>}'], // 54's: the hardcoded 1x1 happened to be the truth
    ['cObj', '{5}'], // 55's: one child, so taking the first was taking all of them
    ['cNd', '{<2x3x2 double>}'], // a REAL N-D array still takes the shaped arm
    ['cStr', '{"a"}'], // and defect 52's case still gets lifted out of the tail
  ];

  it('reads MATLAB\'s own bytes as the values MATLAB wrote', () => {
    const sldd = loadFile('../fixtures/cellarr_binary.sldd', 'cellarr_binary.sldd');
    for (const [name, display] of [...DEFECTS, ...CONTROLS]) {
      expect(String(findEntry(sldd, name).displayValue), name).toBe(display);
    }

    // The element rows, because an entry row is assembled FROM them: the class and the
    // count are what the three defects destroyed, and a summary string can be right for
    // the wrong reason.
    const element = (name: string): any => findEntry(sldd, name).children[0];
    expect(element('cCplxArr').children.map((c: any) => String(c.displayValue))).toEqual([
      '1+2i',
      '3-4i',
    ]);
    expect(element('cStructArr').children).toHaveLength(2);
    expect(element('cStructArr2D').children).toHaveLength(4);
    // Each object, and each object's own value — `{1}` was the first object's value shown
    // as if it were the cell's, so the count is the assertion that fails without the fix.
    expect(element('cObjArr').className).toBe('Simulink.Parameter');
    expect(element('cObjArr').children.map((c: any) => String(c.displayValue))).toEqual(['1', '2']);
  });

  it('and reads them the same way the TEXT channel does', () => {
    // The invariant stated between the channels. Whole subtrees, not just the entry rows:
    // 54 and 55 both left the entry row's SHAPE plausible while the contents underneath
    // were wrong or missing.
    const bin = loadFile('../fixtures/cellarr_binary.sldd', 'cellarr_binary.sldd');
    const txt = loadFile('../fixtures/cellarr_text.sldd', 'cellarr_text.sldd');

    // The walk stops at a SCALAR struct, and nowhere else. That is the one place the two
    // channels are known to disagree for a reason unrelated to cells: the build of MATLAB
    // that wrote these fixtures no longer emits `_fields` in a text dictionary, and
    // StructNode.parse builds a scalar struct's field children from `_fields` alone, so the
    // text channel shows a scalar struct with no field rows while the binary channel
    // derives the list from the element bag. Its own defect, its own blast radius (every
    // struct in every current-MATLAB text .sldd), not asserted either way here.
    const shown = (root: any, name: string): string[] => {
      const out: string[] = [];
      const walk = (n: any, path: string): void => {
        out.push(path + '  ' + String(n.displayValue) + ' | ' + String(n.dataType ?? '') + ' | ' + String(n.className ?? ''));
        if (n.dataType === 'struct' && String(n.displayValue) === '<1x1 struct>') {
          return;
        }
        for (const c of n.children ?? []) {
          walk(c, path + '/' + c.name);
        }
      };
      walk(findEntry(root, name), name);
      return out;
    };

    for (const [name] of [...DEFECTS, ...CONTROLS]) {
      expect(shown(bin, name), name).toEqual(shown(txt, name));
    }
    // And a row count, so a walk that silently visited only the entry rows could not pass:
    // the six defect cases have 32 rows between them (an entry and its element each, plus
    // 2 + 2 + 8 numeric parts, 2 + 4 struct elements, and 2 objects).
    expect(DEFECTS.reduce((n, [name]) => n + shown(bin, name).length, 0)).toBe(32);
  });

  it('writes each array back the way MATLAB spells it', () => {
    // The silent half. Nothing is edited — before the fix, merely SAVING any of these
    // dictionaries changed the data, so the rebuild probe_writeback_bin hands MATLAB is
    // where the loss shows.
    const xml = rebuildXml('fixtures/cellarr_binary.sldd');

    // 53: the complexity and the shape on the same element, the parts as text.
    expect(entryObject(xml, 'cCplxArr')).toContain(
      '<Element Class="double" IsComplex="1" Dimension="1*2">1.0+2.0i 3.0-4.0i</Element>',
    );
    // The spelling the defect produced, which is the one that must never reach a file:
    // a real array where MATLAB wrote a complex one.
    expect(entryObject(xml, 'cCplxArr')).not.toContain('>1.0 3.0<');
    expect(entryObject(xml, 'cCplxCol')).toContain('IsComplex="1" Dimension="2*1"');
    expect(entryObject(xml, 'cCplxNd')).toContain('IsComplex="1" Dimension="2*2*2"');

    // 54: the shape on the element that declares the class, one child per struct — and
    // NOT a `Class="struct"` with no Dimension, which is what the hardcoded 1x1 wrote and
    // what put the elements a level too deep.
    expect(entryObject(xml, 'cStructArr')).toContain('<Element Class="struct" Dimension="1*2">');
    expect(entryObject(xml, 'cStructArr2D')).toContain('<Element Class="struct" Dimension="2*2">');
    expect(entryObject(xml, 'cStructArr')).not.toMatch(/<Element Class="struct">/);

    // 55: a CLASSLESS wrapper carrying the shape, over one classed object each. Counted,
    // because the defect wrote a well-formed wrapper containing only the first object.
    expect(entryObject(xml, 'cObjArr')).toContain('<Element Dimension="1*2">');
    expect(entryObject(xml, 'cObjArr').match(/<Element Class="Simulink\.Parameter">/g)).toHaveLength(
      2,
    );
  });

  it('byte for byte MATLAB\'s own, for every entry in the fixture', () => {
    // The strongest form: the rebuilt entry IS MATLAB's bytes. One difference is normalized
    // away, and it predates all three defects — on a 1x1 cell we write `Dimension="1*1"`
    // where MATLAB writes no attribute at all. That is save churn, not data loss (an absent
    // Dimension is read back as 1x1), and since every entry here is a 1x1 cell, leaving it
    // unnormalized would mean comparing nothing instead of comparing everything.
    const ours = rebuildXml('fixtures/cellarr_binary.sldd');
    const theirs = matlabChunk('fixtures/cellarr_binary.sldd');
    const churn = (block: string): string =>
      block.replace(/Class="cell" Dimension="1\*1"/g, 'Class="cell"');
    for (const [name] of [...DEFECTS, ...CONTROLS]) {
      expect(churn(entryObject(ours, name)), name).toBe(churn(entryObject(theirs, name)));
    }
    // The sibling sites too, unnormalized: they were already right, and a fix that reached
    // the shared helper would break them here rather than quietly.
    for (const name of ['sObjArr', 'sStructArr', 'pCplxArr']) {
      expect(entryObject(ours, name), name).toBe(entryObject(theirs, name));
    }
  });

  it('and the rebuilt chunk reopens as the values MATLAB wrote', () => {
    // End to end: read MATLAB's file, write it back untouched, read that. This is the one
    // that fails loudest without the fix — 54 and 55 both wrote chunks that PARSE, and
    // reopen missing their data.
    const xml = rebuildXml('fixtures/cellarr_binary.sldd');
    const uri = 'mem://cellarr-reopen';
    DataModel.removeDataSource(uri);
    const reopened = DataModel.addDataSource(uri, parseBinarySlddParts(xml, {}), {
      path: 'cellarr_binary.sldd',
    });
    for (const [name, display] of [...DEFECTS, ...CONTROLS]) {
      expect(String(findByName(reopened, name).displayValue), name).toBe(display);
    }
    expect(findByName(reopened, 'cObjArr').children[0].children).toHaveLength(2);
  });
});
