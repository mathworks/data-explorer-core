// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode.js';
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import { addChildUndoable, removeChildUndoable } from '../childEdit.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
import PropKind from '../../prop/PropKind.js';
import PropClassAtom from '../../prop/PropClass.js';
import { emptyHeaderDims } from '../../parser/XmlUtils.js';
// An empty as the binary reader holds one: a class under the bare `Matrix(…)` header of a size
// with a 0 in it (BinarySlddParser.emptyOf).
function isTypedEmpty(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return false;
    }
    const o = v;
    return typeof o._type === 'string' && emptyHeaderDims(o._value) !== null;
}
// Clone a Prop* atom with an expanded `sourceKeys`, preserving its static methods
// (readValue/format) via the prototype chain — an object spread would drop them.
// Bus/connection elements read some props through `*_internal` aliased raw keys
// (DataType_internal, Min_internal, …); listing both spellings lets the PI
// "Other" catch-all treat the alias the node actually carries as already shown,
// without teaching the shared atom about element-specific key conventions.
export function withSourceKeys(atom, sourceKeys) {
    const clone = Object.create(atom);
    clone.sourceKeys = sourceKeys;
    return clone;
}
export class BaseBusElementNode extends DataNode {
    constructor(name, parent, props, serial) {
        super(name, parent, serial);
        this.Description = props.Description || '';
    }
    get icon() { return 'typeBusElement'; }
    get displayValue() { return ''; }
    get disabled() { return true; }
    // An element has no Value: a Simulink.BusElement, Simulink.ConnectionElement or
    // Simulink.FunctionElement carries none (see their .md files), and no element property
    // maps to the Value column. So the cell takes no editor, as the bus's own does
    // (BaseBusNode), though what it shows, blank or a function element's Prototype, is
    // text that BaseNode.valueEditable would otherwise offer one for.
    get valueEditable() { return false; }
    // And a Value set on one is refused rather than taken, as an object's is
    // (ObjectNode.setProperty): DataNode's generic tail kept the text on a field nothing
    // writes, marked the bus Modified, pushed an undo step and answered `true`, and the save
    // dropped it. One still in the encoded stream it was read from keeps that refusal's own
    // reason. Every subclass's setProperty reaches this one for a Value.
    setProperty(propName, stringValue) {
        if (this._resolveProperty(propName) === 'Value') {
            return (this._refuseEncodedEdit(propName, stringValue) ?? {
                error: true,
                reason: `'${this.displayName}' is a ${this.className}, which has no Value, so none can be set on it.`,
                invalidValue: stringValue,
                validValue: this.displayValue,
            });
        }
        return super.setProperty(propName, stringValue);
    }
    serializeValue() {
        const props = { ...this.serial._properties };
        props.Name = this.name;
        this._applyElementOverrides(props);
        return { ...this.serial._rawElem, _properties: props };
    }
    _applyElementOverrides(props) {
        if ('Description' in this.serial._properties || this.Description) {
            props.Description = this.Description;
        }
    }
}
export class BaseBusNode extends DataNode {
    constructor(name, parent, serial) {
        super(name, parent, serial);
        this.Description = '';
    }
    get icon() { return this.isDerived ? 'typeBus' : 'wsBus'; }
    get displayValue() { return ''; }
    get valueEditable() { return false; }
    // A bus whose properties are held beside its class is shown as read, and takes an edit of its
    // name alone, which the save writes back as read (DataNode._inlineObjectBag, _refuseInlineBagEdit).
    get descriptionEditable() { return !this._inlineObjectBag() && super.descriptionEditable; }
    setProperty(propName, stringValue) {
        if (this._isUnchangedCommit(propName, stringValue)) {
            return true;
        }
        return this._refuseInlineBagEdit(propName, stringValue) ?? super.setProperty(propName, stringValue);
    }
    getProperties() { return [PropName, PropDataType, PropDescription]; }
    // PI layout is schema-driven (schema/classes/{bus,connectionBus,serviceBus}.json).
    // Each concrete bus container has a schema entry keyed by its className, so the
    // inherited BaseNode.getPILayout → buildPILayout(className) resolves it.
    _getSerializedProperties() {
        const elementsInternal = this.children.map(function (child) { return child.serializeValue(); });
        const props = { ...this.serial._properties };
        const rawEI = this.serial._properties.Elements_internal;
        if (elementsInternal.length > 0) {
            // The source's Elements_internal may be in single-object form
            // (_object_class + _properties) or array form (_array_class + _elements).
            // Always emit the canonical array form so the serializer uses the correct
            // branch (_array_class) and respects the live _elements and _dimensions.
            const arrayClass = rawEI && typeof rawEI === 'object' && !Array.isArray(rawEI)
                ? (rawEI._array_class
                    || rawEI._object_class
                    || this.constructor.ELEMENT_CLASS_NAME)
                : this.constructor.ELEMENT_CLASS_NAME;
            // `_mw_element_type` only where the bag read had one. MATLAB omits it from this
            // nested array in a text dictionary (arch.sldd, bus_types_text.sldd), and adding it
            // made a no-op text save differ from the file at every bus with elements; the
            // binary reader's bag carries it, and keeps it. The XML writer does not read it.
            const read = rawEI && typeof rawEI === 'object' && !Array.isArray(rawEI) ? rawEI : null;
            const elementType = read && '_mw_element_type' in read ? { _mw_element_type: read._mw_element_type } : {};
            props.Elements_internal = { _array_class: arrayClass, _dimensions: [elementsInternal.length, 1], _elements: elementsInternal, ...elementType };
        }
        else if (isTypedEmpty(rawEI)) {
            // A bus read with no elements: its Elements_internal as the binary reader holds an
            // empty, the element class under the header of its size (BinarySlddParser.emptyOf),
            // kept as read. A binary dictionary writes it back as MATLAB wrote it, `<P
            // Name="Elements_internal" Class="Simulink.BusElement" Dimension="0*0"/>`, and a text
            // dictionary is given what it was given before (MatWriter.heldTextSpelling). It
            // used to be read as '', a char, which every save wrote as `Class="char"`, and once
            // read with its class this arm's `[]` below would have made it a double.
            props.Elements_internal = rawEI;
        }
        else if (rawEI) {
            // When all children are removed, emit an empty array: `[]` is what MATLAB's text
            // dictionary holds for an empty bus. The XML writes the element class instead
            // (_xmlProperties).
            props.Elements_internal = [];
        }
        if ('Description' in this.serial._properties || this.Description) {
            props.Description = this.Description;
        }
        return props;
    }
    /**
     * The properties as a binary dictionary writes them: a bus with no elements has an
     * Elements_internal that is an empty array of its element class, as MATLAB writes one, `<P
     * Name="Elements_internal" Class="Simulink.BusElement" Dimension="0*0"/>` (every one of the
     * 22,225 empty buses and connection buses in the local corpus), wherever its bag says
     * otherwise: `[]`, which a bus emptied here, added here or pasted from a text dictionary
     * carries, wrote `Class="double" Dimension="0*0"`, and `''` `Class="char"`. One read with its
     * class keeps it.
     */
    _xmlProperties() {
        const props = super._xmlProperties();
        if (this.children.length === 0 && 'Elements_internal' in props && !isTypedEmpty(props.Elements_internal)) {
            const rawEI = this.serial._properties.Elements_internal;
            const bag = rawEI && typeof rawEI === 'object' && !Array.isArray(rawEI) ? rawEI : {};
            const elementClass = bag._array_class || bag._object_class || this.constructor.ELEMENT_CLASS_NAME;
            props.Elements_internal = { _array_class: elementClass, _dimensions: [0, 0], _elements: [], _mw_element_type: 'MATLABArray' };
        }
        return props;
    }
    serializeValue() {
        // Properties held beside the class, with no element to rebuild, are written as they were
        // read (DataNode._inlineObjectBag): `_elements[0]` threw a TypeError here.
        if (this._inlineObjectBag()) {
            return { ...this.serial._rawVal };
        }
        const props = this._getSerializedProperties();
        const result = { ...this.serial._rawVal };
        result._elements = [{ ...result._elements[0], _properties: props }];
        return result;
    }
    // Not inside a value still in its encoded stream (DataNode._encodedReadOnly), nor one whose
    // properties are held beside its class, which the save writes back as read.
    canRemoveChild() { return !this._encodedReadOnly && !this._inlineObjectBag() && this.children.length > 0; }
    removeChildNode(child) { this.removeChild(child); this._markModified(); }
    restoreChildNode(child, index) { this.children.splice(index, 0, child); child.parent = this; this._markModified(); }
    canAddChild() { return !this._encodedReadOnly && !this._inlineObjectBag(); }
    addChildNode() {
        const baseName = 'a';
        const existing = new Set(this.children.map(function (c) { return c.name; }));
        let uniqueName = baseName;
        let i = 1;
        while (existing.has(uniqueName)) {
            uniqueName = baseName + i;
            i++;
        }
        const props = { Name: uniqueName };
        const childSerial = { _rawElem: { _id: this._nextElementId(), _properties: props }, _properties: props };
        const childNode = this._createElementNode(uniqueName, props, childSerial);
        if (childNode) {
            this.addChild(childNode);
            this._markModified();
        }
        return childNode;
    }
    // The highest element _id currently in use within this bus's id namespace.
    // Elements and the bus wrapper share one entry-scoped numbering (bus="1",
    // elements "2", "3", ...). Each child's raw element is walked recursively so
    // nested ids (e.g. a ServiceBus function element's Arguments) are counted too
    // — a new id must clear every id already present, not just the top-level ones.
    _maxElementId() {
        let max = 0;
        const consider = function (id) {
            const n = typeof id === 'string' ? parseInt(id, 10) : typeof id === 'number' ? id : NaN;
            if (Number.isFinite(n) && n > max) {
                max = n;
            }
        };
        const walk = function (o) {
            if (o && typeof o === 'object') {
                const rec = o;
                if ('_id' in rec) {
                    consider(rec._id);
                }
                Object.keys(rec).forEach(function (k) { walk(rec[k]); });
            }
        };
        const wrapper = this.serial._rawVal?._elements?.[0];
        if (wrapper) {
            consider(wrapper._id);
        }
        this.children.forEach(function (c) { walk(c.serial._rawElem); });
        return max;
    }
    // Allocate a unique element _id: one past the highest existing id so a new
    // element never collides with the wrapper or a sibling (or a sibling's
    // nested arguments).
    _nextElementId() { return String(this._maxElementId() + 1); }
    execAddChild() { return addChildUndoable(this); }
    execRemoveChild(child) { return removeChildUndoable(this, child); }
    // Overridden by each concrete bus to mint its own element class. The base
    // returns null, which addChildUndoable reports as a refused add — a bus type
    // that forgot to implement this adds nothing rather than a broken element.
    _createElementNode(_name, _props, _serial) { return null; }
    static { this.ELEMENT_CLASS_NAME = ''; }
    static _parseElements(rawVal, name, parent, BusNodeClass, ElementNodeClass) {
        const elem = rawVal._elements && rawVal._elements[0];
        const props = ((elem && elem._properties) || {});
        const serial = { _rawVal: rawVal, _properties: props };
        const node = new BusNodeClass(name, parent, serial);
        node.Description = props.Description || '';
        const busElements = props.Elements_internal;
        if (busElements && busElements._elements) {
            busElements._elements.forEach(function (busElem) {
                const childProps = busElem._properties || {};
                const elemName = childProps.Name || '';
                // Skip phantom elements with empty properties — these arise when a
                // self-closing <Element Class="..."/> round-trips through the binary
                // XML serializer (representing a bus with 0 elements).
                if (!elemName && Object.keys(childProps).length === 0) {
                    return;
                }
                const childSerial = { _rawElem: busElem, _properties: childProps };
                const childNode = new ElementNodeClass(elemName, node, childProps, childSerial);
                node.addChild(childNode);
            });
        }
        else if (busElements && busElements._properties) {
            const childProps = busElements._properties;
            const elemName = childProps.Name || '';
            const childSerial = { _rawElem: busElements, _properties: childProps };
            const childNode = new ElementNodeClass(elemName, node, childProps, childSerial);
            node.addChild(childNode);
        }
        return node;
    }
    static _createDefaultBus(name, parent, BusNodeClass, className) {
        let defaultProps;
        if (className === 'Simulink.Bus') {
            defaultProps = { DataScope: 'Auto', Description: '', Elements_internal: [], HeaderFile: '', PreserveElementDimensions: false };
        }
        else if (className === 'Simulink.ConnectionBus') {
            defaultProps = { Description: '', Elements_internal: [] };
        }
        else if (className === 'Simulink.ServiceBus') {
            defaultProps = { Description: '', Elements_internal: [] };
        }
        else {
            defaultProps = {};
        }
        // Through the shared helper rather than spelled out again here: this was the fourth
        // hand-written copy of MATLAB's scalar-object envelope, and it is how the extra
        // `_array_type: 'MATLABArray'` key outlived its removal from the other three.
        const rawVal = SimulinkObjectNode._defaultRawVal(className, defaultProps);
        // The same object the helper was handed — it documents that aliasing as a contract,
        // because an edit to the node's bag reaches the written bytes through it.
        const props = defaultProps;
        const serial = { _rawVal: rawVal, _properties: props };
        return new BusNodeClass(name, parent, serial);
    }
}
export { PropName, PropDataType, PropDescription, PropKind, PropClassAtom };
export default { BaseBusNode, BaseBusElementNode, PropName, PropDataType, PropDescription, PropKind, PropClassAtom };
//# sourceMappingURL=BaseBusNode.js.map