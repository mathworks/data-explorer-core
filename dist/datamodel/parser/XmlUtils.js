// Copyright 2026 The MathWorks, Inc.
'use strict';
import { matlabFloatText } from './floatDigits.js';
import { dimensionText } from './Size.js';
/**
 * Text or an attribute value, as XML has to carry it.
 *
 * A carriage return is written as `&#xD;`, because XML 1.0 §2.11 has every reader present a raw
 * CR as a LF: written as itself, it would be read back as a different char. That is why MATLAB
 * writes `&#xD;` for each CR inside a char, and the dictionary reader decodes the reference to a
 * CR (XmlReader), so a CR read from a dictionary goes back out as the reference it came in as.
 * A tab and a LF need no reference in text and get none, as MATLAB writes them.
 */
export function escapeXml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/\r/g, '&#xD;');
}
/**
 * The property-bag key MATLAB's saveobj envelope is filed under.
 *
 * A class that serializes through `saveobj` writes its whole state as one UNNAMED
 * `<P Source="saveobj" PropertyType="any" Class="struct">`, so a property bag — which
 * needs a key — has to invent one. It must start with '_': MATLAB identifiers cannot,
 * so the key can never collide with a real property name, and the display and edit paths
 * can filter it out on that rule alone.
 *
 * Read by BinarySlddParser.parseStructElement and written by DataNode.pxAttrs, which
 * turns it back into the Source/PropertyType attributes. Keyed 'undefined' (the old
 * behaviour of an absent @_Name) MATLAB's loadobj finds no envelope at all and rebuilds
 * an EMPTY object — defect 28.
 */
export const SAVEOBJ_KEY = '_saveobj';
/**
 * The SAME envelope, as an uncompressed-text `.sldd` spells it.
 *
 * It sits next to SAVEOBJ_KEY because the one thing worth knowing about these two names is
 * that they name one concept, and a reader who finds only one of them will conclude the
 * other format has no envelope. That conclusion was actually drawn: defect 46 was diagnosed
 * as binary-only on the stated reasoning that "the json channel has no envelope", and the
 * text half went unfixed for that reason. It has one. MATLAB writes it as `_custom_save`,
 * and puts it in a DIFFERENT PLACE — a sibling of `_properties` on the element, not a key
 * inside it, and on a custom-saving class there is no `_properties` at all:
 *
 *     "_elements": [ { "_custom_save": { "_fields": [...], "_elements": [...] }, "_id": "1" } ]
 *
 * So a reader that looks only at `_elements[0]._properties` sees an object with NO
 * properties and nothing to suggest it is missing anything. `SimulinkObjectNode._propsOf`
 * therefore lifts it into the bag under SAVEOBJ_KEY, and `DataNode._serializeSimulinkObject`
 * puts it back where MATLAB expects it; everything in between — `_mergeProps`,
 * `writeIntoSaveobj`, the display filter that hides keys starting with '_' — then works on
 * one spelling in both formats, which is the only arrangement in which the two paths cannot
 * drift apart again.
 */
export const CUSTOM_SAVE_KEY = '_custom_save';
/**
 * Where an enumeration value in a binary dictionary keeps what MATLAB wrote of it.
 *
 * MATLAB states an enumeration value as a wrapper marked `IsEnum="1"` — a `<P>`, or in a cell
 * an `<Element>` — around one `<Element Class="GearMode" EnumerationName="Reverse"
 * EnumerationType="int32">-1</Element>` per enumeral. BinarySlddParser.enumValue reads one, at
 * an entry, a property or a struct field, and a cell element alike, as the object bag every
 * classed value is, `{_array_class, _dimensions, _elements}`, with the wrapper's IsEnum under
 * ENUM_KEY and each enumeral's name, type and value text under ENUMERATION_KEY on its element
 * ({@link Enumeral}). Those are what a save writes back (DataNode._enumXml) and what the value
 * shows (ObjectNode.displayValue).
 *
 * The keys are this reader's, not the text format's: a text dictionary spells an enumeration
 * value another way (`_enum_value`) and has no reader for these. Both start with '_', so
 * neither can be a property name, and a text dictionary is written without them
 * (MatWriter.textDictionaryForm).
 */
export const ENUM_KEY = '_is_enum';
export const ENUMERATION_KEY = '_enumeration';
/**
 * Where an object's element in a binary dictionary keeps the `Source` and `PropertyType` MATLAB
 * wrote on a named property of it, by property name.
 *
 * MATLAB marks a dynamic property, the options a custom or AUTOSAR target adds to a config
 * component, as `<P Name="AutosarSchemaVersion" Source="dynamic" PropertyType="…"
 * Class="char">`. BinarySlddParser reads the property into the element's bag like any other,
 * which is where it is shown and edited, and these two attributes onto the element under this
 * key, as `{AutosarSchemaVersion: {source: 'dynamic', propertyType: '…'}}`; the writers of an
 * object's element write them back (DataNode._elementPropertyXml). The unnamed saveobj
 * envelope's own Source is SAVEOBJ_KEY's, and is not one of these.
 *
 * Binary-only, as ENUM_KEY is: a text dictionary has no place for either attribute (MATLAB puts
 * a dynamic property there in `_dynamic_properties`, beside `_properties`), so it is written
 * without the key (MatWriter.textDictionaryForm).
 */
export const PROPERTY_SOURCE_KEY = '_property_source';
/** The PROPERTY_SOURCE_KEY record of `element`, one of an object's `_elements`, or null. */
export function propertySourcesOf(element) {
    if (element === null || typeof element !== 'object') {
        return null;
    }
    const r = element[PROPERTY_SOURCE_KEY];
    return r !== null && typeof r === 'object' && !Array.isArray(r) ? r : null;
}
/**
 * Where a classed or shaped empty says it was read out of a binary dictionary.
 *
 * The binary reader holds one as its class under the bare header of its extents, `{_type:
 * 'int8', _value: 'Matrix(0,3)'}` (BinarySlddParser.emptyOf), and a shaped empty char as the
 * shaped char's literal with no character in it, `{_type: 'mxchar', _value: 'Matrix(0,2)\n[]'}`
 * (BinarySlddParser.charValue). A text dictionary can hold the same spelling, and reads it as
 * the same value. What a text dictionary is given for a binary dictionary's empty is the spelling
 * MATLAB reads back there (MatWriter.heldTextSpelling), not always this one; an empty
 * the text dictionary holds itself is its own, and is written as it holds it, however often it
 * is copied, pasted or re-read. The spelling cannot tell the two apart, and a copy keeps no
 * identity, so the binary reader says which it is, under this key, as it says a value is an
 * enumeration value (ENUM_KEY). The key is this reader's, not the text format's: a text
 * dictionary is written without it (MatWriter.textDictionaryForm), and every other reader and
 * writer here passes it by.
 */
export const BINARY_EMPTY_KEY = '_binary_empty';
/**
 * The empty of class `cls` and extents `dims` as the binary reader holds one (BinarySlddParser.emptyOf),
 * `{_type: 'int8', _value: 'Matrix(0,3)'}`, under its mark (BINARY_EMPTY_KEY).
 */
export function binaryEmptyForm(cls, dims) {
    return { _type: cls, _value: 'Matrix(' + dims.join(',') + ')', [BINARY_EMPTY_KEY]: true };
}
/**
 * The extents of `text` when it is the bare `Matrix(…)` header of an empty, a 0 among them and
 * no body (`Matrix(0,3)`), the form the binary reader holds a classed or shaped empty in
 * (BinarySlddParser.emptyOf); null for any other text. Trailing singletons past the second are
 * dropped, as MATLAB's size() drops them.
 */
export function emptyHeaderDims(text) {
    const m = typeof text === 'string' ? /^Matrix\((\d+(?:,\d+)*)\)$/.exec(text) : null;
    if (!m) {
        return null;
    }
    const dims = m[1].split(',').map(Number);
    if (!dims.includes(0)) {
        return null;
    }
    while (dims.length > 2 && dims[dims.length - 1] === 1) {
        dims.pop();
    }
    return dims;
}
/** Whether `value` is an enumeration value as a binary dictionary's reader holds one (see ENUM_KEY). */
export function isEnumBag(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const o = value;
    return typeof o[ENUM_KEY] === 'string' && typeof o._array_class === 'string' && o._array_class !== '';
}
/**
 * The `_enum_value` of `value` when `value` is an enumeration value as a text dictionary spells
 * one, or undefined. MATLAB writes the whole value as one element holding the numbers its
 * enumerals stand for, in a bag that is 1x1 whatever the value's size (MatWriter.enumTextForm),
 * and at an object's property the element alone, `{_enum_value, _id, _object_class}`. The binary
 * reader's own form (isEnumBag) is not this one.
 */
export function textEnumValueOf(value) {
    const bag = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    const own = (o) => (Object.prototype.hasOwnProperty.call(o, '_enum_value') ? o._enum_value : undefined);
    if (!bag(value) || isEnumBag(value)) {
        return undefined;
    }
    if (typeof value._object_class === 'string') {
        return own(value);
    }
    const elements = value._elements;
    if (typeof value._array_class !== 'string' || !Array.isArray(elements) || elements.length !== 1 || !bag(elements[0])) {
        return undefined;
    }
    return own(elements[0]);
}
/** The enumeral `element`, one of an enumeration value's `_elements`, holds, or null. */
export function enumeralOf(element) {
    if (element === null || typeof element !== 'object') {
        return null;
    }
    const e = element[ENUMERATION_KEY];
    return e !== null && typeof e === 'object' && typeof e.value === 'string' ? e : null;
}
// A number as MATLAB spells it. Only the non-finite values differ from
// String(num), but they differ in a way that matters: MATLAB cannot read the
// JavaScript spelling 'Infinity' back, and our own MatlabValueParser rejects it
// too — so a value displayed as 'Infinity' is also an uneditable one.
export function formatMatlabNum(num) {
    if (typeof num === 'number' && !isFinite(num)) {
        return isNaN(num) ? 'NaN' : num > 0 ? 'Inf' : '-Inf';
    }
    return String(num);
}
// One complex element as this package spells it: `3+4i`, `1-2i`, `0+5i`, `3+0i`. Each
// part as formatMatlabNum spells it, and between them the imaginary part's own sign, or
// '+' when `im >= 0`. It is also how an element read out of MAT bytes is spelled, a plain
// .mat variable's and a text dictionary's MAT stream's (SparseData.complexElement), and a
// typed-in complex literal (MatlabValueParser.parseComplex). The MAT arm wrote String()
// for the parts through 1.40.0, and so spelled an infinity 'Infinity'.
//
// `NaN >= 0` is false, so a NaN imaginary part gets no '+': complex(1, NaN) is `1NaNi`,
// which is what the .mat arm already shows for it, and also how MATLAB's own writer
// spells the element: a compressed-binary dictionary stores [complex(Inf,-Inf)
// complex(NaN,1) complex(1,NaN) complex(-Inf,2)] as `Inf-Infi NaN+1.0i 1.0NaNi -Inf+2.0i`
// (R2027a, complex_binary.sldd's pNonFinite) — though MATLAB's reader does not take that
// text back as the value it wrote (complex_binary_sldd.truth.json).
// A part may be an exact decimal token (an int64 beyond 2^53, see exactInt); Number()
// reads its sign.
export function formatComplexNum(re, im) {
    return formatMatlabNum(re) + (Number(im) >= 0 ? '+' : '') + formatMatlabNum(im) + 'i';
}
// One part of a complex element: a decimal, `Inf`, or `NaN`, unsigned. `Infinity` too,
// because that is what an element read out of MAT bytes said for an infinite part through
// 1.40.0 (SparseData.complexElement wrote String()), so text shown then still reads.
//
// A decimal is `\d+(?:\.\d*)?`, never `\d+\.?\d*`: the same numbers, but with no dot the
// second is `\d+\d*`, which a backtracking engine splits every way it can before it gives
// up. Twice over in one element that was cubic, and this runs on a file's own text (a text
// dictionary's `_nonFinite` cdata, a binary one's in the Property Inspector): 5,000 digits,
// `+`, 5,000 more and an `x` took 55 s. It takes 0.3 ms now, and a million digits 1.1 ms.
const COMPLEX_PART = '(?:Inf(?:inity)?|NaN|(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)';
// A whole element: the real part with an optional sign, then the imaginary part, which
// has its own sign — except a NaN, which formatComplexNum and MATLAB's binary writer
// both write with none (`1NaNi`).
const COMPLEX_ELEMENT = new RegExp('^([+-]?' + COMPLEX_PART + ')([+-]' + COMPLEX_PART + '|NaN)i$');
/**
 * formatComplexNum's inverse: one complex element's text back into its two parts, or null
 * for text that is not one. It reads every spelling this package holds an element in —
 * its own (`3+4i`, `1NaNi`, `-Inf+2i`), a binary dictionary's (`3.0+4.0i`,
 * `1.0E-20+2.0E+21i`), and the `1+Infinityi` an element read out of MAT bytes was shown
 * as through 1.40.0 — so the writers can rebuild the value from any of them. Under a
 * 64-bit integer class a part keeps its exact decimal text (parseExactNum), as every
 * other read of such a value does.
 *
 * The NaN and Inf parts are why this exists. The pattern the writers used before,
 * `^([-\d.eE+]+)([+-][\d.eE+]+)i$`, matched neither, and the element it did not match
 * was written as 0+0i.
 */
export function parseComplexNum(text, type) {
    const m = COMPLEX_ELEMENT.exec(text.trim());
    if (!m) {
        return null;
    }
    const part = (s) => {
        // A sign means nothing on a NaN, and parseMatlabNum knows only the bare word.
        const t = s.replace(/Infinity$/, 'Inf').replace(/^[+-](?=NaN$)/, '');
        return needsExactInt(type) ? parseExactNum(t) : parseMatlabNum(t);
    };
    return { re: part(m[1]), im: part(m[2]) };
}
// A part of an element that is a zero, unsigned: `0`, `0.0`, `.0`, `0e3`.
const ZERO_PART = /^(?:0+(?:\.0*)?|\.0+)(?:[eE][+-]?\d+)?$/;
/**
 * One complex element's text as it is shown: the text, but for an imaginary part of -0, which
 * shows with a `+`, as formatComplexNum spells it. complex(1, -0), which a binary dictionary
 * holds as `1.0-0.0i` (MATLAB spells a -0 `-0.0`), showed `1-0i`, which reads as a negative
 * imaginary part; it shows `1+0i`, as the same value read out of MAT bytes does, and MATLAB
 * shows `1.0000 + 0.0000i` (the maintainer's ruling of 2026-10-18, group G). Display only: the
 * text is the value, and keeps its sign, because an edit of one element writes the others from
 * it. A real part of -0 is shown as it is. Text that is not one element is returned as it is.
 */
export function shownComplexText(text) {
    // Most text has no `-0` or `-.` in it at all, and needs no match.
    if (text.indexOf('-0') < 0 && text.indexOf('-.') < 0) {
        return text;
    }
    const m = COMPLEX_ELEMENT.exec(text);
    if (!m || m[2][0] !== '-' || !ZERO_PART.test(m[2].slice(1))) {
        return text;
    }
    return m[1] + '+' + m[2].slice(1) + 'i';
}
// The numeric classes besides double, which is the class a complex value has when its
// envelope says nothing.
const NON_DOUBLE_NUMERIC_CLASS = /^(?:single|u?int(?:8|16|32|64))$/;
/**
 * The `_class` a complex value's `{ _type: 'cdata' }` envelope carries: its MATLAB class
 * when that is single or an integer class, and undefined for double — and for anything
 * that is not a numeric class at all, a sparse array's 'sparse' included, which MATLAB
 * itself calls double. Both producers of the plain-text envelope, BinarySlddParser (from
 * the `<P Class="int16" IsComplex="1">` attribute) and McosParser.complexPropertyValue
 * (from the decoded variable), set it the same way, and the node layer reads it to
 * class an array (MatlabVariableNode._parseCdataText) and the binary writer to spell
 * `Class=` (DataNode._serializeTypedPropertyXml). Without it, every complex value in
 * either was a double: an int16 Value showed `<1x60 double>` and was written back
 * `Class="double"`.
 */
export function complexClassTag(className) {
    return typeof className === 'string' && NON_DOUBLE_NUMERIC_CLASS.test(className) ? className : undefined;
}
// The inverse: a number as it appears in a .sldd, falling back to 0 for text
// that is not a number at all. parseFloat reads MATLAB's Inf/-Inf/NaN as NaN,
// and the `|| 0` idiom then silently turns each of them into zero — so the
// non-finite spellings have to be recognised before parseFloat sees them.
export function parseMatlabNum(text) {
    const t = text.trim();
    if (t === 'Inf' || t === '+Inf') {
        return Infinity;
    }
    if (t === '-Inf') {
        return -Infinity;
    }
    if (t === 'NaN') {
        return NaN;
    }
    const n = parseFloat(t);
    return isNaN(n) ? 0 : n;
}
// A whitespace-separated numeric body, as a .sldd/.slx <P> carries it.
// BinarySlddParser split and converted this for itself in THREE places and reached
// for plain `Number` in two of them — and Number('Inf') is NaN, because JavaScript
// spells infinity 'Infinity'. So MATLAB's own bytes for a vector holding
// non-finites, `Dimension="1*5">1.0 Inf -Inf NaN 5.0`, read back as
// [1 NaN NaN NaN 5]: both infinities destroyed on load and indistinguishable
// afterwards from a real NaN. One helper, so the three sites cannot disagree again.
export function parseNumericBody(text) {
    return text.trim().split(/\s+/).map((part) => parseMatlabNum(part));
}
// ---- exact 64-bit integers (defects 29 and 30) ----
//
// A double holds every integer up to 2^53 and nothing past it. MATLAB's int64/uint64
// range is 2^64 wide, so its own values are outside a double's exact range BY
// CONSTRUCTION — cases.sldd carries maxU64 = 18446744073709551615 and i64Unsafe =
// 9007199254740993 — and every channel that read them through parseFloat wrote a
// different number back:
//
//   maxU64   18446744073709551615  ->  18446744073709552000U
//   i64Vec   [9223372036854775807, -9223372036854775808, -1]
//            -> [9223372036854776000, -9223372036854776000, -1]
//
// Worse than a rounding nit, the value comes back OUT of range (18446744073709552000 >
// intmax('uint64')), and MATLAB's reader does not merely clamp that token — it abandons
// the REST of the body. u64Vec's [18446744073709551615, 1, 0] reopened as
// [18446744073709551615, 0, 0], so a neighbour that was perfectly representable was
// destroyed by its neighbour's overflow (measured by probe_writeback_bin).
//
// The fix is to stop converting: a token a double cannot hold is carried as its own
// decimal TEXT, from the reader all the way to the writer. Every formatter below goes
// through formatMatlabNum, which is String(), so the text passes through untouched.
/**
 * One numeric token, EXACT: a number where a double is lossless, the canonical decimal
 * TEXT where it is not.
 *
 * The test is the round trip, not the class. Every value a double does hold stays a
 * number, so no existing path changes behaviour and only the tokens that were actually
 * being corrupted take the new representation. `+7` and `007` canonicalize to `7`, so a
 * cosmetic difference in the stored spelling never on its own forces the text form.
 */
export function parseExactNum(text) {
    const t = text.trim();
    const num = parseMatlabNum(t);
    if (!/^[+-]?\d+$/.test(t)) {
        return num;
    }
    const canon = t.replace(/^\+/, '').replace(/^(-?)0+(?=\d)/, '$1');
    return String(num) === canon ? num : canon;
}
/** parseNumericBody's exact twin: a whitespace-separated body, token by token. */
export function parseExactBody(text) {
    return text.trim().split(/\s+/).map(parseExactNum);
}
/**
 * parseExactNum's binary twin: one 64-bit integer read out of a BINARY container, in the
 * same `number | string` form.
 *
 * A `.mat` file stores an int64/uint64 as eight raw bytes, so there is no decimal text to
 * canonicalize — `DataView.getBigInt64` gives the value exactly and the only question is
 * whether a double can carry it onward. Same rule as parseExactNum, same two outcomes, so
 * the two readers cannot disagree about which values take the text form: everything a
 * double holds stays a number, and only the tokens that were actually being corrupted
 * become text.
 *
 * `Number.isSafeInteger` is the exact test — not `<= Number.MAX_SAFE_INTEGER`, which is
 * true of 2^53 + 1 as a double after it has ALREADY rounded down to 2^53.
 */
export function exactInt(big) {
    const num = Number(big);
    return Number.isSafeInteger(num) ? num : big.toString();
}
/**
 * Is this value an exact 64-bit token — a bare decimal integer carried as TEXT because a
 * double cannot hold it (parseExactNum, exactInt)?
 *
 * Every consumer that has to tell one apart from an ordinary string asks here, so the
 * readers, the McosParser value resolver and MatWriter's byte packer cannot disagree about
 * what counts as one.
 */
export function isExactToken(x) {
    return typeof x === 'string' && /^-?\d+$/.test(x);
}
/**
 * Does this MATLAB class need the exact reader?
 *
 * Only the 64-bit integers: every other class a dictionary carries is either narrower
 * than 2^53 (int8..uint32, logical, char codes) or a float, whose stored spelling IS a
 * double's and for which the text form would suppress the `.0` and `%.17g` handling the
 * float paths do on purpose.
 */
export function needsExactInt(type) {
    return type === 'int64' || type === 'uint64';
}
/**
 * One EDITED numeric token, narrowed to what its class can actually hold: the exact
 * decimal text for an int64/uint64, the double for everything else.
 *
 * The read paths know a token's class from the file, so they never need this. The edit
 * path does: MatlabValueParser is class-blind and hands back the exact text for any
 * integer a double cannot hold (defect 42), but only the two 64-bit classes can carry
 * one. Under any other class the double IS the value — MATLAB agrees, because a bare
 * decimal literal is a double there, so `x = 18446744073709551615` stores the nearest
 * double exactly as this does — and keeping the text instead wrote a JSON STRING into
 * the dictionary, which reads back as the CHAR '18446744073709551615'.
 *
 * Numbers pass through untouched, so this is safe to map over a whole element list.
 */
export function exactForClass(value, type) {
    if (!isExactToken(value)) {
        return value;
    }
    return needsExactInt(type) ? value : Number(value);
}
const range = (lo, hi) => ({ lo, hi, min: Number(lo), max: Number(hi) });
const INTEGER_RANGE = {
    int8: range(-128n, 127n),
    uint8: range(0n, 255n),
    int16: range(-32768n, 32767n),
    uint16: range(0n, 65535n),
    int32: range(-2147483648n, 2147483647n),
    uint32: range(0n, 4294967295n),
    int64: range(-9223372036854775808n, 9223372036854775807n),
    uint64: range(0n, 18446744073709551615n),
};
/** An integer saturated at range `r`, in exactInt's form: a number, or a 64-bit token. */
function saturate(big, r) {
    return exactInt(big < r.lo ? r.lo : big > r.hi ? r.hi : big);
}
/** Is this one of MATLAB's eight integer classes? */
export function isIntegerClass(type) {
    return typeof type === 'string' && Object.prototype.hasOwnProperty.call(INTEGER_RANGE, type);
}
/**
 * A number as MATLAB converts it to integer class `type`: rounded to the nearest integer, a
 * tie away from zero, then saturated at the class's range, with NaN as 0. So int16(70000)
 * is 32767, int16(-70000) is -32768, int8(2.5) is 3, int8(-2.5) is -3, uint8(-1) is 0 and
 * int16(NaN) is 0. The result is a number, or for an int64/uint64 the exact decimal text a
 * double cannot hold (exactInt): int64(2^60) is 1152921504606846976, which String() spells
 * 1152921504606847000, another int64. It is never -0, which no integer class holds:
 * int8(-0) is 0.
 *
 * An exact decimal token (isExactToken) is the integer it spells, saturated, in exactInt's
 * form. Anything else is read as Number() reads it. A value the class already holds comes
 * back as the same value: a number as it was given, and a token as it was given too, since
 * every token a reader makes is already in exactInt's form (parseExactNum, exactInt). So a
 * value MATLAB wrote is never respelled. The one token that is not is the `-0` a typed `-0`
 * is (parseExactNum, because String(-0) is '0'), which was returned as given, so `-0` typed
 * into an int8 was shown as `-0` and written as `"_value": "-0"`.
 *
 * The writers each converted their own way, and none of them MATLAB's: a MAT stream through
 * DataView, which wraps and truncates (int16 70000 went out as 4464, 3.7 as 3), the binary
 * dictionary's XML through Math.round, which takes a tie up and saturates nothing (-2.5 as
 * -2, 70000 as 70000), and an edit held the number as typed.
 */
export function toIntegerClass(value, type) {
    return convertTo(value, INTEGER_RANGE[type]);
}
/**
 * toIntegerClass for one class, its range looked up once: for a writer converting each of a
 * value's elements (MatWriter.numericPayload).
 */
export function integerConversion(type) {
    const r = INTEGER_RANGE[type];
    return (value) => convertTo(value, r);
}
function convertTo(value, r) {
    // A whole number the class holds, which is every number a file holds, with no BigInt
    // made for it. The bounds are exact as numbers for the 32-bit classes and the 64-bit
    // lower ones; a 64-bit upper bound rounds up, past every safe integer. -0 is 0.
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= r.min && value <= r.max) {
        return value === 0 ? 0 : value;
    }
    if (isExactToken(value)) {
        return saturate(BigInt(value), r);
    }
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(n)) {
        return 0;
    }
    if (n === Infinity || n === -Infinity) {
        return exactInt(n > 0 ? r.hi : r.lo);
    }
    // Math.round takes a tie up, and on the magnitude up is away from zero. Past 2^52 every
    // double is a whole number already, which BigInt reads exactly.
    return saturate(BigInt(n < 0 ? -Math.round(-n) : Math.round(n)), r);
}
/**
 * One EDITED numeric token, stored as its class holds it: under an integer class as MATLAB
 * converts it (toIntegerClass), under any other as exactForClass narrows it.
 */
export function valueForClass(value, type) {
    return isIntegerClass(type) ? toIntegerClass(value, type) : exactForClass(value, type);
}
/**
 * One complex element's text as integer class `type` holds it: each part converted on its
 * own (toIntegerClass). The text comes back as it was when neither part changes, so an
 * element MATLAB wrote keeps its spelling; otherwise it is the converted parts, spelled as
 * formatComplexNum spells them. Text that is not one element (parseComplexNum) comes back
 * as it was.
 *
 * A part changes when its conversion is not the same value by Object.is, under which -0 is
 * not 0: compared with ===, a part of -0 was unchanged, so `-0-0i` typed into an int16
 * element kept its text and was shown as `-0-0i`. Now it is `0+0i`.
 */
export function complexForIntegerClass(text, type) {
    const pair = parseComplexNum(text, type);
    if (!pair) {
        return text;
    }
    const re = toIntegerClass(pair.re, type);
    const im = toIntegerClass(pair.im, type);
    return Object.is(re, pair.re) && Object.is(im, pair.im) ? text : formatComplexNum(re, im);
}
export function formatDoubleXml(num) {
    // An exact 64-bit token reaches here only through formatNumLiteral's `double` arm,
    // which a 64-bit class never takes; the guard is here so the exact form can never
    // silently become NaN if a future caller routes one through.
    if (typeof num === 'string') {
        return num;
    }
    if (typeof num !== 'number') {
        return formatMatlabNum(num);
    }
    if (!isFinite(num)) {
        return formatMatlabNum(num);
    }
    // String(-0) is '0': a -0 is `-0.0`, as MATLAB writes it in a typed literal and reads it
    // back (see formatNumLiteral).
    const s = Object.is(num, -0) ? '-0' : String(num);
    if (!s.includes('.') && !s.includes('e') && !s.includes('E')) {
        return s + '.0';
    }
    return s;
}
/**
 * A double or a single as a binary dictionary's XML holds it: MATLAB's own spelling of the
 * number (floatDigits.matlabFloatText), `-0.0`, `1.0E-5`, `3.1415926535897931`, and for a
 * single the float32 the number is, `1.0E+6`, `3.14159274`. An infinity and a NaN are
 * MATLAB's words, and a single past a float32's range is the infinity single() makes it. Text
 * (the exact decimal of a 64-bit integer, see formatDoubleXml) is written as it is.
 *
 * formatDoubleXml, String() and a `.0`, wrote the same values in JavaScript's spelling:
 * `0.0` for -0, which MATLAB then read as +0 (C-062), `0.00001`, `3.141592653589793`, and a
 * single as the double it was widened to. The value MATLAB read was the same for every
 * other number, but the text was not MATLAB's, so each entry a save rebuilt came back with
 * numbers nobody edited respelled. A text dictionary's literal keeps formatDoubleXml
 * (formatNumLiteral): its spelling is another.
 */
export function formatFloatXml(num, cls) {
    if (typeof num === 'string') {
        return num;
    }
    if (typeof num !== 'number') {
        return formatMatlabNum(num);
    }
    const x = cls === 'single' ? Math.fround(num) : num;
    return isFinite(x) ? matlabFloatText(x, cls) : formatMatlabNum(x);
}
export function formatNumericXml(num, type) {
    // As MATLAB converts it to the class, the exact decimal text of a 64-bit one included,
    // which toIntegerClass keeps as it is when the class holds it. Math.round, which this
    // used, takes a tie up and saturates nothing: an int16 -2.5 went out as -2, and 70000
    // as 70000.
    if (isIntegerClass(type)) {
        return formatMatlabNum(toIntegerClass(num, type));
    }
    // Already MATLAB's own decimal text (see parseExactNum). Math.round below would put
    // it back through a double and undo the whole point of carrying it as text.
    if (typeof num === 'string' && /^-?\d+$/.test(num)) {
        return num;
    }
    if (type === 'double' || type === 'single') {
        return formatFloatXml(num, type);
    }
    return formatMatlabNum(Math.round(Number(num)));
}
// One number inside a typed `_value` literal, as MATLAB spells it there. The
// suffixes are MATLAB's own, read off its uncompressed-text dictionary: it writes a
// uint64 vector as '[18446744073709551615U, 1U, 0U]', a single as '3.14159274F', an
// int16 vector bare as '[1, 2, 3]', and a double with a forced '.0'. Dropping the
// suffix is not cosmetic — MATLAB reads a suffixless body back as double.
// `num` is `unknown` rather than `number` because an int64/uint64 element may be an
// exact decimal STRING (see parseExactNum). formatMatlabNum is String(), so the three
// integer arms below carry it through untouched; only the float arms convert, and no
// 64-bit token ever reaches them.
//
// A -0 keeps its sign: `-0F`, and `-0.0` for a double (formatDoubleXml). MATLAB's text
// writer spells single(-0) `-0.0F` and [-0;1] `Matrix(2,1)\n[-0.0, 1.0]`, and reads each
// back as -0, `-0F` and `[-0F, 1F]` too (R2027a, test/numbers/negzero.truth.json). String()
// spells -0 `0`, so a binary dictionary's single or column -0, held as this literal, lost its
// sign at the read. formatMatlabNum stays sign-blind: it is also the display, and MATLAB shows
// a -0 as 0. A BARE double, a JSON number, is written 0 by JSON.stringify, which is what
// MATLAB's own text writer gives a -0 there.
export function formatNumLiteral(num, type) {
    if (type === 'single') {
        return (Object.is(num, -0) ? '-0' : formatMatlabNum(num)) + 'F';
    }
    if (type === 'uint8' || type === 'uint16' || type === 'uint32' || type === 'uint64') {
        return formatMatlabNum(num) + 'U';
    }
    if (type === 'double') {
        return formatDoubleXml(num);
    }
    return formatMatlabNum(num);
}
// The `Matrix(d1,...,dn)` serial string, in the ONE spelling MATLAB can read back.
//
// This had two writers with two different bodies — the .sldd reader's own output
// here, and MatlabVariableNode._buildMatrixString on the write-back path — and
// Phase 6 widened both to rank 3 independently without noticing they disagreed at
// rank 2. Only this one is a spelling MATLAB accepts. Asked directly, by patching a
// single value string in a copy of MATLAB's own text cases.sldd and opening it with
// Simulink.data.dictionary.open (test/parity/matlab/probe_matrix_serial.m):
//
//   Matrix(2,3)\n[[1.0, 2.0, 3.0]; [4.0, 5.0, 6.0]]   -> double [2 3], values right
//   Matrix(2,3)\n[[1, 2, 3]; [4, 5, 6]]               -> double [2 3]  ('.0' optional)
//   Matrix(2,3)\n[1, 2, 3]\n[4, 5, 6]                 -> double [1 0]  ** EMPTY **
//   Matrix(3,1)\n[1.0, 2.0, 3.0]                      -> double [3 1]
//   Matrix(1,3)\n[1, 0, 1]   as logical               -> logical [1 3]
//   Matrix(2,3)\n[[1, 2, 3]; [4, 5, 6]] as int16      -> int16 [2 3]
//
// So the newline-joined form MATLAB rejects silently: every multi-row matrix edited
// in an uncompressed-text dictionary came back as a 1x0 empty. Bracketed groups
// joined with '; ' is the accepted form at every rank and class.
export function formatMatrixSerial(values, dims, type) {
    const rows = dims[0];
    const cols = dims[1];
    const header = 'Matrix(' + dims.join(',') + ')';
    // A vector is one flat bracketed list — MATLAB's own spelling for a 3x1 in its
    // text dictionary is 'Matrix(3,1)\n[1.0, 2.0, 3.0]', and it read the 1xN twin
    // 'Matrix(1,3)\n[1.0, 2.0, 3.0]' back as [1 3] in the probe. It also accepts the
    // grouped 'Matrix(1,3)\n[[1.0, 2.0, 3.0]]', but flat is the form MATLAB writes
    // itself, so a vector takes it at either orientation. Only at rank <= 2: an
    // Rx1xP still has pages to lay out.
    if ((cols === 1 || rows === 1) && dims.length <= 2) {
        const flat = '[' + values.map((v) => formatNumLiteral(v, type)).join(', ') + ']';
        // A rank-2 ROW vector carries NO header: MATLAB spells a 1xN typed array as the
        // bare `[1, 2, 3]` and keeps `Matrix(3,1)` for the column, which is the one
        // orientation the shape has to be stated for — a bare list read back is a row.
        // Its own typed_text.sldd says so six times over (i32Vec, sglVec, lglVec,
        // u64Vec2, sTyped's `a` and `d` fields, cTyped's first element), and cases.sldd's
        // nonFinVec agrees for a double.
        //
        // This was defect 21, recorded as cosmetic when 19 was fixed and left alone for
        // "one spelling for every typed array". That reading was wrong about our own
        // code: BinarySlddParser has ALWAYS written a row vector bare on the READ path
        // (formatTypedVector, guarded by the same `dims.length <= 2 && dims[0] === 1`),
        // so the codebase had two spellings already and the write path was the one that
        // disagreed with both MATLAB and its neighbour. Keeping the header cost a diff
        // on every save of the commonest typed shape there is. MATLAB reads either form
        // (probe_writeback's literal/i16Vec), so this is churn rather than loss — but
        // churn in a file people keep under source control.
        return rows === 1 ? flat : header + '\n' + flat;
    }
    // One bracketed group per row, pages in order — a rank-3 body is just its pages'
    // rows concatenated, which is what parseMatrixValue and DataNode._parseMatrixNums
    // consume. MATLAB has no inline spelling of its own past rank 2 (it writes a
    // cdata MAT stream), so the page layout is ours; the group form is MATLAB's.
    const rowStrs = [];
    const pages = Math.max(1, Math.floor(values.length / Math.max(1, rows * cols)));
    for (let p = 0; p < pages; p++) {
        const base = p * rows * cols;
        for (let r = 0; r < rows; r++) {
            const row = [];
            for (let c = 0; c < cols; c++) {
                row.push(formatNumLiteral(values[base + r * cols + c], type));
            }
            rowStrs.push('[' + row.join(', ') + ']');
        }
    }
    return header + '\n[' + rowStrs.join('; ') + ']';
}
// ---- char shape (defect 25) ----
//
// A char array is stored as ONE string, in MATLAB's own column-major order — that is
// what a .mat char payload carries (MatParser deliberately does not transpose it) and
// what the XML body of a `Class="char"` property carries. The three helpers below are
// the whole of what the four channels need to agree on, and they live here so no
// channel can invent its own answer:
//
//   text .sldd    a 1xN row is a bare JSON string; anything else is
//                 {"_type":"mxchar","_value":"Matrix(2,2)\n[[97, 98]; [99, 100]]"} —
//                 char CODES, one bracketed group per ROW.
//   binary/.slx   <P Class="char" Dimension="2*2">acbd</P>, column-major text; a row
//                 and the 0x0 empty char carry no Dimension at all, but for a row over 512
//                 characters in a binary dictionary (charRowDimension). Every other empty
//                 char, a 1x0 among them, carries its own (char_empty_binary.sldd).
//
// Both spellings are MATLAB's own, read off char_text.sldd and char_binary.sldd
// (test/parity/matlab/probe_char_shape.m wrote them).
/**
 * Does this char shape have to be STATED, or does the bare form already say it?
 *
 * A bare string read back is a 1xN char, so a rank-2 row needs neither the mxchar
 * envelope nor a Dimension — and MATLAB writes neither. Every other shape needs both,
 * including a 1x1xN, whose first extent is also 1: testing dims[0] alone would drop
 * the pages. The rule is the char twin of the row-vector rule in formatMatrixSerial.
 */
export function charNeedsShape(dims) {
    return !(dims.length <= 2 && dims[0] === 1);
}
/**
 * The longest 1xN char row MATLAB writes into a binary dictionary with no Dimension.
 *
 * Measured on R2027a (test/fixtures/make_char_rowdim.m, char_rowdim_binary.sldd): a row
 * of 512 has none, and one of 513 is `Class="char" Dimension="1*513"`. That holds at an
 * entry's Value, a cell element, a struct field, a Parameter's Description, a string's
 * element and an object's property. N counts MATLAB char elements (UTF-16 code units), not
 * bytes: `é` x512 has none, and 256 `&<` pairs, 2,560 bytes once escaped, have none. A
 * newline or a CRLF in the row changes nothing. MATLAB reads a row back the same either way,
 * so this is byte fidelity only.
 */
export const MATLAB_CHAR_ROW_DIM_THRESHOLD = 512;
/**
 * The Dimension MATLAB states on a char ROW written as text: `' Dimension="1*N"'` when
 * the row is longer than MATLAB_CHAR_ROW_DIM_THRESHOLD, and `''` otherwise. A shape that
 * is not a row is charNeedsShape's to state, and this says nothing of it. `text.length` is
 * the count of UTF-16 code units, which is what MATLAB counts.
 */
export function charRowDimension(text, dims) {
    return !charNeedsShape(dims) && text.length > MATLAB_CHAR_ROW_DIM_THRESHOLD ? ' Dimension="1*' + text.length + '"' : '';
}
/**
 * The char codes of a stored (column-major) string, in the row-major order the
 * `Matrix()` literal lays out — the same order parseMatrixValue and
 * DataNode._parseMatrixNums read back.
 *
 * charCodeAt per index rather than Array.from: MATLAB's char is a 16-bit code unit,
 * so a surrogate pair is TWO characters of a MATLAB char array, and iterating by code
 * point would silently halve its length.
 */
export function charCodesRowMajor(text, dims) {
    const codes = [];
    for (let i = 0; i < text.length; i++) {
        codes.push(text.charCodeAt(i));
    }
    return transposeFromColumnMajorND(codes, dims);
}
/** The inverse: row-major codes from an mxchar literal back to the stored string. */
export function charTextFromCodes(rowMajorCodes, dims) {
    return transposeToColumnMajorND(rowMajorCodes, dims)
        .map((c) => String.fromCharCode(c))
        .join('');
}
/**
 * MATLAB's `mxchar` literal for a char array of rank >= 2 that is not a row.
 *
 * The body is formatMatrixSerial's, so the bracketed-group spelling — the only one
 * MATLAB reads back (defect 19) — is stated in exactly one place. The header is forced
 * because a row must never reach here: bare, this literal WOULD read back as a row,
 * which is the whole reason charNeedsShape exists.
 */
export function formatMxCharSerial(text, dims) {
    const body = formatMatrixSerial(charCodesRowMajor(text, dims), dims, 'mxchar');
    return body.indexOf('Matrix(') === 0 ? body : 'Matrix(' + dims.join(',') + ')\n' + body;
}
// MATLAB's THIRD spelling of a char, in the binary flavour: its CODES. A char holding a code
// unit of this class MATLAB writes as `Format="decimal"`, with a Dimension whatever its shape
// and the body each UTF-16 code unit, in storage order, as a decimal number. Measured on every
// such value R2027a wrote into a binary dictionary we hold, ten in all: custom_object_binary.sldd's
// widget.Ctrl, and nine in two test dictionaries outside this repository.
//
//   char(1)                     Dimension="1*1" Format="decimal">1
//   char(65279), the BOM        Dimension="1*1" Format="decimal">65279
//   a surrogate pair            Dimension="1*2" Format="decimal">55348 56606
//   char([9 10 13 32:127])      Dimension="1*99" Format="decimal">9 10 13 32 … 127
//   char(reshape(1:24,2,3,4))   Dimension="2*3*4" Format="decimal">1 2 … 24
//
// A tab, a newline and a carriage return are NOT in the class: among text MATLAB writes them as
// text (the same fixture's widget.Tab and widget.Lf; a CR on its own, and CRs and LFs among
// letters, are text in the same dictionaries, a CR as `&#xD;`). So the class is the C0
// controls but those three, DEL (the only other character of char([9 10 13 32:127])), the
// surrogates, the BOM, and U+FFFE and U+FFFF, which XML 1.0 cannot carry at all. What MATLAB
// does with a C1 control (U+0080 to U+009F) is not measured, since no file holds one, so one
// is left as text, which XML can carry.
const WRITTEN_AS_CODES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uD800-\uDFFF\uFEFF\uFFFE\uFFFF]/;
/**
 * The attributes after `Class="char"` and the body, for a char MATLAB writes as its codes
 * (WRITTEN_AS_CODES above), whose stored text is `text` and whose extents are `dims`; null for
 * a char it writes as text. Written as text, such a char is either not XML at all (char(1))
 * or not the char MATLAB reads back.
 */
export function decimalCharXml(text, dims) {
    if (!WRITTEN_AS_CODES.test(text)) {
        return null;
    }
    const codes = [];
    for (let i = 0; i < text.length; i++) {
        codes.push(text.charCodeAt(i));
    }
    return { attrs: ' Dimension="' + dimensionText(dims) + '" Format="decimal"', body: codes.join(' ') };
}
/**
 * The stored text a `Format="decimal"` body spells, each whitespace-separated token one
 * UTF-16 code unit; null for a body that is not such a list (a token that is not digits, or
 * is past 65535), which a reader then keeps as the text it is rather than as NULs.
 */
export function charFromDecimal(body) {
    const tokens = body.trim().split(/\s+/);
    if (tokens.length === 1 && tokens[0] === '') {
        return '';
    }
    let text = '';
    for (const token of tokens) {
        if (!/^\d{1,5}$/.test(token) || Number(token) > 0xffff) {
            return null;
        }
        text += String.fromCharCode(Number(token));
    }
    return text;
}
// Every element of a complex literal, each part as MATLAB spells it under the float class
// `cls` (formatFloatXml): `1e-7+2e-8i` is `1.0E-7+2.0E-8i`, complex(1e6, -0) `1000000.0-0.0i`,
// and a NaN imaginary part `+NaNi`, signed (formatComplexBodyXml says why). MATLAB writes
// complex(1e-7, 2e-8) as `1.0E-7+2.0E-8i`, so an element typed in the inspector, which is
// stored as Number spells it, was written `1e-7+2e-8i` until each part was respelled.
//
// Text that is not an element (parseComplexNum), `2i`, keeps the form it had: a '.0' on each
// integral number. Match the WHOLE number rather than a trailing run of digits: the
// run-of-digits form appended '.0' to the EXPONENT, so '1e-7+2e-8i' was written as
// '1e-7.0+2e-8.0i', which is not a MATLAB literal at all. The leading-dot alternative comes
// first so '.5' is seen as one number instead of a bare '5' that would yield '.5.0'.
export function formatComplexXml(complexStr, cls = 'double') {
    return complexStr
        .split(/(\s+)/)
        .map((token, i) => {
        const pair = i % 2 === 0 && token !== '' ? parseComplexNum(token) : null;
        if (!pair) {
            return token.replace(/\.\d+(?:[eE][+-]?\d+)?|\d+\.?\d*(?:[eE][+-]?\d+)?/g, (num) => (/[.eE]/.test(num) ? num : num + '.0'));
        }
        const im = formatFloatXml(pair.im, cls);
        return formatFloatXml(pair.re, cls) + (im.startsWith('-') ? '' : '+') + im + 'i';
    })
        .join('');
}
/**
 * A complex value's body as a binary dictionary's `<P Class="…" IsComplex="1">` carries it,
 * for its class: a float class's parts each as MATLAB spells a number of it (formatComplexXml), an
 * integer class's parts as the integers they are. MATLAB writes `Class="int8"
 * IsComplex="1">3-4i` and `Class="int64" IsComplex="1">9223372036854775807+1i`, and the
 * `.0` form, `9223372036854775807.0+1.0i`, is not that value. An infinity is `Inf`, the
 * only word MATLAB writes for one, whichever text it came from (an element read out of
 * MAT bytes said `Infinity` through 1.40.0).
 *
 * And a NaN imaginary part is `+NaNi`, signed. Unsigned is how formatComplexNum spells
 * one, and how MATLAB itself writes complex(1, NaN) into a binary dictionary, `1.0NaNi` —
 * but MATLAB's reader (R2027a) takes that for the real 1 and reads every element after it
 * one place early, where it reads `1.0+NaNi` back as complex(1, NaN). Measured on
 * complex_binary.sldd's pNonFinite, [complex(Inf,-Inf) complex(NaN,1) complex(1,NaN)
 * complex(-Inf,2)], saved each way: MATLAB read `1.0NaNi` back as [Inf-Infi NaN+1i 1 NaN],
 * as it reads its own file, and `1.0+NaNi` as the value it is.
 *
 * An integer class's parts are the integers MATLAB converts them to (complexForIntegerClass),
 * so text a host hands over as `3.7+70000i` under int16 is written `4+32767i`. An element
 * the class already holds is written as it is.
 */
export function formatComplexBodyXml(text, className) {
    const body = text.trim().replace(/Infinity/g, 'Inf').replace(/([^\s+-])NaNi(?=\s|$)/g, '$1+NaNi');
    if (isIntegerClass(className)) {
        return body
            .split(/(\s+)/)
            .map((token, i) => (i % 2 === 0 && token !== '' ? complexForIntegerClass(token, className) : token))
            .join('');
    }
    return className === 'double' || className === 'single' ? formatComplexXml(body, className) : body;
}
export function transposeToColumnMajor(rowMajor, rows, cols) {
    if (rows <= 1) {
        return rowMajor;
    }
    const result = new Array(rowMajor.length);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            result[c * rows + r] = rowMajor[r * cols + c];
        }
    }
    return result;
}
// The N-D form: an array of rank >= 3 is a stack of rows x cols pages, each stored
// column-major in turn, so every page is transposed and the page order is untouched.
// The exact inverse of BinarySlddParser.transposeColumnMajor. The rank-2-only
// version above, handed a 2x3x2, filled only the first six slots of a
// twelve-element result and left the rest as holes — half a .slx-bound N-D array
// written out as empty text.
export function transposeToColumnMajorND(rowMajor, dims) {
    const rows = dims[0];
    const cols = dims[1];
    if (rows <= 1 || cols <= 1) {
        return rowMajor;
    }
    const page = rows * cols;
    const result = rowMajor.slice();
    for (let base = 0; base + page <= rowMajor.length; base += page) {
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                result[base + c * rows + r] = rowMajor[base + r * cols + c];
            }
        }
    }
    return result;
}
// The other direction: MATLAB's column-major storage order to the row-major-within-
// page order the display layer and the subscript helper both read. Generic over T
// because the complex path carries its elements as strings ('1+1i'), and the copy of
// this loop it used to carry was rank-2-only: handed a 2x3x2 it read six of the
// twelve values MATLAB wrote and the second page was gone on the next save.
export function transposeFromColumnMajorND(colMajor, dims) {
    const rows = dims[0];
    const cols = dims[1];
    if (rows <= 1 || cols <= 1) {
        return colMajor;
    }
    const page = rows * cols;
    const result = colMajor.slice();
    for (let base = 0; base + page <= colMajor.length; base += page) {
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                result[base + r * cols + c] = colMajor[base + c * rows + r];
            }
        }
    }
    return result;
}
export function pad(indent) {
    return '    '.repeat(indent);
}
// The current time as a raw MATLAB timestamp ('YYYYMMDDThhmmss.000000') — the one
// shape both .sldd serializers write and both parsers read. Sub-second precision is
// dropped rather than converted: MATLAB writes 6 fractional digits, we have 3, and a
// timestamp that claims microseconds it does not have is worse than a rounded one.
export function matlabTimestampNow() {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '.000000');
}
//# sourceMappingURL=XmlUtils.js.map