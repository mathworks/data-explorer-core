// Copyright 2026 The MathWorks, Inc.
//
// The one place this package talks to an XML engine.
//
// Three readers parsed XML with three different option sets spread across three files
// (`BinarySlddParser`, `SlxParser`, `ProjectParser`), and the engine's behaviour — what it
// coerces, what it decodes, what it refuses — was recorded in comments in a fourth, fifth
// and sixth place, in the tests that happened to trip over each fact. Nothing said why one
// reader turned trimming off and the others did not.
//
// So this file owns the import, the option sets, and the contract. `test/xmlReader.test.ts`
// pins every claim below against the engine, which makes an engine swap a change to one
// module with one test file that goes red — rather than a search for behaviour that three
// walkers silently assume.
//
// ---------------------------------------------------------------------------------------
// THE CONTRACT — measured, not assumed (`.scratch/probe-xmlopts.mjs`)
//
// Shape, all three readers:
//
//   - An attribute is a key prefixed `@_`; an element's text is the key `#text`.
//   - TEXT is text, in every reader: `007`, `1.0`, `0x1F`, `true` and `false` arrive as the
//     characters the file holds, and a value is converted by the code that knows what it is
//     (`parseTagValue: false`; see "WHAT THE THREE READERS SHARE").
//   - Attribute values are coerced not at all either — `Dim="7"` stays the string '7' and
//     `Flag="true"` stays the string 'true'.
//   - Named entities are decoded (`&amp;` -> `&`), and so are NUMERIC character references:
//     `&#65;` arrives as `A` and `&#xD;` as a carriage return, in text and in attribute values
//     alike. HTML's named entities are not (`&nbsp;` stays as written). `SlddScan` carries no
//     entity table and refuses a name with any entity in it, rather than decide what to
//     decode for itself.
//   - CDATA arrives as ordinary text with its markup characters intact.
//   - `<P/>` reads as the empty STRING when it carries no attributes, and as an object
//     with no `#text` key when it does. Both, not one.
//   - The XML declaration is a `?xml` KEY at the root, beside the document element. So a
//     part holding only a declaration is not the empty object, and anything deciding
//     "nothing readable here" by counting root keys counts this one too.
//
// Refusal, all three readers — and this is the part that matters most to a caller:
//
//   - Input carrying no markup at all (plain text, an empty part, binary) reads as the
//     EMPTY OBJECT. It does not throw. That is the shape a truncated or mis-encoded write
//     takes, so every caller checks for it and reports it as a loss; see the notes at
//     `BinarySlddParser`'s DataSource check, `SlxParser.readPart` and
//     `ProjectParser.parseInfo`.
//   - The engine is otherwise LENIENT about damage. An unclosed tag drops its text and
//     reads as an element with only its attributes; a mismatched close tag is accepted;
//     a document whose root is not the expected element parses cleanly under its own
//     name. None of these throw, so a caller cannot use "it parsed" to mean "it is the
//     document I asked for" — it has to test for the key it needs.
//   - It DOES throw on a few malformations, of which an unclosed CDATA is one.
//
// ---------------------------------------------------------------------------------------
// WHAT THE THREE READERS DO NOT SHARE
//
// Two options differ, and each is isolated in the test:
//
//   `isArray` (dictionary only) forces `Object`, `P`, `Element` and `Field` to arrays even
//   when singular. Without it a one-entry dictionary hands back an object where a
//   many-entry one hands back an array, and every walk over it needs its own
//   `Array.isArray(x) ? x : [x]`. The model and project walkers do carry exactly that
//   coercion, in about a dozen places each; the dictionary walker does not have to.
//   `Field` is the fourth for the same reason, not a fourth kind of thing: it is how MATLAB
//   names the fields of an EMPTY struct property, and a one-field struct would otherwise
//   read differently from a two-field one.
//
//   `trimValues: false` (dictionary only) keeps leading and trailing whitespace in text
//   AND in attribute values. A dictionary's text is MATLAB's, where `'  abc  '` is a
//   different char array from `'abc'` and the in-place editor is seeded with whatever
//   the file said, so trimming here would edit the user's data on the way in. A model
//   part's text is markup-formatted and its whitespace is layout, which is why the other
//   two readers keep the engine's default.
//
//   It HAD a third effect, and this reader cancels it. Left alone, a pretty-printed
//   parent gets a `#text` holding the newline and indent between its children,
//   concatenated across the gaps: 204,373 of them in the 71.3 MB corpus dictionary,
//   443,019 across the corpus. Nothing reads them, and they cost 80.7 MB of the 232.1 MB
//   that parse retains — so `dropLayoutWhitespace` below refuses them, and the flag is
//   left with only the two effects that are about fidelity. Leaf whitespace, padded
//   values and interior whitespace are untouched.
//
//   It has a second effect that is not in its name: with trimming off the engine returns any
//   value that DIFFERS FROM ITS OWN TRIM raw and unparsed, so `' 7 '` stays three characters
//   where the model reader trims it to the text '7'. Interior whitespace is untouched either
//   way — trimming is not normalization.
//
// ---------------------------------------------------------------------------------------
// WHAT THE THREE READERS SHARE, AND ONCE DID NOT
//
// Two options were the dictionary reader's alone and are now every reader's. The dictionary
// reader took them first (#92); the model and project readers kept the engine's defaults
// until a census showed what those cost a model (below).
//
//   `parseTagValue: false` turns the text coercion off. The engine's coercion was wider than
//   "numbers": `007` and `1.0` read as 7 and 1, `0x1F` as 31, and `true`/`false` — lowercase
//   only — as BOOLEANS, and the spelling was gone once it had. The dictionary reader's caller,
//   `BinarySlddParser`, converts every value itself by the Class the element declares —
//   `parseMatlabNum`, `parseNumericBody`, `parseExactBody`, `parseInt` — so the engine's
//   conversion did nothing for it but run before the Class was known. That was a loss, not a
//   redundancy: a char whose text looked like a number came back in JavaScript's spelling of
//   it (`'0.0'` as '0', `'1e-3'` as '0.001', `'2.384185791015625e-07'` with its exponent's zero
//   gone), and `String(-0)` handed a double's -0.0 back as '0'. Measured over the 52 distinct
//   binary dictionaries among the local corpus's (up to 100 MB) and every one under
//   `test/fixtures` and `test/parity/artifacts`: 166 char bodies respelled, and 6 scalar
//   double -0 values read as +0. A char matrix or an encoded stream whose text looked like a
//   number lost its characters the same way, though none of the 52 holds one.
//
//   A model part's text is a parameter EXPRESSION, which MATLAB evaluates and this package
//   only shows, so nothing in a model wants it converted at all. Measured over the 152 `.slx`
//   and 9 project stores of the local corpus and `test/`: a block parameter whose text is
//   `false` read as the boolean false, which `SlxParser`'s `|| ''` then read as no value, so
//   80 blocks in 16 models were missing from Model Elements (a Constant, an Outport or a
//   UnitDelay whose value is `false`; the same block in a `.mdl` was listed). Its twin `true`
//   was listed, as a boolean in a field typed string. And `ParsedSlx.configSets[].data`
//   respelled 1,721 values (`2000.0` as 2000, `1e-6` as 0.000001). Projects read no element
//   text, and nothing else any row shows differed.
//
//   `htmlEntities` is given XML's five named entities as an OBJECT, which is how this engine
//   is told to decode numeric character references without HTML's named entities: its
//   decoder takes an object there as the named table to use instead of HTML's, and allows
//   numeric references exactly when the option is set. XML requires a reader to
//   replace a reference with its character, and a dictionary needs it — MATLAB writes `&#xD;`
//   for every CR inside a char, and a reader that left the five characters standing showed
//   them and saved them back as `&amp;#xD;`. A model part and a project document are XML too,
//   and get the same; a block name's `&#xA;` now arrives as the line break it is, which
//   `normalizeBlockName` flattens exactly as it flattened the five characters. A codepoint XML
//   prohibits is still deleted, as it was. The typings call the option a boolean, so it is
//   cast; the contract test pins the behaviour, and is the file that goes red if an engine
//   release stops honouring the object.
import { XMLParser } from 'fast-xml-parser';
import { readDictionaryXmlFast } from './DictionaryXmlFast.js';
/**
 * The two keys that are not an element name, exported because one walker has to tell
 * them apart from one.
 *
 * Every other reader here knows the key it wants (`@_Name`, `#text`) and spells it,
 * which needs no constant. `ProjectParser`'s monolithic layout is the exception: an
 * element's CHILDREN are named by their entity type, so it enumerates the keys it
 * does not know and has to recognize these two by shape. That is the engine's shape
 * and so it belongs here, next to the options that produce it, rather than as a
 * second `'@_'` in a file that would not otherwise care.
 */
export const ATTRIBUTE_PREFIX = '@_';
export const TEXT_KEY = '#text';
/** The shape every reader produces: attributes under `@_`, text under `#text`. */
const SHAPE = {
    ignoreAttributes: false,
    attributeNamePrefix: ATTRIBUTE_PREFIX,
    textNodeName: TEXT_KEY,
};
/**
 * Whitespace between two child elements is layout, not data — so it is not stored.
 *
 * `trimValues: false` is asked for so a MATLAB char array keeps its padding, and it does
 * give that; it also turns the newline-and-indent of a pretty-printed file into text like
 * any other, one string and one property per non-leaf element. On the 71.3 MB corpus
 * dictionary that is 204,373 keys and 80.7 MB of the 232.1 MB the parse retains — a third
 * of the tree, for a key no walker reads: `BinarySlddParser.getTextContent` reads `#text`
 * off whatever node it is handed, and every branch that calls it is reached only after the
 * child-element check found none.
 *
 * The engine passes `isLeafNode: false` exactly when the text it has just collected has an
 * element sibling — `OrderedObjParser` hands `false` outright in the opening-tag branch,
 * and otherwise asks whether the parent has children yet. So "not a leaf, and nothing but
 * whitespace" is precisely "the gap between two tags". Returning the empty string for it
 * removes the KEY rather than emptying it, because `saveTextToParentTag` adds `#text` only
 * when the processed value is truthy. A leaf is answered before `trim` is ever called, so
 * no value pays for this.
 *
 * What it does not do, said here because the difference stays invisible until it bites:
 * the hook is called once per text CHUNK, not once per element. For MIXED content — real
 * text AND child elements inside one element — a whitespace-only chunk beside the markup
 * is dropped from a value that would otherwise have concatenated it, so
 * `<P>\n  abc\n  <E/>\n</P>` reads as '\n  abc\n  ' where it used to read as
 * '\n  abc\n  \n'. No dictionary in the corpus holds that shape: 22 XML parts, 155 MB,
 * 2.09 M elements, zero with both text and children (`.scratch/probe-mixed-corpus.mjs`),
 * because the writer serializes a property tree in which an element carries either a value
 * or children. That is a corpus fact and not a guarantee, which is why the contract test
 * pins the mixed-content case as behaviour rather than leaving it to be discovered.
 */
function dropLayoutWhitespace(_tagName, value, _jPath, _hasAttributes, isLeafNode) {
    return !isLeafNode && value.trim() === '' ? '' : value;
}
/** XML's own named entities — and only those: HTML's table is not XML's (see the header). */
const XML_NAMED_ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
};
const dictionaryParser = new XMLParser({
    ...SHAPE,
    isArray: (name) => name === 'Object' || name === 'P' || name === 'Element' || name === 'Field',
    trimValues: false,
    parseTagValue: false,
    // Typed `boolean` and marked deprecated in favour of a custom `entityDecoder`, which would
    // mean owning DOCTYPE entity expansion and its limits too. The object form keeps the engine's
    // own decoder and changes only what the header says.
    htmlEntities: XML_NAMED_ENTITIES,
    tagValueProcessor: dropLayoutWhitespace,
});
// The model and project readers ask for the same thing, so they share one parser rather
// than build two identical ones. They were not written to be the same — the project
// options never named `textNodeName`, and `#text` is the engine's default, so the two
// sets only LOOKED different. They are kept as two exported readers because their
// callers are two documents with two different failure stories to tell, and the day one
// of them needs an option the other must not have, this is the line that splits.
//
// Text is kept as text and character references are decoded, as the dictionary reader does
// (see "WHAT THE THREE READERS SHARE"); trimming and singular children are the engine's.
const defaultParser = new XMLParser({
    ...SHAPE,
    parseTagValue: false,
    htmlEntities: XML_NAMED_ENTITIES,
});
/**
 * A `.sldd`'s XML part. `Object`, `P` and `Element` are always arrays; text is the text the
 * file holds, entity-decoded and never converted; whitespace inside a value is preserved
 * exactly as written, and whitespace between two tags is not stored at all
 * (`dropLayoutWhitespace`).
 *
 * Returns `unknown` on purpose: the empty object is a valid, common answer that means
 * "nothing readable here", so a caller has to narrow before it can trust a key. Every
 * caller already does.
 *
 * `entries`, when given, is where the fast reader records each entry's span as it reads
 * (`readDictionaryXmlFast`). Its `read` is set only when the fast reader read the document at
 * the input's own offsets; the general engine records nothing.
 */
export function readDictionaryXml(text, entries) {
    // Two engines, ONE contract. `DictionaryXmlFast` reads the subset of XML a dictionary is
    // actually written in — five element names, quoted attributes, XML's five entities and
    // numeric character references — and returns `null` for anything else, which is every
    // question about damage, DOCTYPE, CDATA or a codepoint XML prohibits. Those go to the
    // general engine, which is what the contract above was measured against and still is: the
    // fast reader is held to the engine's output byte for byte, key order included, over the
    // whole corpus (`.scratch/probe-differential.mjs`) and case by case in
    // `test/dictionaryXmlFast.test.ts`.
    //
    // So this line is a speed change and not a behaviour change. It is written as a fallback
    // rather than a feature flag because the fallback IS the specification — there is no
    // configuration in which the fast reader is the only reader, and a dictionary it declines
    // is read exactly as it was before.
    return readDictionaryXmlFast(text, entries) ?? readDictionaryXmlGeneric(text);
}
/**
 * The same document through the general engine, with no fast path consulted.
 *
 * NOT for callers — `readDictionaryXml` is the reader, and reaching past it would give up the
 * speed for nothing. This exists because the fast reader's entire contract is "identical to the
 * general engine or `null`", and a test of that cannot go through `readDictionaryXml`: that
 * would compare the fast reader against itself. The alternative was for the test to build its
 * own `XMLParser` with a copy of the options above, which passes just as happily when the copy
 * has gone stale — the one failure that would let the two readers diverge in production while
 * the test stays green.
 */
export function readDictionaryXmlGeneric(text) {
    return dictionaryParser.parse(text);
}
/**
 * One part of a `.slx` or `.mdl` package. Text is the text the part holds, entity-decoded
 * and never converted, so `false` and `10.0` arrive as those characters. Otherwise the
 * engine's defaults: text is trimmed, and a lone child stays an object, so a walker over
 * one of these has to coerce to an array itself.
 */
export function readModelXml(text) {
    return defaultParser.parse(text);
}
/** One `<Info>` sidecar of a `.prj` store. Same options as a model part. */
export function readProjectXml(text) {
    return defaultParser.parse(text);
}
//# sourceMappingURL=XmlReader.js.map