// src/datamodel/parser/DictionaryXmlFast.ts
// Copyright 2026 The MathWorks, Inc.
//
// A reader for ONE XML vocabulary: the `data/chunk0.xml` part of a binary `.sldd`.
//
// WHY THIS EXISTS
//
// A zipped dictionary is small on disk and enormous once inflated — the corpus's
// `sldd-zip-entries` is 2.75 MB of zip and 74.7 MB of XML — and reading that XML was
// 94% of the whole ingest:
//
//   unzip (native zlib under the Inflate seam)      ~140 ms
//   utf8 decode 74.7 MB -> JS string                  26 ms
//   readDictionaryXml (fast-xml-parser)             3358 ms   <- 94%
//   everything else, data model included              ~80 ms
//
// 22 MB/s, where a bare `charCodeAt` pass over the same string is 149 ms (478 MB/s). The cost
// was the general-purpose engine, not the XML: it must cope with namespaces, DOCTYPE, CDATA,
// stop nodes, path matching and entity-expansion limits, and it pays for all of that on every
// one of the 6.9 M elements a dictionary holds.
//
// This file pays for none of it, because a dictionary's XML is a closed vocabulary. Over all
// 32 zipped dictionaries available (469.4 MB of XML, `.scratch/probe-schema.mjs`):
//
//   elements   <P> 6,022,235   <Element> 624,550   <Object> 241,644   <Field> 22,237
//              <DataSource> 32              — and NOTHING else
//   attributes Class, Name, Dimension, Source, PropertyType, EnumerationName,
//              EnumerationType, IsEnum, IsComplex, Encoding, EncodedLength,
//              FormatVersion, MinRelease, Arch
//
// and `.scratch/probe-unusual.mjs` finds, across those same 32 parts: no DOCTYPE, no CDATA,
// no comments, no processing instruction other than the leading declaration, no namespaced
// tag, and no named entity outside XML's own five. That is what makes a special-purpose reader
// honest rather than a gamble.
//
// One line of that census has already proved blind, and it is the reason to distrust the rest.
// It also said "no numeric character reference" — true of those 32 files, false of dictionaries:
// MATLAB writes `&#xD;` for a CR inside a char property, and the corpus simply held no
// multi-line value. A MATLAB-written fixture found it in minutes
// (`test/fixtures/custom_object_binary.sldd`). A census measures the files you have; what makes
// this reader safe is not the census but the bail, and the fix was to read `&#xD;` rather than
// decline a 74.7 MB file over one carriage return.
//
// The attribute line is blind in the same way and it does not matter, which is the useful half of
// the comparison. That same fixture carries a fifteenth name, `Format="decimal"`, found in none of
// the 32 — and nothing happened: an attribute outside the interned table pays a string
// concatenation and is copied faithfully (see `ATTR_KEYS`). So the ELEMENT vocabulary is what this
// reader bets on being closed. The attribute vocabulary is open, by construction.
//
// WHY IT CAN BAIL, AND WHY THAT IS THE WHOLE SAFETY ARGUMENT
//
// `readDictionaryXmlFast` returns `null` the moment it sees anything it was not built for, and
// `XmlReader.readDictionaryXml` then hands the same text to fast-xml-parser. So this file does
// not have to be a correct XML parser — it has to be a correct reader of the subset it
// recognises, and *provably silent* on everything else. Every lenient and defensive behaviour
// the contract in `XmlReader.ts` pins — an unclosed tag that keeps its attributes, a
// mismatched close tag that is accepted, a non-`DataSource` root, input with no markup reading
// as the empty object, the entity-expansion limits — is inherited by falling back, not
// reimplemented here. A bail is never wrong, only slower.
//
// This is also why the bail conditions are deliberately coarse. A single `<!` anywhere gives
// up on the file; so does one unrecognised named entity. Being clever about those would mean
// owning the parts of XML this file exists to avoid.
//
// Coarse is not the same as free, though, and that cuts the other way too: because a bail costs
// the WHOLE file, a construct that is both cheap to support and something MATLAB actually writes
// does not belong on the bail list at all. That is the whole argument for the numeric-reference
// branch below, and the test for whether the next such construct belongs there too.
//
// SHAPE EQUALITY IS THE LOAD-BEARING CLAIM
//
// The output must be INDISTINGUISHABLE from `dictionaryParser.parse(text)`, down to key
// insertion order, because `BinarySlddParser` walks it and 900 lines of value semantics hang
// off exactly what it finds. The rules below are taken from fast-xml-parser's own
// `node2json.compress`, `parseTextData` and `parseValue` rather than inferred from samples:
//
//   * An element becomes an object whose keys are, IN THIS ORDER: its child element names in
//     document order, then `#text`, then its `@_`-prefixed attributes in document order.
//     (`compress` fills children, appends text at the end, and the parent's
//     `assignAttributes` adds attributes afterwards.)
//   * `Object`, `P`, `Element` and `Field` are ALWAYS arrays, singular or not (`isArray`).
//   * An element with NO attributes whose only key is `#text` collapses to that value; with no
//     attributes and no keys at all it collapses to the empty string. An element WITH
//     attributes never collapses — which is why `<P Name="x"/>` is an object with no `#text`
//     while `<P/>` is `''`.
//   * Text is entity-decoded, then offered to `dropLayoutWhitespace`, and only then coerced —
//     and coerced ONLY IF IT EQUALS ITS OWN TRIM, because `trimValues: false` makes
//     fast-xml-parser hand back any padded value raw. `' 7 '` stays three characters; `7`
//     becomes the number. That asymmetry is load-bearing: it is how a MATLAB char array keeps
//     its padding.
//   * Coercion itself is NOT reimplemented. `strnum` does it, with the same options
//     fast-xml-parser passes, so `007`, `0x1F`, `1.0` and an integer too large for a double
//     all land where they landed before by construction rather than by my having read its
//     source carefully enough. See `strnum.d.ts` for why that dependency is declared.
//   * Attribute values are never coerced and never trimmed (`parseAttributeValue: false`).
//
// `.scratch/probe-differential.mjs` compares the two readers' output over every binary
// dictionary available — 32 files, 469.4 MB, 18,505,864 keys, identical including key order.
// That corpus run is the claim that actually matters, and it is blind in one direction: it
// proves what the writer DOES emit and says nothing about the branches it never reaches. So
// `test/dictionaryXmlFast.test.ts` pins each rule above against the engine case by case, and
// `test/dictionaryXmlFastDifferential.test.ts` asserts the contract — identical or `null` —
// over every binary fixture in the repo plus 6,000 generated documents per run.
//
// Those three are all blind to one thing: whether a passing assertion would ever fail.
// `.scratch/probe-mutants.mjs` answers that by breaking this file 30 different ways and
// checking the suite goes red; it is the check that found four of the five real holes in those
// tests, and `docs/deep-work/2026-09-30-sldd-xml-fast-reader/testing.md` says which. The fifth
// was found by a new fixture, and is the numeric-reference story above.
import toNumber from 'strnum';
/** The options fast-xml-parser's OptionsBuilder defaults to; see `numberParseOptions`. */
const NUMBER_OPTIONS = { hex: true, leadingZeros: true, eNotation: true, unicode: false };
const TEXT_KEY = '#text';
/**
 * Attribute keys, pre-prefixed and interned.
 *
 * Not a micro-optimization: `Class` and `Name` occur 6.3 M and 6.0 M times across the corpus,
 * so building `'@_' + name` per occurrence is twelve million string allocations that this
 * lookup replaces with twelve million pointer copies. An attribute NOT in this table is still
 * read — it just pays the concatenation — because an unknown attribute is harmless to copy
 * faithfully and bailing on one would strand a whole file for nothing.
 */
const ATTR_KEYS = new Map([
    ['Class', '@_Class'],
    ['Name', '@_Name'],
    ['Dimension', '@_Dimension'],
    ['Source', '@_Source'],
    ['PropertyType', '@_PropertyType'],
    ['IsComplex', '@_IsComplex'],
    ['IsEnum', '@_IsEnum'],
    ['EnumerationName', '@_EnumerationName'],
    ['EnumerationType', '@_EnumerationType'],
    ['Encoding', '@_Encoding'],
    ['EncodedLength', '@_EncodedLength'],
    ['FormatVersion', '@_FormatVersion'],
    ['MinRelease', '@_MinRelease'],
    ['Arch', '@_Arch'],
    ['version', '@_version'],
    ['encoding', '@_encoding'],
    ['standalone', '@_standalone'],
]);
/** Character codes, named so the scanner reads as prose rather than as arithmetic. */
const SLASH = 0x2f; // /
const BANG = 0x21; // !
const QUESTION = 0x3f; // ?
const EQUALS = 0x3d; // =
const QUOTE = 0x22; // "
const APOS = 0x27; // '
const SPACE = 0x20;
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const DIGIT_0 = 0x30;
const DIGIT_9 = 0x39;
const PLUS = 0x2b;
const MINUS = 0x2d;
const DOT = 0x2e;
const UPPER_P = 0x50;
const HASH = 0x23; // #
const SEMI = 0x3b; // ;
const LOWER_X = 0x78; // x
const UPPER_X = 0x58; // X
function isSpace(c) {
    return c === SPACE || c === LF || c === TAB || c === CR;
}
/**
 * The end of the `&...;` token starting at `at`, or `-1` when there is none. The entity decoder
 * looks at most 32 characters past the `&` and gives up if it has not found a `;` by then, so a
 * `;` further away does not close a reference — the `&` is just text.
 */
function entityEnd(value, at) {
    let j = at + 1;
    while (j < value.length && value.charCodeAt(j) !== SEMI && j - at <= 32)
        j++;
    return j < value.length && value.charCodeAt(j) === SEMI ? j : -1;
}
/**
 * Whether the entity decoder DELETES this codepoint instead of leaving its reference standing: a
 * C0 control other than tab/LF/CR — NUL included — or a surrogate half. XML 1.0 cannot carry any
 * of them at all, so the decoder drops them even though it otherwise decodes no numeric reference.
 *
 * A codepoint it cannot parse, or one out of Unicode's range, is NOT deleted — it is left alone,
 * which is the same thing that happens to an ordinary one.
 *
 * NUL has no case of its own even though the decoder gives it a separate, separately configurable
 * rule, because every setting of that rule still deletes it and `0 <= 0x1f` already says so. It
 * had one until mutation testing showed that removing it changed nothing: an untestable branch.
 *
 * This is deliberately a superset of what the decoder deletes, not an equal: a document declaring
 * `version="1.1"` exempts the C0 block, and this does not follow it there. The consequence of the
 * difference is only ever an extra bail, which costs speed and not fidelity — the direction every
 * disagreement in this file has to fall.
 */
function isProhibitedCodePoint(cp) {
    if (Number.isNaN(cp) || cp < 0 || cp > 0x10ffff)
        return false;
    if (cp <= 0x1f)
        return cp !== TAB && cp !== LF && cp !== CR;
    return cp >= 0xd800 && cp <= 0xdfff;
}
/**
 * The five entities XML defines, and the only five a dictionary uses. `htmlEntities` is off and
 * `numericAllowed` follows it, so fast-xml-parser decodes exactly these five and nothing else;
 * `&nbsp;` and a bare `&` are a bail, so this never has to be the authority on what the other
 * engine would have done with them.
 *
 * A numeric character reference is the one case worth more than a bail. The engine does not
 * decode `&#xD;` — it leaves it standing as literal text — and MATLAB writes exactly that for a
 * CR inside a char property, which `test/fixtures/custom_object_binary.sldd` now contains. The
 * 32-dictionary corpus had none and said these never occur; it was simply blind, since none of
 * those files held a multi-line value. Declining would have been correct and would have cost the
 * whole file: one CR anywhere in 74 MB sends every byte of it back to the slow engine.
 *
 * Callers check for `&` before calling, so the no-entity case costs one `indexOf` and no call.
 */
function decodeEntities(value) {
    let out = '';
    let from = 0;
    let at = value.indexOf('&');
    while (at !== -1) {
        out += value.slice(from, at);
        if (value.startsWith('amp;', at + 1)) {
            out += '&';
            from = at + 5;
        }
        else if (value.startsWith('lt;', at + 1)) {
            out += '<';
            from = at + 4;
        }
        else if (value.startsWith('gt;', at + 1)) {
            out += '>';
            from = at + 4;
        }
        else if (value.startsWith('quot;', at + 1)) {
            out += '"';
            from = at + 6;
        }
        else if (value.startsWith('apos;', at + 1)) {
            out += "'";
            from = at + 6;
        }
        else if (value.charCodeAt(at + 1) === HASH) {
            // Left standing, reference and all — EXCEPT a codepoint XML 1.0 prohibits, which the engine
            // deletes from the value. That table is not reimplemented here: nothing a dictionary holds
            // reaches it, so this bails and lets the engine be the one that knows.
            const end = entityEnd(value, at);
            if (end !== -1) {
                const c = value.charCodeAt(at + 2);
                const hex = c === LOWER_X || c === UPPER_X;
                // The same two `parseInt` calls the decoder makes, lenient tail and all, because a token
                // like `&#1zz;` has to be classified the way it classifies it.
                const cp = hex
                    ? parseInt(value.slice(at + 3, end), 16)
                    : parseInt(value.slice(at + 2, end), 10);
                if (isProhibitedCodePoint(cp))
                    return null;
            }
            out += '&';
            from = at + 1;
        }
        else {
            return null; // not ours to interpret
        }
        at = value.indexOf('&', from);
    }
    return out + value.slice(from);
}
/**
 * The text pipeline, in fast-xml-parser's order: decode, then offer to the layout-whitespace
 * hook, then coerce only an unpadded value.
 *
 * Returns `undefined` for "add no `#text` key", which is how both the empty chunk and the
 * dropped layout whitespace arrive — `saveTextToParentTag` adds the key only for a non-empty
 * processed value. Returns `null` for "bail", which text can only do by carrying an entity
 * this reader will not interpret.
 *
 * `trim` is called ONCE. It used to be called twice, which cost a second pass over every
 * value in the file for a question the first pass had already answered.
 */
function processText(raw, isLeaf) {
    let decoded = raw;
    if (raw.indexOf('&') !== -1) {
        const d = decodeEntities(raw);
        if (d === null)
            return null;
        decoded = d;
    }
    const trimmed = decoded.trim();
    // `dropLayoutWhitespace`: whitespace between two tags is layout, and removing the KEY rather
    // than emptying it is what the real hook achieves by returning ''.
    if (trimmed === '' && !isLeaf)
        return undefined;
    if (trimmed !== decoded)
        return decoded; // padded: handed back raw, uncoerced
    if (decoded === 'true')
        return true;
    if (decoded === 'false')
        return false;
    // `strnum` can only ever return a number for a value whose first character is a digit, a
    // sign or a dot — EXCEPT when it is leading whitespace, and the line above has just proved
    // there is none. Verified exhaustively over all 65,535 BMP first characters: the only ones
    // that coerce despite not being digit-like are the 25 that `trim` strips. So this guard
    // skips the call for every name, class and enum literal in the file, which is most of them,
    // without being able to change an answer.
    const c0 = decoded.charCodeAt(0);
    if ((c0 >= DIGIT_0 && c0 <= DIGIT_9) || c0 === PLUS || c0 === MINUS || c0 === DOT) {
        return toNumber(decoded, NUMBER_OPTIONS);
    }
    return decoded;
}
/** `Object`, `P`, `Element` and `Field` are forced to arrays by `isArray`; nothing else is. */
function alwaysArray(tag) {
    return tag === 'P' || tag === 'Element' || tag === 'Object' || tag === 'Field';
}
/**
 * Attach a finished child value to its parent, matching `compress`'s accumulation: the
 * forced-array names start as a one-element array and push; anything else is set once and only
 * becomes an array if the name repeats.
 */
function attach(parent, tag, value) {
    const existing = parent[tag];
    if (existing === undefined && !Object.prototype.hasOwnProperty.call(parent, tag)) {
        parent[tag] = alwaysArray(tag) ? [value] : value;
        return;
    }
    if (Array.isArray(existing)) {
        existing.push(value);
        return;
    }
    parent[tag] = [existing, value];
}
/**
 * The five element names a dictionary uses, interned — so 6.9 M elements share five strings
 * instead of allocating 6.9 M. Any other name is a bail: it would mean this is not the
 * document this reader was measured against.
 */
function internTag(text, from, to) {
    switch (to - from) {
        case 1:
            return text.charCodeAt(from) === UPPER_P ? 'P' : null;
        case 5:
            return text.startsWith('Field', from) ? 'Field' : null;
        case 6:
            return text.startsWith('Object', from) ? 'Object' : null;
        case 7:
            return text.startsWith('Element', from) ? 'Element' : null;
        case 10:
            return text.startsWith('DataSource', from) ? 'DataSource' : null;
        default:
            return null;
    }
}
/**
 * Read `name="value"` pairs out of `text[from, limit)` into the two parallel buffers, and
 * answer how many there were — or `-1` to bail.
 *
 * Quoted values only. fast-xml-parser's own attribute regex tolerates a name with no value; a
 * dictionary has never written one, and guessing what the engine would make of it is exactly
 * the kind of judgement this reader defers instead of imitating.
 */
function readAttributes(text, from, limit, keys, vals) {
    let k = from;
    let count = 0;
    while (k < limit) {
        if (isSpace(text.charCodeAt(k))) {
            k++;
            continue;
        }
        const nameStart = k;
        while (k < limit) {
            const c = text.charCodeAt(k);
            if (isSpace(c) || c === EQUALS)
                break;
            k++;
        }
        if (k === nameStart)
            return -1;
        const name = text.slice(nameStart, k);
        while (k < limit && isSpace(text.charCodeAt(k)))
            k++;
        if (text.charCodeAt(k) !== EQUALS)
            return -1;
        k++;
        while (k < limit && isSpace(text.charCodeAt(k)))
            k++;
        const quote = text.charCodeAt(k);
        if (quote !== QUOTE && quote !== APOS)
            return -1;
        const valueStart = k + 1;
        const valueEnd = text.indexOf(quote === QUOTE ? '"' : "'", valueStart);
        if (valueEnd === -1 || valueEnd > limit)
            return -1;
        let value = text.slice(valueStart, valueEnd);
        // Attribute values are entity-decoded but never coerced and never trimmed.
        if (value.indexOf('&') !== -1) {
            const decoded = decodeEntities(value);
            if (decoded === null)
                return -1;
            value = decoded;
        }
        keys[count] = ATTR_KEYS.get(name) ?? `@_${name}`;
        vals[count] = value;
        count++;
        k = valueEnd + 1;
    }
    return count;
}
/**
 * Read a dictionary XML part, or decline.
 *
 * `null` means "I did not read this" — never "this is broken". The caller must fall back to the
 * general engine, which owns every judgement about damaged input.
 *
 * HOW THE STATE IS HELD, and why it is seven arrays instead of a stack of objects.
 *
 * The obvious shape is a `Frame` object per open element, pushed and popped. It works and it
 * was the first version, and it cost one object plus one attribute array for every element in
 * the file — 13.8 M allocations on the corpus's largest dictionary, all of them dying
 * immediately. Dictionaries nest shallowly (single digits), so the arrays below are indexed by
 * DEPTH and reused: a `<P>` at depth 3 writes over the state of the previous `<P>` at depth 3.
 * The element's own object (`kids[d]`) is of course fresh each time, because it is the output.
 */
export function readDictionaryXmlFast(text) {
    const n = text.length;
    const root = {};
    // Per-depth element state, grown on demand and then reused. `kidCount` is how the collapse
    // rules are decided without calling `Object.keys` 6.9 M times: "no child keys" is exactly
    // "no child was attached", and that is the only thing those rules need to know.
    const tags = [];
    const kids = [];
    const kidCount = [];
    const textVal = [];
    const textCount = [];
    const attrKey = [];
    const attrVal = [];
    const attrCount = [];
    /** Finish the element in slot `d` and answer the value its parent should hold. */
    const closeSlot = (d) => {
        const val = kids[d];
        const text0 = textVal[d];
        const hasText = textCount[d] > 0 && text0 !== undefined && text0 !== '';
        if (hasText)
            val[TEXT_KEY] = text0;
        const ac = attrCount[d];
        if (ac > 0) {
            const ks = attrKey[d];
            const vs = attrVal[d];
            for (let a = 0; a < ac; a++)
                val[ks[a]] = vs[a];
            return val; // an element with attributes never collapses
        }
        if (kidCount[d] === 0)
            return hasText ? text0 : '';
        return val;
    };
    /** Hand a finished value to its parent, or to the root when there is no parent. */
    const emit = (d, tag, value) => {
        if (d === 0) {
            attach(root, tag, value);
            return true; // a root element was seen
        }
        attach(kids[d - 1], tag, value);
        kidCount[d - 1]++;
        return false;
    };
    let depth = 0;
    let i = 0;
    let sawRoot = false;
    while (i < n) {
        const lt = text.indexOf('<', i);
        // --- text between tags ------------------------------------------------------------
        if (lt !== i) {
            const end = lt === -1 ? n : lt;
            // Find the first non-whitespace WITHOUT slicing. The gap between two pretty-printed
            // tags is layout and is dropped; there are 204,373 such gaps in the corpus's largest
            // dictionary, and slicing each one only to `trim` it and throw it away is two string
            // allocations per gap for an answer this loop already has.
            //
            // Only XML's four whitespace characters are tested here, while `trim` strips the whole
            // Unicode set — which is safe in this direction: "all ASCII whitespace" implies "trims
            // to empty", and anything this loop calls non-whitespace still goes through
            // `processText`, where the real `trim` has the final say.
            let w = i;
            while (w < end && isSpace(text.charCodeAt(w)))
                w++;
            const allSpace = w === end;
            if (depth === 0) {
                // Outside any element. Only whitespace may live here; anything else is content this
                // reader has no place to put, so it is the general engine's problem.
                if (!allSpace)
                    return null;
            }
            else {
                // A close tag makes this the element's last chunk, and "leaf" means no child was ever
                // attached — which is what `OrderedObjParser` asks when it flushes there. An opening
                // tag follows, so it hands `isLeafNode: false` outright.
                const isClose = lt !== -1 && text.charCodeAt(lt + 1) === SLASH;
                const leaf = isClose && kidCount[depth - 1] === 0;
                // `allSpace && !leaf` is precisely the dropped-layout case, so skipping it here is
                // not a shortcut past `processText` — it is the same answer without the two strings.
                if (!allSpace || leaf) {
                    const processed = processText(text.slice(i, end), leaf);
                    if (processed === null)
                        return null;
                    if (processed !== undefined) {
                        const d = depth - 1;
                        textVal[d] =
                            textCount[d] === 0 ? processed : `${String(textVal[d])}${String(processed)}`;
                        textCount[d]++;
                    }
                }
            }
            if (lt === -1)
                break;
            i = lt;
        }
        const after = text.charCodeAt(i + 1);
        // --- anything this reader refuses to interpret -------------------------------------
        // One `<!` is a comment, a CDATA section or a DOCTYPE. The first two would be text this
        // reader would have to splice; the third brings entity declarations and the expansion
        // limits that go with them. All three are the general engine's job.
        if (after === BANG)
            return null;
        if (after === QUESTION) {
            // The leading declaration is a root key (`ignoreDeclaration: false`); any other
            // processing instruction is not something this reader has a shape for.
            const pi = text.indexOf('?>', i + 2);
            if (pi === -1)
                return null;
            if (!text.startsWith('<?xml', i))
                return null;
            if (sawRoot || depth !== 0)
                return null;
            const keys = [];
            const vals = [];
            const count = readAttributes(text, i + 5, pi, keys, vals);
            if (count < 0)
                return null;
            const decl = {};
            for (let a = 0; a < count; a++)
                decl[keys[a]] = vals[a];
            // A declaration has no children and no text, so `compress` gives `{}` and then
            // `assignAttributes` fills it; with no attributes at all it would collapse to ''.
            root['?xml'] = count > 0 ? decl : '';
            i = pi + 2;
            continue;
        }
        // --- close tag --------------------------------------------------------------------
        if (after === SLASH) {
            const gt = text.indexOf('>', i + 2);
            if (gt === -1 || depth === 0)
                return null;
            let end = gt;
            while (end > i + 2 && isSpace(text.charCodeAt(end - 1)))
                end--;
            depth--;
            const tag = tags[depth];
            // A mismatched close is not ours to forgive — the engine accepts it, and what it builds
            // from there is its own documented leniency.
            if (text.slice(i + 2, end) !== tag)
                return null;
            if (emit(depth, tag, closeSlot(depth)))
                sawRoot = true;
            i = gt + 1;
            continue;
        }
        // --- open tag ---------------------------------------------------------------------
        const gt = text.indexOf('>', i + 1);
        if (gt === -1)
            return null; // unclosed: the general engine decides what survives
        const selfClosing = text.charCodeAt(gt - 1) === SLASH;
        const tagEnd = selfClosing ? gt - 1 : gt;
        let nameEnd = i + 1;
        while (nameEnd < tagEnd && !isSpace(text.charCodeAt(nameEnd)))
            nameEnd++;
        const tag = internTag(text, i + 1, nameEnd);
        if (tag === null)
            return null;
        if (depth === 0 && sawRoot)
            return null; // a second root is a shape we lack
        const d = depth;
        let ks = attrKey[d];
        if (ks === undefined) {
            ks = attrKey[d] = [];
            attrVal[d] = [];
        }
        const count = readAttributes(text, nameEnd, tagEnd, ks, attrVal[d]);
        if (count < 0)
            return null;
        tags[d] = tag;
        kids[d] = {};
        kidCount[d] = 0;
        textVal[d] = undefined;
        textCount[d] = 0;
        attrCount[d] = count;
        if (selfClosing) {
            if (emit(d, tag, closeSlot(d)))
                sawRoot = true;
        }
        else {
            depth++;
        }
        i = gt + 1;
    }
    // An unclosed element, or nothing recognised at all. Both are the fallback's to report:
    // "no markup" reads as the empty object there, and this reader must not invent that.
    if (depth > 0 || !sawRoot)
        return null;
    return root;
}
//# sourceMappingURL=DictionaryXmlFast.js.map