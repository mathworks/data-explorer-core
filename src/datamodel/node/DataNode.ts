// Copyright 2026 The MathWorks, Inc.

import BaseNode from './BaseNode.js';
import type { PropClass } from './BaseNode.js';
import type { ChildAddEdit, ChildUndoRedo } from './childEdit.js';
import { trySetSchemaProperty } from './schemaBridge.js';
import NodeRegistry from './NodeRegistry.js';
import { isMatCdata } from '../parser/CdataCodec.js';
import { KIND_BY_CLASS, DERIVED_KIND_BY_CLASS, KIND_BY_CLASSIFICATION } from '../kindMap.js';
import {
  charTextFromCodes,
  escapeXml,
  formatDoubleXml,
  formatNumericXml,
  formatComplexXml,
  parseMatlabNum,
  parseExactNum,
  needsExactInt,
  transposeToColumnMajorND,
  matlabTimestampNow,
  pad as xmlPad,
  SAVEOBJ_KEY,
} from '../parser/XmlUtils.js';

// Format a raw MATLAB timestamp ('YYYYMMDDThhmmss[.ffffff]') as an ISO-like
// display string ('YYYY-MM-DDThh:mm:ssZ'). Mirrors the binary parser's
// formatDate so a text-format and a binary-format entry render identically.
// Values too short to parse (or empty) pass through unchanged.
function formatMatlabTimestamp(raw: string): string {
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

function validateMatlabName(name: string): string | null {
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
function writeIntoSaveobj(envelope: unknown, key: string, val: unknown): unknown {
  if (!envelope || typeof envelope !== 'object') {
    return envelope;
  }
  const env = envelope as Record<string, unknown>;
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
  return Object.assign({}, env, {
    _elements: [Object.assign({}, el as Record<string, unknown>, { [key]: val })],
  });
}

export interface SetPropertyResult {
  error: boolean;
  reason: string;
  invalidValue: string;
  validValue: string;
}

export default class DataNode extends BaseNode {
  metadata: Record<string, unknown> | null;
  serial: Record<string, unknown>;
  status: string;
  Description?: string;
  _rawInput?: unknown;
  rawXml?: string;
  // A semantic classification token (e.g. 'DataInterface', 'StructType') set at
  // parse time for entries the source classifies beyond their Class (currently
  // the systemcomposer catalog). It drives the user-facing Kind (see the `kind`
  // getter). Unclassified entries derive their Kind from the Class alone.
  classification?: string;

  constructor(name: string, parent: BaseNode | null, serial?: Record<string, unknown>) {
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
  get kind(): string {
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
  get dataType(): string {
    return '';
  }

  get isEntry(): boolean {
    return !!(this.parent && (this.parent as unknown as { isContainer?: boolean }).isContainer);
  }

  // isIndexedName is inherited from BaseNode (structural: parent is array/cell/
  // string), as is nameEditable — see the note below.

  get isDerived(): boolean {
    return !!(this.metadata && this.metadata.isderived === '1');
  }

  // The entry's last-modified timestamp, normalized to a single display string
  // across the two parse paths. The text `.sldd` path stores a raw MATLAB
  // timestamp under `lastmod` (also the shape freshly-added entries use); the
  // binary path pre-formats it to ISO under `lastModifiedDate` and keeps the raw
  // string under `_rawLastMod`. We prefer whichever ISO value exists and fall
  // back to formatting the raw one, so both formats render identically. Empty
  // when the entry carries no timestamp (e.g. nested children).
  get lastModified(): string {
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
  get lastModifiedBy(): string {
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

  get disabled(): boolean {
    return !this.isEntry;
  }

  // The prop atom `propName` names — by its own key or by the column it renders
  // into, which is how an edit committed in the 'Value' column reaches the atom
  // that actually owns it (a Variant's Condition/Specification). Undefined when
  // this node has no such prop.
  _propFor(propName: string): PropClass | undefined {
    return this.getProperties().find(
      (prop) => prop.key === propName || (prop as unknown as { column?: string }).column === propName,
    );
  }

  _resolveProperty(propName: string): string {
    const prop = this._propFor(propName);
    if (!prop) {
      return propName;
    }
    return (prop as unknown as { nodeProperty?: string }).nodeProperty || prop.key;
  }

  setProperty(propName: string, stringValue: string): true | SetPropertyResult {
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
        const nsNames = (this.parent as unknown as { _namespaceEntryNames?: () => string[] })._namespaceEntryNames;
        const duplicate =
          typeof nsNames === 'function'
            ? nsNames.call(this.parent).some((n: string) => n !== this.name && n === stringValue)
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
      const renameField = (this.parent as unknown as { _renameField?: (from: string, to: string) => void })
        ?._renameField;
      if (typeof renameField === 'function') {
        renameField.call(this.parent, oldName, stringValue);
      }
      this._markModified();
      return true;
    }
    const self = this as unknown as Record<string, unknown>;
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
    } else if (type === 'boolean') {
      self[resolved] = stringValue === 'true';
    } else {
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
  _setMinMax(propName: 'Min' | 'Max', stringValue: string): true | SetPropertyResult {
    const self = this as unknown as Record<string, unknown>;
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
      const cur = self[propName] as number | undefined;
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
  execAddChild(): ChildAddEdit | null {
    return null;
  }

  execRemoveChild(_child?: BaseNode): ChildUndoRedo | null {
    return null;
  }

  // A child of this node was renamed; keep any name-keyed serial in step. The
  // default is the field list a struct-shaped serial carries, which is all a
  // plain container needs. StructNode overrides it because a struct array shares
  // one field list across every element, so the rename has to reach the matching
  // child of each of them too.
  _renameField(from: string, to: string): void {
    const fields = this.serial?._fields as string[] | undefined;
    if (!fields) {
      return;
    }
    const idx = fields.indexOf(from);
    if (idx >= 0) {
      fields[idx] = to;
    }
  }

  _markModified(): void {
    let node: BaseNode | null = this;
    while (node && !(node as DataNode).isEntry) {
      if ((node as DataNode)._rawInput !== undefined) {
        (node as DataNode)._rawInput = undefined;
      }
      node = node.parent;
    }
    if (node) {
      (node as DataNode).status = 'Modified';
      if ((node as DataNode)._rawInput !== undefined) {
        (node as DataNode)._rawInput = undefined;
      }
      (node as DataNode)._stampLastModified();
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
  _stampLastModified(): void {
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

  serialize(): unknown {
    if (this.isEntry) {
      return {
        name: this.name,
        metadata: this.metadata,
        value: this.serializeValue(),
      };
    }
    return this.serializeValue();
  }

  _serializeSimulinkObject(propOverrides: Record<string, unknown>): unknown {
    const props = this._mergeProps(propOverrides);
    const result = Object.assign({}, this.serial._rawVal as Record<string, unknown>);
    const rawElements = (result._elements as unknown[]) || [];
    result._elements = [Object.assign({}, rawElements[0] as Record<string, unknown>, { _properties: props })];
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
   * So under an envelope an EMPTY override is dropped: it is a default rather than an
   * edit, and the envelope is already the authority on that property.
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
   */
  _mergeProps(propOverrides: Record<string, unknown>): Record<string, unknown> {
    const stored = Object.assign({}, this.serial._properties as Record<string, unknown>);
    if (!(SAVEOBJ_KEY in stored)) {
      return Object.assign(stored, propOverrides);
    }
    let envelope = stored[SAVEOBJ_KEY];
    for (const [key, val] of Object.entries(propOverrides)) {
      if (val === '' || val === null || val === undefined) {
        continue;
      }
      stored[key] = val;
      envelope = writeIntoSaveobj(envelope, key, val);
    }
    stored[SAVEOBJ_KEY] = envelope;
    return stored;
  }

  serializeValue(): unknown {
    return null;
  }

  serializeXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string {
    if (this.serial && this.serial._rawVal && (this.serial._rawVal as Record<string, unknown>)._array_class) {
      return this._serializeSimulinkObjectXml(tagName, attrs, indent);
    }
    return xmlPad(indent) + '<' + tagName + '/>';
  }

  _serializeSimulinkObjectXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string {
    const p = xmlPad(indent);
    const ip = xmlPad(indent + 1);
    const rawVal = this.serial._rawVal as Record<string, unknown>;
    const className = rawVal._array_class as string;
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

  _getSerializedProperties(): Record<string, unknown> {
    return Object.assign({}, this.serial._properties as Record<string, unknown>);
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
  static pxAttrs(name: string): string {
    return name === SAVEOBJ_KEY ? ' Source="saveobj" PropertyType="any"' : ' Name="' + escapeXml(name) + '"';
  }

  static serializePropertyXml(name: string, value: unknown, indent: number, ownerNode: DataNode | null): string {
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
      return p + '<P' + DataNode.pxAttrs(name) + ' Class="char">' + escapeXml(value) + '</P>';
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return p + '<P' + DataNode.pxAttrs(name) + ' Class="double" Dimension="0*0"/>';
      }
      const formatted = value.map(function (v: number) {
        return formatDoubleXml(v);
      });
      return (
        p +
        '<P' +
        DataNode.pxAttrs(name) +
        ' Class="double" Dimension="1*' +
        value.length +
        '">' +
        formatted.join(' ') +
        '</P>'
      );
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
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
   * does not have, holding numbers where its characters were.
   */
  static _mxCharXml(value: Record<string, unknown>): { dimAttr: string; body: string } | null {
    if (value._type !== 'mxchar') {
      return null;
    }
    const m = String(value._value).match(/^Matrix\((\d+(?:,\d+)*)\)\n(.+)$/s);
    if (!m) {
      // No header: nothing to state, and the body is already the text (see
      // MatlabVariableNode.parseMxChar, which reads the same shape back as a row).
      return { dimAttr: '', body: escapeXml(String(value._value)) };
    }
    const dims = m[1].split(',').map(function (s: string) {
      return parseInt(s, 10);
    });
    return {
      dimAttr: ' Dimension="' + dims.join('*') + '"',
      // Number() rather than a cast: _parseMatrixNums is typed for the 64-bit case now,
      // and a char code is never one — mxchar is not an integer class.
      body: escapeXml(charTextFromCodes(DataNode._parseMatrixNums(m[2]).map(Number), dims)),
    };
  }

  static _serializeTypedPropertyXml(name: string, value: Record<string, unknown>, indent: number): string {
    const p = xmlPad(indent);
    const type = value._type as string;
    const raw = String(value._value);

    const mxChar = DataNode._mxCharXml(value);
    if (mxChar) {
      return (
        p + '<P' + DataNode.pxAttrs(name) + ' Class="char"' + mxChar.dimAttr + '>' + mxChar.body + '</P>'
      );
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
        return NodeRegistry.parseValue(value, name, null).serializeXml('P', { Name: name }, indent);
      }
      const formatted = formatComplexXml(raw);
      return p + '<P' + DataNode.pxAttrs(name) + ' Class="double" IsComplex="1">' + formatted + '</P>';
    }

    // Rank 3 and up spells its header Matrix(2,3,2) — MATLAB's own binary
    // dictionary writes such an entry as Dimension="2*3*2" with a flat
    // column-major body, so every extent has to survive the round trip. The
    // two-group form was the only one matched, so an N-D literal fell through to
    // the scalar branch below and was written out as the single number 0.
    const matrixMatch = raw.match(/^Matrix\((\d+(?:,\d+)*)\)\n(.+)$/s);
    if (matrixMatch) {
      const dims = matrixMatch[1].split(',').map(function (s: string) {
        return parseInt(s, 10);
      });
      const nums = DataNode._parseMatrixNums(matrixMatch[2], type);
      const colMajor = transposeToColumnMajorND(nums, dims);
      const formatted = colMajor.map(function (v: number | string) {
        return formatNumericXml(v, type);
      });
      return (
        p +
        '<P' +
        DataNode.pxAttrs(name) +
        ' Class="' +
        type +
        '" Dimension="' +
        dims.join('*') +
        '">' +
        formatted.join(' ') +
        '</P>'
      );
    }

    const vecMatch = raw.match(/^\[(.+)\]$/);
    if (vecMatch) {
      const parts = vecMatch[1].split(',').map(function (s: string) {
        return DataNode._numToken(s, type);
      });
      const formatted = parts.map(function (v: number | string) {
        return formatNumericXml(v, type);
      });
      return (
        p +
        '<P' +
        DataNode.pxAttrs(name) +
        ' Class="' +
        type +
        '" Dimension="1*' +
        parts.length +
        '">' +
        formatted.join(' ') +
        '</P>'
      );
    }

    const num = DataNode._numToken(raw, type);
    return p + '<P' + DataNode.pxAttrs(name) + ' Class="' + type + '">' + formatNumericXml(num, type) + '</P>';
  }

  static _serializeObjectPropertyXml(
    name: string,
    value: Record<string, unknown>,
    indent: number,
    ownerNode: DataNode | null,
  ): string {
    const p = xmlPad(indent);
    const ip = xmlPad(indent + 1);
    const className = value._array_class as string;
    const dims = (value._dimensions as number[]) || [1, 1];
    const elements = (value._elements as Record<string, unknown>[]) || [];

    if (
      elements.length === 0 ||
      (elements.length === 1 &&
        (!elements[0]._properties || Object.keys(elements[0]._properties as object).length === 0))
    ) {
      return (
        p +
        '<P' +
        DataNode.pxAttrs(name) +
        '>\n' +
        ip +
        '<Element Class="' +
        escapeXml(className) +
        '"/>\n' +
        p +
        '</P>'
      );
    }

    // Every extent, exactly as the struct sibling below does and for the same
    // reason — see ObjectNode.serializeXml for why a Dimension= that contradicts
    // the body beneath it is wrong even though MATLAB stores no object array for
    // us to compare against. The 1x1 shortcut has to check rank too: dims[0] === 1
    // && dims[1] === 1 is also true of a 1x1x3, so testing only the first two
    // extents would drop that shape's attribute entirely.
    const dimAttr =
      dims.length <= 2 && dims[0] === 1 && dims[1] === 1 && elements.length === 1
        ? ''
        : ' Dimension="' + dims.join('*') + '"';
    let xml = p + '<P' + DataNode.pxAttrs(name) + dimAttr + '>\n';
    for (const elem of elements) {
      const props = (elem._properties as Record<string, unknown>) || {};
      xml += ip + '<Element Class="' + escapeXml(className) + '">\n';
      for (const [propName, propVal] of Object.entries(props)) {
        xml += DataNode.serializePropertyXml(propName, propVal, indent + 2, ownerNode) + '\n';
      }
      xml += ip + '</Element>\n';
    }
    xml += p + '</P>';
    return xml;
  }

  static _serializeStructPropertyXml(name: string, value: Record<string, unknown>, indent: number): string {
    const p = xmlPad(indent);
    const ip = xmlPad(indent + 1);
    const dims = (value._dimensions as number[]) || [1, 1];
    const elements = (value._elements as Record<string, unknown>[]) || [];
    // Every extent, not the first two: MATLAB's own binary dictionary writes
    // `Class="struct" Dimension="2*3*2"` for a 2x3x2 struct array, and twelve
    // <Element>s under a `2*3` would read back as a six-element array.
    const dimAttr =
      dims.length <= 2 && dims[0] === 1 && dims[1] === 1 ? '' : ' Dimension="' + dims.join('*') + '"';

    let xml = p + '<P' + DataNode.pxAttrs(name) + ' Class="struct"' + dimAttr + '>\n';
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

  static _serializeCellPropertyXml(name: string, value: Record<string, unknown>, indent: number): string {
    const p = xmlPad(indent);
    const dims = (value._dimensions as number[]) || [1, 1];
    const elements = (value._elements as unknown[]) || [];

    let xml = p + '<P' + DataNode.pxAttrs(name) + ' Class="cell" Dimension="' + dims.join('*') + '">\n';
    for (const elem of elements) {
      xml += DataNode._serializeCellElementXml(elem, indent + 1) + '\n';
    }
    xml += p + '</P>';
    return xml;
  }

  static _serializeCellElementXml(elem: unknown, indent: number): string {
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
      const formatted = elem.map(function (v: number) {
        return formatDoubleXml(v);
      });
      return p + '<Element Class="double" Dimension="1*' + elem.length + '">' + formatted.join(' ') + '</Element>';
    }
    if (typeof elem === 'object' && elem !== null && (elem as Record<string, unknown>)._type) {
      const obj = elem as Record<string, unknown>;
      const type = obj._type as string;
      const raw = String(obj._value);
      const mxChar = DataNode._mxCharXml(obj);
      if (mxChar) {
        return p + '<Element Class="char"' + mxChar.dimAttr + '>' + mxChar.body + '</Element>';
      }
      const vecMatch = raw.match(/^\[(.+)\]$/);
      if (vecMatch) {
        const parts = vecMatch[1].split(',').map(function (s: string) {
          return DataNode._numToken(s, type);
        });
        return (
          p +
          '<Element Class="' +
          type +
          '" Dimension="1*' +
          parts.length +
          '">' +
          parts
            .map(function (v: number | string) {
              return formatNumericXml(v, type);
            })
            .join(' ') +
          '</Element>'
        );
      }
      const num = DataNode._numToken(raw, type);
      return p + '<Element Class="' + type + '">' + formatNumericXml(num, type) + '</Element>';
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
  static _numToken(text: string, type: string): number | string {
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
  static _parseMatrixNums(body: string, type: string = 'double'): (number | string)[] {
    const cleaned = body.replace(/^\[/, '').replace(/\]$/, '');
    const nums: (number | string)[] = [];
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
