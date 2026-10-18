/**
 * Text or an attribute value, as XML has to carry it.
 *
 * A carriage return is written as `&#xD;`, because XML 1.0 §2.11 has every reader present a raw
 * CR as a LF: written as itself, it would be read back as a different char. That is why MATLAB
 * writes `&#xD;` for each CR inside a char, and the dictionary reader decodes the reference to a
 * CR (XmlReader), so a CR read from a dictionary goes back out as the reference it came in as.
 * A tab and a LF need no reference in text and get none, as MATLAB writes them.
 */
export declare function escapeXml(str: string): string;
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
export declare const SAVEOBJ_KEY = "_saveobj";
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
export declare const CUSTOM_SAVE_KEY = "_custom_save";
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
export declare const ENUM_KEY = "_is_enum";
export declare const ENUMERATION_KEY = "_enumeration";
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
export declare const PROPERTY_SOURCE_KEY = "_property_source";
/** The `Source` and `PropertyType` of one property, each as MATLAB wrote it where it wrote one. */
export interface PropertySource {
    source?: string;
    propertyType?: string;
}
/** The PROPERTY_SOURCE_KEY record of `element`, one of an object's `_elements`, or null. */
export declare function propertySourcesOf(element: unknown): Record<string, PropertySource> | null;
/**
 * Where a classed or shaped empty says it was read out of a binary dictionary.
 *
 * The binary reader holds one as its class under the bare header of its extents, `{_type:
 * 'int8', _value: 'Matrix(0,3)'}` (BinarySlddParser.emptyOf), and a shaped empty char as the
 * shaped char's literal with no character in it, `{_type: 'mxchar', _value: 'Matrix(0,2)\n[]'}`
 * (BinarySlddParser.charValue). A text dictionary can hold the same spelling, and reads it as
 * the same value. What a text dictionary is given for a binary dictionary's empty is held to
 * what it was given before, until MATLAB reads one back (MatWriter.heldTextSpelling); an empty
 * the text dictionary holds itself is its own, and is written as it holds it, however often it
 * is copied, pasted or re-read. The spelling cannot tell the two apart, and a copy keeps no
 * identity, so the binary reader says which it is, under this key, as it says a value is an
 * enumeration value (ENUM_KEY). The key is this reader's, not the text format's: a text
 * dictionary is written without it (MatWriter.textDictionaryForm), and every other reader and
 * writer here passes it by.
 */
export declare const BINARY_EMPTY_KEY = "_binary_empty";
/**
 * The extents of `text` when it is the bare `Matrix(…)` header of an empty, a 0 among them and
 * no body (`Matrix(0,3)`), the form the binary reader holds a classed or shaped empty in
 * (BinarySlddParser.emptyOf); null for any other text. Trailing singletons past the second are
 * dropped, as MATLAB's size() drops them.
 */
export declare function emptyHeaderDims(text: unknown): number[] | null;
/** One enumeral as MATLAB wrote it: `EnumerationName`, `EnumerationType`, and the element's text. */
export interface Enumeral {
    name?: string;
    type?: string;
    value: string;
}
/** Whether `value` is an enumeration value as a binary dictionary's reader holds one (see ENUM_KEY). */
export declare function isEnumBag(value: unknown): boolean;
/**
 * The `_enum_value` of `value` when `value` is an enumeration value as a text dictionary spells
 * one, or undefined. MATLAB writes the whole value as one element holding the numbers its
 * enumerals stand for, in a bag that is 1x1 whatever the value's size (MatWriter.enumTextForm),
 * and at an object's property the element alone, `{_enum_value, _id, _object_class}`. The binary
 * reader's own form (isEnumBag) is not this one.
 */
export declare function textEnumValueOf(value: unknown): unknown;
/** The enumeral `element`, one of an enumeration value's `_elements`, holds, or null. */
export declare function enumeralOf(element: unknown): Enumeral | null;
export declare function formatMatlabNum(num: unknown): string;
export declare function formatComplexNum(re: unknown, im: unknown): string;
/**
 * formatComplexNum's inverse: one complex element's text back into its two parts, or null
 * for text that is not one. It reads every spelling this package holds an element in —
 * its own (`3+4i`, `1NaNi`, `-Inf+2i`), a binary dictionary's (`3.0+4.0i`,
 * `1.0E-20+2.0E+21i`), a plain .mat variable's (`1+Infinityi`) — so the writers can
 * rebuild the value from any of them. Under a 64-bit integer class a part keeps its
 * exact decimal text (parseExactNum), as every other read of such a value does.
 *
 * The NaN and Inf parts are why this exists. The pattern the writers used before,
 * `^([-\d.eE+]+)([+-][\d.eE+]+)i$`, matched neither, and the element it did not match
 * was written as 0+0i.
 */
export declare function parseComplexNum(text: string, type?: string): {
    re: number | string;
    im: number | string;
} | null;
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
export declare function complexClassTag(className: unknown): string | undefined;
export declare function parseMatlabNum(text: string): number;
export declare function parseNumericBody(text: string): number[];
/**
 * One numeric token, EXACT: a number where a double is lossless, the canonical decimal
 * TEXT where it is not.
 *
 * The test is the round trip, not the class. Every value a double does hold stays a
 * number, so no existing path changes behaviour and only the tokens that were actually
 * being corrupted take the new representation. `+7` and `007` canonicalize to `7`, so a
 * cosmetic difference in the stored spelling never on its own forces the text form.
 */
export declare function parseExactNum(text: string): number | string;
/** parseNumericBody's exact twin: a whitespace-separated body, token by token. */
export declare function parseExactBody(text: string): (number | string)[];
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
export declare function exactInt(big: bigint): number | string;
/**
 * Is this value an exact 64-bit token — a bare decimal integer carried as TEXT because a
 * double cannot hold it (parseExactNum, exactInt)?
 *
 * Every consumer that has to tell one apart from an ordinary string asks here, so the
 * readers, the McosParser value resolver and MatWriter's byte packer cannot disagree about
 * what counts as one.
 */
export declare function isExactToken(x: unknown): x is string;
/**
 * Does this MATLAB class need the exact reader?
 *
 * Only the 64-bit integers: every other class a dictionary carries is either narrower
 * than 2^53 (int8..uint32, logical, char codes) or a float, whose stored spelling IS a
 * double's and for which the text form would suppress the `.0` and `%.17g` handling the
 * float paths do on purpose.
 */
export declare function needsExactInt(type: string | null | undefined): boolean;
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
export declare function exactForClass(value: unknown, type: string | null | undefined): unknown;
/** Is this one of MATLAB's eight integer classes? */
export declare function isIntegerClass(type: string | null | undefined): type is string;
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
export declare function toIntegerClass(value: unknown, type: string): number | string;
/**
 * toIntegerClass for one class, its range looked up once: for a writer converting each of a
 * value's elements (MatWriter.numericPayload).
 */
export declare function integerConversion(type: string): (value: unknown) => number | string;
/**
 * One EDITED numeric token, stored as its class holds it: under an integer class as MATLAB
 * converts it (toIntegerClass), under any other as exactForClass narrows it.
 */
export declare function valueForClass(value: unknown, type: string | null | undefined): unknown;
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
export declare function complexForIntegerClass(text: string, type: string): string;
export declare function formatDoubleXml(num: unknown): string;
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
export declare function formatFloatXml(num: unknown, cls: 'double' | 'single'): string;
export declare function formatNumericXml(num: unknown, type: string): string;
export declare function formatNumLiteral(num: unknown, type: string): string;
export declare function formatMatrixSerial(values: unknown[], dims: number[], type: string): string;
/**
 * Does this char shape have to be STATED, or does the bare form already say it?
 *
 * A bare string read back is a 1xN char, so a rank-2 row needs neither the mxchar
 * envelope nor a Dimension — and MATLAB writes neither. Every other shape needs both,
 * including a 1x1xN, whose first extent is also 1: testing dims[0] alone would drop
 * the pages. The rule is the char twin of the row-vector rule in formatMatrixSerial.
 */
export declare function charNeedsShape(dims: number[]): boolean;
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
export declare const MATLAB_CHAR_ROW_DIM_THRESHOLD = 512;
/**
 * The Dimension MATLAB states on a char ROW written as text: `' Dimension="1*N"'` when
 * the row is longer than MATLAB_CHAR_ROW_DIM_THRESHOLD, and `''` otherwise. A shape that
 * is not a row is charNeedsShape's to state, and this says nothing of it. `text.length` is
 * the count of UTF-16 code units, which is what MATLAB counts.
 */
export declare function charRowDimension(text: string, dims: number[]): string;
/**
 * The char codes of a stored (column-major) string, in the row-major order the
 * `Matrix()` literal lays out — the same order parseMatrixValue and
 * DataNode._parseMatrixNums read back.
 *
 * charCodeAt per index rather than Array.from: MATLAB's char is a 16-bit code unit,
 * so a surrogate pair is TWO characters of a MATLAB char array, and iterating by code
 * point would silently halve its length.
 */
export declare function charCodesRowMajor(text: string, dims: number[]): number[];
/** The inverse: row-major codes from an mxchar literal back to the stored string. */
export declare function charTextFromCodes(rowMajorCodes: number[], dims: number[]): string;
/**
 * MATLAB's `mxchar` literal for a char array of rank >= 2 that is not a row.
 *
 * The body is formatMatrixSerial's, so the bracketed-group spelling — the only one
 * MATLAB reads back (defect 19) — is stated in exactly one place. The header is forced
 * because a row must never reach here: bare, this literal WOULD read back as a row,
 * which is the whole reason charNeedsShape exists.
 */
export declare function formatMxCharSerial(text: string, dims: number[]): string;
/**
 * The attributes after `Class="char"` and the body, for a char MATLAB writes as its codes
 * (WRITTEN_AS_CODES above), whose stored text is `text` and whose extents are `dims`; null for
 * a char it writes as text. Written as text, such a char is either not XML at all (char(1))
 * or not the char MATLAB reads back.
 */
export declare function decimalCharXml(text: string, dims: number[]): {
    attrs: string;
    body: string;
} | null;
/**
 * The stored text a `Format="decimal"` body spells, each whitespace-separated token one
 * UTF-16 code unit; null for a body that is not such a list (a token that is not digits, or
 * is past 65535), which a reader then keeps as the text it is rather than as NULs.
 */
export declare function charFromDecimal(body: string): string | null;
export declare function formatComplexXml(complexStr: string, cls?: 'double' | 'single'): string;
/**
 * A complex value's body as a binary dictionary's `<P Class="…" IsComplex="1">` carries it,
 * for its class: a float class's parts each as MATLAB spells a number of it (formatComplexXml), an
 * integer class's parts as the integers they are. MATLAB writes `Class="int8"
 * IsComplex="1">3-4i` and `Class="int64" IsComplex="1">9223372036854775807+1i`, and the
 * `.0` form, `9223372036854775807.0+1.0i`, is not that value. An infinity is `Inf`, the
 * only word MATLAB writes for one, whichever reader's text it came from (a plain .mat
 * variable's element says `Infinity`).
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
export declare function formatComplexBodyXml(text: string, className: string): string;
export declare function transposeToColumnMajor<T>(rowMajor: T[], rows: number, cols: number): T[];
export declare function transposeToColumnMajorND<T>(rowMajor: T[], dims: number[]): T[];
export declare function transposeFromColumnMajorND<T>(colMajor: T[], dims: number[]): T[];
export declare function pad(indent: number): string;
export declare function matlabTimestampNow(): string;
//# sourceMappingURL=XmlUtils.d.ts.map