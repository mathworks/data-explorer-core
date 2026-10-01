// Copyright 2026 The MathWorks, Inc.
// The hand-rolled dictionary reader (src/datamodel/parser/DictionaryXmlFast.ts), rule by rule.
//
// WHY THIS FILE EXISTS WHEN A 469 MB CORPUS DIFFERENTIAL ALREADY PASSES
//
// `.scratch/probe-differential.mjs` reads all 32 binary dictionaries available through both
// readers and compares 18,505,864 keys including insertion order. That is the claim that
// matters — and it is blind in exactly one direction. A corpus proves what the reader DOES
// emit for the shapes the writer HAPPENS to produce, and says nothing about the branches it
// never reaches. No dictionary in that corpus has mixed content, a `>` inside an attribute
// value, a comment, a numeric character reference, or two siblings whose attribute counts
// differ in a way that would expose a stale slot. Those are this file's job.
//
// THE TWO CLAIMS, AND WHY EACH CASE ASSERTS BOTH
//
// The reader's whole contract is "indistinguishable from the general engine, or `null`". So
// every accepted case asserts three things at once (`expectRead`): the reader produced the
// written-down value, the general engine produces the same written-down value, and the key
// INSERTION ORDER matches the literal — which `toEqual` does not check and which
// `BinarySlddParser` depends on, because it walks keys to decide what a property is.
//
// A DELIBERATE DEPARTURE from `xmlReader.test.ts`, whose rule is that expected values are
// literal and never computed from the engine. That rule is kept — every value below is a
// literal, harvested once by `.scratch/probe-fast-expected.mjs` and written down — but this
// file ALSO compares against the live engine, which that file never does. The difference is
// what is under test. There, the engine is the subject and comparing it to itself would prove
// nothing. Here the subject is a SECOND implementation, and "it still matches the engine" is
// not circularity, it is the specification. The literal catches the case both readers change
// together; the engine comparison catches the case only one does. Neither alone is enough.
//
// `readDictionaryXmlGeneric` exists for the engine half. Going through `readDictionaryXml`
// instead would compare the fast reader against itself, since the seam consults it first.
//
// WHAT THE DECLINE CASES ASSERT, which is the part worth reading twice
//
// `null` from this reader is not an error — it means the seam falls back, and the fallback is
// the specification. So `expectDeclined` pins the decline AND pins what the seam still answers,
// taken from the engine. That second assertion is the entire safety argument of the design: a
// decline cannot be wrong, only slower. If someone later teaches the reader to accept one of
// those inputs, the decline assertion goes red and the engine value sitting right beside it
// says what the new code has to produce.

import { describe, it, expect } from 'vitest';
import {
  readDictionaryXml,
  readDictionaryXmlGeneric,
} from '../src/datamodel/parser/XmlReader.js';
import { readDictionaryXmlFast } from '../src/datamodel/parser/DictionaryXmlFast.js';

/**
 * Every key in insertion order, as `$.path.key` strings.
 *
 * `toEqual` compares objects by content and ignores the order their keys were inserted in, so
 * without this a reader that emitted attributes before children would pass every assertion
 * below. The order is not cosmetic: fast-xml-parser's `compress` fills children, then text,
 * then attributes, and this reader has to land in the same sequence.
 */
function keyOrder(value: unknown, path = '$', out: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((v, i) => keyOrder(v, `${path}[${i}]`, out));
  } else if (value !== null && typeof value === 'object') {
    for (const k of Object.keys(value as Record<string, unknown>)) {
      out.push(`${path}.${k}`);
      keyOrder((value as Record<string, unknown>)[k], `${path}.${k}`, out);
    }
  }
  return out;
}

/** An input the fast reader reads, and the one value both readers must produce for it. */
function expectRead(xml: string, expected: unknown): void {
  const fast = readDictionaryXmlFast(xml);
  // Checked first and on its own: a case that silently declines would still pass the two
  // comparisons below (through the fallback) while proving nothing about the reader.
  expect(fast, `the fast reader DECLINED ${JSON.stringify(xml)}`).not.toBeNull();
  expect(fast, 'fast reader').toEqual(expected);
  expect(readDictionaryXmlGeneric(xml), 'general engine').toEqual(expected);
  expect(keyOrder(fast), 'fast reader key order').toEqual(keyOrder(expected));
  expect(keyOrder(readDictionaryXmlGeneric(xml)), 'engine key order').toEqual(keyOrder(expected));
}

/**
 * An input the fast reader refuses, and what the seam answers anyway.
 *
 * The second assertion is the point. A decline is only harmless because `readDictionaryXml`
 * hands the same text to the engine, so each of these pins a behaviour the seam KEEPS — not
 * a gap.
 */
function expectDeclined(xml: string, stillReadsAs: unknown): void {
  expect(readDictionaryXmlFast(xml), `should have declined ${JSON.stringify(xml)}`).toBeNull();
  expect(readDictionaryXmlGeneric(xml), 'general engine').toEqual(stillReadsAs);
  expect(readDictionaryXml(xml), 'the seam, which is what callers get').toEqual(stillReadsAs);
}

describe('the object shape', () => {
  it('puts an attribute under `@_` and text under `#text`', () => {
    expectRead('<P Name="v">x</P>', { P: [{ '#text': 'x', '@_Name': 'v' }] });
  });

  it('collapses an element with only text to that text', () => {
    expectRead('<P>x</P>', { P: ['x'] });
  });

  it('collapses an empty element with no attributes to the empty STRING', () => {
    // Not `{}` and not `null`. Half of `BinarySlddParser`'s branches test for this.
    expectRead('<P/>', { P: [''] });
    expectRead('<P></P>', { P: [''] });
  });

  it('never collapses an element that has attributes', () => {
    // The asymmetry worth stating twice: `<P/>` is `''` but `<P Name="x"/>` is an object with
    // no `#text` key at all. A reader that collapsed both, or neither, would be wrong twice.
    expectRead('<P Name="x"/>', { P: [{ '@_Name': 'x' }] });
    expectRead('<P Name="x"></P>', { P: [{ '@_Name': 'x' }] });
  });

  it('keeps `#text` beside attributes when both are present', () => {
    expectRead('<P Name="x"> </P>', { P: [{ '#text': ' ', '@_Name': 'x' }] });
  });

  it('nests', () => {
    expectRead('<DataSource><Object Class="c"><P Name="n">7</P></Object></DataSource>', {
      DataSource: { Object: [{ P: [{ '#text': 7, '@_Name': 'n' }], '@_Class': 'c' }] },
    });
  });
});

describe('array forcing', () => {
  it('makes a SINGLE `P`, `Element`, `Object` or `Field` an array', () => {
    expectRead('<DataSource><P>1</P></DataSource>', { DataSource: { P: [1] } });
    expectRead('<DataSource><Element>1</Element></DataSource>', { DataSource: { Element: [1] } });
    expectRead('<DataSource><Object>1</Object></DataSource>', { DataSource: { Object: [1] } });
    expectRead('<DataSource><Field>1</Field></DataSource>', { DataSource: { Field: [1] } });
  });

  it('does NOT force a name outside that list', () => {
    // `DataSource` is the only other name in the vocabulary, so it is the only name available
    // to prove the un-forced path is still there. One stays an object...
    expectRead('<DataSource><DataSource>1</DataSource></DataSource>', {
      DataSource: { DataSource: 1 },
    });
    // ...and a repeat becomes an array, which is the behaviour `isArray` exists to remove.
    expectRead(
      '<DataSource><DataSource>1</DataSource><DataSource>2</DataSource></DataSource>',
      { DataSource: { DataSource: [1, 2] } },
    );
  });

  it('collects interleaved repeats under one key, in document order', () => {
    expectRead('<DataSource><P>1</P><Element>2</Element><P>3</P></DataSource>', {
      DataSource: { P: [1, 3], Element: [2] },
    });
  });
});

describe('key insertion order', () => {
  it('is children in document order, then `#text`, then attributes', () => {
    // The order `compress` produces, and the reason `closeSlot` writes `#text` before it
    // copies the attribute buffers rather than after.
    const xml = '<DataSource A="1" B="2"><P/>t<Element/></DataSource>';
    expectRead(xml, {
      DataSource: { P: [''], Element: [''], '#text': 't', '@_A': '1', '@_B': '2' },
    });
    expect(keyOrder(readDictionaryXmlFast(xml))).toEqual([
      '$.DataSource',
      '$.DataSource.P',
      '$.DataSource.Element',
      '$.DataSource.#text',
      '$.DataSource.@_A',
      '$.DataSource.@_B',
    ]);
  });

  it('keeps attributes in DOCUMENT order, not alphabetical and not table order', () => {
    // `B` before `A` proves it is not sorted; `Name` and `Class` are in `ATTR_KEYS` and `B`/`A`
    // are not, so this also proves the interned-key lookup does not reorder around a miss.
    expectRead('<DataSource B="1" A="2" Name="3" Class="4"/>', {
      DataSource: { '@_B': '1', '@_A': '2', '@_Name': '3', '@_Class': '4' },
    });
    expect(keyOrder(readDictionaryXmlFast('<DataSource B="1" A="2" Name="3" Class="4"/>'))).toEqual(
      ['$.DataSource', '$.DataSource.@_B', '$.DataSource.@_A', '$.DataSource.@_Name', '$.DataSource.@_Class'],
    );
  });
});

describe('the XML declaration', () => {
  it('is a `?xml` key at the root, beside the document element', () => {
    expectRead('<?xml version="1.0" encoding="utf-8"?><DataSource/>', {
      '?xml': { '@_version': '1.0', '@_encoding': 'utf-8' },
      DataSource: '',
    });
  });

  it('collapses to the empty string when it carries no attributes', () => {
    // Same collapse rule as an element, which is why it is not special-cased.
    expectRead('<?xml?><DataSource/>', { '?xml': '', DataSource: '' });
  });

  it('is only a declaration when the NAME ends at `xml`', () => {
    // The engine reads a processing instruction's name up to the first `\s` and keys whatever it
    // got, so each of these is a PI named something else entirely — and a prefix test alone read
    // all three as the declaration, inventing a `?xml` key the engine never produced. Found by
    // reasoning out the family the fuzzer had stumbled into, not by the fuzzer.
    expectDeclined('<?xmlfoo?><DataSource/>', { '?xmlfoo': '', DataSource: '' });
    expectDeclined('<?xml-foo="1"?><DataSource/>', { '?xml-foo="1"': '', DataSource: '' });
    expectDeclined('<?xml-stylesheet href="a.xsl"?><DataSource/>', {
      '?xml-stylesheet': { '@_href': 'a.xsl' },
      DataSource: '',
    });
  });

  it('declines a SECOND declaration rather than overwriting the first', () => {
    // A repeated key arrays in `compress`, so the engine keeps both and overwriting would lose
    // one. Declined rather than imitated: two declarations is a shape no dictionary has.
    expectDeclined('<?xml version="1.0"?><?xml version="1.0"?><DataSource/>', {
      '?xml': [{ '@_version': '1.0' }, { '@_version': '1.0' }],
      DataSource: '',
    });
    expectDeclined('<?xml?><?xml?><DataSource/>', { '?xml': ['', ''], DataSource: '' });
  });
});

describe('text coercion', () => {
  it('coerces a numeric-looking value, in every spelling the engine accepts', () => {
    expectRead('<P>7</P>', { P: [7] });
    expectRead('<P>007</P>', { P: [7] }); // leadingZeros
    expectRead('<P>1.0</P>', { P: [1] }); // the spelling is gone
    expectRead('<P>0x1F</P>', { P: [31] }); // hex
    expectRead('<P>1e3</P>', { P: [1000] }); // eNotation
    expectRead('<P>+7</P>', { P: [7] });
    expectRead('<P>-7</P>', { P: [-7] });
    expectRead('<P>.5</P>', { P: [0.5] });
  });

  it('leaves a value whose first character is not digit-like alone', () => {
    // The `charCodeAt` guard in `processText` skips `strnum` entirely for these, which is most
    // of a real dictionary — every name, class and enum literal. `e3` is the interesting one:
    // it LOOKS like e-notation and is not, and the guard and `strnum` agree that it is not.
    expectRead('<P>e3</P>', { P: ['e3'] });
    expectRead('<P>True</P>', { P: ['True'] });
  });

  it('coerces `true` and `false` to booleans, lowercase only', () => {
    expectRead('<P>true</P>', { P: [true] });
    expectRead('<P>false</P>', { P: [false] });
  });

  it('declines an integer that cannot round-trip through a double', () => {
    // `strnum` protecting itself, not us. Length is not the rule — the 23-digit value below
    // DOES become a number, because it was never going to be exact either way.
    expectRead('<P>9007199254740993</P>', { P: ['9007199254740993'] });
    expectRead('<P>12345678901234567890123</P>', { P: [1.2345678901234568e22] });
  });

  it('hands back a PADDED value raw and uncoerced', () => {
    // The load-bearing half of `trimValues: false`: this is how a MATLAB char array keeps its
    // padding. `' 7 '` is three characters and `' true '` is six, not a number and not a
    // boolean, and the in-place editor is seeded with exactly what the file said.
    expectRead('<P> 7 </P>', { P: [' 7 '] });
    expectRead('<P> true </P>', { P: [' true '] });
  });

  it('leaves interior whitespace alone — trimming is not normalization', () => {
    expectRead('<P>a  b</P>', { P: ['a  b'] });
  });

  it('reads `>` in text, which is legal XML and not a tag', () => {
    expectRead('<P>a>b</P>', { P: ['a>b'] });
  });
});

describe('attribute values', () => {
  it('are never coerced', () => {
    // One rule for text, another for attributes (`parseAttributeValue: false`). A walker that
    // forgot which side it was on is the bug this pins.
    expectRead('<P Name="7"/>', { P: [{ '@_Name': '7' }] });
    expectRead('<P Name="true"/>', { P: [{ '@_Name': 'true' }] });
  });

  it('are never trimmed', () => {
    expectRead('<P Name=" 7 "/>', { P: [{ '@_Name': ' 7 ' }] });
  });

  it('can be empty', () => {
    expectRead('<P Name=""/>', { P: [{ '@_Name': '' }] });
  });

  it('may be single-quoted, and then may contain a double quote', () => {
    expectRead("<P Name='v'/>", { P: [{ '@_Name': 'v' }] });
    expectRead('<P Name=\'a"b\'/>', { P: [{ '@_Name': 'a"b' }] });
    expectRead('<P Name="a\'b"/>', { P: [{ '@_Name': "a'b" }] });
  });

  it('survives whitespace around the `=` and between the pairs', () => {
    expectRead('<P Name = "v"/>', { P: [{ '@_Name': 'v' }] });
    expectRead('<P   Name="v"   />', { P: [{ '@_Name': 'v' }] });
    expectRead('<P\tName="v"/>', { P: [{ '@_Name': 'v' }] });
    expectRead('<P\n  Name="v"\n/>', { P: [{ '@_Name': 'v' }] });
    expectRead('<P Name="v" />', { P: [{ '@_Name': 'v' }] });
  });

  it('lets a repeated name win last, as a plain object assignment does', () => {
    expectRead('<P Name="1" Name="2"/>', { P: [{ '@_Name': '2' }] });
  });

  it('reads an attribute that is NOT in the interned key table', () => {
    // `ATTR_KEYS` holds the fourteen names the corpus uses, and a miss falls back to `'@_' +
    // name`. Not a hypothetical: `test/fixtures/custom_object_binary.sldd`, written by MATLAB,
    // carries a `Format` attribute that is outside that table. Bailing on an unknown attribute
    // would have stranded that whole file for nothing.
    expectRead('<P Format="3"/>', { P: [{ '@_Format': '3' }] });
    expectRead('<P Unlisted="x" Name="y"/>', { P: [{ '@_Unlisted': 'x', '@_Name': 'y' }] });
  });
});

describe('entity decoding', () => {
  it('decodes XML’s five, in text and in attribute values alike', () => {
    expectRead('<P>&amp;&lt;&gt;&quot;&apos;</P>', { P: ['&<>"\''] });
    expectRead('<P Name="&amp;&lt;&gt;&quot;&apos;"/>', { P: [{ '@_Name': '&<>"\'' }] });
  });

  it('decodes once, so a double-encoded value keeps its inner markup', () => {
    expectRead('<P>&amp;amp;</P>', { P: ['&amp;'] });
  });

  it('coerces the DECODED value, not the raw one', () => {
    // Also found by mutation testing. These are the only inputs that can tell the two apart: a
    // value that enters the coercion branch (first character digit-like, equal to its own trim)
    // and ALSO carries an entity. `strnum` hands back its own argument when it cannot parse, so
    // coercing the raw text would return the undecoded string and leave `&amp;` in a value —
    // visible in the table, and wrong, with every other entity test still green.
    expectRead('<P>7&amp;8</P>', { P: ['7&8'] });
    expectRead('<P>1&lt;2</P>', { P: ['1<2'] });
    expectRead('<P>-1&gt;0</P>', { P: ['-1>0'] });
    expectRead('<P>.5&amp;</P>', { P: ['.5&'] });
    expectRead('<P>0&quot;</P>', { P: ['0"'] });
    expectRead('<P> 7&amp;8 </P>', { P: [' 7&8 '] }); // the padded path decodes too
  });
});

describe('numeric character references, which the engine does NOT decode', () => {
  // This reader used to decline every `&#`. A MATLAB-written fixture then turned up carrying
  // `&#xD;` — `test/fixtures/custom_object_binary.sldd`, where a char property holds a CR — and
  // declining would have sent a whole 74 MB file back to the slow engine over one carriage
  // return. The corpus census that said numeric references never occur was not wrong about the
  // corpus; it was blind, because no dictionary in it held a multi-line value.
  //
  // `htmlEntities` is off, so `numericAllowed` is off with it, so the engine leaves the reference
  // standing as literal text. Reading these as text is therefore not a shortcut — it IS the
  // engine's answer, and the pinned values below are what it returns.

  it('leaves a reference standing, exactly as the engine does', () => {
    expectRead('<P>a&#xD;b</P>', { P: ['a&#xD;b'] }); // the real fixture's value
    expectRead('<P>&#65;</P>', { P: ['&#65;'] });
    expectRead('<P>&#x41;</P>', { P: ['&#x41;'] });
    expectRead('<P>&#X41;</P>', { P: ['&#X41;'] }); // capital X is a reference too
    expectRead('<P>&#13;</P>', { P: ['&#13;'] });
    expectRead('<P>&#9;x</P>', { P: ['&#9;x'] });
    expectRead('<P>&#x1F600;</P>', { P: ['&#x1F600;'] });
    expectRead('<P Name="a&#xD;b"/>', { P: [{ '@_Name': 'a&#xD;b' }] });
  });

  it('does not let a left-standing reference reach the number coercion', () => {
    // `&` is not digit-like, so the guard skips `strnum` entirely for a leading reference; a
    // trailing one reaches it and must come back unchanged rather than as its leading digits.
    expectRead('<P>7&#48;</P>', { P: ['7&#48;'] });
    expectRead('<P>1&#48;</P>', { P: ['1&#48;'] });
    expectRead('<P>&#32;7</P>', { P: ['&#32;7'] });
    expectRead('<P>&#x30;0</P>', { P: ['&#x30;0'] });
  });

  it('leaves a MALFORMED reference standing too, which is also what the engine does', () => {
    expectRead('<P>&#;</P>', { P: ['&#;'] });
    expectRead('<P>&#x;</P>', { P: ['&#x;'] });
    expectRead('<P>&#xZZ;</P>', { P: ['&#xZZ;'] });
    expectRead('<P>&#-1;</P>', { P: ['&#-1;'] });
    expectRead('<P>&#1114112;</P>', { P: ['&#1114112;'] }); // one past U+10FFFF
    expectRead('<P>&#38;amp;</P>', { P: ['&#38;amp;'] }); // NOT decoded, so NOT `&amp;`
  });

  it('leaves one standing with no `;` in the engine’s 32-character window', () => {
    // The decoder gives up looking for `;` 32 characters past the `&`, so a `;` further off does
    // not close a reference at all and the `&` is just text. Written with `repeat` rather than as
    // a literal, against this file's habit, because the exact length IS the subject and nobody
    // can count 29 zeros in a review.
    //
    // The two sides of the boundary disagree, which is what makes it worth a test: the codepoint
    // is 1 either way, and 1 is prohibited, so the shorter form is a reference and gets deleted
    // while the longer one is ordinary text. A reader that scanned for `;` without the limit
    // would decline both and hand the engine a document it could have read itself.
    const ref = (zeros: number): string => `<P>&#x${'0'.repeat(zeros)}1;</P>`;
    expectDeclined(ref(29), { P: [''] }); // token `#x0…01` is 32 characters: a reference
    expectRead(ref(30), { P: [`&#x${'0'.repeat(30)}1;`] }); // 33 characters: not one
    expectRead('<P>&#65</P>', { P: ['&#65'] }); // and no `;` at all is not one either
  });

  it('declines a codepoint XML 1.0 prohibits, which the engine DELETES', () => {
    // The engine drops these from the value no matter what `numericAllowed` says, because XML
    // cannot carry them at all. That table is not reimplemented, so the seam answers instead —
    // and the engine's answers are pinned here, since "deleted" is a surprising thing for a
    // reference to do and a future reader of this file should not have to guess.
    expectDeclined('<P>&#0;</P>', { P: [''] }); // NUL
    expectDeclined('<P>&#1;</P>', { P: [''] });
    expectDeclined('<P>&#x7;</P>', { P: [''] }); // BEL
    expectDeclined('<P>&#31;</P>', { P: [''] }); // last C0
    expectDeclined('<P>a&#1;b</P>', { P: ['ab'] }); // deleted from the MIDDLE of a value
    expectDeclined('<P>7&#1;</P>', { P: [7] }); // and then what is left COERCES
    expectDeclined('<P>&#1;7</P>', { P: [7] });
    expectDeclined('<P Name="a&#1;b"/>', { P: [{ '@_Name': 'ab' }] }); // attributes too
    expectDeclined('<P>&#xD800;</P>', { P: [''] }); // lone surrogate
    expectDeclined('<P>&#xDFFF;x</P>', { P: ['x'] });
    expectDeclined('<P>&#1zz;</P>', { P: [''] }); // `parseInt` stops at `z`, so this is U+0001
    expectDeclined('<P>&#x1zz;</P>', { P: [''] });
    expectDeclined('<P>&#x0001;</P>', { P: [''] }); // leading zeros do not hide it
    // Capital `X`, which until mutation testing asked was the one spelling no test reached with a
    // prohibited codepoint: `&#X41;` above reads the same whether or not `X` is understood as hex,
    // so a reader that only knew lowercase `x` passed every test while mis-reading these.
    expectDeclined('<P>&#X1;</P>', { P: [''] });
    expectDeclined('<P>a&#X7;b</P>', { P: ['ab'] });
    expectDeclined('<P>&#X1F;</P>', { P: [''] });
    expectDeclined('<P>&#XD800;</P>', { P: [''] });
  });

  it('accepts the codepoints next to the prohibited ones', () => {
    // The boundaries themselves, because an off-by-one in either direction is the likely bug and
    // every one of these would be WRONG to decline.
    expectRead('<P>&#9;</P>', { P: ['&#9;'] }); // tab, LF and CR are the three C0 exceptions
    expectRead('<P>&#10;</P>', { P: ['&#10;'] });
    expectRead('<P>&#13;</P>', { P: ['&#13;'] });
    expectRead('<P>&#32;</P>', { P: ['&#32;'] }); // one past the C0 block
    expectRead('<P>&#xD7FF;</P>', { P: ['&#xD7FF;'] }); // one before the surrogates
    expectRead('<P>&#xE000;</P>', { P: ['&#xE000;'] }); // one after them
    expectRead('<P>&#x10FFFF;</P>', { P: ['&#x10FFFF;'] }); // the last codepoint there is
  });

  it('mixes a reference with the entities it DOES decode', () => {
    expectRead('<P>&#xD;&amp;</P>', { P: ['&#xD;&'] });
    expectRead('<P>&amp;&#xD;</P>', { P: ['&&#xD;'] });
    expectRead('<P>&#x41;&lt;&#x42;</P>', { P: ['&#x41;<&#x42;'] });
  });

  it('declines a value where ONE of two references is prohibited', () => {
    // The whole value goes to the engine, not the prohibited reference alone — a decline is a
    // property of the document, which is the only granularity this reader has.
    expectDeclined('<P>&#9;&#1;a</P>', { P: ['&#9;a'] });
    expectDeclined('<P>&#x1;&#x2;</P>', { P: [''] });
  });

  it('still declines the entities it never owned, reference or not', () => {
    expectDeclined('<P>&#xD;&nbsp;</P>', { P: ['&#xD;&nbsp;'] });
    expectDeclined('<P>a&b&#xD;</P>', { P: ['a&b&#xD;'] });
  });
});

describe('whitespace', () => {
  it('drops the layout whitespace of a pretty-printed file', () => {
    // 204,373 such gaps in the corpus's largest dictionary. The KEY is removed, not emptied.
    expectRead('<DataSource>\n  <P>1</P>\n  <P>2</P>\n</DataSource>', {
      DataSource: { P: [1, 2] },
    });
  });

  it('keeps whitespace that is the whole value of a LEAF', () => {
    // The difference between layout and data is whether anything else is in the element.
    expectRead('<P> </P>', { P: [' '] });
    expectRead('<P>\n</P>', { P: ['\n'] });
  });

  it('drops a whitespace chunk beside a child, on either side of it', () => {
    expectRead('<P><Element/> </P>', { P: [{ Element: [''] }] });
    expectRead('<P> <Element/></P>', { P: [{ Element: [''] }] });
  });

  it('concatenates the real text chunks a child splits', () => {
    expectRead('<P>a<Element/>b</P>', { P: [{ Element: [''], '#text': 'ab' }] });
  });

  it('keeps mixed content’s text and drops only the layout chunk', () => {
    // No dictionary in the corpus holds this shape, which is exactly why it is pinned here
    // rather than left to be discovered: the trailing `\n` chunk is dropped and the
    // `'\n  abc\n  '` chunk is not.
    expectRead('<P>\n  abc\n  <Element/>\n</P>', {
      P: [{ Element: [''], '#text': '\n  abc\n  ' }],
    });
  });

  it('drops UNICODE whitespace beside a child, which is the only way into that branch', () => {
    // Found by mutation testing, not by reading the code. The main loop pre-scans for the four
    // ASCII whitespace characters and skips the slice entirely when a non-leaf chunk is all of
    // them — so `processText`'s own drop branch is UNREACHABLE for ordinary indentation, and
    // deleting it changed nothing that the suite was asserting. These are the inputs that
    // reach it: characters `trim()` strips and that pre-scan does not.
    expectRead('<P>\f<Element/></P>', { P: [{ Element: [''] }] }); // form feed
    expectRead('<P>\v<Element/></P>', { P: [{ Element: [''] }] }); // vertical tab
    expectRead('<P>　<Element/></P>', { P: [{ Element: [''] }] }); // ideographic space
    expectRead('<P> <Element/></P>', { P: [{ Element: [''] }] }); // no-break space
    expectRead('<P>\f\n <Element/></P>', { P: [{ Element: [''] }] }); // mixed with ASCII
    expectRead('<DataSource>\f<P>1</P></DataSource>', { DataSource: { P: [1] } });
  });

  it('keeps unicode whitespace that is the whole value of a leaf', () => {
    // The same characters on the other side of the leaf test, so the two branches are pinned
    // against each other rather than one at a time.
    expectRead('<P>\f</P>', { P: ['\f'] });
    expectRead('<P>　</P>', { P: ['　'] });
    expectRead('<P> </P>', { P: [' '] });
  });

  it('allows whitespace around the root and inside a close tag', () => {
    expectRead('\n  <DataSource/>\n  ', { DataSource: '' });
    expectRead('<DataSource><P>1</P\t\n></DataSource>', { DataSource: { P: [1] } });
    expectRead('<P ></P>', { P: [''] });
  });
});

describe('line endings, which XML normalizes and a raw slice does not', () => {
  // XML 1.0 §2.11: a parser presents `\r\n` and a lone `\r` as `\n`, and the engine implements
  // exactly that with one `replace(/\r\n?/g, "\n")` before it parses. A reader that hands back
  // slices of the original string skips the step without noticing — which is what this one did
  // until an adversarial probe compared the two on `<P>a\rb</P>`. Every case here FAILED before
  // the pre-pass existed, returning the carriage return it was given.
  //
  // Reachable in practice by a CRLF-lineended or hand-edited part, not by MATLAB: for a CR
  // *inside* a value MATLAB writes `&#xD;`, a reference neither reader decodes, which is why the
  // corpus differential over 469.4 MB could not see this.

  it('turns CRLF and a lone CR into a single LF, in text', () => {
    expectRead('<P>a\r\nb</P>', { P: ['a\nb'] });
    expectRead('<P>a\rb</P>', { P: ['a\nb'] });
    expectRead('<P>\r</P>', { P: ['\n'] });
  });

  it('collapses only `\\r\\n`, so a doubled CR stays two line endings', () => {
    // The engine's regex is `\r\n?`, which is not the same as "delete every CR": `\r\r\n` is a CR
    // (-> LF) followed by a CRLF (-> LF). A `replace(/\r/g, '\n')` would agree here and a
    // `replace(/\r\n/g, '\n')` would not, so both near-misses are pinned.
    expectRead('<P>a\r\r\nb</P>', { P: ['a\n\nb'] });
    expectRead('<P>a\n\rb</P>', { P: ['a\n\nb'] });
  });

  it('normalizes inside an attribute value too', () => {
    // Attribute values are NOT whitespace-normalized to spaces — fast-xml-parser's line doing
    // that is commented out in its own source — so the LF survives as an LF.
    expectRead('<P Name="a\r\nb"/>', { P: [{ '@_Name': 'a\nb' }] });
    expectRead('<P Name="a\r"/>', { P: [{ '@_Name': 'a\n' }] });
  });

  it('normalizes BEFORE the padding test, so a trailing CR still defeats coercion', () => {
    // `1\r` is padded, and a padded value is handed back raw and uncoerced. The order matters in
    // both directions: normalizing after would compare `'1\r'` against `'1'` and reach the same
    // answer by luck, while trimming CR as layout would coerce it to the number 1.
    expectRead('<P>1\r</P>', { P: ['1\n'] });
    expectRead('<P>1\r\n</P>', { P: ['1\n'] });
    expectRead('<P> \r </P>', { P: [' \n '] });
  });

  it('leaves `&#xD;` standing beside a literal it normalized', () => {
    // The two halves of the same character, one of which is text and one of which is not.
    expectRead('<P>&#xD;\r</P>', { P: ['&#xD;\n'] });
  });

  it('reads a CRLF-lineended document, layout and all', () => {
    expectRead('<DataSource>\r\n  <P Name="a">1</P>\r\n</DataSource>', {
      DataSource: { P: [{ '#text': 1, '@_Name': 'a' }] },
    });
    expectRead('<P>\r<Element/></P>', { P: [{ Element: [''] }] });
  });
});

describe('the per-depth state is reused, so a stale slot must not leak', () => {
  // `readDictionaryXmlFast` indexes seven parallel arrays by DEPTH and writes over them rather
  // than allocating a frame per element — 13.8 M allocations saved on the largest dictionary,
  // and one new bug class in exchange. Every slot gets a case where the second sibling needs
  // LESS than the first, because "forgot to reset" always shows up in that direction.

  it('keeps two sibling subtrees apart (`kids`, `tags`)', () => {
    expectRead(
      '<DataSource><Object Class="a"><P Name="p1">1</P></Object><Object Class="b"><P Name="p2">2</P></Object></DataSource>',
      {
        DataSource: {
          Object: [
            { P: [{ '#text': 1, '@_Name': 'p1' }], '@_Class': 'a' },
            { P: [{ '#text': 2, '@_Name': 'p2' }], '@_Class': 'b' },
          ],
        },
      },
    );
  });

  it('lets a different tag name occupy a depth the previous subtree used (`tags`)', () => {
    expectRead(
      '<DataSource><Object><Object><P>1</P></Object></Object><Object><P>2</P></Object></DataSource>',
      { DataSource: { Object: [{ Object: [{ P: [1] }] }, { P: [2] }] } },
    );
  });

  it('forgets the extra attributes of the previous sibling (`attrCount`)', () => {
    expectRead('<DataSource><P A="1" B="2" C="3"/><P A="4"/></DataSource>', {
      DataSource: { P: [{ '@_A': '1', '@_B': '2', '@_C': '3' }, { '@_A': '4' }] },
    });
  });

  it('collapses a sibling with no attributes after one with three (`attrCount`)', () => {
    expectRead('<DataSource><P A="1" B="2" C="3"/><P/></DataSource>', {
      DataSource: { P: [{ '@_A': '1', '@_B': '2', '@_C': '3' }, ''] },
    });
  });

  it('forgets the previous sibling’s text (`textVal`, `textCount`)', () => {
    expectRead('<DataSource><P>1</P><P/></DataSource>', { DataSource: { P: [1, ''] } });
  });

  it('forgets the previous sibling’s children (`kidCount`)', () => {
    expectRead('<DataSource><Object><P/></Object><Object/></DataSource>', {
      DataSource: { Object: [{ P: [''] }, ''] },
    });
  });

  it('lets text follow a subtree at the same depth (`kidCount` decides the collapse)', () => {
    // The second `Object` is a leaf whose text must coerce; if `kidCount` had carried over from
    // the first it would have been treated as a parent and the `2` would be a `#text` key.
    expectRead('<DataSource><Object><P>1</P></Object><Object>2</Object></DataSource>', {
      DataSource: { Object: [{ P: [1] }, 2] },
    });
  });
});

describe('what it declines, and what the seam still answers', () => {
  // Each of these pins TWO facts: the fast reader returns `null`, and `readDictionaryXml`
  // produces the value it produced before the fast reader existed. The second is the whole
  // safety argument — a decline is never wrong, only slower.

  describe('markup this reader deliberately does not own', () => {
    it('declines a comment', () => {
      expectDeclined('<DataSource><!-- c --><P>1</P></DataSource>', { DataSource: { P: [1] } });
    });

    it('declines CDATA, which the engine reads as ordinary text', () => {
      expectDeclined('<P><![CDATA[<x>]]></P>', { P: ['<x>'] });
    });

    it('declines a DOCTYPE, and with it every entity-expansion question', () => {
      expectDeclined('<!DOCTYPE DataSource><DataSource/>', { DataSource: '' });
    });

    it('declines a processing instruction that is not the declaration', () => {
      expectDeclined('<?pi x?><DataSource/>', { '?pi': '', DataSource: '' });
    });

    it('declines a declaration anywhere but first', () => {
      expectDeclined('<DataSource/><?xml version="1.0"?>', {
        DataSource: '',
        '?xml': { '@_version': '1.0' },
      });
      expectDeclined('<DataSource><?xml version="1.0"?></DataSource>', {
        DataSource: { '?xml': { '@_version': '1.0' } },
      });
    });
  });

  describe('entities it will not interpret', () => {
    // Numeric character references used to be here, and are not any more: the engine leaves them
    // standing, so reading them as text is its answer rather than a liberty. Their own describe
    // block above covers them, including the prohibited codepoints that still decline.

    it('declines an unknown named entity', () => {
      expectDeclined('<P>&nbsp;</P>', { P: ['&nbsp;'] });
    });

    it('declines a bare ampersand', () => {
      expectDeclined('<P>a & b</P>', { P: ['a & b'] });
    });
  });

  describe('names outside the vocabulary', () => {
    it('declines an unknown element name', () => {
      expectDeclined('<Q/>', { Q: '' });
    });

    it('declines a namespaced name', () => {
      expectDeclined('<x:P/>', { 'x:P': '' });
    });

    it('declines a name that differs only in case', () => {
      // `internTag` compares bytes, so `p` is not `P`. XML agrees; this only pins that the
      // interning is not accidentally case-insensitive.
      expectDeclined('<p/>', { p: '' });
    });

    it('declines an empty or whitespace-led name', () => {
      expectDeclined('</>', {});
      expectDeclined('< P/>', { '': '' });
    });
  });

  describe('damage, every judgement about which belongs to the engine', () => {
    it('declines a mismatched close tag, which the engine ACCEPTS', () => {
      expectDeclined('<DataSource><P>1</Element></DataSource>', { DataSource: { P: [1] } });
    });

    it('declines a close tag carrying trailing junk', () => {
      expectDeclined('<DataSource><P>1</P x></DataSource>', { DataSource: { P: [1] } });
    });

    it('declines an unclosed element', () => {
      expectDeclined('<DataSource><P>1</DataSource>', { DataSource: { P: [1] } });
    });

    it('declines a close tag with nothing open', () => {
      expectDeclined('</P>', {});
    });

    it('declines a second root element', () => {
      expectDeclined('<P/><P/>', { P: ['', ''] });
    });

    it('declines non-whitespace text outside the root', () => {
      expectDeclined('x<DataSource/>', { DataSource: '' });
    });

    it('declines input with no markup — the shape a truncated write takes', () => {
      // The engine's empty object here is load-bearing: every caller reports it as a loss.
      // This reader must not invent that answer, because `null` from it means "not read".
      expectDeclined('hello', {});
      expectDeclined('', {});
    });
  });

  describe('attribute syntax it will not guess at', () => {
    it('declines an attribute with no value', () => {
      // fast-xml-parser's own regex tolerates it and drops it. Imitating that would mean
      // owning a judgement about damaged input, which is the thing this reader defers.
      expectDeclined('<P Name/>', { P: [''] });
    });

    it('declines an unquoted value', () => {
      expectDeclined('<P Name=x/>', { P: [''] });
    });

    it('declines a name split by whitespace only JAVASCRIPT counts as whitespace', () => {
      // The one way a stricter reader can be WRONG rather than narrower. `isSpace` is XML's four
      // characters, which is correct; the engine's regexes split on `\s`, which also includes
      // `\f`, `\v`, NBSP and the Unicode spaces. So the engine sees TWO attributes where this
      // scanner sees one name with a form feed inside it — and when the halves repeat a name,
      // the engine folds the duplicate and keeps the last, so even the key COUNT differs.
      expectDeclined('<P Value\f="007" Value="b"/>', { P: [{ '@_Value': 'b' }] });
      expectDeclined('<P Value ="007" Value="b"/>', { P: [{ '@_Value': 'b' }] });
      expectDeclined('<P Value\f="1"/>', { P: [{ '@_Value': '1' }] });
      expectDeclined('<P \fValue="1"/>', { P: [{ '@_Value': '1' }] });
      expectDeclined('<P Value﻿="1"/>', { P: [{ '@_Value': '1' }] });
      expectDeclined('<P Value="1"\f/>', { P: [{ '@_Value': '1' }] });
      // The same hole on the declaration's attributes, which is where it was actually found: the
      // element path happened to decline already, because the tag name then holds the character.
      expectDeclined('<?xml\fversion="1.0"?><DataSource/>', {
        '?xml': { '@_version': '1.0' },
        DataSource: '',
      });
    });

    it('still reads an attribute name that is merely UNKNOWN', () => {
      // The control for the test above, and the one that matters for real files: the decline is
      // keyed on the alien whitespace, not on the name being absent from `ATTR_KEYS`. MATLAB
      // writes `Format="decimal"` for a char value XML cannot hold plainly, and that attribute
      // appears in none of the 32 corpus dictionaries — it must still be copied faithfully.
      expectRead('<P Name="Ctrl" Class="char" Dimension="1*5" Format="decimal">9 10 13 7 1</P>', {
        P: [
          {
            '#text': '9 10 13 7 1',
            '@_Name': 'Ctrl',
            '@_Class': 'char',
            '@_Dimension': '1*5',
            '@_Format': 'decimal',
          },
        ],
      });
    });

    it('declines a `>` inside an attribute value', () => {
      // A known, accepted limitation rather than a bug: finding the tag's end needs the
      // attributes parsed and parsing them needs the tag's end. No dictionary attribute
      // (`Class`, `Name`, `Dimension`, `Source`, ...) has ever held one, and the cost of
      // being wrong is a fallback.
      expectDeclined('<P Name="a>b"/>', { P: [{ '@_Name': 'a>b' }] });
    });
  });

  describe('the engine’s nesting limit, past which it throws rather than answers', () => {
    // `maxNestedTags` defaults to 100 and `XmlReader` does not override it. A reader that keeps
    // going past the point where the engine raises is the mirror image of a caller reading `null`
    // as "empty document": a loud failure becomes quiet data. Dictionaries nest in single digits,
    // so nothing here is about real files — it is about the contract holding at the edge.
    const deep = (d: number, inner = 'x'): string =>
      '<P>'.repeat(d) + inner + '</P>'.repeat(d);

    it('reads the deepest document the engine reads', () => {
      // 101 opens, not 100: the engine checks its stack BEFORE pushing, so the limit admits one
      // more level than the number suggests. Compared against the live engine rather than a
      // literal, which at this depth would be 101 lines of nesting and would pin the shape
      // instead of the boundary — the shape is pinned by every other case in this file.
      for (const d of [99, 100, 101]) {
        const fast = readDictionaryXmlFast(deep(d));
        expect(fast, `depth ${d} should still be read`).not.toBeNull();
        expect(fast, `depth ${d}`).toEqual(readDictionaryXmlGeneric(deep(d)));
      }
    });

    it('declines one level past it, where the engine throws', () => {
      for (const d of [102, 103, 150]) {
        expect(readDictionaryXmlFast(deep(d)), `depth ${d}`).toBeNull();
        expect(() => readDictionaryXmlGeneric(deep(d))).toThrow(/Maximum nested tags/);
        expect(() => readDictionaryXml(deep(d))).toThrow(/Maximum nested tags/);
      }
    });

    it('does not count a self-closing tag, because the engine pushes no frame for one', () => {
      // The off-by-one that a `depth > limit` check placed one line earlier would introduce: at
      // the limit exactly, `<P/>` is still fine and `<P></P>` is not. Declining here would cost
      // nothing in practice and would still be a divergence from "identical or null" in the only
      // direction that is allowed — but it would mean the boundary was copied, not understood.
      const edge = '<P>'.repeat(101) + '<P/>'.repeat(5) + '</P>'.repeat(101);
      const fast = readDictionaryXmlFast(edge);
      expect(fast).not.toBeNull();
      expect(fast).toEqual(readDictionaryXmlGeneric(edge));
    });
  });

  it('declines an unterminated tag, where the engine THROWS', () => {
    // The one decline whose fallback does not return a value. Pinned because the seam's
    // behaviour here is "throws", and a caller that treated the fast reader's `null` as
    // "empty document" would turn a thrown error into silent data loss.
    expect(readDictionaryXmlFast('<P Name="v"')).toBeNull();
    expect(() => readDictionaryXmlGeneric('<P Name="v"')).toThrow();
    expect(() => readDictionaryXml('<P Name="v"')).toThrow();
  });
});
