// Copyright 2026 The MathWorks, Inc.
import { classPhrase } from './MatWriter.js';
import { heldChar, parameterDataTypeAfter } from './McosPropertyRules.js';
const PARAMETER = 'Simulink.Parameter';
const SIGNAL = 'Simulink.Signal';
// The properties each class takes an edit of, and the name each is saved under. Measured on
// Simulink.Parameter and Simulink.Signal only: a subclass (mpt.Parameter, a user's own) may have
// set methods of its own, and is not edited.
const EDITABLE = {
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
const EXCLUDED = {
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
const CODER_INFO_PROPERTIES = /^(?:CoderInfo|StorageClass|Alignment|Identifier|HeaderFile|DefinitionFile|Owner|PreserveDimensions|StructName|GetFunction|SetFunction|DataScope)$/;
const TEXT_PROPERTIES = new Set(['Description', 'DocUnits', 'InitialValue']);
// What MATLAB's set methods make of text as it loads, measured against MATLAB R2027a over 125
// swapped cells of a Simulink.Parameter's and a Simulink.Signal's Description, Unit (DocUnits),
// InitialValue and DataType, each against the text written:
//
//   - a Description or a Unit loads as written, white space at either end, a tab, a newline, two
//     spaces and text that is not ASCII included, but for text that is white space alone (' ',
//     a tab, a newline, U+00A0, U+2003), which loads as ''. (MATLAB's own Unit set method refuses
//     some of that text, `a  b` and text that is not ASCII, as no unit it parses; its load does
//     not, and holds what was written);
//   - a Signal's InitialValue and DataType load with the white space at either end trimmed
//     (space, tab, newline, carriage return, vertical tab, form feed), and an InitialValue that is
//     not ASCII loads as '': its set method refuses it, and the load says nothing.
//
// A Parameter's Value of text loads as written, white space alone included. An edit of text that
// would load as other text than was typed is refused, saying what MATLAB would load.
const TRIMMED_AT_ENDS = new Set(['InitialValue', 'DataType']);
// `text` without the white space MATLAB trims at either end of it (TRIMMED_AT_ENDS): a scan in
// from each end, not a pattern. `/[ \t…]+$/` tries every place a run of white space starts and
// reads the run to its end each time, which is quadratic in a long run with other text after it,
// and the text is whatever the user typed.
function trimmedOfAsciiSpace(text) {
    let start = 0;
    let end = text.length;
    while (start < end && isAsciiSpace(text.charCodeAt(start))) {
        start++;
    }
    while (end > start && isAsciiSpace(text.charCodeAt(end - 1))) {
        end--;
    }
    return text.slice(start, end);
}
// Space, tab, newline, vertical tab, form feed, carriage return: the white space MATLAB trims.
function isAsciiSpace(code) {
    return code === 0x20 || (code >= 0x09 && code <= 0x0d);
}
// The classes a Value may be, as MATLAB holds them and this package writes them.
const NUMERIC = new Set(['double', 'single', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64']);
// The range of each builtin data type a double is checked against, as MATLAB's set method checks
// it: a Value out of it, or a Min or a Max, warns on every load. The top of int64 and of uint64,
// 2^63 - 1 and 2^64 - 1, is no double: the nearest is 2^63 or 2^64, which is out of the range, so
// a double is held below that (TOP_PAST), and the range is said as the integers it is (RANGE_TEXT).
const INTEGER_RANGE = {
    int8: [-128, 127],
    uint8: [0, 255],
    int16: [-32768, 32767],
    uint16: [0, 65535],
    int32: [-2147483648, 2147483647],
    uint32: [0, 4294967295],
    int64: [-(2 ** 63), 2 ** 63],
    uint64: [0, 2 ** 64],
};
const TOP_PAST = new Set(['int64', 'uint64']);
const RANGE_TEXT = { int64: '[-9223372036854775808, 9223372036854775807]', uint64: '[0, 18446744073709551615]' };
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
export function savedNameOf(className, property) {
    return EDITABLE[className]?.[property] ?? null;
}
/** Whether objects of `className` take any edit at all. */
export function hasEditRules(className) {
    return EDITABLE[className] !== undefined;
}
/**
 * Why `property` of the object `held` describes takes no edit whatever its new value, as a clause
 * naming it under `path` (the object's MATLAB path, `s.p`), or null where it takes one that the
 * value then decides (objectEditCells).
 */
export function propertyEditRefusal(held, property, path) {
    const named = path + '.' + property;
    const saved = savedNameOf(held.className, property);
    if (!hasEditRules(held.className)) {
        return path + ' is ' + classPhrase(held.className) + ', whose properties this editor does not write into a MAT-file';
    }
    if (saved === null) {
        const why = EXCLUDED[held.className]?.[property]
            ?? (CODER_INFO_PROPERTIES.test(property) ? CODER_INFO : 'is not one this editor writes into a MAT-file object');
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
export function propertyValueRefusal(className, property, value, path) {
    const saved = savedNameOf(className, property);
    if (saved === null) {
        return null;
    }
    if (saved === 'Value') {
        const what = valueClassRefusal(value, false);
        return what ? path + '.Value is ' + what + ', which this editor does not write into ' + classPhrase(className) : null;
    }
    const written = cellValueFor(className, saved, value, path + '.' + property);
    return typeof written === 'string' ? written : null;
}
/**
 * What a member of a struct Value, `value`, is that the rules write no cell of (`a string`), or
 * null: a struct field of a Parameter holds what its Value may, and a char of any shape.
 */
export function valueMemberRefusal(value) {
    return valueClassRefusal(value, true);
}
// Why a held cell takes no swap, as the rest of a clause about it.
function heldWhy(refusal) {
    switch (refusal) {
        case 'not-a-cell':
            return "is held as an index into the file's text, not as a value, which a save does not rewrite";
        case 'shared-cell':
            return 'is held in a value the file names for another property as well, which a save would change too';
        case 'shared-list':
            return "is held in a list of properties another of the file's objects holds as well, which a save would change too";
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
 *
 * `followed`, for a Simulink.Parameter, is the DataType its node shows (followedDataType): MATLAB's
 * after each edit of its Value in turn, written in place of the one derived from the file's Value
 * and DataType, with the Value, or on its own where the edits typed the Value back to the file's.
 */
export function objectEditCells(held, edits, path, followed, kept) {
    const refuse = (property, message) => ({ ok: false, property, message });
    const cells = new Map();
    const editedBy = new Map();
    for (const { property, value } of edits) {
        const refused = propertyEditRefusal(held, property, path);
        if (refused) {
            return refuse(property, refused);
        }
        const saved = savedNameOf(held.className, property);
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
    const heldDataType = held.stored.get('DataType')?.value;
    if (held.className === PARAMETER && followed !== undefined && !cells.has('Value') && heldDataType && textOf(heldDataType) !== followed) {
        cells.set('DataType', charCell(followed));
    }
    if (cells.size === 0) {
        return { ok: true, cells: [] };
    }
    // What MATLAB's own edit of the Value changes with it.
    const value = cells.get('Value');
    if (held.className === PARAMETER && value) {
        const co = valueCoWrites(held, value, path, followed, kept);
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
    const was = (saved) => held.stored.get(saved)?.value ?? null;
    const now = (saved) => cells.get(saved) ?? was(saved);
    const after = consistencyRefusal(held.className, now, path);
    if (after) {
        const before = consistencyRefusal(held.className, was, path);
        const typeChanged = effectiveDataType(held.className, was) !== effectiveDataType(held.className, now);
        const bound = ['Min', 'Max'].find((saved) => editedBy.has(saved));
        if (!before || before.message !== after.message || bound !== undefined || (after.readsDataType && typeChanged)) {
            return refuse(bound !== undefined ? editedBy.get(bound) : editedBy.has('DataType') ? 'DataType' : 'Value', after.message);
        }
    }
    return { ok: true, cells: [...cells].map(([savedName, v]) => ({ savedName, value: v })) };
}
// The cell `value` is written as for the property saved as `saved`, normalized to what MATLAB
// writes for it, or why no cell is, as a clause naming the property (`named`).
function cellValueFor(className, saved, value, named) {
    if (saved === 'Value') {
        const what = valueClassRefusal(value, false);
        if (what) {
            return named + ' would be ' + what + ', which this editor does not write into ' + classPhrase(className);
        }
        // An empty char as the 1x0 MATLAB loads as "".
        return classOf(value) === 'char' && count(value) === 0 ? { ...value, name: '', dimensions: [1, 0] } : nameless(value);
    }
    if (saved === 'Min' || saved === 'Max') {
        const n = count(value);
        const x = n === 1 ? firstReal(value) : null;
        const ok = classOf(value) === 'double' && !value.isComplex && !value.isSparse && (n === 0 || (x !== null && Number.isFinite(x)));
        if (!ok) {
            return named + ' must be a finite real double scalar or []: MATLAB refuses anything else, and loads it as []';
        }
        return n === 0 ? emptyDouble() : scalarDouble(x);
    }
    if (TEXT_PROPERTIES.has(saved)) {
        return textCell(saved, value, named);
    }
    if (saved === 'DataType') {
        const text = textOf(value);
        const loaded = text === null ? null : loadedTextRefusal(saved, text, named);
        if (loaded) {
            return loaded;
        }
        if (text === null || !(SIGNAL_BUILTIN.has(text) || SIGNAL_DATA_TYPE.test(text)) || SIGNAL_NOT_MEASURED.has(text)) {
            return named + ' would be ' + (text === null ? 'no text' : quoted(text)) + ', which is not a data type this editor writes into ' + classPhrase(className);
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
    return named + ' is not one this editor writes into a MAT-file object';
}
/**
 * Why a Value of `v` is not one a cell swap writes into a Simulink.Parameter, as what it would be
 * (`a cell`), or null where it is: a numeric array of any class, real or complex, of any size, an
 * empty and an N-D one included; a real logical; a char row, which MATLAB loads as a string scalar,
 * and an empty char of any shape, the string "" MATLAB's setter makes of it (written 1x0, which
 * MATLAB loads so: R2027a and R2023b); and a struct whose every field holds one of those, or a char of any shape, at any depth (heldChar).
 * Not a cell, a sparse array (not measured), an object (a string among them: a MAT-file holds one as
 * an object of the file), a function handle or a value this package could not write.
 */
function valueClassRefusal(v, inStruct) {
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
    if (cls === 'char') {
        const d = v.dimensions ?? [];
        const text = textOf(v);
        return d.length === 2 && text !== null && (d[0] === 1 || text === '') && !loneSurrogate(text) ? null : 'a char that is not one row of text';
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
 * loads converted, with a warning, every time. `followed` is the DataType MATLAB's edits of the
 * Value one at a time leave, where it is known (objectEditCells), in place of the one derived here.
 */
function valueCoWrites(held, v, path, followed, kept) {
    const out = new Map();
    // An empty Value keeps the Complexity the Parameter has, as MATLAB's setter does (3+4i and then []
    // leaves 'complex'), and MATLAB's load, which derives it of a Value that is not empty, takes an
    // empty one's from the file: where the file holds another, its cell is swapped for the one kept;
    // where it holds it in no cell (R2027a saves it as an index into the file's text), the edit is
    // refused, as a save would load it as the file's.
    const cls = classOf(v);
    const empty = count(v) === 0 && (NUMERIC.has(cls) || cls === 'logical');
    const complexity = kept?.complexity;
    if (empty && complexity !== undefined) {
        const c = held.stored.get('Complexity');
        const stored = c ? (c.value ? textOf(c.value) : c.text ?? null) : 'real';
        if (stored !== complexity) {
            if (c && c.refusal === null && c.value && textOf(c.value) !== null) {
                out.set('Complexity', charCell(complexity));
            }
            else {
                return path + ".Value would be empty, over which MATLAB keeps the Parameter's Complexity '" + complexity + "', and this file holds '"
                    + (stored ?? 'another') + "' for it in a form this editor does not write, so it would load as that";
            }
        }
    }
    // Of an empty Value, the Dimensions the Parameter has (the edits before it included: 3+4i and then
    // [] over [1+2i 3-4i] leaves [1 1]), but size(v) where they are an empty's, a 0 in them, as MATLAB
    // sets them (ParameterNode._emptyOverEmptyShape).
    const dims = held.stored.get('Dimensions');
    const size = sizeOf(v);
    if (dims && dims.refusal === null && dims.value && classOf(dims.value) === 'double') {
        const was = numbersOf(dims.value);
        const keptDims = kept?.dimensions ?? was;
        const target = !empty || !keptDims || keptDims.includes(0) ? size : keptDims;
        if (!target.includes(0) || empty) {
            if (!was || was.length !== target.length || was.some((d, i) => d !== target[i])) {
                out.set('Dimensions', rowDouble([...target]));
            }
        }
    }
    const dataType = held.stored.get('DataType');
    const old = held.stored.get('Value')?.value;
    if (dataType && old) {
        const dt = dataType.value ? textOf(dataType.value) : null;
        const after = dt === null ? null : followed ?? parameterDataTypeAfter(classOf(old), classOf(v), dt);
        if (dt === null || dataType.refusal !== null) {
            // Kept as it is, a DataType that does not read needs no cell; one that has to change does.
            if (after === null || after !== dt) {
                return path + '.DataType would have to follow the Value, and ' + path + '.DataType ' + heldWhy(dataType.refusal);
            }
        }
        else if (after !== dt) {
            out.set('DataType', charCell(after));
        }
    }
    return out;
}
/**
 * The DataType of the Simulink.Parameter `held` once its Value is `v`, as MATLAB's own `p.Value = v`
 * makes it over a Value of class `before` (the file's, where none is given) under DataType `dt`: the
 * one its node shows as it follows each edit of the Value in turn. Null where the object holds no
 * DataType cell that reads, whose DataType the rules derive from the file's alone (valueCoWrites).
 */
export function followedDataType(held, v, before, dt) {
    const cell = held.stored.get('DataType');
    const old = held.stored.get('Value')?.value;
    // One the object holds no DataType of, its class default 'auto', which MATLAB's load derives of
    // the Value, whatever the edits before it (mcosShown.withParameterValueShown, as the file opened
    // again shows it): no cell is written, and the node shows what MATLAB loads.
    if (held.className === PARAMETER && !cell && old) {
        return parameterDataTypeAfter('double', classOf(v), 'auto');
    }
    if (held.className !== PARAMETER || !cell || cell.refusal !== null || !cell.value || textOf(cell.value) === null || !old) {
        return null;
    }
    return parameterDataTypeAfter(before ?? classOf(old), classOf(v), dt);
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
function valueRangeRefusal(held, v, changed, path) {
    const dataType = held.stored.get('DataType')?.value;
    const dt = dataType ? textOf(dataType) : null;
    if (changed || dt === null || classOf(v) !== 'double') {
        return null;
    }
    const named = path + '.Value would hold ';
    const warns = ', which MATLAB loads with a warning on every load';
    if (UNCHECKED_BUILTIN.has(dt)) {
        return path + ".Value would be double under a DataType of '" + dt + "', whose range this editor does not check";
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
    const bad = parts.find((x) => !Number.isFinite(x) || outside(dt, range, x));
    return bad === undefined ? null : named + numberText(bad) + ', outside the range ' + rangeText(dt, range) + " of its DataType '" + dt + "'" + warns;
}
/**
 * Whether the object's bounds hold, as MATLAB checks them on load: a non-empty Min no greater than
 * a non-empty Max (Min == Max is fine); each inside the range of a builtin DataType; and none at all
 * on a Signal whose DataType is a bus, where MATLAB ignores them and says so. Each of these warns on
 * every load, `Minimum (20) is greater than maximum (10)`. The first that fails, and whether it
 * reads the DataType, or null. `at` reads a property's cell as the save leaves it.
 */
function consistencyRefusal(className, at, path) {
    const bound = (saved) => {
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
    for (const [saved, x] of [['Min', min], ['Max', max]]) {
        if (x === null || dt === null) {
            continue;
        }
        if (UNCHECKED_BUILTIN.has(dt)) {
            return { message: path + '.' + saved + " would be set under a DataType of '" + dt + "', whose range this editor does not check", readsDataType: true };
        }
        const range = dt === 'boolean' ? [0, 1] : rangeOf(dt);
        if (range && outside(dt, range, x)) {
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
function effectiveDataType(className, at) {
    const dataType = at('DataType');
    if (dataType) {
        return textOf(dataType);
    }
    const value = className === PARAMETER ? at('Value') : null;
    return value ? parameterDataTypeAfter('double', classOf(value), 'auto') : 'auto';
}
function rangeOf(dt) {
    if (dt === 'single') {
        return [-REALMAX_SINGLE, REALMAX_SINGLE];
    }
    if (dt === 'double') {
        return [-Infinity, Infinity];
    }
    return INTEGER_RANGE[dt] ?? null;
}
// Whether the double `x` is outside `range`, the range of the DataType `dt`: below its bottom, or
// above its top, or at it where the top is the first double past the range (TOP_PAST).
function outside(dt, range, x) {
    return x < range[0] || (TOP_PAST.has(dt) ? x >= range[1] : x > range[1]);
}
function rangeText(dt, range) {
    return dt === 'single' ? "[-realmax('single'), realmax('single')]" : RANGE_TEXT[dt] ?? '[' + numberText(range[0]) + ', ' + numberText(range[1]) + ']';
}
// A text cell's value: a char row, `''` as a 0x0 char, as MATLAB holds an empty Description; or
// why not, as a clause naming the property. Not text holding a lone UTF-16 surrogate, which UTF-8
// cannot say: written, it would be another character; nor text MATLAB loads as other text
// (loadedTextRefusal).
function textCell(saved, value, named) {
    const text = textOf(value);
    const d = value.dimensions ?? [];
    const row = d.length === 2 && (d[0] === 1 || count(value) === 0);
    if (text === null || !row) {
        return named + ' must be text: MATLAB refuses anything else, and loads it as empty';
    }
    if (loneSurrogate(text)) {
        return named + ' holds a lone UTF-16 surrogate, which the file would hold as another character';
    }
    return loadedTextRefusal(saved, text, named) ?? charCell(text);
}
// Why `text`, written into the property saved as `saved`, is not what MATLAB loads, as a clause
// naming it (`named`) and saying what it would load, or null where it loads as written: see
// TRIMMED_AT_ENDS above.
function loadedTextRefusal(saved, text, named) {
    const would = named + ' would be ' + quoted(text) + ', which MATLAB would load as ';
    if (saved === 'InitialValue' && /[^\x00-\x7f]/.test(text)) {
        return would + "'': its InitialValue takes only ASCII text";
    }
    if (TRIMMED_AT_ENDS.has(saved)) {
        const trimmed = trimmedOfAsciiSpace(text);
        return trimmed === text ? null : would + quoted(trimmed) + ': it trims the white space at either end';
    }
    return text !== '' && /^\s+$/.test(text) ? would + "'': it loads text of white space alone as empty" : null;
}
// `text` in single quotes, for a message, a control character in it spelled as an escape.
function quoted(text) {
    const spelled = { '\n': '\\n', '\t': '\\t', '\r': '\\r' };
    return "'" + text.replace(/[\x00-\x1f\x7f]/g, (c) => spelled[c] ?? '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')) + "'";
}
/** The text a char variable holds, or null for one that is not text. */
function textOf(v) {
    if (classOf(v) !== 'char' || v.isComplex) {
        return null;
    }
    return typeof v.value === 'string' ? v.value : v.value === null || v.value === undefined ? '' : null;
}
function loneSurrogate(text) {
    return /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF])/.test(text);
}
// MATLAB's class of `v`: a logical array is class uint8 with the logical flag.
function classOf(v) {
    return v.isLogical || v.className === 'logical' ? 'logical' : v.className;
}
// MATLAB's size(v): at least two extents, no trailing singleton past the second; a char's is a
// string scalar's, as a Parameter holds text.
function sizeOf(v) {
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
function count(v) {
    return (v.dimensions ?? [1, 1]).reduce((a, b) => a * b, 1);
}
function flat(value) {
    if (value === null || value === undefined) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}
// The elements of a real numeric variable as numbers, or null where one is not a number.
function numbersOf(v) {
    const out = [];
    for (const x of flat(v.value)) {
        if (typeof x !== 'number') {
            return null;
        }
        out.push(x);
    }
    return out.length === count(v) ? out : null;
}
function firstReal(v) {
    const x = flat(v.value)[0];
    return typeof x === 'number' ? x : null;
}
// Every real part, and every imaginary part of a complex variable, as numbers (an exact 64-bit
// token as the double nearest it).
function partsOf(v) {
    const out = [];
    for (const x of flat(v.value)) {
        if (x !== null && typeof x === 'object' && 're' in x) {
            out.push(Number(x.re), Number(x.im));
        }
        else {
            out.push(Number(x));
        }
    }
    return out;
}
function numberText(x) {
    return Number.isNaN(x) ? 'NaN' : x === Infinity ? 'Inf' : x === -Infinity ? '-Inf' : String(x);
}
function nameless(v) {
    return v.name === '' ? v : { ...v, name: '' };
}
function emptyDouble() {
    return { name: '', className: 'double', dimensions: [0, 0], isComplex: false, isLogical: false, value: [], fields: null };
}
function scalarDouble(x) {
    return { name: '', className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value: x, fields: null };
}
function rowDouble(values) {
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
function charCell(text) {
    return { name: '', className: 'char', dimensions: text === '' ? [0, 0] : [1, text.length], isComplex: false, isLogical: false, value: text, fields: null };
}
//# sourceMappingURL=McosEditRules.js.map