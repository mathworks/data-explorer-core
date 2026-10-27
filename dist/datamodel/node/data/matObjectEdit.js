// Copyright 2026 The MathWorks, Inc.
import { mcosPlaceOf } from '../mcosPlace.js';
import { MatWriteError, classPhrase } from '../../parser/MatWriter.js';
import { variableDifference } from '../../parser/MatFileWriter.js';
import { objectIdOf, valueCellOf } from '../../parser/McosSubsystemEdit.js';
import { isObjectHandle } from '../../parser/McosHandle.js';
import { McosValueKind, isHandleOpaque, measuredVersion, propertiesOf, readDescriptor, cloneSubsystem, replaceValueCell, stringObjectOf, stringPayloadCell, } from '../../parser/McosSubsystemCodec.js';
import { elementValue } from '../../parser/McosObjectWrite.js';
import { addBusElements, busElementsOf, removeBusElement } from '../../parser/McosTemplateMerge.js';
import { editedObjects, handleRuleObjectOf, heldObjectIds, ruleObjectOf, writeObjectEdits } from '../../parser/McosObjectWrite.js';
import { hasPropertyRules, isCoWritten, parameterDataTypeAfter, parameterValueRefusal, planPropertyEdits, propertyChoices, propertyRowOf, } from '../../parser/McosPropertyRules.js';
import { getSchema, hydrate, resolveSourcePath } from '../../schema/index.js';
import { numericTypeShown } from '../mcosShown.js';
import StructNode from './StructNode.js';
import { dataTypeFollowedFrom, nodePropertyValue, REFUSED, shapeShown } from './mcosObjectEdit.js';
// The edits of a MAT-file's MCOS objects a save writes, read off their nodes, held to the property
// rules (McosPropertyRules) and written through the codec (McosObjectWrite): a property swapped,
// one at its default given a value (a triple inserted), one set back to it (its triple removed),
// with what MATLAB's setters change beside it. The MAT-file's own path (MatNode); a dictionary
// value's stream keeps the cell swap and its rules (mcosObjectEdit, McosEditRules).
//
// WHAT A NODE OFFERS. Each class's node holds some of its object's properties as fields an editor
// changes (a Signal's Min, Complexity; an AliasType's BaseType), and shows some of the objects it
// holds (its CoderInfo's StorageClass, as a column of its own row; a Bus's elements, each a row
// under it). Those are its spots: where the property is, the object itself or one it holds, and its
// public name there. A spot's value is read off the node as the variable a save writes, and
// compared with what the file holds of the property, its triple's value or, for one the object
// saved none of, the field of the file's defaults struct it loads as: equal, nothing is written;
// otherwise it is an edit, which the rules write, or refuse.
//
// WHAT IS TRUSTED. As mcosObjectEdit's: a spot is written only if, as the node held it before any
// edit, it read back as the file's value exactly; and the node's other fields are held to a
// fingerprint taken then, so that one no spot writes, changed by a path that asked no rule,
// refuses the save rather than being dropped from it.
const PARAMETER = 'Simulink.Parameter';
const SIGNAL = 'Simulink.Signal';
const BUS = 'Simulink.Bus';
const BUS_ELEMENT = 'Simulink.BusElement';
const NUMERIC_TYPE = 'Simulink.NumericType';
const STRING = 'string';
/**
 * A typed text as an offered editor of `kind` takes it (MatNode._setOffered, dictObjectEdit): text
 * as typed, a choice (which the rules hold to theirs), true or false, a number, or a row of numbers
 * (a number alone, or in brackets, by spaces or commas), Inf and -Inf among them; or why it is none.
 */
export function offeredValue(text, kind) {
    const number = (t) => {
        const u = t.trim();
        if (/^[+-]?inf$/i.test(u)) {
            return u.startsWith('-') ? -Infinity : Infinity;
        }
        return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(u) ? Number(u) : null;
    };
    switch (kind) {
        case 'text':
        case 'choice':
            return { value: text };
        case 'flag': {
            const t = text.trim();
            if (t === 'true' || t === '1') {
                return { value: true };
            }
            if (t === 'false' || t === '0') {
                return { value: false };
            }
            return 'must be true or false';
        }
        case 'number': {
            const x = number(text);
            return x === null ? 'must be a number' : { value: x };
        }
        case 'numbers': {
            const t = text.trim().replace(/^\[(.*)\]$/s, '$1').trim();
            const xs = t === '' ? [] : t.split(/[\s,]+/).map(number);
            return xs.length === 0 || xs.some((x) => x === null) ? 'must be a number or a row of numbers' : { value: xs.length === 1 ? xs[0] : xs };
        }
    }
}
/**
 * The editor an offered property of a `className` object shows, by how its text is read
 * (MatNode._offeredEditor, dictObjectEdit): a dropdown of true and false for a flag, of the rules'
 * choices for a choice they hold to a closed set, else a text box.
 */
export function offeredEditorOf(className, editor) {
    if (editor.kind === 'flag') {
        return { editor: 'select', options: ['true', 'false'] };
    }
    const choices = editor.kind === 'choice' ? propertyChoices(className, editor.property) : null;
    return choices ? { editor: 'select', options: [...choices] } : { editor: 'text' };
}
/** What the node `holder` shows of the property an editor writes (MatBagEditor): its field, else its bag's key. */
export function matBagEditorShown(holder, editor) {
    return editor.field ? holder[editor.field] : bagValueOf(holder, editor.bag);
}
// The editors a MAT-file offers, by the node's class and the key the node shows the property
// under (the Property Inspector's, and a table column's).
// A CoderInfo's Identifier, shown beside the Alias it is saved as (mcosShown.shownPropertiesOf).
const IDENTIFIER = { property: 'Identifier', bag: 'CoderInfo.Identifier', mirror: 'CoderInfo.Alias', kind: 'text' };
const BAG_EDITORS = {
    [PARAMETER]: { identifier: IDENTIFIER },
    [SIGNAL]: {
        identifier: IDENTIFIER,
        dimensions: { property: 'Dimensions', bag: 'Dimensions', kind: 'numbers' },
        initialValue: { property: 'InitialValue', bag: 'InitialValue', kind: 'text' },
        sampleTime: { property: 'SampleTime', bag: 'SampleTime', kind: 'numbers' },
        samplingMode: { property: 'SamplingMode', bag: 'SamplingMode', kind: 'choice' },
    },
    [BUS]: {
        dataScope: { property: 'DataScope', bag: 'DataScope', kind: 'choice' },
        headerFile: { property: 'HeaderFile', bag: 'HeaderFile', kind: 'text' },
        alignment: { property: 'Alignment', bag: 'Alignment', kind: 'number' },
        preserveElementDimensions: { property: 'PreserveElementDimensions', bag: 'PreserveElementDimensions', kind: 'flag' },
    },
    [BUS_ELEMENT]: {
        dimensions: { property: 'Dimensions', field: 'Dimensions', kind: 'numbers' },
    },
    'Simulink.ValueType': {
        dimensions: { property: 'Dimensions', bag: 'Dimensions', field: 'Dimensions', kind: 'numbers' },
    },
    'Simulink.AliasType': {
        dataScope: { property: 'DataScope', bag: 'DataScope', kind: 'choice' },
        headerFile: { property: 'HeaderFile', bag: 'HeaderFile', kind: 'text' },
    },
    // Its Signedness, FractionLength and Slope as MATLAB shows them, of the SignednessBool,
    // FixedExponent and SlopeAdjustmentFactor it saves (numericTypeShown).
    [NUMERIC_TYPE]: {
        dataTypeMode: { property: 'DataTypeMode', bag: 'DataTypeMode', kind: 'choice' },
        signedness: { property: 'Signedness', bag: 'Signed', kind: 'choice' },
        wordLength: { property: 'WordLength', bag: 'WordLength', kind: 'number' },
        fractionLength: { property: 'FractionLength', bag: 'FractionLength', kind: 'number' },
        slope: { property: 'Slope', bag: 'Slope', kind: 'number' },
        bias: { property: 'Bias', bag: 'Bias', kind: 'number' },
        dataTypeOverride: { property: 'DataTypeOverride', bag: 'DataTypeOverride', kind: 'choice' },
        isAlias: { property: 'IsAlias', bag: 'IsAlias', kind: 'flag' },
        dataScope: { property: 'DataScope', bag: 'DataScope', kind: 'choice' },
        headerFile: { property: 'HeaderFile', bag: 'HeaderFile', kind: 'text' },
    },
};
/**
 * The keys of an object's property bag a row of its shows under another name, which its Property
 * Inspector's "Other" does not list again (MatNode._inspectorRows): a NumericType's SignednessBool,
 * FixedExponent and SlopeAdjustmentFactor, which its Signedness, FractionLength and Slope show; a
 * Bus's elements, which its rows are; a ValueType's own element.
 */
export const MAT_SHOWN_SAVED_KEYS = Object.freeze(['SignednessBool', 'FixedExponent', 'SlopeAdjustmentFactor', 'Elements_internal', 'be']);
/** Every editor a MAT-file offers on a node of `className` (BAG_EDITORS). */
export function matBagEditorsOf(className) {
    return Object.values(BAG_EDITORS[className] ?? {});
}
/**
 * Whether a node's `property` is a spot of its class at all, by the class alone: of an object's own
 * row (`objectClass` its class), its OWN_SPOTS; of a bus element's row (`objectClass` null and the
 * row's class a BusElement), its ELEMENT_SPOTS.
 */
export function matOffersSpot(objectClass, rowClass, property) {
    return objectClass !== null ? (OWN_SPOTS[objectClass] ?? []).includes(property) : rowClass === BUS_ELEMENT && ELEMENT_SPOTS.includes(property);
}
/**
 * The keys of `rowKeys`, the rows a node of `className` shows, whose property a MAT-file offers an
 * editor of, in the order the editor judges them (OWN_SPOTS: a NumericType's mode first), and then
 * the columns of an object it holds (HELD_COLUMNS: a CoderInfo's StorageClass); of a bus element's
 * row, its ELEMENT_SPOTS, its Name apart. What a paste sets of a copied object on the one it makes
 * (matPaste.carryInto), by the spots the editor writes and no list of its own.
 */
export function matCarriedKeysOf(className, rowKeys) {
    const rows = rowKeys.filter((k) => k !== 'Name' && k !== 'name');
    // A string's text, which is all of it a save writes (matPropertyAt).
    if (className === STRING) {
        return rows.filter((k) => k === 'Value');
    }
    const spots = className === BUS_ELEMENT ? ELEMENT_SPOTS.filter((p) => p !== 'Name') : (OWN_SPOTS[className] ?? []);
    const keys = [];
    for (const property of spots) {
        const key = rows.find((k) => capitalized(k) === property && !heldColumnOf(className, k));
        if (key !== undefined && !keys.includes(key)) {
            keys.push(key);
        }
    }
    if (className !== BUS_ELEMENT) {
        for (const key of rows) {
            if (heldColumnOf(className, key) && !keys.includes(key)) {
                keys.push(key);
            }
        }
    }
    return keys;
}
/** The editor a MAT-file offers of `key` on a node of `className`, or null (BAG_EDITORS). */
export function matBagEditorOf(className, key) {
    const editors = BAG_EDITORS[className];
    return editors && Object.prototype.hasOwnProperty.call(editors, key) ? editors[key] : null;
}
// The editor of `property`, by the rules' name of it, on a node of `className`, or null.
function bagEditorFor(className, property) {
    return Object.values(BAG_EDITORS[className] ?? {}).find((e) => e.property === property) ?? null;
}
// The properties of BAG_EDITORS of `className` that are its own (not its CoderInfo's), by the rules' names.
const bagSpots = (className) => Object.values(BAG_EDITORS[className] ?? {}).filter((e) => !e.bag?.includes('.')).map((e) => e.property);
// The properties each class's node offers an editor of, as its own node fields, or its bag's.
const OWN_SPOTS = {
    [PARAMETER]: ['Value', 'Min', 'Max', 'Description', 'Unit', 'DataType'],
    [SIGNAL]: ['Min', 'Max', 'Description', 'Unit', 'DataType', 'Complexity', 'DimensionsMode', ...bagSpots(SIGNAL)],
    [BUS]: ['Description', ...bagSpots(BUS)],
    'Simulink.ValueType': ['DataType', 'Min', 'Max', 'Unit', 'Description', 'Complexity', 'DimensionsMode', ...bagSpots('Simulink.ValueType')],
    // A NumericType's DataTypeMode first: the edits of the others are judged in the mode it leaves.
    [NUMERIC_TYPE]: [...bagSpots(NUMERIC_TYPE), 'Description'],
    'Simulink.AliasType': ['BaseType', 'Description', ...bagSpots('Simulink.AliasType')],
    'Simulink.LookupTable': [],
    'Simulink.Breakpoint': [],
};
// A schema column of an object's own row that is a property of an object it holds.
const HELD_COLUMNS = {
    storageClass: { classes: [PARAMETER, SIGNAL], saved: 'CoderInfo', property: 'StorageClass' },
    alignment: { classes: [PARAMETER, SIGNAL], saved: 'CoderInfo', property: 'Alignment' },
    identifier: { classes: [PARAMETER, SIGNAL], saved: 'CoderInfo', property: 'Identifier' },
};
// The HELD_COLUMNS entry of the row `key` of an object of `cls`, or null where that row is no
// property of an object it holds.
function heldColumnOf(cls, key) {
    const held = Object.prototype.hasOwnProperty.call(HELD_COLUMNS, key) ? HELD_COLUMNS[key] : null;
    return held && held.classes.includes(cls) ? held : null;
}
// The properties a Bus's element row offers an editor of, as the element node's fields.
const ELEMENT_SPOTS = ['Name', 'DataType', 'Min', 'Max', 'Unit', 'Description', 'Complexity', 'DimensionsMode', ...bagSpots(BUS_ELEMENT)];
// What a node of an object that other nodes are too (two variables holding one handle, `r = h`)
// shows of each edit through another of them (mcosObjectEdit.mirrorTwins): the properties of
// mcosObjectEdit's, copied between them. Any other spot of such an object is refused, as an edit
// through one node the other would not show.
const MIRRORED = {
    [PARAMETER]: ['Value', 'Min', 'Max', 'Description', 'Unit'],
    [SIGNAL]: ['Min', 'Max', 'Description', 'Unit', 'DataType'],
};
/** The key a spot is kept under, and an edit of it named by. */
function spotKey(spot) {
    return (spot.nested ? spot.nested.saved + '(' + spot.nested.index + ').' : '') + spot.property;
}
// ---- Reading a node ------------------------------------------------------------------------------
function classOf(node) {
    return String(node.className || '');
}
function charOf(text) {
    return { name: '', className: 'char', dimensions: text === '' ? [0, 0] : [1, text.length], isComplex: false, isLogical: false, value: text, fields: null };
}
// The properties a node holds of its CoderInfo, as read (McosParser: an MCOS CoderInfo's, or what
// a 'handle' opaque's holds of the three an edit writes), and as the schema's columns write them.
function coderInfoShown(node) {
    const coder = node.serial?._properties?.CoderInfo;
    return (coder?._properties ?? coder ?? {});
}
function doubleOf(x) {
    return { name: '', className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value: x, fields: null };
}
function doubleRowOf(xs) {
    return { name: '', className: 'double', dimensions: [1, xs.length], isComplex: false, isLogical: false, value: xs.length === 1 ? xs[0] : xs.slice(), fields: null };
}
// What a node's property bag holds at `key`, a path into it ('CoderInfo.Identifier'), a typed
// scalar ({_type, _value}) as its number.
function bagValueOf(holder, key) {
    const v = resolveSourcePath(holder.serial?._properties, key);
    return v && typeof v === 'object' && !Array.isArray(v) && '_value' in v ? Number(v._value) : v;
}
// A flag as the node or the file holds it, true or false (a logical or a number 0 or 1), or null.
function flagOf(v) {
    if (typeof v === 'boolean') {
        return v;
    }
    return v === 0 || v === 1 ? v === 1 : null;
}
/**
 * The value `raw`, what a node's bag holds of a property a MAT-file offers an editor of
 * (MatBagEditor), as the variable a save writes, of the kind the editor takes it as; or why it is
 * none. A flag is a double 0 or 1, as its file's value is compared with it (flagReference).
 */
function bagSpotValue(raw, kind) {
    switch (kind) {
        case 'text':
        case 'choice':
            return typeof raw === 'string' ? charOf(raw) : 'is not held as text';
        case 'flag': {
            const b = flagOf(raw);
            return b === null ? 'is not held as true or false' : doubleOf(b ? 1 : 0);
        }
        case 'number':
            return typeof raw === 'number' ? doubleOf(raw) : 'is not held as a number';
        case 'numbers': {
            const xs = typeof raw === 'number' ? [raw] : Array.isArray(raw) && raw.length > 0 && raw.every((x) => typeof x === 'number') ? raw : null;
            return xs ? doubleRowOf(xs) : 'is not held as a row of numbers';
        }
    }
}
// The file's value of a flag, held as a logical, an integer or a double, as the double 0 or 1 a
// node's is compared with; null for none of those.
function flagReference(held) {
    const x = held && (held.dimensions ?? [1, 1]).every((d) => d === 1) ? held.value : null;
    const b = flagOf(typeof x === 'boolean' ? x : typeof x === 'number' ? x : null);
    return b === null ? null : doubleOf(b ? 1 : 0);
}
/**
 * What the file holds of a NumericType's Signedness, FractionLength and Slope as MATLAB shows them
 * (numericTypeShown), of the SignednessBool, FixedExponent and SlopeAdjustmentFactor its triples
 * hold; null for another property, or one the file does not hold as those.
 */
function numericTypeReference(rule, property) {
    const num = (saved) => {
        const r = referenceOf(rule, saved);
        return r && typeof r.value === 'number' ? r.value : null;
    };
    const sign = referenceOf(rule, 'SignednessBool');
    const fe = num('FixedExponent');
    const saf = num('SlopeAdjustmentFactor');
    const signed = sign ? (numelOfVariable(sign) === 0 ? 'Auto' : flagOf(sign.value) === null ? null : flagOf(sign.value) ? 'Signed' : 'Unsigned') : null;
    switch (property) {
        case 'Signedness':
            return signed === null ? null : charOf(signed);
        case 'FractionLength':
            return fe === null ? null : doubleOf(-fe + 0);
        case 'Slope':
            return fe === null || saf === null ? null : doubleOf(saf * 2 ** fe);
        default:
            return null;
    }
}
function numelOfVariable(v) {
    return (v.dimensions ?? [1, 1]).reduce((a, b) => a * b, 1);
}
// The StorageClass a node shows of its CoderInfo, as its class's storageClass column reads it.
function storageClassShown(node) {
    const prop = getSchema(classOf(node))?.find((p) => p.key === 'storageClass');
    return prop ? hydrate(node.serial?._properties, prop) : undefined;
}
/**
 * The value of `property` the node `holder` holds now, as the variable a save writes, nameless; or
 * why it holds none, as the rest of a clause about the property. `field`, when given, is what the
 * node would hold instead, as the node holds it (a bound as a number or undefined, text as a
 * string, a Value as the value node an edit would make). The properties mcosObjectEdit reads, as
 * it reads them; a bus element's Name as the row's name; a StorageClass as its column shows it;
 * any other as the text the node's field of that name holds.
 */
export function spotValue(holder, property, field) {
    if (property === 'Value' && classOf(holder) === STRING) {
        return stringValueOf(holder, field);
    }
    const editor = bagEditorFor(classOf(holder), property);
    if (editor) {
        return bagSpotValue(field ? field.value : matBagEditorShown(holder, editor), editor.kind);
    }
    switch (property) {
        case 'Value':
        case 'Min':
        case 'Max':
        case 'Description':
        case 'Unit':
        case 'DataType':
            return nodePropertyValue(holder, property, field);
        case 'Name': {
            const t = field ? field.value : holder.name;
            return typeof t === 'string' ? charOf(t) : 'is not held as text';
        }
        case 'StorageClass': {
            const t = field ? field.value : storageClassShown(holder);
            return typeof t === 'string' ? charOf(t) : 'is not held as text';
        }
        case 'Identifier': {
            const t = field ? field.value : coderInfoShown(holder).Alias ?? '';
            return typeof t === 'string' ? charOf(t) : 'is not held as text';
        }
        case 'Alignment': {
            const t = field ? field.value : coderInfoShown(holder).Alignment ?? -1;
            const x = typeof t === 'number' ? t : t && typeof t === 'object' && '_value' in t ? Number(t._value) : NaN;
            return Number.isFinite(x) ? doubleOf(x) : 'is not held as a number';
        }
        default: {
            const t = field ? field.value : holder[property];
            return typeof t === 'string' ? charOf(t) : 'is not held as text';
        }
    }
}
/**
 * The text of the `string` node `node` holds, as a variable of class 'string' whose value is its
 * elements, column-major (null for <missing>), and its size; with `field`, an edit about to be made,
 * in place of what it holds: one element's text (an ElementEdit), or the whole of it (the node an
 * edit typed in). Or why it holds none.
 */
function stringValueOf(node, field) {
    const v = field?.value;
    if (v && typeof v === 'object' && 'element' in v && 'scalar' in v) {
        const now = stringValueOf(node);
        const k = node.children.indexOf(v.element);
        if (typeof now === 'string' || k < 0) {
            return typeof now === 'string' ? now : 'holds no element there';
        }
        const texts = now.value.slice();
        texts[k] = String(v.scalar);
        return { ...now, value: texts };
    }
    const n = (field ? v : node);
    const of = (dims, texts) => ({
        name: '',
        className: STRING,
        dimensions: dims.slice(),
        isComplex: false,
        isLogical: false,
        value: texts.map((t) => (t === null || t === undefined ? null : String(t))),
        fields: null,
    });
    if (n && n._kind === 'string' && Array.isArray(n._elements) && Array.isArray(n._dims)) {
        return of(n._dims, n._elements);
    }
    if (n && n._kind === 'scalar' && n._scalarType === 'string') {
        return of([1, 1], [n._scalarValue]);
    }
    return 'is not held as a string';
}
// The path of the first object reference `v`, a value the file holds, holds in a struct field or a
// cell at any depth, under `path`, or null: the handle words of an object of the file, which MATLAB
// writes for a string or another object a struct or a cell inside an object's property holds.
function objectInside(v, path) {
    if (!v) {
        return null;
    }
    if (isObjectHandle(v)) {
        return path;
    }
    if (v.className === 'cell' && Array.isArray(v.value)) {
        for (let i = 0; i < v.value.length; i++) {
            const below = objectInside(v.value[i], path + '{' + (i + 1) + '}');
            if (below) {
                return below;
            }
        }
    }
    if (v.className === 'struct') {
        for (const [name, held] of Object.entries(v.fields ?? {})) {
            const elements = Array.isArray(held) ? held : [held];
            for (let i = 0; i < elements.length; i++) {
                const below = objectInside(elements[i], path + (Array.isArray(held) ? '(' + (i + 1) + ')' : '') + '.' + name);
                if (below) {
                    return below;
                }
            }
        }
    }
    return null;
}
// Whether two values are one: two strings by their size and every element's text, anything else
// as the save's self-check compares it (MatFileWriter.variableDifference).
function valueDifference(a, b, named) {
    if (a.className === STRING || b.className === STRING) {
        const same = a.className === b.className && a.dimensions.join('x') === b.dimensions.join('x') && JSON.stringify(a.value) === JSON.stringify(b.value);
        return same ? null : named + ': it is ' + a.dimensions.join('x') + ' string ' + JSON.stringify(a.value) + ' where the file holds ' + b.dimensions.join('x') + ' ' + JSON.stringify(b.value);
    }
    return variableDifference(a, b, named);
}
// What the file holds of the property saved as `saved` of `rule`, as a node's value is compared
// with it: its triple's value (an index's text as a char), else the field of the file's defaults
// struct it loads as; null for neither, or a cell that does not read.
function referenceOf(rule, saved) {
    const held = rule.held.get(saved);
    if (held) {
        switch (held.kind) {
            case 'cell':
                return held.value;
            case 'str':
                return charOf(held.text);
            case 'int':
                return { name: '', className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value: held.value, fields: null };
            default:
                return null;
        }
    }
    return rule.defaults.get(saved) ?? null;
}
// How many references in the subsystem's value cells name each object, by id, counted once a
// subsystem: the holders of a nested object (a CoderInfo, a bus element).
const holderCounts = new WeakMap();
// How many triples of the subsystem name each value cell, as the codec's valueCellUsers counts them,
// counted once a subsystem: that walks every triple at each ask, which made reading the states of
// 1,500 objects quadratic.
const cellUserCounts = new WeakMap();
function cellUsers(records, cell) {
    let counts = cellUserCounts.get(records);
    if (!counts) {
        counts = new Map();
        const b = records.blob;
        for (const list of [...b.ctorLists, ...b.pvLists, ...(b.fileHeader?.perArray ?? []).map((e) => e.triples)]) {
            for (const t of list) {
                if (t.flag === McosValueKind.cell) {
                    counts.set(t.value, (counts.get(t.value) ?? 0) + 1);
                }
            }
        }
        cellUserCounts.set(records, counts);
    }
    return counts.get(cell) ?? 0;
}
/** Why the object `id` is named by more than one reference of the subsystem, or undefined. */
function sharedBy(records, id) {
    let counts = holderCounts.get(records);
    if (!counts) {
        counts = new Map();
        for (const cell of records.values) {
            for (const k of readDescriptor(cell)?.ids ?? []) {
                counts.set(k, (counts.get(k) ?? 0) + 1);
            }
        }
        holderCounts.set(records, counts);
    }
    return (counts.get(id) ?? 0) > 1 ? 'another object holds' : undefined;
}
/**
 * The string the Value of Parameter `objectId` is, as MATLAB saves `p.Value = "abc"`: its Value
 * cell a reference to one `string` object of the file, a 1x1 one, whose payload holds its text; or
 * null for any other Value, and for one an edit could not write alone: a string another reference
 * names too, or whose cell or payload another triple names.
 */
function parameterStringValue(records, objectId) {
    const t = propertiesOf(records, objectId).find((p) => p.savedName === 'Value' && p.flag === McosValueKind.cell);
    const ids = t && records.values[t.value] ? readDescriptor(records.values[t.value])?.ids : undefined;
    if (!t || !ids || ids.length !== 1 || ids[0] < 1 || ids[0] >= records.blob.objects.length || sharedBy(records, ids[0]) || cellUsers(records, t.value) !== 1) {
        return null;
    }
    const held = stringObjectOf(records, ids[0]);
    if (!held || held.dims.length !== 2 || held.dims[0] !== 1 || held.dims[1] !== 1 || typeof held.texts[0] !== 'string' || cellUsers(records, held.valueIndex) !== 1) {
        return null;
    }
    return { objectId: ids[0], payload: held.valueIndex, cell: t.value, text: held.texts[0] };
}
// The text a char row holds (`''` of a 1x0 or 0x0), or null for any other value.
function textOfRow(v) {
    const d = v.dimensions ?? [];
    const text = typeof v.value === 'string' ? v.value : v.value === null || v.value === undefined ? '' : null;
    return v.className === 'char' && !v.isComplex && d.length === 2 && (d[0] === 1 || d[0] * d[1] === 0) && text !== null ? text : null;
}
// Text as a node's Value holds it for a save (a char row, `''` a 1x0), the variable it is compared with.
function textRowOf(text) {
    return { name: '', className: 'char', dimensions: [1, text.length], isComplex: false, isLogical: false, value: text, fields: null };
}
/** The bus element rows of a Bus's node, in order. */
function elementRows(node) {
    return node.children.filter((c) => classOf(c) === BUS_ELEMENT);
}
/**
 * What the object at `node` holds in `records`, read, and what its node offers and shows of it as
 * it stands; or why no edit of it can be written, as a clause naming it. Made once a node, the first
 * time the editor asks (MatNode._objectState).
 */
export function matObjectStateOf(records, node) {
    const path = node.matlabPath;
    const place = mcosPlaceOf(node);
    const objectId = place ? objectIdOf(place.variable.mcosHandle, place.index) : null;
    if (objectId === null || objectId >= records.blob.objects.length) {
        return path + " is not one of the file's objects this editor can find";
    }
    if (!measuredVersion(records)) {
        return path + "'s object is in a subsystem of blob version " + records.blob.major + '.' + records.blob.minor + ', which no edit was measured on against MATLAB';
    }
    let own;
    try {
        own = ruleObjectOf(records, objectId);
    }
    catch (e) {
        if (e instanceof MatWriteError) {
            return path + "'s object could not be read as a save writes it (" + e.message + ')';
        }
        throw e;
    }
    const cls = own.className;
    if (cls !== classOf(node)) {
        return path + ' is shown as ' + classPhrase(classOf(node)) + ", where the file's object is " + classPhrase(cls);
    }
    // A Parameter's Value MATLAB saved as a string, an object of the file its Value cell names: read
    // as the text, as its node holds it (a char row, as a save of this package writes text), by the
    // editor and by the rules, whose DataType a number set over it follows ('string' to 'auto').
    const valueString = cls === PARAMETER ? parameterStringValue(records, objectId) ?? undefined : undefined;
    if (valueString) {
        own = { ...own, held: new Map(own.held).set('Value', { kind: 'cell', value: textRowOf(valueString.text) }) };
    }
    const objects = new Map([['', { objectId, rule: own, path }]]);
    const spots = new Map();
    let payload;
    let heldRows;
    const add = (spot, holder, object) => {
        const row = propertyRowOf(object.rule.className, spot.property);
        const named = object.path + '.' + spot.property;
        const held = row ? referenceOf(object.rule, row.savedName) : null;
        // An Alignment as the number it is: an integer triple, a double cell or an int32 default alike;
        // a flag as 0 or 1, and a NumericType's shown Signedness, FractionLength and Slope of the three
        // it saves.
        const scalar = spot.property === 'Alignment' && held && typeof held.value === 'number' ? held.value : null;
        const editor = bagEditorFor(classOf(holder), spot.property);
        const reference = object.rule.className === NUMERIC_TYPE && ['Signedness', 'FractionLength', 'Slope'].includes(spot.property)
            ? numericTypeReference(object.rule, spot.property)
            : editor?.kind === 'flag'
                ? flagReference(held)
                : scalar !== null
                    ? doubleOf(scalar)
                    : object.rule.className === PARAMETER && !spot.nested && spot.property === 'DataType'
                        ? loadedDataTypeOf(object.rule, held) ?? held
                        : held;
        const v = spotValue(holder, spot.property);
        let exact = null;
        let asRead = null;
        if (object.shared) {
            exact = object.path + ' is one object of the file that ' + object.shared + ' as well, which an edit of it would change too';
        }
        else if (typeof v === 'string') {
            exact = named + ' ' + v;
        }
        else if (!reference) {
            exact = named + ' has no value in the file that reads, nor a default of its class there';
        }
        else {
            const difference = valueDifference(v, reference, named);
            if (difference) {
                // A string or another object a struct or a cell Value holds, which the file holds as a
                // reference to an object of its own (McosSubsystemEdit: a cell holding one takes no swap).
                const inside = objectInside(reference, named);
                exact = inside
                    ? named + ' holds an object of the file (' + inside + '), which a save does not write anew there, so it takes no edit'
                    : named + ' is not, as this editor reads it, the value the file holds (' + difference + '), so a save could not write it as it is';
                asRead = v;
            }
        }
        spots.set(spotKey(spot), { spot, holder, reference, exact, asRead });
    };
    for (const property of OWN_SPOTS[cls] ?? []) {
        add({ nested: null, property }, node, objects.get(''));
    }
    // A `string`, saved as one payload, its whole text: the one value an edit of it changes.
    if (cls === STRING) {
        const held = stringObjectOf(records, objectId);
        if (!held) {
            return path + "'s text is not held as the payload of a string this editor reads";
        }
        // A payload another string names too, which MATLAB never writes: an edit would be of both.
        if (cellUsers(records, held.valueIndex) !== 1) {
            return path + "'s text is held in a payload the file names for another string as well, which an edit would change too";
        }
        payload = held.valueIndex;
        const reference = { name: '', className: STRING, dimensions: held.dims, isComplex: false, isLogical: false, value: held.texts, fields: null };
        const v = spotValue(node, 'Value');
        const difference = typeof v === 'string' ? path + ' ' + v : valueDifference(v, reference, path);
        spots.set('Value', {
            spot: { nested: null, property: 'Value' },
            holder: node,
            reference,
            exact: difference && path + ' is not, as this editor reads it, the text the file holds (' + difference + '), so a save could not write it as it is',
            asRead: typeof v === 'string' || !difference ? null : v,
        });
    }
    for (const held of Object.values(HELD_COLUMNS)) {
        if (!held.classes.includes(cls)) {
            continue;
        }
        const key = held.saved + '(0)';
        let object = objects.get(key);
        if (!object) {
            // An MCOS object the property names (R2027a's CoderInfo), or the one a 'handle' opaque holds.
            const ids = heldObjectIds(records, objectId, held.saved);
            const cell = ids ? null : propertiesOf(records, objectId).find((t) => t.savedName === held.saved && t.flag === McosValueKind.cell);
            const handle = cell && isHandleOpaque(records.values[cell.value]) ? handleRuleObjectOf(records.values[cell.value]) : null;
            if (ids && ids.length === 1 && ids[0] > 0 && ids[0] < records.blob.objects.length) {
                object = { objectId: ids[0], rule: ruleObjectOf(records, ids[0]), path: path + '.' + held.saved, shared: sharedBy(records, ids[0]) };
            }
            else if (handle && typeof handle !== 'string') {
                object = { objectId, handleOf: held.saved, rule: handle, path: path + '.' + held.saved, shared: cellUsers(records, cell.value) !== 1 ? 'another triple names' : undefined };
            }
            else {
                continue;
            }
            objects.set(key, object);
        }
        add({ nested: { saved: held.saved, index: 0 }, property: held.property }, node, object);
    }
    if (cls === BUS) {
        const saved = 'Elements_internal';
        const ids = heldObjectIds(records, objectId, saved) ?? [];
        const rows = elementRows(node);
        const valid = ids.every((id) => id > 0 && id < records.blob.objects.length);
        const elements = valid ? ids.map((id) => ruleObjectOf(records, id)) : [];
        const nameSaved = propertyRowOf(BUS_ELEMENT, 'Name').savedName;
        // Each row the element of the file it shows: one row an element, in order, by name.
        const named = (e) => {
            const t = referenceOf(e, nameSaved);
            return t && typeof t.value === 'string' ? t.value : null;
        };
        if (valid && rows.length === ids.length && elements.every((e, i) => e.className === BUS_ELEMENT && named(e) === rows[i].name)) {
            ids.forEach((id, i) => {
                const object = { objectId: id, rule: elements[i], path: path + '.Elements(' + (i + 1) + ')', bus: { key: path, elements, index: i }, shared: sharedBy(records, id) };
                objects.set(saved + '(' + i + ')', object);
                for (const property of ELEMENT_SPOTS) {
                    add({ nested: { saved, index: i }, property }, rows[i], object);
                }
            });
            heldRows = rows;
        }
    }
    // As mcosObjectEdit's state, for what it shares with this path (its twins).
    const stored = new Map();
    const cellIndex = new Map();
    for (const p of propertiesOf(records, objectId)) {
        const held = own.held.get(p.savedName);
        stored.set(p.savedName, { refusal: p.flag === McosValueKind.cell ? null : 'not-a-cell', value: held?.kind === 'cell' ? held.value : null });
        if (p.flag === McosValueKind.cell) {
            cellIndex.set(p.savedName, p.value + 2);
        }
    }
    const exact = new Map();
    const asRead = new Map();
    for (const s of spots.values()) {
        if (!s.spot.nested) {
            exact.set(s.spot.property, s.exact);
            if (s.asRead) {
                asRead.set(s.spot.property, s.asRead);
            }
        }
    }
    const state = {
        objectId,
        held: { className: cls, stored },
        cellIndex,
        exact,
        asRead,
        late: !!node._objectEdited,
        fingerprint: '',
        dataType: String(node.DataType ?? ''),
        records,
        objects,
        spots,
        payload,
        valueString,
        elementRows: heldRows,
        valueAsRead: cls === PARAMETER && spots.get('Value')?.exact === null ? heldValueVariable(node) ?? undefined : undefined,
    };
    state.fingerprint = matFingerprintOf(node, state);
    return state;
}
// ---- The fingerprint -----------------------------------------------------------------------------
// The fields of a node that are where it stands, not what it holds, and those that follow a spot
// as the node shows it: a Parameter's Value node and DataType (ParameterNode._followValueShape).
const STRUCTURAL = new Set(['name', 'parent', 'children', 'metadata', 'serial', 'status']);
const FOLLOWING_FIELDS = { [PARAMETER]: ['Value', 'DataType'] };
const FOLLOWING_KEYS = { [PARAMETER]: ['Value', 'Dimensions', 'Complexity', 'DataType'] };
/**
 * What the node of an object, and each row of it a spot is read off, holds that a save does not
 * write, as text to compare: every field but its spots' and those following them, and its property
 * bag but the keys they are saved under (of a CoderInfo, those of its spots). Taken when the
 * state is made, and asked again at the save, which refuses a node whose other fields changed.
 */
export function matFingerprintOf(node, state) {
    const holders = new Map();
    const of = (holder) => {
        let h = holders.get(holder);
        if (!h) {
            h = { fields: new Set(), keys: new Set(), coder: new Set() };
            holders.set(holder, h);
        }
        return h;
    };
    of(node);
    for (const s of state.spots.values()) {
        const h = of(s.holder);
        if (s.spot.nested?.saved === 'CoderInfo') {
            h.coder.add(s.spot.property === 'Identifier' ? 'Alias' : s.spot.property);
            // And the Identifier it is shown as beside its Alias (mcosShown).
            if (s.spot.property === 'Identifier') {
                h.coder.add('Identifier');
            }
            continue;
        }
        const object = state.objects.get(s.spot.nested ? s.spot.nested.saved + '(' + s.spot.nested.index + ')' : '');
        const row = object ? propertyRowOf(object.rule.className, s.spot.property) : null;
        h.fields.add(s.spot.property);
        h.keys.add(s.spot.property);
        if (row) {
            h.keys.add(row.savedName);
        }
        const editor = bagEditorFor(classOf(s.holder), s.spot.property);
        if (editor?.bag) {
            h.keys.add(editor.bag);
        }
    }
    const cls = state.held.className;
    for (const f of FOLLOWING_FIELDS[cls] ?? [])
        of(node).fields.add(f);
    for (const k of FOLLOWING_KEYS[cls] ?? [])
        of(node).keys.add(k);
    const parts = [];
    for (const [holder, h] of holders) {
        const own = {};
        for (const key of Object.keys(holder)) {
            if (!key.startsWith('_') && !STRUCTURAL.has(key) && !h.fields.has(key)) {
                own[key] = holder[key];
            }
        }
        const bag = { ...holder.serial?._properties };
        for (const k of h.keys) {
            delete bag[k];
        }
        if (h.coder.size > 0 && bag.CoderInfo && typeof bag.CoderInfo === 'object') {
            const coder = JSON.parse(JSON.stringify(bag.CoderInfo, bigints));
            const inner = (coder._properties ?? coder);
            for (const k of h.coder) {
                delete inner[k];
            }
            bag.CoderInfo = coder;
        }
        parts.push([own, bag]);
    }
    try {
        return JSON.stringify(parts, bigints);
    }
    catch (e) {
        return 'not fingerprinted: ' + (e instanceof Error ? e.message : String(e));
    }
}
function bigints(_k, x) {
    return typeof x === 'bigint' ? x.toString() + 'n' : x;
}
// ---- A Bus's elements added and removed ---------------------------------------------------------
//
// A Bus's node takes an element row added (a new BusElement of MATLAB's defaults, McosTemplateMerge
// addBusElements) and any removed (removeBusElement), as MATLAB's `b.Elements(end+1) = e` and
// `b.Elements(k) = []` do. The rows a node holds are then the file's elements it kept, in their
// order, and those added after them: projected onto a copy of the records, where each row kept is
// the element it was, its spots as they were judged, and each added the element merged for it, its
// spots judged against MATLAB's default element, and its Name held to the rules as an edit.
/** The spot key of a Bus's elements added or removed, an edit of its node's own row ('Value', a row added or removed). */
export const BUS_ELEMENTS = 'Elements';
/** The name a Bus's elements are saved under, which an element added or removed writes. */
export const ELEMENTS_SAVED = 'Elements_internal';
// What a save writes of each row added the first time a projection saw it, as matFingerprintOf
// holds an object's node to what it held when its state was read.
const addedRowPrints = new WeakMap();
// Why the Elements of the Bus a state is of take no element added or removed, found once a state.
const elementsVerdicts = new WeakMap();
/**
 * The element rows of the Bus at `node` against those its state read (MatObjectState.elementRows):
 * null where they are those; else the file's it kept, by their index then, in order, and the rows
 * added after them; or why no save writes them so, as a clause.
 */
function busStructureOf(base, node) {
    const was = base.elementRows;
    if (!was) {
        return null;
    }
    const at = new Map(was.map((r, i) => [r, i]));
    const kept = [];
    const added = [];
    for (const row of elementRows(node)) {
        const i = at.get(row);
        if (i === undefined) {
            added.push(row);
            continue;
        }
        if (added.length > 0 || (kept.length > 0 && i <= kept[kept.length - 1])) {
            return node.matlabPath + "'s elements are not in the order a save writes them: the file's, as they were, then those added";
        }
        kept.push(i);
    }
    return added.length === 0 && kept.length === was.length ? null : { kept, added };
}
/**
 * Why no element row can be added to or removed from the Bus at `node`, as a clause, or null: it
 * is one object with another node, which would not show it; its rows were not the file's elements
 * one for one; its Elements are not a reference the merge rewrites (addBusElements); or its rows
 * now are in an order no save writes.
 */
function busStructureRefusal(state, node, sharing) {
    if (sharing) {
        return node.matlabPath + ' is one object with ' + sharing.with.matlabPath + ', which would not show an element added to or removed from it through ' + node.matlabPath;
    }
    const base = state.structure?.base ?? state;
    if (!base.elementRows) {
        return node.matlabPath + "'s element rows are not, one for one, the elements the file holds, so a save could not write one added or removed";
    }
    let verdict = elementsVerdicts.get(base);
    if (verdict === undefined) {
        verdict = null;
        try {
            addBusElements(cloneSubsystem(base.records), base.objectId, []);
        }
        catch (e) {
            if (!(e instanceof MatWriteError)) {
                throw e;
            }
            verdict = node.matlabPath + "'s elements are not held as a save adds one to or removes one from (" + e.message + ')';
        }
        elementsVerdicts.set(base, verdict);
    }
    const now = busStructureOf(base, node);
    return verdict ?? (typeof now === 'string' ? now : null);
}
// What matFingerprintOf holds of a row added, as the spots of one element.
function addedRowPrint(row, rule) {
    const spots = new Map(ELEMENT_SPOTS.map((property) => [property, { spot: { nested: { saved: ELEMENTS_SAVED, index: 0 }, property }, holder: row, reference: null, exact: null, asRead: null }]));
    const objects = new Map([[ELEMENTS_SAVED + '(0)', { objectId: 0, rule, path: '' }]]);
    return matFingerprintOf(row, { spots, objects, held: { className: BUS_ELEMENT, stored: new Map() } });
}
/**
 * The state of the Bus at `node` with its element rows as they stand (busStructureOf), `base` the
 * state read, its elements removed and added in `sub`, which this writes them into (a copy of the
 * records `base` was read from, or of a superset of them); `base` itself where its rows are as
 * read; or why they cannot be written, as a clause. The name an element added is given in `sub`
 * is its row's where none of the file's kept is called so, and its Name is held to the rules
 * whatever it is (no reference), so that the save writes the row's.
 */
export function projectedBusState(sub, base, node, session) {
    const now = busStructureOf(base, node);
    if (now === null) {
        return base;
    }
    if (typeof now === 'string') {
        return now;
    }
    const path = node.matlabPath;
    const was = (i) => base.objects.get(ELEMENTS_SAVED + '(' + i + ')');
    const nameSaved = propertyRowOf(BUS_ELEMENT, 'Name').savedName;
    let ids;
    try {
        for (let i = base.elementRows.length - 1; i >= 0; i--) {
            if (!now.kept.includes(i)) {
                removeBusElement(sub, base.objectId, i);
            }
        }
        const taken = new Set(now.kept.map((i) => textIn(referenceOf(was(i).rule, nameSaved), '')));
        const names = now.added.map((row) => {
            let name = row.name;
            for (let k = 1; !name || taken.has(name); k++) {
                name = 'a' + k;
            }
            taken.add(name);
            return name;
        });
        ids = now.added.length > 0 ? addBusElements(sub, base.objectId, names, { session }) : [];
    }
    catch (e) {
        if (e instanceof MatWriteError) {
            return path + "'s elements could not be written as its rows stand (" + e.message + ')';
        }
        throw e;
    }
    if (busElementsOf(sub, base.objectId).length !== now.kept.length + ids.length) {
        return path + "'s elements are not, once written, its rows";
    }
    const rows = elementRows(node);
    const elements = rows.map((_, i) => (i < now.kept.length ? was(now.kept[i]).rule : ruleObjectOf(sub, ids[i - now.kept.length])));
    const objects = new Map([...base.objects].filter(([k]) => !k.startsWith(ELEMENTS_SAVED + '(')));
    const spots = new Map([...base.spots].filter(([, st]) => st.spot.nested?.saved !== ELEMENTS_SAVED));
    rows.forEach((row, i) => {
        const key = ELEMENTS_SAVED + '(' + i + ')';
        const bus = { key: path, elements, index: i };
        const elementPath = path + '.Elements(' + (i + 1) + ')';
        if (i < now.kept.length) {
            const k = now.kept[i];
            objects.set(key, { ...was(k), path: elementPath, bus });
            for (const property of ELEMENT_SPOTS) {
                const st = base.spots.get(ELEMENTS_SAVED + '(' + k + ').' + property);
                if (st) {
                    spots.set(key + '.' + property, { ...st, spot: { nested: { saved: ELEMENTS_SAVED, index: i }, property } });
                }
            }
            return;
        }
        const object = { objectId: ids[i - now.kept.length], rule: elements[i], path: elementPath, bus };
        objects.set(key, object);
        for (const property of ELEMENT_SPOTS) {
            const v = spotValue(row, property);
            const saved = propertyRowOf(BUS_ELEMENT, property)?.savedName;
            spots.set(key + '.' + property, {
                spot: { nested: { saved: ELEMENTS_SAVED, index: i }, property },
                holder: row,
                reference: property === 'Name' || !saved ? null : referenceOf(object.rule, saved),
                exact: typeof v === 'string' ? elementPath + '.' + property + ' ' + v : null,
                asRead: null,
            });
        }
        if (!addedRowPrints.has(row)) {
            addedRowPrints.set(row, addedRowPrint(row, object.rule));
        }
    });
    return { ...base, records: sub, objects, spots, elementRows: rows, structure: { base, added: now.added } };
}
/**
 * Whether the node of an object holds nothing a save does not write that differs from what it held
 * when its state was read (matFingerprintOf), and each element row added to it since nothing that
 * differs from what it held when first written (projectedBusState).
 */
export function matFingerprintHolds(node, state) {
    const base = state.structure?.base ?? state;
    if (matFingerprintOf(node, base) !== base.fingerprint) {
        return false;
    }
    return (state.structure?.added ?? []).every((row) => {
        const object = [...state.objects.values()].find((o) => o.bus && elementRows(node)[o.bus.index] === row);
        return !!object && addedRowPrints.get(row) === addedRowPrint(row, object.rule);
    });
}
// ---- The gate ------------------------------------------------------------------------------------
// A property the Property Inspector shows of a data object's own row that is its CoderInfo's (the
// schema's Code Generation and Custom Attributes columns), but its StorageClass (HELD_COLUMNS).
const CODER_INFO_PROPERTIES = /^(?:CoderInfo|Alignment|Identifier|HeaderFile|DefinitionFile|Owner|PreserveDimensions|StructName|GetFunction|SetFunction|DataScope)$/;
function capitalized(key) {
    return key.charAt(0).toUpperCase() + key.slice(1);
}
function rootOf(node) {
    let n = node;
    while (n.parent && !n.parent.isContainer) {
        n = n.parent;
    }
    return n;
}
/**
 * The spot of the object at `object` an edit of `key` at `node` changes, by its key, or why it
 * changes none a save writes, as a clause. A key of the object's own row names the property (the
 * Property Inspector's lowerCamel keys, `complexity` as MATLAB's `Complexity`), or the property of
 * an object it holds that its column shows (`storageClass`, its CoderInfo's StorageClass); a key of
 * a bus element's row, that element's (its Name, for the row's own name); an edit at or under a
 * Simulink.Parameter's Value node, its Value (mcosObjectEdit.propertyAt's rule). `describe` false
 * answers REFUSED for a refusal, unworded, for an editor drawn.
 */
export function matPropertyAt(state, object, node, key, describe = true) {
    const refused = (why) => ({ why: describe ? why() : REFUSED });
    const cls = state.held.className;
    const spotted = (spot, path) => {
        const k = spotKey(spot);
        if (state.spots.has(k)) {
            return { key: k };
        }
        const named = path + '.' + spot.property;
        const owner = spot.nested ? (state.objects.get(spot.nested.saved + '(' + spot.nested.index + ')')?.rule.className ?? BUS_ELEMENT) : cls;
        if (!spot.nested && CODER_INFO_PROPERTIES.test(spot.property)) {
            return refused(() => named + ' belongs to its CoderInfo, an object of its own, of which a save writes only the StorageClass');
        }
        if (isCoWritten(owner, spot.property)) {
            return refused(() => named + ' follows its Value, and is written only with it');
        }
        return refused(() => named + (propertyRowOf(owner, spot.property) ? ' is not one this editor edits in ' : ' is not one this editor writes into ') + classPhrase(owner));
    };
    if (cls === STRING && key !== 'Name' && key !== 'name') {
        // A string's text, whole or an element of it, a row added or removed: its one value.
        if (key === 'Value' || key === 'Add') {
            return { key: 'Value' };
        }
        return refused(() => node.matlabPath + "'s " + key + ' is not part of the text of ' + object.matlabPath + ', which is all of it a save writes');
    }
    if (node === object) {
        if (key === 'Name' || key === 'name') {
            return refused(() => object.matlabPath + ' is named by where it stands in ' + rootOf(object).name + ', which a save writes as it was read');
        }
        if (key === 'Add') {
            return refused(() => object.matlabPath + ' takes no row added: a save writes its properties, and none of them is one');
        }
        // A Bus's element row added or removed (the structural gates ask 'Value'): its Elements.
        if (cls === BUS && key === 'Value') {
            return { key: BUS_ELEMENTS };
        }
        const held = heldColumnOf(cls, key);
        if (held) {
            return spotted({ nested: { saved: held.saved, index: 0 }, property: held.property }, object.matlabPath);
        }
        return spotted({ nested: null, property: capitalized(key) }, object.matlabPath);
    }
    if (cls === BUS && node.parent === object && classOf(node) === BUS_ELEMENT) {
        const index = elementRows(object).indexOf(node);
        const property = key === 'name' ? 'Name' : capitalized(key);
        if (key === 'Add') {
            return refused(() => node.matlabPath + ' takes no row added: a save writes its properties, and none of them is one');
        }
        return spotted({ nested: { saved: 'Elements_internal', index }, property }, object.matlabPath + '.Elements(' + (index + 1) + ')');
    }
    const valueNode = object._valueNode;
    for (let n = node; n && n !== object; n = n.parent) {
        if (n === valueNode && cls === PARAMETER) {
            if (key !== 'Value' && key !== 'Add' && key !== 'Name' && key !== 'name') {
                return refused(() => node.matlabPath + "'s " + key + ' is not part of the value of ' + object.matlabPath + '.Value, which is all of it a save writes');
            }
            if ((key === 'Name' || key === 'name') && !(node.parent instanceof StructNode)) {
                return refused(() => node.matlabPath + ' is named by where it stands in ' + object.matlabPath + '.Value');
            }
            return { key: 'Value' };
        }
    }
    return refused(() => node.matlabPath + ' is part of ' + object.matlabPath + ', of which a save writes only the properties it takes');
}
/** Why no edit of the object at `node` is taken at all, its class being one with no rules, as a clause, or null. */
export function matClassRefusal(state, node) {
    const cls = state.held.className;
    return hasPropertyRules(cls) || cls === STRING ? null : node.matlabPath + ' is ' + classPhrase(cls) + ', whose properties this editor does not write into a MAT-file';
}
/**
 * Why an edit of the spot `key` of the object at `node` is refused whatever its value, as a clause,
 * or null where its value decides: its value as the node held it did not read back as the file's
 * (MatSpotState.exact); the node holds none a save writes; the object is shared with another node,
 * which would not show the edit. Of a Bus's Elements (BUS_ELEMENTS), why no element row is added
 * or removed (busStructureRefusal).
 */
export function matSpotRefusal(state, node, key, sharing) {
    if (key === BUS_ELEMENTS) {
        return busStructureRefusal(state, node, sharing);
    }
    const s = state.spots.get(key);
    const cls = state.held.className;
    if (sharing) {
        const mirrored = !s.spot.nested && (MIRRORED[cls] ?? []).includes(s.spot.property);
        if (sharing.kind === 'value' || !mirrored) {
            const object = state.objects.get(s.spot.nested ? s.spot.nested.saved + '(' + s.spot.nested.index + ')' : '');
            return node.matlabPath + ' is one object with ' + sharing.with.matlabPath + ', which would not show an edit of '
                + object.path + '.' + s.spot.property + ' made through ' + node.matlabPath;
        }
    }
    if (s.exact) {
        return s.exact;
    }
    // A CoderInfo's Identifier and Alignment, which MATLAB takes only under a storage class other than
    // 'Auto' (it refuses the one there, and resets the other with a warning).
    if (s.spot.nested?.saved === 'CoderInfo' && (s.spot.property === 'Identifier' || s.spot.property === 'Alignment')) {
        const sc = spotValue(node, 'StorageClass');
        if (typeof sc !== 'string' && sc.value === 'Auto') {
            return node.matlabPath + '.CoderInfo.' + s.spot.property + " is set only under a StorageClass other than 'Auto', which MATLAB refuses it under";
        }
    }
    // A NumericType's property its mode keeps as the mode's setter left it (numericTypeGate).
    if (cls === NUMERIC_TYPE && !s.spot.nested) {
        const mode = spotValue(node, 'DataTypeMode');
        const gate = typeof mode === 'string' ? null : numericTypeGate(textIn(mode, ''), s.spot.property);
        if (gate) {
            return node.matlabPath + '.' + s.spot.property + ' ' + gate;
        }
    }
    // A Parameter's DataType over a Value that is not double is its Value's class, and nothing else:
    // set to another, MATLAB converts the Value to double, with a warning on every load.
    if (cls === PARAMETER && !s.spot.nested && s.spot.property === 'DataType') {
        const v = valueUnchanged(state, node) ? state.spots.get('Value').reference : spotValue(node, 'Value');
        const value = valueClassOf(v);
        if (value === null) {
            return node.matlabPath + '.DataType follows its Value, which ' + v;
        }
        if (value !== 'double') {
            return node.matlabPath + '.DataType follows its Value, of class ' + value + ': set to another, MATLAB converts the Value to double, with a warning on every load';
        }
    }
    const now = s.spot.property === 'Value' && valueUnchanged(state, node) ? s.reference : spotValue(s.holder, s.spot.property);
    // A Value of a class the rules write none of, an edit of an element leaves of that class (a
    // sparse one, say).
    if (cls === PARAMETER && !s.spot.nested && s.spot.property === 'Value' && typeof now !== 'string') {
        const what = parameterValueRefusal(now, false);
        if (what) {
            return node.matlabPath + '.Value is ' + what + ', which this editor does not write into ' + classPhrase(cls);
        }
    }
    return typeof now === 'string' ? state.objects.get(s.spot.nested ? s.spot.nested.saved + '(' + s.spot.nested.index + ')' : '').path + '.' + s.spot.property + ' ' + now : null;
}
/**
 * matSpotRefusal of each object's node and spot, found once and kept until an edit at or under the
 * node (forget), as mcosObjectEdit.McosPropertyVerdicts keeps its own.
 */
export class MatSpotVerdicts {
    constructor() {
        this._byNode = new WeakMap();
    }
    of(state, node, key, sharing) {
        let held = this._byNode.get(node);
        if (!held) {
            held = new Map();
            this._byNode.set(node, held);
        }
        let verdict = held.get(key);
        if (verdict === undefined) {
            verdict = matSpotRefusal(state, node, key, sharing);
            held.set(key, verdict);
        }
        return verdict;
    }
    /** An edit at `edited`: what was found of every node at or above it is forgotten. */
    forget(edited) {
        for (let n = edited; n; n = n.parent) {
            this._byNode.delete(n);
        }
    }
}
// ---- The edits -----------------------------------------------------------------------------------
function nestedKeyOf(spot) {
    return spot.nested ? spot.nested.saved + '(' + spot.nested.index + ')' : '';
}
/**
 * Every edit of the object at `node`: each spot whose value is not the file's, with `pending`, an
 * edit about to be made (a spot's key and the value it would hold), in place of what the node
 * holds of it; as the rules' targets, one per object the edits are of; or why one cannot be
 * written, as a clause. A spot the node holds no value of a save writes is not one the editor
 * offered, and is taken as it was read; one whose value as read was not the file's is an edit only
 * where the node holds another value than it did then.
 *
 * A Simulink.Parameter's DataType goes with its Value: the node shows the DataType MATLAB's own
 * `p.Value = v` leaves (matShownDataType), so where its Value is edited its DataType is written as
 * the node holds it, the file's included, and the rules hold the two to each other.
 */
export function matObjectEditsOf(state, node, pending, more) {
    const per = new Map();
    const cls = state.held.className;
    const valueAt = (k, s) => more?.get(k) ?? (pending?.key === k ? pending.value : spotValue(s.holder, s.spot.property));
    // A NumericType whose DataTypeMode changes: what its new mode gates is written after it whatever
    // it holds, as the node holds it, since the mode's own setter changes it (numericTypeOrder).
    const modeSpot = cls === NUMERIC_TYPE ? state.spots.get('DataTypeMode') : undefined;
    const modeNow = modeSpot ? valueAt('DataTypeMode', modeSpot) : undefined;
    const modeChanged = !!modeSpot?.reference && !!modeNow && typeof modeNow !== 'string' && !!valueDifference(modeNow, modeSpot.reference, 'DataTypeMode');
    const gated = modeChanged ? numericTypeGated(textIn(modeNow, '')) : [];
    for (const [k, s] of state.spots) {
        // A Parameter's DataType goes with its Value: below.
        if (cls === PARAMETER && k === 'DataType') {
            continue;
        }
        const object = state.objects.get(nestedKeyOf(s.spot));
        const named = object.path + '.' + s.spot.property;
        // A Parameter's Value no edit has changed since it read back as the file's: no edit of it.
        if (k === 'Value' && cls === PARAMETER && pending?.key !== k && valueUnchanged(state, node)) {
            continue;
        }
        const v = valueAt(k, s);
        if (typeof v === 'string') {
            if (s.asRead || s.exact === null) {
                return { why: named + ' ' + v };
            }
            continue;
        }
        if (s.reference && !valueDifference(v, s.reference, named) && !gated.includes(k)) {
            continue;
        }
        // A NumericType's Slope, in a mode but slope and bias, is its FractionLength's: not written.
        if (cls === NUMERIC_TYPE && k === 'Slope' && textIn((modeNow ?? modeSpot?.reference), '') !== SLOPE_BIAS_SCALING) {
            continue;
        }
        if (s.exact !== null) {
            if (!state.late && s.asRead && !valueDifference(v, s.asRead, named)) {
                continue;
            }
            return { why: s.exact };
        }
        const nk = nestedKeyOf(s.spot);
        per.set(nk, [...(per.get(nk) ?? []), { property: s.spot.property, value: v }]);
    }
    // A Parameter's DataType as its node shows it after the edits (matShownDataType, and the follow a
    // pending edit of the Value is about to make), where it is not the DataType the rules derive for
    // the Value from the file's (none edited: the file's own): the one the node holds, written as it is.
    const dtSpot = cls === PARAMETER ? state.spots.get('DataType') : undefined;
    if (dtSpot) {
        const v = pending?.key === 'DataType' ? pending.value : spotValue(node, 'DataType');
        if (typeof v === 'string') {
            if (dtSpot.exact === null) {
                return { why: node.matlabPath + '.DataType ' + v };
            }
        }
        else if (dtSpot.exact !== null && (state.late || !dtSpot.asRead || valueDifference(v, dtSpot.asRead, 'DataType'))) {
            return { why: dtSpot.exact };
        }
        else if (dtSpot.exact === null) {
            const value = per.get('')?.find((e) => e.property === 'Value')?.value;
            const fileDt = textIn(dtSpot.reference, 'auto');
            let dt = textIn(v, '');
            let derived = fileDt;
            // The one a pending edit of the Value follows to, one typing the file's Value back included.
            if (pending?.key === 'Value') {
                dt = dataTypeShownFor(state, node, valueClassOf(pending.value) ?? 'double');
            }
            if (value) {
                derived = parameterDataTypeAfter(valueClassOf(state.spots.get('Value').reference) ?? 'double', valueClassOf(value) ?? 'double', fileDt);
            }
            if (dt !== derived) {
                per.set('', [...(per.get('') ?? []), { property: 'DataType', value: charOf(dt) }]);
            }
        }
    }
    if (cls === NUMERIC_TYPE && per.has('')) {
        per.set('', numericTypeOrder(per.get('')));
    }
    // A string's text, which no setter takes: its payload, replaced whole.
    const strings = [];
    const text = cls === STRING ? per.get('')?.find((e) => e.property === 'Value') : undefined;
    if (text) {
        strings.push({ objectId: state.objectId, valueIndex: state.payload, texts: text.value.value, dims: text.value.dimensions.slice() });
        per.delete('');
    }
    // A Parameter's Value MATLAB saved as a string, typed as text again: the string's payload, as
    // MATLAB's own save of `p.Value = "xyz"` writes it, its Value cell, Dimensions [1 1], Complexity
    // and DataType 'string' as they were (measured, R2027a and R2023b: the two saves differ in that
    // payload alone).
    const ownEdits = state.valueString ? per.get('') : undefined;
    const typed = ownEdits?.find((e) => e.property === 'Value');
    const typedText = typed ? textOfRow(typed.value) : null;
    if (typedText !== null) {
        strings.push({ objectId: state.valueString.objectId, valueIndex: state.valueString.payload, texts: [typedText], dims: [1, 1] });
        const rest = ownEdits.filter((e) => e !== typed);
        if (rest.length > 0) {
            per.set('', rest);
        }
        else {
            per.delete('');
        }
    }
    const targets = [];
    for (const [nk, edits] of per) {
        const object = state.objects.get(nk);
        // A Parameter's Complexity and Dimensions as its node shows them, which an empty Value keeps (McosRuleTarget.kept).
        const kept = cls === PARAMETER && nk === '' ? shapeShown(node) : undefined;
        targets.push({ key: object.path, object: object.rule, edits, ...(object.bus ? { bus: object.bus } : {}), ...(kept ? { kept } : {}) });
    }
    return { targets, strings };
}
/**
 * Why the edits of the object at `node`, with `pending` in place of what the node holds of its
 * spot, are refused by the rules, as a clause, or null where a save writes them.
 */
export function matEditsRefusal(state, node, pending, more) {
    const found = matObjectEditsOf(state, node, pending, more);
    if ('why' in found) {
        return found.why;
    }
    for (const { texts, dims } of found.strings) {
        if (texts.length !== dims.reduce((a, b) => a * b, 1)) {
            return node.matlabPath + ' would hold ' + texts.length + ' texts in a ' + dims.join('x') + ' string';
        }
    }
    const plan = planPropertyEdits(found.targets);
    return plan.ok ? null : plan.message;
}
// The variable a Parameter node's Value node holds as read, while no edit has changed it: the same
// object at every ask (MatlabVariableNode._var); null for a Value held bare, or edited.
function heldValueVariable(node) {
    const v = node._valueNode;
    return v && v._matVar && !v._varStale ? v._matVar : null;
}
// Whether the Value of the Parameter at `node` is still the one its state was read with.
function valueUnchanged(state, node) {
    return state.valueAsRead !== undefined && heldValueVariable(node) === state.valueAsRead;
}
function valueClassOf(v) {
    return v && typeof v !== 'string' ? (v.isLogical ? 'logical' : v.className) : null;
}
// The DataType MATLAB's load gives a Parameter that saved `saved` (none: 'auto', its class default)
// beside its Value, where it is 'auto' and the Value of another class than double: the one the load
// derives of it, as its node shows it (mcosShown.withParameterValueShown); null where it is the file's.
function loadedDataTypeOf(rule, saved) {
    if (textIn(saved, 'auto') !== 'auto') {
        return null;
    }
    const cls = valueClassOf(referenceOf(rule, 'Value'));
    const derived = cls ? parameterDataTypeAfter('double', cls, 'auto') : 'auto';
    return derived === 'auto' ? null : charOf(derived);
}
// The text of a char reference, or `otherwise`.
function textIn(v, otherwise) {
    return v && typeof v.value === 'string' ? v.value : otherwise;
}
/**
 * The DataType the Simulink.Parameter at `node` shows once its Value is of class `now`: what
 * MATLAB's own `p.Value = v` makes of the DataType (McosPropertyRules.parameterDataTypeAfter: an
 * int16 v makes it 'int16', a double v over an int16 Value 'auto', over a double the DataType it
 * held), one edit at a time: of the Value class the node last followed (the file's, until it has)
 * and the DataType it shows, which an edit sets only over a double Value (matSpotRefusal). Derived
 * from the file's, "abc" and then 7 typed over a single Parameter's 5 showed and saved 'single',
 * where MATLAB's is 'auto'.
 */
function dataTypeShownFor(state, node, now) {
    const { before, shown } = dataTypeFollowedFrom(node, state.dataType);
    return parameterDataTypeAfter(before ?? valueClassOf(state.spots.get('Value')?.reference) ?? 'double', now, shown);
}
/**
 * The DataType the Simulink.Parameter at `node` holds after an edit of its Value, as its node is to
 * show it (ParameterNode._followSourceDataType, which asks after each change of its Value, an undo
 * and a redo included): dataTypeShownFor its Value's class now. Null for another class, or a Value
 * the node holds none of a save writes.
 */
export function matShownDataType(state, node) {
    if (state.held.className !== PARAMETER) {
        return null;
    }
    const now = valueClassOf(spotValue(node, 'Value'));
    if (now === null) {
        return null;
    }
    return dataTypeShownFor(state, node, now);
}
// ---- A NumericType ---------------------------------------------------------------------------------
//
// MATLAB's setters of a Simulink.NumericType are gated by its DataTypeMode, and the mode's own
// setter changes what it gates (McosPropertyRules.numericType): a Double's WordLength is 64, a
// fixed-point mode set from a floating one starts at 16 bits, signed. So an edit of one is judged,
// and its node shown, as MATLAB's setter takes it from what the node holds then
// (matNumericTypeAfter); and the save writes the mode first, then what it gates as the node holds
// it, which lands every value MATLAB's own sequence of setters could have left.
const SLOPE_BIAS_SCALING = 'Fixed-point: slope and bias scaling';
// Why a NumericType in mode `mode` takes no edit of `property`, as a clause, or null: MATLAB keeps
// a floating type's WordLength, Signedness and scaling, an unscaled one's scaling, and a binary
// point one's Bias as its mode's setter left them, refusing or warning at any other value.
export function numericTypeGate(mode, property) {
    const floating = ['Double', 'Single', 'Half', 'Boolean'].includes(mode);
    if (floating && ['WordLength', 'Signedness', 'FractionLength', 'Slope', 'Bias'].includes(property)) {
        return 'is set only in a fixed-point mode: MATLAB keeps a ' + mode + " type's as it is";
    }
    if (mode === 'Fixed-point: unspecified scaling' && ['FractionLength', 'Slope', 'Bias'].includes(property)) {
        return 'is set only in a scaled fixed-point mode: MATLAB keeps an unscaled type\'s as it is';
    }
    if (mode === 'Fixed-point: unspecified scaling' && property === 'IsAlias') {
        return 'is false in an unscaled type, which MATLAB takes as no alias';
    }
    if (mode === 'Fixed-point: binary point scaling' && property === 'Bias') {
        return 'is set only in slope and bias scaling: MATLAB keeps a binary point type\'s 0';
    }
    return null;
}
// What a NumericType's mode `mode` gates, written after it whatever it holds where it changes: its
// Slope in slope and bias scaling only (in binary point scaling its FractionLength says it).
function numericTypeGated(mode) {
    return ['WordLength', 'Signedness', 'FractionLength', ...(mode === SLOPE_BIAS_SCALING ? ['Slope'] : []), 'Bias'];
}
// A NumericType's edits in the order MATLAB's setters take them: IsAlias cleared before the mode
// (an unscaled type is no alias), the mode, then what it gates, then the rest; IsAlias set last.
function numericTypeOrder(edits) {
    const order = ['DataTypeMode', 'WordLength', 'Signedness', 'FractionLength', 'Slope', 'Bias', 'DataTypeOverride', 'IsAlias', 'DataScope', 'HeaderFile', 'Description'];
    const at = (e) => (e.property === 'IsAlias' && flagReference(e.value)?.value === 0 ? -1 : order.indexOf(e.property));
    return edits.slice().sort((a, b) => at(a) - at(b));
}
// The saved names a NumericType's shown properties are held under, and how.
const NUMERIC_TYPE_SAVED = ['DataTypeMode', 'SignednessBool', 'WordLength', 'FixedExponent', 'SlopeAdjustmentFactor', 'Bias', 'DataTypeOverride', 'IsAlias', 'DataScope', 'HeaderFile'];
function logicalOf(b) {
    return b === null
        ? { name: '', className: 'logical', dimensions: [0, 0], isComplex: false, isLogical: true, value: [], fields: null }
        : { name: '', className: 'logical', dimensions: [1, 1], isComplex: false, isLogical: true, value: b ? 1 : 0, fields: null };
}
/**
 * The NumericType at `node` as MATLAB's setter of `property` leaves it given `value`, from what its
 * node holds now (not the file: an earlier edit's mode gates this one): its bag's shown values, by
 * key, to show; or why MATLAB's setter refuses it (McosPropertyRules.planPropertyEdits, on an object
 * holding what the node does).
 */
export function matNumericTypeAfter(state, node, property, value) {
    const rule = state.objects.get('').rule;
    const bag = (node.serial?._properties ?? {});
    const num = (k) => (typeof bagValueOf(node, k) === 'number' ? bagValueOf(node, k) : null);
    const fe = num('FractionLength') === null ? null : -num('FractionLength') + 0;
    const slope = num('Slope');
    const signed = bag.Signed === 'Signed' ? true : bag.Signed === 'Unsigned' ? false : bag.Signed === 'Auto' ? null : undefined;
    const now = {
        DataTypeMode: typeof bag.DataTypeMode === 'string' ? bag.DataTypeMode : undefined,
        SignednessBool: signed === undefined ? undefined : logicalOf(signed),
        WordLength: num('WordLength') ?? undefined,
        FixedExponent: fe ?? undefined,
        SlopeAdjustmentFactor: fe !== null && slope !== null ? slope / 2 ** fe : undefined,
        Bias: num('Bias') ?? undefined,
        DataTypeOverride: typeof bag.DataTypeOverride === 'string' ? bag.DataTypeOverride : undefined,
        IsAlias: flagOf(bag.IsAlias) === null ? undefined : logicalOf(flagOf(bag.IsAlias)),
        DataScope: typeof bag.DataScope === 'string' ? bag.DataScope : undefined,
        HeaderFile: typeof bag.HeaderFile === 'string' ? bag.HeaderFile : undefined,
    };
    const held = new Map(rule.held);
    for (const saved of NUMERIC_TYPE_SAVED) {
        const was = rule.held.get(saved);
        const v = now[saved];
        if (!was || v === undefined) {
            return { why: node.matlabPath + "'s " + saved + ' is not held as this editor reads one' };
        }
        if (was.kind === 'str') {
            held.set(saved, { kind: 'str', text: typeof v === 'string' ? v : String(v) });
        }
        else if (was.kind === 'int') {
            held.set(saved, { kind: 'int', value: typeof v === 'number' ? v : Number(v.value) });
        }
        else {
            held.set(saved, { kind: 'cell', value: typeof v === 'number' ? doubleOf(v) : typeof v === 'string' ? charOf(v) : v });
        }
    }
    const object = { ...rule, held };
    const plan = planPropertyEdits([{ key: node.matlabPath, object, edits: [{ property, value }] }]);
    if (!plan.ok) {
        return { why: plan.message };
    }
    const after = new Map(held);
    for (const op of plan.objects[0]?.ops ?? []) {
        if (op.op === 'remove') {
            const d = rule.defaults.get(op.savedName);
            if (d) {
                after.set(op.savedName, { kind: 'cell', value: d });
            }
        }
        else if (op.kind === 'str') {
            after.set(op.savedName, { kind: 'str', text: op.text });
        }
        else if (op.kind === 'int') {
            after.set(op.savedName, { kind: 'int', value: op.value });
        }
        else {
            after.set(op.savedName, { kind: 'cell', value: op.value });
        }
    }
    const text = (k) => {
        const h = after.get(k);
        return h?.kind === 'str' ? h.text : h?.kind === 'cell' && typeof h.value?.value === 'string' ? h.value.value : '';
    };
    const number = (k) => {
        const h = after.get(k);
        return h?.kind === 'int' ? h.value : h?.kind === 'cell' && typeof h.value?.value === 'number' ? h.value.value : NaN;
    };
    const sign = after.get('SignednessBool');
    const signValue = sign?.kind === 'cell' && sign.value ? (numelOfVariable(sign.value) === 0 ? [] : flagOf(sign.value.value)) : null;
    const shown = numericTypeShown({ SignednessBool: signValue, FixedExponent: number('FixedExponent'), SlopeAdjustmentFactor: number('SlopeAdjustmentFactor') });
    if (!shown) {
        return { why: node.matlabPath + "'s Signedness would not be one MATLAB shows" };
    }
    const alias = after.get('IsAlias');
    return {
        values: {
            DataTypeMode: text('DataTypeMode'),
            ...shown,
            WordLength: number('WordLength'),
            Bias: number('Bias'),
            DataTypeOverride: text('DataTypeOverride'),
            IsAlias: alias?.kind === 'cell' && alias.value ? flagOf(alias.value.value) === true : alias?.kind === 'int' ? alias.value === 1 : false,
            DataScope: text('DataScope'),
            HeaderFile: text('HeaderFile'),
        },
    };
}
/**
 * The subsystem element with every edit of the objects at `nodes` written into it (MatObjectsWritten);
 * or null where none of them holds an edit (each as it was read, or edited back). Throws
 * MatWriteError, naming the variable an object is in and why, for an object or an edit it cannot
 * write: one its editor would not have offered, one the rules refuse, two nodes of one object
 * edited to two values of one property, one a path the editor did not judge changed.
 *
 * `stateOf` is what the editor judged of each node (MatNode._objectState), `entryOf` the variable a
 * node is in, for the message, and `more` the save's other edits of the records (a `string`'s).
 */
export function matObjectSubsystemEdit(records, nodes, stateOf, entryOf, more) {
    const refuse = (node, why) => {
        throw new MatWriteError('Cannot write "' + entryOf(node) + '": ' + why + '. Nothing was written.');
    };
    // Each object's edits, merged over the nodes that are it, and the node each edit came from.
    // By object id, and an object a 'handle' opaque holds by its holder's and the property it is.
    const byObject = new Map();
    const strings = new Map();
    const valueStrings = new Map();
    for (const node of nodes) {
        const state = stateOf(node);
        if (typeof state === 'string') {
            refuse(node, state);
        }
        const s = state;
        if (s.valueString) {
            valueStrings.set(s.objectId, s.valueString);
        }
        const unruled = matClassRefusal(s, node);
        if (unruled) {
            refuse(node, unruled);
        }
        if (!matFingerprintHolds(node, s)) {
            refuse(node, node.matlabPath + ' holds an edit of a property a save does not write into ' + classPhrase(s.held.className));
        }
        const found = matObjectEditsOf(s, node);
        if ('why' in found) {
            refuse(node, found.why);
        }
        for (const edit of found.strings) {
            strings.set(edit.objectId, edit);
        }
        for (const target of found.targets) {
            const held = [...s.objects.values()].find((o) => o.path === target.key);
            const id = held.handleOf ? held.objectId + ':' + held.handleOf : String(held.objectId);
            const object = byObject.get(id) ?? { target, node, objectId: held.objectId, handleOf: held.handleOf, edits: new Map() };
            byObject.set(id, object);
            for (const { property, value } of target.edits) {
                const other = object.edits.get(property);
                if (other && valueDifference(value, other.value, target.key + '.' + property)) {
                    refuse(node, target.key + ' and ' + object.target.key + ' are one object, whose ' + property + ' they were edited to two values of');
                }
                object.edits.set(property, { value, node });
            }
        }
    }
    const targets = [...byObject.values()].map(({ target, edits }) => ({ ...target, edits: [...edits].map(([property, { value }]) => ({ property, value })) }));
    if (targets.every((t) => t.edits.length === 0) && strings.size === 0 && !more?.has) {
        return null;
    }
    const plan = planPropertyEdits(targets);
    if (!plan.ok) {
        const at = [...byObject.values()].find((o) => o.target.key === plan.key);
        return refuse(at?.edits.get(plan.property)?.node ?? at?.node ?? nodes[0], plan.message);
    }
    const byKey = new Map([...byObject.values()].map((o) => [o.target.key, o]));
    // A Parameter's Value MATLAB saved as a string, set to a value of another class: its Value cell,
    // which named the string, swapped for the value's, and the string's object left in the file,
    // named by nothing, as the codec leaves a cell or an object no edit names any more (its APPEND
    // ONLY). MATLAB's own save drops the object and renumbers the ones after it; this one loads as it
    // (measured, R2027a and R2023b).
    const unstrung = [];
    const objects = plan.objects
        .map((o) => {
        const objectId = byKey.get(o.key).objectId;
        const handleOf = byKey.get(o.key).handleOf;
        const value = !handleOf && valueStrings.has(objectId) ? o.ops.find((op) => op.op === 'set' && op.kind === 'cell' && op.savedName === 'Value') : undefined;
        if (value && value.op === 'set' && value.kind === 'cell') {
            unstrung.push({ objectId, value: value.value });
        }
        return { objectId, ops: value ? o.ops.filter((op) => op !== value) : o.ops, ...(handleOf ? { handleOf } : {}) };
    })
        .filter((o) => o.ops.length > 0);
    if (objects.length === 0 && strings.size === 0 && unstrung.length === 0 && !more?.has) {
        return null;
    }
    // What this package could not write, said of the edits it was asked for, the detail after.
    const edited = targets.flatMap((t) => t.edits.map((e) => t.key + '.' + e.property));
    const unwritten = (why) => refuse(nodes[0], 'this package could not write ' + (edited.length > 0 ? 'the edit of ' + edited.join(', ') : 'the edit') + " into the file's objects so that MATLAB reads it back as made (" + why + ')');
    // Each string's payload replaced by its new text, written as MATLAB writes one (the codec's).
    let payloads = [];
    try {
        payloads = [...strings.values()].map((e) => ({ ...e, cell: stringPayloadCell(e.texts, e.dims) }));
    }
    catch (e) {
        if (e instanceof MatWriteError) {
            return unwritten(e.message);
        }
        throw e;
    }
    // A string's payload is the one argument its object is saved with ('any'); and the Value cells
    // swapped above, written beside the rules' ops.
    const payloadObjects = [
        ...payloads.map((p) => ({ objectId: p.objectId, properties: ['any'] })),
        ...unstrung.map((u) => ({ objectId: u.objectId, properties: ['Value'] })),
    ];
    const written = writeObjectEdits(records, objects, (sub) => {
        for (const { valueIndex, cell } of payloads) {
            replaceValueCell(sub, valueIndex, cell);
        }
        for (const { objectId, value } of unstrung) {
            replaceValueCell(sub, valueStrings.get(objectId).cell, valueCellOf(value), { objectReference: true });
        }
        more?.edit(sub);
    }, payloadObjects, 
    // The save verifies the element as it lands (MatFileWriter.selfCheck), against the file's records.
    false);
    if (!written.ok) {
        return unwritten(written.message);
    }
    const cells = [
        ...payloads.map((e) => ({ objectId: e.objectId, cellIndex: e.valueIndex + 2, savedName: 'any', value: elementValue(e.cell) })),
        ...unstrung.map((u) => ({ objectId: u.objectId, cellIndex: valueStrings.get(u.objectId).cell + 2, savedName: 'Value', value: u.value })),
    ];
    let swapOnly = !more?.has && payloads.length === 0 && unstrung.length === 0;
    for (const { objectId, ops, handleOf } of objects) {
        // A 'handle' opaque's edits are of its own small blob: its holder's cell swapped whole.
        if (handleOf) {
            swapOnly = false;
            continue;
        }
        const before = propertiesOf(records, objectId);
        const after = propertiesOf(written.records, objectId);
        for (const op of ops) {
            const was = before.find((t) => t.savedName === op.savedName);
            swapOnly &&= op.op === 'set' && op.kind === 'cell' && !!was && was.flag === McosValueKind.cell;
            if (op.op === 'set' && op.kind === 'cell') {
                const t = after.find((x) => x.savedName === op.savedName);
                cells.push({ objectId, cellIndex: t.value + 2, savedName: op.savedName, value: op.value });
            }
        }
    }
    return { element: written.element, records: written.records, cells, swapOnly, edited: editedObjects(objects, payloadObjects) };
}
//# sourceMappingURL=matObjectEdit.js.map