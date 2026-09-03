// Copyright 2026 The MathWorks, Inc.

import DataNode from '../DataNode.js';
import type { SetPropertyResult } from '../DataNode.js';
import { matlabVariableKind } from '../../kindMap.js';
import type { PropClass, MatlabVariableKind } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import { addChildUndoable, removeChildUndoable } from '../childEdit.js';
import type { ChildAddEdit, ChildUndoRedo } from '../childEdit.js';
import * as NodeRegistry from '../NodeRegistry.js';
import PropName from '../../prop/PropName.js';
import PropValue from '../../prop/PropValue.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
import PropKind from '../../prop/PropKind.js';
import PropClassAtom from '../../prop/PropClass.js';
import MatlabValueParser, { formatMatlabChar, formatMatlabString } from '../../parser/MatlabValueParser.js';
import { NOT_AVAILABLE } from '../../parser/McosParser.js';
import { parseMatrix, type MatVariable } from '../../parser/MatParser.js';
import { uudecode } from '../../parser/CdataCodec.js';
import { encodeCdata } from '../../parser/MatWriter.js';
import {
  EMPTY_CELL,
  EMPTY_NUMERIC,
  MISSING_STRING,
  effectiveDims,
  elementCount,
  needsSummary,
  overCharBudget,
  summaryForm,
} from '../../display/DisplayConvention.js';
import { subscriptLabel } from '../../display/Subscript.js';
import {
  charNeedsShape,
  charTextFromCodes,
  escapeXml,
  formatDoubleXml,
  formatNumericXml,
  formatComplexXml,
  formatMatlabNum,
  formatMxCharSerial,
  formatNumLiteral,
  formatMatrixSerial,
  parseMatlabNum,
  parseExactNum,
  needsExactInt,
  transposeToColumnMajorND,
  transposeFromColumnMajorND,
  pad as xmlPad,
} from '../../parser/XmlUtils.js';

// ---- Pure value helpers ----
// None of these read node state, which is why they are module-local functions and
// not methods: staying off the class is what lets the display getters and the
// static parse entry points at the bottom of the file share them without either
// side owning the other.

const MCOS_ICON_MAP: Record<string, string> = {
  'Simulink.Parameter': 'wsParameters',
  'Simulink.Signal': 'wsSignal',
  'Simulink.Bus': 'wsBus',
  'Simulink.AliasType': 'wsAlias',
  'Simulink.NumericType': 'wsNumeric',
  'Simulink.ConfigSet': 'configurationReference',
  'Simulink.ConfigSetRef': 'configurationReference',
  'Simulink.Variant': 'wsVariant',
  'Simulink.VariantVariable': 'wsVariant',
  'Simulink.VariantControl': 'wsVariant',
  'Simulink.VariantBank': 'wsParameters_bank',
  'Simulink.VariantBankCoderInfo': 'wsParameters_bankCoderInfo',
  'Simulink.LookupTable': 'wsLookup',
  'Simulink.Breakpoint': 'wsSimulinkBreakpoint',
  'Simulink.ValueType': 'wsValue',
  // Not a Simulink class: a `string` reaches the opaque path because MATLAB stores it as
  // an MCOS object, and without this entry the same string array that shows a string icon
  // out of a dictionary showed the default one out of a .mat.
  string: 'wsString',
};

// An empty 0x0 double, MATLAB's own `[]`. Stands in for a cell slot the parser
// could not read (see _createFromMatCell) and for a struct-array element that no
// longer has one of the array's fields (see _buildVarObject): in both places a
// hole must stay a hole, or every later element slides one slot early.
// A fresh object per call, since the node built from it keeps a reference.
function emptyDouble(): MatVariable {
  return {
    name: '',
    className: 'double',
    dimensions: [0, 0],
    isComplex: false,
    isLogical: false,
    value: [],
    fields: null,
  };
}

// One element of a string array as MATLAB displays it: quoted, or the unquoted
// `<missing>` for a `missing`. `null` is the marker for a `missing` because the display
// text cannot be — a real string whose characters are `<missing>` still has to print
// quoted, and the two would be indistinguishable if the marker were the text.
// `undefined` is a hole rather than a missing (a shorter `_elements` than `_dims`
// claims), and prints as the empty string it always did.
function formatStringElement(el: unknown): string {
  if (el === null) return MISSING_STRING;
  return formatMatlabString(el !== undefined ? String(el) : '');
}

// A text .sldd stores a value its JSON schema cannot spell as uuencoded bytes,
// and what those bytes CONTAIN is an 8-byte preamble followed by one MAT-file
// miMATRIX element — so decoding stops at the transport (parser/CdataCodec) and
// MatParser reads the rest. parseCdata used to keep going itself and hand-read a
// 2-D complex double at fixed offsets (rows at 40, cols at 44), which meant every
// other class MATLAB puts in a cdata came back as garbage complex numbers or fell
// through to a char.
//
// The encode direction lives beside the decode one in CdataCodec, with the MAT
// element writer in parser/MatWriter — see _serializeCdata for why a rank >= 3
// value, and a complex value at any rank, has to go out this way.

// MAT-file element type miMATRIX: the one thing a cdata payload ever holds.
const MI_MATRIX = 14;

// The MATLAB numeric classes a bare JSON number cannot carry. JSON has ONE number
// type, so an int32 or a single written as a plain number reads back as a double —
// a silent class change, not a rounding nit. `double` needs no tag.
const TYPED_NUMERIC_CLASS = /^(?:u?int(?:8|16|32|64)|single)$/;

// The class a value keeps across an edit. A Value edit sets the VALUE, not the
// class — MATLAB's own `v(:) = 7` on an int32 stays int32, and the Data Type
// column is read-only here — but MatlabValueParser cannot know the class: a bare
// `7` always parses as 'double'. So the node's existing class beats the parser's
// default. Only the integer/single classes qualify: every number is representable
// in them, whereas keeping 'logical' would render `7` as `true`, which MATLAB
// rejects outright.
function classAfterEdit(current: string, parsedType: string): string {
  return parsedType === 'double' && TYPED_NUMERIC_CLASS.test(current) ? current : parsedType;
}

// The class one ELEMENT of a numeric array carries. One MATLAB array is one class,
// so an element of an int32 array is an int32 and an element of a logical array is a
// logical. The element rows' hardcoded 'double' put 'int32' in the array's Data Type
// column and 'double' in the column of every row beneath it — one value described two
// ways, one of them wrong — and showed a logical array as [true false] over rows
// reading 1 and 0, leaking the 1/0 storage form into the UI.
//
// classAfterEdit's set plus 'logical'. For the integer/single classes this moves the
// Data Type column and nothing else, since they format through formatMatlabNum
// exactly as a double does. 'logical' additionally changes the element's icon and
// text (see icon and _formatScalar), which is the point: the row should look like the
// logical scalar it is, checkbox included. It is also why _setConstrainedValue has a
// logical arm — a row that reads 'true' has to accept 'true'.
//
// Cell and struct children never come through here: they are independent values, and
// their container has no one class to hand down.
function elementClass(arrayClass: string): string {
  return TYPED_NUMERIC_CLASS.test(arrayClass) || arrayClass === 'logical' ? arrayClass : 'double';
}

// True when a scalar has to be written as the format's typed {_type,_value}
// literal rather than a bare JSON value. Both reasons are silent data loss:
// an int32/single written bare reads back as double (see TYPED_NUMERIC_CLASS),
// and JSON has no literal for Inf/NaN — JSON.stringify writes `null`, which reads
// back as 0. A `logical` normally travels as a JS boolean and needs no tag, except
// when it came from an array, whose elements the parser stores as 1/0.
function needsTypedLiteral(type: string, value: unknown): boolean {
  if (TYPED_NUMERIC_CLASS.test(type)) {
    return true;
  }
  if (type === 'logical') {
    return typeof value !== 'boolean';
  }
  return typeof value === 'number' && !isFinite(value);
}

// A MATLAB matrix literal: `[1 2 3; 4 5 6]`. Only ever called for rank <= 2 — the
// caller summarizes anything higher, because mat2str itself refuses rank >= 3 and
// there is no MATLAB one-line spelling to match.
//
// The row loop used to run the full rows x cols grid and print '?' for anything it
// could not find, so an element list shorter than the declared shape filled the
// display with question marks. It now formats the elements that exist.
function formatMatrix(rows: number, cols: number, elements: unknown[]): string {
  if (elements.length === 0) {
    return EMPTY_NUMERIC;
  }
  const rowStrs: string[] = [];
  for (let r = 0; r < rows; r++) {
    const vals: string[] = [];
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= elements.length) {
        break;
      }
      vals.push(formatMatlabNum(elements[i]));
    }
    if (vals.length > 0) {
      rowStrs.push(vals.join(' '));
    }
  }
  return '[' + rowStrs.join('; ') + ']';
}

// A char MATRIX as MATLAB prints one: `['ab'; 'cd']`, one quoted string per ROW.
//
// The stored text is column-major (see XmlUtils' char section), so row r is every
// rows-th character starting at r — MATLAB's own 2x2 'acbd' is rows 'ab' and 'cd'.
// Each row is quoted through formatMatlabChar, so an apostrophe inside one doubles
// exactly as it does in the scalar spelling.
//
// Rank 2 only: the caller summarizes anything higher, for the same reason formatMatrix
// does — MATLAB has no one-line print of a rank-3 array of any class.
function formatCharMatrix(text: string, dims: number[]): string {
  const rows = dims[0];
  const cols = dims[1];
  const rowStrs: string[] = [];
  for (let r = 0; r < rows; r++) {
    let row = '';
    for (let c = 0; c < cols; c++) {
      row += text.charAt(c * rows + r);
    }
    rowStrs.push(formatMatlabChar(row));
  }
  return '[' + rowStrs.join('; ') + ']';
}

function parseMatrixValue(
  raw: Record<string, unknown>,
): { dims: number[]; elements: (number | string)[]; type: string } | null {
  const lines = (raw._value as string).split('\n');
  const header = lines[0];
  // Rank 3 and up appear as Matrix(2,3,2) — MATLAB's binary dictionary writes a
  // 2x3x2 as Dimension="2*3*2", and BinarySlddParser now carries every extent
  // through. Only the two-group form was matched, so an N-D entry fell through
  // to the [0,0] empty node with all twelve of its elements gone.
  const dimsMatch = header.match(/^Matrix\((\d+(?:,\d+)*)\)$/);
  if (!dimsMatch) {
    return null;
  }

  const dims = dimsMatch[1].split(',').map(function (s) {
    return parseInt(s, 10);
  });
  const body = lines.slice(1).join('');

  const numbers: (number | string)[] = [];
  // Inf/-Inf/NaN are elements too, and a digits-only pattern would skip them —
  // shifting every later element one slot left and corrupting the whole matrix.
  const numMatches = body.match(/-?(?:[\d.]+(?:[eE][+-]?\d+)?|Inf|NaN)/g);
  if (numMatches) {
    // An int64/uint64 element is kept as exact decimal TEXT: MATLAB's 64-bit range is
    // wider than a double's exact one BY CONSTRUCTION, so parseMatlabNum turned
    // maxU64 into 18446744073709552000 one step after the reader had it right
    // (defect 29). The suffix never reaches here — the pattern above matches digits,
    // so '18446744073709551615U' arrives already bare.
    const exact = needsExactInt(raw._type as string);
    numMatches.forEach(function (s: string) {
      numbers.push(exact ? parseExactNum(s) : parseMatlabNum(s));
    });
  }

  // A one-group header (Matrix(5)) has no MATLAB spelling but is cheap to accept
  // as the row vector it must mean, rather than handing back a rank-1 dims array
  // every downstream reader would have to special-case.
  return {
    dims: dims.length >= 2 ? dims : [1, dims[0] || 0],
    elements: numbers,
    type: raw._type as string,
  };
}

// Re-exported so the many callers that reach this type through the node keep
// working; MatParser owns the single declaration.
export type { MatVariable };

export default class MatlabVariableNode extends DataNode {
  // ---- Instance state ----
  // Everything below this point is a state machine over these fields, dispatched
  // on _kind ('scalar' | 'array' | 'cell' | 'string') plus the _isOpaque flag.
  // That shared record is why the class is long and stays one unit: the display,
  // edit, JSON, XML, and MatVariable-rebuild sections are five views of ONE value,
  // not five separable concerns, and each of them re-runs the same switch on
  // _kind. Splitting them into modules would mean either making these fields part
  // of a public surface or threading a context object through every call — both
  // strictly worse than the file being long.
  // A closed union, not `string`: the five switches below are each exhaustive over
  // these four, and typing the field this way is what makes tsc reject a fifth kind
  // at every switch instead of silently routing it to a fallback that returns ''.
  _kind: MatlabVariableKind;
  _scalarValue: unknown;
  _scalarType: string;
  _elements: unknown[];
  _dims: number[];
  _rawBytes: Uint8Array | null;
  _matVar: MatVariable | null;
  // Set once anything in this variable's subtree is edited, to say that _matVar
  // no longer describes the live tree. See the _var getter.
  _varStale: boolean;
  _isOpaque: boolean;
  _opaqueClassName: string | null;
  _mcosProperties: Record<string, unknown> | null;
  _mcosValue: unknown;
  _mcosDimensions: number[] | null;
  // The [1,n]/[n,1] orientation an array had before a removal collapsed it to a
  // scalar, so undo can restore the shape and not just the values.
  _preCollapseDims: number[] | null;

  constructor(name: string, parent: BaseNode | null, serial?: Record<string, unknown>) {
    super(name, parent, serial);
    this._kind = 'scalar';
    this._scalarValue = 0;
    this._scalarType = 'double';
    this._elements = [];
    this._dims = [1, 1];
    this._rawBytes = null;
    this._matVar = null;
    this._varStale = false;
    this._isOpaque = false;
    this._opaqueClassName = null;
    this._mcosProperties = null;
    this._mcosValue = undefined;
    this._mcosDimensions = null;
    this._preCollapseDims = null;
  }

  // ---- Display: what the table columns show ----
  // Read-only projections of the state above — nothing here mutates (the one
  // exception, _serializeScalarXml's temporary _kind swap, is in the XML section
  // and restores it). Two rules recur: an opaque MCOS object is checked FIRST
  // because its class name and decoded value override the primitive spellings, and
  // once children exist they are the truth for element values while _elements is
  // the fallback for a not-yet-expanded container.

  get Value(): unknown {
    if (this._kind === 'scalar') {
      return this._scalarValue;
    }
    if (this._kind === 'array') {
      return this.children.length > 0
        ? this.children.map(function (c) {
            return (c as MatlabVariableNode)._scalarValue;
          })
        : this._elements;
    }
    if (this._kind === 'string') {
      return this._elements;
    }
    return null;
  }

  set Value(v: unknown) {
    if (this._kind === 'scalar') {
      this._scalarValue = v;
    }
  }

  get elements(): unknown[] {
    return this._elements;
  }

  get dims(): number[] {
    // An opaque MCOS object's shape is the one the decoder recovered, not _dims —
    // which no opaque path ever sets, so it is the [1,1] the constructor left. That
    // was the only shape available while the decoder had nothing better; a `string`
    // now carries MATLAB's own size() from its payload, and a 1x3 reporting 1x1 here
    // would contradict the summary the same node displays.
    if (this._isOpaque) {
      return this._mcosDimensions || this._dims;
    }
    // A char is measured in CHARACTERS, and the bare-JSON-string channel hands one
    // over with no shape at all, so _dims is [1,1] there however long the text is.
    // Reporting that made the accessor the only channel disagreeing with MATLAB's
    // size(): the display, the writers and the .mat snapshot all read _textDims, and
    // a consumer asking for the 1x4 'it''s' was told 1x1 (defect 25).
    if (this._kind === 'scalar' && this._scalarType === 'char') {
      return this._textDims(this._scalarValue === null || this._scalarValue === undefined ? '' : String(this._scalarValue));
    }
    return this._dims;
  }

  get arrayType(): string {
    return this._scalarType;
  }

  get icon(): string {
    // In the Architectural Data section a plain variable is a derived Constant,
    // shown with the arch-flavored icon rather than the workspace-variable one.
    if (this.isDerived) {
      return 'typeConstant';
    }
    if (this._isOpaque) {
      return MCOS_ICON_MAP[this._opaqueClassName!] || 'wsDefault';
    }
    switch (this._kind) {
      case 'scalar':
        if (this._scalarType === 'logical') {
          return 'wsCheck';
        }
        if (this._scalarType === 'char') {
          return 'wsCharacter';
        }
        if (this._scalarType === 'string') {
          return 'wsString';
        }
        if (this._scalarType === 'struct') {
          return 'wsTree';
        }
        return 'wsDefault';
      case 'array':
        // A logical array is a logical, so it gets the checkbox its scalar form has
        // always had — otherwise the container row looked like a plain double vector
        // while every element row under it carried a checkbox. Numeric classes have
        // no icon of their own: int32 and double are both wsDefault.
        return this._scalarType === 'logical' ? 'wsCheck' : 'wsDefault';
      case 'cell':
        return 'wsBrackets';
      case 'string':
        return 'wsString';
    }
  }

  get className(): string {
    if (this._isOpaque) {
      return this._opaqueClassName!;
    }
    switch (this._kind) {
      case 'scalar':
        return this._scalarType === 'complex' ? 'double' : this._scalarType;
      case 'array':
        return this._scalarType === 'complex' ? 'double' : this._scalarType;
      case 'cell':
        return 'cell';
      case 'string':
        return 'string';
    }
  }

  // A primitive variable's data type ('double', 'string', 'cell', …) is a real
  // data type and belongs in the DataType column. An opaque MCOS variable's
  // className is a Class name (e.g. 'Simulink.Parameter'), which is Class, not a
  // data type — suppress it here so the column stays type-only.
  get dataType(): string {
    if (this._isOpaque) {
      // `string` is the one exception: it arrives as an opaque MCOS object because
      // MATLAB implements it as one, but it IS a MATLAB data type, so a string
      // variable out of a .mat belongs in the DataType column alongside the one out
      // of a dictionary rather than showing a blank cell.
      return this._opaqueClassName === 'string' ? 'string' : '';
    }
    return this.className;
  }

  // A plain MATLAB variable (scalar, array, cell, struct-like, or opaque MCOS
  // object) is a "MATLAB Variable" in Design Data. In Architectural Data the same
  // variable is a Constant (a derived entry with no other catalog classification),
  // so its Kind follows the section. A catalog classification, if present, still
  // wins (mirrors DataNode.kind).
  get kind(): string {
    if (this.classification) {
      return super.kind;
    }
    return matlabVariableKind(this.isDerived);
  }

  get nameEditable(): boolean {
    if (this.parent && this.parent instanceof MatlabVariableNode) {
      return false;
    }
    // A class property name is fixed by the class definition (see BaseNode).
    if (this.parent?.isObjectPropertyBag) {
      return false;
    }
    return true;
  }

  get valueEditable(): boolean {
    if (this._isOpaque) {
      return false;
    }
    // An ELEMENT of an opaque value is as read-only as the value: a decoded `string`
    // array is the first opaque node with children at all, and its elements display real
    // editable-looking text ("alpha"), so without this they would have offered an editor
    // whose commit could not reach the file.
    if (this.parent instanceof MatlabVariableNode && this.parent._isOpaque) {
      return false;
    }
    if (this._scalarType === 'struct') {
      return false;
    }
    // The "value unrecoverable" placeholder has no real value to edit.
    if (this._scalarValue === NOT_AVAILABLE) {
      return false;
    }
    // Then BaseNode's rule: a value that DISPLAYS as a <mxn class> summary gets no
    // editor. It has to be consulted here too — returning a bare `true` shadowed
    // it, so a summarized 2x3x2 offered an editor seeded with the text
    // '<2x3x2 double>', and committing that cell unchanged replaced twelve
    // elements with an unparseable string.
    return super.valueEditable;
  }

  // True when this variable currently holds a SCALAR NUMERIC value — the shape a
  // Constant requires. A live-node counterpart to parsedIsScalarNumeric: it is a
  // 1x1 non-opaque scalar whose type is numeric (double/logical/complex, plus the
  // typed int/single scalars loaded from a file, which also carry _kind 'scalar').
  // Arrays, matrices, cells, structs, char, and string are rejected. Used by the
  // Constant value gate and the Variable→Constant paste/drop gate.
  get isScalarNumeric(): boolean {
    if (this._isOpaque) {
      return false;
    }
    if (this._kind !== 'scalar') {
      return false;
    }
    return this._scalarType !== 'struct' && this._scalarType !== 'char' && this._scalarType !== 'string';
  }

  get displayValue(): string {
    if (this._isOpaque) {
      // A `string` whose payload decoded is an opaque node that nonetheless HAS a value:
      // _adoptStringPayload gave it the same _kind/_dims/_elements a dictionary string
      // array carries, so it renders through the one string formatter and matches the
      // other three formats character for character. A payload that did not decode never
      // adopts that kind, stays the scalar-kind shell the constructor made, and falls
      // through to the summary below — which is still its true shape.
      if (this._kind === 'string') {
        return this._formatString();
      }
      if (this._mcosValue !== undefined && this._mcosValue !== null) {
        if (typeof this._mcosValue === 'number') return String(this._mcosValue);
        if (typeof this._mcosValue === 'string')
          return this._mcosValue
            ? formatMatlabChar(this._mcosValue)
            : summaryForm(this._mcosDimensions || [1, 1], this._opaqueClassName || 'double');
        if (Array.isArray(this._mcosValue)) {
          const dims = this._mcosDimensions || [1, (this._mcosValue as unknown[]).length];
          // Angle brackets, like every other summary: square brackets read as a
          // MATLAB literal, and the consumer table keys its gray/italic styling
          // (and its no-editor rule) on the angle-bracket form.
          return summaryForm(dims, this._opaqueClassName || 'double');
        }
      }
      // No value to print: the shape and the class are all there is. The shape used
      // to be a hardcoded [1,1], which is right for every scalar object and wrong for
      // a `string` array — one object holding a 1x3 displayed as <1x1 string>.
      return summaryForm(this._mcosDimensions || [1, 1], this._opaqueClassName || 'double');
    }
    switch (this._kind) {
      case 'scalar':
        return this._formatScalar();
      case 'array':
        return this._formatArray();
      case 'cell':
        return this._formatCell();
      case 'string':
        return this._formatString();
    }
  }

  _formatScalar(): string {
    // The MCOS decoder's "value unrecoverable" sentinel is a bare-angle-bracket
    // placeholder, not real text — render it unquoted (like `<1x1 class_name>`) so
    // the table styles it gray/italic and gives it no editor, rather than showing
    // it as a quoted, editable string literal.
    if (this._scalarValue === NOT_AVAILABLE) {
      return NOT_AVAILABLE;
    }
    // char and a scalar string have no child rows, so the cell is the only place
    // the value is ever visible and the char budget is the only rule that applies:
    // a realistic description shows in full, a 1500-character blob does not take
    // the row over. Summarized at the value's real 1xN size, which is what MATLAB's
    // size() reports for a char row vector — the JS-string parse path stores [1,1]
    // because it never knew the length, so derive it when _dims cannot account for
    // the characters.
    if (this._scalarType === 'char') {
      const s = String(this._scalarValue);
      const dims = this._textDims(s);
      // Rank >= 3 gets the summary every other class gets there: there is no MATLAB
      // one-line print of a 2x3x2, of chars or of anything else. It used to print as
      // one quoted 12-character string, which is not the value — it is the storage.
      if (dims.length > 2) {
        return summaryForm(dims, 'char');
      }
      // A char with more than one ROW is a char MATRIX and prints as one. The old
      // single-quoted spelling showed MATLAB's 2x2 ['ab'; 'cd'] as 'acbd' — the
      // column-major storage read out as if it were text, so both the shape and the
      // reading order were wrong on screen (defect 25).
      const text = dims[0] > 1 ? formatCharMatrix(s, dims) : formatMatlabChar(s);
      return overCharBudget(text) ? summaryForm(dims, 'char') : text;
    }
    // A string scalar stays 1x1 however long its text is — a MATLAB string holds
    // the text, it is not made of it — so no _textDims here.
    if (this._scalarType === 'string') {
      const text = formatMatlabString(String(this._scalarValue));
      return overCharBudget(text) ? summaryForm(this._dims, 'string') : text;
    }
    if (this._scalarType === 'struct') {
      // Always a summary, at every size: MATLAB never prints a struct inline.
      // summaryForm normalizes through effectiveDims, so a struct whose _dims was
      // never set prints '<1x1 struct>' rather than the '< struct>' the raw join
      // produced.
      return summaryForm(this._dims, 'struct');
    }
    if (this._scalarType === 'logical') {
      return this._scalarValue ? 'true' : 'false';
    }
    return formatMatlabNum(this._scalarValue);
  }

  // The real extents of a char value. _dims wins when it accounts for every
  // character (a 2x5 char array from a .mat file, MATLAB's mxchar literal, a
  // Dimension= attribute), otherwise the value came in as a bare JSON string that
  // never carried a shape — so it is a plain row vector and its length is its second
  // extent. Empty text is 0x0, which is what MATLAB's '' is: numel 0 and isempty
  // true, where the [1,1] the string path leaves behind would claim one character.
  //
  // Every channel that needs a char's shape reads it from here — the display, the
  // `dims` accessor, both .sldd writers and the .mat writer — so there is one answer
  // rather than five.
  _textDims(text: string): number[] {
    if (text === '') {
      return elementCount(this._dims) === 0 ? this._dims : [0, 0];
    }
    return elementCount(this._dims) === text.length ? this._dims : [1, text.length];
  }

  _formatArray(): string {
    const elems =
      this.children.length > 0
        ? this.children.map(function (c) {
            return (c as MatlabVariableNode)._scalarValue;
          })
        : this._elements;
    if (elems.length === 0) {
      return EMPTY_NUMERIC;
    }
    // Rank >= 3 (mat2str answers "Input matrix must be 2-D." — a bracketed string
    // would be valid 2-D syntax describing only page 1), or more elements than a
    // one-line literal should carry. The elements are expandable child rows, so
    // the count rule applies and the user loses nothing: they are one click away.
    if (needsSummary(this._dims)) {
      return summaryForm(this._dims, this.className);
    }
    const formatted =
      this._scalarType === 'logical'
        ? elems.map(function (v) {
            return v ? 'true' : 'false';
          })
        : elems;
    const text = formatMatrix(this._dims[0], this._dims[1], formatted);
    // The count rule alone is not a bound on LENGTH: ten 200-character elements
    // are still a 2000-character cell. The char budget is the runaway guard.
    return overCharBudget(text) ? summaryForm(this._dims, this.className) : text;
  }

  _formatCell(): string {
    if (this.children.length === 0) {
      return EMPTY_CELL;
    }
    // Rank >= 3 (the rows x cols walk below showed four of a 2x2x2's eight cells
    // with nothing to say the other four existed), or past the element budget.
    if (needsSummary(this._dims)) {
      return summaryForm(this._dims, 'cell');
    }
    const rows = this._dims[0];
    const cols = this._dims[1];
    const rowStrs: string[] = [];
    for (let r = 0; r < rows; r++) {
      const vals: string[] = [];
      for (let c = 0; c < cols; c++) {
        // A cell's element list is COLUMN-major -- MatParser's cell branch does
        // not transpose, unlike its numeric branch -- so display position (r,c)
        // is list index c*rows+r. Reading r*cols+c here transposed every
        // non-square cell's literal: MATLAB's {1 2 3; 4 5 6} printed as
        // {1, 4, 2; 5, 3, 6}. See test/cellElementOrder.test.ts.
        const child = this.children[c * rows + r];
        vals.push(child ? child.displayValue : EMPTY_NUMERIC);
      }
      rowStrs.push(vals.join(', '));
    }
    const text = '{' + rowStrs.join('; ') + '}';
    // Under the element budget but over the char budget: a 1x4 cell of 300-char
    // strings is a 1200-character table cell. Angle brackets, not the old
    // '{1x4 cell}' — only the angle form reads as a summary downstream.
    return overCharBudget(text) ? summaryForm(this._dims, 'cell') : text;
  }

  _formatString(): string {
    const d = this._dims;
    if (d[0] === 1 && d[1] === 1 && this._elements.length === 1) {
      // A scalar string has no child rows, so the char budget is the rule — same
      // as the char arm of _formatScalar.
      const text = formatStringElement(this._elements[0]);
      return overCharBudget(text) ? summaryForm(d, 'string') : text;
    }
    if (needsSummary(d)) {
      return summaryForm(d, 'string');
    }
    // strings(0,0) — the empty-value spelling, as _formatArray and _formatCell do for
    // their own kinds. Without this the loops below produce a bare '[]', which is not the
    // convention's spelling and is one character from a scalar that happens to be empty.
    if (this._elements.length === 0) {
      return EMPTY_NUMERIC;
    }
    const rows = d[0];
    const cols = d[1];
    const rowStrs: string[] = [];
    for (let r = 0; r < rows; r++) {
      const vals: string[] = [];
      for (let c = 0; c < cols; c++) {
        // COLUMN-major, exactly as in _formatCell above: a string array's element
        // list is not transposed on the way in either.
        vals.push(formatStringElement(this._elements[c * rows + r]));
      }
      rowStrs.push(vals.join(' '));
    }
    const text = '[' + rowStrs.join('; ') + ']';
    return overCharBudget(text) ? summaryForm(d, 'string') : text;
  }

  // ---- Property set + Property Inspector layout ----

  getProperties(): PropClass[] {
    return [PropName, PropValue, PropDataType, PropDescription];
  }

  getPILayout() {
    // className is dynamic (double/int8/struct/the opaque MCOS class), so this
    // can't be schema-keyed; author the common "General" identity group directly.
    return [{ group: 'General', items: [PropName, PropValue, PropDataType, PropKind, PropClassAtom, PropDescription] }];
  }

  // ---- Edit + structural mutation (the only writers of the state above) ----
  // This is the section that makes the class one unit: it is the sole place that
  // reshapes a variable, and every reshape has to keep FOUR representations
  // agreed — _kind/_scalarType, _dims, _elements, and the child nodes — plus the
  // `serial` blob the JSON writer replays. Miss one and the symptom is silent data
  // loss, not a crash, which is what the long comments on the individual methods
  // are recording. The add/remove methods come in canX/xChildNode/execX triples:
  // the gate, the mutation, and the undo/redo wrapper the command stack calls.

  setProperty(propName: string, stringValue: string): true | SetPropertyResult {
    if (propName === 'Value') {
      if (this._isConstrainedChild()) {
        return this._setConstrainedValue(stringValue);
      }
      const parsed = MatlabValueParser.parse(stringValue);
      if (!parsed) {
        return {
          error: true,
          reason: 'Invalid MATLAB expression',
          invalidValue: stringValue,
          validValue: this.displayValue,
        };
      }
      this._applyParsed(parsed);
      this._markModified();
      return true;
    }
    return DataNode.prototype.setProperty.call(this, propName, stringValue);
  }

  _isConstrainedChild(): boolean {
    if (!this.parent || !(this.parent instanceof MatlabVariableNode)) {
      return false;
    }
    return this.parent._kind === 'array' || this.parent._kind === 'string';
  }

  // An element of a numeric or string array, whose container fixes what it may
  // hold: one MATLAB array is one class, so an element cannot be retyped the way a
  // free-standing variable can (setProperty's other path). Reached only when
  // _isConstrainedChild() is true, i.e. the parent's kind is 'array' or 'string' —
  // the two the branch below is exhaustive over, which is why it has no third arm.
  _setConstrainedValue(stringValue: string): true | SetPropertyResult {
    const parent = this.parent as MatlabVariableNode;
    // An element of a decoded `string` out of a .mat/.slx MCOS subsystem. `valueEditable`
    // already withholds the editor, so a consumer that honors it never gets here; this is
    // the second gate for one that calls setProperty directly, because accepting the text
    // would update the node and leave the file's own bytes — which is what gets written
    // back — saying something else.
    if (parent._isOpaque) {
      return {
        error: true,
        reason: 'This value is read-only',
        invalidValue: stringValue,
        validValue: this.displayValue,
      };
    }
    const isArrayElement = parent._kind === 'array';
    // A logical element is the one array element that does not display as a number,
    // so it is the one with its own accept set: true/false, plus 1/0 for the user who
    // types digits into every other array. Any other number is refused rather than
    // stored, because a logical array cannot hold it — the editor used to take 7 and
    // write {_type:'logical', _value:'[7, 0, 1]'}. MATLAB's own answer to L(1) = 7 is
    // to retype the whole ARRAY to double, which an element editor cannot express, so
    // refusing is the honest one here.
    const isLogicalElement = isArrayElement && parent._scalarType === 'logical';
    const parsed = MatlabValueParser.parse(stringValue);
    let accepted: boolean;
    if (isLogicalElement) {
      accepted = parsed?.type === 'logical' || (parsed?.type === 'double' && (parsed.value === 0 || parsed.value === 1));
    } else if (isArrayElement) {
      accepted = parsed?.type === 'double' && !Array.isArray(parsed.value);
    } else {
      // A char MATRIX is refused: one element of a string array holds one piece of
      // text, and MATLAB errors on `s(1) = ['ab'; 'cd']` for the size. `dims` is
      // present on exactly the multi-row chars (charFromRows), so it is the test.
      accepted = (parsed?.type === 'char' && !parsed.dims) || parsed?.type === 'string';
    }
    if (!parsed || !accepted) {
      return {
        error: true,
        reason: isLogicalElement
          ? 'Logical array elements must be true or false'
          : isArrayElement
            ? 'Array elements must be scalar numbers'
            : 'String elements must be character or string values',
        invalidValue: stringValue,
        validValue: this.displayValue,
      };
    }
    // 1/0, never the boolean: _elements is the one representation the container's
    // display, its _var snapshot, and the typed literal all read, and the parsers
    // store a logical ARRAY as 1/0 (see parseTypedVector). An edited element must not
    // become the only boolean in it.
    this._scalarValue = isLogicalElement ? (parsed.value ? 1 : 0) : parsed.value;
    // elementClass, not 'double': the container fixes the element's class (this
    // method exists because of that), so re-stating 'double' here flipped an int32
    // element's Data Type column to double the moment its cell was committed.
    this._scalarType = isArrayElement ? elementClass(parent._scalarType) : 'string';
    if (!isArrayElement) {
      // A string-array element is a string-KIND node (see _makeStringElement), and
      // its own display and serialize paths read the text from _elements.
      this._elements = [parsed.value as string];
    }
    parent._syncElementFromChild(this);
    parent._rawInput = undefined;
    this._markModified();
    return true;
  }

  // Every edit routes through _markModified (DataNode), so this is the one place
  // that catches all of them — value edits, renames, add/remove child, and the
  // schema-prop path. Invalidate the parsed-variable snapshot on this node and on
  // every MatlabVariableNode above it, because the save path reads `_var` from the
  // TOP-LEVEL variable: a struct field's edit has to make the STRUCT's snapshot
  // stale, not just the field's own. See the _var getter for why.
  _markModified(): void {
    let node: BaseNode | null = this;
    while (node instanceof MatlabVariableNode) {
      node._varStale = true;
      node = node.parent;
    }
    super._markModified();
  }

  // Push an edited element's new value into this container's _elements slot.
  // _elements and the child nodes are two copies of the same data: the children
  // back the table rows, while _elements backs displayValue, the Value getter,
  // _var, and — once the array collapses back to a scalar or an element is
  // restored by undo — the value that survives. Leaving it stale silently
  // reverts the user's edit at that point.
  _syncElementFromChild(child: BaseNode): void {
    const idx = this.children.indexOf(child);
    if (idx >= 0 && idx < this._elements.length) {
      this._elements[idx] = (child as MatlabVariableNode)._scalarValue;
    }
  }

  _applyParsed(parsed: { type: string; value: unknown; dims?: number[] }): void {
    this.children = [];
    this._matVar = null;
    this._rawInput = undefined;
    // The class this node had going in. A numeric edit re-states the VALUE, not the
    // class, so classAfterEdit lets it survive the parser's 'double' default — see
    // its comment. Read before any arm overwrites it.
    const prevType = this._scalarType;
    if (parsed.type === 'double' && Array.isArray(parsed.value) && parsed.value.length === 1) {
      this._kind = 'scalar';
      this._scalarValue = parsed.value[0];
      this._scalarType = classAfterEdit(prevType, 'double');
      this._dims = [1, 1];
      this.serial = {};
    } else if (parsed.type === 'double' && Array.isArray(parsed.value)) {
      this._kind = 'array';
      this._elements = parsed.value;
      this._dims = parsed.dims!;
      this._scalarType = classAfterEdit(prevType, 'double');
      this._syncArraySerial();
      this._buildArrayChildren();
    } else if (parsed.type === 'string-array') {
      this._kind = 'string';
      this._elements = parsed.value as unknown[];
      this._dims = parsed.dims!;
      this._scalarType = 'string';
      this.serial = { _array_type: 'String', _dimensions: parsed.dims };
      this._buildStringChildren();
    } else if (parsed.type === 'cell') {
      this._kind = 'cell';
      this._dims = parsed.dims!;
      this._scalarType = 'double';
      this.serial = { _dimensions: parsed.dims, _mw_element_type: 'MATLABArray' };
      this._buildCellChildren(parsed.value as unknown[]);
    } else {
      this._kind = 'scalar';
      this._scalarValue = parsed.value;
      this._scalarType = classAfterEdit(prevType, parsed.type);
      // A char is the one scalar-KIND value that can be bigger than 1x1: it is stored
      // as one string, so ['ab'; 'cd'] arrives here as the 4-character 'acbd' with
      // dims [2,2] beside it (see charFromRows). Forcing [1, 1] made committing a char
      // matrix's OWN displayed value reshape it — the display, both writers and the
      // subscripts all read _dims, so the 2x2 came back as a 1x1 holding four
      // characters in column-major order, which is text nobody typed (defect 25).
      this._dims = parsed.dims ? parsed.dims.slice() : [1, 1];
      this.serial = {};
    }
  }

  // The write-side twin of parseMatrixValue. This used to be its own loop, and it
  // spelled the body differently from BinarySlddParser's copy — newline-joined rows
  // rather than bracketed groups, and formatMatlabNum for every class rather than
  // MATLAB's typed literals. MATLAB reads the newline form as a 1x0 EMPTY matrix, so
  // editing any multi-row matrix in an uncompressed-text dictionary silently threw
  // the value away. Both writers now go through XmlUtils.formatMatrixSerial, which
  // carries the MATLAB evidence for each spelling.
  // `elements` is widened to admit a string because an int64/uint64 element is exact
  // decimal TEXT (parseTypedVector); formatNumLiteral, under formatMatrixSerial, carries
  // one through untouched and appends the class's own suffix.
  _buildMatrixString(dims: number[], elements: (number | string)[], type?: string): string {
    return formatMatrixSerial(elements, dims, type || this._scalarType || 'double');
  }

  _buildArrayChildren(): void {
    if (this._elements.length <= 1) {
      return;
    }
    for (let i = 0; i < this._elements.length; i++) {
      const child = MatlabVariableNode._createScalar(this._elements[i], elementClass(this._scalarType), String(i + 1), this);
      this.addChild(child);
    }
  }

  // One element of a string array, built as a string-KIND node rather than a
  // 'string'-typed scalar: the former serializes as a bare "" element, where
  // _createScalar('string') would produce a nested [""] array via
  // _serializeScalar. Shared by the parse, add, and undo paths so all three
  // build the identical shape — they used to construct it separately, and the
  // undo path's copy read the value back as if it were a scalar-kind child.
  private _makeStringElement(name: string, value: unknown): MatlabVariableNode {
    const child = new MatlabVariableNode(name, this, { _dimensions: [1, 1] });
    child._kind = 'string';
    child._elements = [value as string];
    child._dims = [1, 1];
    child._scalarValue = value;
    child._scalarType = 'string';
    return child;
  }

  _buildStringChildren(): void {
    if (this._elements.length <= 1) {
      return;
    }
    for (let i = 0; i < this._elements.length; i++) {
      this.addChild(this._makeStringElement(String(i + 1), this._elements[i]));
    }
  }

  _buildCellChildren(elements: unknown[]): void {
    for (let i = 0; i < elements.length; i++) {
      const child = NodeRegistry.parseValue(elements[i], String(i + 1), this);
      this.addChild(child);
    }
  }

  canAddChild(): boolean {
    // An opaque MCOS value is read-only in both directions: its bytes go back out
    // verbatim because nothing here writes a .mat MCOS subsystem. Before a `string`
    // decoded, no opaque node had a _kind that reached the vector case below, so this
    // gate was never exercised — a decoded 1x3 string would have offered Add Child and
    // then dropped the added element on save.
    if (this._isOpaque) {
      return false;
    }
    if (this._kind === 'scalar' && this._scalarType === 'struct') {
      return true;
    }
    if (this._kind === 'scalar') {
      return false;
    }
    // A 2-D (or higher) matrix cannot take an appended element and stay
    // rectangular, so Add Child is disabled for cell/string/numeric matrices.
    // Row and column vectors (one dimension is 1) remain addable.
    if ((this._kind === 'array' || this._kind === 'cell' || this._kind === 'string') && this._dims[0] > 1 && this._dims[1] > 1) {
      return false;
    }
    // A scalar (1x1) string is a leaf value, not a string array, so it has no
    // element to add — whether it stands alone or is an element of a parent
    // string array.
    if (this._kind === 'string' && this._dims[0] === 1 && this._dims[1] === 1) {
      return false;
    }
    return true;
  }

  addChildNode(): BaseNode | null {
    if (this._kind === 'array' && this._elements.length === 0) {
      return this._convertToStructAndAddField();
    }
    if (this._kind === 'scalar' && this._scalarType === 'struct') {
      return this._addStructField();
    }
    if (this._kind === 'array') {
      return this._addArrayChild();
    }
    if (this._kind === 'cell') {
      return this._addCellChild();
    }
    if (this._kind === 'string') {
      return this._addStringChild();
    }
    return null;
  }

  // Turn an untyped `[]` into an empty 1x1 struct. Kept separate from
  // _convertToStructAndAddField so execAddChild's redo can re-apply the
  // conversion around the ORIGINAL field node instead of a fresh one.
  private _becomeStruct(): void {
    this._kind = 'scalar';
    this._scalarType = 'struct';
    this._scalarValue = null;
    this._elements = [];
    this._dims = [1, 1];
    this.children = [];
    this.serial = {};
  }

  _convertToStructAndAddField(): MatlabVariableNode {
    this._becomeStruct();
    const child = MatlabVariableNode._createScalar(0, 'double', 'field', this);
    this.addChild(child);
    this._markModified();
    return child;
  }

  _addStructField(): MatlabVariableNode {
    const baseName = 'field';
    const existing = new Set(this.children.map((c) => c.name));
    let uniqueName = baseName;
    let i = 1;
    while (existing.has(uniqueName)) {
      uniqueName = baseName + i;
      i++;
    }
    const child = MatlabVariableNode._createScalar(0, 'double', uniqueName, this);
    this.addChild(child);
    this._markModified();
    return child;
  }

  _addArrayChild(): MatlabVariableNode {
    const idx = this.children.length + 1;
    const child = MatlabVariableNode._createScalar(0, elementClass(this._scalarType), String(idx), this);
    this.addChild(child);
    this._elements.push(0);
    this._updateDimsForCount(this._elements.length);
    this._syncArraySerial();
    this._markModified();
    return child;
  }

  _addCellChild(): MatlabVariableNode {
    const child = MatlabVariableNode._createScalar(0, 'double', String(this.children.length + 1), this);
    this.addChild(child);
    this._updateDimsForCount(this.children.length);
    if ((this.serial as Record<string, unknown>)._dimensions) {
      (this.serial as Record<string, unknown>)._dimensions = this._dims;
    }
    this._markModified();
    return child;
  }

  _addStringChild(): MatlabVariableNode {
    const child = this._makeStringElement(String(this.children.length + 1), '');
    this.addChild(child);
    this._elements.push('');
    this._updateDimsForCount(this._elements.length);
    this._markModified();
    return child;
  }

  canRemoveChild(): boolean {
    // Read-only in both directions, as in canAddChild.
    if (this._isOpaque) {
      return false;
    }
    if (this._kind === 'scalar') {
      return false;
    }
    // Removing an element from a 2-D (or higher) matrix would break its
    // rectangular shape, so it is disabled for numeric/cell/string matrices.
    // Row and column vectors (one dimension is 1) remain removable.
    if ((this._kind === 'array' || this._kind === 'cell' || this._kind === 'string') && this._dims[0] > 1 && this._dims[1] > 1) {
      return false;
    }
    return this.children.length > 0;
  }

  removeChildNode(child: BaseNode): void {
    const idx = this.children.indexOf(child);
    if (idx < 0) {
      return;
    }
    this.removeChild(child);
    if (this._kind === 'array') {
      this._elements.splice(idx, 1);
      this._updateArrayAfterRemove();
    } else if (this._kind === 'cell') {
      this._updateCellAfterRemove();
    } else if (this._kind === 'string') {
      this._elements.splice(idx, 1);
      this._updateStringAfterRemove();
    }
    this._reindexChildren();
    this._markModified();
  }

  _updateArrayAfterRemove(): void {
    if (this._elements.length <= 1) {
      if (this._elements.length === 1) {
        // Down to one element, so this is a scalar now — which means dropping the
        // surviving element's child row and the [1,n]/[n,1] orientation. Undo has
        // to put both back, so remember the orientation on the way out.
        // _scalarType is deliberately NOT touched: an int32 array whose extra
        // elements were removed is still an int32, and hardcoding 'double' here
        // silently reclassified it (and the XML writer then wrote Class="double").
        this._preCollapseDims = this._dims.slice();
        this._kind = 'scalar';
        this._scalarValue = this._elements[0];
        this._dims = [1, 1];
        this._elements = [];
        this.children = [];
        this.serial = {};
      } else {
        this._dims = [1, 0];
        this.serial = this._elements as unknown as Record<string, unknown>;
      }
      return;
    }
    this._updateDimsForCount(this._elements.length);
    this._syncArraySerial();
  }

  _updateCellAfterRemove(): void {
    if (this.children.length === 0) {
      this._dims = [0, 0];
    } else {
      this._updateDimsForCount(this.children.length);
    }
    if ((this.serial as Record<string, unknown>)._dimensions) {
      (this.serial as Record<string, unknown>)._dimensions = this._dims;
    }
  }

  _updateStringAfterRemove(): void {
    if (this._elements.length <= 1) {
      if (this._elements.length === 1) {
        // Down to one element, so this renders as a scalar string: the surviving
        // element loses its child row and the [1,n]/[n,1] orientation goes to
        // [1,1]. Undo has to put both back, so remember the orientation on the
        // way out — the same bookkeeping _updateArrayAfterRemove does.
        this._preCollapseDims = this._dims.slice();
        this._dims = [1, 1];
        this.children = [];
      } else {
        this._dims = [1, 0];
      }
      return;
    }
    this._updateDimsForCount(this._elements.length);
  }

  restoreChildNode(child: BaseNode, index: number): void {
    if (this._kind === 'scalar') {
      // Undoing the removal that collapsed this array back to a scalar. The
      // surviving element lost its child row on the way down, so rebuild it here
      // before `child` is spliced in — otherwise the array comes back one element
      // short and every row after `index` shows the wrong value.
      const survivor = MatlabVariableNode._createScalar(this._scalarValue, elementClass(this._scalarType), '1', this);
      this._kind = 'array';
      this._elements = [this._scalarValue as number];
      this._scalarValue = undefined;
      // _scalarType stays as-is: the collapse preserved the array's MATLAB class on
      // the way down (see _updateArrayAfterRemove), so re-asserting 'double' here
      // would undo a removal by ALSO changing an int32/logical array to a double one.
      // Restore the row/column orientation the collapse discarded.
      this._dims = this._preCollapseDims ?? [1, 1];
      this._preCollapseDims = null;
      this.children = [survivor];
    } else if (this._kind === 'string' && this.children.length === 0 && this._elements.length === 1) {
      // The same collapse, for a string array. It stays kind 'string' (a scalar
      // string is still a string), so it needs its own condition — the survivor
      // dropped its child row and the orientation went to [1,1], and without
      // rebuilding both here the undone array comes back with one child for two
      // elements and a transposed shape.
      const survivor = this._makeStringElement('1', this._elements[0]);
      this._dims = this._preCollapseDims ?? [1, 1];
      this._preCollapseDims = null;
      this.children = [survivor];
    }
    this.children.splice(index, 0, child);
    child.parent = this;
    if (this._kind === 'array') {
      const val =
        (child as MatlabVariableNode)._kind === 'scalar' ? ((child as MatlabVariableNode)._scalarValue as number) : 0;
      this._elements.splice(index, 0, val);
      this._updateDimsForCount(this._elements.length);
      this._syncArraySerial();
    } else if (this._kind === 'cell') {
      this._updateDimsForCount(this.children.length);
      if ((this.serial as Record<string, unknown>)._dimensions) {
        (this.serial as Record<string, unknown>)._dimensions = this._dims;
      }
    } else if (this._kind === 'string') {
      // A string-array element is a string-KIND node (see _makeStringElement), so
      // its text lives in _scalarValue regardless of kind. Reading it only when
      // _kind === 'scalar' — as the array branch above legitimately does, since
      // ITS children are scalar-kind — matched nothing here, so every undone
      // element came back as '' and the array silently lost its text.
      const restored = (child as MatlabVariableNode)._scalarValue;
      this._elements.splice(index, 0, typeof restored === 'string' ? restored : '');
      this._updateDimsForCount(this._elements.length);
    }
    this._reindexChildren();
    this._markModified();
  }

  execAddChild(): ChildAddEdit | null {
    // Adding to an empty `[]` converts it to a struct, and that needs an undo/redo
    // pair the shared wrapper cannot express — see _addFirstStructField. Every
    // other shape takes the generic remove/restore pair.
    if (this._kind === 'array' && this._elements.length === 0) {
      return this.canAddChild() ? this._addFirstStructField() : null;
    }
    return addChildUndoable(this);
  }

  // Add the first field to an empty `[]`, turning it into a 1x1 struct. Undo has to
  // put back the array shape the conversion discarded — removeChildNode/
  // restoreChildNode only move a child within a shape that already exists — and
  // redo has to re-apply the conversion around the SAME field node undo removed.
  // Calling _convertToStructAndAddField again minted a second 'field' instead, so
  // the undo stack's node reference went stale: a following undo removed a node
  // that was no longer in the tree, and each undo/redo cycle left one more orphan
  // field behind.
  private _addFirstStructField(): ChildAddEdit {
    const prevSerial = { ...this.serial };
    const child = this._convertToStructAndAddField();
    const self = this;
    return {
      node: child,
      undo() {
        self.removeChild(child);
        self._kind = 'array';
        self._scalarType = 'double';
        self._scalarValue = undefined;
        self._elements = [];
        self._dims = [0, 0];
        self.serial = prevSerial;
        self._markModified();
      },
      redo() {
        self._becomeStruct();
        self.addChild(child);
        self._markModified();
      },
    };
  }

  execRemoveChild(child?: BaseNode): ChildUndoRedo | null {
    return removeChildUndoable(this, child);
  }

  private _updateDimsForCount(count: number): void {
    if (this._dims[1] === 1) {
      this._dims = [count, 1];
    } else {
      this._dims = [1, count];
    }
  }

  // Re-render `serial` from the live _elements after the array's shape changed.
  // _serializeArray reads serial._type to decide whether to emit the typed literal,
  // so the tag is the ONLY carrier of the MATLAB class through the JSON writer:
  // hardcoding 'double' here — or dropping the tag entirely, which the bare
  // element-list form does — turned an int32/single/logical array into a double
  // array on the first add or remove. A matrix keeps the typed literal whatever its
  // class, because Matrix(r,c) has no bare JSON spelling at all.
  private _syncArraySerial(): void {
    const typed = TYPED_NUMERIC_CLASS.test(this._scalarType) || this._scalarType === 'logical';
    if (this._dims[0] > 1 || typed) {
      const serialType = typed ? this._scalarType : 'double';
      this.serial = {
        _type: serialType,
        // The literal's own suffixes have to agree with the tag: MATLAB reads a
        // suffixless body as double whatever _type says.
        _value: this._buildMatrixString(this._dims, this._elements as (number | string)[], serialType),
      };
    } else {
      this.serial = this._elements as unknown as Record<string, unknown>;
    }
  }

  _reindexChildren(): void {
    for (let i = 0; i < this.children.length; i++) {
      this.children[i].name = String(i + 1);
    }
  }

  // ---- JSON serialization (the .sldd text format) ----
  // Round-trip fidelity first: an untouched value returns its captured `_rawInput`
  // verbatim rather than being re-rendered, so only edited values are rewritten.
  // The recurring hazard is that JSON has no literal for Inf/NaN — JSON.stringify
  // turns them into `null`, which reads back as 0 — so the branches that spot a
  // non-finite number fall back to the format's typed `{_type, _value}` escape
  // hatch, which spells them out as text.

  serializeValue(): unknown {
    if (
      this._rawInput !== undefined &&
      this.status !== 'Modified' &&
      !(this._rawInput as Record<string, unknown>)?._emptyDims
    ) {
      return this._rawInput;
    }
    // Rank >= 3 leaves the literal grammar behind entirely: there is no spelling
    // for it. Every `Matrix(d1,d2,d3)` candidate reads back as an empty 1x0 and
    // the two constructor expressions read back as the scalar 0, while MATLAB's
    // own dictionary stores every N-D value of every kind as a cdata byte stream
    // (defect 22, evidence in parser/MatWriter). So this is not an alternative to
    // the branches below — it is the only form that survives, and they are
    // rank-2-only by construction.
    //
    // Complex has no literal spelling either, and unlike rank it has none at ANY
    // shape. MATLAB's own text dictionary stores a complex SCALAR and a complex
    // VECTOR as cdata byte streams exactly as it does a rank-3 array — cases.sldd's
    // own bytes for cplxScalar and cplxVec are both streams. What we emitted
    // instead, `{_type: 'cdata', _value: '3+4i'}`, is the form the BINARY dictionary
    // uses for the same property, and MATLAB reads it back out of a TEXT dictionary
    // as an empty 1x0 double — the same signature defects 19 and 22 had. So this was
    // data loss on the first save of any edited complex value, not churn (defect 24,
    // measured by probe_writeback).
    //
    // The stream is right for the XML channel too: _serializeTypedPropertyXml
    // discriminates on isMatCdata and hands a stream back to the node to write its
    // own `Class="double" IsComplex="1"` property, which is exactly the plain-text
    // form the binary dictionary wants. One serialization, both formats.
    if (effectiveDims(this._dims).length > 2 || this._isComplexValue()) {
      const cdata = this._serializeCdata();
      if (cdata) {
        return cdata;
      }
    }
    switch (this._kind) {
      case 'scalar':
        return this._serializeScalar();
      case 'array':
        return this._serializeArray();
      case 'cell':
        return this._serializeCell();
      case 'string':
        return this._serializeString();
    }
  }

  /**
   * Is this a complex value? The two tests are the two shapes complexity arrives
   * in: a complex SCALAR carries `_scalarType === 'complex'`, while a complex ARRAY
   * is a plain `double` whose per-element values are the literal text `'1+2i'` —
   * the element nodes are the complex ones, not the parent. `_buildVarObject` has
   * always had to make the same distinction to set `isComplex`, and it asks here so
   * the projection and the serialization cannot disagree about what is complex; a
   * disagreement would mean writing a cdata stream built from a non-complex `_var`.
   */
  _isComplexValue(): boolean {
    if (this._scalarType === 'complex') {
      return true;
    }
    if (this._kind !== 'array') {
      return false;
    }
    const elems =
      this.children.length > 0
        ? this.children.map(function (c) {
            return (c as MatlabVariableNode)._scalarValue;
          })
        : this._elements;
    return elems.length > 0 && typeof elems[0] === 'string' && String(elems[0]).includes('i');
  }

  // A value with no literal spelling — rank >= 3, or complex at any rank — as the
  // `{_type: 'cdata'}` byte stream MATLAB uses for it. `_var` is the same live-tree
  // rebuild the .mat and .slx writers use, so an edit anywhere below this node is
  // already in it (_markModified marks the whole chain stale).
  //
  // Returns null for a value MatWriter refuses — an MCOS opaque, a class it has no
  // MAT code for. Those have no stream spelling in this format at ALL, so the choice
  // is between the rank-2 form the branches below produce, which at least leaves a
  // readable file, and failing the whole save. It falls through.
  _serializeCdata(): unknown | null {
    try {
      return { _type: 'cdata', _value: encodeCdata(this._var) };
    } catch (_e) {
      return null;
    }
  }

  _serializeScalar(): unknown {
    if (this._scalarType === 'string') {
      return [this._scalarValue];
    }
    if (this._scalarType === 'char') {
      // A bare JSON string is a 1xN char and nothing else, so a char that is not a row
      // takes MATLAB's `mxchar` envelope — the character CODES under a Matrix() header,
      // which is exactly how MATLAB's own char_text.sldd spells charCol, charMat and
      // charMat23, and how typed_text.sldd spells the char field of sCharMat.
      //
      // Without this arm a 2x2 went out as the bare string "acbd": MATLAB reopened it
      // as a 1x4 char whose characters were in column-major order, so the shape was
      // gone and the text itself was scrambled (defect 25). Rank >= 3 never reaches
      // here — serializeValue takes the cdata branch first, which is what MATLAB writes
      // for an N-D char too.
      const text = this._scalarValue === null || this._scalarValue === undefined ? '' : String(this._scalarValue);
      const dims = this._textDims(text);
      if (text !== '' && charNeedsShape(dims)) {
        return { _type: 'mxchar', _value: formatMxCharSerial(text, dims) };
      }
      return text;
    }
    if (this._scalarType === 'struct') {
      // Without this arm a struct falls through to `return this._scalarValue`,
      // which is null for a struct — the entry serializes to null and its
      // contents are gone, silently, on the first save. The .sldd path only
      // escapes because it takes the _rawInput early return; a MODIFIED .sldd
      // struct lands here too. Measured on cases.mat: all five struct entries.
      return this._serializeStructValue();
    }
    if (this._scalarType === 'complex') {
      // Unreachable for a complex value MatWriter can encode — serializeValue takes
      // the byte-stream branch above first, because MATLAB reads THIS spelling back
      // out of a text dictionary as an empty 1x0 (defect 24). It stays as the
      // fallback for the value the writer refuses, where a readable-but-lossy
      // property still beats failing the save, and as the form the binary
      // dictionary's XML ultimately carries.
      return { _type: 'cdata', _value: this._scalarValue };
    }
    // The typed form is the format's own escape hatch for a value a bare JSON
    // scalar cannot carry — an integer/single class, or an Inf/NaN. See
    // needsTypedLiteral for why each one loses data written bare.
    //
    // formatNumLiteral, not formatMatlabNum: the suffix belongs to the literal.
    // MATLAB's own thirty-odd typed scalars in cases.sldd spell it exactly the way
    // formatNumLiteral does — unsigned takes 'U' (`7U`, `255U`, `0U`), single takes
    // 'F' (`3.14159274F`), a signed integer takes neither (`7`, `-128`), and a
    // non-finite double is `Inf`/`-Inf`/`NaN`. We were writing formatMatlabNum's bare
    // number for all of them, so a modified single scalar went out as
    // `{"_type": "single", "_value": "3.5"}` where MATLAB writes `"3.5F"`. That one
    // is churn rather than loss — asked directly, MATLAB reads the suffix-less form
    // back as a single, because the `_type` tag carries the class (probe_writeback,
    // deepsig on typed/sTyped reports `b:single[1 1]`) — but the array path already
    // went through formatNumLiteral, so the same value spelled itself two ways
    // depending only on whether it had siblings.
    if (needsTypedLiteral(this._scalarType, this._scalarValue)) {
      return { _type: this._scalarType, _value: formatNumLiteral(this._scalarValue as number, this._scalarType) };
    }
    return this._scalarValue;
  }

  _serializeArray(): unknown {
    if (this._elements.length === 0) {
      return [];
    }
    if (this.children.length === 0) {
      return this.serial;
    }
    const elems = this.children.map(function (c) {
      return (c as MatlabVariableNode)._scalarValue;
    });
    const serialType = (this.serial as Record<string, unknown>)?._type;
    if (serialType) {
      return {
        _type: serialType,
        _value: this._buildMatrixString(this._dims, elems as (number | string)[], serialType as string),
      };
    }
    // A bare JSON array cannot carry Inf/NaN (JSON.stringify writes `null`), so
    // fall back to the typed-vector literal, which spells them out as text.
    if (elems.some((v) => typeof v === 'number' && !isFinite(v))) {
      return { _type: 'double', _value: '[' + elems.map(formatMatlabNum).join(', ') + ']' };
    }
    // A bare JSON array has nowhere to carry [2,3] or [2,3,2] either, so a matrix
    // written that way read back as a 1xN — and because the children are row-major
    // even the element order was wrong against MATLAB's column-major
    // linearization. Only a true vector may serialize bare; anything with two
    // spread extents takes the typed Matrix() literal, which is the shaped form
    // both readers already accept (there is no `_array_type: 'Matrix'`).
    //
    // A vector of a class the bare form cannot carry is NOT one of those vectors.
    // MATLAB spells such a vector as ONE typed literal for the whole array —
    // `{"_type": "int32", "_value": "[1, 2]"}` — at the top level, in a struct
    // field and in a cell element alike (probe_typed_shapes.m), never as a JSON
    // list of per-element literals. The list is what mapping serializeValue over
    // the children produces, since each child needs its own tag, and it is not
    // merely an unusual spelling: serializeValue is shared with the XML channel,
    // where DataNode.serializePropertyXml String()-joined the objects and wrote
    // `Class="double" Dimension="1*2">[object Object] [object Object]` for an
    // int32 struct field. That is a corrupt property, not a lossy one. The rule is
    // _syncArraySerial's, which has always had it right for the edit path; only the
    // no-serial path (a value that reached us from a .mat or .slx rather than from a
    // text dictionary) fell through to the children.
    const d = effectiveDims(this._dims);
    const typed = TYPED_NUMERIC_CLASS.test(this._scalarType) || this._scalarType === 'logical';
    if (!typed && d.length <= 2 && (d[0] === 1 || d[1] === 1)) {
      return this.children.map(function (c) {
        return (c as MatlabVariableNode).serializeValue();
      });
    }
    // A typed ROW vector comes out of formatMatrixSerial bare, `[1, 2]`, which is
    // MATLAB's own spelling for it and the one BinarySlddParser's read path has always
    // produced; only a column or a matrix states its shape (defect 21).
    const matrixType = this._scalarType || 'double';
    return { _type: matrixType, _value: this._buildMatrixString(d, elems as (number | string)[], matrixType) };
  }

  // The `_array_type: 'Struct'` form, rebuilt from the tree. Deliberately the same
  // shape BinarySlddParser.structValue produces and a text .sldd carries in
  // _rawInput, so a struct read from a .mat and written to a dictionary
  // round-trips through the existing reader (NodeClassMap -> StructNode.parse)
  // unchanged.
  _serializeStructValue(): unknown {
    const dims = effectiveDims(this._dims);
    // A .mat struct ARRAY hangs its ELEMENTS off this node (named 1..N, each a
    // struct-kind node whose own children are the fields); a 1x1 hangs the fields
    // directly. StructNode owns neither case on the .mat path, so both are here —
    // reading this node's children as fields unconditionally would have named a
    // 2x3's six elements '1'..'6' and written six garbage fields.
    const elementNodes: BaseNode[] = elementCount(dims) > 1 ? this.children : [this];
    const fields: string[] = [];
    const elements: Record<string, unknown>[] = [];
    for (const el of elementNodes) {
      const bag: Record<string, unknown> = {};
      for (const child of el.children) {
        const c = child as MatlabVariableNode;
        bag[c.name] = c.serializeValue();
        if (!fields.includes(c.name)) {
          fields.push(c.name);
        }
      }
      elements.push(bag);
    }
    return {
      _array_type: 'Struct',
      _dimensions: dims,
      _elements: elements,
      _fields: fields,
      _mw_element_type: 'MATLABArray',
    };
  }

  _serializeCell(): unknown {
    const elements = this.children.map(function (child) {
      return (child as MatlabVariableNode).serializeValue();
    });
    return {
      _array_type: 'Cell',
      _dimensions: this._dims,
      _elements: elements,
      _mw_element_type: (this.serial as Record<string, unknown>)._mw_element_type || 'MATLABArray',
    };
  }

  _serializeString(): unknown {
    if (this.parent && this.parent instanceof MatlabVariableNode && this.parent._kind === 'string') {
      return this._elements[0];
    }
    const elements =
      this.children.length > 0
        ? this.children.map(function (c) {
            return (c as MatlabVariableNode).serializeValue();
          })
        : this._elements;
    if ((this.serial as Record<string, unknown>)._array_type) {
      return {
        _array_type: 'String',
        _dimensions: this._dims,
        _elements: elements,
        _mw_element_type: (this.serial as Record<string, unknown>)._mw_element_type || 'MATLABArray',
      };
    }
    return elements;
  }

  // ---- XML serialization (the .slx workspace format) ----
  // A parallel set of per-kind writers rather than a reuse of the JSON ones,
  // because the two formats disagree on essentials: XML is explicitly typed by a
  // Class= attribute, carries dimensions as "rows*cols", and — the reason these
  // can't share the JSON traversal — stores matrix elements in COLUMN-major order,
  // hence transposeToColumnMajorND on the way out.

  serializeXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string {
    switch (this._kind) {
      case 'scalar':
        return this._serializeScalarXml(tagName, attrs, indent);
      case 'array':
        return this._serializeArrayXml(tagName, attrs, indent);
      case 'cell':
        return this._serializeCellXml(tagName, attrs, indent);
      case 'string':
        return this._serializeStringXml(tagName, attrs, indent);
    }
  }

  _serializeScalarXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string {
    const p = xmlPad(indent);
    const type = this._scalarType;
    const val = this._scalarValue;
    let attrStr = '';
    if (attrs && attrs.Name) {
      attrStr += ' Name="' + escapeXml(attrs.Name) + '"';
    }

    if (type === 'string') {
      this._kind = 'string';
      this._elements = [val as string];
      this._dims = [1, 1];
      const result = this._serializeStringXml(tagName, attrs, indent);
      this._kind = 'scalar';
      return result;
    }
    if (type === 'struct') {
      // Without this arm a struct falls through to the numeric tail below and the
      // WHOLE entry writes as `Class="struct">0` — every field and every element
      // gone. This is the XML twin of the _serializeScalar hole Phase 6 closed for
      // JSON, and it is the worse half: the binary dictionary writer goes through
      // serializeXml, and MATLAB does not merely read the result as an empty
      // struct, it refuses the file. Substituting that byte sequence for
      // struct2x3's value in MATLAB's own binary cases.sldd makes
      // Simulink.data.dictionary.open answer "Failed to open file".
      //
      // StructNode already writes MATLAB's own spelling for this exact value bag
      // (Class="struct" Dimension="2*3*2" with one <Element> per element), so route
      // through it rather than growing a second struct-XML writer that could drift
      // from the first. _serializeStructValue produces the `_array_type: 'Struct'`
      // form NodeClassMap maps to StructNode.
      const bag = this._serializeStructValue();
      return (NodeRegistry.parseValue(bag, this.name, null) as DataNode).serializeXml(tagName, attrs, indent);
    }
    if (type === 'char') {
      if (val === '' || val === null || val === undefined) {
        // MATLAB writes the empty char with neither a body nor a Dimension, whatever
        // its 0x0/1x0 extents say — char_binary.sldd's charEmpty.
        return p + '<' + tagName + attrStr + ' Class="char"/>';
      }
      // The text is already MATLAB's column-major storage order, which is the order
      // this body wants: its own 2x2 ['ab'; 'cd'] is `Dimension="2*2">acbd`. Only the
      // Dimension was missing, so every char BUT a row went out claiming 1xN — a 3x1
      // came back transposed and a 2x3x2 came back flat (defect 25). A row and an
      // empty char carry no attribute, exactly as MATLAB leaves them.
      const text = String(val);
      const dims = this._textDims(text);
      const dimAttr = charNeedsShape(dims) ? ' Dimension="' + dims.join('*') + '"' : '';
      return p + '<' + tagName + attrStr + ' Class="char"' + dimAttr + '>' + escapeXml(text) + '</' + tagName + '>';
    }
    if (type === 'logical') {
      return p + '<' + tagName + attrStr + ' Class="logical">' + (val ? '1' : '0') + '</' + tagName + '>';
    }
    if (type === 'complex') {
      return (
        p +
        '<' +
        tagName +
        attrStr +
        ' Class="double" IsComplex="1">' +
        formatComplexXml(String(val)) +
        '</' +
        tagName +
        '>'
      );
    }
    if (type === 'double') {
      return p + '<' + tagName + attrStr + ' Class="double">' + formatDoubleXml(val as number) + '</' + tagName + '>';
    }
    // No `as number`: an int64/uint64 scalar holds exact decimal TEXT (parseTypedScalar),
    // and formatNumericXml writes one verbatim instead of rounding it through a double.
    return (
      p +
      '<' +
      tagName +
      attrStr +
      ' Class="' +
      type +
      '">' +
      formatNumericXml(val, type) +
      '</' +
      tagName +
      '>'
    );
  }

  _serializeArrayXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string {
    const p = xmlPad(indent);
    const type = this._scalarType;
    const dims = this._dims;
    const rows = dims[0];
    const cols = dims[1];
    // Every extent, not just the first two: an N-D array written as Dimension="2*3"
    // claimed a shape it does not have AND, because the rank-2 transpose fills only
    // rows x cols slots of its result, emitted the remaining pages as empty text —
    // half a 2x3x2 gone from the .slx on save.
    const dimAttr = dims.join('*');
    let attrStr = '';
    if (attrs && attrs.Name) {
      attrStr += ' Name="' + escapeXml(attrs.Name) + '"';
    }

    if (rows === 0 || cols === 0 || (this._elements.length === 0 && this.children.length === 0)) {
      return (
        p + '<' + tagName + attrStr + ' Class="' + (type || 'double') + '" Dimension="' + dimAttr + '"/>'
      );
    }

    const elems =
      this.children.length > 0
        ? this.children.map(function (c) {
            return (c as MatlabVariableNode)._scalarValue;
          })
        : this._elements;

    if (
      type === 'complex' ||
      (elems.length > 0 && typeof elems[0] === 'string' && (elems[0] as string).includes('i'))
    ) {
      const colMajor = transposeToColumnMajorND(elems as string[], dims);
      const formatted = colMajor.map(function (v) {
        return formatComplexXml(String(v));
      });
      return (
        p +
        '<' +
        tagName +
        attrStr +
        ' Class="double" IsComplex="1" Dimension="' +
        dimAttr +
        '">' +
        formatted.join(' ') +
        '</' +
        tagName +
        '>'
      );
    }

    // No `as number` on the element: an int64/uint64 element is an exact decimal
    // STRING (parseTypedVector), and formatNumericXml passes one through verbatim
    // rather than rounding it back into a double (defect 29).
    const colMajor = transposeToColumnMajorND(elems, dims);
    const formatted = colMajor.map(function (v) {
      return formatNumericXml(v, type || 'double');
    });
    const classAttr = type === 'logical' ? 'logical' : type || 'double';
    return (
      p +
      '<' +
      tagName +
      attrStr +
      ' Class="' +
      classAttr +
      '" Dimension="' +
      dimAttr +
      '">' +
      formatted.join(' ') +
      '</' +
      tagName +
      '>'
    );
  }

  _serializeCellXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string {
    const p = xmlPad(indent);
    const dims = this._dims;
    let attrStr = '';
    if (attrs && attrs.Name) {
      attrStr += ' Name="' + escapeXml(attrs.Name) + '"';
    }

    if (this.children.length === 0) {
      return p + '<' + tagName + attrStr + ' Class="cell" Dimension="0*0"/>';
    }

    // dims.join, so a 2x3x2 cell keeps its third extent here as it does in
    // _serializeCellPropertyXml and in what MATLAB itself writes.
    let xml = p + '<' + tagName + attrStr + ' Class="cell" Dimension="' + dims.join('*') + '">\n';
    for (const child of this.children) {
      xml += (child as MatlabVariableNode).serializeXml('Element', {}, indent + 1) + '\n';
    }
    xml += p + '</' + tagName + '>';
    return xml;
  }

  _serializeStringXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string {
    const p = xmlPad(indent);
    const ip = xmlPad(indent + 1);
    const ip2 = xmlPad(indent + 2);
    const ip3 = xmlPad(indent + 3);
    const dims = this._dims;
    const elements =
      this.children.length > 0
        ? this.children.map(function (c) {
            return (c as MatlabVariableNode)._elements
              ? (c as MatlabVariableNode)._elements[0]
              : (c as MatlabVariableNode)._scalarValue;
          })
        : this._elements;

    let attrStr = '';
    if (attrs && attrs.Name) {
      attrStr += ' Name="' + escapeXml(attrs.Name) + '"';
    }

    let xml = p + '<' + tagName + attrStr + '>\n';
    xml += ip + '<Element Class="string">\n';
    xml += ip2 + '<P Source="saveobj" PropertyType="any" Class="cell"';
    if (!(dims.length <= 2 && dims[0] === 1 && dims[1] === 1)) {
      xml += ' Dimension="' + dims.join('*') + '"';
    }
    xml += '>\n';
    for (const str of elements) {
      xml += ip3 + '<Element Class="char">' + escapeXml((str as string) || '') + '</Element>\n';
    }
    xml += ip2 + '</P>\n';
    xml += ip + '</Element>\n';
    xml += p + '</' + tagName + '>';
    return xml;
  }

  // ---- Binary rebuild: the MatVariable the .mat/.slx save path writes ----
  //
  // The MatVariable the save path writes (MatNode.getVariables, and the .slx
  // workspace splice in ModelNode.serialize).
  //
  // `_matVar` is the variable exactly as the parser read it, kept so an untouched
  // variable round-trips byte-for-byte through its `_rawBytes`. But it is a
  // SNAPSHOT: editing a CHILD of this node — an array element, a struct field, a
  // cell entry — mutates the child nodes, not this object, so returning the
  // snapshot wrote the ORIGINAL value back and silently discarded the edit. Only
  // a whole-variable `setProperty('Value', …)` escaped it, because _applyParsed
  // clears the cache; that made the bug look shape-dependent rather than what it
  // is, an edit-depth one.
  //
  // A numeric array happened to survive because `_elements` is the very array
  // `_matVar.value` points at, so element edits landed in both — an aliasing
  // accident, not a design. Struct fields and cell entries hold child NODES and
  // had no such alias, so their edits were lost outright.
  //
  // So once anything below this node changes, the snapshot is no longer the truth
  // and we rebuild from the live tree. `_rawBytes` stays on the rebuilt variable
  // for the parts of the write path that still replay bytes for untouched values.
  get _var(): MatVariable {
    if (this._matVar && !this._varStale) {
      return this._matVar;
    }
    return this._buildVarObject();
  }

  _buildVarObject(): MatVariable {
    const matClassName = this._scalarType === 'logical' ? 'uint8' : this._scalarType;
    const v: MatVariable = {
      name: this.name,
      className: this._isOpaque ? this._opaqueClassName! : matClassName,
      dimensions: this._dims.slice(),
      isComplex: false,
      isLogical: this._scalarType === 'logical',
      value: null,
      fields: null,
      _rawBytes: this._rawBytes,
      _modified: this.status === 'Modified',
    };
    if (this._isOpaque) {
      v.isOpaque = true;
      v.dimensions = [1, 1];
      return v;
    }
    if (this._scalarType === 'struct') {
      v.className = 'struct';
      const fields: Record<string, MatVariable | MatVariable[]> = {};
      if (elementCount(this._dims) > 1) {
        // A struct ARRAY models one child per ELEMENT, each holding that
        // element's fields, so a field rebuilds as one MatVariable per element
        // in the same column-major order MatParser read. This replaces a
        // replay-from-snapshot compensation that could only ever speak for
        // element 1 — an edit to element 2 was silently discarded on save.
        const fieldNames: string[] = [];
        for (const elem of this.children) {
          for (const f of elem.children) {
            if (fieldNames.indexOf(f.name) < 0) {
              fieldNames.push(f.name);
            }
          }
        }
        for (const fname of fieldNames) {
          fields[fname] = this.children.map(function (elem) {
            const f = elem.children.find(function (c) {
              return c.name === fname;
            });
            // A MATLAB struct array is homogeneous, so every element has every
            // field — but a whole-value edit ON an element node clears its
            // children (_applyParsed), and a save must not throw on the way to
            // the writer. An empty [] holds the element's slot; dropping it would
            // slide every later element one position early.
            return f ? (f as MatlabVariableNode)._var : emptyDouble();
          });
        }
      } else {
        for (const child of this.children) {
          fields[child.name] = (child as MatlabVariableNode)._var;
        }
      }
      v.fields = fields;
    } else if (this._kind === 'scalar') {
      v.value = this._scalarValue;
      if (this._scalarType === 'char') {
        v.className = 'char';
        // A char array's shape is NOT its text length. `[1, len]` flattened every
        // char matrix the moment it was modified: MATLAB's own
        // reshape('abcdefghijkl', [2 3 2]) went back into a dictionary as a 1x12
        // row, which MATLAB then read back as one — the value survived, its shape
        // did not. _textDims is the same rule the display uses: _dims wins when it
        // accounts for every character, otherwise the value really is a row vector
        // (the JS-string parse path never knew a length to put in _dims).
        v.dimensions = this._textDims(typeof this._scalarValue === 'string' ? (this._scalarValue as string) : '');
      }
      if (this._scalarType === 'complex') {
        v.className = 'double';
        v.isComplex = true;
        const m = String(this._scalarValue).match(/^([-\d.eE+]+)([+-][\d.eE+]+)i$/);
        if (m) {
          v.value = [{ re: parseFloat(m[1]), im: parseFloat(m[2]) }];
        }
      }
    } else if (this._kind === 'array') {
      const elems =
        this.children.length > 0
          ? this.children.map(function (c) {
              return (c as MatlabVariableNode)._scalarValue;
            })
          : this._elements;
      if (this._isComplexValue()) {
        v.className = 'double';
        v.isComplex = true;
        v.value = (elems as string[]).map(function (s) {
          const m = String(s).match(/^([-\d.eE+]+)([+-][\d.eE+]+)i$/);
          return m ? { re: parseFloat(m[1]), im: parseFloat(m[2]) } : { re: 0, im: 0 };
        });
      } else {
        v.value = elems.length === 1 ? elems[0] : elems;
      }
    } else if (this._kind === 'cell') {
      v.className = 'cell';
      v.value = this.children.map(function (c) {
        return (c as MatlabVariableNode)._var;
      });
    } else if (this._kind === 'string') {
      v.className = 'char';
      const str = this._elements.length === 1 ? (this._elements[0] as string) : (this._elements as string[]).join('');
      v.value = str;
      v.dimensions = [1, str.length];
    }
    return v;
  }

  // ---- Static factories: binary MatVariable -> node ----
  // The entry point is parseMatVariable, which dispatches on the parsed
  // className; the _createFromMat* helpers below are its per-class arms. All of
  // them keep the source `variable` on _matVar and its bytes on _rawBytes, which
  // is what lets an untouched variable round-trip byte-for-byte (see the _var
  // getter). These are statics rather than constructor overloads because the shape
  // isn't known until the value has been inspected.

  static parseMatVariable(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode {
    if (variable.isOpaque) {
      return MatlabVariableNode._createOpaque(variable, name, parent);
    }
    if (variable.className === 'struct') {
      return MatlabVariableNode._createFromMatStruct(variable, name, parent);
    }
    if (variable.className === 'cell') {
      return MatlabVariableNode._createFromMatCell(variable, name, parent);
    }
    if (variable.className === 'char') {
      return MatlabVariableNode._createFromMatChar(variable, name, parent);
    }
    return MatlabVariableNode._createFromMatNumeric(variable, name, parent);
  }

  static _createOpaque(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode {
    const node = new MatlabVariableNode(name, parent, {});
    node._isOpaque = true;
    node._opaqueClassName = variable.className;
    node._rawBytes = variable._rawBytes || null;
    node._matVar = variable;
    return node;
  }

  static createFromMcosDecoded(
    variable: MatVariable,
    decoded: {
      value: unknown;
      properties: Record<string, unknown>;
      dimensions: number[];
      stringElements?: (string | null)[] | null;
    },
    parent: BaseNode | null,
  ): MatlabVariableNode {
    const node = new MatlabVariableNode(variable.name, parent, {});
    node._isOpaque = true;
    node._opaqueClassName = variable.className;
    node._rawBytes = variable._rawBytes || null;
    node._matVar = variable;
    node._mcosProperties = decoded.properties;
    node._mcosValue = decoded.value;
    node._mcosDimensions = decoded.dimensions;
    if (decoded.stringElements) {
      node._adoptStringPayload(decoded.dimensions, decoded.stringElements);
    }
    return node;
  }

  // Give a decoded `string` the state a string array carries on every other path, so one
  // formatter, one child-label rule and one serializer cover all four formats. STAYS
  // OPAQUE: `_isOpaque` is what withholds the editor and the add/remove-child actions, and
  // what keeps `_var` handing back the variable's own bytes verbatim on save. Nothing in
  // this package writes a .mat MCOS subsystem, so a writable string here would be a value
  // typed into a node whose bytes go out unchanged — silent data loss, not an edit.
  private _adoptStringPayload(dims: number[], elements: (string | null)[]): void {
    this._kind = 'string';
    this._scalarType = 'string';
    // COLUMN-major, which is the order the payload stores and the order _formatString and
    // BaseNode.displayName both read a string-kind node's elements in. No transpose.
    this._elements = elements.slice();
    this._dims = dims.slice();
    // The dimensioned envelope a text/binary .sldd uses for a string array. Set so that a
    // string COPIED out of a .mat into a dictionary carries its shape with it rather than
    // flattening to a bare element list (_serializeString reads _array_type to choose).
    this.serial = {
      _array_type: 'String',
      _dimensions: dims.slice(),
      _mw_element_type: 'MATLABArray',
    };
    this._buildStringChildren();
  }

  static _createFromMatNumeric(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode {
    const node = new MatlabVariableNode(name, parent, {});
    node._rawBytes = variable._rawBytes || null;
    node._matVar = variable;
    const dims = variable.dimensions;
    const totalElements = dims.reduce((a, b) => a * b, 1);

    if (variable.isComplex) {
      const arr = Array.isArray(variable.value) ? variable.value : [variable.value];
      if (arr.length === 1) {
        node._kind = 'scalar';
        node._scalarType = 'complex';
        const c = arr[0] as { re: number; im: number };
        node._scalarValue = c.im >= 0 ? c.re + '+' + c.im + 'i' : c.re + '' + c.im + 'i';
        node._dims = [1, 1];
      } else {
        node._kind = 'array';
        node._scalarType = variable.className;
        node._dims = dims.slice();
        node._elements = (arr as { re: number; im: number }[]).map(function (c) {
          return c.im >= 0 ? c.re + '+' + c.im + 'i' : c.re + '' + c.im + 'i';
        });
        node._elements.forEach(function (el, i) {
          const child = MatlabVariableNode._createScalar(el, 'complex', String(i + 1), node);
          node.addChild(child);
        });
      }
      return node;
    }

    if (totalElements === 0) {
      node._kind = 'array';
      node._scalarType = variable.className;
      node._dims = dims.slice();
      node._elements = [];
      return node;
    }

    if (totalElements === 1) {
      node._kind = 'scalar';
      node._scalarType = variable.isLogical ? 'logical' : variable.className;
      node._scalarValue = variable.isLogical ? !!variable.value : variable.value;
      node._dims = [1, 1];
      return node;
    }

    node._kind = 'array';
    node._scalarType = variable.isLogical ? 'logical' : variable.className;
    node._dims = dims.slice();
    const values = Array.isArray(variable.value) ? variable.value : [variable.value];
    node._elements = variable.isLogical
      ? values.map(function (v) {
          return v ? 1 : 0;
        })
      : values;

    node._elements.forEach(function (el, i) {
      const child = MatlabVariableNode._createScalar(el, elementClass(node._scalarType), String(i + 1), node);
      node.addChild(child);
    });
    return node;
  }

  static _createFromMatChar(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode {
    const node = new MatlabVariableNode(name, parent, {});
    node._rawBytes = variable._rawBytes || null;
    node._matVar = variable;
    node._kind = 'scalar';
    node._scalarType = 'char';
    node._scalarValue = (variable.value as string) || '';
    node._dims = variable.dimensions.slice();
    return node;
  }

  static _createFromMatStruct(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode {
    const node = new MatlabVariableNode(name, parent, {});
    node._rawBytes = variable._rawBytes || null;
    node._matVar = variable;
    node._kind = 'scalar';
    node._scalarType = 'struct';
    node._scalarValue = null;
    node._dims = variable.dimensions.slice();

    if (!variable.fields) {
      return node;
    }
    const fieldNames = Object.keys(variable.fields);
    const count = elementCount(node._dims);
    if (count <= 1) {
      for (const fieldName of fieldNames) {
        const fieldVar = variable.fields[fieldName];
        // A 1x1 struct stores the field directly, but tolerate the array form.
        const childVar = Array.isArray(fieldVar) ? fieldVar[0] : fieldVar;
        if (childVar) {
          node.addChild(MatlabVariableNode.parseMatVariable(childVar, fieldName, node));
        }
      }
      return node;
    }

    // A struct ARRAY gets one child per element, each holding that element's own
    // fields. Keeping only fields[f][0] used to make every element after the
    // first invisible, and forced _buildVarObject to replay them from the parse
    // snapshot on save. MatParser fills fields[f] in MATLAB's column-major
    // order, so element ei is MATLAB's linear index ei+1.
    for (let ei = 0; ei < count; ei++) {
      const elemNode = new MatlabVariableNode(String(ei + 1), node, {});
      elemNode._kind = 'scalar';
      elemNode._scalarType = 'struct';
      elemNode._scalarValue = null;
      elemNode._dims = [1, 1];
      elemNode._displayName = subscriptLabel(name, ei, node._dims, 'column-major', '()');
      for (const fieldName of fieldNames) {
        const fieldVar = variable.fields[fieldName];
        const childVar = Array.isArray(fieldVar) ? fieldVar[ei] : fieldVar;
        if (childVar) {
          elemNode.addChild(MatlabVariableNode.parseMatVariable(childVar, fieldName, elemNode));
        }
      }
      node.addChild(elemNode);
    }
    return node;
  }

  static _createFromMatCell(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode {
    const node = new MatlabVariableNode(name, parent, {});
    node._rawBytes = variable._rawBytes || null;
    node._matVar = variable;
    node._kind = 'cell';
    node._scalarType = 'double';
    node._dims = variable.dimensions.slice();

    const cells = Array.isArray(variable.value) ? variable.value : [];
    (cells as (MatVariable | null)[]).forEach(function (cell, i) {
      // MatParser records a slot it could not read as a MATRIX — a truncated or
      // otherwise malformed cell — as null. Skipping those used to COMPACT the
      // child list while _dims kept the declared shape, so every later element
      // slid into the wrong slot: `{[], 2, 3}` displayed as `{2, 3, []}`, and the
      // cell rebuilt for the save path put 2 and 3 one position early. A hole
      // becomes an explicit empty 0x0 double instead, which is both what MATLAB
      // itself shows for an empty cell slot and a value that writes back cleanly.
      const child = MatlabVariableNode.parseMatVariable(cell ?? emptyDouble(), String(i + 1), node);
      node.addChild(child);
    });
    return node;
  }

  // ---- Static factories: JSON value -> node ----
  // `parse` is the single entry point (NodeClassMap routes to it) and the rest are
  // its arms, one per on-disk spelling of a value: the typed {_type,_value}
  // literals, cdata (both the bit-packed and the plain-text complex forms), the
  // structured {_array_type} containers, and the bare JSON scalar/array. They are
  // separate named statics rather than one long switch mainly so the .sldd tests
  // can drive an individual spelling directly. Each stashes the untouched input on
  // `_rawInput` so serializeValue can replay it verbatim.

  static get defaultName(): string {
    return 'Var';
  }

  static createDefault(name: string, parent: BaseNode | null): MatlabVariableNode {
    return MatlabVariableNode._createScalar(0, 'double', name, parent);
  }

  static _createScalar(value: unknown, type: string, name: string, parent: BaseNode | null): MatlabVariableNode {
    const node = new MatlabVariableNode(name, parent, {});
    node._kind = 'scalar';
    node._scalarValue = value;
    node._scalarType = type;
    node._dims = [1, 1];
    return node;
  }

  static parse(rawVal: unknown, name: string, parent: BaseNode | null): MatlabVariableNode {
    if (
      rawVal &&
      typeof rawVal === 'object' &&
      (rawVal as Record<string, unknown>)._type &&
      (rawVal as Record<string, unknown>)._emptyDims
    ) {
      const rv = rawVal as Record<string, unknown>;
      const node = new MatlabVariableNode(name, parent, rv as Record<string, unknown>);
      node._rawInput = rv;
      node._kind = 'array';
      node._elements = [];
      node._dims = rv._emptyDims as number[];
      node._scalarType = rv._type as string;
      return node;
    }
    if (
      rawVal &&
      typeof rawVal === 'object' &&
      (rawVal as Record<string, unknown>)._type &&
      (rawVal as Record<string, unknown>)._value !== undefined &&
      typeof (rawVal as Record<string, unknown>)._value === 'string'
    ) {
      const rv = rawVal as Record<string, unknown>;
      // Before the shape dispatch, because 'mxchar' wears the Matrix() header but is
      // not a numeric array: its numbers are character CODES, and read as numbers they
      // produced a matrix of 97s and 98s typed with a class MATLAB has no such thing as
      // (defect 25).
      if (rv._type === 'mxchar') {
        return MatlabVariableNode.parseMxChar(rv, name, parent);
      }
      // Also before the shape dispatch, and for the same reason. `{_type: 'struct',
      // _value: '[]'}` is MATLAB's only text spelling for struct([]) — the sole
      // _type:'struct' in the whole corpus. Read on its leading '[' it went to
      // parseTypedVector, which took the empty literal for one element of 0 and
      // showed the 0x0 struct as `[0]` with dims 1x1. A struct with FIELDS never
      // arrives this way: MATLAB writes `_array_type: 'Struct'` for rank <= 2 and a
      // cdata byte stream for rank >= 3.
      if (rv._type === 'struct' && /^\[\s*\]$/.test(rv._value as string)) {
        return MatlabVariableNode.parseEmptyStruct(rv, name, parent);
      }
      if ((rv._value as string).indexOf('Matrix(') === 0) {
        return MatlabVariableNode.parseTypedArray(rv, name, parent);
      }
      if ((rv._value as string).charAt(0) === '[') {
        return MatlabVariableNode.parseTypedVector(rv, name, parent);
      }
      return MatlabVariableNode.parseTypedScalar(rv, name, parent);
    }
    if (rawVal && typeof rawVal === 'object' && (rawVal as Record<string, unknown>)._array_type === 'Cell') {
      return MatlabVariableNode.parseCell(rawVal as Record<string, unknown>, name, parent);
    }
    if (rawVal && typeof rawVal === 'object' && (rawVal as Record<string, unknown>)._array_type === 'String') {
      return MatlabVariableNode.parseStructuredString(rawVal as Record<string, unknown>, name, parent);
    }
    if (
      Array.isArray(rawVal) &&
      rawVal.length > 0 &&
      rawVal.every(function (el) {
        return typeof el === 'string';
      })
    ) {
      return MatlabVariableNode.parsePlainStringArray(rawVal, name, parent);
    }
    if (Array.isArray(rawVal)) {
      return MatlabVariableNode.parseFlatArray(rawVal, name, parent);
    }
    return MatlabVariableNode.parseScalar(rawVal, name, parent);
  }

  static parseScalar(rawVal: unknown, name: string, parent: BaseNode | null): MatlabVariableNode {
    const node = new MatlabVariableNode(name, parent, {});
    node._rawInput = rawVal;
    node._kind = 'scalar';
    node._scalarValue = rawVal;
    node._dims = [1, 1];
    if (typeof rawVal === 'boolean') {
      node._scalarType = 'logical';
    } else if (typeof rawVal === 'number') {
      node._scalarType = 'double';
    } else if (typeof rawVal === 'string') {
      node._scalarType = 'char';
    } else {
      node._scalarType = 'double';
      node._scalarValue = rawVal === null || rawVal === undefined ? 0 : rawVal;
    }
    return node;
  }

  /**
   * struct([]) out of a text dictionary. Deliberately the same node
   * `_createFromMatStruct` builds for the same value — scalar kind, 'struct' class,
   * a null scalar value and the real extents — so `<0x0 struct>` is what all four
   * channels show and `displayValue`'s struct arm needs no empty case of its own.
   */
  static parseEmptyStruct(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode {
    const node = new MatlabVariableNode(name, parent, rawVal);
    node._rawInput = rawVal;
    node._kind = 'scalar';
    node._scalarType = 'struct';
    node._scalarValue = null;
    node._dims = [0, 0];
    return node;
  }

  static parseTypedScalar(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode {
    if (rawVal._type === 'cdata') {
      return MatlabVariableNode.parseCdata(rawVal, name, parent);
    }
    const node = new MatlabVariableNode(name, parent, rawVal);
    node._rawInput = rawVal;
    node._kind = 'scalar';
    node._dims = [1, 1];
    node._scalarType = rawVal._type as string;
    const bare = (rawVal._value as string).replace(/[FU]$/, '');
    if (rawVal._type === 'logical') {
      node._scalarValue = bare === '1' || bare === 'true';
    } else if (needsExactInt(node._scalarType)) {
      // Exact decimal TEXT, not a number: cases.sldd's maxU64 is 18446744073709551615,
      // which parseMatlabNum rounds to 18446744073709552000 — a value now OUT of uint64
      // range, which MATLAB refuses on read (defect 29). _scalarValue is `unknown` and
      // needsTypedLiteral keys off the CLASS, so the writer still spells it
      // `Class="uint64"` with the 'U' suffix, from the digits MATLAB itself wrote.
      node._scalarValue = parseExactNum(bare);
    } else {
      node._scalarValue = parseMatlabNum(bare);
    }
    return node;
  }

  static parseCdata(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode {
    const valStr = rawVal._value as string;
    if (/^[\d.eE+\-i\s]+$/.test(valStr)) {
      return MatlabVariableNode._parseCdataText(rawVal, name, parent);
    }
    try {
      const bytes = uudecode(valStr);
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      // 8-byte preamble, then one miMATRIX element: tag (type, byte count) at 8,
      // payload at 16.
      const tagType = dv.getUint32(8, true);
      const tagSize = dv.getUint32(12, true);
      if (tagType !== MI_MATRIX) {
        throw new Error('cdata is not a MAT matrix element');
      }
      const variable = parseMatrix(dv, 16, tagSize);
      const node = MatlabVariableNode.parseMatVariable(variable, name, parent);
      // parseMatVariable's factories set _matVar/_rawBytes but not _rawInput, and
      // an untouched node writes itself back by replaying _rawInput verbatim. Set
      // it so a cdata entry nobody edited still round-trips byte-identical.
      node._rawInput = rawVal;
      return node;
    } catch (_e) {
      const node = new MatlabVariableNode(name, parent, rawVal);
      node._rawInput = rawVal;
      node._kind = 'scalar';
      node._dims = [1, 1];
      node._scalarType = 'char';
      node._scalarValue = valStr;
      return node;
    }
  }

  static _parseCdataText(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode {
    const colMajorParts = (rawVal._value as string)
      .trim()
      .split(/\s+/)
      .map(function (s) {
        return s.replace(/(\d+)\.0(?=[+\-i]|$)/g, '$1');
      });
    if (colMajorParts.length === 1) {
      const node = new MatlabVariableNode(name, parent, rawVal);
      node._rawInput = rawVal;
      node._kind = 'scalar';
      node._dims = [1, 1];
      node._scalarType = 'complex';
      node._scalarValue = colMajorParts[0];
      return node;
    }
    // Every extent, and every page. MATLAB writes a complex 2x3x2 as
    // `IsComplex="1" Dimension="2*3*2"` with twelve column-major values, and
    // BinarySlddParser hands all three extents through; a loop over dims[0] x dims[1]
    // consumed six of the twelve and set _dims = [2,3], so a plain open-and-save
    // wrote MATLAB's own file back with its entire second page missing.
    const dims = effectiveDims((rawVal._dimensions as number[]) || [1, colMajorParts.length]);
    const parts = transposeFromColumnMajorND(colMajorParts, dims);
    const node = new MatlabVariableNode(name, parent, rawVal);
    node._rawInput = rawVal;
    node._kind = 'array';
    node._scalarType = 'double';
    node._dims = dims;
    node._elements = parts;
    parts.forEach(function (el, i) {
      const child = MatlabVariableNode._createScalar(el, 'complex', String(i + 1), node);
      node.addChild(child);
    });
    return node;
  }

  static parseTypedVector(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode {
    const node = new MatlabVariableNode(name, parent, rawVal);
    node._rawInput = rawVal;
    node._kind = 'array';
    node._scalarType = rawVal._type as string;
    const inner = (rawVal._value as string).replace(/^\[/, '').replace(/\]$/, '');
    const parts = inner.split(',').map(function (s) {
      return s.trim().replace(/[FU]$/, '');
    });
    if (rawVal._type === 'logical') {
      node._elements = parts.map(function (s) {
        return s === '1' || s === 'true' ? 1 : 0;
      });
    } else if (needsExactInt(node._scalarType)) {
      // See parseTypedScalar: a 64-bit element is exact decimal TEXT. This is the arm
      // typed_text.sldd's u64Vec2 takes, and rounding it here cost more than the one
      // element — MATLAB abandons the REST of an array's body at the first out-of-range
      // token, so a perfectly representable neighbour came back zero too (defect 30).
      node._elements = parts.map(parseExactNum);
    } else {
      node._elements = parts.map(parseMatlabNum);
    }
    node._dims = [1, node._elements.length];
    if (node._elements.length > 1) {
      node._elements.forEach(function (el, i) {
        const child = MatlabVariableNode._createScalar(el, elementClass(node._scalarType), String(i + 1), node);
        node.addChild(child);
      });
    }
    return node;
  }

  /**
   * MATLAB's `mxchar` literal: a char array of rank >= 2, spelled as character CODES
   * under a `Matrix(r,c)` header with one bracketed group per ROW.
   *
   * It becomes the same node a .mat or a binary dictionary produces for the same value
   * — one char-KIND scalar holding the whole text in MATLAB's column-major storage
   * order, with the real extents on _dims. So `['ab'; 'cd']` reads identically out of
   * all three channels, and the writers (_serializeScalar, _serializeScalarXml,
   * _buildVarObject) each spell it their own way from that single representation.
   *
   * Read as a numeric array instead — which is what the Matrix() dispatch did before
   * this arm existed — the value came back as a 2x2 of 97/98/99/100 with dataType
   * 'mxchar', displayed `[97 98; 99 100]`, and had no char anything about it.
   */
  static parseMxChar(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode {
    const node = new MatlabVariableNode(name, parent, rawVal);
    node._rawInput = rawVal;
    node._kind = 'scalar';
    node._scalarType = 'char';
    const parsed = parseMatrixValue(rawVal);
    if (!parsed) {
      // No header to read. MATLAB never writes this — it spells a row as a bare JSON
      // string, never as a headerless mxchar — but a value with no shape to honour is
      // the row it must mean, and the text is its own body.
      const text = String(rawVal._value ?? '');
      node._scalarValue = text;
      node._dims = [1, text.length];
      return node;
    }
    node._dims = parsed.dims.slice();
    // .map(Number) because parseMatrixValue is typed for the 64-bit case now; a char
    // code is never one, so every element here is already a number.
    node._scalarValue = charTextFromCodes(parsed.elements.map(Number), parsed.dims);
    return node;
  }

  static parseFlatArray(rawVal: unknown[], name: string, parent: BaseNode | null): MatlabVariableNode {
    const node = new MatlabVariableNode(name, parent, rawVal as unknown as Record<string, unknown>);
    node._rawInput = rawVal;
    node._kind = 'array';
    node._elements = rawVal;
    // 0x0 for an empty, not [1, 0]: a bare `[]` is what MATLAB writes for `[]`,
    // whose `size` is 0x0, and the binary dictionary, the .slx and the .mat all
    // report 0x0 for the same value — only the text path said 1x0. 1x0 is the
    // shape of `x=1; x(1)=[]`, which is what _updateArrayAfterRemove produces and
    // is a different value; nothing was removed from a stored `[]`.
    node._dims = rawVal.length === 0 ? [0, 0] : [1, rawVal.length];
    node._scalarType = 'double';
    if (rawVal.length > 1) {
      rawVal.forEach(function (el, i) {
        // elementClass, not the 'double' literal, even though the class above IS
        // 'double': every element builder states the rule the same way, so none of
        // them can drift out of step with the container again.
        const child = MatlabVariableNode._createScalar(el, elementClass(node._scalarType), String(i + 1), node);
        node.addChild(child);
      });
    }
    return node;
  }

  static parseTypedArray(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode {
    const parsed = parseMatrixValue(rawVal);
    if (!parsed) {
      const node = new MatlabVariableNode(name, parent, rawVal);
      node._rawInput = rawVal;
      node._kind = 'array';
      node._elements = [];
      node._dims = [0, 0];
      node._scalarType = rawVal._type as string;
      return node;
    }

    const node = new MatlabVariableNode(name, parent, rawVal);
    node._rawInput = rawVal;
    node._kind = 'array';
    node._elements = parsed.elements;
    node._dims = parsed.dims.slice();
    node._scalarType = parsed.type;
    if (parsed.elements.length > 1) {
      parsed.elements.forEach(function (el, i) {
        const child = MatlabVariableNode._createScalar(el, elementClass(node._scalarType), String(i + 1), node);
        node.addChild(child);
      });
    }
    return node;
  }

  static parseCell(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode {
    const serial = {
      _dimensions: rawVal._dimensions,
      _mw_element_type: rawVal._mw_element_type,
    };
    const node = new MatlabVariableNode(name, parent, serial as Record<string, unknown>);
    node._rawInput = rawVal;
    node._kind = 'cell';
    node._dims = (rawVal._dimensions as number[]) || [1, 1];

    if (rawVal._elements && (rawVal._elements as unknown[]).length > 0) {
      node._buildCellChildren(rawVal._elements as unknown[]);
    }

    return node;
  }

  static parseStructuredString(
    rawVal: Record<string, unknown>,
    name: string,
    parent: BaseNode | null,
  ): MatlabVariableNode {
    const serial = {
      _array_type: rawVal._array_type,
      _dimensions: rawVal._dimensions,
      _mw_element_type: rawVal._mw_element_type,
    };
    const node = new MatlabVariableNode(name, parent, serial as Record<string, unknown>);
    node._rawInput = rawVal;
    node._kind = 'string';
    node._elements = (rawVal._elements as unknown[]) || [];
    node._dims = (rawVal._dimensions as number[]) || [1, node._elements.length];
    node._scalarType = 'string';

    if (node._elements.length > 1) {
      node._elements.forEach(function (el, i) {
        const child = new MatlabVariableNode(String(i + 1), node, { _dimensions: [1, 1] });
        child._kind = 'string';
        child._elements = [el as string];
        child._dims = [1, 1];
        child._scalarValue = el;
        child._scalarType = 'string';
        node.addChild(child);
      });
    }

    return node;
  }

  static parsePlainStringArray(rawVal: string[], name: string, parent: BaseNode | null): MatlabVariableNode {
    const serial = { _dimensions: [1, rawVal.length] };
    const node = new MatlabVariableNode(name, parent, serial as Record<string, unknown>);
    node._rawInput = rawVal;
    node._kind = 'string';
    node._elements = rawVal;
    node._dims = [1, rawVal.length];
    node._scalarType = 'string';

    if (rawVal.length > 1) {
      rawVal.forEach(function (el, i) {
        const child = new MatlabVariableNode(String(i + 1), node, { _dimensions: [1, 1] });
        child._kind = 'string';
        child._elements = [el];
        child._dims = [1, 1];
        child._scalarValue = el;
        child._scalarType = 'string';
        node.addChild(child);
      });
    }

    return node;
  }
}
