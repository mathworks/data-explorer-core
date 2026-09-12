// src/datamodel/parser/SlddScan.ts
// Copyright 2026 The MathWorks, Inc.
//
// Reading ONLY the entry names and the referenced sub-dictionaries out of a `.sldd`,
// without building the entry tree.
//
// Three call sites want exactly this and pay for a full parse today: the consumer's name
// index, the consumer's structural index, and `summarizeFiles` inside this package. On
// the larger customer dictionary a full `readSlddContent` is 3230 ms and produces 31,345
// entry objects, of which those call sites read one string each.
//
// WHAT THIS DOES AND DOES NOT SPEED UP, measured rather than assumed:
//
//   compressed-binary (zip + XML)   3230 ms -> ~100 ms
//   JSON-text                        102 ms -> unchanged, ON PURPOSE
//
// The JSON-text spelling keeps `JSON.parse`. A hand-written structural scanner over the
// same text was BUILT and measured at 0.6-0.7x -- slower than V8's native parser, which
// is C++ and has had far more attention than any loop written here. So there is no JSON
// scanner: 139 of the 171 corpus dictionaries keep the path they already had, and the
// risky code that would have covered them does not exist. The two spellings are that far
// apart because the cost was never the I/O; it was turning 71 MB of XML into a DOM.
//
// HOW EQUIVALENCE IS ESTABLISHED. `perf/oracle-run.mjs` compares this against
// `readSlddContent` over every `.sldd` in the corpus, name by name, in order. Order is
// part of the contract: the reference walks `<DataSource>`'s children in document order
// and consumers index positionally, so a permutation is a real difference.
//
// WHERE IT REFUSES. A scan is a bet that the bytes are shaped the way every observed
// file is shaped. Rather than bet silently, this module throws `UnscannableDictionary`
// for anything it has not been verified against, and the caller falls back to the full
// parse -- slow and certainly right, instead of fast and possibly wrong. A wrong name
// here is the worst available outcome: it would make a rename target the wrong entry.
//
// The refusals are listed on `scanDataSourceXml`. The one worth naming here is entity
// escaping. fast-xml-parser decodes `&amp;` and friends (`processEntities` defaults on),
// so a name containing an entity would need this module to mirror its decoder exactly,
// and "exactly" is not something to assume about a table that lives in another package.
// No name in 241,599 corpus entries contains an entity, so refusing costs nothing
// measurable and cannot be wrong. If a real file ever trips it, the fix is to mirror
// fast-xml-parser's table under a test that compares the two.

import { unzipEntries } from './Inflate.js';
import {
  isJsonTextBytes,
  normalizeRefNames,
  readSlddContent,
  slddChunkContent,
} from './SlddContent.js';
import { DATA_PART_XML } from './SlddParts.js';
import type { ParseWarning } from './ParseWarning.js';

/** Entry names and referenced sub-dictionary names, both in document order. */
export interface SlddScanResult {
  /**
   * One name per entry, in document order, INCLUDING `''` for an entry that has no
   * readable Name.
   *
   * The empty string is kept because the reference keeps it: `parseEntry` does
   * `getProperty(obj, 'Name') || ''` and pushes the entry regardless, so an unnamed
   * entry occupies a position in `entries`. Dropping it here would shift every later
   * name by one against a consumer that indexes positionally -- which is a wrong-name
   * bug, not a missing-name one.
   */
  names: string[];
  /**
   * Referenced sub-dictionary filenames, in document order, with empties dropped --
   * which is what `normalizeRefNames` does, and it is the reference for this field.
   */
  refs: string[];
}

/**
 * Thrown when the fast path has met something it was not verified against. Never
 * escapes this module: it means "use the full parser", not "this file is bad".
 */
class UnscannableDictionary extends Error {}

// ---------------------------------------------------------------------------------
// byte search
// ---------------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const OPEN_OBJECT = encoder.encode('<Object');
const CLOSE_OBJECT = encoder.encode('</Object>');

const LT = 0x3c; // <
const GT = 0x3e; // >
const SLASH = 0x2f; // /
const BANG = 0x21; // !
const AMP = 0x26; // &
const QUOTE = 0x22; // "
const EQ = 0x3d; // =

/**
 * Boyer-Moore-Horspool skip table.
 *
 * A plain first-byte-then-compare search was measured at 77.9 ms over the 71.3 MB
 * chunk against 19.8 ms for this -- 3.9x. The reason is that the naive loop's guard
 * byte is `<`, which in XML recurs every ~20 bytes, so it pays a full needle compare
 * constantly. Skipping on the LAST byte instead advances by most of the needle.
 */
function skipTable(needle: Uint8Array): Int32Array {
  const skip = new Int32Array(256).fill(needle.length);
  for (let i = 0; i < needle.length - 1; i++) {
    skip[needle[i]] = needle.length - 1 - i;
  }
  return skip;
}

const OPEN_SKIP = skipTable(OPEN_OBJECT);
const CLOSE_SKIP = skipTable(CLOSE_OBJECT);

function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from: number, skip: Int32Array): number {
  const m = needle.length;
  const last = hay.length - m;
  const lastByte = needle[m - 1];
  let i = from < 0 ? 0 : from;
  while (i <= last) {
    const c = hay[i + m - 1];
    if (c === lastByte) {
      let j = m - 2;
      while (j >= 0 && hay[i + j] === needle[j]) j--;
      if (j < 0) return i;
    }
    i += skip[c];
  }
  return -1;
}

/** True when `hay` at `at` equals the ASCII of `text`. */
function matchesAt(hay: Uint8Array, at: number, text: Uint8Array): boolean {
  if (at < 0 || at + text.length > hay.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (hay[at + i] !== text[i]) return false;
  }
  return true;
}

function isSpace(b: number): boolean {
  return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d;
}

function skipSpace(hay: Uint8Array, at: number): number {
  let i = at;
  while (i < hay.length && isSpace(hay[i])) i++;
  return i;
}

// ---------------------------------------------------------------------------------
// the scan
// ---------------------------------------------------------------------------------

const DATASOURCE_OPEN = encoder.encode('<DataSource');
const CLASS_NAME = encoder.encode('Class');
const P_NAME = encoder.encode('<P Name="');

const CLASS_ENTRY = encoder.encode('DD.ENTRY"');
const CLASS_REFERENCE = encoder.encode('DD.DICTIONARYREFERENCE"');
const NAME_ATTR_VALUE = encoder.encode('Name"');
const SUBDICTIONARY_ATTR_VALUE = encoder.encode('Subdictionary"');

/**
 * Names and refs out of a `data/chunk0.xml` body.
 *
 * Refuses (throws `UnscannableDictionary`, so the caller falls back to the full parse)
 * on every one of:
 *
 *  - a root element that is not `<DataSource>`.
 *  - a `DD.ENTRY` whose first child element is not `<P Name="Name"`, or a
 *    `DD.DICTIONARYREFERENCE` whose first is not `<P Name="Subdictionary"`. The
 *    reference reads the FIRST DIRECT child with that name (`getProperty` walks
 *    `obj.P`), and "first child" is how this module finds the same one without building
 *    the children. It holds for 241,599 of 241,599 corpus entries and 12 of 12
 *    references; if it ever does not, guessing would return a name from somewhere else
 *    in the entry.
 *  - an `<Object>` nested inside another `<Object>`. The reference only ever sees
 *    `<DataSource>`'s DIRECT children, so a nested one must not be counted -- and a
 *    nested `DD.ENTRY` is precisely the shape that would make this module invent an
 *    entry the parser does not report. Depth is tracked rather than assumed from
 *    indentation, because indentation is NOT reliable: this package's own splice writer
 *    emits top-level objects indented 20 and 32 spaces.
 *  - a name or reference containing `&` (see the file header) or introduced by `<!`,
 *    which is CDATA or a comment where this reads plain text.
 *  - an `<Object>` attribute whose value is not double-quoted, or that has no value. See
 *    `classValueAt`: reading a `Class` that is PRESENT as missing is how a scan returns an
 *    EMPTY name list for a full dictionary, which is far worse than being slow.
 *  - a truncated document: an unterminated tag, or a missing `</Object>`.
 *
 * `FormatVersion` is deliberately NOT one of them, though an earlier draft of this gated
 * on `"1"` because that is what all 32 compressed corpus dictionaries carry. Two things
 * killed it. It protects against nothing: every assumption above is checked DIRECTLY, by
 * looking at the shape it depends on, so a version that changes the shape is refused on
 * the shape and a version that does not needs no refusing -- and `test/fixtures/
 * compressed.sldd` is exactly that case, `FormatVersion="4"` with a version-1 shape. And
 * it costs a cliff nobody would see: a release that bumped the number would silently move
 * every dictionary back onto the 3230 ms path with no test failing and no warning.
 *
 * What the gate was really reaching for is a format whose shape is unchanged but whose
 * MEANING differs -- a future flag marking an entry deleted, say. A version check cannot
 * help there either, because this module's contract is agreement with THIS package's
 * `parseBinarySldd`, not with MATLAB. A semantic change needs that parser taught about it
 * too, and the day it is, the oracle is what catches the scanner still doing the old
 * thing. `test/slddScan.test.ts` pins the version-4 fixture for the same reason.
 */
export function scanDataSourceXml(xml: Uint8Array): SlddScanResult {
  const rootAt = skipXmlProlog(xml);
  if (!matchesAt(xml, rootAt, DATASOURCE_OPEN)) {
    throw new UnscannableDictionary('root element is not <DataSource>');
  }
  const rootEnd = seekByte(xml, rootAt, GT);

  const names: string[] = [];
  const refs: string[] = [];

  // Two forward searches over the same bytes, advanced in step: `open` for the next
  // `<Object`, `close` for the next `</Object>`. Consuming whichever comes first is
  // what maintains depth, and it costs one extra pass rather than a tag-by-tag walk of
  // the whole document (which was slower in every arrangement tried).
  let depth = 0;
  let open = indexOfBytes(xml, OPEN_OBJECT, rootEnd, OPEN_SKIP);
  let close = indexOfBytes(xml, CLOSE_OBJECT, rootEnd, CLOSE_SKIP);

  while (open >= 0 || close >= 0) {
    if (close >= 0 && (open < 0 || close < open)) {
      depth--;
      if (depth < 0) throw new UnscannableDictionary('unbalanced </Object>');
      close = indexOfBytes(xml, CLOSE_OBJECT, close + CLOSE_OBJECT.length, CLOSE_SKIP);
      continue;
    }

    if (depth > 0) {
      throw new UnscannableDictionary('<Object> nested inside <Object>');
    }

    const tagEnd = seekByte(xml, open, GT);
    const cls = classValueAt(xml, open, tagEnd);
    if (matchesAt(xml, cls, CLASS_ENTRY)) {
      // Pushed even when empty: see SlddScanResult.names. The reference counts the
      // entry either way, and a dropped one shifts every name after it.
      names.push(firstPropertyText(xml, tagEnd + 1, NAME_ATTR_VALUE));
    } else if (matchesAt(xml, cls, CLASS_REFERENCE)) {
      const sub = firstPropertyText(xml, tagEnd + 1, SUBDICTIONARY_ATTR_VALUE);
      // An empty Subdictionary is dropped, because `normalizeRefNames` drops it and
      // that function IS the reference for this field. The full parser also emits a
      // `part-unreadable` warning here; this path cannot, which is why a caller that
      // needs warnings must not use it -- see `scanSldd`.
      if (sub !== '') refs.push(sub);
    }

    // A self-closing `<Object ... />` has no children and no `</Object>`, so depth must
    // not rise for it. Such an object also cannot hold a Name, and the two branches
    // above would have refused it via `firstPropertyText` -- which is correct, since the
    // reference would report an entry with an empty name and this cannot know that
    // without special-casing a shape no corpus file has.
    if (xml[tagEnd - 1] !== SLASH) depth++;
    open = indexOfBytes(xml, OPEN_OBJECT, tagEnd, OPEN_SKIP);
  }

  if (depth !== 0) throw new UnscannableDictionary('unclosed <Object>');
  return { names, refs };
}

/** Past the `<?xml ...?>` declaration and any leading whitespace. */
function skipXmlProlog(xml: Uint8Array): number {
  let i = skipSpace(xml, 0);
  // A UTF-8 BOM, which TextDecoder would strip but a byte scan will not.
  if (xml[i] === 0xef && xml[i + 1] === 0xbb && xml[i + 2] === 0xbf) i = skipSpace(xml, i + 3);
  while (xml[i] === LT && (xml[i + 1] === 0x3f /* ? */ || xml[i + 1] === BANG)) {
    i = skipSpace(xml, seekByte(xml, i, GT) + 1);
  }
  return i;
}

function seekByte(xml: Uint8Array, from: number, byte: number): number {
  let i = from;
  // Attribute values are quoted and cannot contain `>` unescaped in these files, but
  // skipping quoted spans anyway costs nothing and removes the question.
  while (i < xml.length) {
    const b = xml[i];
    if (b === QUOTE) {
      i++;
      while (i < xml.length && xml[i] !== QUOTE) i++;
    } else if (b === byte) {
      return i;
    }
    i++;
  }
  throw new UnscannableDictionary('unterminated tag');
}

/**
 * Where the `Class` attribute VALUE starts inside the `<Object` tag spanning
 * [tagStart, tagEnd), or -1 when the tag carries no `Class` attribute at all.
 *
 * An offset rather than a decoded string: this runs once per object, and callers only
 * ever compare it against two known class names, so decoding 31,346 short strings just
 * to throw them away is work with no reader. Comparison is against bytes that INCLUDE
 * the closing quote, which is what stops `DD.ENTRYLIKE` from matching `DD.ENTRY`.
 *
 * -1 means "no Class at all", and skipping such an object is what the reference does too:
 * `obj['@_Class']` is undefined, so it matches neither class it looks for.
 *
 * A REAL WALK RATHER THAN A SEARCH FOR ` Class="`, and the difference is a bug class, not
 * a style. Reading an attribute that is PRESENT as absent makes this return an EMPTY name
 * list for a full dictionary -- succeeding, silently, with the wrong answer, which is the
 * one outcome this module must never produce. Searching for a fixed ` Class="` did exactly
 * that TWICE: once for `Class='DD.ENTRY'` and again, after a needle was added for that,
 * for `Class = "DD.ENTRY"`. Both are legal XML that fast-xml-parser reads. Chasing
 * spellings one needle at a time is unbounded; parsing the attribute list is not, so the
 * only shapes left are the ones this refuses OUT LOUD:
 *
 *   - a value that is not double-quoted (`Class='DD.ENTRY'`). Supporting apostrophes would
 *     mean teaching the whole tag walk -- `seekByte` included -- a second quote character,
 *     and no corpus file needs it.
 *   - an attribute with no `=value` at all, which is not well-formed XML here.
 *
 * Whitespace around the `=` is ACCEPTED, because refusing it would be the same mistake in
 * a smaller form: fast-xml-parser reads it, so the file has a right answer and this can
 * see it. The refusals above cost a fallback; they cannot cost a wrong name.
 */
function classValueAt(xml: Uint8Array, tagStart: number, tagEnd: number): number {
  // Byte-by-byte over a few dozen bytes, not BMH: a skip table would cost more to build
  // than the search saves. `tagEnd` is the `>` and `seekByte` already skipped quoted
  // spans to find it, so a `>` inside a value cannot end the span early.
  let i = tagStart + OPEN_OBJECT.length;
  while (i < tagEnd) {
    i = skipSpace(xml, i);
    if (i >= tagEnd || xml[i] === SLASH) break; // end of tag, or the `/` of `/>`
    const nameStart = i;
    while (i < tagEnd && !isSpace(xml[i]) && xml[i] !== EQ) i++;
    const isClass = i - nameStart === CLASS_NAME.length && matchesAt(xml, nameStart, CLASS_NAME);

    i = skipSpace(xml, i);
    if (xml[i] !== EQ) throw new UnscannableDictionary('attribute without a value in <Object>');
    i = skipSpace(xml, i + 1);
    if (xml[i] !== QUOTE) {
      throw new UnscannableDictionary('attribute value in <Object> is not double-quoted');
    }

    const valueStart = i + 1;
    i = valueStart;
    while (i < tagEnd && xml[i] !== QUOTE) i++;
    if (i >= tagEnd) throw new UnscannableDictionary('unterminated attribute value in <Object>');
    if (isClass) return valueStart;
    i++; // past the closing quote
  }
  return -1;
}

/**
 * The text of the FIRST child element at `from`, required to be `<P Name="want">`.
 *
 * Returns '' for a self-closing `<P ... />`, which is how an empty value is written, and
 * for `<P ...></P>`. The reference turns both into `''` too.
 */
function firstPropertyText(xml: Uint8Array, from: number, want: Uint8Array): string {
  const at = skipSpace(xml, from);
  // `want` carries its own closing quote, so this one compare checks both that the
  // first child is a `<P>` and that it is the RIGHT one.
  if (!matchesAt(xml, at, P_NAME) || !matchesAt(xml, at + P_NAME.length, want)) {
    throw new UnscannableDictionary('first child of <Object> is not the expected <P Name="...">');
  }

  // Past the attribute's closing quote before seeking `>`. Starting the seek ON that
  // quote would make `seekByte` read it as an OPENING quote and pair every later quote
  // in the tag off by one, walking straight past the `>`.
  const tagEnd = seekByte(xml, at + P_NAME.length + want.length, GT);
  if (xml[tagEnd - 1] === SLASH) return ''; // <P Name="Name" Class="char"/>

  const textFrom = tagEnd + 1;
  let end = textFrom;
  while (end < xml.length && xml[end] !== LT) {
    if (xml[end] === AMP) {
      throw new UnscannableDictionary('entity reference in a scanned value');
    }
    end++;
  }
  if (end >= xml.length) throw new UnscannableDictionary('unterminated text node');
  if (xml[end + 1] === BANG) {
    throw new UnscannableDictionary('CDATA or comment where text was expected');
  }
  return decoder.decode(xml.subarray(textFrom, end));
}

// ---------------------------------------------------------------------------------
// the entry point
// ---------------------------------------------------------------------------------

/**
 * Entry names and referenced sub-dictionaries of a `.sldd`, in document order.
 *
 * Equivalent to reading `readSlddContent` and taking `entries[].name` plus
 * `normalizeRefNames(content['Dictionary References'])`, and that equivalence is checked
 * over the whole corpus by `perf/oracle-run.mjs` rather than argued for here.
 *
 * Dispatches on the BYTES, never on the filename: both spellings of a dictionary carry
 * the same extension, so a reader that trusts the name reads the wrong file silently.
 *
 * `warnings` is this package's out-parameter convention and is forwarded to the full
 * parser on the paths that use one. The fast path raises none of its own: it either
 * scans, or refuses and lets the full parser have the file, warnings included.
 */
export function scanSldd(bytes: ArrayBuffer, warnings?: ParseWarning[]): SlddScanResult {
  // JSON-text keeps `JSON.parse` on purpose -- see the file header, where a hand-written
  // scanner was BUILT and measured SLOWER. So the fast path is attempted only for the
  // zip spelling, and everything else falls through to the one exit below.
  const u8 = new Uint8Array(bytes);
  if (!isJsonTextBytes(u8)) {
    let xml: Uint8Array | undefined;
    try {
      xml = unzipEntries(u8)[DATA_PART_XML];
    } catch {
      // Not a readable zip. Fall through, so the full parser raises the diagnostic it
      // always did instead of this module inventing a second wording for it.
      xml = undefined;
    }
    if (xml) {
      try {
        return scanDataSourceXml(xml);
      } catch (e) {
        if (!(e instanceof UnscannableDictionary)) throw e;
      }
    }
  }
  return fromContent(readSlddContent(bytes, warnings));
}

/** The same two fields, taken from a fully parsed dictionary. */
function fromContent(json: Record<string, unknown>): SlddScanResult {
  const content = slddChunkContent(json);
  const names: string[] = [];
  const entries = content?.entries;
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const name = (entry as { name?: unknown } | null)?.name;
      // `''` for a nameless entry, not a skip: the entry still holds its position.
      names.push(typeof name === 'string' ? name : '');
    }
  }
  return {
    names,
    refs: content ? normalizeRefNames(content['Dictionary References']) : [],
  };
}
