// src/datamodel/parser/BinarySlddParser.ts
// Copyright 2026 The MathWorks, Inc.
//
// THE WARNINGS CHANNEL FOR A DICTIONARY, AND WHY IT IS AN OUT-PARAMETER
//
// Every other reader in this package hands back a result OBJECT with a `warnings`
// field on it: `parseSlx`, `parseMdl`, `parseMat` and `parseProject` all return a
// `Parsed*` shape, so adding diagnostics to them was adding a field. This reader has
// no such shape. `parseBinarySldd` returns the dictionary CONTENT itself — the
// `__MW_TEXT_PARTS__` bag that `SlddNode.parse` consumes and that
// `serializeBinarySldd` writes back — and there is no `ParsedSldd` interface anywhere
// in the repo to put a field on.
//
// So the choice was between wrapping the return value, `{ content, warnings }`, and
// taking a sink the caller owns, `parse(..., warnings?)`. The sink won, on the code
// rather than on taste:
//
//   - The return value IS the content. A wrapper does not add a field to a result, it
//     puts the result one level down, so EVERY caller has to be rewritten to unwrap
//     before it can do the thing it was already doing. That is not an internal
//     refactor: `parseBinarySldd` and `parseBinarySlddParts` are both exported from
//     src/index.ts, this package is consumed as a git dependency, and a consumer that
//     upgrades gets a content object where it used to get one only at runtime, with
//     no compiler error at the call site if it passes the wrapper straight on as
//     `Record<string, unknown>`. An optional trailing parameter is additive: a caller
//     that passes one argument gets exactly what it got before, which
//     test/parseWarnings.test.ts asserts by comparing the two calls.
//   - There are far more call sites than the one in `ingest`. Inside the repo the two
//     functions are called from the ingest path, the writable-binary editor's rebuild,
//     the save gate's re-validation, the round-trip harness and a dozen test files. A
//     wrapper is a mechanical edit at every one of them and a behavioural change at
//     none, which is the worst trade a public signature can make.
//   - It matches where the warnings have to END UP anyway. A dictionary's diagnostics
//     are not finished when the XML is read: the textual flavour has no parser at all
//     (its JSON goes straight into `SlddNode.parse`), so the node layer has to be able
//     to append to the SAME list the parser filled in. One array, threaded
//     parser -> node -> `registerSource`, is what makes the two flavours report
//     through one channel; two wrappers would have to be merged by hand in
//     `addDataSource`.
//
// The cost of a sink is that it is invisible in the return type, so a caller that
// wants diagnostics has to know to ask. That is the same bargain `SlxParser`'s
// internal helpers already make, and the reason the parameter is documented on both
// exported functions rather than left to be discovered.

import { unzipEntries, zipMemberStamps } from './Inflate.js';
import { readDictionaryXml } from './XmlReader.js';
import { ENTRY_OPEN, spellsEntry, type ReadEntrySpans } from './DictionaryXmlFast.js';
import { reasonOf, type ParseWarning } from './ParseWarning.js';
import type { SystemComposerCatalog } from './ScCatalog.js';
import { SC_PART_XML, catalogFromDefinitions, scanScXml } from './ScCatalog.js';
import { DATA_PART_KEY, DATA_PART_XML, TEXT_CONTENT, TEXT_PARTS } from './SlddParts.js';
import { encodedStream, encodedValueOf, isEncodedValue, type EncodedValue } from './EncodedValue.js';
import {
  charFromDecimal,
  charNeedsShape,
  complexClassTag,
  formatDoubleXml,
  formatMatlabNum,
  formatMatrixSerial,
  formatMxCharSerial,
  formatNumLiteral,
  needsExactInt,
  parseExactBody,
  parseMatlabNum,
  parseNumericBody,
  transposeFromColumnMajorND,
  BINARY_EMPTY_KEY,
  ENUM_KEY,
  ENUMERATION_KEY,
  PROPERTY_SOURCE_KEY,
  SAVEOBJ_KEY,
  type Enumeral,
  type PropertySource,
} from './XmlUtils.js';
import { setOwn } from './ownKeys.js';
import { headerDigits } from './Size.js';
import { recordPackageStamps, recordReadFrame, recordReadSource, type ChunkFrame, type Span } from './EntrySource.js';

interface XmlNode {
  '@_Class'?: string;
  '@_Name'?: string;
  '@_Dimension'?: string;
  '@_IsComplex'?: string;
  // `decimal` on a char MATLAB wrote as its codes — see charValue.
  '@_Format'?: string;
  // An enumeration value's wrapper, and each of its enumerals — see enumValue.
  '@_IsEnum'?: string;
  '@_EnumerationName'?: string;
  '@_EnumerationType'?: string;
  // A value MATLAB wrote as an encoded byte stream rather than as XML — see encodedOf.
  '@_Encoding'?: string;
  '@_EncodedLength'?: string;
  // A named property's, on a dynamic property (see propertySources); the saveobj envelope's.
  '@_Source'?: string;
  '@_PropertyType'?: string;
  '@_FormatVersion'?: string;
  '@_MinRelease'?: string;
  '@_Arch'?: string;
  // The element's text as the file holds it, entity-decoded: the XML reader converts nothing,
  // so every number below is read from this by its Class (see getTextContent).
  '#text'?: string;
  P?: XmlNode[];
  Element?: XmlNode[];
  Object?: XmlNode[];
  // How MATLAB names the fields of an EMPTY struct — see `fieldNamesOf`.
  Field?: XmlNode[];
}

/**
 * Read a `Dimension="d1*d2*...*dn"` attribute into every extent it declares.
 *
 * All of them are kept: MATLAB's own binary dictionary writes a 2x3x2 as
 * `"2*3*2"` with a flat column-major body, so folding the trailing extents into
 * the column count (2x6) reported a shape MATLAB never had, mislabelled every
 * element, and wrote `Matrix(2,6)` back on save. The serial string carries the
 * full rank now — `Matrix(2,3,2)` — so there is nothing left to fold into.
 *
 * A trailing singleton is dropped because MATLAB's `size()` drops it too: a
 * 2x3x1 IS a 2x3.
 *
 * The two off-nominal extent counts still have to be normalized here so every
 * caller folds them the SAME way — they used to each `split('*')` for
 * themselves, and both cases went wrong:
 *
 *   - Fewer than two extents (`Dimension="3"`) left `cols` undefined, so the value
 *     formatted as `Matrix(3,undefined)` with an EMPTY body — every element
 *     dropped on load, and re-saved as the scalar 0. A lone extent N is a row
 *     vector of N.
 *   - An unparseable Dimension has to become SOMETHING; a scalar is the least
 *     destructive guess.
 */
export function parseDims(dimension: string): number[] {
  // `''.split('*')` is `['']` and `Number('')` is 0, which is finite — without
  // this guard an absent Dimension would read as the empty 1x0.
  if (!dimension) {
    return [1, 1];
  }
  const parts = dimension.split('*').map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) {
    return [1, 1];
  }
  if (parts.length === 1) {
    return [1, parts[0]];
  }
  const dims = parts.slice();
  while (dims.length > 2 && dims[dims.length - 1] === 1) {
    dims.pop();
  }
  return dims;
}

/**
 * Read a compressed-binary `.sldd` package into dictionary content.
 *
 * `warnings`, when given, is appended to for anything the package CLAIMED to hold and
 * this reader could not read — see the header of this file for why the diagnostics
 * arrive through a parameter instead of the return value. Omitting it is supported and
 * unchanged: nothing is thrown, nothing is logged, and the content is identical.
 *
 * A package with no `data/chunk0.xml` at all still throws, because that is not a
 * dictionary this reader can answer for at all — there is no content to hand back and
 * warn beside. The line between the throw and a warning is whether the part is there:
 * present-and-unreadable is a short read, absent is not a `.sldd`.
 */
export function parseBinarySldd(
  arrayBuffer: ArrayBuffer,
  warnings?: ParseWarning[],
): Record<string, unknown> {
  const uint8 = new Uint8Array(arrayBuffer);
  const entries = unzipEntries(uint8);
  const decoder = new TextDecoder();

  const dataXml = entries[DATA_PART_XML];
  if (!dataXml) {
    throw new Error(`Missing ${DATA_PART_XML} in binary SLDD`);
  }
  const xmlString = decoder.decode(dataXml);

  const zipMetadata: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(entries)) {
    if (name !== DATA_PART_XML) {
      zipMetadata[name] = data;
    }
  }
  // How the archive lists its members — order, time stamps, compression — so a save can
  // write the package back as it was (BinarySlddSerializer). Nothing at all is recorded
  // for an archive the directory walk does not understand.
  const stamps = zipMemberStamps(uint8);
  if (stamps) {
    recordPackageStamps(zipMetadata, stamps);
  }

  return parseBinarySlddParts(xmlString, zipMetadata, warnings);
}

// Build the model content from a live data/chunk0.xml string plus the pass-through
// zip parts, without a zip/unzip round-trip. Used by the writable binary editor to
// rebuild the model after each in-memory edit, and by the save gate to re-validate.
//
// `warnings` is the same optional sink `parseBinarySldd` takes and forwards here; this
// is where every dictionary warning about the bytes is actually raised.
export function parseBinarySlddParts(
  xmlString: string,
  zipMetadata: Record<string, Uint8Array>,
  warnings?: ParseWarning[],
): Record<string, unknown> {
  const decoder = new TextDecoder();

  let release = '';
  if (zipMetadata['metadata/mwcoreProperties.xml']) {
    const xml = decoder.decode(zipMetadata['metadata/mwcoreProperties.xml']);
    const match = xml.match(/<matlabRelease>([^<]+)<\/matlabRelease>/);
    if (match) {
      release = match[1];
    }
  }

  // The one part this reader reads anything out of, so losing it loses the dictionary
  // rather than a piece of it: `source-unreadable`, and no `part`, because the warning
  // is about the source as a whole. The part is PRESENT whichever way this function was
  // reached — `parseBinarySldd` threw already if the package did not contain it, and a
  // direct caller is handing over a chunk it holds — so the file is claiming to be a
  // dictionary, and every entry in it is now missing from what the user sees.
  //
  // Two ways it goes wrong, and both used to be silent or worse:
  //
  //   - the reader refuses the document outright for a few malformations (an unclosed
  //     CDATA is one — `XmlReader` pins which), and that throw used to escape
  //     `parseBinarySldd` and take the whole open down, naming no file. A host with four
  //     dictionaries open could not tell which one it was.
  //   - Far more often it is LENIENT and answers with a document that has no
  //     `DataSource` key: an empty object for a part carrying no markup at all (plain
  //     text, an empty part, raw binary — the shape a truncated or mis-encoded write
  //     takes), and a one-key document under the wrong name for a part whose root
  //     element is something else. That reached `dataSource['@_FormatVersion']` on
  //     `undefined` and threw a TypeError, or — for the wrong-root case — read as a
  //     perfectly well-formed dictionary with zero entries and reported success. The
  //     second is the failure this item exists to remove: indistinguishable from a
  //     dictionary the user had just created and not filled in.
  //
  // The test is the KEY, not its value. `<DataSource/>` parses to the empty string,
  // and so does a root tag with a malformed attribute list; there is nothing left in
  // the parsed document to tell those two apart, and a dictionary a user just created
  // really is `<DataSource/>` with no entries. Warning on a falsy value would put a
  // warning on every empty dictionary in existence, which is the "count on every
  // legacy file" failure — so a present key is taken at its word and read as empty.
  let doc: Record<string, unknown> = {};
  let refused = false;
  const read: ReadEntrySpans = { spans: [], clean: true, read: false };
  try {
    doc = readDictionaryXml(xmlString, read) as Record<string, unknown>;
  } catch (err) {
    refused = true;
    warnings?.push({
      code: 'source-unreadable',
      message: `The dictionary part "${DATA_PART_XML}" could not be read (${reasonOf(err)}), `
        + 'so this dictionary reads as empty.',
    });
  }
  // One warning per loss, not two: a document the reader refused outright has already
  // been reported, and saying "and it has no <DataSource>" about it as well would report
  // the same lost dictionary twice.
  if (!refused && !Object.prototype.hasOwnProperty.call(doc, 'DataSource')) {
    warnings?.push({
      code: 'source-unreadable',
      message: `The dictionary part "${DATA_PART_XML}" holds no <DataSource> element, `
        + 'so this dictionary reads as empty.',
    });
  }
  // Normalized rather than trusted: the key can be present carrying a string (a root
  // element with text in it, or one whose attributes did not parse), and the code below
  // reads attributes and children off it.
  const raw = doc.DataSource;
  const dataSource = (typeof raw === 'object' && raw !== null ? raw : {}) as XmlNode;
  const dataSourceAttrs = {
    FormatVersion: dataSource['@_FormatVersion'] || '1',
    MinRelease: dataSource['@_MinRelease'] || 'R2014a',
    Arch: dataSource['@_Arch'] || '',
  };

  // Where each entry sits in the text, found by reading the markup: by the fast reader, as it
  // read the chunk, or, for a chunk it declined, by a scan that reads the markup the same way.
  const { spans, clean } = read.read ? read : entrySpans(xmlString);
  const ddEntries: Record<string, unknown>[] = [];
  const objects = (dataSource.Object || []) as XmlNode[];

  let entryIdx = 0;
  for (const obj of objects) {
    const objClass = obj['@_Class'];
    if (objClass === 'DD.ENTRY') {
      encodedInEntry = false;
      const span = spans[entryIdx];
      const entry = parseEntry(obj, span ? xmlString.substring(span[0], span[1]) : '');
      ddEntries.push(entry);
      // Only an entry that HAS an encoded value is walked for unreadable ones — the walk
      // visits every value, and nearly every entry of every dictionary has none.
      if (encodedInEntry && warnings) {
        warnUnreadableEncoded(entry.value, entry.name as string, warnings);
      }
      entryIdx++;
    }
  }

  let allowAccessBWS = false;
  const dictionaryReferences: string[] = [];
  for (const obj of objects) {
    if (obj['@_Class'] === 'DD.Dictionary') {
      const abws = getProperty(obj, 'AccessBaseWorkspace');
      if (abws === '1' || abws === 'true') {
        allowAccessBWS = true;
      }
    }
    // Referenced sub-dictionaries (sldd -> sldd) are stored as
    // <Object Class="DD.DICTIONARYREFERENCE"><P Name="Subdictionary">x.sldd</P></Object>
    if (obj['@_Class'] === 'DD.DICTIONARYREFERENCE') {
      const sub = getProperty(obj, 'Subdictionary');
      if (sub) {
        dictionaryReferences.push(sub);
      } else {
        // The object IS the file saying this dictionary inherits from another one. With
        // no readable Subdictionary the inheritance cannot be resolved, so it was
        // dropped here and every entry the referenced dictionary contributes is missing
        // from what the user sees — with nothing anywhere to say so. `part-unreadable`
        // rather than `source-unreadable` because the dictionary's own entries are all
        // fine; this is one piece of it. No `part`: the whole point is that nothing in
        // the bytes names the dictionary that is missing, and inventing a name for it
        // would be worse than leaving the field off.
        warnings?.push({
          code: 'part-unreadable',
          message: 'This dictionary references another dictionary whose name could not be read, '
            + 'so the entries it inherits from that dictionary were not read.',
        });
      }
    }
  }

  const content = {
    __MW_TEXT_COREPROPERTIES__: { release },
    [TEXT_PARTS]: {
      [DATA_PART_KEY]: {
        [TEXT_CONTENT]: {
          entries: ddEntries,
          'Dictionary References': dictionaryReferences,
          AllowAccessBWS: allowAccessBWS,
        },
      },
    },
    __rawXml: xmlString,
    __zipMetadata: zipMetadata,
    __dataSourceAttrs: dataSourceAttrs,
    ...scCatalogOf(zipMetadata, decoder),
  };

  // The bytes each entry was read from, for the save that writes an unedited entry back
  // as them (BinarySlddSerializer). Recorded only for a document this reader read, and
  // only when every entry pairs with its span — see `entryFrame` for what is checked.
  const frame = refused || !Object.prototype.hasOwnProperty.call(doc, 'DataSource')
    ? null
    : entryFrame(xmlString, spans, clean, ddEntries, { allowAccessBWS, dictionaryReferences, dataSourceAttrs });
  if (frame) {
    recordReadFrame(content, frame);
    ddEntries.forEach((entry, index) => {
      recordReadSource(entry, { frame, index, fragment: entry.rawXml as string });
    });
  }
  return content;
}

/**
 * The frame of a chunk whose every entry is paired with the span of text it was read
 * from, or null when the pairing cannot be trusted.
 *
 * The spans come from reading the chunk's markup (the fast reader's record of it, or
 * `entrySpans`) and the entries from the XML reader, and nothing but this check ties the two
 * together. One pair out of step, and every pair after it, would have the save write an entry
 * as ANOTHER entry's bytes. Each span is one element, read as XML reads it; the checks below
 * hold the spans and the reader's entries to each other, and stay even where that reading
 * alone would answer. So a chunk is paired only when all of these hold, and on any failure no
 * entry of the file gets a source — it is regenerated whole, exactly as before:
 *
 *   - the scan vouches for its spans (`clean`): it met no markup it cannot account for, no
 *     entry tag MATLAB does not write, and no object nested in an entry;
 *   - as many spans as entries;
 *   - each span spells the Name the reader read for its entry, and the UUID too when the
 *     span has one;
 *   - between two entries there is only whitespace, nothing before the first entry is an
 *     object, and `</DataSource>` follows the last one: every other object in the chunk
 *     sits after the entries, which is where a save writes the dictionary-level objects
 *     back when they change;
 *   - outside the entries there is no comment, CDATA section or processing instruction but
 *     the XML declaration, and nothing after the last entry spells `DD.ENTRY`: the text a
 *     save keeps around the entries is what it writes the objects after them into.
 *
 * A chunk with no entries is framed too, so a save that adds none can keep it whole.
 */
function entryFrame(
  xml: string,
  spans: Span[],
  clean: boolean,
  entries: Record<string, unknown>[],
  read: { allowAccessBWS: boolean; dictionaryReferences: string[]; dataSourceAttrs: Record<string, string> },
): ChunkFrame | null {
  if (!clean || spans.length !== entries.length) {
    return null;
  }
  for (let i = 0; i < spans.length; i++) {
    const [start, end] = spans[i];
    const fragment = xml.substring(start, end);
    const metadata = (entries[i].metadata || {}) as Record<string, unknown>;
    if (charPropOf(fragment, 'Name') !== (entries[i].name as string)) {
      return null;
    }
    const uuid = charPropOf(fragment, 'UUID');
    if (uuid !== null && uuid !== metadata.uuid) {
      return null;
    }
    const before = i === 0 ? '' : xml.substring(spans[i - 1][1], start);
    if (before.trim() !== '') {
      return null;
    }
  }
  const head = spans.length > 0 ? xml.substring(0, spans[0][0]) : xml;
  const tail = spans.length > 0 ? xml.substring(spans[spans.length - 1][1]) : xml;
  if (spans.length > 0 && (head.indexOf('<Object') >= 0 || tail.indexOf('</DataSource>') < 0)) {
    return null;
  }
  // Outside the entries: no comment, CDATA section or processing instruction but the XML
  // declaration, for a span to lie inside, and no DD.ENTRY after the last span. A span inside
  // one, standing in for an entry the search did not find (one after it, in quotes MATLAB
  // does not write), passes every check above.
  const declaration = head.indexOf('<?');
  if (head.indexOf('<!') >= 0
    || (declaration >= 0 && (!head.startsWith('<?xml', declaration) || head.indexOf('<?', declaration + 2) >= 0))
    || (spans.length > 0 && (tail.indexOf('<!') >= 0 || tail.indexOf('<?') >= 0 || tail.indexOf('DD.ENTRY') >= 0))) {
    return null;
  }
  return {
    xml,
    spans,
    insertAt: spans.length > 0 ? -1 : dataSourceContentStart(xml),
    allowAccessBWS: read.allowAccessBWS,
    dictionaryReferences: [...read.dictionaryReferences],
    dataSourceAttrs: { ...read.dataSourceAttrs },
  };
}

/**
 * The text of the first `<P Name="…" …>` of that name in an entry's span, with XML's five
 * named entities decoded; '' for a self-closed one, null for none. The reader decodes numeric
 * character references too, and this does not: a Name or UUID that holds one is not the
 * reader's, and the chunk is not paired. That costs nothing measured (every entry of the 57
 * binary dictionaries pairs), and keeps a second copy of the reader's decoder out of here.
 */
function charPropOf(fragment: string, name: string): string | null {
  const at = fragment.indexOf(`<P Name="${name}"`);
  if (at < 0) {
    return null;
  }
  const gt = fragment.indexOf('>', at);
  if (gt < 0) {
    return null;
  }
  if (fragment.charCodeAt(gt - 1) === 0x2f) {
    return '';
  }
  const lt = fragment.indexOf('<', gt + 1);
  const text = fragment.substring(gt + 1, lt < 0 ? fragment.length : lt);
  return text.replace(/&(lt|gt|amp|quot|apos);/g, (_m, e: string) =>
    e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : "'");
}

// Just past the `<DataSource …>` open tag, where a first entry goes in a chunk that has
// none, as the span scan reads the markup: text that spells `<DataSource` in the XML
// declaration, a comment or an attribute value is not the tag, where a search of the text
// took it for one and a save wrote the entry into the declaration. -1 for a self-closed
// `<DataSource/>`, a root of another name, or a chunk the scan cannot vouch for; a save that
// adds an entry to such a chunk, or rewrites its dictionary-level objects, generates it whole.
function dataSourceContentStart(xml: string): number {
  const root = { contentAt: -1 };
  return entrySpans(xml, root).clean ? root.contentAt : -1;
}

/**
 * The System Composer catalog of a compressed-binary dictionary, read from the zipped
 * interface-dictionary member.
 *
 * This reader is where it has to happen: the member is XML inside the package, and no
 * layer above ever sees those bytes — `SlddNode.parse` receives the parts bag, which
 * carries the member as raw pass-through bytes in `__zipMetadata`. Without this the
 * catalog was simply absent for the binary flavour, so a struct type read as 'Data
 * Interface' — which is what MATLAB itself answers with the part gone, but not what it
 * answers with the part there, and the file is the authority when it has one.
 *
 * Spread into the content bag, so a dictionary with no interface dictionary (nearly
 * all of them) adds no key at all and `SlddNode.parse` falls through to the textual
 * reader as before. A member that is present but yields no definitions takes the same
 * exit, and deliberately says nothing — see the note below `classificationOf` in
 * ScCatalog for the MATLAB measurement that settled it.
 */
function scCatalogOf(
  zipMetadata: Record<string, Uint8Array>,
  decoder: TextDecoder,
): { __scCatalog?: SystemComposerCatalog } {
  const member = zipMetadata[SC_PART_XML];
  if (!member) {
    return {};
  }
  const defs = scanScXml(decoder.decode(member));
  if (!defs.length) {
    return {};
  }
  return { __scCatalog: catalogFromDefinitions(defs) };
}

/**
 * One `part-unreadable` warning for each encoded value under an entry whose bytes cannot
 * be read (EncodedValue.encodedStream says why), named by the entry. Such a value is shown
 * as an undecoded placeholder and written back exactly as it was read, so nothing is lost
 * from the FILE — but the bytes claim a value and the reader did not produce one, which is
 * what the channel is for. A stream that reads is not reported however it then decodes:
 * that is the node layer's to show, and an MCOS object it cannot resolve is shown as the
 * opaque object it is in every other format.
 */
function warnUnreadableEncoded(value: unknown, entryName: string, warnings: ParseWarning[]): void {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object') {
      continue;
    }
    if (isEncodedValue(v)) {
      const reason = encodedStream(v).reason;
      if (reason) {
        warnings.push({
          code: 'part-unreadable',
          message:
            `"${entryName}" holds a value stored encoded that could not be read, because ${reason}; `
            + 'it is shown as not decoded and saved unchanged.',
          part: entryName,
        });
      }
      continue;
    }
    for (const child of Array.isArray(v) ? v : Object.values(v)) {
      stack.push(child);
    }
  }
}

/**
 * Where each entry's `<Object Class="DD.ENTRY">…</Object>` sits in the chunk, in document
 * order, found by reading the chunk's markup rather than by searching its text.
 *
 * A search for the open tag and the first `</Object>` after it trusts every such text to be a
 * tag, and XML lets text that spells one sit inside an entry in five places: a comment, a
 * processing instruction, a CDATA section, and an attribute value in either quote. A
 * `</Object>` in one of them ended the span early; in the last entry nothing after it could
 * tell, and renaming or deleting that entry wrote a document with one `</Object>` too many.
 * So this reads the chunk as XML does, one piece of markup after another: a comment, CDATA
 * section or processing instruction is skipped to its end, a tag is read attribute by attribute
 * with each value skipped to its closing quote, and every element is closed by name. A span is
 * then exactly one element: a direct child of the root whose open tag is MATLAB's, from that
 * tag to the `</Object>` that closes it.
 *
 * The fast reader (`DictionaryXmlFast`) records the same spans as it reads a chunk, so this
 * scan is run only for a chunk that reader declines, or one whose line ends it normalized:
 * it is the general engine's half of the same answer. The two are held to each other over
 * every binary fixture (test/binarySaveKeepsUnedited.test.ts).
 *
 * `clean` is false wherever the scan cannot vouch for the spans, and `entryFrame` then pairs
 * nothing:
 *   - markup it cannot account for: a comment, CDATA section or processing instruction that is
 *     never closed, a DOCTYPE or any other `<!`, a `<` that starts no tag, a tag that is not
 *     a name followed by quoted attributes, or a close tag that does not close the element
 *     open. The scan stops there, and the spans it has are the entries before that point,
 *     which is what `rawXml` needs;
 *   - a document that is not one element: a second root, or an element still open at the end;
 *   - a processing instruction the reader would end elsewhere. XML ends one at its first `?>`,
 *     and fast-xml-parser at the first `?>` outside quotes, so a quote in one can make the two
 *     read different elements from that point on. The scan stops there too;
 *   - an object open tag at the top that is not MATLAB's entry tag (`<Object Class="DD.ENTRY">`)
 *     and spells `DD.ENTRY` or holds an entity (`spellsEntry`), as `<Object  Class='DD.ENTRY'>`
 *     does, which the reader reads as an entry. The scan stops there, since the entries after
 *     it could no longer be counted off against the reader's;
 *   - an object nested in an entry, or an entry closed other than by `</Object>`. Neither is
 *     a doubt about the span, and the scan goes on, but MATLAB writes neither, and the pairing
 *     declines them as it did when the search could not tell them from a span cut short.
 *
 * Given `root`, the scan also sets `root.contentAt` to just past the root's open tag when the
 * root is a `<DataSource …>` that is not self-closed, and to -1 otherwise: where a first entry
 * goes in a chunk that has none (`dataSourceContentStart`).
 *
 * Linear in the chunk's length: every step moves forward, and none searches past the point
 * where the scan then stops. It reads the 5.7 M tags of the largest chunk measured (207 MB,
 * 140,000 entries) in 323 ms.
 */
export function entrySpans(xml: string, root?: { contentAt: number }): { spans: Span[]; clean: boolean } {
  const spans: Span[] = [];
  const n = xml.length;
  // The open elements, as where each one's name starts and how long it is, by depth.
  const nameAt: number[] = [];
  const nameLen: number[] = [];
  let depth = 0;
  let roots = 0;
  let clean = true;
  let entryAt = -1; // where the entry being read began, or -1 between entries
  let pos = 0;
  for (;;) {
    const lt = xml.indexOf('<', pos);
    if (lt < 0) {
      break;
    }
    const c = xml.charCodeAt(lt + 1);
    if (c === SLASH) {
      const start = lt + 2;
      let k = start;
      let ch = xml.charCodeAt(k);
      while (isNameChar(ch)) {
        ch = xml.charCodeAt(++k);
      }
      const len = k - start;
      while (isXmlSpace(ch)) {
        ch = xml.charCodeAt(++k);
      }
      if (len === 0 || ch !== GT || depth === 0 || !sameName(xml, nameAt[depth - 1], nameLen[depth - 1], start, len)) {
        return { spans, clean: false };
      }
      depth--;
      if (depth === 1 && entryAt >= 0) {
        if (k !== lt + CLOSE_OBJECT.length - 1) {
          clean = false;
        }
        spans.push([entryAt, k + 1]);
        entryAt = -1;
      }
      pos = k + 1;
      continue;
    }
    if (c === BANG) {
      const end = xml.startsWith('!--', lt + 1) ? xml.indexOf('-->', lt + 4)
        : xml.startsWith('![CDATA[', lt + 1) ? xml.indexOf(']]>', lt + 9)
          : -1;
      if (end < 0) {
        return { spans, clean: false };
      }
      pos = end + 3;
      continue;
    }
    if (c === QUESTION) {
      const end = xml.indexOf('?>', lt + 2);
      if (end < 0 || piEndOutsideQuotes(xml, lt + 1) !== end) {
        return { spans, clean: false };
      }
      pos = end + 2;
      continue;
    }
    if (!isNameStart(c)) {
      return { spans, clean: false };
    }
    let k = lt + 2;
    let ch = xml.charCodeAt(k);
    while (isNameChar(ch)) {
      ch = xml.charCodeAt(++k);
    }
    const len = k - lt - 1;
    // name="value" or name='value', each after whitespace, up to `>` or `/>`.
    for (;;) {
      const gap = k;
      while (isXmlSpace(ch)) {
        ch = xml.charCodeAt(++k);
      }
      if (ch === GT || ch === SLASH) {
        break;
      }
      if (k === gap || !isNameStart(ch)) {
        return { spans, clean: false };
      }
      ch = xml.charCodeAt(++k);
      while (isNameChar(ch)) {
        ch = xml.charCodeAt(++k);
      }
      while (isXmlSpace(ch)) {
        ch = xml.charCodeAt(++k);
      }
      if (ch !== EQUALS) {
        return { spans, clean: false };
      }
      ch = xml.charCodeAt(++k);
      while (isXmlSpace(ch)) {
        ch = xml.charCodeAt(++k);
      }
      if (ch !== QUOTE && ch !== APOS) {
        return { spans, clean: false };
      }
      const close = xml.indexOf(ch === QUOTE ? '"' : "'", k + 1);
      if (close < 0) {
        return { spans, clean: false };
      }
      k = close + 1;
      ch = xml.charCodeAt(k);
    }
    const selfClosed = ch === SLASH;
    if (selfClosed && xml.charCodeAt(++k) !== GT) {
      return { spans, clean: false };
    }
    const end = k + 1;
    if (depth === 0) {
      roots++;
      if (root !== undefined && roots === 1) {
        root.contentAt = !selfClosed && len === DATA_SOURCE.length && xml.startsWith(DATA_SOURCE, lt + 1) ? end : -1;
      }
    }
    if (len === 6 && xml.startsWith('Object', lt + 1)) {
      if (depth === 1) {
        if (xml.startsWith(ENTRY_OPEN, lt)) {
          entryAt = lt;
        } else if (spellsEntry(xml.substring(lt, end))) {
          return { spans, clean: false };
        }
      } else if (entryAt >= 0) {
        clean = false;
      }
    }
    if (!selfClosed) {
      nameAt[depth] = lt + 1;
      nameLen[depth] = len;
      depth++;
    }
    pos = end;
  }
  return { spans, clean: clean && depth === 0 && roots === 1 };
}

const CLOSE_OBJECT = '</Object>';
const DATA_SOURCE = 'DataSource';
const GT = 0x3e;
const SLASH = 0x2f;
const BANG = 0x21;
const QUESTION = 0x3f;
const EQUALS = 0x3d;
const QUOTE = 0x22;
const APOS = 0x27;

// What each ASCII character is to a tag, as a table, because the scan asks it of nearly every
// character of every tag: XML's four whitespace characters, the only ones that separate a
// tag's parts, and the ASCII part of XML's name characters, which is every name a dictionary
// uses. Any other character in a tag is markup the scan does not account for. A table rather
// than comparisons: 323 ms against 360 ms over the largest chunk measured.
const SPACE_CHAR = 1;
const NAME_CHAR = 2;
const NAME_START = 4;
const CHAR_KIND = new Uint8Array(128);
for (const c of [0x20, 0x0a, 0x09, 0x0d]) {
  CHAR_KIND[c] = SPACE_CHAR;
}
for (let c = 0; c < 128; c++) {
  const start = (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || c === 0x5f || c === 0x3a;
  if (start) {
    CHAR_KIND[c] = NAME_START | NAME_CHAR;
  } else if ((c >= 0x30 && c <= 0x39) || c === 0x2d || c === 0x2e) {
    CHAR_KIND[c] = NAME_CHAR;
  }
}

// `c` is a char code, or NaN past the end, which is none of these.
function isXmlSpace(c: number): boolean {
  return c < 128 && CHAR_KIND[c] === SPACE_CHAR;
}

function isNameStart(c: number): boolean {
  return c < 128 && (CHAR_KIND[c] & NAME_START) !== 0;
}

function isNameChar(c: number): boolean {
  return c < 128 && (CHAR_KIND[c] & NAME_CHAR) !== 0;
}

// Whether the name at `b` (`bLen` long) is the one at `a`, compared in place: a close tag is
// matched against its open one for each of the millions a chunk has, so no string is made.
function sameName(xml: string, a: number, aLen: number, b: number, bLen: number): boolean {
  if (aLen !== bLen) {
    return false;
  }
  for (let i = 0; i < aLen; i++) {
    if (xml.charCodeAt(a + i) !== xml.charCodeAt(b + i)) {
      return false;
    }
  }
  return true;
}

// Where fast-xml-parser ends a processing instruction it starts reading at `from`, just past the
// `<`: the first `?>` outside a quoted run, a quote of either kind opening one and the same kind
// closing it.
function piEndOutsideQuotes(xml: string, from: number): number {
  let quote = 0;
  for (let k = from; k < xml.length; k++) {
    const c = xml.charCodeAt(k);
    if (quote !== 0) {
      if (c === quote) {
        quote = 0;
      }
    } else if (c === QUOTE || c === APOS) {
      quote = c;
    } else if (c === QUESTION && xml.charCodeAt(k + 1) === GT) {
      return k;
    }
  }
  return -1;
}

function parseEntry(obj: XmlNode, rawXml: string): Record<string, unknown> {
  const name = getProperty(obj, 'Name') || '';
  const uuid = getProperty(obj, 'UUID') || '';
  const namespace = getProperty(obj, 'Namespace') || '';
  const lastMod = getProperty(obj, 'LastMod') || '';
  const lastModBy = getProperty(obj, 'LastModBy') || '';
  const isDerived = getProperty(obj, 'IsDerived') || '0';

  const valueProp = getPropertyNode(obj, 'Value');
  let value: unknown = null;
  if (valueProp) {
    value = parseEntryValue(valueProp);
  }

  return {
    name,
    metadata: {
      uuid,
      namespace,
      lastModifiedDate: formatDate(lastMod),
      lastModifiedBy: lastModBy,
      isderived: isDerived,
      _rawLastMod: lastMod,
    },
    value,
    rawXml,
  };
}

// The SLDD Struct envelope for N struct <Element>s. A struct arrives in four
// places (entry value, nested property, cell item, dimensioned property) and every
// one of them has to emit this exact shape, because it is what tells the SAVE path
// to write `Class="struct"` back — a struct that loses the envelope is written as
// `Class="char">[object Object]` and its fields are gone from the file.
//
// `declaredFields` is only consulted when there is no element to read the names off, which is
// the one case MATLAB states them separately — see `fieldNamesOf`.
function structValue(
  elements: XmlNode[],
  dimParts: number[],
  declaredFields: string[] = [],
): Record<string, unknown> {
  const parsed = elements.map((e) => parseStructElement(e));
  return {
    _array_type: 'Struct',
    _dimensions: dimParts,
    _elements: parsed,
    _fields: parsed.length > 0 ? Object.keys(parsed[0]) : declaredFields,
    _mw_element_type: 'MATLABArray',
  };
}

/**
 * The field names a struct declares with `<Field Name="…"/>` children.
 *
 * MATLAB writes these on a struct with NO elements and on no other — measured across every
 * struct-classed `<P>` of a dictionary MATLAB authored: all four empty ones carry them, all
 * four non-empty ones carry none. The rule behind that is plain once seen: a struct with an
 * element states its field names as that element's `<P Name="…">` children, and an EMPTY one
 * has nowhere else to put them. It still HAS them — `struct('a', {})` is a 0x0 struct with a
 * field called `a` — so this is the only channel for the names of an empty struct's fields.
 */
function fieldNamesOf(node: XmlNode): string[] {
  return (node.Field || []).map((f) => f['@_Name'] || '').filter((n) => n !== '');
}

// The SLDD Cell envelope. The dimension DEFAULT differs by caller (an entry value
// with no Dimension is 1x1; a nested cell is 1xN), so dims are the caller's to
// decide and only the envelope is shared.
function cellValue(elements: XmlNode[], dimParts: number[]): Record<string, unknown> {
  return {
    _array_type: 'Cell',
    _dimensions: dimParts,
    _elements: elements.map((e) => parseCellElement(e)),
    _mw_element_type: 'MATLABArray',
  };
}

// The SLDD object-array envelope, in MATLAB's text spelling of one: the class the elements
// share on the WRAPPER (`_array_class`), and on each element of another class that element's
// own (`_object_class`). MATLAB states each element's class on its own <Element>, and a
// config set's Components mixes nine or more: this used to read the first element's class
// for the whole array and drop the rest, so every component read, showed, copied and saved
// as a Simulink.SolverCC.
//
// A LATER element carrying no Class of its own still contributes its <P> bag, as one of the
// first element's class: this path used to re-enter parseElement per element and index into
// the single-element wrapper it returns, which threw on a classless later element and took
// the whole file's read down with it.
//
// With no class at all there is no object array to describe — a classless <Element>
// is a struct element — and an empty _array_class is a shape NOTHING downstream
// accepts: it is falsy, so the node registry does not route it and the serializer
// writes `Class="char">[object Object]`, losing every field on the next save. So an
// unclassed element set decodes as the struct array it is.
//
// `base` is the class the array's place names, where it names one (componentsBaseOf): it is
// the array's class whatever its elements are.
function objectArrayValue(elements: XmlNode[], dimParts: number[], base?: string): Record<string, unknown> {
  const first = elements.length > 0 ? elements[0]['@_Class'] || '' : '';
  if (!first) {
    return structValue(elements, dimParts);
  }
  const classes = elements.map((e) => e['@_Class'] || first);
  const arrayClass = base ?? arrayClassOf(classes);
  return {
    _array_class: arrayClass,
    _dimensions: dimParts,
    _mw_element_type: 'MATLABArray',
    _elements: elements.map((e, k) => objectElement(e, classes[k], arrayClass)),
  };
}

/**
 * One element of an object, `el`, of class `ownClass` in an array of `arrayClass`: its
 * `_object_class` where the two differ, its property bag, and the Source and PropertyType MATLAB
 * wrote on any of its properties (XmlUtils.PROPERTY_SOURCE_KEY), each only where there is one, in
 * that order.
 */
function objectElement(el: XmlNode, ownClass: string, arrayClass: string): Record<string, unknown> {
  const element: Record<string, unknown> = {};
  if (ownClass !== arrayClass) {
    element._object_class = ownClass;
  }
  element._properties = parseStructElement(el, ownClass);
  const sources = propertySources(el);
  if (sources) {
    element[PROPERTY_SOURCE_KEY] = sources;
  }
  return element;
}

/**
 * The Source and PropertyType MATLAB wrote on each named property of `el`, by name, or null when
 * it wrote neither on any. MATLAB writes them on a dynamic property, `<P
 * Name="AutosarSchemaVersion" Source="dynamic" PropertyType="…" Class="char">`, which
 * parseStructElement reads into the bag like any other property: these two used to be dropped
 * there, so a save wrote the property as an ordinary one. The unnamed saveobj envelope's are
 * not here: parseStructElement files the envelope under SAVEOBJ_KEY, and DataNode.pxAttrs
 * writes its Source back.
 */
function propertySources(el: XmlNode): Record<string, PropertySource> | null {
  let sources: Record<string, PropertySource> | null = null;
  for (const prop of el.P || []) {
    const name = prop['@_Name'];
    const source = prop['@_Source'];
    const propertyType = prop['@_PropertyType'];
    if (name === undefined || source === 'saveobj' || (source === undefined && propertyType === undefined)) {
      continue;
    }
    const kept: PropertySource = {};
    if (source !== undefined) {
      kept.source = source;
    }
    if (propertyType !== undefined) {
      kept.propertyType = propertyType;
    }
    sources = sources ?? {};
    setOwn(sources, name, kept);
  }
  return sources;
}

/**
 * The class an object array of elements of `classes` is, as MATLAB's text format names it in
 * `_array_class`: the class every element shares; for elements of several classes, the common
 * base class where it can be derived (heterogeneousBaseOf); and otherwise the first element's,
 * which is what this reader named every such array before it kept the elements' own. A config
 * set's Components does not come here: its place names its class (componentsBaseOf).
 *
 * The first element's class is still what an array of no derivable base reads as: of the 71
 * mixed arrays the binary dictionaries of the test fixtures, the parity artifacts and the local
 * corpus hold, one, a simmechanics.ConfigurationSet's Components of two simmechanics classes.
 */
function arrayClassOf(classes: string[]): string {
  if (classes.every((c) => c === classes[0])) {
    return classes[0];
  }
  return heterogeneousBaseOf(classes) ?? classes[0];
}

/**
 * The common base class of an array mixing `classes`, where this reader can derive one, or
 * undefined.
 *
 * A binary dictionary does not state it: its `<P Name="UserMLArray2" Dimension="1*2">` carries
 * no Class, and each element names only its own. A text dictionary does, and two rules give the
 * base it names from the classes alone:
 * - Simulink.ConfigComponent, for an array whose classes each belong to CONFIG_COMPONENTS: every
 *   Components array of a Simulink.ConfigSet and of a Simulink.RTWCC that MATLAB wrote into a
 *   text dictionary is `_array_class` Simulink.ConfigComponent (30 of 30, in five
 *   dictionaries), over classes each listed there.
 * - The one known MathWorks class (isMathWorksClass) of an array mixing it with classes that are
 *   not: a user's class can derive from a MathWorks class and a MathWorks class never from a
 *   user's, so the MathWorks class is the base the user classes extend. A text dictionary MATLAB
 *   wrote names a Simulink.Signal subclass beside a Simulink.Signal `{"_array_class":
 *   "Simulink.Signal", …}`, and this reader read the binary twin of that array, in two
 *   dictionaries, as the subclass, the first element's class.
 * Of two MathWorks classes or more beside other classes, or of none, it names no base.
 */
function heterogeneousBaseOf(classes: string[]): string | undefined {
  if (classes.every((c) => c === CONFIG_COMPONENT || CONFIG_COMPONENTS.has(c))) {
    return CONFIG_COMPONENT;
  }
  const known = new Set(classes.filter(isMathWorksClass));
  return known.size === 1 ? [...known][0] : undefined;
}

/**
 * Whether `cls` is a known MathWorks class: a class of a package whose classes this package
 * already names as MathWorks' (MATHWORKS_PACKAGES). Simulink and mpt are the packages of every
 * class the node registry, the schema and the Kind column name (NodeClassMap, schema/index,
 * kindMap), and the two the test suite tells MATLAB's own objects from custom ones by; SlCovCC,
 * Sldv and hdlcoderui are the packages of the config components CONFIG_COMPONENTS names. A class
 * of any other package, MathWorks' or not (CoderTarget, SSC, simmechanics, AUTOSAR among them),
 * is not known here, and counts as one that is not MathWorks' (heterogeneousBaseOf).
 */
function isMathWorksClass(cls: string): boolean {
  const dot = cls.indexOf('.');
  return dot > 0 && MATHWORKS_PACKAGES.has(cls.slice(0, dot));
}

/** The packages of the known MathWorks classes (isMathWorksClass). */
const MATHWORKS_PACKAGES: ReadonlySet<string> = new Set(['Simulink', 'mpt', 'SlCovCC', 'Sldv', 'hdlcoderui']);

/**
 * The class the place of a property named `name` of an object of `ownerClass` names for an
 * object array there, or undefined where it names none: Simulink.ConfigComponent, for the
 * Components of a Simulink.ConfigSet or a Simulink.RTWCC, whatever components it holds.
 *
 * Every such array MATLAB wrote into a text dictionary is `_array_class`
 * Simulink.ConfigComponent (30 of 30, in five dictionaries). A binary dictionary names no base
 * for it, and can hold components no text dictionary has shown, so that CONFIG_COMPONENTS does
 * not list them: a CoderTarget.SettingsController, in seven config sets of a corpus dictionary,
 * and an SSC.SimscapeCC, in one of another. Those arrays used to read under their first
 * component's class, a Simulink.SolverCC.
 */
function componentsBaseOf(ownerClass: string | undefined, name: string | undefined): string | undefined {
  return name === 'Components' && (ownerClass === 'Simulink.ConfigSet' || ownerClass === 'Simulink.RTWCC') ? CONFIG_COMPONENT : undefined;
}

const CONFIG_COMPONENT = 'Simulink.ConfigComponent';

/** Each class MATLAB's text format lists as an element of a Simulink.ConfigComponent array (see heterogeneousBaseOf). */
const CONFIG_COMPONENTS: ReadonlySet<string> = new Set([
  'Simulink.SolverCC',
  'Simulink.DataIOCC',
  'Simulink.OptimizationCC',
  'Simulink.DebuggingCC',
  'Simulink.HardwareCC',
  'Simulink.ModelReferenceCC',
  'Simulink.SFSimCC',
  'Simulink.RTWCC',
  'Simulink.CodeAppCC',
  'Simulink.GRTTargetCC',
  'Simulink.ERTTargetCC',
  'Simulink.STFCustomTargetCC',
  'SlCovCC.ConfigComp',
  'Sldv.ConfigComp',
  'hdlcoderui.hdlcc',
]);

/**
 * A classed or shaped empty, as every place a value is read holds one, an entry's Value, an
 * object's property or a struct's field, and a cell's element: its class under the bare header
 * of its extents, `{_type: 'int16', _value: 'Matrix(0,0)'}`, each extent as the count it is
 * (Size.headerDigits: past 2^53 - 1 String spells some with digits that say another count), or
 * `[]` for the one empty that already is, a double 0x0, as both dictionaries hold it at a
 * property.
 *
 * MATLAB writes an empty as its class and a Dimension with a 0 in it and nothing else: `<P
 * Name="Elements_internal" Class="Simulink.BusElement" Dimension="0*0"/>`, `<P Name="intarray"
 * Class="int16" Dimension="0*0"/>`. The three places held it three ways: a cell's element under
 * the header, a double 0x0 too and a logical 0x0 as `{_type: 'logical', _value: '[]'}`; an
 * entry's Value as `{_type, _emptyDims}`, which a copy then wrote as `[]` and a paste into a
 * binary dictionary as a double 0x0; a property or a struct field as a classless `[]` for a
 * numeric class and `''`, a char, for every other. They hold one form now, which every XML
 * writer spells back as read (DataNode._matrixLiteralXml, MatlabVariableNode._serializeArrayXml)
 * and every node reads as an empty of its class and size (MatlabVariableNode.parseTypedArray). A
 * char is the one class with a form of its own at every size, and so has one empty at all three
 * places (charValue).
 *
 * Null for a class whose name this package's own values give another meaning under `_type`
 * (RESERVED_TYPE: `{_type: 'sparse'}` is a sparse literal, `{_type: 'cdata'}` complex text or a
 * MAT stream), which no MATLAB class is called and whose empty this form would misstate; the
 * place then holds it as it did before (parseEntryValue, parseTypedValue, parseCellElement).
 *
 * What a text dictionary is given for one is held where it was until MATLAB reads one back
 * (MatWriter.heldTextSpelling): that spelling, not this form, is the open question. A text
 * dictionary can hold this form itself, and what it holds is written as it holds it, so the form
 * says it was read here (XmlUtils.BINARY_EMPTY_KEY). The `[]` says nothing, being the same value
 * spelled the same in both dictionaries.
 */
function emptyOf(cls: string, dimParts: number[]): Record<string, unknown> | [] | null {
  if (RESERVED_TYPE.has(cls)) {
    return null;
  }
  if (cls === 'double' && dimParts.length === 2 && dimParts[0] === 0 && dimParts[1] === 0) {
    return [];
  }
  return { _type: cls, _value: 'Matrix(' + dimParts.map(headerDigits).join(',') + ')', [BINARY_EMPTY_KEY]: true };
}

/** The `_type`s this package's values give a meaning of their own, which no class's empty can wear (emptyOf). */
const RESERVED_TYPE = new Set(['mxchar', 'cdata', 'sparse', 'complex']);

/** Whether every extent is a count a `Matrix(…)` header states as digits (emptyOf): not 2.5, nor one String spells with an exponent. */
const headerCounts = (dimParts: number[]): boolean => dimParts.every((d) => /^\d+$/.test(headerDigits(d)));

function parseEntryValue(prop: XmlNode): unknown {
  const encoded = encodedOf(prop);
  if (encoded) {
    return encoded;
  }
  const className = prop['@_Class'] || null;
  const dimension = prop['@_Dimension'] || null;
  const elements = prop.Element;

  // Before the object arm below, which took an enumeration value's enumeral for an object
  // with no properties, and before the numeric tail, which took an empty one for a numeric
  // empty of its class: the cell reader's question, asked of an entry (see enumValue).
  if (prop['@_IsEnum'] !== undefined) {
    const enumerated = enumValue(prop, dimension);
    if (enumerated) {
      return enumerated;
    }
  }

  // Struct: Class="struct" with Element children (no Class on Element)
  if (className === 'struct') {
    return structValue(elements || [], dimension ? parseDims(dimension) : [1, 1], fieldNamesOf(prop));
  }

  // Cell: Class="cell" with Element children
  if (className === 'cell') {
    return cellValue(elements || [], dimension ? parseDims(dimension) : [1, 1]);
  }

  // String object: Element with Class="string"
  if (elements && elements.length > 0 && elements[0]['@_Class'] === 'string') {
    return parseStringValue(elements[0], dimension);
  }

  // Object: Element(s) with a Simulink class. A single <Element> is a scalar
  // object; MULTIPLE <Element>s are an object ARRAY (e.g. a 3x1 Simulink.Parameter)
  // and every element must be kept so the data model expands one row per element.
  if (elements && elements.length > 0 && elements[0]['@_Class']) {
    if (elements.length === 1) {
      return parseElement(elements[0]);
    }
    return objectArrayValue(elements, dimension ? parseDims(dimension) : [elements.length, 1]);
  }

  // Char (no elements, Class="char") — a row is its bare text, a shaped one carries
  // its extents; see charValue.
  if (className === 'char') {
    return charValue(getTextContent(prop), dimension, prop['@_Format']);
  }

  // Logical scalar (no dimension)
  if (className === 'logical' && !dimension) {
    const text = getTextContent(prop);
    return text === '1' || text === 'true';
  }

  // Numeric scalar or array
  const text = getTextContent(prop);
  if (isComplexAttr(prop['@_IsComplex'])) {
    return complexCdata(text, dimension, className);
  }
  const type = className || 'double';
  if (dimension) {
    const dimParts = parseDims(dimension);
    const total = dimParts.reduce((a, b) => a * b, 1);
    // An empty, as every place holds one (emptyOf). One that form cannot hold, of a reserved
    // class name or with an extent that is no count, keeps the form an entry's had,
    // `{_type, _emptyDims}`, which MatlabVariableNode.serializeValue writes from its dims.
    if (total === 0) {
      const empty = headerCounts(dimParts) ? emptyOf(type, dimParts) : null;
      return empty ?? { _type: type, _emptyDims: dimParts };
    }
    // Logical vector, matrix or N-D — shaped, and transposed out of column-major
    // order, exactly as the numeric branch below is (defect 44).
    if (type === 'logical') {
      return logicalValue(text, dimParts);
    }
    const parts = numericBody(text, type);
    // Column-major to row-major transpose
    const rowMajor = transposeColumnMajor(parts, dimParts);
    // Row vector (1*N)
    // Only a true rank-2 row vector may drop its shape: a 1x2x2 spelled as the
    // flat 4-vector [1, 2, 3, 4] reads back as a 1x4 MATLAB never had.
    if (dimParts.length <= 2 && dimParts[0] === 1) {
      return formatTypedVector(rowMajor, type);
    }
    // Column or matrix
    return formatMatrix(rowMajor, dimParts, type);
  }

  return formatTypedScalar(text, type);
}

function parseCellElement(el: XmlNode): unknown {
  const encoded = encodedOf(el);
  if (encoded) {
    return encoded;
  }
  const elClass = el['@_Class'] || '';
  const dimension = el['@_Dimension'] || null;
  const text = getTextContent(el);

  // Before the object tail below, which took the wrapper of an enumeration value for the
  // classless holder of an object and its enumeral for an object with no properties.
  if (el['@_IsEnum'] !== undefined) {
    const enumerated = enumValue(el, dimension);
    if (enumerated) {
      return enumerated;
    }
  }

  if (isNumericClass(elClass)) {
    // Complexity is asked BEFORE the shape, the way parsePropContent asks it one level
    // up. A complex value states its elements as text whatever its shape
    // (`IsComplex="1" Dimension="1*2">1.0+2.0i 3.0-4.0i`), and the shaped arm below
    // reads a body with numericBody, whose parseFloat stops at the `+`: every complex
    // ARRAY in a cell came back with its imaginary parts gone — `{[1+2i 3-4i]}` read
    // `{[1 3]}` and re-serialized `Class="double" Dimension="1*2">1.0 3.0`, IsComplex
    // and the imaginary parts both gone from the file. A complex SCALAR was right the
    // whole time, because MATLAB writes one with no Dimension at all and it reached
    // this check by falling past the shaped arm; that is the only reason the defect
    // hid. `_dimensions` rides in the envelope because the cdata form is the only
    // place a complex value's shape can be stated.
    if (isComplexAttr(el['@_IsComplex'])) {
      return complexCdata(text, dimension, elClass);
    }
    if (dimension) {
      const dimParts = parseDims(dimension);
      const total = dimParts.reduce((a, b) => a * b, 1);
      if (total === 0) {
        // Every extent, so an empty N-D cell element agrees with what parseMatrixValue reads
        // back (emptyOf).
        return emptyOf(elClass, dimParts)!;
      }
      const parts = numericBody(text, elClass);
      const rowMajor = transposeColumnMajor(parts, dimParts);
      if (dimParts.length <= 2 && dimParts[0] === 1) {
        return formatTypedVector(rowMajor, elClass);
      }
      return formatMatrix(rowMajor, dimParts, elClass);
    }
    return formatTypedScalar(text, elClass);
  }
  if (elClass === 'logical') {
    if (dimension) {
      const dimParts = parseDims(dimension);
      const total = dimParts.reduce((a, b) => a * b, 1);
      // An empty as every place holds one (emptyOf), which both cell writers spell back as
      // read; a 0x0 too, which was `{_type: 'logical', _value: '[]'}` here alone. `[]` says 0x0
      // and nothing else, so a 1x0 or a 0x3 held that way was saved as `Dimension="0*0"` from a
      // property's cell, and as `Dimension="1*1">0`, a false, from an entry's.
      if (total === 0) {
        return emptyOf('logical', dimParts)!;
      }
      return logicalValue(text, dimParts);
    }
    return text === '1' || text === 'true';
  }
  if (elClass === 'char') {
    return charValue(text, dimension, el['@_Format']);
  }
  if (elClass === 'struct') {
    // A struct ARRAY in a cell states its shape on the element itself
    // (`<Element Class="struct" Dimension="1*2">` over one <Element> per element),
    // exactly as a struct-array PROPERTY states it on the <P> — which is why the
    // field and property sites were right and this one was not. The hardcoded 1x1
    // published a 1x2 as `<1x1 struct>`, and because the envelope's dims are what
    // the writer spells, the save wrote one struct with the elements a level too
    // deep: both of them unreadable on the next open.
    return structValue(el.Element || [], dimension ? parseDims(dimension) : [1, 1], fieldNamesOf(el));
  }
  if (elClass === 'cell') {
    const childElements = el.Element || [];
    return cellValue(childElements, dimension ? parseDims(dimension) : [1, childElements.length]);
  }
  // Nested object
  const childElements = el.Element;
  if (childElements && childElements.length > 0) {
    // A nested MATLAB string, decoded to its text through the same helper the entry
    // path (parseEntryValue) and the property path (parsePropContent) already use —
    // this was the third nesting site and the only one without the branch, so a
    // `string` in a cell decoded as a generic OBJECT of class `string` and displayed
    // as `<1x1 string>` with the text stranded in the saveobj bag. The check has to
    // come before parseElement below for the same reason it does in parsePropContent:
    // the object tail is the fall-through, not a case this shape belongs to.
    if (childElements[0]['@_Class'] === 'string') {
      return parseStringValue(childElements[0], dimension);
    }
    // An object ARRAY, spelled the way MATLAB spells one in a cell: a classless
    // `<Element Dimension="1*2">` over one classed <Element> per object. That is the
    // same shape parsePropContent hands to parseArrayOfElements a level up, so it goes
    // to the same helper rather than to a fourth copy of the decision. Taking [0]
    // alone was silent deletion, not a display bug:
    // `{[Simulink.Parameter(1) Simulink.Parameter(2)]}` showed the FIRST parameter's
    // value as though the cell held a scalar, and the second object was gone from the
    // file after any save.
    if (dimension && childElements.length > 1) {
      return parseArrayOfElements(childElements, dimension, elClass || null);
    }
    if (childElements.length === 1) {
      return parseElement(childElements[0]);
    }
    // Several objects with no declared shape. MATLAB does not write this, but a reader
    // still has to pick a shape the writer can spell, and Nx1 is the one both the entry
    // path and the property path pick for the same undimensioned case — parseElement on
    // [0] would have dropped the rest.
    return objectArrayValue(childElements, [childElements.length, 1]);
  }
  // An EMPTY array of any other class: its class and a Dimension with a 0 in it, and nothing
  // else, which is how MATLAB writes `Simulink.BusElement.empty` at a property (`<P
  // Name="Elements_internal" Class="Simulink.BusElement" Dimension="0*0"/>`). It is held as
  // every empty is (emptyOf), and written back from it as read (DataNode._matrixLiteralXml). It
  // used to fall to the text below: '', a 0x0 char, which every save wrote as `<Element
  // Class="char"></Element>`.
  if (elClass && dimension && text === '') {
    const dimParts = parseDims(dimension);
    const empty = dimParts.reduce((a, b) => a * b, 1) === 0 ? emptyOf(elClass, dimParts) : null;
    if (empty) {
      return empty;
    }
  }
  return text || '';
}

/**
 * An enumeration value, as the object bag a classed value is, keeping what MATLAB wrote of it
 * (XmlUtils.ENUM_KEY): the wrapper's `IsEnum`, and each enumeral's `EnumerationName`,
 * `EnumerationType` and text. Null for a wrapper marked IsEnum that is not spelled the way MATLAB
 * spells one, which the arms after it read as they always did. Asked first at each of the three
 * places a value is read, an entry's Value (parseEntryValue), an object's property or a struct's
 * field (parsePropContent) and a cell's element (parseCellElement), so that the same value reads
 * the same wherever it sits.
 *
 * MATLAB writes `<P Name="Value" IsEnum="1">` around one `<Element Class="GearMode"
 * EnumerationName="Reverse" EnumerationType="int32">-1</Element>`, `<P … IsEnum="1"
 * Dimension="1*3">` around three, and an empty one as `<P … IsEnum="1" Class="dSomeColors"
 * Dimension="0*2"/>`, its class on the wrapper since there is no enumeral to carry it; in a
 * cell the same, less the Name, under `<Element>`. Read without the IsEnum, the value was a
 * GearMode with no properties, `<1x1 GearMode>` on screen and `<Element Class="GearMode">` on
 * every save, untouched or not; and the empty one a numeric empty that lost its IsEnum, or at a
 * property, ''.
 */
function enumValue(el: XmlNode, dimension: string | null): Record<string, unknown> | null {
  const members = el.Element || [];
  const className = members.length > 0 ? members[0]['@_Class'] || '' : el['@_Class'] || '';
  const enumeral = (m: XmlNode): boolean => !m.P && !m.Element && m['@_Class'] === className;
  if (!className || !members.every(enumeral)) {
    return null;
  }
  const dims = dimension ? parseDims(dimension) : members.length === 1 ? [1, 1] : [members.length, 1];
  if (members.length === 0 && (!dimension || dims.reduce((a, b) => a * b, 1) !== 0)) {
    return null;
  }
  return {
    _array_class: className,
    _dimensions: dims,
    _mw_element_type: 'MATLABArray',
    _elements: members.map((m) => {
      // Each attribute only when MATLAB wrote it, in the order it writes them.
      const e: Partial<Enumeral> = {};
      if (m['@_EnumerationName'] !== undefined) {
        e.name = m['@_EnumerationName'];
      }
      if (m['@_EnumerationType'] !== undefined) {
        e.type = m['@_EnumerationType'];
      }
      e.value = getTextContent(m);
      return { _properties: {}, [ENUMERATION_KEY]: e as Enumeral };
    }),
    [ENUM_KEY]: el['@_IsEnum'],
  };
}

function parseStringValue(el: XmlNode, _outerDimension: string | null): unknown {
  const props = el.P || [];
  const cellProp = props.find((p) => p['@_Source'] === 'saveobj');
  if (!cellProp) {
    return [''];
  }

  const cellDim = cellProp['@_Dimension'];
  const cellElements = cellProp.Element;
  if (!cellElements || cellElements.length === 0) {
    // An empty string array: MATLAB writes strings(0,3) as the saveobj cell's shape and no
    // element, `<P Source="saveobj" PropertyType="any" Class="cell" Dimension="0*3"/>`. Read as
    // the scalar "" it showed `""`, where MATLAB's Workspace browser shows `0×3 string`.
    const dimParts = cellDim ? parseDims(cellDim) : null;
    if (dimParts && dimParts.includes(0)) {
      return { _array_type: 'String', _dimensions: dimParts, _elements: [], _mw_element_type: 'MATLABArray' };
    }
    return [''];
  }

  const strings = cellElements.map((e) => getTextContent(e) || '');

  if (cellDim) {
    const dimParts = parseDims(cellDim);
    if (dimParts[0] === 1 && dimParts[1] === 1) {
      return strings;
    }
    return {
      _array_type: 'String',
      _dimensions: dimParts,
      _elements: strings,
      _mw_element_type: 'MATLABArray',
    };
  }
  return strings;
}

// Column-major (MATLAB) to row-major-within-page (what the display layer reads).
// An N-D array is a stack of rows x cols pages, each stored column-major in turn,
// so every page is transposed and the page order is untouched — the same rule
// MatParser.transposeFromColMajor applies to .mat data. Handling only dims[0] and
// dims[1] left every page after the first in column order, so a rank-3 array's
// later pages displayed transposed.
// The loop itself lives in XmlUtils, shared with the complex/cdata reader in
// MatlabVariableNode, which carried its own rank-2-only copy of it. A vector is the
// same list in both orders and a body whose element count disagrees with the
// declared Dimension keeps its extra values rather than coming back full of holes;
// both are properties of the shared helper now.
// Generic over T because a 64-bit body's elements are exact decimal STRINGS, not
// numbers (see numericBody): the reorder is a permutation and never looks at a value.
export function transposeColumnMajor<T>(values: T[], dims: number[]): T[] {
  return transposeFromColumnMajorND(values, dims);
}

function formatTypedScalar(text: string, type: string): unknown {
  if (type === 'double') {
    return parseMatlabNum(text);
  }
  if (type === 'single') {
    return { _type: 'single', _value: formatNumLiteral(parseMatlabNum(text), 'single') };
  }
  if (type === 'uint8' || type === 'uint16' || type === 'uint32') {
    return { _type: type, _value: formatNumLiteral(parseInt(text, 10), type) };
  }
  // uint64 lands here rather than in the unsigned arm above deliberately: parseInt
  // would put maxU64 through a double and write 18446744073709552000U back. The stored
  // text is already MATLAB's own exact decimal, so it is kept verbatim — and a uint64
  // scalar keeps its 'U' from the body it came with rather than from formatNumLiteral.
  return { _type: type, _value: text.trim() };
}

function formatTypedVector(values: (number | string)[], type: string): unknown {
  if (type === 'double') {
    // A bare JSON array cannot carry a non-finite — JSON.stringify writes `null` —
    // so an Inf read correctly above would still be destroyed the moment the entry
    // was saved to an uncompressed-text dictionary. The typed literal is the
    // spelling MATLAB itself uses there: its own text artifact carries nonFinVec as
    // {"_type":"double","_value":"[1.0, Inf, -Inf, NaN, 5.0]"}.
    if (values.some((v) => typeof v === 'number' && !isFinite(v))) {
      return {
        _type: 'double',
        _value: '[' + values.map((v) => formatNumLiteral(v, 'double')).join(', ') + ']',
      };
    }
    return values;
  }
  const formatted = values.map((v) => formatNumLiteral(v, type));
  return { _type: type, _value: '[' + formatted.join(', ') + ']' };
}

/**
 * A `Class="char"` body, with the shape its Dimension declares (defect 25).
 *
 * The text is MATLAB's stored, COLUMN-MAJOR string: `['ab'; 'cd']` reaches us as
 * `Dimension="2*2">acbd`. The Dimension used to be ignored at all three of the sites
 * that call this — entry value, cell element, object/struct property — so every char
 * that was not a row came back as a 1x1 scalar holding the flat text: MATLAB's own 2x2
 * displayed as 'acbd' with its shape gone AND its characters in an order no one had
 * typed, and the next save wrote that 1x4 back. A 2x3x2 lost eleven of its twelve
 * characters' positions the same way.
 *
 * The mxchar envelope is MATLAB's own spelling for the shaped char in a TEXT
 * dictionary, so handing it back here means both dictionary flavours decode to the
 * identical value and one node parser serves both.
 *
 * A char holding a control character, a surrogate or a byte order mark MATLAB writes as its
 * CODES instead, `Format="decimal"` (XmlUtils.WRITTEN_AS_CODES): char(1) is `Dimension="1*1"
 * Format="decimal">1`. Nothing here asked for the attribute, so the body was taken as the
 * text: char(1) read as the char '1', and the 2x3x4 of codes 1:24 as the 60 characters of '1
 * 2 3 … 24', which the shape arm below then could not fill. The codes are the text now, and
 * the writers spell such a char back the same way (XmlUtils.decimalCharXml).
 */
function charValue(text: string, dimension: string | null, format?: string): unknown {
  if (format === 'decimal') {
    text = charFromDecimal(text) ?? text;
  }
  if (!dimension) {
    return text || '';
  }
  const dimParts = parseDims(dimension);
  // An empty char keeps the extents its Dimension states, in the shaped char's own form below
  // with no character in it, `Matrix(0,2)\n[]`: MATLAB writes `Class="char" Dimension="0*2"/>`
  // for a 0x2, and this returned `''` for every empty, the 0x0 MATLAB writes with no Dimension at
  // all (char_binary.sldd's charEmpty), so the 0x2, 2x0 and 0x0x2 were each read and saved as
  // that 0x0. A 0x0 that states one is still `''`, which is what it is, and so is a 1x0, a row.
  if (dimParts.length === 2 && dimParts[0] === 0 && dimParts[1] === 0) {
    return '';
  }
  if (!charNeedsShape(dimParts)) {
    return text || '';
  }
  // An empty one says it was read here, as every classed or shaped empty does (emptyOf).
  const literal = { _type: 'mxchar', _value: formatMxCharSerial(text, dimParts) };
  return dimParts.includes(0) ? { ...literal, [BINARY_EMPTY_KEY]: true } : literal;
}

// The serial string every downstream reader consumes. The body itself is
// XmlUtils.formatMatrixSerial, shared with the node's write-back path: the two used
// to be separate copies that disagreed at rank 2, and only this one's spelling is
// one MATLAB reads back.
function formatMatrix(values: (number | string)[], dims: number[], type: string): unknown {
  type = type || 'double';
  return { _type: type, _value: formatMatrixSerial(values, dims, type) };
}

/**
 * A `Class="logical"` body with a Dimension, shaped as that Dimension declares
 * (defect 44).
 *
 * All three sites that read one — entry value, cell element, object/struct property —
 * used to split the body and join it straight back into a flat `[1, 0, 0, 1]`,
 * ignoring the extents entirely. So the logical class alone missed BOTH halves of
 * what its numeric neighbour two lines below has always done: MATLAB's own 2x2
 * `[true false; false true]` came back a 1x4, and because the body is stored
 * COLUMN-major its four values came back in an order no one had typed. A 3x1 came
 * back a 1x3, and an N-D came back flat — the logical twin of defect 25 (char) and
 * of Phase 6 (numeric N-D), the last class still carrying it.
 *
 * The tokens are kept as the TEXT the body carried rather than converted to numbers:
 * the transpose is a permutation that never looks at a value, formatNumLiteral passes
 * a string through verbatim, and a spelling MATLAB chose is one we can write back.
 */
function logicalValue(text: string, dimParts: number[]): unknown {
  const rowMajor = transposeColumnMajor(text.trim().split(/\s+/), dimParts);
  // Same split as the numeric branch, for the same reason: only a true rank-2 row
  // vector may go out shapeless, because a bare bracketed list reads back as a row.
  if (dimParts.length <= 2 && dimParts[0] === 1) {
    return formatTypedVector(rowMajor, 'logical');
  }
  return formatMatrix(rowMajor, dimParts, 'logical');
}

// `base` is the class the property's place names for an object array there (componentsBaseOf).
function parsePropContent(prop: XmlNode, base?: string): unknown {
  const encoded = encodedOf(prop);
  if (encoded) {
    return encoded;
  }
  const propClass = prop['@_Class'] || null;
  const dimension = prop['@_Dimension'] || null;
  const childElements = prop.Element;

  // An enumeration value, as at an entry and in a cell (see enumValue): before the arms
  // below, which read its enumerals as objects with no properties and an empty one as ''.
  if (prop['@_IsEnum'] !== undefined) {
    const enumerated = enumValue(prop, dimension);
    if (enumerated) {
      return enumerated;
    }
  }

  if (childElements && childElements.length > 0) {
    if (propClass === 'cell') {
      // A nested cell property (with or without a Dimension) serializes its
      // items as <Element> children — decode them like the top-level entry
      // path instead of treating each as a generic object with empty props.
      return cellValue(childElements, dimension ? parseDims(dimension) : [1, childElements.length]);
    } else if (dimension) {
      return parseArrayOfElements(childElements, dimension, propClass, base);
    } else if (propClass === 'struct') {
      return structValue(childElements, [1, 1]);
    } else if (childElements[0]['@_Class'] === 'string') {
      // A nested MATLAB string property serializes as <Element Class="string">
      // wrapping a saveobj cell of chars — decode it to its text like the
      // top-level entry path does, instead of treating it as a generic object
      // (which drops the value into a bogus "undefined" -> char envelope).
      return parseStringValue(childElements[0], dimension);
    } else if (childElements.length === 1) {
      return parseElement(childElements[0]);
    }
    // Several objects with no declared shape. MATLAB never writes this (every
    // multi-element <P> in a real dictionary carries a Dimension), but the reader
    // has to choose SOMETHING, and it must be a shape the save path can write:
    // this used to be a bare JS array of per-element wrappers, which the serializer
    // could only spell `Class="double">[object Object] [object Object]` — every
    // property of every element gone from the file. Nx1 matches the entry-level
    // path's default for the same undimensioned case.
    return objectArrayValue(childElements, [childElements.length, 1], base);
  } else {
    // An EMPTY struct or cell property. MATLAB states the shape on the `<P>` and writes no
    // `<Element>` under it, so none of the arms above have anything to iterate and this used
    // to fall through to `parseTypedValue`, whose zero-total branch answers `''` for every
    // non-numeric class. `''` is a CHAR, so the next save wrote `<P Name="Choices"
    // Class="char"/>` where the file had said `Class="struct" Dimension="0*1"`: opening a
    // dictionary and saving it turned every empty struct property into an empty string.
    //
    // Which properties those are is what made it serious. An empty struct or cell is the
    // DEFAULT of exactly the custom-saving classes — `Simulink.VariantVariable`'s `Choices`,
    // `Simulink.VariantBank`'s `VariantConditions`, all four struct fields of
    // `Simulink.VariantConfigurations` — and those are the classes whose `loadobj`
    // destructures the field it is handed. A char there is the shape that made MATLAB build an
    // empty object (defect 28) and, for `VariantVariable`, the shape that segfaulted it. So a
    // dictionary MATLAB wrote, opened and saved with no edits at all, came back with its
    // variant entries hollowed out.
    const emptyDims = dimension ? parseDims(dimension) : null;
    if (emptyDims && emptyDims.reduce((a, b) => a * b, 1) === 0) {
      if (propClass === 'struct') {
        return structValue([], emptyDims, fieldNamesOf(prop));
      }
      if (propClass === 'cell') {
        return cellValue([], emptyDims);
      }
    }
    const text = getTextContent(prop);
    return parseTypedValue(text, propClass, dimension, prop['@_Format']);
  }
}

function parseElement(el: XmlNode): Record<string, unknown> {
  const className = el['@_Class'] || '';
  // A classless <Element> is a struct element, and only the Struct envelope tells
  // the save path to write `Class="struct"` back — a bare field bag is written as
  // `Class="char">[object Object]`, so every field is gone from the file. (MATLAB
  // itself always tags the enclosing <P> `Class="struct"`, which the callers handle
  // before reaching here; this is the untagged spelling.)
  if (!className) {
    return structValue([el], [1, 1]);
  }

  return {
    _array_class: className,
    _dimensions: [1, 1],
    _mw_element_type: 'MATLABArray',
    _elements: [objectElement(el, className, className)],
  };
}

// The <P> children of one <Element>, as a plain name → value bag. Serves both the
// bare struct element (no Class attribute) and the property bag of a classed
// object element, so an object array's elements and a scalar object's decode
// through exactly the same path — they used to have separate copies, and the
// array copy passed a flag that skipped struct decoding, writing a struct-valued
// property back as `Class="char">[object Object]`.
//
// Every name is written with setOwn, because the names are the file's: assigned into a plain
// `{}`, a <P Name="__proto__"> was the prototype setter's argument, so the field vanished, and
// an object value made the bag inherit its keys.
//
// `ownerClass` is the class of the object `el` is an element of, where it is one.
function parseStructElement(el: XmlNode, ownerClass?: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const prop of el.P || []) {
    // MATLAB's saveobj envelope. A class that serializes through saveobj writes its
    // WHOLE state as one UNNAMED <P Source="saveobj" PropertyType="any" Class="struct">,
    // so `prop['@_Name']` is undefined and `result[prop['@_Name']!]` keyed it under the
    // literal string 'undefined' — which the writer then emitted as
    // `<P Name="undefined" Class="struct">`. MATLAB's loadobj finds no envelope in that
    // and rebuilds an EMPTY object: cases.sldd's aVariant reopened as a
    // Simulink.VariantVariable with 0 choices where MATLAB wrote 2, its whole condition
    // table gone (defect 28, measured by probe_writeback_bin — the property-based
    // signature could not see it, because both of VariantVariable's public properties
    // throw MATLAB:class:ObjectMustBeScalar on get).
    //
    // The payload is kept whole under a reserved key rather than lifted into the bag:
    // the envelope's fields are the object's own state in MATLAB's saveobj spelling,
    // which is not the spelling the same class uses in a TEXT dictionary (there a
    // VariantVariable is a flat Bank/Choices/Specification bag whose Choices is a
    // simulink.variant.Variable, not a 2x1 Condition/Value struct). Preserving it
    // verbatim is what makes MATLAB read back what MATLAB wrote; translating between the
    // two spellings is a question no artifact in the corpus answers.
    if (prop['@_Source'] === 'saveobj') {
      result[SAVEOBJ_KEY] = parsePropContent(prop);
      continue;
    }
    // A complex scalar carries its value as text with IsComplex="1" rather than
    // as child elements, so it never reaches the generic content decoder. An encoded
    // value is asked about first, here as at every site: its body is a byte stream
    // whatever else the element says about it.
    const encoded = encodedOf(prop);
    if (encoded) {
      setOwn(result, prop['@_Name']!, encoded);
    } else if (!prop.Element?.length && isComplexAttr(prop['@_IsComplex'])) {
      setOwn(result, prop['@_Name']!, complexCdata(getTextContent(prop), prop['@_Dimension'] || null, prop['@_Class']));
    } else {
      setOwn(result, prop['@_Name']!, parsePropContent(prop, componentsBaseOf(ownerClass, prop['@_Name'])));
    }
  }
  return result;
}

function parseArrayOfElements(
  elements: XmlNode[],
  dimension: string,
  propClass: string | null,
  base?: string,
): Record<string, unknown> {
  const dimParts = parseDims(dimension);
  return propClass === 'struct' ? structValue(elements, dimParts) : objectArrayValue(elements, dimParts, base);
}

function parseTypedValue(text: string, className: string | null, dimension: string | null, format?: string): unknown {
  if (!className) {
    return text;
  }

  if (dimension) {
    const dimParts = parseDims(dimension);
    const total = dimParts.reduce((a, b) => a * b, 1);
    // An empty, as every place holds one (emptyOf): a double 0x0, the commonest property
    // there is (an unset Min or Max), `[]` as it always was. A numeric empty of any other class
    // or size used to be that `[]`, its class and extents gone, and any other class `''`, a
    // char: 22,225 empty Elements_internal arrays of Simulink.BusElement and
    // Simulink.ConnectionElement in the local corpus were saved by an untouched save as
    // `Class="char"`. A char goes to charValue, as at the two other places; one emptyOf cannot
    // hold, of a reserved class name or with an extent that is no count, is held as before.
    if (total === 0) {
      if (className === 'char') {
        return charValue(text, dimension, format);
      }
      const empty = headerCounts(dimParts) ? emptyOf(className, dimParts) : null;
      return empty ?? (isNumericClass(className) ? [] : '');
    }

    if (className === 'logical') {
      return logicalValue(text, dimParts);
    }

    if (isNumericClass(className)) {
      const parts = numericBody(text, className);
      const rowMajor = transposeColumnMajor(parts, dimParts);
      if (dimParts.length <= 2 && dimParts[0] === 1) {
        return formatTypedVector(rowMajor, className);
      }
      return formatMatrix(rowMajor, dimParts, className);
    }
  }

  switch (className) {
    case 'double':
      // Its own arm because its answer differs: a double's stored spelling IS a double's,
      // so it needs no per-class narrowing. Every OTHER numeric class falls to the default
      // and is recognized there, by the same predicate the shaped arm above used.
      return parseMatlabNum(text);
    case 'logical':
      return text === '1' || text === 'true';
    case 'char':
      // The property twin of the entry-value and cell-element arms: a `Class="char"
      // Dimension="2*2"` PROPERTY (a struct field, an object property) states its
      // shape too, and the numeric branch above never claimed it.
      return charValue(text, dimension, format);
    default:
      // Asked as a CLASS, not enumerated. This used to be nine more `case` labels, a
      // second copy of isNumericClass's list — and the bug that copy invites is exactly
      // defect 27: int64/uint64 were missing from BOTH lists, the value fell through to
      // the bare-text return below, and the writer, seeing a bare string, spelled it
      // `Class="char"`. One list, asked in every place the question comes up, is the only
      // arrangement in which that cannot happen a second time.
      if (isNumericClass(className)) {
        return formatTypedScalar(text, className);
      }
      return text || '';
  }
}

// The integer family is matched as a FAMILY rather than listed member by member, because
// the listing is what failed: int64 and uint64 were missing from this list AND from
// parseCellElement's copy of it, which is what made a 64-bit struct FIELD come back as
// text — parseTypedValue fell through the numeric branch to `default: return text`, so
// sTyped's uint64 [7 8] decoded as the string '7 8' and the writer, seeing a bare string,
// wrote `<P Name="d" Class="char">7 8</P>`, which MATLAB reopened as a 1x3 char (defect
// 27). The entry-level path never had the gap, so the same value was right at the top
// level and wrong one level down. A pattern cannot omit a width.
//
// Deliberately NOT a catch-all "unknown class, probably numeric", and `half` is
// deliberately not in it. The arms this gates parse the body as numbers and the save path
// then formats from the `_type`, so admitting a class those two do not both understand
// turns a wrong TYPE into wrong DIGITS. Measured: `Class="half">1.5` admitted this way
// writes back `2`, and a class whose body is not numeric at all writes back `0`. Losing
// the class and keeping the characters — what the `default` arm does — is the less
// destructive of the two failures, so an unrecognized class stays there on purpose. Adding
// `half` needs the float handling on the save side too, not just a name here.
const NUMERIC_CLASS = /^(?:double|single|u?int(?:8|16|32|64))$/;

function isNumericClass(className: string): boolean {
  return NUMERIC_CLASS.test(className);
}

// `IsComplex="1"` is the only spelling MATLAB has been measured writing, and the only one
// we write. `"true"` is accepted as well — the same latitude parseTypedValue's `logical`
// arm already takes (`text === '1' || text === 'true'`), and taken here for the reason
// that arm is not controversial: the cost of not recognizing the attribute is asymmetric.
// It does not merely degrade the display; the imaginary parts leave the value AND the next
// save, because a re-serialized element that was not read as complex is not written as
// complex either. That was defect 53's whole shape. Reading one extra spelling costs
// nothing today and turns a possible format change from silent data loss into a no-op.
//
// Three call sites — an entry value, a cell element and a property — which is why this is
// a function and not three comparisons: "one rule, three paths, two of them right" is how
// 52 and 53 both happened.
function isComplexAttr(attr: string | undefined): boolean {
  return attr === '1' || attr === 'true';
}

// The value an `IsComplex` element or property reads as, at all three of those sites: its
// body as MATLAB wrote it, its shape when it states one, and its class when that is not
// double (complexClassTag). The class rides in the envelope because nothing else of the
// `<P>` does: without it `Class="int16" IsComplex="1" Dimension="1*60"` read as a 1x60
// double, and went back into the file as `Class="double"`.
function complexCdata(text: string, dimension: string | null, className: string | null | undefined): Record<string, unknown> {
  const cdata: Record<string, unknown> = { _type: 'cdata', _value: text };
  if (dimension) {
    cdata._dimensions = parseDims(dimension);
  }
  const cls = complexClassTag(className);
  if (cls) {
    cdata._class = cls;
  }
  return cdata;
}

// One numeric body, as the CLASS requires: exact decimal text for the tokens a 64-bit
// integer cannot round-trip through a double, plain numbers for everything else. The
// three call sites below (entry value, cell element, property) each used to call
// parseNumericBody directly, so a 64-bit value was rounded before any writer saw it.
function numericBody(text: string, type: string | null): (number | string)[] {
  return needsExactInt(type) ? parseExactBody(text) : parseNumericBody(text);
}

/**
 * The envelope for a value MATLAB wrote as an encoded byte stream, or null for one it
 * wrote as XML. Asked FIRST at every site a value is read — an entry's Value, an object
 * property or struct field, a cell element — because what such an element's text holds
 * is bytes, whatever its Class says.
 *
 * There was no such question anywhere in this reader. MATLAB writes
 * `<P Name="Value" Class="double" Encoding="hex" EncodedLength="248">0001494D…</P>` for a
 * value XML cannot spell (a sparse array, a function handle), and that text went to the
 * numeric tail of whichever site it reached: parseFloat stops at the first letter, so
 * `0001494D…` read as 1494 — every hex value in the corpus showed 1494, as an editable
 * double, and a save that touched nothing wrote `Class="double">1494.0` where the stream
 * had been. An object-classed one kept its text in a typed envelope, and the node layer
 * then put the same text through the same parseFloat. Nothing about the bytes is decided
 * here — see EncodedValue for the envelope, and MatlabVariableNode.parseEncoded for the
 * decode — so this reader cannot lose them however the value turns out to read.
 */
function encodedOf(node: XmlNode): EncodedValue | null {
  // The attribute first: this runs at every value site of every dictionary, and almost
  // none of them is encoded.
  if (node['@_Encoding'] === undefined) {
    return null;
  }
  encodedInEntry = true;
  return encodedValueOf(node as Record<string, unknown>, getTextContent(node));
}

// Set by encodedOf while an entry is being read, so parseBinarySlddParts knows which
// entries to walk for an unreadable stream without a scan of the whole document. The
// reader is synchronous and resets it before each entry.
let encodedInEntry = false;

/**
 * An element's text, exactly as the file holds it — the one thing every value site reads.
 *
 * It used to be `String(node['#text'])`, because the XML reader handed over a NUMBER for any
 * text that looked like one, before anything here had read the element's Class. The String()
 * gave that number back in JavaScript's spelling, so a char was respelled ('0.0' read as '0',
 * '1e-3' as '0.001') and a double's -0.0 read as +0. The reader keeps the text now, and each
 * site converts it by Class: a char keeps it, and a numeric class parses it (parseMatlabNum,
 * numericBody, parseInt), which keeps the sign of a double's zero. What the old conversion
 * changed besides those two was measured to change no value: over the 52 distinct binary
 * dictionaries among the local corpus's (up to 100 MB) and every one under `test/fixtures` and
 * `test/parity/artifacts`, it altered 462,302 double and 551 single bodies' text, and every one
 * but the six -0s parses to the same number from either spelling; it altered no integer,
 * logical, complex or encoded body at all.
 */
function getTextContent(node: XmlNode): string {
  return node['#text'] ?? '';
}

function getProperty(obj: XmlNode, name: string): string | null {
  const props = obj.P || [];
  for (const p of props) {
    if (p['@_Name'] === name) {
      return getTextContent(p);
    }
  }
  return null;
}

function getPropertyNode(obj: XmlNode, name: string): XmlNode | null {
  const props = obj.P || [];
  for (const p of props) {
    if (p['@_Name'] === name) {
      return p;
    }
  }
  return null;
}

function formatDate(matlabDate: string): string {
  if (!matlabDate || matlabDate.length < 15) {
    return matlabDate;
  }
  const year = matlabDate.substring(0, 4);
  const month = matlabDate.substring(4, 6);
  const day = matlabDate.substring(6, 8);
  const hour = matlabDate.substring(9, 11);
  const min = matlabDate.substring(11, 13);
  const sec = matlabDate.substring(13, 15);
  return year + '-' + month + '-' + day + 'T' + hour + ':' + min + ':' + sec + 'Z';
}
