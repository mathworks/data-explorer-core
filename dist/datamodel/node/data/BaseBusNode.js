// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode.js';
import { addChildUndoable, removeChildUndoable } from '../childEdit.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
import PropKind from '../../prop/PropKind.js';
import PropClassAtom from '../../prop/PropClass.js';
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
    serializeValue() {
        const props = Object.assign({}, this.serial._properties);
        props.Name = this.name;
        this._applyElementOverrides(props);
        return Object.assign({}, this.serial._rawElem, { _properties: props });
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
    getProperties() { return [PropName, PropDataType, PropDescription]; }
    // PI layout is schema-driven (schema/classes/{bus,connectionBus,serviceBus}.json).
    // Each concrete bus container has a schema entry keyed by its className, so the
    // inherited BaseNode.getPILayout → buildPILayout(className) resolves it.
    _getSerializedProperties() {
        const elementsInternal = this.children.map(function (child) { return child.serializeValue(); });
        const props = Object.assign({}, this.serial._properties);
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
            props.Elements_internal = { _array_class: arrayClass, _dimensions: [elementsInternal.length, 1], _elements: elementsInternal, _mw_element_type: 'MATLABArray' };
        }
        else if (rawEI) {
            // When all children are removed, emit an empty array. This matches what
            // MATLAB produces (Elements_internal = []) and ensures the XML serializer
            // omits the property entirely (no phantom self-closing <Element/> tag).
            props.Elements_internal = [];
        }
        if ('Description' in this.serial._properties || this.Description) {
            props.Description = this.Description;
        }
        return props;
    }
    serializeValue() {
        const props = this._getSerializedProperties();
        const result = Object.assign({}, this.serial._rawVal);
        result._elements = [Object.assign({}, result._elements[0], { _properties: props })];
        return result;
    }
    canRemoveChild() { return this.children.length > 0; }
    removeChildNode(child) { this.removeChild(child); this._markModified(); }
    restoreChildNode(child, index) { this.children.splice(index, 0, child); child.parent = this; this._markModified(); }
    canAddChild() { return true; }
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
        const rawVal = { _array_class: className, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: defaultProps }] };
        const props = rawVal._elements[0]._properties;
        const serial = { _rawVal: rawVal, _properties: props };
        return new BusNodeClass(name, parent, serial);
    }
}
export { PropName, PropDataType, PropDescription, PropKind, PropClassAtom };
export default { BaseBusNode, BaseBusElementNode, PropName, PropDataType, PropDescription, PropKind, PropClassAtom };
//# sourceMappingURL=BaseBusNode.js.map