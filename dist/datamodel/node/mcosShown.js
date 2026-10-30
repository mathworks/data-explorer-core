// Copyright 2026 The MathWorks, Inc.
// Properties of an object as MATLAB shows them that it saves under other names or in another form,
// which a node read from a file's objects is given beside the saved ones in its property bag, for
// its Property Inspector to read (mcosTypedNode), and a dictionary's rows read of the saved ones
// alone (schemaBridge, shownPropertiesOf), one rule for both: a Simulink.NumericType's Signedness,
// FractionLength and Slope, of the SignednessBool, FixedExponent and SlopeAdjustmentFactor it saves
// (Slope = SlopeAdjustmentFactor * 2^FixedExponent; FractionLength = -FixedExponent; a 0x0
// SignednessBool is 'Auto'); a CoderInfo's Identifier, which it saves as Alias; and a
// Simulink.Parameter's Value held as a char row, which MATLAB loads as the string scalar it is.
import { emptyHeaderDims } from '../parser/XmlUtils.js';
import { parameterDataTypeAfter } from '../parser/McosPropertyRules.js';
import { isMatCdata } from '../parser/CdataCodec.js';
import { setOwn } from '../parser/ownKeys.js';
import { superclassOf } from './registeredSubclasses.js';
/**
 * The Signedness MATLAB shows of a saved SignednessBool: true, false, or none (a 0x0 logical), which
 * a MAT-file's object holds as `[]`, a text dictionary as the logical `[]` and a binary one as the
 * logical's bare `Matrix(0,0)` header (XmlUtils.emptyHeaderDims).
 */
export function signednessShown(saved) {
    if (saved === true || saved === 1) {
        return 'Signed';
    }
    if (saved === false || saved === 0) {
        return 'Unsigned';
    }
    if (Array.isArray(saved)) {
        return saved.length === 0 ? 'Auto' : null;
    }
    const leaf = saved !== null && typeof saved === 'object' ? saved : null;
    return leaf?._type === 'logical' && (leaf._value === '[]' || emptyHeaderDims(leaf._value) !== null) ? 'Auto' : null;
}
/**
 * The SignednessBool MATLAB saves of a Signedness, signednessShown's other way: true, false, or a
 * 0x0 logical for 'Signed', 'Unsigned', 'Auto'; undefined for anything else.
 */
function signednessSaved(shown) {
    switch (shown) {
        case 'Signed':
            return true;
        case 'Unsigned':
            return false;
        case 'Auto':
            return [];
        default:
            return undefined;
    }
}
/** The three shown of a NumericType's saved bag, or null where it holds them not as numbers. */
export function numericTypeShown(bag) {
    const fe = bag.FixedExponent;
    const saf = bag.SlopeAdjustmentFactor;
    const signed = signednessShown(bag.SignednessBool);
    if (typeof fe !== 'number' || typeof saf !== 'number' || signed === null) {
        return null;
    }
    return { Signed: signed, FractionLength: -fe + 0, Slope: saf * 2 ** fe };
}
/**
 * The saved three of a NumericType's bag that the shown three it also holds say otherwise, as what they
 * say: numericTypeShown's other way (SignednessBool true, false or a 0x0 logical for 'Signed',
 * 'Unsigned', 'Auto'; FixedExponent = -FractionLength; SlopeAdjustmentFactor = Slope * 2^FractionLength).
 * Only of a bag that holds both, which is a MAT-file's node's (withNumericTypeShown), whose edits write
 * the shown three while its save writes the saved: what a copy of it holds of them, so that the copy is
 * what the save writes. A dictionary's bag holds the saved three alone, or a hand-written shown pair.
 */
export function numericTypeSaved(bag) {
    const out = {};
    if (!numericTypeShown(bag)) {
        return out;
    }
    const signednessBool = signednessSaved(bag.Signed);
    if (signednessBool !== undefined && signednessShown(bag.SignednessBool) !== bag.Signed) {
        out.SignednessBool = signednessBool;
    }
    const fl = bag.FractionLength;
    const exponent = typeof fl === 'number' && Number.isFinite(fl) ? -fl + 0 : bag.FixedExponent;
    if (exponent !== bag.FixedExponent) {
        out.FixedExponent = exponent;
    }
    const slope = bag.Slope;
    if (typeof slope === 'number' && Number.isFinite(slope)) {
        const factor = slope / 2 ** exponent;
        if (factor !== bag.SlopeAdjustmentFactor) {
            out.SlopeAdjustmentFactor = factor;
        }
    }
    return out;
}
/** `bag`, a NumericType's as MCOS decoded it, with the shown three added where it holds the saved. */
export function withNumericTypeShown(bag) {
    const shown = numericTypeShown(bag);
    if (shown) {
        for (const [k, v] of Object.entries(shown)) {
            if (!(k in bag)) {
                bag[k] = v;
            }
        }
    }
    return bag;
}
/**
 * `bag`, a Simulink.Parameter's as MCOS decoded it, with a Value held as a char row (a string, as the
 * decode gives a char) as the string scalar MATLAB loads it as: measured against MATLAB R2027a, a
 * Parameter whose Value cell holds the char row 's' loads with Value "s", class string, as its setter
 * makes of any text. Such a cell is what a save of this package writes for a string Value typed in
 * (McosEditRules: "a char row, which MATLAB loads as a string scalar"), in a MAT-file and in a
 * binary dictionary's encoded value alike, and the file opened again showed the char 's'. An empty
 * char too, which MATLAB loads as the string "" (R2027a and R2023b: what a save of this package
 * writes for "" or '' typed in).
 *
 * Its Complexity is 'real' then, as MATLAB loads a Parameter whose Value is text whatever the file
 * holds (measured, R2027a and R2023b): 'complex' is what a save of this package wrote for text typed
 * over a complex Value, and the file opened again showed it beside the string.
 *
 * And a DataType saved as 'auto' (or not saved, its class default) beside a Value of another class
 * than double is the one MATLAB's load derives of the Value, as its setter does: 'string' of text,
 * the class of an integer or a single, 'boolean' of a logical (measured, R2027a: a binary
 * dictionary's stream holding the Parameter(5) of a cell, its Value typed as each, whose object
 * holds no DataType a save of this package could write, loads so). The file opened again showed
 * 'auto'. So too its Complexity, which such an object holds as an index into the file's text that
 * no cell swap writes: 'complex' beside a complex Value, and 'real' beside a real one that is not
 * empty, as MATLAB loads each (measured, R2027a and R2023b; an empty Value keeps the Complexity it
 * had, as MATLAB's setter keeps it).
 */
export function withParameterValueShown(bag) {
    let cls = valueClassOf(bag.Value);
    if (typeof bag.Value === 'string') {
        bag.Value = [bag.Value];
        cls = 'char';
        if (typeof bag.Complexity === 'string' && bag.Complexity !== 'real') {
            bag.Complexity = 'real';
        }
    }
    if (isComplexForm(bag.Value) && bag.Complexity !== 'complex') {
        bag.Complexity = 'complex';
    }
    else if (cls !== null && !isComplexForm(bag.Value) && !isEmptyForm(bag.Value) && bag.Complexity === 'complex') {
        bag.Complexity = 'real';
    }
    if (cls !== null && (bag.DataType === undefined || bag.DataType === 'auto')) {
        const derived = parameterDataTypeAfter('double', cls, 'auto');
        if (derived !== 'auto') {
            bag.DataType = derived;
        }
    }
    return bag;
}
// The class of a Parameter's Value as a decoded bag holds it, where it is a number or a logical:
// 'double' of a number or a row of them, 'logical' of a boolean, a numeric class's or a logical's of
// its typed form ({_type: 'int8', _value: ...}), and a complex one's of its parts (isComplexForm);
// null for anything else.
function valueClassOf(v) {
    if (typeof v === 'number' || (Array.isArray(v) && v.every((x) => typeof x === 'number'))) {
        return 'double';
    }
    if (typeof v === 'boolean') {
        return 'logical';
    }
    if (isComplexForm(v)) {
        const cls = v._class;
        return typeof cls === 'string' ? cls : 'double';
    }
    const type = v && typeof v === 'object' && !Array.isArray(v) ? v._type : undefined;
    return typeof type === 'string' && /^(u?int(8|16|32|64)|single|double|logical)$/.test(type) ? type : null;
}
// Whether a decoded bag holds `v`, a number or a logical, as an empty one: `[]`, or a header with a
// 0 extent (`Matrix(0,3)`).
function isEmptyForm(v) {
    if (Array.isArray(v)) {
        return v.length === 0;
    }
    const text = v && typeof v === 'object' && !Array.isArray(v) ? v._value : undefined;
    return typeof text === 'string' && (text.trim() === '[]' || /^Matrix\((?:\d+,)*0(?:,\d+)*\)/.test(text));
}
// Whether a decoded bag holds `v` as a complex number or array, `{_type: 'cdata', _value: '1+2i 3+0i'}`
// (MatlabValueParser.complexBag), not as the MAT stream a cdata also carries.
function isComplexForm(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v) && v._type === 'cdata' && typeof v._value === 'string' && !isMatCdata(v);
}
/**
 * What MATLAB R2027a holds of a Simulink.NumericType made with nothing set, in MATLAB's own
 * alphabetical key order: what a new one is (NumericTypeNode.createDefault), and what MATLAB reads
 * of a property a dictionary's NumericType does not hold (withDefaultsShown).
 */
export const NUMERIC_TYPE_DEFAULTS = Object.freeze({
    Bias: 0,
    DataScope: 'Auto',
    DataTypeMode: 'Double',
    DataTypeOverride: 'Inherit',
    Description: '',
    FixedExponent: 0,
    HeaderFile: '',
    IsAlias: false,
    SignednessBool: true,
    SlopeAdjustmentFactor: 1,
    WordLength: 64,
});
/**
 * `bag`, a `className` object's, with what MATLAB reads of each property it does not hold, for a
 * row to read: a NumericType's default (NUMERIC_TYPE_DEFAULTS), and the FixedExponent of a
 * FractionLength and the SignednessBool of a Signedness it states, as MATLAB's setter makes each.
 * A binary dictionary System Composer wrote holds its NumericType's DataTypeMode and IsAlias alone
 * (arch_binary.sldd), and its rows showed nothing for the rest; measured against MATLAB R2027a, it
 * reads as one with nothing set does, and a hand-written one stating Signedness, WordLength 16 and
 * FractionLength 3 (typeLink.sldd) as FixedExponent -3, Slope 0.125. No default is taken of what
 * the bag states otherwise: a FixedExponent or a SlopeAdjustmentFactor where it states a Slope.
 * Display only: a copy, `bag` itself never changed, and answered as it is where nothing is added;
 * for any other class, `bag`.
 */
export function withDefaultsShown(className, bag) {
    if (!bag || className !== 'Simulink.NumericType') {
        return bag;
    }
    const states = (k) => k in bag;
    let out = null;
    const fill = (k, v) => {
        out = out ?? { ...bag };
        out[k] = v;
    };
    for (const [k, v] of Object.entries(NUMERIC_TYPE_DEFAULTS)) {
        if (states(k)) {
            continue;
        }
        if (k === 'SignednessBool' && (states('Signedness') || states('Signed'))) {
            // Of the Signedness it states, as MATLAB's setter makes one.
            const signednessBool = signednessSaved(bag.Signedness ?? bag.Signed);
            if (signednessBool !== undefined) {
                fill(k, signednessBool);
            }
            continue;
        }
        if ((k === 'FixedExponent' || k === 'SlopeAdjustmentFactor') && states('Slope')) {
            continue;
        }
        if (k === 'FixedExponent' && typeof bag.FractionLength === 'number' && Number.isFinite(bag.FractionLength)) {
            fill(k, -bag.FractionLength + 0);
            continue;
        }
        fill(k, v);
    }
    return out ?? bag;
}
/**
 * The property bag of a `className` object as MATLAB shows it, for a row to read: what it saves under
 * other names shown as the property it is, of any file, a dictionary's as a MAT-file's. A
 * NumericType's Signedness, FractionLength and Slope (withNumericTypeShown), and a Parameter's or a
 * Signal's CoderInfo's Identifier, of the Alias it is saved as. A Signedness the file states, as a
 * hand-written dictionary does, is shown only where the bag holds no SignednessBool,
 * FixedExponent and SlopeAdjustmentFactor as numbers: where it holds them, the Signedness shown is
 * the SignednessBool's, whatever the stated one says. A MAT-file's object holds them (mcosTypedNode
 * adds them as it decodes one); a dictionary's holds what MATLAB saves alone, and its rows showed
 * nothing of them. Display only: `bag` itself is never changed, and is answered as it is where
 * nothing is to be added, so that what a writer writes of it stays the file's.
 */
export function shownPropertiesOf(className, bag) {
    if (!bag) {
        return bag;
    }
    if (className === 'Simulink.NumericType') {
        const shown = withNumericTypeShown({ ...bag });
        if (!('Signed' in shown) && typeof bag.Signedness === 'string') {
            shown.Signed = bag.Signedness;
        }
        return Object.keys(shown).length === Object.keys(bag).length ? bag : shown;
    }
    const coder = bag.CoderInfo;
    const inner = coderInfoShown(className) ? coderInfoBagOf(coder) : null;
    if (inner && typeof inner.Alias === 'string' && !('Identifier' in inner)) {
        const props = { ...inner, Identifier: inner.Alias };
        const elements = coder._elements;
        return { ...bag, CoderInfo: coder._properties ? { ...coder, _properties: props } : { ...coder, _elements: [{ ...(elements?.[0] ?? {}), _properties: props }] } };
    }
    return bag;
}
/**
 * `value`, handed to a dictionary (a paste: SectionNode.parseEntry), without what MATLAB shows of
 * each object in it that it saves under other names (shownPropertiesOf), where the object's bag
 * also holds the saved keys it is shown of and the two say the same: a NumericType's Signed,
 * FractionLength and Slope beside its SignednessBool, FixedExponent and SlopeAdjustmentFactor, a
 * Parameter's or a Signal's CoderInfo Identifier beside its Alias. A MAT-file's object holds both
 * (mcosTypedNode), and its copy carried both into the dictionary's file, `Signed` a key MATLAB has
 * no property of; MATLAB saves the saved ones alone, and a dictionary's rows show the rest of them
 * as the MAT-file's did. A shown key saying otherwise is no copy's, and is kept: what MATLAB would
 * load of the two is not measured. And, for a binary dictionary (`binary`), a CoderInfo in the
 * order MATLAB writes one there (savedOnly). A copy where anything changed, the same value where
 * nothing did.
 */
export function withoutShownOfSaved(value, binary = false) {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return mapKeepingSame(value, (e) => withoutShownOfSaved(e, binary));
    }
    const o = value;
    let out = null;
    const set = (k, v) => {
        if (v !== o[k]) {
            out = out ?? { ...o };
            setOwn(out, k, v);
        }
    };
    const objectClass = typeof o._object_class === 'string' ? o._object_class : null;
    if (objectClass && o._properties && typeof o._properties === 'object') {
        set('_properties', savedOnly(objectClass, o._properties, binary));
    }
    else if (typeof o._array_class === 'string' && Array.isArray(o._elements)) {
        const arrayClass = o._array_class;
        set('_elements', mapKeepingSame(o._elements, (e) => {
            const el = e;
            if (!el || typeof el !== 'object' || !el._properties || typeof el._properties !== 'object') {
                return withoutShownOfSaved(e, binary);
            }
            const props = savedOnly(typeof el._object_class === 'string' ? el._object_class : arrayClass, el._properties, binary);
            return props === el._properties ? el : { ...el, _properties: props };
        }));
    }
    for (const [k, v] of Object.entries(o)) {
        if (k !== '_properties' && k !== '_elements') {
            set(k, withoutShownOfSaved(v, binary));
        }
    }
    return out ?? o;
}
// `items`, each through `f`: a new array where `f` changed any, `items` itself where it changed none.
function mapKeepingSame(items, f) {
    const out = items.map(f);
    return out.some((e, i) => e !== items[i]) ? out : items;
}
// The bag of a `className` object without what withoutShownOfSaved drops of it, every value in it
// walked too; the same bag where nothing is dropped. For a binary dictionary, a Parameter's with its
// Value first: MATLAB R2027a reads a binary dictionary's properties in the order they are written, and
// a text dictionary's Parameter holds them by name, DataType before Value, so a struct-valued one
// copied out of one was read with "The parameter DataType cannot be set to 'struct' unless the Value
// is a structure", its DataType set while its Value was still a double. Every binary Parameter MATLAB
// wrote in this repo holds its Value first (open-questions 14, E). And a CoderInfo's in the
// order MATLAB writes one there (CODER_INFO_ORDER) too: MATLAB R2027a reads a binary dictionary's
// properties in the order they are written, and an Alias or an Alignment set before the
// StorageClass, under the 'Auto' it is until then, is lost (Alignment 8 read as -1). The order
// R2027a's MAT-file saves one in, which its copy carried, sets StorageClass last, and so does a
// text dictionary's, by name; only the Identifier a MAT-file's copy carried after it, of the Alias,
// kept that one. A text dictionary is read whatever the order (measured both ways), and keeps its own.
function savedOnly(className, bag, binary) {
    let out = null;
    if (className === 'Simulink.NumericType') {
        for (const [k, v] of Object.entries(numericTypeShown(bag) ?? {})) {
            if (k in bag && bag[k] === v) {
                out = out ?? { ...bag };
                delete out[k];
            }
        }
    }
    else if (binary && (className === 'Simulink.Parameter' || superclassOf(className) === 'Simulink.Parameter') && 'Value' in bag && Object.keys(bag)[0] !== 'Value') {
        // A Parameter's Value first, as MATLAB writes one into a binary dictionary (above).
        out = { Value: bag.Value };
        for (const [k, v] of Object.entries(bag)) {
            if (k !== 'Value') {
                setOwn(out, k, v);
            }
        }
    }
    else if (className === 'Simulink.CoderInfo') {
        const keys = Object.keys(bag).filter((k) => !(k === 'Identifier' && typeof bag.Alias === 'string' && bag.Identifier === bag.Alias));
        const ordered = binary ? [...CODER_INFO_ORDER.filter((k) => keys.includes(k)), ...keys.filter((k) => !CODER_INFO_ORDER.includes(k))] : keys;
        const held = Object.keys(bag);
        if (ordered.length !== held.length || ordered.some((k, i) => k !== held[i])) {
            out = {};
            for (const k of ordered) {
                setOwn(out, k, bag[k]);
            }
        }
    }
    for (const [k, v] of Object.entries(out ?? bag)) {
        const w = withoutShownOfSaved(v, binary);
        if (w !== v) {
            out = out ?? { ...bag };
            setOwn(out, k, w);
        }
    }
    return out ?? bag;
}
// A CoderInfo's properties in the order MATLAB R2027a writes them into a binary dictionary, and
// MATLAB R2024b and earlier save them in a 'handle' opaque (McosSubsystemCodec.handleObjectOf).
const CODER_INFO_ORDER = [
    'HasCoderInfo', 'StorageClass', 'TypeQualifier', 'Alias', 'Alignment', 'IsCSCPackageOverridden', 'CSCPackageName', 'ParameterOrSignal', 'CustomStorageClass', 'CustomAttributes',
];
/**
 * Of a property a `className` object's row shows at `path` (a schema sourcePath), the property
 * MATLAB shows and what it saves it as, where it saves it under another name (shownPropertiesOf):
 * null where it saves it as it is.
 */
export function shownOfSaved(className, path) {
    if (className === 'Simulink.NumericType') {
        return NUMERIC_TYPE_SAVED[path] ?? null;
    }
    return path === 'CoderInfo.Identifier' && coderInfoShown(className) ? { property: 'CoderInfo.Identifier', saved: 'CoderInfo.Alias' } : null;
}
const NUMERIC_TYPE_SAVED = {
    Signed: { property: 'Signedness', saved: 'SignednessBool' },
    FractionLength: { property: 'FractionLength', saved: 'FixedExponent' },
    Slope: { property: 'Slope', saved: 'SlopeAdjustmentFactor and FixedExponent' },
};
// Whether a `className` object's CoderInfo's Identifier is a row of it: a Parameter's, a Signal's,
// and their subclasses'.
function coderInfoShown(className) {
    return CODER_INFO_SHOWN.has(className) || CODER_INFO_SHOWN.has(superclassOf(className) ?? '');
}
const CODER_INFO_SHOWN = new Set(['Simulink.Parameter', 'Simulink.Signal']);
// A CoderInfo's own bag, as a text dictionary (`{_object_class, _properties}`) or a binary one (an
// object array of one element) holds it, or null.
function coderInfoBagOf(coder) {
    if (!coder || typeof coder !== 'object') {
        return null;
    }
    if (coder._properties && typeof coder._properties === 'object') {
        return coder._properties;
    }
    const elements = coder._elements;
    const first = Array.isArray(elements) && elements.length === 1 ? elements[0] : null;
    return first?._properties && typeof first._properties === 'object' ? first._properties : null;
}
//# sourceMappingURL=mcosShown.js.map