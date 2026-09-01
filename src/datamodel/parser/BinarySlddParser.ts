// Copyright 2026 The MathWorks, Inc.

import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { formatDoubleXml, formatMatlabNum, parseMatlabNum } from './XmlUtils.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name: string) => name === 'Object' || name === 'P' || name === 'Element',
  trimValues: false,
});

interface XmlNode {
  '@_Class'?: string;
  '@_Name'?: string;
  '@_Dimension'?: string;
  '@_IsComplex'?: string;
  '@_Source'?: string;
  '@_FormatVersion'?: string;
  '@_MinRelease'?: string;
  '@_Arch'?: string;
  '#text'?: string | number;
  P?: XmlNode[];
  Element?: XmlNode[];
  Object?: XmlNode[];
}

/**
 * Read a `Dimension="R*C"` attribute into exactly two dimensions.
 *
 * Every shape this parser can represent downstream is 2-D: a numeric array becomes
 * the `Matrix(rows,cols)` serial string, which is the same form the text .sldd uses
 * and the only one the save path (DataNode._serializeTypedPropertyXml) and the row
 * builders read back. So the two off-nominal extent counts have to be folded into
 * that here — and every caller has to fold them the SAME way. They used to each
 * `split('*')` for themselves, and both cases went wrong:
 *
 *   - Fewer than two extents (`Dimension="3"`) left `cols` undefined, so the value
 *     formatted as `Matrix(3,undefined)` with an EMPTY body — every element
 *     dropped on load, and re-saved as the scalar 0.
 *   - More than two (`Dimension="2*2*2"`, e.g. a 3-D lookup-table breakpoint set)
 *     read only rows*cols elements, so a 2x2x2 displayed as a 2x2 holding just the
 *     first page and re-saved with six of its eight values gone.
 *
 * Collapsing the trailing extents into the column count keeps every element in
 * order: the data is column-major, so this is exactly MATLAB's own
 * `reshape(A, R, [])`. The page structure is not preserved — a 2x2x2 reads as 2x4 —
 * but nothing is lost, which the previous behaviour could not say.
 */
function parseDims(dimension: string): number[] {
  const parts = dimension.split('*').map(Number);
  if (parts.length === 2) {
    return parts;
  }
  if (parts.length < 2) {
    // A lone extent N describes a row vector of N; an unparseable one, a scalar.
    return Number.isFinite(parts[0]) ? [1, parts[0]] : [1, 1];
  }
  return [parts[0], parts.slice(1).reduce((a, b) => a * b, 1)];
}

export function parseBinarySldd(arrayBuffer: ArrayBuffer): Record<string, unknown> {
  const uint8 = new Uint8Array(arrayBuffer);
  const entries = unzipSync(uint8);
  const decoder = new TextDecoder();

  const dataXml = entries['data/chunk0.xml'];
  if (!dataXml) {
    throw new Error('Missing data/chunk0.xml in binary SLDD');
  }
  const xmlString = decoder.decode(dataXml);

  const zipMetadata: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(entries)) {
    if (name !== 'data/chunk0.xml') {
      zipMetadata[name] = data;
    }
  }

  return parseBinarySlddParts(xmlString, zipMetadata);
}

// Build the model content from a live data/chunk0.xml string plus the pass-through
// zip parts, without a zip/unzip round-trip. Used by the writable binary editor to
// rebuild the model after each in-memory edit, and by the save gate to re-validate.
export function parseBinarySlddParts(
  xmlString: string,
  zipMetadata: Record<string, Uint8Array>,
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

  const doc = xmlParser.parse(xmlString);
  const dataSource = doc.DataSource as XmlNode;
  const dataSourceAttrs = {
    FormatVersion: dataSource['@_FormatVersion'] || '1',
    MinRelease: dataSource['@_MinRelease'] || 'R2014a',
    Arch: dataSource['@_Arch'] || '',
  };

  const entryXmlFragments = extractEntryFragments(xmlString);
  const ddEntries: Record<string, unknown>[] = [];
  const objects = (dataSource.Object || []) as XmlNode[];

  let entryIdx = 0;
  for (const obj of objects) {
    const objClass = obj['@_Class'];
    if (objClass === 'DD.ENTRY') {
      ddEntries.push(parseEntry(obj, entryXmlFragments[entryIdx] || ''));
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

function extractEntryFragments(xmlString: string): string[] {
  const fragments: string[] = [];
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
function structValue(elements: XmlNode[], dimParts: number[]): Record<string, unknown> {
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
function cellValue(elements: XmlNode[], dimParts: number[]): Record<string, unknown> {
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
function objectArrayValue(elements: XmlNode[], dimParts: number[]): Record<string, unknown> {
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

function parseEntryValue(prop: XmlNode): unknown {
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

  // Char scalar (no elements, Class="char")
  if (className === 'char') {
    return getTextContent(prop) || '';
  }

  // Logical scalar (no dimension)
  if (className === 'logical' && !dimension) {
    const text = getTextContent(prop);
    return text === '1' || text === 'true';
  }

  // Numeric scalar or array
  const text = getTextContent(prop);
  if (prop['@_IsComplex'] === '1') {
    const result: Record<string, unknown> = { _type: 'cdata', _value: text };
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
    // Logical vector
    if (type === 'logical') {
      const parts = text.trim().split(/\s+/);
      return { _type: 'logical', _value: '[' + parts.join(', ') + ']' };
    }
    const parts = text.trim().split(/\s+/).map(Number);
    // Column-major to row-major transpose
    const rowMajor = transposeColumnMajor(parts, dimParts);
    // Row vector (1*N)
    if (dimParts[0] === 1) {
      return formatTypedVector(rowMajor, type);
    }
    // Column or matrix
    return formatMatrix(rowMajor, dimParts, type);
  }

  return formatTypedScalar(text, type);
}

function parseCellElement(el: XmlNode): unknown {
  const elClass = el['@_Class'] || '';
  const dimension = el['@_Dimension'] || null;
  const text = getTextContent(el);

  if (
    elClass === 'double' ||
    elClass === 'single' ||
    elClass === 'int32' ||
    elClass === 'uint32' ||
    elClass === 'int16' ||
    elClass === 'uint16' ||
    elClass === 'int8' ||
    elClass === 'uint8'
  ) {
    if (dimension) {
      const dimParts = parseDims(dimension);
      const total = dimParts.reduce((a, b) => a * b, 1);
      if (total === 0) {
        return { _type: elClass, _value: 'Matrix(' + dimParts[0] + ',' + dimParts[1] + ')' };
      }
      const parts = text.trim().split(/\s+/).map(Number);
      const rowMajor = transposeColumnMajor(parts, dimParts);
      if (dimParts[0] === 1) {
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
      const parts = text.trim().split(/\s+/);
      return { _type: 'logical', _value: '[' + parts.join(', ') + ']' };
    }
    return text === '1' || text === 'true';
  }
  if (elClass === 'char') {
    return text || '';
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

function parseStringValue(el: XmlNode, _outerDimension: string | null): unknown {
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

function transposeColumnMajor(values: number[], dims: number[]): number[] {
  const rows = dims[0];
  const cols = dims[1];
  if (rows <= 1) {
    return values;
  }
  const result = new Array(values.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      result[r * cols + c] = values[c * rows + r];
    }
  }
  return result;
}

function formatTypedScalar(text: string, type: string): unknown {
  if (type === 'double') {
    return parseMatlabNum(text);
  }
  const num = parseMatlabNum(text);
  if (type === 'single') {
    return { _type: 'single', _value: formatNumLiteral(num, 'single') };
  }
  if (type === 'uint8' || type === 'uint16' || type === 'uint32') {
    return { _type: type, _value: formatNumLiteral(parseInt(text, 10), type) };
  }
  return { _type: type, _value: text };
}

function formatTypedVector(values: number[], type: string): unknown {
  if (type === 'double') {
    return values;
  }
  const formatted = values.map((v) => formatNumLiteral(v, type));
  return { _type: type, _value: '[' + formatted.join(', ') + ']' };
}

function formatNumLiteral(num: number, type: string): string {
  if (type === 'single') {
    return formatMatlabNum(num) + 'F';
  }
  if (type === 'uint8' || type === 'uint16' || type === 'uint32') {
    return formatMatlabNum(num) + 'U';
  }
  if (type === 'double') {
    return formatDoubleXml(num);
  }
  return formatMatlabNum(num);
}

function formatMatrix(values: number[], dims: number[], type: string): unknown {
  const rows = dims[0];
  const cols = dims[1];
  type = type || 'double';
  // Column vector: single bracketed list
  if (cols === 1) {
    const formatted = values.map((v) => formatNumLiteral(v, type));
    return { _type: type, _value: 'Matrix(' + rows + ',' + cols + ')\n[' + formatted.join(', ') + ']' };
  }
  const rowStrs: string[] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(formatNumLiteral(values[r * cols + c], type));
    }
    rowStrs.push('[' + row.join(', ') + ']');
  }
  return {
    _type: type,
    _value: 'Matrix(' + rows + ',' + cols + ')\n[' + rowStrs.join('; ') + ']',
  };
}

function parsePropContent(prop: XmlNode): unknown {
  const propClass = prop['@_Class'] || null;
  const dimension = prop['@_Dimension'] || null;
  const childElements = prop.Element;

  if (childElements && childElements.length > 0) {
    if (propClass === 'cell') {
      // A nested cell property (with or without a Dimension) serializes its
      // items as <Element> children — decode them like the top-level entry
      // path instead of treating each as a generic object with empty props.
      return cellValue(childElements, dimension ? parseDims(dimension) : [1, childElements.length]);
    } else if (dimension) {
      return parseArrayOfElements(childElements, dimension, propClass);
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
    return objectArrayValue(childElements, [childElements.length, 1]);
  } else {
    const text = getTextContent(prop);
    return parseTypedValue(text, propClass, dimension);
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
    _elements: [{ _properties: parseStructElement(el) }],
  };
}

// The <P> children of one <Element>, as a plain name → value bag. Serves both the
// bare struct element (no Class attribute) and the property bag of a classed
// object element, so an object array's elements and a scalar object's decode
// through exactly the same path — they used to have separate copies, and the
// array copy passed a flag that skipped struct decoding, writing a struct-valued
// property back as `Class="char">[object Object]`.
function parseStructElement(el: XmlNode): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const prop of el.P || []) {
    // A complex scalar carries its value as text with IsComplex="1" rather than
    // as child elements, so it never reaches the generic content decoder.
    if (!prop.Element?.length && prop['@_IsComplex'] === '1') {
      const dimension = prop['@_Dimension'] || null;
      const cdata: Record<string, unknown> = { _type: 'cdata', _value: getTextContent(prop) };
      if (dimension) {
        cdata._dimensions = parseDims(dimension);
      }
      result[prop['@_Name']!] = cdata;
    } else {
      result[prop['@_Name']!] = parsePropContent(prop);
    }
  }
  return result;
}

function parseArrayOfElements(
  elements: XmlNode[],
  dimension: string,
  propClass: string | null,
): Record<string, unknown> {
  const dimParts = parseDims(dimension);
  return propClass === 'struct' ? structValue(elements, dimParts) : objectArrayValue(elements, dimParts);
}

function parseTypedValue(text: string, className: string | null, dimension: string | null): unknown {
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
      const parts = text.trim().split(/\s+/);
      return { _type: 'logical', _value: '[' + parts.join(', ') + ']' };
    }

    if (isNumericClass(className)) {
      const parts = text.trim().split(/\s+/).map(parseMatlabNum);
      const rowMajor = transposeColumnMajor(parts, dimParts);
      if (dimParts[0] === 1) {
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
      return formatTypedScalar(text, className);
    case 'logical':
      return text === '1' || text === 'true';
    case 'char':
      return text || '';
    default:
      return text || '';
  }
}

function isNumericClass(className: string): boolean {
  return (
    className === 'double' ||
    className === 'single' ||
    className === 'int32' ||
    className === 'uint32' ||
    className === 'int16' ||
    className === 'uint16' ||
    className === 'int8' ||
    className === 'uint8'
  );
}

function getTextContent(node: XmlNode): string {
  if (node['#text'] !== undefined) {
    return String(node['#text']);
  }
  return '';
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
