// Copyright 2026 The MathWorks, Inc.
import BaseNode, { encodedHolderOf } from './BaseNode.js';
import { trySetSchemaProperty } from './schemaBridge.js';
import NodeRegistry from './NodeRegistry.js';
import { isMatCdata } from '../parser/CdataCodec.js';
import { budgetFailure, classPhrase, MatBudgetError, oneWrite, textDictionaryForm, writeUnderWay } from '../parser/MatWriter.js';
import { dimsText, isExactDigits, isSpellableExtent, isTextExtent } from '../parser/Size.js';
import { encodedXml, isEncodedValue } from '../parser/EncodedValue.js';
import { setOwn } from '../parser/ownKeys.js';
import { KIND_BY_CLASS, DERIVED_KIND_BY_CLASS, KIND_BY_CLASSIFICATION, kindIn } from '../kindMap.js';
import { effectiveDims, elementCount } from '../display/DisplayConvention.js';
import { charTextFromCodes, decimalCharXml, escapeXml, formatDoubleXml, formatNumericXml, formatComplexBodyXml, complexClassTag, parseMatlabNum, parseExactNum, needsExactInt, transposeToColumnMajorND, matlabTimestampNow, pad as xmlPad, SAVEOBJ_KEY, CUSTOM_SAVE_KEY, ENUM_KEY, enumeralOf, isEnumBag, propertySourcesOf, } from '../parser/XmlUtils.js';
// Format a raw MATLAB timestamp ('YYYYMMDDThhmmss[.ffffff]') as an ISO-like
// display string ('YYYY-MM-DDThh:mm:ssZ'). Mirrors the binary parser's
// formatDate so a text-format and a binary-format entry render identically.
// Values too short to parse (or empty) pass through unchanged.
function formatMatlabTimestamp(raw) {
    if (!raw || raw.length < 15) {
        return raw || '';
    }
    const year = raw.substring(0, 4);
    const month = raw.substring(4, 6);
    const day = raw.substring(6, 8);
    const hour = raw.substring(9, 11);
    const min = raw.substring(11, 13);
    const sec = raw.substring(13, 15);
    return year + '-' + month + '-' + day + 'T' + hour + ':' + min + ':' + sec + 'Z';
}
const MATLAB_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const MATLAB_KEYWORDS = new Set([
    'break',
    'case',
    'catch',
    'classdef',
    'continue',
    'else',
    'elseif',
    'end',
    'for',
    'function',
    'global',
    'if',
    'otherwise',
    'parfor',
    'persistent',
    'return',
    'spmd',
    'switch',
    'try',
    'while',
]);
function validateMatlabName(name) {
    if (!name || !name.trim()) {
        return 'Name cannot be empty';
    }
    if (!MATLAB_NAME_RE.test(name)) {
        return 'Invalid MATLAB name. Must start with a letter and contain only letters, digits, and underscores';
    }
    if (name.length > 63) {
        return 'Name exceeds maximum length of 63 characters';
    }
    if (MATLAB_KEYWORDS.has(name)) {
        return "'" + name + "' is a reserved MATLAB keyword";
    }
    return null;
}
/**
 * One field of MATLAB's saveobj envelope, replaced — the write MATLAB actually reads
 * (defect 46; see `_mergeProps` for why the sibling property alone was not enough).
 *
 * The envelope is a parsed struct: `_fields` names its fields and `_elements` holds one
 * property bag per element. A field is written only if the envelope ALREADY declares it,
 * so an edit can never invent a field in a struct MATLAB's loadobj is about to destructure;
 * an unknown name leaves the envelope untouched and the sibling stands alone, which is the
 * old behaviour.
 *
 * Only a 1x1 envelope is written. A multi-element one is an object array, and a single
 * property bag — which is all `_getSerializedProperties` returns — cannot say which element
 * an edit belongs to. (A dictionary cannot hold an object array at all: MATLAB rejects it
 * outright, as `truth.notes.slddRejected` records.)
 *
 * Copies rather than mutates: this runs inside serialization, and `serial._properties` is
 * parse state shared with `_rawVal`. Writing through it would make serializing a model
 * change the model.
 */
function writeIntoSaveobj(envelope, key, val) {
    if (!envelope || typeof envelope !== 'object') {
        return envelope;
    }
    const env = envelope;
    const fields = env._fields;
    const elements = env._elements;
    if (!Array.isArray(fields) || !fields.includes(key)) {
        return envelope;
    }
    if (!Array.isArray(elements) || elements.length !== 1) {
        return envelope;
    }
    const el = elements[0];
    if (!el || typeof el !== 'object') {
        return envelope;
    }
    return { ...env, _elements: [{ ...el, [key]: val }] };
}
/**
 * An entry's metadata as a TEXT dictionary spells it.
 *
 * The two readers file the same facts under different keys: a text dictionary's own entry
 * is `{uuid, namespace, lastmod, modifiedby, isderived}`, and BinarySlddParser reads a
 * binary one's into `{uuid, namespace, lastModifiedDate, lastModifiedBy, isderived,
 * _rawLastMod}` — the ISO date it displays, and the raw timestamp it writes back. An entry
 * pasted from a binary dictionary into a text one kept the binary keys, and MATLAB will
 * not open a text dictionary holding them: "Failed to open file", for the whole file,
 * measured on R2027a with a plain double pasted that way. So in a text dictionary the raw
 * timestamp is `lastmod` and the author `modifiedby`, in MATLAB's own order, and the ISO
 * date — a display form of the same timestamp — is not written. Metadata that is already
 * a text dictionary's comes back as the same object.
 */
function textDictionaryMetadata(md) {
    if (!md || !('lastModifiedDate' in md || 'lastModifiedBy' in md || '_rawLastMod' in md)) {
        return md;
    }
    const out = {};
    const lastmod = md.lastmod ?? md._rawLastMod;
    const modifiedby = md.modifiedby ?? md.lastModifiedBy;
    for (const [key, val] of [['uuid', md.uuid], ['namespace', md.namespace], ['lastmod', lastmod], ['modifiedby', modifiedby], ['isderived', md.isderived]]) {
        if (val !== undefined) {
            out[key] = val;
        }
    }
    // Every other key is the file's. Asked with `key in out`, a key called `toString` or
    // `constructor` was "already there" on Object.prototype, and one called `__proto__`
    // assigned into `out` went to the prototype setter: all three were dropped from the saved
    // entry. So presence is an own-key question, and the write goes through setOwn.
    for (const [key, val] of Object.entries(md)) {
        if (!Object.prototype.hasOwnProperty.call(out, key) && key !== 'lastModifiedDate' && key !== 'lastModifiedBy' && key !== '_rawLastMod') {
            setOwn(out, key, val);
        }
    }
    return out;
}
/** Do two values agree as MATLAB requires across an array of structures (DataNode._differsFromTwins)? */
export function sameShape(a, b) {
    if (a.cls !== b.cls || a.complex !== b.complex) {
        return false;
    }
    if (a.fields && b.fields && (a.fields.length !== b.fields.length || a.fields.some((f, i) => f !== b.fields[i]))) {
        return false;
    }
    if (a.cls === 'char') {
        return true;
    }
    const da = effectiveDims(a.dims);
    const db = effectiveDims(b.dims);
    return da.length === db.length && da.every((d, i) => d === db[i]);
}
/** The name Add gives a struct's new field: `field`, or the first `fieldN` none of `names` is. */
export function newFieldName(names) {
    const existing = new Set(names);
    let name = 'field';
    for (let i = 1; existing.has(name); i++) {
        name = 'field' + i;
    }
    return name;
}
/**
 * The ENTRY `node` belongs to — itself when it IS one, null when nothing above it is.
 *
 * Every entry-scoped operation asks this first, because an entry is the unit the formats
 * actually work in: a text splice rewrites one entry, deleting a bus element reserializes
 * the bus that holds it, a drag carries whole entries however many rows were selected. So
 * each consumer was walking `parent` until `isEntry` for itself, and both members are
 * ours — `isEntry` is DataNode's, `parent` is BaseNode's — which makes the walk a fact
 * about this model and not about whatever is asking.
 *
 * A FUNCTION as well as the `owningEntry` getter below, and duck-typed on purpose. Two
 * kinds of caller cannot use the getter: a node that is not a DataNode at all (a SECTION
 * and a source root are ContainerNodes, and carry no `isEntry` — read as falsy here, so a
 * section's answer is null rather than the section itself), and a host holding a stand-in
 * shaped like a node rather than an instance of one. Both already relied on `isEntry`
 * being read off the object, so narrowing to the class would not have tightened anything
 * — it would only have moved the walk back out to the callers.
 *
 * Walks `parent` and nothing else, which is what `_markModified` depends on: it clears
 * state on every node BETWEEN `this` and the answer, and identifies that stretch by
 * walking parents until it reaches what this returned.
 */
export function owningEntryOf(node) {
    let entry = node;
    while (entry && !entry.isEntry) {
        entry = entry.parent;
    }
    return entry ?? null;
}
/**
 * Whether a struct element is a bag of fields at all. MATLAB writes every element as an object,
 * but a text dictionary is JSON anyone can edit, so an element can be `null`, a number, a string
 * or an array. None holds a field, and the last two must be said so: an own-key test answers
 * for a string's indices and an array's indices and `length`. Asked by StructNode, of the
 * elements it reads its rows from, and by the raw struct writer below (_structXml), so that the
 * two agree on which elements hold fields.
 */
export function isFieldBag(element) {
    return element !== null && typeof element === 'object' && !Array.isArray(element);
}
/**
 * The saveobj envelope of an object's element as a text dictionary spells it, `_custom_save`
 * beside the element's `_properties` and not in it (XmlUtils' CUSTOM_SAVE_KEY), or undefined.
 * A binary dictionary's reader files the same envelope in the bag, under SAVEOBJ_KEY, which is
 * the one spelling every writer of XML knows. Asked by each place that reads a text element's
 * bag for one: SimulinkObjectNode._propsOf, ObjectNode's XML, and the raw object writer below.
 */
export function customSaveOf(element) {
    return element && typeof element === 'object' ? element[CUSTOM_SAVE_KEY] : undefined;
}
/**
 * The class of `element`, one of the `_elements` of an object array of class `arrayClass`: its
 * own `_object_class` where it carries one, and otherwise the array's. MATLAB's text format
 * spells a mixed-class object array so, `_array_class` naming the class the elements share and
 * `_object_class` each element of another class, and the binary reader holds one so too
 * (BinarySlddParser.objectArrayValue). Asked by both writers of an object array's elements,
 * DataNode._objectXml and ObjectNode.serializeXml, by ObjectNode.parse, and for a value of one
 * element by objectValueClassOf.
 */
export function elementClassOf(element, arrayClass) {
    const own = element && typeof element === 'object' ? element._object_class : undefined;
    return typeof own === 'string' && own !== '' ? own : arrayClass;
}
/**
 * The class of `value`, an object value (`{_array_class, _dimensions, _elements}`): of one
 * element, that element's own (elementClassOf); otherwise the array's. A 1x1 object is an object
 * of its element's class, and MATLAB's text format can spell one as it spells a mixed-class
 * array, the class the elements share in `_array_class` and the element's own in its
 * `_object_class`: `{_array_class: 'Simulink.Signal', _elements: [{_object_class: 'mpt.Signal',
 * …}]}` is an mpt.Signal. Asked wherever a value's class decides its node or what is written for
 * it: NodeClassMap.parseValue, ObjectNode.parse, the className of each typed node that reports
 * the class the file holds, and DataNode._serializeSimulinkObjectXml.
 */
export function objectValueClassOf(value) {
    const elements = value._elements;
    const arrayClass = value._array_class;
    return Array.isArray(elements) && elements.length === 1 ? elementClassOf(elements[0], arrayClass) : arrayClass;
}
/**
 * How many writers of XML are gathering the properties they write as `<P>`s right now
 * (DataNode._xmlProperties). While one is, each node's value under them is asked for in the
 * XML's spelling, which has no null element: a node keeping one (DataNode._keepNullElement)
 * answers with what its class writes for an element holding no properties.
 */
let gatheringXml = 0;
export default class DataNode extends BaseNode {
    constructor(name, parent, serial) {
        super(name, parent);
        this.metadata = null;
        this.serial = serial || {};
        this.status = '';
    }
    // Each data node captures three distinct concepts, one per column:
    //   • className — the raw class identity (e.g. 'Simulink.Bus', 'double').
    //   • kind      — the user-facing name (e.g. 'Bus', 'MATLAB Variable').
    //   • dataType  — a real data type only (e.g. 'double', 'int8'), or empty.
    // These never mix: the Class column shows className, the Kind column shows
    // kind, and the Data Type column shows dataType.
    // The user-facing Kind. A classified entry's Kind comes from its classification
    // token; otherwise it is derived from the Class. Nodes with no known mapping
    // fall back to their raw class name.
    //
    // Every lookup is of an own key (kindIn): the class is the file's word, and a class
    // called `toString` or `constructor` is an unlisted class, not an inherited member.
    get kind() {
        if (this.classification) {
            return kindIn(KIND_BY_CLASSIFICATION, this.classification) || this.classification;
        }
        const cls = this.className;
        // A derived (architectural) entry the catalog didn't classify — e.g. a freshly
        // pasted one, whose new name isn't in the SystemComposer catalog — takes the
        // arch default Kind for its Class (a derived Simulink.Bus is a Data Interface).
        const derivedKind = this.isDerived ? kindIn(DERIVED_KIND_BY_CLASS, cls) : undefined;
        if (derivedKind) {
            return derivedKind;
        }
        return kindIn(KIND_BY_CLASS, cls) || cls;
    }
    // The value shown in the Data Type column. This column shows a real data type
    // only; it never surfaces the node's Class (the class identity, e.g.
    // 'Simulink.Bus') or its Kind. Object-type nodes therefore show nothing here
    // by default; only nodes that carry a genuine data type (primitive variables,
    // structs, bus elements, value types) override this.
    get dataType() {
        return '';
    }
    get isEntry() {
        return !!(this.parent && this.parent.isContainer);
    }
    /** The entry this node belongs to — itself when it IS one, null when none is above it. */
    get owningEntry() {
        return owningEntryOf(this);
    }
    // isIndexedName is inherited from BaseNode (structural: parent is array/cell/
    // string), as is nameEditable — see the note below.
    get isDerived() {
        return !!(this.metadata && this.metadata.isderived === '1');
    }
    // The entry's last-modified timestamp, normalized to a single display string
    // across the two parse paths. The text `.sldd` path stores a raw MATLAB
    // timestamp under `lastmod` (also the shape freshly-added entries use); the
    // binary path pre-formats it to ISO under `lastModifiedDate` and keeps the raw
    // string under `_rawLastMod`. We prefer whichever ISO value exists and fall
    // back to formatting the raw one, so both formats render identically. Empty
    // when the entry carries no timestamp (e.g. nested children).
    get lastModified() {
        const m = this.metadata;
        if (!m) {
            return '';
        }
        const iso = m.lastModifiedDate;
        if (typeof iso === 'string' && iso) {
            return iso;
        }
        const raw = m.lastmod ?? m._rawLastMod;
        return typeof raw === 'string' ? formatMatlabTimestamp(raw) : '';
    }
    // The user who last modified the entry. The text path stores it under
    // `modifiedby`, the binary path under `lastModifiedBy`; new entries leave it
    // empty. Empty when absent.
    get lastModifiedBy() {
        const m = this.metadata;
        if (!m) {
            return '';
        }
        const by = m.lastModifiedBy ?? m.modifiedby;
        return typeof by === 'string' ? by : '';
    }
    // nameEditable is inherited from BaseNode: the things that fix a name — a
    // synthetic positional index, an element subscript, a `_displayName` alias, and an
    // object-property-bag parent — are all structural, so the base rule already covers
    // every data node.
    get disabled() {
        return !this.isEntry;
    }
    // The prop atom `propName` names — by its own key or by the column it renders
    // into, which is how an edit committed in the 'Value' column reaches the atom
    // that actually owns it (a Variant's Condition/Specification). Undefined when
    // this node has no such prop.
    _propFor(propName) {
        return this.getProperties().find((prop) => prop.key === propName || prop.column === propName);
    }
    _resolveProperty(propName) {
        const prop = this._propFor(propName);
        if (!prop) {
            return propName;
        }
        return prop.nodeProperty || prop.key;
    }
    /**
     * Is `stringValue` the text `propName` shows, on a property this node takes an edit of? Then
     * setting it is no edit, and every setProperty asks this first, the overrides included: it
     * answers `true` and changes nothing, records nothing. The value keeps what it was read as
     * (`_rawInput`, an encoded stream) and so its bytes, the entry is neither Modified nor
     * stamped, and the file is not dirty (the maintainer's ruling A3, 2026-10-15 evening).
     *
     * One text stands for many values. Every numeric empty shows `[ ]`, whatever its size and
     * class, as MATLAB's Workspace browser shows them, and a value set from that text is a 0x0
     * double; so the shown text, set back, could change the value it shows. DataModel.editProperty
     * has made the same commit no edit since #107, for the session, which also records no undo
     * step for it; this holds it for a caller that sets a node's property directly.
     *
     * Only an editable property (getPropInfo, the one answer the table and the Property Inspector
     * both read): one this node takes no edit of is still refused, for its shown text as for any
     * other, by whichever gate refuses it (an encoded stream, a MAT stream in a text dictionary, a
     * summary). That refusal changes nothing either.
     */
    _isUnchangedCommit(propName, stringValue) {
        const prop = this._propFor(propName);
        if (!prop) {
            return false;
        }
        try {
            const info = this.getPropInfo(prop);
            return info.editable && info.displayValue === stringValue;
        }
        catch {
            // A property projection that throws leaves the edit to go ahead as it did (DataModel's
            // readPropertyValue, for the same reason).
            return false;
        }
    }
    setProperty(propName, stringValue) {
        if (this._isUnchangedCommit(propName, stringValue)) {
            return true;
        }
        const encodedRefusal = this._refuseEncodedEdit(propName, stringValue);
        if (encodedRefusal) {
            return encodedRefusal;
        }
        // A schema-projected, editable property (e.g. the Code Generation columns
        // Storage Class / Alignment) writes back into serial._properties along its
        // schema sourcePath — including the nested CoderInfo sub-object. Returns null
        // when propName isn't such a property, so we fall through to the field-based
        // logic below.
        const schemaResult = trySetSchemaProperty(this, propName, stringValue);
        if (schemaResult !== null) {
            return schemaResult;
        }
        const resolved = this._resolveProperty(propName);
        if (resolved === 'name') {
            // The node already answers "can this name be typed into", and every path that
            // fixes a name fixes it because the FORMAT has no other spelling for it: a
            // positional element index, an element subscript, a class property's name. Ask
            // that question here too, or a rename the table declined to offer still lands when
            // something asks for it directly — renaming a Simulink.Parameter's `Value` row was
            // exactly that, accepted by the model and dropped by serialize, which writes the
            // key `Value` whatever the node is called.
            if (!this.nameEditable) {
                return {
                    error: true,
                    reason: `'${this.displayName}' is not a name this entry can carry, so it cannot be renamed.`,
                    invalidValue: stringValue,
                    validValue: this.displayName,
                };
            }
            const error = validateMatlabName(stringValue);
            if (error) {
                return { error: true, reason: error, invalidValue: stringValue, validValue: this.name };
            }
            if (this.parent && this.parent.children) {
                // For a top-level entry the parent is a section, which exposes the names
                // across its WHOLE namespace — Design and Architectural Data share one,
                // so a rename must be unique across both, not just the entry's own
                // section. Nested children (bus elements, struct fields) have no such
                // method and fall back to the local sibling check.
                const nsNames = this.parent._namespaceEntryNames;
                const duplicate = typeof nsNames === 'function'
                    ? nsNames.call(this.parent).some((n) => n !== this.name && n === stringValue)
                    : this.parent.children.some((sibling) => sibling !== this && sibling.name === stringValue);
                if (duplicate) {
                    return {
                        error: true,
                        reason: "'" + stringValue + "' already exists in Design or Architectural Data",
                        invalidValue: stringValue,
                        validValue: this.name,
                    };
                }
            }
            const oldName = this.name;
            this.name = stringValue;
            // A container that keys its children by name (a struct, via serial._fields)
            // has to be told, or its field list still spells the old name and the child
            // is orphaned on save. Ask the parent rather than reaching into its serial
            // from here, so a container with more to do can say so — a struct ARRAY
            // shares one field list across every element, which makes a field rename a
            // whole-array operation only StructNode knows about.
            const renameField = this.parent
                ?._renameField;
            if (typeof renameField === 'function') {
                renameField.call(this.parent, oldName, stringValue);
            }
            // The same obligation one level out: a SECTION's parent is the dictionary, which
            // keys the System Composer catalog by entry name, so renaming an ENTRY has to move
            // that key too or the entry is reclassified the next time it is rebuilt from a
            // record (see SectionNode._entryRenamed). Only a top-level entry has a section for
            // a parent, which is what scopes this to the names the catalog can be about.
            const entryRenamed = this.parent
                ?._entryRenamed;
            if (typeof entryRenamed === 'function') {
                entryRenamed.call(this.parent, oldName, stringValue);
            }
            // A rename is the one edit that leaves this node's VALUE as it was, so what that
            // value was read from is still the value: the encoded stream, and the raw value the
            // replaying writers hand back (MatlabVariableNode and StructNode serializeValue). An
            // entry renamed and saved writes its value as it was read. _markModified drops both
            // for every other edit, and still drops them here on every node ABOVE this one,
            // whose raw value spells this node's old name (a struct's, for a field).
            //
            // Dropping the raw value too re-wrote the value from the node, which is lossless
            // only for a value the node can write: a renamed sparse array went out full, a
            // 1000x1000 one as `{}`, a sparse column as a row, and one too large to decode as the
            // text of its own placeholder — in a binary dictionary unescaped, inside a
            // Class="double" element, which made MATLAB refuse to open the whole file.
            const encoded = this._encoded;
            const raw = this._rawInput;
            this._markModified();
            this._encoded = encoded;
            this._rawInput = raw;
            return true;
        }
        // Same shape as the name guard: a node that has nowhere to serialize a Description
        // refuses one rather than holding it until the file is read again (see
        // BaseNode.descriptionEditable). The generic tail below would otherwise write it,
        // because the FIELD exists on every node whether the format carries it or not.
        if (resolved === 'Description' && !this.descriptionEditable) {
            return {
                error: true,
                reason: `A ${this.kind || 'value'} has no Description in a dictionary, so one cannot be saved for '${this.displayName}'.`,
                invalidValue: stringValue,
                validValue: this.Description || '',
            };
        }
        const self = this;
        const current = self[resolved];
        const type = typeof current;
        if (type === 'number') {
            const num = Number(stringValue);
            if (Number.isNaN(num)) {
                return {
                    error: true,
                    reason: 'Expected a numeric value',
                    invalidValue: stringValue,
                    validValue: String(current),
                };
            }
            self[resolved] = num;
        }
        else if (type === 'boolean') {
            self[resolved] = stringValue === 'true';
        }
        else {
            // A prop displayed in a decorated form (a quoted MATLAB literal) has to be
            // undecorated on the way back in: the table seeds its in-place editor with
            // the DISPLAYED text, so committing a cell unchanged arrives here already
            // quoted. Stored as-is, the quotes became part of the value and the next
            // edit wrapped them again — 'a == 1' → ''a == 1'' → … — so the .sldd ended
            // up holding a condition MATLAB can no longer evaluate.
            const unformat = this._propFor(propName)?.unformat;
            self[resolved] = unformat ? unformat(stringValue) : stringValue;
        }
        this._markModified();
        return true;
    }
    // Apply an edit to the node-owned Min/Max value property, mirroring the exact
    // constraint Simulink.DataObject/setPropValue enforces (verified against MATLAB
    // BR2025ad: see test/parity/gen_propconstraints_probe.m). MATLAB requires a
    // "finite real double scalar value" — so we accept a lone real finite number
    // and reject arrays, Inf/-Inf, NaN, complex, and non-numeric text. An empty
    // string or '[]' clears the bound (MATLAB stores []). NOTE: MATLAB does NOT
    // enforce Min <= Max (it accepts Min=5, Max=1), so we deliberately impose no
    // cross-check — matching the object exactly rather than being stricter.
    _setMinMax(propName, stringValue) {
        const self = this;
        const trimmed = stringValue.trim();
        if (trimmed === '' || trimmed === '[]') {
            self[propName] = undefined;
            this._markModified();
            return true;
        }
        const label = propName === 'Min' ? 'Minimum' : 'Maximum';
        const num = Number(trimmed);
        // Number('') is 0 and Number of a whitespace-only string is 0, but we already
        // handled empties; here a non-finite or NaN result means the text was not a
        // finite real scalar. (Number() rejects arrays like '[5 6]' → NaN and complex
        // like '5+2i' → NaN, so those funnel here too.)
        if (!Number.isFinite(num)) {
            const cur = self[propName];
            return {
                error: true,
                reason: label + ' must be a finite real double scalar value',
                invalidValue: stringValue,
                validValue: cur !== undefined ? String(cur) : '[]',
            };
        }
        self[propName] = num;
        this._markModified();
        return true;
    }
    // MATLAB's empty bound is `[]`, and `[]` is truthy: left as it arrives it reaches
    // the table as the text `[]` and the writers as a real value, so a class holding a
    // bound as a node field normalizes it to `undefined` on the way in — the same
    // "no bound" _setMinMax above stores for a cleared cell. Shared rather than
    // per-class so the two ends of that round trip cannot disagree about what an
    // absent bound is: ParameterNode, BusElementNode and ValueTypeNode all call it, and
    // the first two each carried an identical private copy until the third needed one.
    static _normalizeMinMax(val) {
        if (Array.isArray(val) && val.length === 0) {
            return undefined;
        }
        return val;
    }
    // Refuse a value MATLAB's enum does not contain, for any property surfaced as a
    // dropdown (Complexity, DimensionsMode). Without this the edit reaches the generic
    // branch for a string field above, which stores whatever text arrived: the table's
    // own combobox can only offer legal choices, but the Property Inspector has no
    // combobox and seeds a plain text box, so 'Real' or 'fixed' would be written into a
    // file MATLAB then refuses to load — the failure an unlock has to rule out before
    // it is an unlock at all.
    //
    // The legal set is read off the prop atom's readOptions — the SAME call the
    // cell's dropdown is built from (BaseNode.getPropInfo) — rather than restated
    // here. Two copies of an enum is how a UI ends up offering two choices and
    // accepting three.
    //
    // The wording is MATLAB's own, from a probe of the live object (recorded in
    // Simulink.BusElement.md): assigning anything else raises "There is no
    // enumerated value named 'X'." Note this is MATLAB's message for a rejected
    // ASSIGNMENT; that the values we do accept produce a file MATLAB reopens with
    // the same values is the live tier's claim to make, and it has not been run
    // here (test/parity/matlab/writeback.live.test.ts, gated on DEX_MATLAB_CMD).
    //
    // Lives here beside _setMinMax, rather than on BusElementNode where it started with
    // one caller, because Simulink.ValueType's Complexity/DimensionsMode are the same
    // two closed enums and need the same rule. Copying it would have copied the
    // ''-is-a-CLEAR licence below, which is precisely the kind of subtlety that rots out
    // of sync between two copies.
    _rejectUnknownEnumeral(propName, stringValue) {
        const prop = this._propFor(propName);
        if (!prop || prop.editor !== 'select' || !prop.readOptions) {
            return null;
        }
        // The empty string is a CLEAR, not an illegal enumeral — the same licence
        // _setMinMax takes for '' and '[]'. It has to be, because it is what a user
        // emptying the cell submits, and because DataModel.editProperty captures the
        // prior value for UNDO: refusing '' would leave the undo of a clear silently
        // unapplied. Storing '' restores absence rather than writing an illegal value,
        // and every write-back gate for these props reads '' as absence too, so the
        // object goes back out exactly as it came in.
        if (stringValue === '') {
            return null;
        }
        const options = prop.readOptions(this);
        if (options.length === 0 || options.indexOf(stringValue) >= 0) {
            return null;
        }
        const current = this[prop.nodeProperty || prop.key];
        return {
            error: true,
            reason: "There is no enumerated value named '" + stringValue + "'.",
            invalidValue: stringValue,
            validValue: typeof current === 'string' ? current : '',
        };
    }
    // No structural editing by default. The classes that DO manage children (bus,
    // enum type, struct, MATLAB array/cell/string) override both, delegating to
    // childEdit.ts. Returning null here — rather than inheriting a wrapper around
    // no-op hooks — is what lets those hooks live only on the classes that mean them.
    execAddChild() {
        return null;
    }
    execRemoveChild(_child) {
        return null;
    }
    // A child of this node was renamed; keep any name-keyed serial in step. The
    // default is the field list a struct-shaped serial carries, which is all a
    // plain container needs. StructNode overrides it because a struct array shares
    // one field list across every element, so the rename has to reach the matching
    // child of each of them too.
    _renameField(from, to) {
        const fields = this.serial?._fields;
        if (!fields) {
            return;
        }
        const idx = fields.indexOf(from);
        if (idx >= 0) {
            fields[idx] = to;
        }
    }
    // An edit anywhere under an entry makes the entry Modified, and drops the raw parse
    // input of every node it passed THROUGH on the way up: `_rawInput` is the bytes a node
    // was read from, which a reserialize prefers over the live values, so a stale one is how
    // an edit reaches the table and never reaches the file.
    //
    // The walk is still here because only the walk sees those in-between nodes —
    // `owningEntry` reports the destination, not the path. It stops by comparing against
    // that destination rather than re-reading `isEntry`, so the two cannot come to disagree
    // about where the stretch ends (see owningEntryOf, which walks `parent` and nothing
    // else, which is what makes the comparison reachable at all).
    //
    // The same holds for an encoded stream (`_encoded`), and with more at stake: a node
    // holding one writes the stream and nothing else, so a stale one would discard every
    // edit below it on save. A value read from a stream is read-only (_refuseEncodedEdit and
    // BaseNode's editability), so nothing should reach here from inside one; this is the
    // second line, for whatever does. The rename that keeps it is DataNode.setProperty's.
    _markModified() {
        const entry = this.owningEntry;
        for (let node = this; node && node !== entry; node = node.parent) {
            if (node._rawInput !== undefined) {
                node._rawInput = undefined;
            }
            if (node._encoded !== undefined) {
                node._encoded = undefined;
            }
        }
        if (entry) {
            entry.status = 'Modified';
            if (entry._rawInput !== undefined) {
                entry._rawInput = undefined;
            }
            if (entry._encoded !== undefined) {
                entry._encoded = undefined;
            }
            entry._stampLastModified();
        }
        this._markSourceDirty();
    }
    // Refresh the owning entry's last-modified timestamp to now. Called from
    // _markModified on the entry node so every edit (value, name, Min/Max/Unit,
    // schema props) updates the Last Modified column. The two parse paths carry
    // the timestamp under different keys; we update only the keys already present
    // so the JSON path stays byte-faithful (no injected keys) and the binary path
    // round-trips through its own scheme:
    //   text/JSON  — `lastmod` (raw); the getter formats it, JSON dumps it verbatim.
    //   binary     — `lastModifiedDate` (ISO, what the getter reads) + `_rawLastMod`
    //                (what serializeEntryToXml writes back).
    // Who modified it is not tracked (the extension has no user identity), so
    // lastModifiedBy/modifiedby is left as-is. No-op when the entry carries no
    // metadata bag (e.g. transient nodes).
    _stampLastModified() {
        const m = this.metadata;
        if (!m) {
            return;
        }
        const raw = matlabTimestampNow();
        if ('lastmod' in m) {
            m.lastmod = raw;
        }
        if ('_rawLastMod' in m) {
            m._rawLastMod = raw;
        }
        if ('lastModifiedDate' in m) {
            m.lastModifiedDate = formatMatlabTimestamp(raw);
        }
    }
    serialize() {
        // serialize() is what a text dictionary is written from — SlddNode.serializeJson, and
        // a host splicing one entry's JSON into the file — and serializeValue's replay of an
        // untouched value can hold complex TEXT, a binary dictionary's form (or the MCOS
        // decoder's), which MATLAB reads back out of a text dictionary as []. So in one, it
        // goes out as MATLAB's MAT stream. Everywhere else it stays as it is: a binary
        // dictionary is written from serializeXml, where the text IS its form, and a payload
        // copied out of one keeps it for whichever dictionary it lands in.
        //
        // One write of one value (MatWriter.oneWrite), however many streams it is written as.
        return oneWrite(() => {
            const raw = this.serializeValue();
            const json = this._ownerFormat() === 'json';
            let value = raw;
            if (json) {
                try {
                    value = textDictionaryForm(raw);
                }
                catch (e) {
                    // Final (MatWriter.MatBudgetError): named from this node, the value's owner.
                    throw e instanceof MatBudgetError ? this._budgetFailure(e) : e;
                }
            }
            if (this.isEntry) {
                return {
                    name: this.name,
                    // The metadata too, for the same reason: an entry read out of a binary dictionary
                    // carries the binary reader's keys, and MATLAB refuses to open a text dictionary
                    // holding one (see textDictionaryMetadata).
                    metadata: json ? textDictionaryMetadata(this.metadata) : this.metadata,
                    value,
                };
            }
            return value;
        });
    }
    /**
     * The format of the file this node is in, as the nearest container above it states it
     * (SlddNode: 'json' for a text dictionary, 'xml' for a binary one), or undefined for a
     * node in no file — a payload being built, a value the XML writer re-reads.
     */
    _ownerFormat() {
        for (let n = this.parent; n; n = n.parent) {
            const format = n.sourceFormat;
            if (typeof format === 'string') {
                return format;
            }
        }
        return undefined;
    }
    /**
     * This node's rawVal with its live property bag written into the first element — the value
     * half of an entry in an uncompressed-text `.sldd`.
     *
     * The envelope is spelled out again on the way out. `_propsOf` lifted a text dictionary's
     * `_custom_save` into the bag under SAVEOBJ_KEY so everything between parse and save sees
     * one spelling; here it goes back to being an element-level `_custom_save`, because that is
     * where MATLAB's loadobj looks and a `_properties._saveobj` is a key MATLAB has no reader
     * for. The two are the same envelope — see XmlUtils' CUSTOM_SAVE_KEY.
     *
     * `_properties` is then OMITTED when the envelope was all it held, because that is what
     * MATLAB writes: a custom-saving class's element is `{_custom_save: …, _id: …}` with no
     * property bag at all, and emitting `"_properties": {}` beside the envelope would invent a
     * key no MATLAB-written dictionary has. A class with no envelope keeps its bag
     * unconditionally, empty or not — that path is unchanged.
     */
    _serializeSimulinkObject(propOverrides) {
        const props = this._mergeProps(propOverrides);
        const result = { ...this.serial._rawVal };
        const rawElements = result._elements || [];
        const element = { ...rawElements[0] };
        if (SAVEOBJ_KEY in props) {
            const siblings = { ...props };
            delete siblings[SAVEOBJ_KEY];
            element[CUSTOM_SAVE_KEY] = props[SAVEOBJ_KEY];
            if (Object.keys(siblings).length > 0) {
                element._properties = siblings;
            }
            else {
                delete element._properties;
            }
        }
        else {
            element._properties = props;
        }
        result._elements = [element];
        return result;
    }
    /**
     * The stored property bag with this node's live values written over it.
     *
     * The subtlety is the saveobj envelope. When a class serializes through `saveobj`,
     * MATLAB stores its whole state inside one unnamed `<P Source="saveobj">` and the
     * individual properties are NOT siblings of it — so a node that reads such a property
     * finds nothing, substitutes its own default (VariantVariableNode's
     * `(props.Specification as string) || ''`), and then writes that default back as a
     * sibling. cases.sldd's aVariant grew a `<P Name="Specification" Class="char"/>` next
     * to its envelope for exactly that reason: an empty string MATLAB had never written,
     * standing in for an empty 0x0 double it could not see.
     *
     * So under an envelope an EMPTY override is dropped when the stored bag holds no sibling
     * for that key: it is a default rather than an edit, and the envelope is already the
     * authority on that property.
     *
     * A non-empty override goes to BOTH places, and the reason it is both is defect 46.
     * The sibling used to be the only place it went, on the reasoning that silently
     * discarding a real edit is worse than writing a property MATLAB's loadobj *may*
     * ignore. The live gate settled the "may": MATLAB does ignore it. Editing a
     * VariantVariable's Specification to 'myNewVar' in a binary dictionary produced a file
     * MATLAB reopened with Specification '' — the edit was written, and written somewhere
     * nothing reads. Our own reader agreed with us because it reads the sibling too, which
     * is exactly the shape of failure this tier exists to catch: a value written wrongly
     * and read back with the same wrong assumption looks fine from inside.
     *
     * So the value is now also written INTO the envelope, which is what MATLAB actually
     * loads. The sibling is KEPT rather than replaced, because it is the only copy this
     * package's own reader can see — decoding the envelope back into node properties is
     * the other half of defect 40 and is not done here. Writing both keeps every consumer
     * correct and is strictly additive over the old behaviour.
     *
     * That sibling is also what tells a clear from a default (C-199). MATLAB never writes a
     * property beside its envelope, so a sibling that IS there was written by this package,
     * and the node read its value from it. An empty override is then the user clearing that
     * value, and dropping it kept the old value in both copies: MATLAB (R2027a) reopened the
     * cleared variable with it, and so did this reader. So a clear is written the way MATLAB
     * writes a cleared property. The sibling is deleted, because MATLAB writes none and this
     * reader then substitutes the same empty default the node now holds. The envelope's field
     * becomes `[]`, the 0x0 double MATLAB itself writes for a default VariantVariable's
     * Specification and for one set to '' (measured 2026-10-16), whichever empty the override
     * was. A field the envelope does not declare leaves the envelope untouched, as an edit does.
     * Own keys only, so a stored bag can never claim a sibling through its prototype.
     */
    _mergeProps(propOverrides) {
        const stored = { ...this.serial._properties };
        if (!(SAVEOBJ_KEY in stored)) {
            return Object.assign(stored, propOverrides);
        }
        let envelope = stored[SAVEOBJ_KEY];
        for (const [key, val] of Object.entries(propOverrides)) {
            if (val === '' || val === null || val === undefined) {
                if (Object.prototype.hasOwnProperty.call(stored, key)) {
                    delete stored[key];
                    envelope = writeIntoSaveobj(envelope, key, []);
                }
                continue;
            }
            stored[key] = val;
            envelope = writeIntoSaveobj(envelope, key, val);
        }
        stored[SAVEOBJ_KEY] = envelope;
        return stored;
    }
    serializeValue() {
        return null;
    }
    /**
     * Make `encoded` — the byte stream this node was decoded from — what the node writes, for
     * as long as nothing changes the value (_markModified drops it; a rename keeps it).
     *
     * Every writer of a value is a method of the node's class: `serializeValue` for a text
     * dictionary, a copy payload and a parent's property bag, `serializeXml` for a binary
     * dictionary. A stream can decode into a node of ANY class — a sparse array is a
     * MatlabVariableNode, a Simulink.Parameter holding one is a ParameterNode, an object of a
     * class this package does not know is an ObjectNode — and every one of those classes
     * has its own pair. So the replay is installed on the instance, in front of whichever
     * pair its class has, rather than added to each class: one place, which a class written
     * tomorrow cannot forget to call. The class's own writer is looked up when it is called,
     * not captured here, so a node whose class changes after it is built (ConstantNode
     * reclasses a derived variable in place) still falls back to the right one.
     *
     * What each one hands back:
     *   - serializeValue: the envelope itself. DataNode.serialize turns it into the MAT
     *     stream a TEXT dictionary carries for the same value (MatWriter.textDictionaryForm),
     *     and a binary one writes it back through the property and cell-element writers'
     *     encoded arms below — so a copy payload is right for whichever dictionary it lands in.
     *   - serializeXml: the element as it was read, attribute for attribute and byte for byte,
     *     under whatever name and tag the caller is writing it at.
     */
    _adoptEncoded(encoded) {
        this._encoded = encoded;
        const own = this;
        own.serializeValue = function () {
            if (this._encoded) {
                return this._encoded;
            }
            return Object.getPrototypeOf(this).serializeValue.call(this);
        };
        own.serializeXml = function (tagName, attrs, indent) {
            if (this._encoded) {
                const nameAttrs = attrs && attrs.Name !== undefined ? DataNode.pxAttrs(attrs.Name) : '';
                return encodedXml(tagName, nameAttrs, this._encoded, indent);
            }
            return Object.getPrototypeOf(this).serializeXml.call(this, tagName, attrs, indent);
        };
    }
    /**
     * Make `rawVal`, an object value whose one element is `null`, what this node writes as its
     * value for as long as nothing changes it: `_rawInput`, which every edit at or under the node
     * drops (_markModified) and a rename keeps (setProperty).
     *
     * MATLAB writes every element of an object as an object, but a text dictionary is JSON anyone
     * can edit. A typed node reads a null element as one holding no properties, and its class
     * writes the value by rebuilding the element from its bag: as `{"_properties":{}}`, or with
     * whatever a class writes for a property the file did not hold (a ConfigSet its Name, an
     * EnumTypeDefinition its Enumerals). So an untouched save rewrote the null. Installed on the
     * instance, in front of whichever serializeValue its class has, for the reason _adoptEncoded
     * gives.
     *
     * A binary dictionary has no spelling of a null element, so as XML the null is written,
     * wherever it sits, as `{"_properties":{}}` is written there. Where its node is what writes
     * it, that is what the class writes for an element holding no properties. The node's own
     * XML does so from its rows: as an entry, a cell's element or a struct's field. A writer
     * that writes it from the node's value instead, which is an object's property, a
     * Parameter's Value and an edited struct or cell there, asks for that value while it
     * gathers its properties (_xmlProperties), and is given the class's, not the null. An
     * unedited struct or cell there is written from its value as read, where either is an
     * element with no properties.
     */
    _keepNullElement(rawVal) {
        this._rawInput = rawVal;
        const own = this;
        own.serializeValue = function () {
            if (this._rawInput !== undefined && gatheringXml === 0) {
                return this._rawInput;
            }
            return Object.getPrototypeOf(this).serializeValue.call(this);
        };
    }
    /**
     * The refusal for an edit to a value that is still an encoded byte stream, or null when
     * the edit may go ahead. Every setProperty asks this first, the overrides included.
     *
     * A value read from a stream is written back AS the stream (_adoptEncoded), and nothing
     * in this package can write a new one for all it may hold: MatWriter writes a sparse
     * array's stream, but not a function handle's or an MCOS object's subsystem, and the XML
     * this package can spell for the decoded value is not the value — `Class="sparse"` makes
     * MATLAB's reader crash outright, and a dense matrix is a different variable. So an edit
     * anywhere at or under such a node is refused, and the one edit that leaves the value
     * alone is let through: renaming the node that holds the stream, whose name lives
     * outside it.
     */
    /**
     * The encoded element a compressed-binary dictionary has to hold this ENTRY's value as,
     * when it has no XML spelling and its bytes are at hand — or null, for every value whose
     * own serializeXml is the right answer. Asked by serializeEntryToXml; see the
     * MatlabVariableNode override for the one case there is.
     */
    _binaryEncoded() {
        return null;
    }
    /**
     * MatWriter's refusal of a MAT stream that a value at or under this node would have to be
     * written as in the text dictionary it is in, or null. Asked, inside one write, of an entry
     * handed in to a text dictionary (SectionNode.parseEntry). Only a MatlabVariableNode has such
     * a value (its override); every other node asks its rows, which is what it is written from.
     */
    _unwritableStream() {
        for (const child of this.children) {
            const ask = child._unwritableStream;
            const refusal = typeof ask === 'function' ? ask.call(child) : null;
            if (refusal) {
                return refusal;
            }
        }
        return null;
    }
    /**
     * The shape of the value this node holds, as _differsFromTwins compares it: its class and its
     * size, and a scalar struct's fields. A MatlabVariableNode's says whether it is complex.
     */
    _valueShape() {
        const dims = this.dims ?? [1, 1];
        const shape = { cls: this.className, complex: false, dims };
        if (this.className === 'struct' && elementCount(dims) === 1) {
            shape.fields = this.children.map((c) => c.name);
        }
        return shape;
    }
    /**
     * Would this node, holding a value of shape `after`, be unlike its twin in another element of a
     * struct array, at or below `root`? The twin is the node at the same path under the other
     * element, and "unlike" is MATLAB's rule for a Simulink.Parameter's array of structures
     * (probe_parameter_value.m): a field has to agree across the elements in class, in complexity
     * and in size, except that a char field may differ in length (`struct('a', {'x', 'yz'})` is
     * accepted), and a struct in one in its fields. A struct array nested in a field is held to it
     * too, at every level the path crosses. Asked for a value edit (MatlabVariableNode
     * _differsFromTwinsAfter) and for a structural one (ParameterNode._refuseStructureBelow).
     */
    _differsFromTwins(after, root) {
        // The names from just under `below` down to this node.
        const path = [];
        let below = this;
        for (let n = this.parent; n; below = n, n = n.parent) {
            // An element of a struct array carries its subscript (BaseNode.isElementName); a field
            // never does. The tree's own answer, not a count of the dimensions, which a pasted value
            // can declare as bigints no count takes.
            if (n.className === 'struct' && below._subscript) {
                for (const element of n.children) {
                    if (element === below) {
                        continue;
                    }
                    let twin = element;
                    for (const name of path) {
                        twin = twin?.children.find((c) => c.name === name);
                    }
                    if (twin && !sameShape(after, twin._valueShape())) {
                        return true;
                    }
                }
            }
            if (n === root) {
                break;
            }
            path.unshift(below.name);
        }
        return false;
    }
    /**
     * MATLAB's refusal of adding a child to this node (`op` 'add') or removing one ('remove'), in
     * its words, or null. Asked by the gates (canAddChild, canRemoveChild) of a struct and of an
     * array, of what holds the value they are in: the nearest node above that is not a struct, as
     * a value edit asks it (MatlabVariableNode._valueHolderRefusal). For a Parameter's Value, that
     * is the Parameter (ParameterNode._refuseStructureBelow, the maintainer's ruling A2, 2026-10-15
     * evening).
     */
    _structuralRefusal(op) {
        let holder = this.parent;
        while (holder && holder.className === 'struct') {
            holder = holder.parent;
        }
        const refuse = holder
            ?._refuseStructureBelow;
        return typeof refuse === 'function' ? refuse.call(holder, this, op) : null;
    }
    /**
     * The shape this node's value would have once Add gives it a child (`op` 'add') or a child is
     * removed ('remove'), or null where there is none to judge. A removal is judged as of the
     * last child: in a value MATLAB accepts, the removal of any one of them gets the same answer.
     */
    _shapeAfterChildEdit(_op) {
        return null;
    }
    /**
     * Is this node at or under one whose value is still an encoded stream? The structural
     * gates (canAddChild, canRemoveChild) of every class that has them ask this, for the
     * reason _refuseEncodedEdit gives: a child added or removed there could not reach the file.
     */
    get _encodedReadOnly() {
        return !!encodedHolderOf(this);
    }
    _refuseEncodedEdit(propName, stringValue) {
        const holder = encodedHolderOf(this);
        if (!holder) {
            return null;
        }
        if (holder === this && this._resolveProperty(propName) === 'name') {
            return null;
        }
        return {
            error: true,
            reason: `'${holder.displayName}' is stored as an encoded MATLAB value that this editor can show but not write, ` +
                'so it is read-only.',
            invalidValue: stringValue,
            validValue: this._resolveProperty(propName) === 'name' ? this.name : this.displayValue,
        };
    }
    serializeXml(tagName, attrs, indent) {
        if (!writeUnderWay()) {
            return oneWrite(() => this.serializeXml(tagName, attrs, indent));
        }
        // An object in either of its spellings: the value object, and the `{_object_class,
        // _properties}` a text dictionary gives an object nested in another value, which an entry's
        // own struct field or cell element is written from (ObjectNode, for a scalar). That one fell
        // to the bare tag below, a struct field's `<P/>` with no Name: field, class and properties
        // all gone.
        const raw = this.serial && this.serial._rawVal;
        if (raw && (raw._array_class || raw._object_class)) {
            return this._serializeSimulinkObjectXml(tagName, attrs, indent);
        }
        return xmlPad(indent) + '<' + tagName + '/>';
    }
    _serializeSimulinkObjectXml(tagName, attrs, indent) {
        const p = xmlPad(indent);
        const ip = xmlPad(indent + 1);
        const rawVal = this.serial._rawVal;
        // The class of the one object written, its element's: an array of one element of another
        // class was written as an object of the array's. A nested object's spelling is its own
        // element, and names its own class.
        const nested = !rawVal._array_class;
        const className = nested ? rawVal._object_class : objectValueClassOf(rawVal);
        const props = this._xmlProperties();
        let attrStr = '';
        if (attrs && attrs.Name) {
            attrStr += ' Name="' + escapeXml(attrs.Name) + '"';
        }
        let xml = p + '<' + tagName + attrStr + '>\n';
        xml += ip + '<Element Class="' + escapeXml(className) + '">\n';
        const sources = propertySourcesOf(nested ? rawVal : (rawVal._elements || [])[0]);
        for (const [propName, propVal] of Object.entries(props)) {
            xml += DataNode._elementPropertyXml(propName, propVal, indent + 2, this, this._propertyAt(propName), sources) + '\n';
        }
        xml += ip + '</Element>\n';
        xml += p + '</' + tagName + '>';
        return xml;
    }
    _getSerializedProperties() {
        return { ...this.serial._properties };
    }
    /**
     * The properties an object's XML writes as `<P>`s (_serializeSimulinkObjectXml, and each
     * element of an object array): _getSerializedProperties, gathered in the XML's spelling
     * (gatheringXml). Where it holds a node's value, rather than the node writing itself, that
     * value is what the XML is written from, and a kept null element is not a spelling of one.
     */
    _xmlProperties() {
        gatheringXml++;
        try {
            return this._getSerializedProperties();
        }
        finally {
            gatheringXml--;
        }
    }
    /** Where this node's property `propName` stands, for a writer that writes it from its raw value. */
    _propertyAt(propName) {
        return { entry: this.owningEntry?.name ?? this.matlabPath, path: this.matlabPath + '.' + propName };
    }
    /**
     * A raw value read back into a node of its own to write its XML — a MAT stream, this
     * package's sparse literal — which has no parent to say where it is: told `at`, so that a
     * write it refuses names the entry and the path, not the property alone.
     */
    static _detachedXml(value, name, tagName, attrs, indent, at) {
        const node = NodeRegistry.parseValue(value, name, null);
        if (at) {
            node._writtenAt = at;
        }
        return node.serializeXml(tagName, attrs, indent);
    }
    /**
     * The identifying attributes of a `<P>`.
     *
     * Almost always `Name="x"`. The exception is MATLAB's saveobj envelope, which a class
     * that serializes through `saveobj` uses to carry its whole state: MATLAB writes
     * `<P Source="saveobj" PropertyType="any" Class="struct">` with NO Name at all, and the
     * reader files it under SAVEOBJ_KEY because a property bag needs a key. Written back as
     * `Name="undefined"` — what an absent @_Name used to produce — MATLAB's loadobj finds
     * no envelope and builds an EMPTY object: cases.sldd's aVariant reopened as a
     * Simulink.VariantVariable with 0 choices where MATLAB wrote 2 (defect 28).
     *
     * Every `<P>` in this file goes through here, so the envelope survives whichever arm of
     * serializePropertyXml its payload takes.
     */
    static pxAttrs(name) {
        return name === SAVEOBJ_KEY ? ' Source="saveobj" PropertyType="any"' : ' Name="' + escapeXml(name) + '"';
    }
    /**
     * serializePropertyXml for a property of an object's element, whose `sources` (the element's
     * XmlUtils.PROPERTY_SOURCE_KEY record) may give it the Source and PropertyType MATLAB wrote on
     * it: a dynamic property is `<P Name="AutosarSchemaVersion" Source="dynamic" PropertyType="…"
     * Class="char">`, the two after the Name as MATLAB writes them. Every arm of
     * serializePropertyXml opens with the `<P` and pxAttrs, so they go in after that, whatever the
     * value. Asked by each writer of an object's element: _objectXml, _serializeSimulinkObjectXml
     * and ObjectNode.serializeXml.
     */
    static _elementPropertyXml(name, value, indent, ownerNode, at, sources) {
        const xml = DataNode.serializePropertyXml(name, value, indent, ownerNode, at);
        const source = sources && name !== SAVEOBJ_KEY && Object.prototype.hasOwnProperty.call(sources, name) ? sources[name] : undefined;
        const head = xmlPad(indent) + '<P' + DataNode.pxAttrs(name);
        if (!source || typeof source !== 'object' || !xml.startsWith(head)) {
            return xml;
        }
        let attrs = '';
        if (typeof source.source === 'string') {
            attrs += ' Source="' + escapeXml(source.source) + '"';
        }
        if (typeof source.propertyType === 'string') {
            attrs += ' PropertyType="' + escapeXml(source.propertyType) + '"';
        }
        return head + attrs + xml.slice(head.length);
    }
    static serializePropertyXml(name, value, indent, ownerNode, at) {
        const p = xmlPad(indent);
        if (value === null || value === undefined) {
            return p + '<P' + DataNode.pxAttrs(name) + ' Class="char"/>';
        }
        if (typeof value === 'number') {
            return p + '<P' + DataNode.pxAttrs(name) + ' Class="double">' + formatDoubleXml(value) + '</P>';
        }
        if (typeof value === 'boolean') {
            return p + '<P' + DataNode.pxAttrs(name) + ' Class="logical">' + (value ? '1' : '0') + '</P>';
        }
        if (typeof value === 'string') {
            if (value === '') {
                return p + '<P' + DataNode.pxAttrs(name) + ' Class="char"/>';
            }
            // A char MATLAB writes as its codes (XmlUtils.WRITTEN_AS_CODES) goes back as them:
            // custom_object_binary.sldd's widget.Ctrl, char([9 10 13 7 1]), was saved as the text
            // `9 10 13 7 1` — read as that, and written so, with the Format and Dimension gone.
            const codes = decimalCharXml(value, [1, value.length]);
            if (codes) {
                return p + '<P' + DataNode.pxAttrs(name) + ' Class="char"' + codes.attrs + '>' + codes.body + '</P>';
            }
            return p + '<P' + DataNode.pxAttrs(name) + ' Class="char">' + escapeXml(value) + '</P>';
        }
        if (Array.isArray(value)) {
            if (value.length === 0) {
                return p + '<P' + DataNode.pxAttrs(name) + ' Class="double" Dimension="0*0"/>';
            }
            // A bare list of TEXT is a STRING, not a numeric row. That is how both readers
            // hand back a 1x1 string — MATLAB writes it as a bare `["abc"]` in a text
            // dictionary and as an undimensioned saveobj cell in a binary one, which
            // parseStringValue returns as this same one-element list — so without this arm the
            // value fell into the numeric branch below and formatDoubleXml spelled every
            // element `NaN`: a string Value went into the .sldd as `Class="double">NaN`.
            // The ELEMENT type is the discriminator, not the array-ness, so a list of numbers
            // is untouched. A bare list carries no shape of its own, and a row is the only
            // thing it can mean.
            if (value.every((v) => typeof v === 'string')) {
                return DataNode._serializeStringPropertyXml(name, value, [1, value.length], indent);
            }
            const formatted = value.map(function (v) {
                return formatDoubleXml(v);
            });
            return (p +
                '<P' +
                DataNode.pxAttrs(name) +
                ' Class="double" Dimension="1*' +
                value.length +
                '">' +
                formatted.join(' ') +
                '</P>');
        }
        if (typeof value === 'object') {
            const obj = value;
            // A value still in the byte stream it was read as (EncodedValue): written as read.
            if (isEncodedValue(obj)) {
                return encodedXml('P', DataNode.pxAttrs(name), obj, indent);
            }
            if (obj._type && obj._value !== undefined) {
                return DataNode._serializeTypedPropertyXml(name, obj, indent, at);
            }
            if (obj._array_class) {
                return DataNode._serializeObjectPropertyXml(name, obj, indent, ownerNode, at);
            }
            if (obj._object_class) {
                // A text dictionary's scalar object of a class that saves through saveobj holds its
                // envelope beside the bag (customSaveOf), and the wrapped element dropped it: written
                // as an element with no properties, the object's whole state gone. Carried only when
                // present, so a value holding none writes as it did.
                const element = { _properties: obj._properties || {} };
                const envelope = customSaveOf(obj);
                if (envelope !== undefined)
                    element[CUSTOM_SAVE_KEY] = envelope;
                const wrapped = {
                    _array_class: obj._object_class,
                    _dimensions: [1, 1],
                    _elements: [element],
                };
                return DataNode._serializeObjectPropertyXml(name, wrapped, indent, ownerNode, at);
            }
            if (obj._array_type === 'Struct') {
                return DataNode._serializeStructPropertyXml(name, obj, indent, at);
            }
            if (obj._array_type === 'Cell') {
                return DataNode._serializeCellPropertyXml(name, obj, indent, at);
            }
            // The shape a string with more than one element arrives in. Without this arm it
            // reached the trailing char fallback, where String() spelled the whole wrapper
            // `[object Object]` — every element of the value gone from the saved file.
            if (obj._array_type === 'String') {
                const elements = obj._elements || [];
                DataNode._sizeOrRefuse(obj._dimensions, 'string', name, at);
                return DataNode._serializeStringPropertyXml(name, elements, obj._dimensions || [1, elements.length], indent);
            }
        }
        return p + '<P' + DataNode.pxAttrs(name) + ' Class="char">' + escapeXml(String(value)) + '</P>';
    }
    /**
     * The `Class="char" Dimension="r*c"` attributes and body of an mxchar literal, or
     * null for anything else — shared by the property and cell-element writers below.
     *
     * mxchar is MATLAB's TEXT-dictionary spelling of a shaped char (character codes, one
     * bracketed group per row); XML wants the plain column-major text under a Dimension
     * (defect 25). Written through the generic typed-value path instead, a char field of
     * a struct went out as `Class="mxchar" Dimension="2*2">97 99 98 100` — a class MATLAB
     * does not have, holding numbers where its characters were. A char MATLAB writes as its
     * codes keeps them, with `Format="decimal"` beside the Dimension (XmlUtils.decimalCharXml).
     */
    static _mxCharXml(value) {
        if (value._type !== 'mxchar') {
            return null;
        }
        const m = String(value._value).match(/^Matrix\((\d+(?:,\d+)*)\)\n(.+)$/s);
        if (!m) {
            // No header: nothing to state, and the body is already the text (see
            // MatlabVariableNode.parseMxChar, which reads the same shape back as a row).
            const text = String(value._value);
            return decimalCharXml(text, [1, text.length]) ?? { attrs: '', body: escapeXml(text) };
        }
        const dims = m[1].split(',').map(function (s) {
            return parseInt(s, 10);
        });
        // Number() rather than a cast: _parseMatrixNums is typed for the 64-bit case now,
        // and a char code is never one — mxchar is not an integer class.
        const text = charTextFromCodes(DataNode._parseMatrixNums(m[2]).map(Number), dims);
        return decimalCharXml(text, dims) ?? { attrs: ' Dimension="' + dims.join('*') + '"', body: escapeXml(text) };
    }
    /**
     * MATLAB's spelling of a string value, from the `<Element Class="string">` down: a
     * saveobj CELL of chars, one `<Element Class="char">` per element, carrying the cell's
     * Dimension for every shape but 1x1.
     *
     * Copied from the string entries of the MATLAB-authored dictionaries in
     * test/parity/artifacts/binary — `strScalar` writes an undimensioned cell around one
     * char, `strArray` a `Dimension="1*3"` one around three. Those are dictionary ENTRIES
     * rather than object properties, and the corpus has no MATLAB-authored object holding a
     * string, but BinarySlddParser decodes both through the same parseStringValue, so there
     * is one envelope to write and not two.
     *
     * Shared with MatlabVariableNode._serializeStringXml, which writes the same envelope
     * for an entry, for the same reason _mxCharXml is shared: this is the second and last
     * place that spells it, and two copies of a format are how one of them goes stale.
     */
    static _stringEnvelopeXml(elements, dims, indent) {
        const ip = xmlPad(indent + 1);
        const ip2 = xmlPad(indent + 2);
        const ip3 = xmlPad(indent + 3);
        // 1x1 alone goes bare, and the rank has to be tested with it: dims[0] === 1 &&
        // dims[1] === 1 is also true of a 1x1x3, whose extents must be stated.
        const dimAttr = dims.length <= 2 && dims[0] === 1 && dims[1] === 1 ? '' : ' Dimension="' + dims.join('*') + '"';
        let xml = ip + '<Element Class="string">\n';
        xml += ip2 + '<P Source="saveobj" PropertyType="any" Class="cell"' + dimAttr + '>\n';
        for (const el of elements) {
            // `|| ''`: a `missing` element is null in the model, and has no text to write.
            xml += ip3 + '<Element Class="char">' + escapeXml(el || '') + '</Element>\n';
        }
        xml += ip2 + '</P>\n';
        xml += ip + '</Element>\n';
        return xml;
    }
    // A string-valued PROPERTY: the envelope above under a `<P Name="…">` that carries no
    // Class of its own — the class is stated by the Element inside, exactly as MATLAB
    // writes it and as _serializeObjectPropertyXml's `<P>` does for a nested object.
    static _serializeStringPropertyXml(name, elements, dims, indent) {
        return DataNode._stringXml('P', DataNode.pxAttrs(name), elements, dims, indent);
    }
    // The same under any tag: a cell element holding a string is a classless `<Element>` around
    // the envelope (cellstr_binary.sldd's cStr and cStrArr), as a property is a `<P>` around it.
    static _stringXml(tag, attrs, elements, dims, indent) {
        const p = xmlPad(indent);
        return p + '<' + tag + attrs + '>\n' + DataNode._stringEnvelopeXml(elements, dims, indent) + p + '</' + tag + '>';
    }
    static _serializeTypedPropertyXml(name, value, indent, at) {
        const p = xmlPad(indent);
        const type = value._type;
        const raw = String(value._value);
        if (type === 'mxchar') {
            DataNode._sizeOrRefuse(DataNode._headerDims(raw), 'char', name, at, raw);
        }
        const mxChar = DataNode._mxCharXml(value);
        if (mxChar) {
            // An empty one, a 0x2 char, self-closed with its Dimension, as MATLAB writes it.
            return (p + '<P' + DataNode.pxAttrs(name) + ' Class="char"' + mxChar.attrs + (mxChar.body === '' ? '/>' : '>' + mxChar.body + '</P>'));
        }
        if (type === 'cdata') {
            // Two different values wear this tag. A MAT byte stream — what a TEXT
            // dictionary carries for every rank >= 3 value and every complex one — has
            // no text XML form: its class, extents and elements are inside the bytes,
            // and the complex spelling below would write six-bit characters as the body
            // of a `Class="double" IsComplex="1"` property. Read it back into a node and
            // let that node write its own XML, which is the same writer the .slx path
            // uses for the value in the first place.
            //
            // The reader has to be reached through NodeRegistry: MatlabVariableNode
            // extends this class, so importing it here would be a load-order cycle. That
            // is the registry's whole purpose, and it is populated by NodeClassMap for
            // anyone who can have parsed a cdata at all.
            if (isMatCdata(value)) {
                return DataNode._detachedXml(value, name, 'P', { Name: name }, indent, at);
            }
            DataNode._sizeOrRefuse(value._dimensions, complexClassTag(value._class) ?? 'double', name, at);
            return DataNode._complexTextXml('P', DataNode.pxAttrs(name), value, indent);
        }
        // This package's text-dictionary literal for an edited sparse double matrix — which a
        // text dictionary written before MatWriter could write a sparse stream still holds —
        // read back into the node it stands for, which writes a sparse array the one way a
        // binary dictionary holds it (MatlabVariableNode.serializeXml). Spelled by the arms
        // below it was `Class="sparse"`, which makes MATLAB's reader segfault, and a complex
        // element's imaginary part was dropped on the way: a Simulink.Parameter pasted from a
        // text dictionary into a binary one, its sparse Value edited, crashed MATLAB on read.
        if (type === 'sparse') {
            return DataNode._detachedXml(value, name, 'P', { Name: name }, indent, at);
        }
        const matrix = DataNode._matrixLiteralXml('P', DataNode.pxAttrs(name), name, type, raw, indent, at);
        if (matrix !== null) {
            return matrix;
        }
        // A typed `[]`, the 0x0 of its class, which is how MATLAB writes one in a text dictionary
        // (`{"_type": "int16", "_value": "[]"}`): self-closed with its class, as MATLAB writes the
        // same value in a binary one, and as the cell-element writer has written one. It fell to the
        // scalar tail below, which read the brackets as the number 0: a copy of a text dictionary's
        // int16 0x0 into a binary one was saved as `Class="int16">0`.
        if (raw === '[]') {
            return p + '<P' + DataNode.pxAttrs(name) + ' Class="' + escapeXml(type) + '" Dimension="0*0"/>';
        }
        const vecMatch = raw.match(/^\[(.+)\]$/);
        if (vecMatch) {
            const parts = vecMatch[1].split(',').map(function (s) {
                return DataNode._numToken(s, type);
            });
            const formatted = parts.map(function (v) {
                return formatNumericXml(v, type);
            });
            return (p +
                '<P' +
                DataNode.pxAttrs(name) +
                ' Class="' +
                escapeXml(type) +
                '" Dimension="1*' +
                parts.length +
                '">' +
                formatted.join(' ') +
                '</P>');
        }
        const num = DataNode._numToken(raw, type);
        return p + '<P' + DataNode.pxAttrs(name) + ' Class="' + escapeXml(type) + '">' + formatNumericXml(num, type) + '</P>';
    }
    /**
     * A typed `Matrix(d1,…,dn)` literal — `{_type: 'int8', _value: 'Matrix(2,2)\n[[1, 2]; [3,
     * 4]]'}` — as the one element MATLAB holds it in, under `tag`: its class, every extent, and
     * the elements in MATLAB's column-major order. Null for any other literal, which the
     * caller's later arms spell. Shared by the property writer and the cell-element writer.
     *
     * Rank 3 and up spells its header Matrix(2,3,2) — MATLAB's own binary dictionary writes
     * such an entry as Dimension="2*3*2" with a flat column-major body, so every extent has to
     * survive the round trip. The two-group form was the only one matched, so an N-D literal
     * fell through to the scalar branch and was written out as the single number 0. The
     * cell-element writer had no arm for the literal at all, so a matrix of any rank in a cell
     * that is an object's property went out as that 0: cellarr_binary.sldd's 2x3x2 cNd, lifted
     * into one, was saved as `<Element Class="double">0.0</Element>`.
     *
     * parseCellElement states an EMPTY numeric element as the bare header, `Matrix(0,3)`: there
     * are no elements to carry the shape any other way. It is written as MATLAB writes an
     * empty, self-closed with its Dimension, where the scalar tail wrote the 0x3 as the scalar
     * `0.0`. A bare header that declares elements is not a literal this reads.
     */
    static _matrixLiteralXml(tag, attrs, name, type, raw, indent, at) {
        const m = raw.match(/^Matrix\((\d+(?:,\d+)*)\)(?:\n(.+))?$/s);
        if (!m) {
            return null;
        }
        const dims = m[1].split(',').map(function (s) {
            return parseInt(s, 10);
        });
        const open = xmlPad(indent) + '<' + tag + attrs + ' Class="' + escapeXml(type) + '" Dimension="' + dims.join('*') + '"';
        if (m[2] === undefined) {
            if (!dims.some((d) => d === 0)) {
                return null;
            }
            DataNode._sizeOrRefuse(dims, type, name, at, raw);
            return open + '/>';
        }
        DataNode._sizeOrRefuse(dims, type, name, at, raw);
        const nums = DataNode._parseMatrixNums(m[2], type);
        const colMajor = transposeToColumnMajorND(nums, dims);
        const formatted = colMajor.map(function (v) {
            return formatNumericXml(v, type);
        });
        return open + '>' + formatted.join(' ') + '</' + tag + '>';
    }
    /**
     * A complex value in its plain-text form — `{_type: 'cdata', _value: '1+2i 5+6i 3+4i
     * 7+8i', _dimensions: [2, 2], _class?}`, what BinarySlddParser reads out of a binary
     * dictionary and McosParser.complexPropertyValue builds for a .mat or a model workspace
     * — as the one XML element a binary dictionary holds it in: its class, `IsComplex="1"`,
     * every extent unless it is a scalar (MATLAB writes none on one), and the body for its
     * class. Shared by the property writer and the cell-element writer.
     *
     * Both used to drop half of that. The property writer wrote `Class="double"
     * IsComplex="1"` and nothing else whatever the value was, so any save that wrote a
     * complex Value it had not edited lost its shape and its class: MATLAB read
     * `[1+2i 3+4i 5+6i]` back as 1+2i, a 2x2 and a 2x2x2 as their first element, and
     * int64(complex(intmax('int64'), 1)) as the double 9.22337203685478e+18+1i — on a
     * no-op save of MATLAB's own file, and on editing any other property of the entry.
     * The cell-element writer wrote `Class="cdata"`, a class MATLAB does not have.
     */
    static _complexTextXml(tag, attrs, value, indent) {
        const cls = complexClassTag(value._class) ?? 'double';
        const dims = Array.isArray(value._dimensions) ? value._dimensions : null;
        const dimAttr = dims && !(dims.length <= 2 && dims[0] === 1 && dims[1] === 1) ? ' Dimension="' + dims.join('*') + '"' : '';
        const open = xmlPad(indent) + '<' + tag + attrs + ' Class="' + cls + '" IsComplex="1"' + dimAttr;
        const body = formatComplexBodyXml(String(value._value ?? ''), cls);
        // An empty body is MATLAB's complex empty, `<P … Dimension="1*0"/>`.
        return body === '' ? open + '/>' : open + '>' + body + '</' + tag + '>';
    }
    static _serializeObjectPropertyXml(name, value, indent, ownerNode, at) {
        return DataNode._objectXml('P', DataNode.pxAttrs(name), name, value, indent, ownerNode, at);
    }
    /**
     * An object bag (`{_array_class, _dimensions, _elements: [{_object_class?, _properties}]}`) under `tag`: a
     * property's `<P Name="…">`, or the classless `<Element>` a cell element holding an object
     * is — cellarr_binary.sldd's cObj is `<Element>` around one `<Element
     * Class="Simulink.Parameter">`, its cObjArr `<Element Dimension="1*2">` around two. An
     * enumeration value is one of these bags too, and has a spelling of its own (_enumXml).
     */
    static _objectXml(tag, attrs, name, value, indent, ownerNode, at) {
        if (isEnumBag(value)) {
            return DataNode._enumXml(tag, attrs, name, value, indent, at);
        }
        const p = xmlPad(indent);
        const ip = xmlPad(indent + 1);
        const className = value._array_class;
        DataNode._sizeOrRefuse(value._dimensions, className, name, at);
        const dims = value._dimensions || [1, 1];
        const elements = value._elements || [];
        const close = '</' + tag + '>';
        // An element a text dictionary holds as `null` holds no properties (ObjectNode.parse): reading
        // `_properties` off it threw, and the write of the whole dictionary with it. One whose class
        // saves through saveobj carries its envelope beside the bag there (customSaveOf), which went
        // unwritten, the object's whole state with it: it goes into the bag, where a binary
        // dictionary has it and pxAttrs writes it as MATLAB's unnamed saveobj <P>, after the
        // properties, as SimulinkObjectNode._propsOf puts it.
        const propsOf = (elem) => {
            const props = (elem && elem._properties) || {};
            const envelope = customSaveOf(elem);
            return envelope === undefined ? props : { ...props, [SAVEOBJ_KEY]: envelope };
        };
        // An array of no element, whose size says it holds none, as MATLAB writes
        // `Simulink.BusElement.empty`: the class and the Dimension, self-closed. It was written as
        // the one element with no properties below, a 1x1 object the array never held; a bus with
        // no elements, which BaseBusNode writes as this, is the commonest. A bag whose size says
        // 1x1 is one object with no properties, and is still written as one.
        if (elements.length === 0 && dims.some((d) => d === 0)) {
            return p + '<' + tag + attrs + ' Class="' + escapeXml(className) + '" Dimension="' + dims.join('*') + '"/>';
        }
        if (elements.length === 0 || (elements.length === 1 && Object.keys(propsOf(elements[0])).length === 0)) {
            return p + '<' + tag + attrs + '>\n' + ip + '<Element Class="' + escapeXml(elementClassOf(elements[0], className)) + '"/>\n' + p + close;
        }
        // Every extent, exactly as the struct sibling below does and for the same
        // reason — see ObjectNode.serializeXml for why a Dimension= that contradicts
        // the body beneath it is wrong even though MATLAB stores no object array for
        // us to compare against. The 1x1 shortcut has to check rank too: dims[0] === 1
        // && dims[1] === 1 is also true of a 1x1x3, so testing only the first two
        // extents would drop that shape's attribute entirely.
        const dimAttr = dims.length <= 2 && dims[0] === 1 && dims[1] === 1 && elements.length === 1
            ? ''
            : ' Dimension="' + dims.join('*') + '"';
        let xml = p + '<' + tag + attrs + dimAttr + '>\n';
        // Each element under its own class: a config set's Components holds nine or more, and
        // every one was written as the array's.
        elements.forEach((elem, k) => {
            const props = propsOf(elem);
            const sources = propertySourcesOf(elem);
            xml += ip + '<Element Class="' + escapeXml(elementClassOf(elem, className)) + '">\n';
            for (const [propName, propVal] of Object.entries(props)) {
                xml += DataNode._elementPropertyXml(propName, propVal, indent + 2, ownerNode, DataNode._within(at, elements.length, k, '.' + propName), sources) + '\n';
            }
            xml += ip + '</Element>\n';
        });
        xml += p + close;
        return xml;
    }
    /**
     * An enumeration value (XmlUtils.ENUM_KEY) under `tag`, as MATLAB wrote it: the `IsEnum` it
     * carried, then a Dimension unless it is a scalar, around one `<Element Class="…"
     * EnumerationName="…" EnumerationType="…">` per enumeral holding its value text — or, empty,
     * self-closed with its class and Dimension, there being no enumeral to name the class. A cell
     * element's is `<Element IsEnum="1">`, a property's or an entry's `<P Name="…" IsEnum="1">`.
     *
     * Reached from `_objectXml`, for a property or a cell held as a raw value, and from
     * ObjectNode.serializeXml, for an entry and an entry's cell; the object spelling took the
     * enumeral for an object with no properties and wrote `<Element Class="GearMode"/>`, its name
     * and value gone.
     */
    static _enumXml(tag, attrs, name, value, indent, at) {
        const p = xmlPad(indent);
        const ip = xmlPad(indent + 1);
        const className = escapeXml(value._array_class);
        DataNode._sizeOrRefuse(value._dimensions, value._array_class, name, at);
        const dims = value._dimensions || [1, 1];
        const elements = value._elements || [];
        const open = p + '<' + tag + attrs + ' IsEnum="' + escapeXml(String(value[ENUM_KEY])) + '"';
        if (elements.length === 0) {
            return open + ' Class="' + className + '" Dimension="' + dims.join('*') + '"/>';
        }
        const scalar = dims.length <= 2 && dims[0] === 1 && dims[1] === 1 && elements.length === 1;
        let xml = open + (scalar ? '' : ' Dimension="' + dims.join('*') + '"') + '>\n';
        for (const element of elements) {
            const e = enumeralOf(element);
            xml += ip + '<Element Class="' + className + '"';
            if (e?.name !== undefined) {
                xml += ' EnumerationName="' + escapeXml(e.name) + '"';
            }
            if (e?.type !== undefined) {
                xml += ' EnumerationType="' + escapeXml(e.type) + '"';
            }
            xml += '>' + escapeXml(e ? e.value : '') + '</Element>\n';
        }
        return xml + p + '</' + tag + '>';
    }
    /**
     * Refuses to write a raw property value whose dims no Dimension can spell (parser/Size): a
     * raw cell, struct, object or string bag, an mxchar's or a typed literal's `Matrix(…)`
     * header, a complex text's `_dimensions`. A binary dictionary's reader passes every finite
     * non-negative extent through as read, so one of those is written back as read; what is
     * refused — NaN, an infinity, a negative, a string, an object, a bigint — came from a text
     * dictionary or a host, and `Dimension="1*x"` is no spelling of anything. Dims read from
     * a `header` are held to its digits: digits naming a count no double holds exactly, like
     * 9007199254740993, would be parsed to another count and written as that one (parser/Size,
     * isExactDigits).
     */
    static _sizeOrRefuse(dims, cls, name, at, header) {
        if (dims === undefined || (header !== undefined ? DataNode._headerExact(header) : Array.isArray(dims) && dims.every(isSpellableExtent))) {
            return;
        }
        const what = classPhrase(cls) + ' declaring dimensions ' + dimsText(dims);
        throw budgetFailure(new MatBudgetError(what + ' was not written', '', what, undefined, 'not-a-count'), at ? at.entry : name, at ? at.path : name);
    }
    /** The extents of a `Matrix(…)` header of digit runs, as numbers, or undefined. */
    static _headerDims(text) {
        const m = /^Matrix\((\d+(?:,\d+)*)\)/.exec(text);
        return m ? m[1].split(',').map(Number) : undefined;
    }
    /** Whether each extent of a `Matrix(…)` header parses to the count its digits say, or there is no header. */
    static _headerExact(text) {
        const m = /^Matrix\((\d+(?:,\d+)*)\)/.exec(text);
        return !m || m[1].split(',').every(isExactDigits);
    }
    /**
     * A refusal of a write that began at this node, restated for a user: the entry — the one
     * above, or, for a node a writer built on its own to write a raw property value
     * (_detachedXml), the one it was built for — and the path to it.
     */
    _budgetFailure(e) {
        let root = this;
        while (root.parent) {
            root = root.parent;
        }
        const entry = root._writtenAt ? root._writtenAt.entry : this.owningEntry?.name ?? this.matlabPath;
        return budgetFailure(e, entry, this.matlabPath);
    }
    /**
     * Refuses to write this node's XML when its dims are not what a Dimension can spell — the
     * same rule as for a raw property value (_sizeOrRefuse), dims read from a `header` held to
     * its digits as there — naming the entry and the path.
     */
    _spellableOrRefuse(dims, cls, header) {
        if (dims === undefined || (header !== undefined ? DataNode._headerExact(header) : Array.isArray(dims) && dims.every(isSpellableExtent))) {
            return;
        }
        const what = classPhrase(cls) + ' declaring dimensions ' + dimsText(dims);
        throw this._budgetFailure(new MatBudgetError(what + ' was not written', '', what, undefined, 'not-a-count'));
    }
    /**
     * Refuses to write this node's value as a text dictionary's JSON, or copy it there, when its
     * dims hold NaN, an infinity or a bigint, which JSON writes as null or cannot write
     * (parser/Size, isTextExtent), naming the entry and the path, as _spellableOrRefuse does for
     * a Dimension.
     */
    _textSpellableOrRefuse(dims, cls) {
        if (!Array.isArray(dims) || dims.every(isTextExtent)) {
            return;
        }
        const what = classPhrase(cls) + ' declaring dimensions ' + dimsText(dims);
        throw this._budgetFailure(new MatBudgetError(what + ' was not written', '', what, undefined, 'not-a-count'));
    }
    /**
     * `at` one level down: element `k` of `n` — its MATLAB subscript, `(k+1)`, unless it is
     * the only one — then `rest`, a field or a property.
     */
    static _within(at, n, k, rest) {
        return at && { entry: at.entry, path: at.path + (n > 1 ? '(' + (k + 1) + ')' : '') + rest };
    }
    static _serializeStructPropertyXml(name, value, indent, at) {
        return DataNode._structXml('P', DataNode.pxAttrs(name), name, value, indent, at);
    }
    /**
     * A struct bag under `tag`: a property's `<P Name="…" Class="struct">`, or a cell element's
     * `<Element Class="struct">`. MATLAB states a struct in a cell the way it states a struct
     * property, shape and all: cellarr_binary.sldd's cStruct is `<Element Class="struct">` over
     * one `<Element>`, its cStructArr2D `<Element Class="struct" Dimension="2*2">` over four.
     */
    static _structXml(tag, attrs, name, value, indent, at) {
        const p = xmlPad(indent);
        const ip = xmlPad(indent + 1);
        DataNode._sizeOrRefuse(value._dimensions, 'struct', name, at);
        const dims = value._dimensions || [1, 1];
        const elements = value._elements || [];
        // Every extent, not the first two: MATLAB's own binary dictionary writes
        // `Class="struct" Dimension="2*3*2"` for a 2x3x2 struct array, and twelve
        // <Element>s under a `2*3` would read back as a six-element array.
        const dimAttr = dims.length <= 2 && dims[0] === 1 && dims[1] === 1 ? '' : ' Dimension="' + dims.join('*') + '"';
        let xml = p + '<' + tag + attrs + ' Class="struct"' + dimAttr + '>\n';
        // An EMPTY struct declares its field names with `<Field Name="…"/>`, and only an empty one
        // does: MATLAB writes them on every struct property of its own with no `<Element>` and on
        // none that has one, because an element's `<P Name="…">` children already spell them.
        // `struct('a', {})` is a 0x0 struct WITH a field called `a`, so this is not decoration —
        // it is the only place the names of an empty struct's fields can be written, and without
        // it `Simulink.VariantVariable`'s `Choices` went out as an anonymous empty struct where
        // MATLAB names Condition and Value. (MATLAB heals that on its own next save, from the
        // class definition; our reader cannot, which is the half that mattered.)
        if (elements.length === 0) {
            for (const field of value._fields || []) {
                xml += ip + '<Field Name="' + escapeXml(field) + '"/>\n';
            }
        }
        // An element that is not a bag of fields (isFieldBag) is written as one holding none, as
        // StructNode reads it: Object.entries threw on a null one, and failed the whole write, and
        // wrote a string's or an array's indices as its fields.
        elements.forEach((elem, k) => {
            xml += ip + '<Element>\n';
            for (const [field, fieldVal] of Object.entries(isFieldBag(elem) ? elem : {})) {
                xml += DataNode.serializePropertyXml(field, fieldVal, indent + 2, null, DataNode._within(at, elements.length, k, '.' + field)) + '\n';
            }
            xml += ip + '</Element>\n';
        });
        xml += p + '</' + tag + '>';
        return xml;
    }
    static _serializeCellPropertyXml(name, value, indent, at) {
        return DataNode._cellXml('P', DataNode.pxAttrs(name), name, value, indent, at);
    }
    /**
     * A cell bag under `tag`: a property's `<P Name="…" Class="cell">`, or a cell element's
     * `<Element Class="cell">`, whose own elements go back through the element writer below, to
     * any depth.
     *
     * A 1x1 cell states no Dimension, at either site, because MATLAB writes none: the corpus's
     * binary dictionaries hold 81 cell properties that are 1x1 and carry no Dimension, and
     * cases.sldd a nested one (cellNest), and no cell MATLAB wrote says `Dimension="1*1"`. Both
     * reading sites take an absent Dimension as 1xN for N elements, so only a cell of exactly
     * one element goes without.
     */
    static _cellXml(tag, attrs, name, value, indent, at) {
        const p = xmlPad(indent);
        DataNode._sizeOrRefuse(value._dimensions, 'cell', name, at);
        const dims = value._dimensions || [1, 1];
        const elements = value._elements || [];
        const dimAttr = dims.length <= 2 && dims[0] === 1 && dims[1] === 1 && elements.length === 1
            ? ''
            : ' Dimension="' + dims.join('*') + '"';
        let xml = p + '<' + tag + attrs + ' Class="cell"' + dimAttr + '>\n';
        elements.forEach((elem, k) => {
            xml += DataNode._serializeCellElementXml(elem, indent + 1, at && { entry: at.entry, path: at.path + '{' + (k + 1) + '}' }) + '\n';
        });
        xml += p + '</' + tag + '>';
        return xml;
    }
    /**
     * One element of a cell held as a raw value — an object's property, a struct field, or a
     * cell inside either — which is what every save of a binary dictionary writes such a cell
     * from, edited or not. It takes every shape BinarySlddParser.parseCellElement reads an
     * element as, and writes each in the spelling MATLAB gives it in a cell.
     *
     * It used to take only the scalars, a flat numeric row, the typed scalars and vectors,
     * complex text and an encoded stream. Everything else MATLAB writes in a cell — a nested
     * cell, a struct, an object, a string, a matrix — was written wrong on a save that touched
     * nothing, measured with every element of the entry-level cells in cellarr_binary.sldd,
     * cellstr_binary.sldd, typed_binary.sldd and cases.sldd lifted into an object's property: a
     * nested cell, a struct or an object as `<Element Class="char">[object Object]</Element>`, a
     * 2x3x2 double as `0.0`, a string as `Class="double" Dimension="1*1">a`. The containers are
     * written by the property writers' own code, under `<Element>` where a property has `<P
     * Name="…">`, so the two sites cannot disagree on a spelling.
     */
    static _serializeCellElementXml(elem, indent, at) {
        const p = xmlPad(indent);
        if (typeof elem === 'number') {
            return p + '<Element Class="double">' + formatDoubleXml(elem) + '</Element>';
        }
        if (typeof elem === 'boolean') {
            return p + '<Element Class="logical">' + (elem ? '1' : '0') + '</Element>';
        }
        if (typeof elem === 'string') {
            const codes = decimalCharXml(elem, [1, elem.length]);
            if (codes) {
                return p + '<Element Class="char"' + codes.attrs + '>' + codes.body + '</Element>';
            }
            return p + '<Element Class="char">' + escapeXml(elem) + '</Element>';
        }
        if (Array.isArray(elem)) {
            if (elem.length === 0) {
                return p + '<Element Class="double" Dimension="0*0"/>';
            }
            // A bare list of text is a string, here as for a property (serializePropertyXml): it
            // is how parseStringValue hands back a 1x1 string, so the numeric arm below wrote
            // cellstr_binary.sldd's cStr as `<Element Class="double" Dimension="1*1">a</Element>`.
            if (elem.every((v) => typeof v === 'string')) {
                return DataNode._stringXml('Element', '', elem, [1, elem.length], indent);
            }
            const formatted = elem.map(function (v) {
                return formatDoubleXml(v);
            });
            return p + '<Element Class="double" Dimension="1*' + elem.length + '">' + formatted.join(' ') + '</Element>';
        }
        if (isEncodedValue(elem)) {
            return encodedXml('Element', '', elem, indent);
        }
        if (typeof elem === 'object' && elem !== null && elem._type) {
            const obj = elem;
            const type = obj._type;
            const raw = String(obj._value);
            // The property writer's two cdata cases, for the same reasons: a MAT byte stream is
            // written by the node it reads back as, and complex text as itself.
            if (type === 'cdata') {
                if (isMatCdata(obj)) {
                    return DataNode._detachedXml(obj, '', 'Element', {}, indent, at);
                }
                DataNode._sizeOrRefuse(obj._dimensions, complexClassTag(obj._class) ?? 'double', '', at);
                return DataNode._complexTextXml('Element', '', obj, indent);
            }
            // And its sparse case, for its reason: never `Class="sparse"`.
            if (type === 'sparse') {
                return DataNode._detachedXml(obj, '', 'Element', {}, indent, at);
            }
            if (type === 'mxchar') {
                DataNode._sizeOrRefuse(DataNode._headerDims(raw), 'char', '', at, raw);
            }
            const mxChar = DataNode._mxCharXml(obj);
            if (mxChar) {
                return p + '<Element Class="char"' + mxChar.attrs + (mxChar.body === '' ? '/>' : '>' + mxChar.body + '</Element>');
            }
            const matrix = DataNode._matrixLiteralXml('Element', '', '', type, raw, indent, at);
            if (matrix !== null) {
                return matrix;
            }
            // A typed `[]`: parseCellElement's 0x0 logical, and a text dictionary's 0x0 of any class.
            // Every other empty the binary reader reads carries its extents in a `Matrix(…)` header,
            // which the arm above writes.
            if (raw === '[]') {
                return p + '<Element Class="' + escapeXml(type) + '" Dimension="0*0"/>';
            }
            const vecMatch = raw.match(/^\[(.+)\]$/);
            if (vecMatch) {
                const parts = vecMatch[1].split(',').map(function (s) {
                    return DataNode._numToken(s, type);
                });
                return (p +
                    '<Element Class="' +
                    escapeXml(type) +
                    '" Dimension="1*' +
                    parts.length +
                    '">' +
                    parts
                        .map(function (v) {
                        return formatNumericXml(v, type);
                    })
                        .join(' ') +
                    '</Element>');
            }
            const num = DataNode._numToken(raw, type);
            return p + '<Element Class="' + escapeXml(type) + '">' + formatNumericXml(num, type) + '</Element>';
        }
        if (typeof elem === 'object' && elem !== null) {
            const obj = elem;
            if (obj._array_class) {
                return DataNode._objectXml('Element', '', '', obj, indent, null, at);
            }
            if (obj._object_class) {
                // Its saveobj envelope carried as serializePropertyXml carries it, and for the same reason.
                const element = { _properties: obj._properties || {} };
                const envelope = customSaveOf(obj);
                if (envelope !== undefined)
                    element[CUSTOM_SAVE_KEY] = envelope;
                const wrapped = {
                    _array_class: obj._object_class,
                    _dimensions: [1, 1],
                    _elements: [element],
                };
                return DataNode._objectXml('Element', '', '', wrapped, indent, null, at);
            }
            if (obj._array_type === 'Struct') {
                return DataNode._structXml('Element', '', '', obj, indent, at);
            }
            if (obj._array_type === 'Cell') {
                return DataNode._cellXml('Element', '', '', obj, indent, at);
            }
            if (obj._array_type === 'String') {
                const elements = obj._elements || [];
                DataNode._sizeOrRefuse(obj._dimensions, 'string', '', at);
                return DataNode._stringXml('Element', '', elements, obj._dimensions || [1, elements.length], indent);
            }
        }
        return p + '<Element Class="char">' + escapeXml(String(elem)) + '</Element>';
    }
    /**
     * One number out of a typed literal: '3.14159274F', '18446744073709551615U', '-1'.
     *
     * A 64-bit integer comes back as exact decimal TEXT rather than a number, because
     * every value MATLAB's int64/uint64 range holds past 2^53 is one a double does not
     * (XmlUtils.parseExactNum). This routine is the single re-parse point of the XML write
     * path, and it used to be `parseMatlabNum` at four separate call sites: a uint64 read
     * losslessly by BinarySlddParser was still rounded here, one step before the file, so
     * maxU64 went out as 18446744073709552000U — a token now OUT of uint64 range, at which
     * MATLAB's reader abandons the rest of the body and zeroes the value's remaining
     * elements (defects 29 and 30).
     */
    static _numToken(text, type) {
        const bare = text.replace(/[FU]$/, '');
        return needsExactInt(type) ? parseExactNum(bare) : parseMatlabNum(bare);
    }
    // Flatten the body of a Matrix(r,c) literal to row-major numbers. Rows are
    // separated by ';' or by a newline depending on which writer produced the
    // literal — BinarySlddParser joins with '; ', while MatlabVariableNode,
    // McosParser, and ParameterNode join with '\n'. Splitting on only one of the
    // two silently merges every row into one, dropping an element per row break
    // and shifting the rest, so both have to be accepted here.
    //
    // `type` selects the exactness of each token (_numToken); it defaults to double, so
    // the char-code caller — whose codes are all far inside a double — reads plain numbers.
    static _parseMatrixNums(body, type = 'double') {
        const cleaned = body.replace(/^\[/, '').replace(/\]$/, '');
        const nums = [];
        for (const row of cleaned.split(/[;\n]/)) {
            const inner = row.trim().replace(/^\[/, '').replace(/\]$/, '');
            if (inner === '') {
                continue;
            }
            for (const part of inner.split(',')) {
                nums.push(DataNode._numToken(part, type));
            }
        }
        return nums;
    }
}
//# sourceMappingURL=DataNode.js.map