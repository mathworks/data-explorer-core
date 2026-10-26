// Copyright 2026 The MathWorks, Inc.

import type { MatVariable } from './MatParser.js';
import { classPhrase } from './MatWriter.js';
import { unitExpressionRefusal } from './unitExpression.js';

// Which properties of an MCOS object in a MAT-file's subsystem a save can set, to what, and what
// it writes for each: a triple's value swapped, a triple inserted for a property that was at its
// default, a triple removed for one set back to it, and the other triples MATLAB's own setter
// changes with it. The allow-list a MAT-file's save holds an object edit to (MatNode, through
// mcosObjectEdit), so that what MATLAB loads is the object MATLAB's own `x.Prop = v` makes, with no
// warning; McosEditRules, the cell swap's rules, is kept for the objects of a dictionary's value
// stream, which this round does not widen.
//
// Measured against MATLAB R2027a: 855 edits over Simulink.Parameter, Signal, Bus, BusElement,
// ValueType, LookupTable, Breakpoint (and their Table, Breakpoints and StructTypeInfo),
// NumericType, AliasType and the CoderInfo of a data object, each written by these rules and
// judged against MATLAB's own assignment on a fresh load of the same file: every one written
// loads equal, quiet, and survives a MATLAB re-save; every one MATLAB refuses (139) or warns of
// (23) is refused here too. And the same edits of objects MATLAB R2023b and R2024b wrote, and of
// objects merged from R2023b's templates, and 234 edits of a CoderInfo's StorageClass, Identifier
// and Alignment, each loaded in R2023b, R2024b and R2027a and judged so.
//
// OTHER RELEASES. Nothing names the release a MAT-file is of, so nothing here asks: what differs
// is read off the object. R2023b and R2024b write their defaults structs mostly empty, so on their
// objects every edit is a swap; R2023b holds enumerated text as a char cell where later releases
// hold an index into the file's text, and an edit keeps the encoding of the triple the object
// holds; a property an object neither holds nor has a default for is one its release does not
// save, and is refused; and a CoderInfo saved as a 'handle' opaque (R2024b and earlier) is the
// object of its own small blob (McosRuleObject.handle), which the codec edits as MATLAB does.
//
// WHY RULES. MATLAB runs each property's setter as it loads an object, in the order of its
// property list, and a value the setter refuses does not fail the load: the property loads as
// its default, silently. A numeric Description loads as '', a Bus Alignment of 3 as -1, a
// DataTypeMode of 'double' as 'Double'. Some setters change what they take (a white-space
// Description becomes '', a HeaderFile is trimmed, an Alignment of 2.5 is 2), so text and
// numbers are held to what loads as written, and refused otherwise. And some are not run at all:
// a BusElement's Min and Max are set past their setters on load, so an int16 or an Inf Min loads
// as an invalid object, quiet; the checks MATLAB makes only at the assignment are made here.
//
// WHAT IS WRITTEN. A property whose saved name is a field of its class's defaults struct in THE
// FILE (the per-class cell beside the class row) is omitted by MATLAB while its value is identical
// to that field, and loads from it: setting it there removes its triple, setting it away from it
// inserts one. Measured: an omitted property loads from the file's own defaults struct, not from
// the class, so the file's is the default compared with. Any other property is saved always, and
// an edit swaps its triple's value. Each row below says the name a property is saved under and how
// its value is held (a value cell, an index into the string table, an integer); a triple held
// another way is from a layout these rules were not measured on, and refused. MATLAB's setters
// are order-dependent only where a row's effect says so (a NumericType's mode, a bus element's
// names), so the edits of one object are applied in the order they were made.
//
// Pure: what the object holds goes in, read by the caller from the subsystem's records, and the
// triple operations come out, or the first edit refused and why, in words naming it.

/** How a triple holds its value: a value cell, an index into the string table, an integer. */
export type McosHeldKind = 'cell' | 'str' | 'int';

/** One triple an object holds, by what its value is. */
export type McosHeldValue =
  | { kind: 'cell'; value: MatVariable | null }
  | { kind: 'str'; text: string }
  | { kind: 'int'; value: number }
  // An object id, or a triple of a kind past the four MATLAB writes.
  | { kind: 'other' };

/** An object as the rules read it. */
export interface McosRuleObject {
  className: string;
  // Every triple of its property list, by saved name.
  held: ReadonlyMap<string, McosHeldValue>;
  // The fields of its class's defaults struct in the file, read: what an omitted property loads as.
  defaults: ReadonlyMap<string, MatVariable>;
  // Whether it is the object of a 'handle' opaque (a CoderInfo saved by MATLAB R2024b or earlier,
  // and every one from the R2023b templates): its own small blob, every property always saved.
  handle?: boolean;
}

/** A property's new value, by the property's public name ('Unit', not 'DocUnits'). */
export interface McosRuleEdit {
  property: string;
  value: MatVariable;
}

/** The edits of one object of a save. */
export interface McosRuleTarget {
  // What a message names the object by: its MATLAB path, `s.p`, `b.Elements(2)`, `p.CoderInfo`.
  key: string;
  object: McosRuleObject;
  edits: readonly McosRuleEdit[];
  // For a Simulink.BusElement: its bus (by the bus's key) and every element of it, in order,
  // this one at `index`. MATLAB checks the names of a bus's elements unique at each assignment,
  // and its load does not, so the elements of one bus are judged together.
  bus?: { key: string; elements: readonly McosRuleObject[]; index: number };
}

/** One change to an object's property list. */
export type McosTripleOp =
  | { op: 'set'; savedName: string; kind: 'cell'; value: MatVariable }
  | { op: 'set'; savedName: string; kind: 'str'; text: string }
  | { op: 'set'; savedName: string; kind: 'int'; value: number }
  | { op: 'remove'; savedName: string };

export type McosRulePlan =
  | { ok: true; objects: { key: string; ops: McosTripleOp[] }[] }
  | { ok: false; key: string; property: string; message: string };

// ---- Values ------------------------------------------------------------------------------------

const NUMERIC = new Set(['double', 'single', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64']);

// MATLAB's class of `v`: a logical array is class uint8 with the logical flag.
function classOf(v: MatVariable): string {
  return v.isLogical || v.className === 'logical' ? 'logical' : v.className;
}

function dimsOf(v: MatVariable): number[] {
  const d = (v.dimensions ?? [1, 1]).slice();
  while (d.length < 2) {
    d.push(1);
  }
  return d;
}

function numelOf(v: MatVariable): number {
  return dimsOf(v).reduce((a, b) => a * b, 1);
}

function flat(value: unknown): unknown[] {
  if (value === null || value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/**
 * The real parts of a numeric or logical variable, and its imaginary parts when it is complex, as
 * numbers in the order it holds them (an exact 64-bit token as the double nearest it); null for
 * another class, or one holding an element that is not a number.
 */
function partsOf(v: MatVariable): { re: number[]; im: number[] | null } | null {
  const cls = classOf(v);
  if (!NUMERIC.has(cls) && cls !== 'logical') {
    return null;
  }
  const re: number[] = [];
  const im: number[] | null = v.isComplex ? [] : null;
  for (const x of flat(v.value)) {
    if (x !== null && typeof x === 'object' && 're' in (x as Record<string, unknown>)) {
      re.push(Number((x as Record<string, unknown>).re));
      (im ?? []).push(Number((x as Record<string, unknown>).im));
    } else if (typeof x === 'number' || typeof x === 'bigint' || typeof x === 'boolean' || typeof x === 'string') {
      re.push(Number(x));
      im?.push(0);
    } else {
      return null;
    }
  }
  return re.length === numelOf(v) ? { re, im } : null;
}

/** The text of a char variable, or null for one that is not one row of text ('' a 0x0 char or a 1x0). */
function textOf(v: MatVariable): string | null {
  if (classOf(v) !== 'char' || v.isComplex) {
    return null;
  }
  const d = dimsOf(v);
  if (d.length !== 2 || !(d[0] === 1 || d[0] * d[1] === 0)) {
    return null;
  }
  return typeof v.value === 'string' ? v.value : v.value === null || v.value === undefined || (Array.isArray(v.value) && v.value.length === 0) ? '' : null;
}

/** The one real number a real numeric scalar holds, or null. */
function scalarOf(v: MatVariable): number | null {
  const parts = numelOf(v) === 1 ? partsOf(v) : null;
  return parts && parts.im === null ? parts.re[0] : null;
}

function sameNumber(a: number, b: number): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

/**
 * Whether `a` and `b` are one value as MATLAB's omission compares them: the same class, size and
 * complexity, and the same elements, NaN equal to NaN; text by its characters; a struct by its
 * fields in order, a cell by its members. Class- and size-strict: `zeros(1,0)` is not `[]`, and is
 * saved.
 */
export function identicalValues(a: MatVariable | null | undefined, b: MatVariable | null | undefined): boolean {
  if (!a || !b) {
    return a === b;
  }
  const cls = classOf(a);
  if (cls !== classOf(b) || dimsOf(a).join('x') !== dimsOf(b).join('x') || !!a.isComplex !== !!b.isComplex || !!a.isSparse !== !!b.isSparse) {
    return false;
  }
  if (cls === 'char') {
    return (textOf(a) ?? String(a.value ?? '')) === (textOf(b) ?? String(b.value ?? ''));
  }
  if (cls === 'struct') {
    const fa = a.fields ?? {};
    const fb = b.fields ?? {};
    const names = Object.keys(fa);
    if (names.join(',') !== Object.keys(fb).join(',')) {
      return false;
    }
    return names.every((n) => {
      const x = flat(fa[n]) as MatVariable[];
      const y = flat(fb[n]) as MatVariable[];
      return x.length === y.length && x.every((m, i) => identicalValues(m, y[i]));
    });
  }
  if (cls === 'cell') {
    const x = flat(a.value) as (MatVariable | null)[];
    const y = flat(b.value) as (MatVariable | null)[];
    return x.length === y.length && x.every((m, i) => identicalValues(m, y[i]));
  }
  const pa = partsOf(a);
  const pb = partsOf(b);
  if (!pa || !pb || a.isSparse) {
    return false;
  }
  const same = (x: number[], y: number[]) => x.length === y.length && x.every((n, i) => sameNumber(n, y[i]));
  return same(pa.re, pb.re) && (pa.im === null || same(pa.im, pb.im!));
}

function variable(className: string, dimensions: number[], value: unknown, more: Partial<MatVariable> = {}): MatVariable {
  return { name: '', className, dimensions, isComplex: false, isLogical: false, value, fields: null, ...more };
}

/** Text as MATLAB holds it in a property: a char row, '' as a 0x0 char. */
function charValue(text: string): MatVariable {
  return variable('char', text === '' ? [0, 0] : [1, text.length], text);
}

/** A double row of `xs`, a scalar for one. */
function doubleRow(xs: readonly number[]): MatVariable {
  return variable('double', [1, xs.length], xs.length === 1 ? xs[0] : xs.slice());
}

function logicalValue(b: boolean): MatVariable {
  return variable('logical', [1, 1], b ? 1 : 0, { isLogical: true });
}

const EMPTY_LOGICAL: MatVariable = variable('logical', [0, 0], [], { isLogical: true });

// MATLAB's size(v) as a Parameter's Dimensions holds it: at least two extents, no trailing
// singleton past the second; text a string scalar's, 1x1, as a Parameter holds text.
function sizeOf(v: MatVariable): number[] {
  if (classOf(v) === 'char') {
    return [1, 1];
  }
  const d = dimsOf(v);
  while (d.length > 2 && d[d.length - 1] === 1) {
    d.pop();
  }
  return d;
}

function isWhole(x: number): boolean {
  return Number.isFinite(x) && Math.trunc(x) === x;
}

function numberText(x: number): string {
  return Number.isNaN(x) ? 'NaN' : x === Infinity ? 'Inf' : x === -Infinity ? '-Inf' : String(x);
}

// `text` in single quotes, for a message, a control character in it spelled as an escape.
function quoted(text: string): string {
  const spelled: Record<string, string> = { '\n': '\\n', '\t': '\\t', '\r': '\\r' };
  return "'" + text.replace(/[\x00-\x1f\x7f]/g, (c) => spelled[c] ?? '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')) + "'";
}

// What `v` is, for a message: 'a char', 'a 1x2 double'.
function whatIs(v: MatVariable): string {
  return 'a ' + dimsOf(v).join('x') + ' ' + (classOf(v) || 'value');
}

// ---- Checks --------------------------------------------------------------------------------------
//
// Each takes the value an edit gives a property and answers the value to write, in the form MATLAB
// holds it, or throws a refusal saying, in words naming the property (`named`, `p.Min`), why not.

class Refused extends Error {
  constructor(readonly property: string, message: string) {
    super(message);
  }
}

// The property a check is running for, which a refusal names: set by the planner around each edit.
let current = '';

function refuse(message: string): never {
  throw new Refused(current, message);
}

/**
 * What a text property's setter does with white space, measured per property:
 *
 *   - keep: any text loads as written (a BusElement's Unit and Description, a ValueType's, a lookup
 *     table's Table and Breakpoint text, a StructTypeInfo's HeaderFileName);
 *   - blank: text of white space alone loads as '' (a Description of a Parameter, Signal, Bus,
 *     NumericType or AliasType; a Unit of a Parameter or a Signal), so it is refused;
 *   - trim: the setter trims both ends (a HeaderFile of a Bus, NumericType or AliasType, an
 *     AliasType's BaseType, a Signal's InitialValue, every DataType), so text with white space at
 *     an end is refused.
 */
type WhiteSpace = 'keep' | 'blank' | 'trim';

function loneSurrogate(text: string): boolean {
  return /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF])/.test(text);
}

function takeText(v: MatVariable, named: string, ws: WhiteSpace): MatVariable {
  const t = textOf(v);
  if (t === null) {
    refuse(named + ' must be text: MATLAB refuses ' + whatIs(v) + ', and the file would load it as the default');
  }
  if (loneSurrogate(t)) {
    refuse(named + ' holds a lone UTF-16 surrogate, which the file would hold as another character');
  }
  if (ws === 'blank' && t !== '' && trimmed(t) === '') {
    refuse(named + ' would be ' + quoted(t) + ", which MATLAB would load as '': it loads text of white space alone as empty");
  }
  if (ws === 'trim' && t !== trimmed(t)) {
    refuse(named + ' would be ' + quoted(t) + ', which MATLAB would load as ' + quoted(trimmed(t)) + ': it trims the white space at either end');
  }
  return charValue(t);
}

// `t` with the white space at either end taken off, as MATLAB's setters take it off (measured
// against MATLAB R2027a): what JavaScript trims, and NEL (U+0085), which it does not. Taken off too,
// so that text ending in one is refused rather than written: U+FEFF, which JavaScript trims and those
// setters keep (a HeaderFile's refuses it); and U+001C to U+001F, which they keep, and which the
// rule this port was verified against counts as white space.
function trimmed(t: string): string {
  return t.replace(/^[\s\u0085\u001c-\u001f]+|[\s\u0085\u001c-\u001f]+$/g, '');
}

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

// The longest name MATLAB R2024b and earlier take (namelengthmax): they refuse a longer
// LookupTable FieldName, TunableSizeName or StructTypeInfo.Name, and load one as the old name.
const OLD_NAME_LENGTH_MAX = 63;

function takeIdentifier(v: MatVariable, named: string, emptyOk = false, maxLength?: number): MatVariable {
  const t = takeText(v, named, 'keep').value as string;
  if (t === '' && emptyOk) {
    return charValue('');
  }
  if (!IDENTIFIER.test(t)) {
    refuse(named + ' must be a MATLAB identifier: MATLAB refuses ' + quoted(t) + ', and the file would load it as the default');
  }
  if (maxLength !== undefined && t.length > maxLength) {
    refuse(named + ' is ' + t.length + ' characters: MATLAB R2024b and earlier refuse a name longer than ' + maxLength + ', and load the file with the old one');
  }
  return charValue(t);
}

function takeChoice(v: MatVariable, named: string, choices: readonly string[]): string {
  const t = textOf(v);
  if (t === null || !choices.includes(t)) {
    refuse(named + ' must be one of ' + choices.map((c) => "'" + c + "'").join(', ') + ', spelled so: MATLAB refuses or re-spells '
      + (t === null ? whatIs(v) : quoted(t)));
  }
  return t;
}

/** A Min or a Max: a finite real double scalar, or an empty double, written as given. */
function takeBound(v: MatVariable, named: string): MatVariable {
  const n = numelOf(v);
  const x = n === 1 ? scalarOf(v) : null;
  if (classOf(v) !== 'double' || v.isComplex || v.isSparse || !(n === 0 || (x !== null && Number.isFinite(x)))) {
    refuse(named + ' must be a finite real double scalar or []: MATLAB refuses anything else, and the file would load it as []');
  }
  return { ...v, name: '' };
}

/** A logical property: true or false, or a real number 0 or 1, as the integer 0 or 1 its triple holds. */
function takeFlag(v: MatVariable, named: string): number {
  const cls = classOf(v);
  const x = numelOf(v) === 1 && (cls === 'logical' || NUMERIC.has(cls)) ? scalarOf(v) : null;
  if (x === null) {
    refuse(named + ' must be true or false: MATLAB refuses anything else');
  }
  if (!Number.isFinite(x)) {
    refuse(named + ' must be true or false, or 0 or 1: MATLAB refuses ' + numberText(x));
  }
  if (x !== 0 && x !== 1) {
    refuse(named + ' must be true or false, or 0 or 1: MATLAB makes ' + numberText(x) + ' true');
  }
  return x;
}

/** A Dimensions: a double row of positive whole numbers, or -1 where `minusOne`. */
function takeDimensions(v: MatVariable, named: string, minusOne: boolean): MatVariable {
  const d = dimsOf(v);
  const parts = classOf(v) === 'double' && !v.isComplex && !v.isSparse && d.length === 2 && d[0] === 1 && d[1] >= 1 ? partsOf(v) : null;
  if (!parts) {
    refuse(named + ' must be a double row of positive whole numbers' + (minusOne ? ', or -1' : '')
      + ': MATLAB refuses anything else (a symbolic char MATLAB takes is not written here)');
  }
  const xs = parts.re;
  if (minusOne && xs.length === 1 && xs[0] === -1) {
    return doubleRow(xs);
  }
  let product = 1;
  for (const x of xs) {
    if (!(isWhole(x) && x > 0)) {
      refuse(named + ' must hold positive whole numbers' + (minusOne ? ', or be -1' : '') + ': MATLAB refuses ' + numberText(x));
    }
    product *= x;
  }
  if (product > 2147483647) {
    refuse(named + ' declares more than 2^31-1 elements, which MATLAB refuses');
  }
  if (xs.length > 2 && xs[xs.length - 1] === 1) {
    refuse(named + ' has a trailing 1 past its second extent, which MATLAB refuses');
  }
  return doubleRow(xs);
}

// What a data type may be written as: a builtin name, fixdt of a signedness and a word length then
// up to three numbers and the 'DataTypeOverride' pair, or of one quoted name; an enumeration, a bus
// or a value type of a dotted name; or an alias, a dotted name. Spelled with no white space at
// either end and no control character: every DataType setter trims, and takes any text, so
// `'Enum: E '` would load as other text than was written.
const NAME = '[A-Za-z][A-Za-z0-9_]*';
const DOTTED = NAME + '(?:\\.' + NAME + ')*';
const NUMBER = '[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?';
const COMMA = ' *, *';
const FIXDT_ARGS = "'" + NAME + "'"
  + '|(?:0|1|true|false)' + COMMA + '[1-9][0-9]*(?:' + COMMA + NUMBER + '){0,3}'
  + '(?:' + COMMA + "'DataTypeOverride'" + COMMA + "'(?:Off|Inherit)')?";
const FIXDT = 'fixdt\\( *(?:' + FIXDT_ARGS + ') *\\)';
const BUILTIN = new Set(['double', 'single', 'half', 'boolean', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64']);

/** Which forms of data type a property takes beyond a builtin, fixdt, an enumeration and an alias. */
interface DataTypeForms {
  auto: boolean;
  bus: boolean;
  valueType: boolean;
  string: boolean;
}

function takeDataType(v: MatVariable, named: string, forms: DataTypeForms): MatVariable {
  const t = takeText(v, named, 'trim').value as string;
  if (/[\x00-\x1f]/.test(t)) {
    refuse(named + ' would be ' + quoted(t) + ', which holds a control character, which no data type does');
  }
  if (t === 'auto') {
    if (!forms.auto) {
      refuse(named + " cannot be 'auto': MATLAB refuses it, and the file would load it as the default");
    }
    return charValue(t);
  }
  if (t === 'string' && !forms.string) {
    refuse(named + " would be 'string', which this editor does not write here");
  }
  const patterns = [FIXDT, 'Enum: *' + DOTTED, DOTTED];
  if (forms.bus) {
    patterns.push('Bus: *' + DOTTED);
  }
  if (forms.valueType) {
    patterns.push('ValueType: *' + DOTTED);
  }
  if (!new RegExp('^(?:' + patterns.join('|') + ')$').test(t)) {
    refuse(named + ' would be ' + quoted(t) + ', which is not a data type this editor writes here');
  }
  if (/^(?:Bus|ValueType):/.test(t) && !/^(?:Bus|ValueType): /.test(t)) {
    refuse(named + ' would be ' + quoted(t) + ': written as MATLAB spells it, with one space after the colon');
  }
  return charValue(t);
}

// The range of each builtin data type a double is held to: a Value, a Min or a Max out of it warns
// on every load. The top of int64 and uint64, 2^63 - 1 and 2^64 - 1, is no double: the nearest is
// 2^63 or 2^64, which is out, so a double is held below it there.
const INTEGER_RANGE: Record<string, [number, number]> = {
  int8: [-128, 127],
  uint8: [0, 255],
  int16: [-32768, 32767],
  uint16: [0, 65535],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  int64: [-(2 ** 63), 2 ** 63],
  uint64: [0, 2 ** 64],
};
const REALMAX_SINGLE = 3.4028234663852886e38;

function rangeOf(dt: string): [number, number] | null {
  if (dt === 'boolean') {
    return [0, 1];
  }
  if (dt === 'single') {
    return [-REALMAX_SINGLE, REALMAX_SINGLE];
  }
  if (dt === 'double') {
    return [-Infinity, Infinity];
  }
  return INTEGER_RANGE[dt] ?? null;
}

function outside(dt: string, x: number): boolean {
  const r = rangeOf(dt);
  if (!r) {
    return false;
  }
  return x < r[0] || (dt === 'int64' || dt === 'uint64' ? x >= r[1] : x > r[1]);
}

function rangeText(dt: string): string {
  const r = rangeOf(dt)!;
  if (dt === 'int64') return '[-9223372036854775808, 9223372036854775807]';
  if (dt === 'uint64') return '[0, 18446744073709551615]';
  if (dt === 'single') return "[-realmax('single'), realmax('single')]";
  return '[' + numberText(r[0]) + ', ' + numberText(r[1]) + ']';
}

// ---- An object as an edit leaves it ---------------------------------------------------------------

/** A triple as the edits of a save leave it. */
type Now =
  | { kind: 'cell'; value: MatVariable | null }
  | { kind: 'str'; text: string }
  | { kind: 'int'; value: number }
  | { kind: 'other' };

const KIND_WORDS: Record<string, string> = { cell: 'a value', str: "an index into the file's text", int: 'an integer', other: 'an object' };

/**
 * The object an edit works on: its triples as the edits so far leave them (`now`, in list order,
 * a triple inserted last), over what the file holds (`object.held`) and the file's defaults.
 */
class Working {
  readonly now = new Map<string, Now>();
  // The saved names an edit or a setter effect set: the only ones a triple is written for.
  readonly touched = new Set<string>();

  constructor(readonly key: string, readonly object: McosRuleObject) {
    for (const [saved, held] of object.held) {
      this.now.set(saved, held.kind === 'cell' ? { kind: 'cell', value: held.value } : held);
    }
  }

  get className(): string {
    return this.object.className;
  }

  /** The value the property loads with: its triple's, else the file's default; undefined for neither. */
  get(saved: string): MatVariable | string | number | null | undefined {
    const t = this.now.get(saved);
    if (t) {
      return t.kind === 'cell' ? t.value : t.kind === 'str' ? t.text : t.kind === 'int' ? t.value : null;
    }
    return this.object.defaults.get(saved);
  }

  /** get() of a value property, as a variable: null for an index, an integer, or a cell that does not read. */
  value(saved: string): MatVariable | null {
    const x = this.get(saved);
    return x && typeof x === 'object' ? x : null;
  }

  /** get() as text: an index's string, or a char value's text; null for neither. */
  text(saved: string): string | null {
    const x = this.get(saved);
    return typeof x === 'string' ? x : x && typeof x === 'object' ? textOf(x) : null;
  }

  /** get() of a real numeric scalar, as its number; null for anything else. */
  number(saved: string): number | null {
    const v = this.value(saved);
    return v ? scalarOf(v) : null;
  }

  /**
   * The property saved as `saved` given `value`, held as `kind` by the class table: its triple
   * removed where it is a field of the file's defaults struct and the value is identical to it,
   * which is where MATLAB saves none; else held, in the encoding of the triple the object holds
   * (heldEncoding), the table's only for a triple inserted. A property the object neither holds nor
   * finds in its defaults struct is one the release that wrote it does not save (MATLAB R2023b's
   * lookuptable.Breakpoint has no TunableSizeValue), and is refused.
   */
  put(saved: string, kind: McosHeldKind, value: MatVariable | string | number): void {
    const held = this.object.held.get(saved);
    if (!held && !this.object.defaults.has(saved)) {
      refuse(this.key + '.' + publicNameOf(this.className, saved) + ' is not a property the MATLAB release that wrote this object saves, '
        + 'nor one its class records a default of in the file');
    }
    [kind, value] = this.heldEncoding(saved, kind, value);
    this.set(saved, kind, value);
  }

  /** `put` without its checks, for a setter that knows the encoding MATLAB writes (a 'handle' CoderInfo's). */
  set(saved: string, kind: McosHeldKind, value: MatVariable | string | number): void {
    this.touched.add(saved);
    if (this.isDefault(saved, kind, value)) {
      this.now.delete(saved);
      return;
    }
    // In its place where it is held (a Map keeps a key's place on a set), last where it is new.
    this.now.set(saved, kind === 'cell' ? { kind, value: value as MatVariable } : kind === 'str' ? { kind, text: value as string } : { kind, value: value as number });
  }

  /**
   * The encoding a value of the property saved as `saved` is written in, and the value in it: the
   * table's `kind` for a triple inserted; else the triple's own, which differs by release (R2023b
   * saves a Parameter's Complexity and a Signal's enumerated text as a char cell, where R2024b and
   * later save an index into the file's text). Text goes between an index and a char cell, a flag
   * between an integer and a logical cell; any other pair is refused.
   */
  heldEncoding(saved: string, kind: McosHeldKind, value: MatVariable | string | number): [McosHeldKind, MatVariable | string | number] {
    const held = this.object.held.get(saved);
    if (!held || held.kind === kind) {
      return [kind, value];
    }
    if (held.kind === 'cell' && kind === 'str') {
      return ['cell', charValue(value as string)];
    }
    if (held.kind === 'str' && kind === 'cell' && typeof value === 'object' && textOf(value) !== null) {
      return ['str', textOf(value)!];
    }
    if (held.kind === 'cell' && kind === 'int') {
      return ['cell', logicalValue(value === 1)];
    }
    if (held.kind === 'int' && kind === 'cell' && typeof value === 'object' && classOf(value) === 'logical' && numelOf(value) === 1) {
      return ['int', scalarOf(value)!];
    }
    refuse(this.key + '.' + publicNameOf(this.className, saved) + ' is held in this file as ' + KIND_WORDS[held.kind] + ', where this editor writes '
      + KIND_WORDS[kind] + ': a layout it was not measured on');
  }

  isDefault(saved: string, kind: McosHeldKind, value: MatVariable | string | number): boolean {
    const d = this.object.defaults.get(saved);
    if (!d) {
      return false;
    }
    if (kind === 'str') {
      return classOf(d) === 'char' && textOf(d) === value;
    }
    if (kind === 'int') {
      const cls = classOf(d);
      return (cls === 'logical' || NUMERIC.has(cls)) && numelOf(d) === 1 && scalarOf(d) === value;
    }
    return identicalValues(value as MatVariable, d);
  }

  /** What the edits change of the file's triples: each set where it differs from what is held, then each removed. */
  ops(): McosTripleOp[] {
    const out: McosTripleOp[] = [];
    for (const [savedName, t] of this.now) {
      const was = this.object.held.get(savedName);
      if (!this.touched.has(savedName) || t.kind === 'other' || (t.kind === 'cell' && t.value === null)) {
        continue;
      }
      if (was && was.kind === t.kind && ((was.kind === 'cell' && t.kind === 'cell' && was.value === t.value) || sameHeld(was, t))) {
        continue;
      }
      out.push(t.kind === 'cell' ? { op: 'set', savedName, kind: 'cell', value: t.value! } : t.kind === 'str' ? { op: 'set', savedName, kind: 'str', text: t.text } : { op: 'set', savedName, kind: 'int', value: t.value });
    }
    for (const savedName of this.object.held.keys()) {
      if (!this.now.has(savedName)) {
        out.push({ op: 'remove', savedName });
      }
    }
    return out;
  }
}

function sameHeld(a: McosHeldValue, b: Now): boolean {
  if (a.kind === 'cell' && b.kind === 'cell') {
    return identicalValues(a.value, b.value);
  }
  if (a.kind === 'str' && b.kind === 'str') {
    return a.text === b.text;
  }
  return a.kind === 'int' && b.kind === 'int' && a.value === b.value;
}

// ---- The table -----------------------------------------------------------------------------------
//
// One row per property an edit may set, by its public name: the name MATLAB saves it under, how
// its triple holds the value, and the check its value is held to. A class's setter effects, which
// no row can say (a Parameter's Value re-deriving its DataType, a NumericType's mode), are its
// handler's, below, which reads the rows it writes by name; the triples a setter changes with an
// edit that no edit sets directly are the class's `coWrites`. Measured on MATLAB R2027a's layout
// (README of the rules probe, section 1): a file of another release's layout holds some of these
// another way, and Working.put refuses those until its rows are measured too.

type Check =
  | { is: 'text'; ws: WhiteSpace; ascii?: true }
  | { is: 'identifier'; emptyOk?: boolean; maxLength?: number }
  | { is: 'choice'; choices: readonly string[] }
  | { is: 'bound' }
  | { is: 'flag' }
  | { is: 'dimensions'; minusOne: boolean }
  | { is: 'dataType'; forms: DataTypeForms }
  // Text MATLAB parses as a unit expression (unitExpression), and keeps as typed.
  | { is: 'unit' }
  // Taken by the class's handler.
  | { is: 'own' };

interface Row {
  saved: string;
  kind: McosHeldKind;
  check: Check;
}

interface ClassRules {
  rows: Readonly<Record<string, Row>>;
  // Triples the class's setters change with an edit, by a name of the handler's.
  coWrites?: Readonly<Record<string, { saved: string; kind: McosHeldKind }>>;
  handle: Handler;
}

type Handler = (o: Working, edits: readonly McosRuleEdit[], rules: ClassRules) => void;

const cell = (saved: string, check: Check): Row => ({ saved, kind: 'cell', check });
const str = (saved: string, choices: readonly string[]): Row => ({ saved, kind: 'str', check: { is: 'choice', choices } });
const int = (saved: string): Row => ({ saved, kind: 'int', check: { is: 'flag' } });
const own = (saved: string, kind: McosHeldKind = 'cell'): Row => ({ saved, kind, check: { is: 'own' } });

const BOUND: Check = { is: 'bound' };
const KEEP: Check = { is: 'text', ws: 'keep' };
const BLANK: Check = { is: 'text', ws: 'blank' };
const TRIM: Check = { is: 'text', ws: 'trim' };
// A HeaderFile: trimmed, and ASCII alone, which its setter takes and nothing else (measured against
// MATLAB R2027a: 'bé.h' and a zero-width space are refused, "only supports ascii characters").
const HEADER: Check = { is: 'text', ws: 'trim', ascii: true };
// A ValueType's and a lookup table's Unit: a unit expression, which MATLAB parses (measured against
// MATLAB R2027a and R2023b: 'm s' and 'kg m' are refused, and a file holding one loads it as '');
// a Parameter's, a Signal's and a BusElement's DocUnits take any text.
const UNIT: Check = { is: 'unit' };
const IDENT: Check = { is: 'identifier' };
const LUT_NAME: Check = { is: 'identifier', maxLength: OLD_NAME_LENGTH_MAX };
const SCOPES = ['Auto', 'Exported', 'Imported'];
const dataType = (forms: Partial<DataTypeForms>): Check => ({ is: 'dataType', forms: { auto: true, bus: true, valueType: false, string: true, ...forms } });

// The data of a lookup table, its Table and each of its Breakpoints (and a Simulink.Breakpoint's).
const LUT_DATA_ROWS: Record<string, Row> = {
  Value: own('Value'),
  DataType: cell('DataType', dataType({})),
  Min: cell('Min', BOUND),
  Max: cell('Max', BOUND),
  Unit: cell('Unit', UNIT),
  Description: cell('Description', KEEP),
  FieldName: cell('FieldName', LUT_NAME),
};

const RULES: Readonly<Record<string, ClassRules>> = {
  'Simulink.Parameter': {
    rows: {
      Value: own('Value'),
      Min: cell('Min', BOUND),
      Max: cell('Max', BOUND),
      Description: cell('Description', BLANK),
      Unit: cell('DocUnits', BLANK),
      DataType: { ...cell('DataType', dataType({ string: false })), check: { is: 'own' } },
    },
    coWrites: { Dimensions: { saved: 'Dimensions', kind: 'cell' }, Complexity: { saved: 'Complexity', kind: 'str' }, DataType: { saved: 'DataType', kind: 'cell' } },
    handle: parameter,
  },
  'Simulink.Signal': {
    rows: {
      Min: cell('Min', BOUND),
      Max: cell('Max', BOUND),
      Description: cell('Description', BLANK),
      Unit: cell('DocUnits', BLANK),
      InitialValue: own('InitialValue'),
      DataType: cell('DataType', dataType({})),
      Dimensions: cell('Dimensions', { is: 'dimensions', minusOne: true }),
      DimensionsMode: str('DimensionsMode', ['auto', 'Fixed', 'Variable']),
      Complexity: str('Complexity', ['auto', 'real', 'complex']),
      SamplingMode: str('SamplingMode', ['auto', 'Sample based', 'Frame based']),
      SampleTime: own('SampleTime'),
    },
    handle: signal,
  },
  'Simulink.Bus': {
    rows: {
      Description: cell('Description', BLANK),
      HeaderFile: cell('HeaderFile', HEADER),
      DataScope: str('DataScope', SCOPES),
      Alignment: own('Alignment'),
      PreserveElementDimensions: int('PreserveElementDimensions'),
    },
    handle: generic,
  },
  'Simulink.BusElement': {
    rows: {
      Name: own('Name'),
      DataType: cell('DataType_internal', dataType({ auto: false, valueType: true })),
      Dimensions: cell('Dimensions', { is: 'dimensions', minusOne: false }),
      DimensionsMode: str('DimensionsMode', ['Fixed', 'Variable']),
      Complexity: str('Complexity', ['real', 'complex']),
      Min: cell('Min_internal', BOUND),
      Max: cell('Max_internal', BOUND),
      Unit: cell('DocUnits', KEEP),
      Description: cell('Description', KEEP),
    },
    handle: busElement,
  },
  'Simulink.ValueType': {
    rows: {
      DataType: cell('DataType', dataType({ auto: false })),
      Min: cell('Min', BOUND),
      Max: cell('Max', BOUND),
      Unit: cell('Unit', UNIT),
      Description: cell('Description', KEEP),
      // Held as char cells, not as indices into the file's text.
      Complexity: cell('Complexity', { is: 'choice', choices: ['real', 'complex'] }),
      DimensionsMode: cell('DimensionsMode', { is: 'choice', choices: ['Fixed', 'Variable'] }),
      Dimensions: cell('Dimensions', { is: 'dimensions', minusOne: false }),
    },
    handle: generic,
  },
  'Simulink.LookupTable': {
    rows: {
      SupportTunableSize: int('SupportTunableSize'),
      AllowMultipleInstancesOfTypeToHaveDifferentTableBreakpointSizes: int('AllowMultipleInstancesOfTypeToHaveDifferentTableBreakpointSizes'),
      BreakpointsSpecification: own('BreakpointsSpecification', 'str'),
    },
    handle: lookupTable,
  },
  'Simulink.Breakpoint': {
    rows: { SupportTunableSize: int('SupportTunableSize') },
    handle: generic,
  },
  'Simulink.lookuptable.Table': {
    rows: LUT_DATA_ROWS,
    coWrites: { Dimensions: { saved: 'Dimensions', kind: 'cell' } },
    handle: lutData,
  },
  'Simulink.lookuptable.Breakpoint': {
    rows: { ...LUT_DATA_ROWS, TunableSizeName: cell('TunableSizeName', LUT_NAME), TunableSizeValue: own('TunableSizeValue') },
    coWrites: { Dimensions: { saved: 'Dimensions', kind: 'cell' } },
    handle: lutData,
  },
  'Simulink.lookuptable.StructTypeInfo': {
    rows: {
      Name: cell('Name', { is: 'identifier', emptyOk: true, maxLength: OLD_NAME_LENGTH_MAX }),
      HeaderFileName: cell('HeaderFileName', KEEP),
      DataScope: str('DataScope', SCOPES),
    },
    handle: generic,
  },
  'Simulink.NumericType': {
    rows: {
      DataTypeMode: own('DataTypeMode', 'str'),
      Signedness: own('SignednessBool'),
      WordLength: own('WordLength'),
      FractionLength: own('FixedExponent'),
      FixedExponent: own('FixedExponent'),
      Slope: own('FixedExponent'),
      SlopeAdjustmentFactor: own('SlopeAdjustmentFactor'),
      Bias: own('Bias'),
      IsAlias: own('IsAlias'),
      DataTypeOverride: str('DataTypeOverride', ['Inherit', 'Off']),
      DataScope: str('DataScope', SCOPES),
      Description: cell('Description', BLANK),
      HeaderFile: cell('HeaderFile', HEADER),
    },
    handle: numericType,
  },
  'Simulink.AliasType': {
    rows: {
      BaseType: cell('BaseType', dataType({ auto: false, bus: false })),
      Description: cell('Description', BLANK),
      HeaderFile: cell('HeaderFile', HEADER),
      DataScope: str('DataScope', SCOPES),
    },
    handle: generic,
  },
  'Simulink.CoderInfo': {
    rows: { StorageClass: own('StorageClass', 'str'), Identifier: own('Alias'), Alignment: own('Alignment', 'int') },
    handle: coderInfo,
  },
};

/** Whether objects of `className` take any edit of their properties in a MAT-file. */
export function hasPropertyRules(className: string): boolean {
  return Object.prototype.hasOwnProperty.call(RULES, className);
}

/**
 * The name `property` of a `className` object is saved under, and how its triple holds it, or null
 * where these rules take no edit of it.
 */
export function propertyRowOf(className: string, property: string): { savedName: string; kind: McosHeldKind } | null {
  const rows = hasPropertyRules(className) ? RULES[className].rows : null;
  const row = rows && Object.prototype.hasOwnProperty.call(rows, property) ? rows[property] : null;
  return row ? { savedName: row.saved, kind: row.kind } : null;
}

/** The public name of the property a `className` object saves as `saved` ('Unit' of 'DocUnits'), or `saved` where no row names it. */
export function publicNameOf(className: string, saved: string): string {
  const rows = hasPropertyRules(className) ? RULES[className].rows : {};
  return Object.entries(rows).find(([, row]) => row.saved === saved)?.[0] ?? saved;
}

/**
 * The values an edit of `property` of a `className` object may take, where they are a closed set
 * (a row's choices, a NumericType's DataTypeMode and Signedness, which its handler takes), or
 * null: what an editor of it offers as a dropdown.
 */
export function propertyChoices(className: string, property: string): readonly string[] | null {
  if (className === 'Simulink.NumericType' && property === 'DataTypeMode') {
    return MODES;
  }
  if (className === 'Simulink.NumericType' && property === 'Signedness') {
    return SIGNEDNESS;
  }
  // A CoderInfo's built-in storage classes, as saved: 'Model default' is taken, and saved (and read
  // back) as 'SimulinkGlobal', so an editor offering it would show what the file does not hold.
  if (className === 'Simulink.CoderInfo' && property === 'StorageClass') {
    return Object.keys(BUILTIN_STORAGE).filter((k) => BUILTIN_STORAGE[k] === k);
  }
  const rows = hasPropertyRules(className) ? RULES[className].rows : null;
  const row = rows && Object.prototype.hasOwnProperty.call(rows, property) ? rows[property] : null;
  return row && row.check.is === 'choice' ? row.check.choices : null;
}

/**
 * Whether `property` of a `className` object is one its setters change with an edit of another and
 * no edit sets itself (a Parameter's Dimensions and Complexity, which follow its Value).
 */
export function isCoWritten(className: string, property: string): boolean {
  const rules = hasPropertyRules(className) ? RULES[className] : null;
  return !!rules?.coWrites && Object.prototype.hasOwnProperty.call(rules.coWrites, property) && !Object.prototype.hasOwnProperty.call(rules.rows, property);
}

/** The value a row's check takes `v` as: a variable for a cell, the text for an index, 0 or 1 for an integer. */
function take(row: Row, v: MatVariable, named: string): MatVariable | string | number {
  const c = row.check;
  switch (c.is) {
    case 'text': {
      const t = takeText(v, named, c.ws);
      if (c.ascii && /[^\x00-\x7f]/.test(t.value as string)) {
        refuse(named + ' would be ' + quoted(t.value as string) + ', which MATLAB refuses: it takes ASCII characters only');
      }
      return t;
    }
    case 'identifier':
      return takeIdentifier(v, named, c.emptyOk, c.maxLength);
    case 'choice': {
      const t = takeChoice(v, named, c.choices);
      return row.kind === 'cell' ? charValue(t) : t;
    }
    case 'bound':
      return takeBound(v, named);
    case 'flag':
      return takeFlag(v, named);
    case 'dimensions':
      return takeDimensions(v, named, c.minusOne);
    case 'dataType':
      return takeDataType(v, named, c.forms);
    case 'unit': {
      const t = takeText(v, named, 'keep');
      const why = unitExpressionRefusal(t.value as string);
      if (why) {
        refuse(named + ' would be ' + quoted(t.value as string) + ', which MATLAB refuses: ' + why.replace(/\.$/, ''));
      }
      return t;
    }
    case 'own':
      throw new Error(named + ' is taken by its class handler');
  }
}

/** The row of `property`, or a refusal naming it: not a property these rules write for the class. */
function rowFor(o: Working, rules: ClassRules, property: string): Row {
  const row = Object.prototype.hasOwnProperty.call(rules.rows, property) ? rules.rows[property] : undefined;
  if (!row) {
    refuse(o.key + '.' + property + ' is not one this editor writes into ' + classPhrase(o.className));
  }
  return row;
}

/** Each edit set by its row, in the order made: what a class with no setter effects is. */
function generic(o: Working, edits: readonly McosRuleEdit[], rules: ClassRules): void {
  for (const { property, value } of edits) {
    setByRow(o, rules, property, value);
  }
}

/** The edit of `property` to `v` set by its row, or by the row's own check (OWN_CHECKS). */
function setByRow(o: Working, rules: ClassRules, property: string, v: MatVariable): void {
  current = property;
  const named = o.key + '.' + property;
  const row = rowFor(o, rules, property);
  if (row.check.is !== 'own') {
    o.put(row.saved, row.kind, take(row, v, named));
    return;
  }
  const check = OWN_CHECKS[o.className + '.' + property];
  if (!check) {
    throw new Error(named + ' is taken by its class handler, not by its row');
  }
  o.put(row.saved, row.kind, check(v, named));
}

// The checks of the rows that are `own` but have no effect beyond their value: each answers the
// value to write, or refuses.
const OWN_CHECKS: Record<string, (v: MatVariable, named: string) => MatVariable> = {
  'Simulink.Bus.Alignment': (v, named) => {
    const x = classOf(v) === 'double' && !v.isComplex ? scalarOf(v) : null;
    if (x === null || !(x === -1 || (x >= 1 && x <= 128 && isWhole(x) && (x & (x - 1)) === 0))) {
      refuse(named + ' must be -1 or a power of two up to 128, as a double: MATLAB refuses or rounds anything else'
        + ' (it takes 256 and 512 too, against its own message, which this editor does not)');
    }
    return { ...v, name: '' };
  },
  'Simulink.Signal.SampleTime': (v, named) => {
    const d = dimsOf(v);
    const parts = classOf(v) === 'double' && !v.isComplex && d.length === 2 && d[0] === 1 ? partsOf(v) : null;
    const xs = parts?.re ?? [];
    const ok = (xs.length === 1 && (xs[0] === -1 || xs[0] >= 0)) || (xs.length === 2 && Number.isFinite(xs[0]) && xs[1] > 0 && xs[1] < xs[0]);
    if (!ok) {
      refuse(named + ' must be -1, 0, a positive double or Inf, or [Ts offset] with 0 < offset < Ts: MATLAB refuses anything else,'
        + ' and makes [Ts 0] Ts');
    }
    return { ...v, name: '' };
  },
  'Simulink.Signal.InitialValue': (v, named) => {
    const t = takeText(v, named, 'keep').value as string;
    if (t !== trimmed(t)) {
      refuse(named + ' would be ' + quoted(t) + ', which MATLAB would load as ' + quoted(trimmed(t)) + ': it trims the white space at either end');
    }
    if (/[^\x00-\x7f]/.test(t)) {
      refuse(named + ' would be ' + quoted(t) + ", which MATLAB would load as '': its InitialValue takes only ASCII text");
    }
    return charValue(t);
  },
  'Simulink.BusElement.Name': (v, named) => {
    const t = takeIdentifier(v, named).value as string;
    if (t.startsWith('sl_padding')) {
      refuse(named + " must not start with 'sl_padding', which MATLAB keeps for the padding it adds to a bus");
    }
    return charValue(t);
  },
  'Simulink.lookuptable.Breakpoint.TunableSizeValue': (v, named) => {
    const x = classOf(v) === 'double' && !v.isComplex ? scalarOf(v) : null;
    if (x === null || !(x === -1 || (x >= 2 && isWhole(x)))) {
      refuse(named + ' must be -1 or a whole number of 2 or more: MATLAB refuses anything else');
    }
    return { ...v, name: '' };
  },
};

// ---- The handlers --------------------------------------------------------------------------------

const EMPTY_DOUBLE: MatVariable = variable('double', [0, 0], []);

// Which edited property a refusal of the object as the edits leave it is about: the first of
// `candidates` an edit set, else the first edit's.
function blame(edits: readonly McosRuleEdit[], ...candidates: string[]): string {
  return candidates.find((c) => edits.some((e) => e.property === c)) ?? edits[0]?.property ?? '';
}

/**
 * A Simulink.Parameter's Value: numeric of any class and size, an empty and an N-D one included,
 * real or complex; a real logical; a char row (which MATLAB loads as a string scalar), an empty one
 * written 1x0, which MATLAB loads as "" (R2027a and R2023b); a struct, whose every field holds one
 * of those, or a char of any shape, at any depth. Not a cell, a sparse array, an object (a string
 * among them), a function handle, nor a value this package could not write.
 */
function parameterValue(v: MatVariable, named: string): MatVariable {
  const what = parameterValueRefusal(v, false);
  if (what) {
    refuse(named + ' would be ' + what + ', which this editor does not write into ' + classPhrase('Simulink.Parameter'));
  }
  return classOf(v) === 'char' && numelOf(v) === 0 ? { ...v, name: '', dimensions: [1, 0] } : { ...v, name: '' };
}

/**
 * What a Simulink.Parameter's Value `v` is that these rules write none of (`a cell`, `a sparse
 * double`), or null where they take it: a member of a struct Value where `inStruct`, which holds
 * what a Value may, and a char of any shape (heldChar).
 */
export function parameterValueRefusal(v: MatVariable, inStruct: boolean): string | null {
  if (v._unwritable) {
    return v._unwritable;
  }
  if (v.isOpaque) {
    return classPhrase(v.className || 'object');
  }
  if (v.isSparse) {
    return 'a sparse ' + classOf(v);
  }
  const cls = classOf(v);
  if (NUMERIC.has(cls)) {
    return null;
  }
  if (cls === 'logical') {
    return v.isComplex ? 'a complex logical' : null;
  }
  if (cls === 'char' && inStruct) {
    return heldChar(v);
  }
  // A char row, and an empty char of any shape, which MATLAB's setter makes the string "" (R2027a
  // and R2023b: '', char(zeros(2,0)), char(zeros(0,3))).
  if (cls === 'char') {
    const t = textOf(v);
    return t !== null && (dimsOf(v)[0] === 1 || t === '') && !loneSurrogate(t) ? null : 'a char that is not one row of text';
  }
  if (cls === 'struct') {
    for (const held of Object.values(v.fields ?? {})) {
      for (const member of flat(held) as (MatVariable | null)[]) {
        const below = member ? parameterValueRefusal(member, true) : 'a struct with a field it does not hold';
        if (below) {
          return below.startsWith('a struct') ? below : 'a struct holding ' + below;
        }
      }
    }
    return null;
  }
  return classPhrase(cls || 'value');
}

/**
 * Why `v`, a char a field of a Parameter's struct Value holds, is not one the rules write, or null:
 * a non-empty char of any 2-D shape, which MATLAB keeps a char there (measured, R2027a and R2023b:
 * `p.Value.a = 'abc'` and `= ['ab';'cd']` stay char, and `= ''` is refused, "A valid structure must
 * be numeric", by the Parameter's own rule, ParameterNode).
 */
export function heldChar(v: MatVariable): string | null {
  const d = v.dimensions ?? [];
  const count = d.reduce((a, b) => a * b, 1);
  const text = typeof v.value === 'string' ? v.value : null;
  if (v.isComplex || d.length !== 2 || count === 0 || text === null || text.length !== count) {
    return 'a char that is empty, or not text';
  }
  return loneSurrogate(text) ? 'a char holding a lone UTF-16 surrogate' : null;
}

/** MATLAB's DataType after `p.Value = v` of class `now` over a Value of class `old` under DataType `dt`, measured. */
export function parameterDataTypeAfter(old: string, now: string, dt: string): string {
  if (now === 'struct') {
    return old === 'struct' ? dt : 'struct';
  }
  if (now === 'char') {
    return 'string';
  }
  if (now !== 'double') {
    return now === 'logical' ? 'boolean' : now;
  }
  return old !== 'double' ? 'auto' : dt;
}

/**
 * Whether every element of a double Value, real part and imaginary, is inside the range of the
 * builtin DataType it is held under, as MATLAB checks it: out of it, MATLAB warns on every load.
 * An integer type: within intmin and intmax, finite; single: finite, within realmax('single');
 * double: finite; boolean: 0 or 1 alone. Not checked: fixdt(…), an alias, an enumeration, a bus;
 * refused under 'half', whose range this editor does not know MATLAB's check of.
 */
function checkValueRange(named: string, dt: string, v: MatVariable): void {
  if (!BUILTIN.has(dt)) {
    return;
  }
  if (dt === 'half') {
    refuse(named + " would be double under a DataType of 'half', whose range this editor does not check");
  }
  const parts = partsOf(v);
  const xs = parts ? [...parts.re, ...(parts.im ?? [])] : [];
  const warns = ', which MATLAB loads with a warning on every load';
  if (dt === 'boolean') {
    const bad = v.isComplex ? null : xs.find((x) => x !== 0 && x !== 1);
    if (v.isComplex || bad !== undefined) {
      refuse(named + ' would hold ' + (v.isComplex ? 'a complex value' : numberText(bad!)) + ", and a DataType of 'boolean' takes only 0 and 1" + warns);
    }
    return;
  }
  const bad = xs.find((x) => !Number.isFinite(x) || outside(dt, x));
  if (bad !== undefined && !Number.isFinite(bad)) {
    refuse(named + ' would hold ' + numberText(bad) + ", where a DataType of '" + dt + "' takes finite values only" + warns);
  }
  if (bad !== undefined) {
    refuse(named + ' would hold ' + numberText(bad) + ', outside the range ' + rangeText(dt) + " of its DataType '" + dt + "'" + warns);
  }
}

/**
 * The bounds of an object as the edits leave it, as MATLAB checks them: a Min no greater than its
 * Max; neither outside the range of a builtin DataType (none at all under 'half', whose range this
 * editor does not check); and, where `busRefuses`, none at all under a bus DataType, which MATLAB
 * ignores them for and says so. Each of these warns on every load.
 */
function checkBounds(o: Working, dt: string | null, min: MatVariable | null, max: MatVariable | null, busRefuses: boolean, property: string): void {
  current = property;
  const mn = min && numelOf(min) === 1 ? scalarOf(min) : null;
  const mx = max && numelOf(max) === 1 ? scalarOf(max) : null;
  const warns = ', which MATLAB loads with a warning on every load';
  if (mn !== null && mx !== null && mn > mx) {
    refuse(o.key + '.Min (' + numberText(mn) + ') would be greater than its Max (' + numberText(mx) + ')' + warns);
  }
  if (busRefuses && dt !== null && dt.startsWith('Bus:') && (mn !== null || mx !== null)) {
    refuse(o.key + (mn !== null ? '.Min' : '.Max') + " would be set while its DataType is '" + dt + "', and MATLAB ignores a minimum and a maximum for a bus" + warns);
  }
  for (const [name, x] of [['Min', mn], ['Max', mx]] as const) {
    if (x === null || dt === null) {
      continue;
    }
    if (dt === 'half') {
      refuse(o.key + '.' + name + " would be set under a DataType of 'half', whose range this editor does not check");
    }
    if (BUILTIN.has(dt) && outside(dt, x)) {
      refuse(o.key + '.' + name + ' (' + numberText(x) + ') would be outside the range ' + rangeText(dt) + " of its DataType '" + dt + "'" + warns);
    }
  }
}

/**
 * Simulink.Parameter. Its Value is written in its own class, never cast; MATLAB's `p.Value = v`
 * changes with it: Dimensions to size(v), unless v is empty and the Dimensions held are no empty's,
 * a 0 in none of them (5, then zeros(0,3), then [] leaves [1 1]: measured, R2027a and R2023b, across
 * a save and a load too); DataType as
 * parameterDataTypeAfter re-derives it ('auto' removes the triple); Complexity to v's, unless v is
 * empty (measured, R2027a and R2023b: [1+2i 3-4i] set to [] or zeros(0,3) stays complex), and 'real'
 * for text, which the setter makes a string ('abc', "x" or '' set over [1+2i 3-4i] leaves 'real',
 * R2027a and R2023b, across a save and a load too; it was saved 'complex'). Text is never an empty
 * Value: '' and "" are the string "", Dimensions [1 1], written as a 1x0 char that MATLAB loads so
 * (R2027a and R2023b). A DataType set
 * with it, or alone, is held to the Value the edits leave: over a Value that is not double only its
 * own class's name (MATLAB converts the Value to double otherwise, with a warning), and a bus only
 * over an empty Value or a struct. Then the Value is held to its builtin DataType's range, and the
 * bounds to each other and to it.
 */
function parameter(o: Working, edits: readonly McosRuleEdit[], rules: ClassRules): void {
  let value: MatVariable | null = null;
  let dt: MatVariable | null = null;
  const co = rules.coWrites!;
  for (const { property, value: v } of edits) {
    current = property;
    const named = o.key + '.' + property;
    if (property === 'Value') {
      value = parameterValue(v, named);
    } else if (property === 'DataType') {
      dt = takeDataType(v, named, { auto: true, bus: true, valueType: false, string: false });
    } else {
      setByRow(o, rules, property, v);
    }
  }
  const valueSaved = rules.rows.Value.saved;
  const old = o.value(valueSaved) ?? EMPTY_DOUBLE;
  const oldDt = o.text(co.DataType.saved) ?? 'auto';
  if (value) {
    current = 'Value';
    o.put(valueSaved, 'cell', value);
    const cls = classOf(value);
    // Text is a string scalar, never empty: '' is "", whose Dimensions are [1 1].
    const text = cls === 'char' || cls === 'string';
    const d = o.value(co.Dimensions.saved);
    const was = d && classOf(d) === 'double' ? partsOf(d)?.re : undefined;
    if (was) {
      const size = sizeOf(value);
      if ((text || numelOf(value) !== 0 || was.includes(0)) && (was.length !== size.length || was.some((x, i) => x !== size[i]))) {
        o.put(co.Dimensions.saved, 'cell', doubleRow(size));
      }
    }
    if (!dt) {
      o.put(co.DataType.saved, 'cell', charValue(parameterDataTypeAfter(classOf(old), classOf(value), oldDt)));
    }
    if (text || ((NUMERIC.has(cls) || cls === 'logical') && numelOf(value) !== 0)) {
      o.put(co.Complexity.saved, 'str', value.isComplex ? 'complex' : 'real');
    }
  }
  const final = o.value(valueSaved) ?? EMPTY_DOUBLE;
  const finalCls = classOf(final);
  if (dt) {
    current = 'DataType';
    const t = dt.value as string;
    const need = parameterDataTypeAfter('double', finalCls, t);
    if (finalCls !== 'double' && need !== t) {
      refuse(o.key + '.DataType ' + quoted(t) + ' over a Value of class ' + finalCls + ': MATLAB converts the Value to double, with a warning on every load');
    }
    if (t.startsWith('Bus:') && numelOf(final) !== 0 && finalCls !== 'struct') {
      refuse(o.key + '.DataType ' + quoted(t) + ' over a Value of class ' + finalCls + ': MATLAB warns that the two are inconsistent, on every load');
    }
    o.put(co.DataType.saved, 'cell', dt);
  }
  const fdt = o.text(co.DataType.saved);
  // The Value held to its DataType's range where an edit set either: a file's own, MATLAB loaded.
  if (finalCls === 'double' && fdt !== null && fdt !== 'auto' && (value || dt)) {
    current = blame(edits, 'Value', 'DataType');
    checkValueRange(o.key + '.Value', fdt, final);
  }
  checkBounds(o, fdt === 'auto' ? null : fdt, o.value(rules.rows.Min.saved), o.value(rules.rows.Max.saved), false, blame(edits, 'Min', 'Max', 'DataType', 'Value'));
}

/** Simulink.Signal: each edit by its row, then the bounds, none under a bus DataType. */
function signal(o: Working, edits: readonly McosRuleEdit[], rules: ClassRules): void {
  generic(o, edits, rules);
  const dt = o.text(rules.rows.DataType.saved);
  checkBounds(o, dt === 'auto' ? null : dt, o.value(rules.rows.Min.saved), o.value(rules.rows.Max.saved), true, blame(edits, 'Min', 'Max', 'DataType'));
}

/**
 * Simulink.BusElement: each edit by its row, then the bounds, which MATLAB's load does not check at
 * all (its Min_internal and Max_internal are set past their setters: an int16 or an Inf Min loads
 * as written, an invalid object), so they are held here to what its assignment holds them to.
 */
function busElement(o: Working, edits: readonly McosRuleEdit[], rules: ClassRules): void {
  generic(o, edits, rules);
  checkBounds(o, o.text(rules.rows.DataType.saved), o.value(rules.rows.Min.saved), o.value(rules.rows.Max.saved), true, blame(edits, 'Min', 'Max', 'DataType'));
}

/**
 * Simulink.LookupTable: its flags, and its BreakpointsSpecification only as it is. A change of it
 * replaces the Breakpoints objects (with Simulink.lookuptable.Evenspacing ones, or a cell), which
 * is no property edit.
 */
function lookupTable(o: Working, edits: readonly McosRuleEdit[], rules: ClassRules): void {
  for (const { property, value } of edits) {
    current = property;
    if (property !== 'BreakpointsSpecification') {
      setByRow(o, rules, property, value);
      continue;
    }
    const held = o.text(rules.rows.BreakpointsSpecification.saved) ?? 'Explicit values';
    if (textOf(value) !== held) {
      refuse(o.key + '.BreakpointsSpecification would change, which replaces the objects of its Breakpoints: not a property edit this editor makes');
    }
  }
}

/**
 * A lookup table's Table and Breakpoints: a Value is held to what MATLAB's setter takes (a Table
 * numeric or logical, not a scalar; a Breakpoint a real vector of two or more; either empty), and
 * its Dimensions follows it, empty included, unless the Dimensions is symbolic text, which stays.
 */
function lutData(o: Working, edits: readonly McosRuleEdit[], rules: ClassRules): void {
  const breakpoint = o.className === 'Simulink.lookuptable.Breakpoint';
  for (const { property, value: v } of edits) {
    current = property;
    if (property !== 'Value') {
      setByRow(o, rules, property, v);
      continue;
    }
    const named = o.key + '.Value';
    const cls = classOf(v);
    if (!(NUMERIC.has(cls) || cls === 'logical') || v.isSparse) {
      refuse(named + ' must be numeric or logical: MATLAB refuses ' + whatIs(v) + ', and the file would load it as []');
    }
    if (numelOf(v) !== 0) {
      const d = dimsOf(v);
      if (breakpoint && v.isComplex) {
        refuse(named + ' must be real: MATLAB refuses complex breakpoints');
      }
      if (breakpoint && (d.length !== 2 || Math.min(...d) !== 1 || numelOf(v) < 2)) {
        refuse(named + ' must be a vector of two or more elements: MATLAB refuses ' + whatIs(v));
      }
      if (!breakpoint && numelOf(v) === 1) {
        refuse(named + ' cannot be a scalar: MATLAB refuses one, and the file would load it as []');
      }
    }
    o.put(rules.rows.Value.saved, 'cell', { ...v, name: '' });
    const dims = o.value(rules.coWrites!.Dimensions.saved);
    if (dims && classOf(dims) === 'double') {
      o.put(rules.coWrites!.Dimensions.saved, 'cell', doubleRow(sizeOf(v)));
    }
  }
}

// A data object's built-in storage classes, and what each is saved as: 'Model default' as its
// legacy spelling 'SimulinkGlobal', which MATLAB writes for both.
const BUILTIN_STORAGE: Record<string, string> = {
  Auto: 'Auto',
  'Model default': 'SimulinkGlobal',
  SimulinkGlobal: 'SimulinkGlobal',
  ExportedGlobal: 'ExportedGlobal',
  ImportedExtern: 'ImportedExtern',
  ImportedExternPointer: 'ImportedExternPointer',
};

/**
 * Simulink.CoderInfo, of a Parameter, Signal, LookupTable or Breakpoint, an MCOS object (MATLAB
 * R2027a) or the object of a 'handle' opaque (R2024b and earlier, and every one from the R2023b
 * templates), measured in R2023b, R2024b and R2027a:
 *
 *   - StorageClass: a built-in storage class ('Model default' saved as 'SimulinkGlobal'), not a
 *     custom one, nor any change while the object has one (its CustomAttributes object's class
 *     follows the storage class, which is no property edit);
 *   - Identifier (saved as Alias, a char cell): '' or an identifier, a letter or _ first, of at
 *     most 63 characters;
 *   - Alignment: -1 or a power of two up to 128 (an integer triple in R2027a's CoderInfo, a double
 *     cell in the opaque's).
 *
 * Judged as the save leaves the object: an Identifier or an Alignment under StorageClass 'Auto' is
 * refused, MATLAB refusing the one and resetting the other with a warning; so is a StorageClass set
 * back to 'Auto' while either is set. In the opaque the encoding of each is MATLAB's own, which
 * the codec's edit of it writes (McosSubsystemCodec.editHandleCoderInfo); its triples here carry
 * only the values.
 */
function coderInfo(o: Working, edits: readonly McosRuleEdit[], rules: ClassRules): void {
  const handle = !!o.object.handle;
  const r = rules.rows;
  // Nothing of a CoderInfo with a custom storage class, whose attributes object follows it: no
  // edit of one was measured, and a change of the storage class replaces that object.
  const custom = o.text('CustomStorageClass');
  if (o.text(r.StorageClass.saved) === 'Custom' || (custom !== null && custom !== 'Default')) {
    current = edits[0]?.property ?? '';
    refuse(o.key + '.' + current + ' cannot change while the object has a custom storage class, no edit under which was measured');
  }
  for (const { property, value: v } of edits) {
    current = property;
    const named = o.key + '.' + property;
    const row = rowFor(o, rules, property);
    if (property === 'StorageClass') {
      const sc = takeChoice(v, named, Object.keys(BUILTIN_STORAGE));
      if (handle) {
        o.set(row.saved, 'str', BUILTIN_STORAGE[sc]);
      } else {
        o.put(row.saved, 'str', BUILTIN_STORAGE[sc]);
      }
    } else if (property === 'Identifier') {
      const t = takeText(v, named, 'keep').value as string;
      if (t !== '' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) {
        refuse(named + ' must be an identifier, a letter or _ first: MATLAB refuses ' + quoted(t));
      }
      if (t.length > OLD_NAME_LENGTH_MAX) {
        refuse(named + ' is ' + t.length + ' characters: an Identifier longer than ' + OLD_NAME_LENGTH_MAX + ' was not measured');
      }
      o.put(row.saved, 'cell', charValue(t));
    } else {
      const x = classOf(v) === 'double' && !v.isComplex ? scalarOf(v) : null;
      if (x === null || !(x === -1 || (x >= 1 && x <= 128 && isWhole(x) && (x & (x - 1)) === 0))) {
        refuse(named + ' must be -1 or a power of two up to 128, as a double: MATLAB refuses or rounds anything else');
      }
      if (handle) {
        o.put(row.saved, 'cell', doubleRow([x]));
      } else {
        o.put(row.saved, 'int', x);
      }
    }
  }
  const sc = o.text(r.StorageClass.saved);
  const alias = o.text(r.Identifier.saved) ?? '';
  const held = o.get(r.Alignment.saved);
  const alignment = typeof held === 'number' ? held : held && typeof held === 'object' ? scalarOf(held) ?? -1 : -1;
  if (sc === 'Auto' && (alias !== '' || alignment !== -1)) {
    current = blame(edits, 'StorageClass', 'Identifier', 'Alignment');
    refuse(o.key + " would hold an Identifier or an Alignment under StorageClass 'Auto': MATLAB refuses the one, and resets the other with a warning");
  }
}

const FLOAT_WORD_LENGTH: Record<string, number> = { Double: 64, Single: 32, Half: 16, Boolean: 1 };
const UNSPECIFIED = 'Fixed-point: unspecified scaling';
const BINARY_POINT = 'Fixed-point: binary point scaling';
const SLOPE_BIAS = 'Fixed-point: slope and bias scaling';
const MODES = [...Object.keys(FLOAT_WORD_LENGTH), UNSPECIFIED, BINARY_POINT, SLOPE_BIAS];
const SIGNEDNESS = ['Signed', 'Unsigned', 'Auto'];

// A whole number, of a real numeric scalar, in [lo, hi]; refused otherwise, MATLAB rounding 2.5 to 2.
function takeWhole(v: MatVariable, named: string, lo = -Infinity, hi = Infinity): number {
  const x = (classOf(v) === 'double' || NUMERIC.has(classOf(v))) ? scalarOf(v) : null;
  if (x === null) {
    refuse(named + ' must be a real number: MATLAB refuses ' + whatIs(v));
  }
  if (!Number.isFinite(x)) {
    refuse(named + ' must be a finite whole number: MATLAB refuses ' + numberText(x));
  }
  if (!isWhole(x)) {
    refuse(named + ' must be a whole number: MATLAB rounds ' + numberText(x));
  }
  if (x < lo || x > hi) {
    refuse(named + ' must be in [' + numberText(lo) + ', ' + numberText(hi) + ']: MATLAB refuses ' + numberText(x));
  }
  return x + 0;
}

// `s` = f·2^e with f in [0.5, 1), for a positive finite s, exactly (C's frexp), of its bits: its
// exponent field set to that of [0.5, 1), a subnormal first scaled into the normal range. No loop,
// so no slope near realmax (whose 2^e is Inf) or below the smallest normal can fail to end.
function frexp(s: number): [number, number] {
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, s);
  const high = bits.getUint32(0);
  const exponent = (high >>> 20) & 0x7ff;
  if (exponent === 0) {
    const [f, e] = frexp(s * 2 ** 64);
    return [f, e - 64];
  }
  bits.setUint32(0, (high & 0x800fffff) | (1022 << 20));
  return [bits.getFloat64(0), exponent - 1022];
}

/**
 * Simulink.NumericType, every property of which is always saved, and whose setters are gated by
 * its mode: MATLAB's load runs them in the order of the property list, so a DataTypeMode written
 * without the WordLength, FixedExponent, SlopeAdjustmentFactor, Bias and SignednessBool its own
 * assignment sets with it loads with a warning, or with the old values. So the edits are applied in
 * the order made, each in the mode the object is in at that edit, as MATLAB's setters apply them,
 * and every property they leave changed is written:
 *
 *   - DataTypeMode Double, Single, Half or Boolean: WordLength 64, 32, 16 or 1, FixedExponent 0,
 *     SlopeAdjustmentFactor 1, Bias 0, signed but for Boolean; a fixed-point mode from one of those:
 *     WordLength 16, signed; unspecified scaling: FixedExponent 0, SlopeAdjustmentFactor 1, Bias 0
 *     (refused while IsAlias is true: MATLAB sets it false, with a warning); binary point:
 *     SlopeAdjustmentFactor 1, Bias 0;
 *   - WordLength (1 to 65535) only in a fixed-point mode; FractionLength (FixedExponent negated) and
 *     FixedExponent only in a scaled one; Slope in binary point a power of two (FixedExponent), in
 *     slope and bias any positive finite (FixedExponent and SlopeAdjustmentFactor, exactly); Bias
 *     and SlopeAdjustmentFactor ([1, 2)) only in slope and bias;
 *   - Signedness Signed, Unsigned or Auto (SignednessBool true, false, or a 0x0 logical) in a
 *     fixed-point mode; in a floating one only the value it holds;
 *   - a value the property holds already is no change, in any mode.
 */
function numericType(o: Working, edits: readonly McosRuleEdit[], rules: ClassRules): void {
  const r = rules.rows;
  const numberNamed = (saved: string): number => {
    const x = o.number(saved);
    if (x === null) {
      current = edits[0]?.property ?? '';
      refuse(o.key + "'s " + publicNameOf(o.className, saved) + ' is not held as a number, as MATLAB R2027a saves it: the file is of a layout this editor was not measured on');
    }
    return x;
  };
  let mode = o.text(r.DataTypeMode.saved);
  const num: Record<string, number> = {
    [r.WordLength.saved]: numberNamed(r.WordLength.saved),
    [r.FixedExponent.saved]: numberNamed(r.FixedExponent.saved),
    [r.SlopeAdjustmentFactor.saved]: numberNamed(r.SlopeAdjustmentFactor.saved),
    [r.Bias.saved]: numberNamed(r.Bias.saved),
  };
  const WL = r.WordLength.saved;
  const FE = r.FixedExponent.saved;
  const SAF = r.SlopeAdjustmentFactor.saved;
  const BIAS = r.Bias.saved;
  let signedness = o.value(r.Signedness.saved);
  for (const { property, value: v } of edits) {
    current = property;
    const named = o.key + '.' + property;
    const fixed = mode === UNSPECIFIED || mode === BINARY_POINT || mode === SLOPE_BIAS;
    const scaled = mode === BINARY_POINT || mode === SLOPE_BIAS;
    const here: Record<string, number> = { WordLength: num[WL], FixedExponent: num[FE], Bias: num[BIAS], SlopeAdjustmentFactor: num[SAF], FractionLength: -num[FE] };
    const x = classOf(v) === 'double' ? scalarOf(v) : null;
    if (property in here && x !== null && x === here[property]) {
      continue;
    }
    if (property === 'DataTypeMode' && textOf(v) === mode) {
      continue;
    }
    switch (property) {
      case 'DataTypeMode': {
        const m = takeChoice(v, named, MODES);
        if (m in FLOAT_WORD_LENGTH) {
          Object.assign(num, { [WL]: FLOAT_WORD_LENGTH[m], [FE]: 0, [SAF]: 1, [BIAS]: 0 });
          signedness = logicalValue(m !== 'Boolean');
        } else {
          if (mode !== null && mode in FLOAT_WORD_LENGTH) {
            num[WL] = 16;
            signedness = logicalValue(true);
          }
          if (m === UNSPECIFIED) {
            const alias = o.value(r.IsAlias.saved);
            if (alias && scalarOf(alias)) {
              refuse(named + ': an unscaled type cannot be an alias, and MATLAB sets IsAlias false, with a warning');
            }
            Object.assign(num, { [FE]: 0, [SAF]: 1, [BIAS]: 0 });
          } else if (m === BINARY_POINT) {
            Object.assign(num, { [SAF]: 1, [BIAS]: 0 });
          }
        }
        mode = m;
        break;
      }
      case 'WordLength':
        if (!fixed) {
          refuse(named + ': MATLAB does not change the WordLength of a ' + mode + ' type, and warns');
        }
        num[WL] = takeWhole(v, named, 1, 65535);
        break;
      case 'FractionLength':
      case 'FixedExponent': {
        if (!scaled) {
          refuse(named + ': MATLAB does not change it in ' + (mode === null ? 'this mode' : quoted(mode)) + ', and warns');
        }
        const n = takeWhole(v, named);
        num[FE] = (property === 'FractionLength' ? -n : n) + 0;
        break;
      }
      case 'Slope': {
        if (!scaled || x === null || !Number.isFinite(x) || x <= 0) {
          refuse(named + ' must be a positive finite double, in a scaled fixed-point mode');
        }
        const [f, e] = frexp(x);
        if (mode === BINARY_POINT && f !== 0.5) {
          refuse(named + ' would be ' + numberText(x) + ': binary point scaling takes only a power of two');
        }
        num[FE] = e - 1;
        if (mode === SLOPE_BIAS) {
          num[SAF] = f * 2;
        }
        break;
      }
      case 'Bias':
        if (mode !== SLOPE_BIAS || x === null || !Number.isFinite(x)) {
          refuse(named + ' must be a finite double, in slope and bias scaling only: MATLAB refuses or warns elsewhere');
        }
        num[BIAS] = x;
        break;
      case 'SlopeAdjustmentFactor':
        if (mode !== SLOPE_BIAS || x === null || !(x >= 1 && x < 2)) {
          refuse(named + ' must be a double in [1, 2), in slope and bias scaling only');
        }
        num[SAF] = x;
        break;
      case 'Signedness': {
        const s = takeChoice(v, named, SIGNEDNESS);
        if (!fixed) {
          const held = mode === 'Boolean' ? 'Unsigned' : 'Signed';
          if (s !== held) {
            refuse(named + ': MATLAB does not change the Signedness of a ' + mode + " type (it warns, or ignores 'Auto')");
          }
          break;
        }
        signedness = s === 'Auto' ? EMPTY_LOGICAL : logicalValue(s === 'Signed');
        break;
      }
      case 'IsAlias': {
        const b = takeFlag(v, named);
        if (b && mode === UNSPECIFIED) {
          refuse(named + ': an unscaled type cannot be an alias, and MATLAB warns');
        }
        o.put(r.IsAlias.saved, 'cell', logicalValue(b === 1));
        break;
      }
      default:
        setByRow(o, rules, property, v);
    }
  }
  current = blame(edits, 'DataTypeMode');
  if (mode !== null) {
    o.put(r.DataTypeMode.saved, 'str', mode);
  }
  if (signedness) {
    o.put(r.Signedness.saved, 'cell', signedness);
  }
  for (const [saved, x] of Object.entries(num)) {
    if (o.number(saved) !== x) {
      o.put(saved, 'cell', doubleRow([x]));
    }
  }
}

// ---- The plan ------------------------------------------------------------------------------------

/**
 * The triple operations that write `targets`, the edits of one save, each object's in the order
 * its edits were made, and those MATLAB's own setters make with them; or the first edit refused,
 * the object and property it is about, and why, in words naming it. The edits of one object are
 * judged together, as the object a save leaves: a Min and a Max set in one save are held to each
 * other as they will be. A key named twice is one object, its edits one list.
 */
export function planPropertyEdits(targets: readonly McosRuleTarget[]): McosRulePlan {
  const merged = new Map<string, { target: McosRuleTarget; edits: McosRuleEdit[] }>();
  for (const t of targets) {
    const m = merged.get(t.key);
    if (m) {
      m.edits.push(...t.edits);
    } else {
      merged.set(t.key, { target: t, edits: [...t.edits] });
    }
  }
  let key = '';
  try {
    const working = new Map<string, Working>();
    for (const [k, { target, edits }] of merged) {
      key = k;
      current = edits[0]?.property ?? '';
      const o = new Working(k, target.object);
      working.set(k, o);
      if (!hasPropertyRules(o.className)) {
        refuse(k + ' is ' + classPhrase(o.className) + ', whose properties this editor does not write into a MAT-file');
      }
      const rules = RULES[o.className];
      rules.handle(o, edits, rules);
    }
    // The names of each bus's elements, unique after every edit of the save: MATLAB refuses a
    // duplicate at the assignment, and its load takes one.
    const buses = new Map<string, McosRuleTarget[]>();
    for (const { target } of merged.values()) {
      if (target.bus) {
        buses.set(target.bus.key, [...(buses.get(target.bus.key) ?? []), target]);
      }
    }
    for (const [busKey, members] of buses) {
      key = members[0].key;
      current = 'Name';
      const { elements } = members[0].bus!;
      const nameSaved = RULES['Simulink.BusElement'].rows.Name.saved;
      const names = elements.map((element, i) => {
        const edited = members.find((m) => m.bus!.index === i);
        return (edited ? working.get(edited.key)! : new Working('', element)).text(nameSaved);
      });
      const twice = [...new Set(names.filter((n, i) => n !== null && names.indexOf(n) !== i))];
      if (twice.length > 0) {
        refuse(busKey + ' would hold two elements named ' + twice.map((n) => "'" + n + "'").join(', ') + ': MATLAB refuses a name its bus holds already');
      }
    }
    return { ok: true, objects: [...working].map(([k, o]) => ({ key: k, ops: o.ops() })) };
  } catch (e) {
    if (e instanceof Refused) {
      return { ok: false, key, property: e.property, message: e.message };
    }
    throw e;
  }
}
