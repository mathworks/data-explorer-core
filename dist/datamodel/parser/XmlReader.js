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
//   - TEXT is coerced, and more widely than "numbers": `007` and `1.0` read as 7 and 1,
//     `0x1F` reads as 31, and `true`/`false` — lowercase only — read as BOOLEANS. The
//     spelling is gone once it has, so anything that must round-trip a literal exactly
//     reads it from the bytes. An integer too large for a double is the one case the
//     coercion declines: it stays a string rather than lose precision.
//   - Attribute values are coerced not at all — `Dim="7"` stays the string '7' and
//     `Flag="true"` stays the string 'true'. One rule for text, another for attributes.
//   - Named entities are decoded (`&amp;` -> `&`). NUMERIC character references are NOT:
//     `&#65;` arrives as the five characters `&#65;`. This is why `SlddScan` carries its
//     own entity table rather than deciding what to decode for itself.
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
// Only two options differ, and each is isolated in the test:
//
//   `isArray` (dictionary only) forces `Object`, `P` and `Element` to arrays even when
//   singular. Without it a one-entry dictionary hands back an object where a
//   many-entry one hands back an array, and every walk over it needs its own
//   `Array.isArray(x) ? x : [x]`. The model and project walkers do carry exactly that
//   coercion, in about a dozen places each; the dictionary walker does not have to.
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
//   It has a second effect that is not in its name, and it is the more useful half: with
//   trimming off the engine returns any value that DIFFERS FROM ITS OWN TRIM raw and
//   unparsed, so padding protects a dictionary value from every coercion above. `' 7 '`
//   stays three characters where the model reader would make it the number 7. Interior
//   whitespace is untouched either way — trimming is not normalization.
import { XMLParser } from 'fast-xml-parser';
const ATTRIBUTE_PREFIX = '@_';
const TEXT_KEY = '#text';
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
const dictionaryParser = new XMLParser({
    ...SHAPE,
    isArray: (name) => name === 'Object' || name === 'P' || name === 'Element',
    trimValues: false,
    tagValueProcessor: dropLayoutWhitespace,
});
// The model and project readers ask for the same thing, so they share one parser rather
// than build two identical ones. They were not written to be the same — the project
// options never named `textNodeName`, and `#text` is the engine's default, so the two
// sets only LOOKED different. They are kept as two exported readers because their
// callers are two documents with two different failure stories to tell, and the day one
// of them needs an option the other must not have, this is the line that splits.
const defaultParser = new XMLParser(SHAPE);
/**
 * A `.sldd`'s XML part. `Object`, `P` and `Element` are always arrays; whitespace inside a
 * value is preserved exactly as written, and whitespace between two tags is not stored at
 * all (`dropLayoutWhitespace`).
 *
 * Returns `unknown` on purpose: the empty object is a valid, common answer that means
 * "nothing readable here", so a caller has to narrow before it can trust a key. Every
 * caller already does.
 */
export function readDictionaryXml(text) {
    return dictionaryParser.parse(text);
}
/**
 * One part of a `.slx` or `.mdl` package. Engine defaults: text is trimmed, and a lone
 * child stays an object, so a walker over one of these has to coerce to an array itself.
 */
export function readModelXml(text) {
    return defaultParser.parse(text);
}
/** One `<Info>` sidecar of a `.prj` store. Same options as a model part. */
export function readProjectXml(text) {
    return defaultParser.parse(text);
}
//# sourceMappingURL=XmlReader.js.map