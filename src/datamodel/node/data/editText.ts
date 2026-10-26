// Copyright 2026 The MathWorks, Inc.
//
// The text an editor of a value is seeded with where its row shows a summary only for its size:
// the D13 ruling of the 2026-10-26 edit bash. A value past the display's budgets shows its size and
// class, `<1x500 double>`, which is not its value, so the row took no editor of it, and a value
// typed long was locked once it was saved and opened again. Such a value is written out whole
// (DisplayConvention.spelledWhole), and where that text, set as its Value, makes the value exactly,
// the row is edited with it (MatlabVariableNode._editText), its summary still shown.

import type MatlabVariableNode from './MatlabVariableNode.js';
import { EDIT_TEXT_MAX_CHARS, effectiveDims, elementCount, spelledWhole } from '../../display/DisplayConvention.js';
import MatlabValueParser from '../../parser/MatlabValueParser.js';
import { parseComplexNum } from '../../parser/XmlUtils.js';
import { NOT_AVAILABLE } from '../../parser/McosParser.js';
import { withArticle } from '../BaseNode.js';
import { objectWhy, withSizeArticle } from '../editRefusal.js';
import { keptVerdict } from '../valueGeneration.js';

/** Is `text` a summary (DisplayConvention.summaryForm), which is no value's text? */
export function isSummaryText(text: string): boolean {
  return text.charAt(0) === '<' && text.charAt(text.length - 1) === '>';
}

/**
 * The text of `node`'s value written out whole for an editor (MatlabVariableNode._editText), or why
 * there is none, as a clause: a value no text spells at any size (an N-D array, a struct, an object,
 * a sparse array, a cell holding one), one too long to edit as text, and one whose text would make
 * another value of it (a -0 shows as 0). Judged once of a value, until an edit, an undo or a redo in
 * its entry, or a change in its source of what is in no entry, may have changed it
 * (valueGeneration.keptVerdict).
 */
export function wholeText(node: MatlabVariableNode): { text: string } | { why: string } {
  // A cell the node ceiling built without its rows is spelled from a twin rebuilt of what it was
  // read as, which a cell this large is not made for. An array holds its elements without them.
  if (node._cutByCeiling && node._kind === 'cell') {
    return { why: 'it was opened without its rows, the file being too large to show whole' };
  }
  // Asked first, of the value alone, as most summaries are of these: a struct's, an object's.
  const unspelled = unspelledWhy(node);
  if (unspelled !== null) {
    return { why: unspelled };
  }
  return keptVerdict(node, () => judged(node));
}

// wholeText, of a value some text spells at any size: as long as an editor takes, spelled, and its
// text read back as the value.
function judged(node: MatlabVariableNode): { text: string } | { why: string } {
  if (leastLength(node) > EDIT_TEXT_MAX_CHARS) {
    return { why: TOO_LONG };
  }
  const print = valuePrint(node);
  if (print === null) {
    return { why: HOLDS_UNSPELLED };
  }
  const text = spelledWhole(() => node.displayValue);
  if (isSummaryText(text)) {
    return { why: spelledSummaryWhy(node, text) };
  }
  if (node._kind === 'cell' && !spelledWhole(() => node._literalRoundTrips())) {
    return { why: HOLDS_UNSPELLED };
  }
  if (text.length > EDIT_TEXT_MAX_CHARS) {
    return { why: TOO_LONG };
  }
  return madeBy(node, text) === print ? { text } : { why: INEXACT };
}

const ONE_AT_A_TIME = ': its elements are edited one at a time';
const HOLDS_UNSPELLED = 'it holds an element no text spells' + ONE_AT_A_TIME;
const MISSING = '<missing>';
const MISSING_WHY = 'it holds <missing>, which no text spells' + ONE_AT_A_TIME;
const TOO_LONG = 'its text would be longer than the ' + EDIT_TEXT_MAX_CHARS.toLocaleString('en-US') + ' characters an editor of it takes' + ONE_AT_A_TIME;
const INEXACT = 'its text, read back, would not be exactly this value' + ONE_AT_A_TIME;

// Why `node`, written out whole, is still the summary `text`: a <missing> string, an empty that
// shows its size and class as MATLAB's Workspace browser does, `<1x0 logical>`, by the 2026-10-15
// ruling (MatlabVariableNode._formatEmptyArray), which the D12 ruling kept, or an element no text
// spells.
function spelledSummaryWhy(node: MatlabVariableNode, text: string): string {
  if (text === MISSING) {
    return MISSING_WHY;
  }
  if (node._kind === 'array' && node._liveElements().length === 0) {
    return 'it is ' + withArticle('empty ' + node.className) + ' array, shown as MATLAB shows it and not edited here';
  }
  return HOLDS_UNSPELLED;
}

// Why no text spells `node` at any size, of its kind and its rank alone: a struct, an object, a
// function handle, a sparse array, a value of rank 3 or more; or null for one some text may spell.
// A cell is asked of its elements once it is spelled (wholeText).
function unspelledWhy(node: MatlabVariableNode): string | null {
  if (node._undecoded || node._scalarValue === NOT_AVAILABLE) {
    return 'its value could not be read';
  }
  if (node._sparse) {
    return 'it is a sparse array, which no text spells: its non-zeros are edited one at a time';
  }
  if (node._isOpaque && !node._isDecodedString()) {
    return objectWhy(effectiveDims(node.dims).join('x'), node._opaqueClassName || 'object');
  }
  if (node._kind === 'scalar' && node._scalarType === 'struct') {
    return objectWhy(effectiveDims(node._dims).join('x'), 'struct');
  }
  if (node._kind === 'scalar' && (node._scalarType === 'function_handle' || node._unshapedObject())) {
    return 'it is shown here and not edited';
  }
  const dims = effectiveDims(node._kind === 'scalar' && node._scalarType === 'char' ? node._textDims(String(node._scalarValue)) : node._dims);
  if (dims.length > 2) {
    return 'it is ' + withSizeArticle(dims.join('x') + ' ' + node.className) + ' array, which no text spells' + ONE_AT_A_TIME;
  }
  return null;
}

// What `text` makes as `node`'s Value, as its setter makes it (MatlabVariableNode.setProperty), on a
// node that holds nothing else and stands nowhere: the class the value keeps through a numeric edit
// (classAfterEdit), and nothing of `node` changed. Its print (valuePrint), or null where the text is
// refused.
function madeBy(node: MatlabVariableNode, text: string): string | null {
  const read = MatlabValueParser.parseTyped(text);
  if (!read || 'why' in read) {
    return null;
  }
  const Value = node.constructor as new (name: string, parent: null, serial: Record<string, unknown>) => MatlabVariableNode;
  const back = new Value(node.name, null, {});
  back._scalarType = node._scalarType;
  back._applyParsed(read.parsed);
  return valuePrint(back);
}

/**
 * `node`'s value as an exact edit of it leaves it: its kind, class and size and each element, a -0
 * told from a 0 and an imaginary part of 0 kept; a MAT-file's string and a dictionary's alike, as
 * their texts. Null for a value no text makes: a struct, an object, a function handle, a sparse
 * array, and a cell holding one.
 */
export function valuePrint(node: MatlabVariableNode): string | null {
  if (unspelledWhy(node) !== null) {
    return null;
  }
  const size = (dims: number[] | undefined) => effectiveDims(dims).join('x');
  if (node._kind === 'cell') {
    const prints: (string | null)[] = node.children.map((c) => (c instanceof (node.constructor as typeof MatlabVariableNode) ? valuePrint(c) : null));
    if (prints.length !== elementCount(node._dims) || prints.some((p) => p === null)) {
      return null;
    }
    return 'cell ' + size(node._dims) + ' {' + prints.join(', ') + '}';
  }
  const texts = node._stringTexts();
  if (texts) {
    return 'string ' + size(node._kind === 'string' ? node._dims : [1, 1]) + ' ' + JSON.stringify(texts);
  }
  if (node._kind === 'scalar' && node._scalarType === 'char') {
    const text = String(node._scalarValue);
    return 'char ' + size(node._textDims(text)) + ' ' + JSON.stringify(text);
  }
  const complex = node._isComplexValue();
  const cls = node._scalarType === 'complex' ? node._complexClass() : node._scalarType;
  const elements = node._kind === 'array' ? node._liveElements() : [node._scalarValue];
  const parts = elements.map((e) => {
    if (complex && typeof e === 'string') {
      const c = parseComplexNum(e, cls);
      return c ? part(c.re, cls) + ',' + part(c.im, cls) : null;
    }
    return part(e, cls);
  });
  if (parts.some((p) => p === null)) {
    return null;
  }
  return cls + (complex ? ' complex ' : ' ') + size(node._kind === 'array' ? node._dims : [1, 1]) + ' ' + parts.join(' ');
}

// One number as its class holds it: a single at its single precision, a logical as 0 or 1, an
// integer held as exact text (int64, uint64) as that text, and a -0 as itself.
function part(x: unknown, cls: string): string {
  if (typeof x === 'boolean') {
    return x ? '1' : '0';
  }
  if (typeof x === 'number') {
    let n = x;
    if (cls === 'single') {
      n = Math.fround(x);
    } else if (cls === 'logical') {
      n = Number(x !== 0);
    }
    return Object.is(n, -0) ? '-0' : String(n);
  }
  return String(x);
}

// The fewest characters `node`'s text written out whole can be, counted without writing it, and
// no further than past what an editor takes: each element is at least one character and the one
// between it and the next, so that a 1x100000 double is known to be too long without being spelled.
function leastLength(node: MatlabVariableNode): number {
  const between = (n: number, gap: number) => Math.max(n - 1, 0) * gap;
  if (node._kind === 'cell') {
    let n = 2 + between(node.children.length, 2);
    for (const c of node.children) {
      n += c instanceof (node.constructor as typeof MatlabVariableNode) ? leastLength(c) : 1;
      if (n > EDIT_TEXT_MAX_CHARS) {
        break;
      }
    }
    return n;
  }
  if (node._kind === 'string') {
    let n = 2 + between(node._elements.length, 1);
    for (const e of node._elements) {
      n += 2 + (typeof e === 'string' ? e.length : 0);
      if (n > EDIT_TEXT_MAX_CHARS) {
        break;
      }
    }
    return n;
  }
  if (node._kind === 'scalar') {
    // A char's and a string's text in its quotes; any other scalar is one character at least.
    return (node._scalarType === 'char' || node._scalarType === 'string') && typeof node._scalarValue === 'string' ? node._scalarValue.length + 2 : 1;
  }
  const count = elementCount(node._dims);
  return count <= 1 ? count : 2 + count + between(count, 1);
}
