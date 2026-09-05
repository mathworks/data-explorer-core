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
import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { reasonOf } from './ParseWarning.js';
import { charNeedsShape, formatMatrixSerial, formatMxCharSerial, formatNumLiteral, needsExactInt, parseExactBody, parseMatlabNum, parseNumericBody, transposeFromColumnMajorND, SAVEOBJ_KEY, } from './XmlUtils.js';
const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    isArray: (name) => name === 'Object' || name === 'P' || name === 'Element',
    trimValues: false,
});
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
export function parseDims(dimension) {
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
export function parseBinarySldd(arrayBuffer, warnings) {
    const uint8 = new Uint8Array(arrayBuffer);
    const entries = unzipSync(uint8);
    const decoder = new TextDecoder();
    const dataXml = entries['data/chunk0.xml'];
    if (!dataXml) {
        throw new Error('Missing data/chunk0.xml in binary SLDD');
    }
    const xmlString = decoder.decode(dataXml);
    const zipMetadata = {};
    for (const [name, data] of Object.entries(entries)) {
        if (name !== 'data/chunk0.xml') {
            zipMetadata[name] = data;
        }
    }
    return parseBinarySlddParts(xmlString, zipMetadata, warnings);
}
// Build the model content from a live data/chunk0.xml string plus the pass-through
// zip parts, without a zip/unzip round-trip. Used by the writable binary editor to
// rebuild the model after each in-memory edit, and by the save gate to re-validate.
//
// `warnings` is the same optional sink `parseBinarySldd` takes and forwards here; this
// is where every dictionary warning about the bytes is actually raised.
export function parseBinarySlddParts(xmlString, zipMetadata, warnings) {
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
    //   - fast-xml-parser refuses the document outright for a few malformations (an
    //     unclosed CDATA is one), and that throw used to escape `parseBinarySldd` and take
    //     the whole open down, naming no file. A host with four dictionaries open could
    //     not tell which one it was.
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
    let doc = {};
    let refused = false;
    try {
        doc = xmlParser.parse(xmlString);
    }
    catch (err) {
        refused = true;
        warnings?.push({
            code: 'source-unreadable',
            message: `The dictionary part "data/chunk0.xml" could not be read (${reasonOf(err)}), `
                + 'so this dictionary reads as empty.',
        });
    }
    // One warning per loss, not two: a document the reader refused outright has already
    // been reported, and saying "and it has no <DataSource>" about it as well would report
    // the same lost dictionary twice.
    if (!refused && !Object.prototype.hasOwnProperty.call(doc, 'DataSource')) {
        warnings?.push({
            code: 'source-unreadable',
            message: 'The dictionary part "data/chunk0.xml" holds no <DataSource> element, '
                + 'so this dictionary reads as empty.',
        });
    }
    // Normalized rather than trusted: the key can be present carrying a string (a root
    // element with text in it, or one whose attributes did not parse), and the code below
    // reads attributes and children off it.
    const raw = doc.DataSource;
    const dataSource = (typeof raw === 'object' && raw !== null ? raw : {});
    const dataSourceAttrs = {
        FormatVersion: dataSource['@_FormatVersion'] || '1',
        MinRelease: dataSource['@_MinRelease'] || 'R2014a',
        Arch: dataSource['@_Arch'] || '',
    };
    const entryXmlFragments = extractEntryFragments(xmlString);
    const ddEntries = [];
    const objects = (dataSource.Object || []);
    let entryIdx = 0;
    for (const obj of objects) {
        const objClass = obj['@_Class'];
        if (objClass === 'DD.ENTRY') {
            ddEntries.push(parseEntry(obj, entryXmlFragments[entryIdx] || ''));
            entryIdx++;
        }
    }
    let allowAccessBWS = false;
    const dictionaryReferences = [];
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
            }
            else {
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
    return {
        __MW_TEXT_COREPROPERTIES__: { release },
        __MW_TEXT_PARTS__: {
            '__MW_TEXT_PART__/data/chunk0': {
                __MW_TEXT_content: {
                    entries: ddEntries,
                    'Dictionary References': dictionaryReferences,
                    AllowAccessBWS: allowAccessBWS,
                },
            },
        },
        __rawXml: xmlString,
        __zipMetadata: zipMetadata,
        __dataSourceAttrs: dataSourceAttrs,
    };
}
function extractEntryFragments(xmlString) {
    const fragments = [];
    const openTag = '<Object Class="DD.ENTRY">';
    const closeTag = '</Object>';
    let pos = 0;
    while (true) {
        const start = xmlString.indexOf(openTag, pos);
        if (start < 0) {
            break;
        }
        const end = xmlString.indexOf(closeTag, start);
        if (end < 0) {
            break;
        }
        fragments.push(xmlString.substring(start, end + closeTag.length));
        pos = end + closeTag.length;
    }
    return fragments;
}
function parseEntry(obj, rawXml) {
    const name = getProperty(obj, 'Name') || '';
    const uuid = getProperty(obj, 'UUID') || '';
    const namespace = getProperty(obj, 'Namespace') || '';
    const lastMod = getProperty(obj, 'LastMod') || '';
    const lastModBy = getProperty(obj, 'LastModBy') || '';
    const isDerived = getProperty(obj, 'IsDerived') || '0';
    const valueProp = getPropertyNode(obj, 'Value');
    let value = null;
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
function structValue(elements, dimParts) {
    const parsed = elements.map((e) => parseStructElement(e));
    return {
        _array_type: 'Struct',
        _dimensions: dimParts,
        _elements: parsed,
        _fields: parsed.length > 0 ? Object.keys(parsed[0]) : [],
        _mw_element_type: 'MATLABArray',
    };
}
// The SLDD Cell envelope. The dimension DEFAULT differs by caller (an entry value
// with no Dimension is 1x1; a nested cell is 1xN), so dims are the caller's to
// decide and only the envelope is shared.
function cellValue(elements, dimParts) {
    return {
        _array_type: 'Cell',
        _dimensions: dimParts,
        _elements: elements.map((e) => parseCellElement(e)),
        _mw_element_type: 'MATLABArray',
    };
}
// The SLDD object-array envelope. The class lives on the WRAPPER and is read from
// the first element, so a LATER element carrying no Class of its own still
// contributes its <P> bag: this path used to re-enter parseElement per element and
// index into the single-element wrapper it returns, which threw on a classless later
// element and took the whole file's read down with it.
//
// With no class at all there is no object array to describe — a classless <Element>
// is a struct element — and an empty _array_class is a shape NOTHING downstream
// accepts: it is falsy, so the node registry does not route it and the serializer
// writes `Class="char">[object Object]`, losing every field on the next save. So an
// unclassed element set decodes as the struct array it is.
function objectArrayValue(elements, dimParts) {
    const className = elements.length > 0 ? elements[0]['@_Class'] || '' : '';
    if (!className) {
        return structValue(elements, dimParts);
    }
    return {
        _array_class: className,
        _dimensions: dimParts,
        _mw_element_type: 'MATLABArray',
        _elements: elements.map((e) => ({ _properties: parseStructElement(e) })),
    };
}
function parseEntryValue(prop) {
    const className = prop['@_Class'] || null;
    const dimension = prop['@_Dimension'] || null;
    const elements = prop.Element;
    // Struct: Class="struct" with Element children (no Class on Element)
    if (className === 'struct') {
        return structValue(elements || [], dimension ? parseDims(dimension) : [1, 1]);
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
        return charValue(getTextContent(prop), dimension);
    }
    // Logical scalar (no dimension)
    if (className === 'logical' && !dimension) {
        const text = getTextContent(prop);
        return text === '1' || text === 'true';
    }
    // Numeric scalar or array
    const text = getTextContent(prop);
    if (prop['@_IsComplex'] === '1') {
        const result = { _type: 'cdata', _value: text };
        if (dimension) {
            result._dimensions = parseDims(dimension);
        }
        return result;
    }
    const type = className || 'double';
    if (dimension) {
        const dimParts = parseDims(dimension);
        const total = dimParts.reduce((a, b) => a * b, 1);
        if (total === 0) {
            return { _type: type, _emptyDims: dimParts };
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
function parseCellElement(el) {
    const elClass = el['@_Class'] || '';
    const dimension = el['@_Dimension'] || null;
    const text = getTextContent(el);
    if (isNumericClass(elClass)) {
        if (dimension) {
            const dimParts = parseDims(dimension);
            const total = dimParts.reduce((a, b) => a * b, 1);
            if (total === 0) {
                // Every extent, so an empty N-D cell element agrees with what
                // parseMatrixValue reads back.
                return { _type: elClass, _value: 'Matrix(' + dimParts.join(',') + ')' };
            }
            const parts = numericBody(text, elClass);
            const rowMajor = transposeColumnMajor(parts, dimParts);
            if (dimParts.length <= 2 && dimParts[0] === 1) {
                return formatTypedVector(rowMajor, elClass);
            }
            return formatMatrix(rowMajor, dimParts, elClass);
        }
        if (el['@_IsComplex'] === '1') {
            return { _type: 'cdata', _value: text };
        }
        return formatTypedScalar(text, elClass);
    }
    if (elClass === 'logical') {
        if (dimension) {
            const dimParts = parseDims(dimension);
            const total = dimParts.reduce((a, b) => a * b, 1);
            if (total === 0) {
                return { _type: 'logical', _value: '[]' };
            }
            return logicalValue(text, dimParts);
        }
        return text === '1' || text === 'true';
    }
    if (elClass === 'char') {
        return charValue(text, dimension);
    }
    if (elClass === 'struct') {
        return structValue(el.Element || [], [1, 1]);
    }
    if (elClass === 'cell') {
        const childElements = el.Element || [];
        return cellValue(childElements, dimension ? parseDims(dimension) : [1, childElements.length]);
    }
    // Nested object
    const childElements = el.Element;
    if (childElements && childElements.length > 0) {
        return parseElement(childElements[0]);
    }
    return text || '';
}
function parseStringValue(el, _outerDimension) {
    const props = el.P || [];
    const cellProp = props.find((p) => p['@_Source'] === 'saveobj');
    if (!cellProp) {
        return [''];
    }
    const cellDim = cellProp['@_Dimension'];
    const cellElements = cellProp.Element;
    if (!cellElements || cellElements.length === 0) {
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
export function transposeColumnMajor(values, dims) {
    return transposeFromColumnMajorND(values, dims);
}
function formatTypedScalar(text, type) {
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
function formatTypedVector(values, type) {
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
 */
function charValue(text, dimension) {
    if (!dimension) {
        return text || '';
    }
    const dimParts = parseDims(dimension);
    if (dimParts.reduce((a, b) => a * b, 1) === 0) {
        return '';
    }
    if (!charNeedsShape(dimParts)) {
        return text || '';
    }
    return { _type: 'mxchar', _value: formatMxCharSerial(text, dimParts) };
}
// The serial string every downstream reader consumes. The body itself is
// XmlUtils.formatMatrixSerial, shared with the node's write-back path: the two used
// to be separate copies that disagreed at rank 2, and only this one's spelling is
// one MATLAB reads back.
function formatMatrix(values, dims, type) {
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
function logicalValue(text, dimParts) {
    const rowMajor = transposeColumnMajor(text.trim().split(/\s+/), dimParts);
    // Same split as the numeric branch, for the same reason: only a true rank-2 row
    // vector may go out shapeless, because a bare bracketed list reads back as a row.
    if (dimParts.length <= 2 && dimParts[0] === 1) {
        return formatTypedVector(rowMajor, 'logical');
    }
    return formatMatrix(rowMajor, dimParts, 'logical');
}
function parsePropContent(prop) {
    const propClass = prop['@_Class'] || null;
    const dimension = prop['@_Dimension'] || null;
    const childElements = prop.Element;
    if (childElements && childElements.length > 0) {
        if (propClass === 'cell') {
            // A nested cell property (with or without a Dimension) serializes its
            // items as <Element> children — decode them like the top-level entry
            // path instead of treating each as a generic object with empty props.
            return cellValue(childElements, dimension ? parseDims(dimension) : [1, childElements.length]);
        }
        else if (dimension) {
            return parseArrayOfElements(childElements, dimension, propClass);
        }
        else if (propClass === 'struct') {
            return structValue(childElements, [1, 1]);
        }
        else if (childElements[0]['@_Class'] === 'string') {
            // A nested MATLAB string property serializes as <Element Class="string">
            // wrapping a saveobj cell of chars — decode it to its text like the
            // top-level entry path does, instead of treating it as a generic object
            // (which drops the value into a bogus "undefined" -> char envelope).
            return parseStringValue(childElements[0], dimension);
        }
        else if (childElements.length === 1) {
            return parseElement(childElements[0]);
        }
        // Several objects with no declared shape. MATLAB never writes this (every
        // multi-element <P> in a real dictionary carries a Dimension), but the reader
        // has to choose SOMETHING, and it must be a shape the save path can write:
        // this used to be a bare JS array of per-element wrappers, which the serializer
        // could only spell `Class="double">[object Object] [object Object]` — every
        // property of every element gone from the file. Nx1 matches the entry-level
        // path's default for the same undimensioned case.
        return objectArrayValue(childElements, [childElements.length, 1]);
    }
    else {
        const text = getTextContent(prop);
        return parseTypedValue(text, propClass, dimension);
    }
}
function parseElement(el) {
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
        _elements: [{ _properties: parseStructElement(el) }],
    };
}
// The <P> children of one <Element>, as a plain name → value bag. Serves both the
// bare struct element (no Class attribute) and the property bag of a classed
// object element, so an object array's elements and a scalar object's decode
// through exactly the same path — they used to have separate copies, and the
// array copy passed a flag that skipped struct decoding, writing a struct-valued
// property back as `Class="char">[object Object]`.
function parseStructElement(el) {
    const result = {};
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
        // as child elements, so it never reaches the generic content decoder.
        if (!prop.Element?.length && prop['@_IsComplex'] === '1') {
            const dimension = prop['@_Dimension'] || null;
            const cdata = { _type: 'cdata', _value: getTextContent(prop) };
            if (dimension) {
                cdata._dimensions = parseDims(dimension);
            }
            result[prop['@_Name']] = cdata;
        }
        else {
            result[prop['@_Name']] = parsePropContent(prop);
        }
    }
    return result;
}
function parseArrayOfElements(elements, dimension, propClass) {
    const dimParts = parseDims(dimension);
    return propClass === 'struct' ? structValue(elements, dimParts) : objectArrayValue(elements, dimParts);
}
function parseTypedValue(text, className, dimension) {
    if (!className) {
        return text;
    }
    if (dimension) {
        const dimParts = parseDims(dimension);
        const total = dimParts.reduce((a, b) => a * b, 1);
        if (total === 0) {
            if (isNumericClass(className)) {
                return [];
            }
            return '';
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
            return parseMatlabNum(text);
        case 'single':
        case 'int32':
        case 'uint32':
        case 'int16':
        case 'uint16':
        case 'int8':
        case 'uint8':
        // int64/uint64 belong here and not in the `default` arm: the default returns the
        // bare body text, which the writer can only spell `Class="char"`. The value itself
        // survived — a 64-bit scalar's stored text IS its exact decimal — so this half of
        // defect 27 lost the CLASS rather than the digits.
        case 'int64':
        case 'uint64':
            return formatTypedScalar(text, className);
        case 'logical':
            return text === '1' || text === 'true';
        case 'char':
            // The property twin of the entry-value and cell-element arms: a `Class="char"
            // Dimension="2*2"` PROPERTY (a struct field, an object property) states its
            // shape too, and the numeric branch above never claimed it.
            return charValue(text, dimension);
        default:
            return text || '';
    }
}
// int64 and uint64 were missing from this list AND from parseCellElement's copy of it,
// which is what made a 64-bit struct FIELD come back as text: parseTypedValue fell
// through the numeric branch to the `default: return text`, so sTyped's uint64 [7 8]
// decoded as the string '7 8' and the writer, seeing a bare string, wrote
// `<P Name="d" Class="char">7 8</P>` — MATLAB reopened the field as a 1x3 char (defect
// 27). The entry-level path never had the gap, so the same value was right at the top
// level and wrong one level down.
function isNumericClass(className) {
    return (className === 'double' ||
        className === 'single' ||
        className === 'int32' ||
        className === 'uint32' ||
        className === 'int16' ||
        className === 'uint16' ||
        className === 'int8' ||
        className === 'uint8' ||
        className === 'int64' ||
        className === 'uint64');
}
// One numeric body, as the CLASS requires: exact decimal text for the tokens a 64-bit
// integer cannot round-trip through a double, plain numbers for everything else. The
// three call sites below (entry value, cell element, property) each used to call
// parseNumericBody directly, so a 64-bit value was rounded before any writer saw it.
function numericBody(text, type) {
    return needsExactInt(type) ? parseExactBody(text) : parseNumericBody(text);
}
function getTextContent(node) {
    if (node['#text'] !== undefined) {
        return String(node['#text']);
    }
    return '';
}
function getProperty(obj, name) {
    const props = obj.P || [];
    for (const p of props) {
        if (p['@_Name'] === name) {
            return getTextContent(p);
        }
    }
    return null;
}
function getPropertyNode(obj, name) {
    const props = obj.P || [];
    for (const p of props) {
        if (p['@_Name'] === name) {
            return p;
        }
    }
    return null;
}
function formatDate(matlabDate) {
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
//# sourceMappingURL=BinarySlddParser.js.map