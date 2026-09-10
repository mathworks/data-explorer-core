// Copyright 2026 The MathWorks, Inc.
//
// The rules about a MATLAB VALUE, with no node anywhere in them.
//
// What class a value keeps across an edit, when a number cannot be spelled as a bare
// JSON literal, how a matrix prints and how that printing reads back: every question
// here is answered from the arguments alone. None of these functions reads node state,
// which is why they were module-local functions inside `MatlabVariableNode.ts` rather
// than methods on it — staying off the class is what lets that file's display getters
// and its static parse entry points share them without either side owning the other.
//
// Being a separate module says the same thing one degree louder, and that is the whole
// gain: the rules cannot acquire a `this` even by accident, and a reader asking "what
// happens to an int32 when its Value is edited?" reads one short file instead of
// searching a 2600-line state machine over `_kind` for the four lines that answer it.
// The reverse direction is the useful one too — a change here is visibly a change to
// what a MATLAB value MEANS, not an incidental edit inside a node.
//
// The MATLAB quirks these encode, so that none of them has to be rediscovered as a bug:
//
//   * JSON has ONE number type. `TYPED_NUMERIC_CLASS` names the classes that therefore
//     cannot survive as a bare JSON number, and `classAfterEdit`, `elementClass` and
//     `needsTypedLiteral` are three views of that one set — change any of them and ask
//     whether the other two still mean what they meant.
//   * A char matrix is stored COLUMN-major, so `formatCharMatrix` strides through the
//     text rather than slicing it.
//   * MATLAB's 64-bit integer range is wider than a double's exact one BY
//     CONSTRUCTION, so `parseMatrixValue` keeps int64/uint64 elements as decimal text.
//
// One name to be careful about: `formatMatrix` here is the DISPLAY formatter — the
// `[1 2 3; 4 5 6]` a Value cell shows. `BinarySlddParser` has its own module-local
// `formatMatrix` that builds the `Matrix(...)` SERIAL form a `.sldd` stores. Same name,
// opposite ends of the pipeline, no relation; `parseMatrixValue` below is the one that
// reads that serial form back.
//
// Everything here was module-private before it moved, and is `export`ed only so its one
// consumer, `MatlabVariableNode.ts`, can still reach it. That is a real widening of
// visibility, deliberately stopped at the package boundary: none of these names appears
// in `src/index.ts` or `src/node/index.ts`, so they stay internal to this package and a
// consumer cannot start depending on one.

import { formatMatlabChar, formatMatlabString } from '../../parser/MatlabValueParser.js';
import type { MatVariable } from '../../parser/MatParser.js';
import { EMPTY_NUMERIC, MISSING_STRING } from '../../display/DisplayConvention.js';
import { formatMatlabNum, parseMatlabNum, parseExactNum, needsExactInt } from '../../parser/XmlUtils.js';

// An empty 0x0 double, MATLAB's own `[]`. Stands in for a cell slot the parser
// could not read (see _createFromMatCell) and for a struct-array element that no
// longer has one of the array's fields (see _buildVarObject): in both places a
// hole must stay a hole, or every later element slides one slot early.
// A fresh object per call, since the node built from it keeps a reference.
export function emptyDouble(): MatVariable {
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
export function formatStringElement(el: unknown): string {
  if (el === null) return MISSING_STRING;
  return formatMatlabString(el !== undefined ? String(el) : '');
}

// The MATLAB numeric classes a bare JSON number cannot carry. JSON has ONE number
// type, so an int32 or a single written as a plain number reads back as a double —
// a silent class change, not a rounding nit. `double` needs no tag.
export const TYPED_NUMERIC_CLASS = /^(?:u?int(?:8|16|32|64)|single)$/;

// The class a value keeps across an edit. A Value edit sets the VALUE, not the
// class — MATLAB's own `v(:) = 7` on an int32 stays int32, and the Data Type
// column is read-only here — but MatlabValueParser cannot know the class: a bare
// `7` always parses as 'double'. So the node's existing class beats the parser's
// default. Only the integer/single classes qualify: every number is representable
// in them, whereas keeping 'logical' would render `7` as `true`, which MATLAB
// rejects outright.
export function classAfterEdit(current: string, parsedType: string): string {
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
// text (see MatlabVariableNode's icon getter and _formatScalar), which is the point:
// the row should look like the logical scalar it is, checkbox included. It is also why
// _setConstrainedValue has a logical arm — a row that reads 'true' has to accept 'true'.
//
// Cell and struct children never come through here: they are independent values, and
// their container has no one class to hand down.
export function elementClass(arrayClass: string): string {
  return TYPED_NUMERIC_CLASS.test(arrayClass) || arrayClass === 'logical' ? arrayClass : 'double';
}

// True when a scalar has to be written as the format's typed {_type,_value}
// literal rather than a bare JSON value. Both reasons are silent data loss:
// an int32/single written bare reads back as double (see TYPED_NUMERIC_CLASS),
// and JSON has no literal for Inf/NaN — JSON.stringify writes `null`, which reads
// back as 0. A `logical` normally travels as a JS boolean and needs no tag, except
// when it came from an array, whose elements the parser stores as 1/0.
export function needsTypedLiteral(type: string, value: unknown): boolean {
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
export function formatMatrix(rows: number, cols: number, elements: unknown[]): string {
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
export function formatCharMatrix(text: string, dims: number[]): string {
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

export function parseMatrixValue(
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
