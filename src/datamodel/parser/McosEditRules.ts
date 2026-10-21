// Copyright 2026 The MathWorks, Inc.

import type { MatVariable } from './MatParser.js';
import type { McosEditRefusal } from './McosSubsystemEdit.js';
import { classPhrase } from './MatWriter.js';

// Which properties of a Simulink.Parameter or a Simulink.Signal held in a MAT-file's subsystem a
// save can change, and which other cells of the object go with each change: the rules a cell swap
// (McosSubsystemEdit) is held to, so that the object MATLAB loads is the one MATLAB's own edit of
// the same property makes, with no warning, and not the one it would read the cell as.
//
// WHY RULES AT ALL. MATLAB runs each property's set method as it loads an object, in the order of
// its property list, and a cell that set method refuses does not fail the load: measured against
// MATLAB R2027a, the property loads as its class default, silently. An int16 Min, a Min of -Inf, a
// numeric Description, a Signal Dimensions of 0.5 each load as `[]`, `''` or -1, and the edit is
// gone with nothing said. A cell the set method takes with a warning (a Value of 300 under a
// DataType of 'uint8', a Min above its Max) warns on every load of the file, MATLAB's own save of
// the same edit included. And a cell that is right on its own can still load as something else: a
// Value that is not double under a stored DataType is converted to double, with a warning, every
// time, unless the DataType cell says its class. So each edit is checked as MATLAB's set method
// checks it, and refused where that method refuses it or warns, and the cells MATLAB's own edit
// would change with it are changed with it.
//
// The rules, measured against MATLAB R2027a over 257 edits of 500 swapped files, each judged
// against MATLAB's own edit of the same object (it loads equal, every property, with no warning,
// and survives a MATLAB re-save):
//
//   - only a property the object holds a value cell for takes an edit. One at its class default
//     has none: MATLAB saves no value for it, and writing one means adding to the object's
//     property list, which moves every offset after it;
//   - a Simulink.Parameter's Value is written in its own class, never cast to its DataType:
//     MATLAB does not cast on assignment either. Its Dimensions follows a resize, and its
//     DataType is re-derived as MATLAB's set method re-derives it (valueCoWrites);
//   - a Min or a Max is a finite real double scalar or `[]`, no greater than its Max or less than
//     its Min, inside the range of a builtin DataType;
//   - text is a char row, `''` written as a 0x0 char;
//   - a Signal's DataType and Dimensions take what MATLAB takes for them;
//   - nothing else: a Parameter's DataType on its own (its set method converts a Value that is
//     not double, on every load), a Complexity or a StorageClass (stored as indices into the
//     file's text, not as values), a CoderInfo (an object of its own).
//
// Pure: what the object holds goes in, read once by the caller (McosSubsystemEdit.storedProperties
// and the cells it names), and the cells to write come out, or why not. One answer for the editor,
// which offers only what a save writes, and for the save itself.

/** One property an object holds a triple for, as the rules read it. */
export interface McosHeld {
  // Why its cell takes no swap (McosSubsystemEdit.storedProperties), or null where one does.
  refusal: McosEditRefusal | null;
  // What its value cell holds, read; null for a triple with no cell, or a cell that does not read.
  value: MatVariable | null;
}

/** An object of a subsystem, as the rules read it. */
export interface McosObjectHeld {
  // Its class, as the subsystem's class table names it.
  className: string;
  // Every property it saved a triple for, by the name it was saved under.
  stored: ReadonlyMap<string, McosHeld>;
}

/** A property's new value, by the property's public name ('Unit', not 'DocUnits'). */
export interface McosPropertyEdit {
  property: string;
  value: MatVariable;
}

/** One value cell to write: the name it is saved under, and the value, nameless. */
export interface McosCellValue {
  savedName: string;
  value: MatVariable;
}

export type McosRulesResult =
  | { ok: true; cells: McosCellValue[] }
  | { ok: false; property: string; message: string };

const PARAMETER = 'Simulink.Parameter';
const SIGNAL = 'Simulink.Signal';

// The properties each class takes an edit of, and the name each is saved under. Measured on
// Simulink.Parameter and Simulink.Signal only: a subclass (mpt.Parameter, a user's own) may have
// set methods of its own, and is not edited.
const EDITABLE: Record<string, Record<string, string>> = {
  [PARAMETER]: { Value: 'Value', Min: 'Min', Max: 'Max', Description: 'Description', Unit: 'DocUnits' },
  [SIGNAL]: {
    Min: 'Min',
    Max: 'Max',
    Description: 'Description',
    Unit: 'DocUnits',
    DataType: 'DataType',
    Dimensions: 'Dimensions',
    InitialValue: 'InitialValue',
  },
};

// Why a property of a class that has rules is not one of them, where there is more to say than
// that it is not.
const EXCLUDED: Record<string, Record<string, string>> = {
  [PARAMETER]: {
    DataType: 'follows its Value, and is written only with it: set on its own, MATLAB converts a Value that is not double to double on every load',
    Dimensions: 'follows its Value, and is written only with it',
    Complexity: "is held as an index into the file's text, not as a value, and MATLAB derives it from the Value as it loads",
  },
  [SIGNAL]: {
    Complexity: "is held as an index into the file's text, not as a value",
  },
};

const CODER_INFO = 'belongs to its CoderInfo, an object of its own, which a save does not rewrite';
// The CoderInfo itself, and what the Property Inspector shows of it as the object's own (the
// schema's Code Generation and Custom Attributes columns).
const CODER_INFO_PROPERTIES =
  /^(?:CoderInfo|StorageClass|Alignment|Identifier|HeaderFile|DefinitionFile|Owner|PreserveDimensions|StructName|GetFunction|SetFunction|DataScope)$/;

const TEXT_PROPERTIES = new Set(['Description', 'DocUnits', 'InitialValue']);

// The classes a Value may be, as MATLAB holds them and this package writes them.
const NUMERIC = new Set(['double', 'single', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64']);

// The range of each builtin data type a double is checked against, as MATLAB's set method checks
// it: a Value out of it, or a Min or a Max, warns on every load. int64 and uint64 are checked as
// the doubles nearest their limits, which is the comparison a double allows.
const INTEGER_RANGE: Record<string, [number, number]> = {
  int8: [-128, 127],
  uint8: [0, 255],
  int16: [-32768, 32767],
  uint16: [0, 65535],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  int64: [-9223372036854775808, 9223372036854775807],
  uint64: [0, 18446744073709551615],
};
const REALMAX_SINGLE = 3.4028234663852886e38;

// A builtin name a DataType may hold whose range this package does not know MATLAB's check of,
// and so refuses a double under, rather than not check it.
const UNCHECKED_BUILTIN = new Set(['half']);

// What a Signal's DataType may be set to: a builtin name; fixdt of a signedness and a word length,
// then up to three numbers (a fraction length; a slope and a bias; a slope adjustment, an exponent
// and a bias) and the 'DataTypeOverride' pair, or of one quoted name, `fixdt('sfix16_En4')`; an
// enumeration or a bus, `Enum: E` and `Bus: B`, of a name; or an alias, a name, dotted or not.
// Measured against MATLAB R2027a, its set method takes any text and loads any as written, garbage
// such as `fixdt(foo)` or `fixdt(1,16,4,5,6,7)` included, but for white space at either end, which
// it trims: `'Enum: E '` and `'fixdt(1,16,4)\n'` load as other text than was written. So the text
// is held to the forms that name a type, spelled with no white space at either end and no control
// character anywhere. Not what was not measured, though it spells like a name: 'auto', which
// MATLAB's own save drops, 'half', 'string', 'struct'; nor 'Inherit: …'.
const SIGNAL_BUILTIN = new Set(['double', 'single', 'boolean', ...Object.keys(INTEGER_RANGE)]);
const NAME = '[A-Za-z][A-Za-z0-9_]*';
const DOTTED = NAME + '(?:\\.' + NAME + ')*';
const NUMBER = '[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?';
const COMMA = ' *, *';
const FIXDT_ARGS = "'" + NAME + "'"
  + '|(?:0|1|true|false)' + COMMA + '[1-9][0-9]*(?:' + COMMA + NUMBER + '){0,3}'
  + '(?:' + COMMA + "'DataTypeOverride'" + COMMA + "'(?:Off|Inherit)')?";
const SIGNAL_DATA_TYPE = new RegExp('^(?:fixdt\\( *(?:' + FIXDT_ARGS + ') *\\)|(?:Enum|Bus): *' + DOTTED + '|' + DOTTED + ')$');
const SIGNAL_NOT_MEASURED = new Set(['auto', 'half', 'string', 'struct']);

// The largest number of elements MATLAB takes a Signal's Dimensions to declare.
const INT32_MAX = 2147483647;

/** The name `property` of a `className` object is saved under, or null where it takes no edit. */
export function savedNameOf(className: string, property: string): string | null {
  return EDITABLE[className]?.[property] ?? null;
}

/** Whether objects of `className` take any edit at all. */
export function hasEditRules(className: string): boolean {
  return EDITABLE[className] !== undefined;
}

/**
 * Why `property` of the object `held` describes takes no edit whatever its new value, as a clause
 * naming it under `path` (the object's MATLAB path, `s.p`), or null where it takes one that the
 * value then decides (objectEditCells).
 */
export function propertyEditRefusal(held: McosObjectHeld, property: string, path: string): string | null {
  const named = path + '.' + property;
  const saved = savedNameOf(held.className, property);
  if (!hasEditRules(held.className)) {
    return path + ' is ' + classPhrase(held.className) + ', whose properties this package does not write into a MAT-file';
  }
  if (saved === null) {
    const why = EXCLUDED[held.className]?.[property]
      ?? (CODER_INFO_PROPERTIES.test(property) ? CODER_INFO : 'is not one this package writes into a MAT-file object');
    return named + ' ' + why;
  }
  const one = held.stored.get(saved);
  if (!one) {
    return named + ' is at its class default: the file holds no value for it, and a save can replace only a value the file holds';
  }
  if (one.refusal !== null || one.value === null) {
    return named + ' ' + heldWhy(one.refusal);
  }
  return null;
}

/**
 * Why `value`, as `property` of a `className` object holds it now, is one the rules write no cell
 * of, as a clause naming the property under `path`, or null: what the editor asks of a property
 * before any edit of it, a Value an edit of an element or a field leaves of the class it is.
 */
export function propertyValueRefusal(className: string, property: string, value: MatVariable, path: string): string | null {
  const saved = savedNameOf(className, property);
  if (saved === null) {
    return null;
  }
  if (saved === 'Value') {
    const what = valueClassRefusal(value, false);
    return what ? path + '.Value is ' + what + ', which this package does not write into ' + classPhrase(className) : null;
  }
  const written = cellValueFor(className, saved, value, path + '.' + property);
  return typeof written === 'string' ? written : null;
}

/**
 * What a member of a struct Value, `value`, is that the rules write no cell of (`a char`), or
 * null: a struct field of a Parameter holds what its Value may, but text.
 */
export function valueMemberRefusal(value: MatVariable): string | null {
  return valueClassRefusal(value, true);
}

// Why a held cell takes no swap, as the rest of a clause about it.
function heldWhy(refusal: McosEditRefusal | null): string {
  switch (refusal) {
    case 'not-a-cell':
      return "is held as an index into the file's text, not as a value, which a save does not rewrite";
    case 'shared-cell':
      return 'is held in a value the file names for another property as well, which a save would change too';
    case 'object-reference':
      return 'holds an object, which a save does not rewrite';
    default:
      return 'is held in a value that does not read as one a save can replace';
  }
}

/**
 * The value cells to write for `edits` of the object `held` describes, each edit's own and those
 * MATLAB's own edit changes with it; or the first edit refused, and why, as a clause naming the
 * property under `path`. No edits is no cells.
 *
 * The edits are judged together, as the object a save leaves: a Min and a Max set in one save are
 * held to each other as they will be, not as they were.
 */
export function objectEditCells(held: McosObjectHeld, edits: readonly McosPropertyEdit[], path: string): McosRulesResult {
  const refuse = (property: string, message: string): McosRulesResult => ({ ok: false, property, message });
  const cells = new Map<string, MatVariable>();
  const editedBy = new Map<string, string>();
  for (const { property, value } of edits) {
    const refused = propertyEditRefusal(held, property, path);
    if (refused) {
      return refuse(property, refused);
    }
    const saved = savedNameOf(held.className, property)!;
    if (cells.has(saved)) {
      return refuse(property, path + '.' + property + ' is edited twice in one save');
    }
    const written = cellValueFor(held.className, saved, value, path + '.' + property);
    if (typeof written === 'string') {
      return refuse(property, written);
    }
    cells.set(saved, written);
    editedBy.set(saved, property);
  }
  if (cells.size === 0) {
    return { ok: true, cells: [] };
  }

  // What MATLAB's own edit of the Value changes with it.
  const value = cells.get('Value');
  if (held.className === PARAMETER && value) {
    const co = valueCoWrites(held, value, path);
    if (typeof co === 'string') {
      return refuse('Value', co);
    }
    for (const [saved, v] of co) {
      cells.set(saved, v);
    }
    const range = valueRangeRefusal(held, value, co.has('DataType'), path);
    if (range) {
      return refuse('Value', range);
    }
  }

  // The object as the save leaves it, held to what MATLAB holds the whole of it to on load. A
  // file that already breaks one of these is not made to stop: an edit that touches none of what
  // the broken rule reads (a Description, under bounds that already cross) is not refused for it.
  const was = (saved: string) => held.stored.get(saved)?.value ?? null;
  const now = (saved: string) => cells.get(saved) ?? was(saved);
  const after = consistencyRefusal(held.className, now, path);
  if (after) {
    const before = consistencyRefusal(held.className, was, path);
    const typeChanged = effectiveDataType(held.className, was) !== effectiveDataType(held.className, now);
    const bound = ['Min', 'Max'].find((saved) => editedBy.has(saved));
    if (!before || before.message !== after.message || bound !== undefined || (after.readsDataType && typeChanged)) {
      return refuse(bound !== undefined ? editedBy.get(bound)! : editedBy.has('DataType') ? 'DataType' : 'Value', after.message);
    }
  }
  return { ok: true, cells: [...cells].map(([savedName, v]) => ({ savedName, value: v })) };
}

// The cell `value` is written as for the property saved as `saved`, normalized to what MATLAB
// writes for it, or why no cell is, as a clause naming the property (`named`).
function cellValueFor(className: string, saved: string, value: MatVariable, named: string): MatVariable | string {
  if (saved === 'Value') {
    const what = valueClassRefusal(value, false);
    return what ? named + ' would be ' + what + ', which this package does not write into ' + classPhrase(className) : nameless(value);
  }
  if (saved === 'Min' || saved === 'Max') {
    const n = count(value);
    const x = n === 1 ? firstReal(value) : null;
    const ok = classOf(value) === 'double' && !value.isComplex && !value.isSparse && (n === 0 || (x !== null && Number.isFinite(x)));
    if (!ok) {
      return named + ' must be a finite real double scalar or []: MATLAB refuses anything else, and loads it as []';
    }
    return n === 0 ? emptyDouble() : scalarDouble(x!);
  }
  if (TEXT_PROPERTIES.has(saved)) {
    return textCell(value, named);
  }
  if (saved === 'DataType') {
    const text = textOf(value);
    if (text === null || !(SIGNAL_BUILTIN.has(text) || SIGNAL_DATA_TYPE.test(text)) || SIGNAL_NOT_MEASURED.has(text)) {
      return named + ' would be ' + (text === null ? 'no text' : "'" + text + "'") + ', which is not a data type this package writes into ' + classPhrase(className);
    }
    return charCell(text);
  }
  if (saved === 'Dimensions') {
    const dims = classOf(value) === 'double' && !value.isComplex && !value.isSparse ? numbersOf(value) : null;
    const shape = value.dimensions ?? [];
    const row = shape.length === 2 && shape[0] === 1 && shape[1] >= 1;
    const inherited = !!dims && dims.length === 1 && dims[0] === -1;
    const whole = !!dims && dims.every((d) => Number.isInteger(d) && d > 0) && dims.reduce((a, b) => a * b, 1) <= INT32_MAX;
    const trailing = !!dims && dims.length > 2 && dims[dims.length - 1] === 1;
    if (!dims || !row || !(inherited || (whole && !trailing))) {
      return named + ' must be -1 or a row of positive whole numbers: MATLAB refuses anything else, and loads it as -1';
    }
    return rowDouble(dims);
  }
  return named + ' is not one this package writes into a MAT-file object';
}

/**
 * Why a Value of `v` is not one a cell swap writes into a Simulink.Parameter, as what it would be
 * (`a cell`), or null where it is: a numeric array of any class, real or complex, of any size, an
 * empty and an N-D one included; a real logical; a char row, which MATLAB loads as a string scalar;
 * and a struct whose every field holds one of those but text, at any depth (MATLAB refuses a char
 * field of a Parameter's struct). Not a cell, a sparse array (not measured), an object, a function
 * handle or a value this package could not write.
 */
function valueClassRefusal(v: MatVariable, inStruct: boolean): string | null {
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
  if (cls === 'char' && !inStruct) {
    const d = v.dimensions ?? [];
    return d.length === 2 && d[0] === 1 && d[1] >= 1 && textOf(v) !== null && !loneSurrogate(textOf(v)!) ? null : 'a char that is not one row of text';
  }
  if (cls === 'struct') {
    for (const held of Object.values(v.fields ?? {})) {
      for (const member of Array.isArray(held) ? held : [held]) {
        const below = member ? valueClassRefusal(member, true) : 'a struct with a field it does not hold';
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
 * The Dimensions and DataType cells MATLAB's own `p.Value = v` changes with the Value, measured:
 *
 *   - Dimensions becomes `double(size(v))`, unless it is held as text (a symbolic '[1,N]', which
 *     MATLAB keeps), v is empty (MATLAB keeps the old Dimensions), or the size is the same. A
 *     Dimensions written for an empty v, or written numeric over a symbolic one, loads as a state
 *     MATLAB's own edit does not make. Text is a string scalar, of size 1x1. Left alone where its
 *     cell takes no swap: MATLAB re-derives it from the Value on load, and the Value alone loads as
 *     MATLAB's edit does.
 *   - DataType, where the object holds one (no DataType cell is 'auto', which load re-derives),
 *     becomes v's class for a single or an integer, 'boolean' for a logical, 'string' for text, and
 *     for a struct stays what it was over a struct Value and becomes 'struct' over any other; a
 *     double v makes it 'auto' over a Value that was not double, and leaves it alone over one that
 *     was. 'auto' is written as the char 'auto', where MATLAB's own save drops the triple, which
 *     loads equal.
 *
 * Why not, as a clause, when the DataType has to change and its cell takes no swap: the Value then
 * loads converted, with a warning, every time.
 */
function valueCoWrites(held: McosObjectHeld, v: MatVariable, path: string): Map<string, MatVariable> | string {
  const out = new Map<string, MatVariable>();
  const dims = held.stored.get('Dimensions');
  const size = sizeOf(v);
  if (dims && dims.refusal === null && dims.value && classOf(dims.value) === 'double' && !size.includes(0)) {
    const was = numbersOf(dims.value);
    if (!was || was.length !== size.length || was.some((d, i) => d !== size[i])) {
      out.set('Dimensions', rowDouble(size));
    }
  }
  const dataType = held.stored.get('DataType');
  const old = held.stored.get('Value')?.value;
  if (dataType && old) {
    const dt = dataType.value ? textOf(dataType.value) : null;
    const after = dt === null ? null : dataTypeAfter(classOf(old), classOf(v), dt);
    if (dt === null || dataType.refusal !== null) {
      // Kept as it is, a DataType that does not read needs no cell; one that has to change does.
      if (after === null || after !== dt) {
        return path + '.DataType would have to follow the Value, and ' + path + '.DataType ' + heldWhy(dataType.refusal);
      }
    } else if (after !== dt) {
      out.set('DataType', charCell(after!));
    }
  }
  return out;
}

/** MATLAB's DataType after `p.Value = v` of class `now` over a Value of class `old` under DataType `dt`, measured. */
export function dataTypeAfter(old: string, now: string, dt: string): string {
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
 * Why a double Value `v` is refused under the DataType it keeps (`changed` false): a builtin one
 * whose range does not hold every element, real part and imaginary, as a clause; or null. MATLAB
 * takes such a Value with a warning, `Value (300) is out of data type range [0, 255] for data type
 * 'uint8'`, and warns again on every load, its own save of the edit included:
 *
 *   - an integer type: any element below its intmin or above its intmax, or NaN, or ±Inf (a
 *     fraction inside the range is fine);
 *   - single: NaN, ±Inf, or a magnitude past realmax('single');
 *   - double: NaN or ±Inf;
 *   - boolean: anything but 0 or 1, a complex value included.
 *
 * Not checked: fixdt(…), an alias, a bus, auto. A Value outside [Min, Max] is not checked either:
 * MATLAB does not warn of it.
 */
function valueRangeRefusal(held: McosObjectHeld, v: MatVariable, changed: boolean, path: string): string | null {
  const dataType = held.stored.get('DataType')?.value;
  const dt = dataType ? textOf(dataType) : null;
  if (changed || dt === null || classOf(v) !== 'double') {
    return null;
  }
  const named = path + '.Value would hold ';
  const warns = ', which MATLAB loads with a warning on every load';
  if (UNCHECKED_BUILTIN.has(dt)) {
    return path + ".Value would be double under a DataType of '" + dt + "', whose range this package does not check";
  }
  const parts = partsOf(v);
  if (dt === 'boolean') {
    if (v.isComplex) {
      return named + "a complex value, and a DataType of 'boolean' takes only 0 and 1" + warns;
    }
    const bad = parts.find((x) => x !== 0 && x !== 1);
    return bad === undefined ? null : named + numberText(bad) + ", and a DataType of 'boolean' takes only 0 and 1" + warns;
  }
  const range = rangeOf(dt);
  if (!range) {
    return null;
  }
  const bad = parts.find((x) => !Number.isFinite(x) || x < range[0] || x > range[1]);
  return bad === undefined ? null : named + numberText(bad) + ', outside the range ' + rangeText(dt, range) + " of its DataType '" + dt + "'" + warns;
}

/**
 * Whether the object's bounds hold, as MATLAB checks them on load: a non-empty Min no greater than
 * a non-empty Max (Min == Max is fine); each inside the range of a builtin DataType; and none at all
 * on a Signal whose DataType is a bus, where MATLAB ignores them and says so. Each of these warns on
 * every load, `Minimum (20) is greater than maximum (10)`. The first that fails, and whether it
 * reads the DataType, or null. `at` reads a property's cell as the save leaves it.
 */
function consistencyRefusal(
  className: string,
  at: (saved: string) => MatVariable | null,
  path: string,
): { message: string; readsDataType: boolean } | null {
  const bound = (saved: string): number | null => {
    const v = at(saved);
    return v && count(v) === 1 ? firstReal(v) : null;
  };
  const min = bound('Min');
  const max = bound('Max');
  const warns = ', which MATLAB loads with a warning on every load';
  if (min !== null && max !== null && min > max) {
    return { message: path + '.Min (' + numberText(min) + ') would be greater than its Max (' + numberText(max) + ')' + warns, readsDataType: false };
  }
  const dt = effectiveDataType(className, at);
  if (dt !== null && /^Bus:/.test(dt) && className === SIGNAL && (min !== null || max !== null)) {
    return {
      message: path + (min !== null ? '.Min' : '.Max') + " would be set while its DataType is '" + dt + "', and MATLAB ignores a minimum and a maximum for a bus" + warns,
      readsDataType: true,
    };
  }
  for (const [saved, x] of [['Min', min], ['Max', max]] as const) {
    if (x === null || dt === null) {
      continue;
    }
    if (UNCHECKED_BUILTIN.has(dt)) {
      return { message: path + '.' + saved + " would be set under a DataType of '" + dt + "', whose range this package does not check", readsDataType: true };
    }
    const range = dt === 'boolean' ? ([0, 1] as [number, number]) : rangeOf(dt);
    if (range && (x < range[0] || x > range[1])) {
      return {
        message: path + '.' + saved + ' (' + numberText(x) + ') would be outside the range ' + rangeText(dt, range) + " of its DataType '" + dt + "'" + warns,
        readsDataType: true,
      };
    }
  }
  return null;
}

// The DataType an object loads with, as the save leaves it: its DataType cell's text; for a
// Parameter with none, the one MATLAB derives from its Value's class (a double's 'auto'); 'auto'
// for a Signal with none. Null where it does not read.
function effectiveDataType(className: string, at: (saved: string) => MatVariable | null): string | null {
  const dataType = at('DataType');
  if (dataType) {
    return textOf(dataType);
  }
  const value = className === PARAMETER ? at('Value') : null;
  return value ? dataTypeAfter('double', classOf(value), 'auto') : 'auto';
}

function rangeOf(dt: string): [number, number] | null {
  if (dt === 'single') {
    return [-REALMAX_SINGLE, REALMAX_SINGLE];
  }
  if (dt === 'double') {
    return [-Infinity, Infinity];
  }
  return INTEGER_RANGE[dt] ?? null;
}

function rangeText(dt: string, range: [number, number]): string {
  return dt === 'single' ? "[-realmax('single'), realmax('single')]" : '[' + numberText(range[0]) + ', ' + numberText(range[1]) + ']';
}

// A text cell's value: a char row, `''` as a 0x0 char, as MATLAB holds an empty Description; or
// why not, as a clause naming the property. Not text holding a lone UTF-16 surrogate, which UTF-8
// cannot say: written, it would be another character.
function textCell(value: MatVariable, named: string): MatVariable | string {
  const text = textOf(value);
  const d = value.dimensions ?? [];
  const row = d.length === 2 && (d[0] === 1 || count(value) === 0);
  if (text === null || !row) {
    return named + ' must be text: MATLAB refuses anything else, and loads it as empty';
  }
  if (loneSurrogate(text)) {
    return named + ' holds a lone UTF-16 surrogate, which a MAT-file holds as another character';
  }
  return charCell(text);
}

/** The text a char variable holds, or null for one that is not text. */
function textOf(v: MatVariable): string | null {
  if (classOf(v) !== 'char' || v.isComplex) {
    return null;
  }
  return typeof v.value === 'string' ? v.value : v.value === null || v.value === undefined ? '' : null;
}

function loneSurrogate(text: string): boolean {
  return /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF])/.test(text);
}

// MATLAB's class of `v`: a logical array is class uint8 with the logical flag.
function classOf(v: MatVariable): string {
  return v.isLogical || v.className === 'logical' ? 'logical' : v.className;
}

// MATLAB's size(v): at least two extents, no trailing singleton past the second; a char's is a
// string scalar's, as a Parameter holds text.
function sizeOf(v: MatVariable): number[] {
  if (classOf(v) === 'char') {
    return [1, 1];
  }
  const d = (v.dimensions ?? []).slice();
  while (d.length < 2) {
    d.push(1);
  }
  while (d.length > 2 && d[d.length - 1] === 1) {
    d.pop();
  }
  return d;
}

function count(v: MatVariable): number {
  return (v.dimensions ?? [1, 1]).reduce((a, b) => a * b, 1);
}

function flat(value: unknown): unknown[] {
  if (value === null || value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

// The elements of a real numeric variable as numbers, or null where one is not a number.
function numbersOf(v: MatVariable): number[] | null {
  const out: number[] = [];
  for (const x of flat(v.value)) {
    if (typeof x !== 'number') {
      return null;
    }
    out.push(x);
  }
  return out.length === count(v) ? out : null;
}

function firstReal(v: MatVariable): number | null {
  const x = flat(v.value)[0];
  return typeof x === 'number' ? x : null;
}

// Every real part, and every imaginary part of a complex variable, as numbers (an exact 64-bit
// token as the double nearest it).
function partsOf(v: MatVariable): number[] {
  const out: number[] = [];
  for (const x of flat(v.value)) {
    if (x !== null && typeof x === 'object' && 're' in (x as Record<string, unknown>)) {
      out.push(Number((x as Record<string, unknown>).re), Number((x as Record<string, unknown>).im));
    } else {
      out.push(Number(x));
    }
  }
  return out;
}

function numberText(x: number): string {
  return Number.isNaN(x) ? 'NaN' : x === Infinity ? 'Inf' : x === -Infinity ? '-Inf' : String(x);
}

function nameless(v: MatVariable): MatVariable {
  return v.name === '' ? v : { ...v, name: '' };
}

function emptyDouble(): MatVariable {
  return { name: '', className: 'double', dimensions: [0, 0], isComplex: false, isLogical: false, value: [], fields: null };
}

function scalarDouble(x: number): MatVariable {
  return { name: '', className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value: x, fields: null };
}

function rowDouble(values: number[]): MatVariable {
  return {
    name: '',
    className: 'double',
    dimensions: [1, values.length],
    isComplex: false,
    isLogical: false,
    value: values.length === 1 ? values[0] : values.slice(),
    fields: null,
  };
}

function charCell(text: string): MatVariable {
  return { name: '', className: 'char', dimensions: text === '' ? [0, 0] : [1, text.length], isComplex: false, isLogical: false, value: text, fields: null };
}
