// Copyright 2026 The MathWorks, Inc.
import BaseNode from './BaseNode.js';
import { trySetSchemaProperty } from './schemaBridge.js';
import { KIND_BY_CLASS, DERIVED_KIND_BY_CLASS, KIND_BY_CLASSIFICATION } from '../kindMap.js';
import { escapeXml, formatDoubleXml, formatNumericXml, formatComplexXml, parseMatlabNum, transposeToColumnMajorND, matlabTimestampNow, pad as xmlPad, } from '../parser/XmlUtils.js';
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
    get kind() {
        if (this.classification) {
            return KIND_BY_CLASSIFICATION[this.classification] || this.classification;
        }
        const cls = this.className;
        // A derived (architectural) entry the catalog didn't classify — e.g. a freshly
        // pasted one, whose new name isn't in the SystemComposer catalog — takes the
        // arch default Kind for its Class (a derived Simulink.Bus is a Data Interface).
        if (this.isDerived && DERIVED_KIND_BY_CLASS[cls]) {
            return DERIVED_KIND_BY_CLASS[cls];
        }
        return KIND_BY_CLASS[cls] || cls;
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
    // nameEditable is inherited from BaseNode: the three things that fix a name — a
    // synthetic positional index, a `_displayName` alias, and an object-property-bag
    // parent — are all structural, so the base rule already covers every data node.
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
    setProperty(propName, stringValue) {
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
            this._markModified();
            return true;
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
    _markModified() {
        let node = this;
        while (node && !node.isEntry) {
            if (node._rawInput !== undefined) {
                node._rawInput = undefined;
            }
            node = node.parent;
        }
        if (node) {
            node.status = 'Modified';
            if (node._rawInput !== undefined) {
                node._rawInput = undefined;
            }
            node._stampLastModified();
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
        if (this.isEntry) {
            return {
                name: this.name,
                metadata: this.metadata,
                value: this.serializeValue(),
            };
        }
        return this.serializeValue();
    }
    _serializeSimulinkObject(propOverrides) {
        const props = Object.assign({}, this.serial._properties, propOverrides);
        const result = Object.assign({}, this.serial._rawVal);
        const rawElements = result._elements || [];
        result._elements = [Object.assign({}, rawElements[0], { _properties: props })];
        return result;
    }
    serializeValue() {
        return null;
    }
    serializeXml(tagName, attrs, indent) {
        if (this.serial && this.serial._rawVal && this.serial._rawVal._array_class) {
            return this._serializeSimulinkObjectXml(tagName, attrs, indent);
        }
        return xmlPad(indent) + '<' + tagName + '/>';
    }
    _serializeSimulinkObjectXml(tagName, attrs, indent) {
        const p = xmlPad(indent);
        const ip = xmlPad(indent + 1);
        const rawVal = this.serial._rawVal;
        const className = rawVal._array_class;
        const props = this._getSerializedProperties();
        let attrStr = '';
        if (attrs && attrs.Name) {
            attrStr += ' Name="' + escapeXml(attrs.Name) + '"';
        }
        let xml = p + '<' + tagName + attrStr + '>\n';
        xml += ip + '<Element Class="' + escapeXml(className) + '">\n';
        for (const [propName, propVal] of Object.entries(props)) {
            xml += DataNode.serializePropertyXml(propName, propVal, indent + 2, this) + '\n';
        }
        xml += ip + '</Element>\n';
        xml += p + '</' + tagName + '>';
        return xml;
    }
    _getSerializedProperties() {
        return Object.assign({}, this.serial._properties);
    }
    static serializePropertyXml(name, value, indent, ownerNode) {
        const p = xmlPad(indent);
        if (value === null || value === undefined) {
            return p + '<P Name="' + escapeXml(name) + '" Class="char"/>';
        }
        if (typeof value === 'number') {
            return p + '<P Name="' + escapeXml(name) + '" Class="double">' + formatDoubleXml(value) + '</P>';
        }
        if (typeof value === 'boolean') {
            return p + '<P Name="' + escapeXml(name) + '" Class="logical">' + (value ? '1' : '0') + '</P>';
        }
        if (typeof value === 'string') {
            if (value === '') {
                return p + '<P Name="' + escapeXml(name) + '" Class="char"/>';
            }
            return p + '<P Name="' + escapeXml(name) + '" Class="char">' + escapeXml(value) + '</P>';
        }
        if (Array.isArray(value)) {
            if (value.length === 0) {
                return p + '<P Name="' + escapeXml(name) + '" Class="double" Dimension="0*0"/>';
            }
            const formatted = value.map(function (v) {
                return formatDoubleXml(v);
            });
            return (p +
                '<P Name="' +
                escapeXml(name) +
                '" Class="double" Dimension="1*' +
                value.length +
                '">' +
                formatted.join(' ') +
                '</P>');
        }
        if (typeof value === 'object') {
            const obj = value;
            if (obj._type && obj._value !== undefined) {
                return DataNode._serializeTypedPropertyXml(name, obj, indent);
            }
            if (obj._array_class) {
                return DataNode._serializeObjectPropertyXml(name, obj, indent, ownerNode);
            }
            if (obj._object_class) {
                const wrapped = {
                    _array_class: obj._object_class,
                    _dimensions: [1, 1],
                    _elements: [{ _properties: obj._properties || {} }],
                };
                return DataNode._serializeObjectPropertyXml(name, wrapped, indent, ownerNode);
            }
            if (obj._array_type === 'Struct') {
                return DataNode._serializeStructPropertyXml(name, obj, indent);
            }
            if (obj._array_type === 'Cell') {
                return DataNode._serializeCellPropertyXml(name, obj, indent);
            }
        }
        return p + '<P Name="' + escapeXml(name) + '" Class="char">' + escapeXml(String(value)) + '</P>';
    }
    static _serializeTypedPropertyXml(name, value, indent) {
        const p = xmlPad(indent);
        const type = value._type;
        const raw = String(value._value);
        if (type === 'cdata') {
            const formatted = formatComplexXml(raw);
            return p + '<P Name="' + escapeXml(name) + '" Class="double" IsComplex="1">' + formatted + '</P>';
        }
        // Rank 3 and up spells its header Matrix(2,3,2) — MATLAB's own binary
        // dictionary writes such an entry as Dimension="2*3*2" with a flat
        // column-major body, so every extent has to survive the round trip. The
        // two-group form was the only one matched, so an N-D literal fell through to
        // the scalar branch below and was written out as the single number 0.
        const matrixMatch = raw.match(/^Matrix\((\d+(?:,\d+)*)\)\n(.+)$/s);
        if (matrixMatch) {
            const dims = matrixMatch[1].split(',').map(function (s) {
                return parseInt(s, 10);
            });
            const nums = DataNode._parseMatrixNums(matrixMatch[2]);
            const colMajor = transposeToColumnMajorND(nums, dims);
            const formatted = colMajor.map(function (v) {
                return formatNumericXml(v, type);
            });
            return (p +
                '<P Name="' +
                escapeXml(name) +
                '" Class="' +
                type +
                '" Dimension="' +
                dims.join('*') +
                '">' +
                formatted.join(' ') +
                '</P>');
        }
        const vecMatch = raw.match(/^\[(.+)\]$/);
        if (vecMatch) {
            const parts = vecMatch[1].split(',').map(function (s) {
                return parseMatlabNum(s.replace(/[FU]$/, ''));
            });
            const formatted = parts.map(function (v) {
                return formatNumericXml(v, type);
            });
            return (p +
                '<P Name="' +
                escapeXml(name) +
                '" Class="' +
                type +
                '" Dimension="1*' +
                parts.length +
                '">' +
                formatted.join(' ') +
                '</P>');
        }
        const num = parseMatlabNum(raw.replace(/[FU]$/, ''));
        return p + '<P Name="' + escapeXml(name) + '" Class="' + type + '">' + formatNumericXml(num, type) + '</P>';
    }
    static _serializeObjectPropertyXml(name, value, indent, ownerNode) {
        const p = xmlPad(indent);
        const ip = xmlPad(indent + 1);
        const className = value._array_class;
        const dims = value._dimensions || [1, 1];
        const elements = value._elements || [];
        if (elements.length === 0 ||
            (elements.length === 1 &&
                (!elements[0]._properties || Object.keys(elements[0]._properties).length === 0))) {
            return (p +
                '<P Name="' +
                escapeXml(name) +
                '">\n' +
                ip +
                '<Element Class="' +
                escapeXml(className) +
                '"/>\n' +
                p +
                '</P>');
        }
        const dimAttr = dims[0] === 1 && dims[1] === 1 && elements.length === 1 ? '' : ' Dimension="' + dims[0] + '*' + dims[1] + '"';
        let xml = p + '<P Name="' + escapeXml(name) + '"' + dimAttr + '>\n';
        for (const elem of elements) {
            const props = elem._properties || {};
            xml += ip + '<Element Class="' + escapeXml(className) + '">\n';
            for (const [propName, propVal] of Object.entries(props)) {
                xml += DataNode.serializePropertyXml(propName, propVal, indent + 2, ownerNode) + '\n';
            }
            xml += ip + '</Element>\n';
        }
        xml += p + '</P>';
        return xml;
    }
    static _serializeStructPropertyXml(name, value, indent) {
        const p = xmlPad(indent);
        const ip = xmlPad(indent + 1);
        const dims = value._dimensions || [1, 1];
        const elements = value._elements || [];
        // Every extent, not the first two: MATLAB's own binary dictionary writes
        // `Class="struct" Dimension="2*3*2"` for a 2x3x2 struct array, and twelve
        // <Element>s under a `2*3` would read back as a six-element array.
        const dimAttr = dims.length <= 2 && dims[0] === 1 && dims[1] === 1 ? '' : ' Dimension="' + dims.join('*') + '"';
        let xml = p + '<P Name="' + escapeXml(name) + '" Class="struct"' + dimAttr + '>\n';
        for (const elem of elements) {
            xml += ip + '<Element>\n';
            for (const [field, fieldVal] of Object.entries(elem)) {
                xml += DataNode.serializePropertyXml(field, fieldVal, indent + 2, null) + '\n';
            }
            xml += ip + '</Element>\n';
        }
        xml += p + '</P>';
        return xml;
    }
    static _serializeCellPropertyXml(name, value, indent) {
        const p = xmlPad(indent);
        const dims = value._dimensions || [1, 1];
        const elements = value._elements || [];
        let xml = p + '<P Name="' + escapeXml(name) + '" Class="cell" Dimension="' + dims.join('*') + '">\n';
        for (const elem of elements) {
            xml += DataNode._serializeCellElementXml(elem, indent + 1) + '\n';
        }
        xml += p + '</P>';
        return xml;
    }
    static _serializeCellElementXml(elem, indent) {
        const p = xmlPad(indent);
        if (typeof elem === 'number') {
            return p + '<Element Class="double">' + formatDoubleXml(elem) + '</Element>';
        }
        if (typeof elem === 'boolean') {
            return p + '<Element Class="logical">' + (elem ? '1' : '0') + '</Element>';
        }
        if (typeof elem === 'string') {
            return p + '<Element Class="char">' + escapeXml(elem) + '</Element>';
        }
        if (Array.isArray(elem)) {
            if (elem.length === 0) {
                return p + '<Element Class="double" Dimension="0*0"/>';
            }
            const formatted = elem.map(function (v) {
                return formatDoubleXml(v);
            });
            return p + '<Element Class="double" Dimension="1*' + elem.length + '">' + formatted.join(' ') + '</Element>';
        }
        if (typeof elem === 'object' && elem !== null && elem._type) {
            const obj = elem;
            const type = obj._type;
            const raw = String(obj._value);
            const vecMatch = raw.match(/^\[(.+)\]$/);
            if (vecMatch) {
                const parts = vecMatch[1].split(',').map(function (s) {
                    return parseMatlabNum(s.replace(/[FU]$/, ''));
                });
                return (p +
                    '<Element Class="' +
                    type +
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
            const num = parseMatlabNum(raw.replace(/[FU]$/, ''));
            return p + '<Element Class="' + type + '">' + formatNumericXml(num, type) + '</Element>';
        }
        return p + '<Element Class="char">' + escapeXml(String(elem)) + '</Element>';
    }
    // Flatten the body of a Matrix(r,c) literal to row-major numbers. Rows are
    // separated by ';' or by a newline depending on which writer produced the
    // literal — BinarySlddParser joins with '; ', while MatlabVariableNode,
    // McosParser, and ParameterNode join with '\n'. Splitting on only one of the
    // two silently merges every row into one, dropping an element per row break
    // and shifting the rest, so both have to be accepted here.
    static _parseMatrixNums(body) {
        const cleaned = body.replace(/^\[/, '').replace(/\]$/, '');
        const nums = [];
        for (const row of cleaned.split(/[;\n]/)) {
            const inner = row.trim().replace(/^\[/, '').replace(/\]$/, '');
            if (inner === '') {
                continue;
            }
            for (const part of inner.split(',')) {
                nums.push(parseMatlabNum(part.replace(/[FU]$/, '')));
            }
        }
        return nums;
    }
}
//# sourceMappingURL=DataNode.js.map