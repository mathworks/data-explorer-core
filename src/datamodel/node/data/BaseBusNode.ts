// Copyright 2026 The MathWorks, Inc.

import DataNode from '../DataNode.js';
import type { SetPropertyResult } from '../DataNode.js';
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import { sourceNewChildProperties } from '../BaseNode.js';
import { addChildUndoable, removeChildUndoable } from '../childEdit.js';
import type { ChildAddEdit, ChildUndoRedo } from '../childEdit.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
import PropKind from '../../prop/PropKind.js';
import PropClassAtom from '../../prop/PropClass.js';
import { emptyHeaderDims } from '../../parser/XmlUtils.js';
import { isElement, reportNotAList, reportNotElements } from './notAnElement.js';
import { elementOriginAt, originOf, recordElementOrigins, recordOrigin, taggingOrigins } from '../../parser/EntrySource.js';

// An empty as the binary reader holds one: a class under the bare `Matrix(…)` header of a size
// with a 0 in it (BinarySlddParser.emptyOf).
function isTypedEmpty(v: unknown): boolean {
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return false;
    }
    const o = v as Record<string, unknown>;
    return typeof o._type === 'string' && emptyHeaderDims(o._value) !== null;
}

// An Elements_internal read in the form MATLAB's text dictionary gives a bus of one element, the
// element itself, `{_id, _object_class, _properties}` (BaseBusNode._parseElements's last arm).
function isElementForm(read: Record<string, unknown>): boolean {
    return read._elements === undefined && '_object_class' in read && !!read._properties;
}

// An element in that form: as it is where it carries its class, and otherwise (one added here) with
// the array's, where MATLAB puts it, after its _id.
function inElementForm(element: Record<string, unknown>, arrayClass: string): Record<string, unknown> {
    if ('_object_class' in element) {
        return element;
    }
    const { _id, ...rest } = element;
    return _id === undefined ? { _object_class: arrayClass, ...rest } : { _id, _object_class: arrayClass, ...rest };
}

// An element of the array, without the `_object_class` the element's form gave it where that is the
// array's class, as MATLAB writes it there.
function withoutArrayClass(element: Record<string, unknown>, arrayClass: string): Record<string, unknown> {
    if (element._object_class !== arrayClass) {
        return element;
    }
    const { _object_class: _own, ...rest } = element;
    return rest;
}

// Clone a Prop* atom with an expanded `sourceKeys`, preserving its static methods
// (readValue/format) via the prototype chain — an object spread would drop them.
// Bus/connection elements read some props through `*_internal` aliased raw keys
// (DataType_internal, Min_internal, …); listing both spellings lets the PI
// "Other" catch-all treat the alias the node actually carries as already shown,
// without teaching the shared atom about element-specific key conventions.
export function withSourceKeys(atom: PropClass, sourceKeys: string[]): PropClass {
    const clone = Object.create(atom) as PropClass;
    clone.sourceKeys = sourceKeys;
    return clone;
}

export class BaseBusElementNode extends DataNode {
    Description: string;

    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) {
        super(name, parent, serial);
        this.Description = (props.Description as string) || '';
    }

    get icon(): string { return 'typeBusElement'; }
    get displayValue(): string { return ''; }
    get disabled(): boolean { return true; }
    // An element has no Value: a Simulink.BusElement, Simulink.ConnectionElement or
    // Simulink.FunctionElement carries none (see their .md files), and no element property
    // maps to the Value column. So the cell takes no editor, as the bus's own does
    // (BaseBusNode), though what it shows, blank or a function element's Prototype, is
    // text that BaseNode.valueEditable would otherwise offer one for.
    get valueEditable(): boolean { return false; }

    // And a Value set on one is refused rather than taken, as an object's is
    // (ObjectNode.setProperty): DataNode's generic tail kept the text on a field nothing
    // writes, marked the bus Modified, pushed an undo step and answered `true`, and the save
    // dropped it. One still in the encoded stream it was read from keeps that refusal's own
    // reason. Every subclass's setProperty reaches this one for a Value.
    setProperty(propName: string, stringValue: string): true | SetPropertyResult {
        if (this._resolveProperty(propName) === 'Value') {
            return (
                this._refuseEncodedEdit(propName, stringValue) ?? {
                    error: true,
                    reason: `'${this.displayName}' is a ${this.className}, which has no Value, so none can be set on it.`,
                    invalidValue: stringValue,
                    validValue: this.displayValue,
                }
            );
        }
        return super.setProperty(propName, stringValue);
    }

    serializeValue(): unknown {
        const props = { ...(this.serial._properties as Record<string, unknown>) };
        props.Name = this.name;
        this._applyElementOverrides(props);
        return { ...(this.serial._rawElem as Record<string, unknown>), _properties: props };
    }

    _applyElementOverrides(props: Record<string, unknown>): void {
        if ('Description' in (this.serial._properties as Record<string, unknown>) || this.Description) { props.Description = this.Description; }
    }
}

export class BaseBusNode extends DataNode {
    Description: string;

    constructor(name: string, parent: BaseNode | null, serial: Record<string, unknown>) {
        super(name, parent, serial);
        this.Description = '';
    }

    get icon(): string { return this.isDerived ? 'typeBus' : 'wsBus'; }
    get displayValue(): string { return ''; }
    get valueEditable(): boolean { return false; }

    // A bus whose properties are held beside its class is shown as read, and takes an edit of its
    // name alone, which the save writes back as read (DataNode._inlineObjectBag, _refuseInlineBagEdit).
    get descriptionEditable(): boolean { return !this._inlineObjectBag() && super.descriptionEditable; }
    setProperty(propName: string, stringValue: string): true | SetPropertyResult {
        if (this._isUnchangedCommit(propName, stringValue)) {
            return true;
        }
        return this._refuseInlineBagEdit(propName, stringValue) ?? super.setProperty(propName, stringValue);
    }

    getProperties(): PropClass[] { return [PropName, PropDataType, PropDescription]; }
    // PI layout is schema-driven (schema/classes/{bus,connectionBus,serviceBus}.json).
    // Each concrete bus container has a schema entry keyed by its className, so the
    // inherited BaseNode.getPILayout → buildPILayout(className) resolves it.

    _getSerializedProperties(): Record<string, unknown> {
        const elementsInternal = this.children.map(function (child) { return (child as BaseBusElementNode).serializeValue(); });
        // Each element's origin in the file, for the save that merges an edited entry (EntrySource).
        if (taggingOrigins()) { recordElementOrigins(elementsInternal, this.children.map(originOf)); }
        const props = { ...(this.serial._properties as Record<string, unknown>) };
        const rawEI = (this.serial._properties as Record<string, unknown>).Elements_internal;
        if (elementsInternal.length > 0) {
            // The source's Elements_internal may be in single-object form
            // (_object_class + _properties) or array form (_array_class + _elements).
            // The array form is written under the class either names, with the live
            // _elements and _dimensions; one read in the single-object form keeps it
            // while the bus holds one element (below).
            const arrayClass = rawEI && typeof rawEI === 'object' && !Array.isArray(rawEI)
                ? ((rawEI as Record<string, unknown>)._array_class as string
                    || (rawEI as Record<string, unknown>)._object_class as string
                    || (this.constructor as typeof BaseBusNode).ELEMENT_CLASS_NAME)
                : (this.constructor as typeof BaseBusNode).ELEMENT_CLASS_NAME;
            // `_mw_element_type` only where the bag read had one. MATLAB omits it from this
            // nested array in a text dictionary (arch.sldd, bus_types_text.sldd), and adding it
            // made a no-op text save differ from the file at every bus with elements; the
            // binary reader's bag carries it, and keeps it. The XML writer does not read it.
            const read = rawEI && typeof rawEI === 'object' && !Array.isArray(rawEI) ? (rawEI as Record<string, unknown>) : null;
            const elementType = read && '_mw_element_type' in read ? { _mw_element_type: read._mw_element_type } : {};
            // MATLAB's text dictionary writes a bus of one element with its Elements_internal as
            // that element, `{_id, _object_class, _properties}` (params.sldd's MyConnBus), and of
            // more as the array above, whose elements carry no `_object_class` of the array's
            // class (B-24, probe_bus_one_element_text.m). One read in the element's form is
            // written back in it while the bus holds one element, so a save that changed nothing
            // is the file (A4); with more, as MATLAB writes the array. One read as the array
            // stays the array.
            const elementForm = read !== null && isElementForm(read);
            if (elementForm && elementsInternal.length === 1) {
                props.Elements_internal = inElementForm(elementsInternal[0] as Record<string, unknown>, arrayClass);
            } else {
                const elements = elementForm ? elementsInternal.map(function (e) { return withoutArrayClass(e as Record<string, unknown>, arrayClass); }) : elementsInternal;
                props.Elements_internal = { _array_class: arrayClass, _dimensions: [elements.length, 1], _elements: elements, ...elementType };
            }
        } else if (isTypedEmpty(rawEI)) {
            // A bus read with no elements: its Elements_internal as the binary reader holds an
            // empty, the element class under the header of its size (BinarySlddParser.emptyOf),
            // kept as read. A binary dictionary writes it back as MATLAB wrote it, `<P
            // Name="Elements_internal" Class="Simulink.BusElement" Dimension="0*0"/>`, and a text
            // dictionary is given `[]`, MATLAB's spelling of an empty object array at a property
            // (MatWriter.heldTextSpelling) and what its own text dictionary holds for an empty
            // bus, which MATLAB reads back as an empty BusElement array (D8-READBACKS M3). It
            // used to be read as '', a char, which every save wrote as `Class="char"`, and once
            // read with its class this arm's `[]` below would have made it a double.
            props.Elements_internal = rawEI;
        } else if (rawEI) {
            // When all children are removed, emit an empty array: `[]` is what MATLAB's text
            // dictionary holds for an empty bus. The XML writes the element class instead
            // (_xmlProperties).
            props.Elements_internal = [];
        }
        if ('Description' in (this.serial._properties as Record<string, unknown>) || this.Description) { props.Description = this.Description; }
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
    _xmlProperties(): Record<string, unknown> {
        const props = super._xmlProperties();
        if (this.children.length === 0 && 'Elements_internal' in props && !isTypedEmpty(props.Elements_internal)) {
            const rawEI = (this.serial._properties as Record<string, unknown>).Elements_internal;
            const bag = rawEI && typeof rawEI === 'object' && !Array.isArray(rawEI) ? (rawEI as Record<string, unknown>) : {};
            const elementClass = (bag._array_class as string) || (bag._object_class as string) || (this.constructor as typeof BaseBusNode).ELEMENT_CLASS_NAME;
            props.Elements_internal = { _array_class: elementClass, _dimensions: [0, 0], _elements: [], _mw_element_type: 'MATLABArray' };
        }
        return props;
    }

    serializeValue(): unknown {
        // Properties held beside the class, with no element to rebuild, are written as they were
        // read (DataNode._inlineObjectBag): `_elements[0]` threw a TypeError here.
        if (this._inlineObjectBag()) {
            return { ...(this.serial._rawVal as Record<string, unknown>) };
        }
        const props = this._getSerializedProperties();
        const result = { ...(this.serial._rawVal as Record<string, unknown>) };
        result._elements = [{ ...((result._elements as unknown[])[0] as Record<string, unknown>), _properties: props }];
        if (taggingOrigins()) { recordElementOrigins(result._elements as unknown[], [elementOriginAt((this.serial._rawVal as Record<string, unknown>)._elements, 0)]); }
        return result;
    }

    // Not inside a value still in its encoded stream (DataNode._encodedReadOnly), nor one whose
    // properties are held beside its class, which the save writes back as read.
    canRemoveChild(): boolean { return !this._encodedReadOnly && !this._inlineObjectBag() && this.children.length > 0; }
    removeChildNode(child: BaseNode): void { this.removeChild(child); this._markModified(); }
    restoreChildNode(child: BaseNode, index: number): void { this.children.splice(index, 0, child); child.parent = this; this._markModified(); }
    canAddChild(): boolean { return !this._encodedReadOnly && !this._inlineObjectBag(); }

    addChildNode(): BaseNode | null {
        const baseName = 'a';
        const existing = new Set(this.children.map(function (c) { return c.name; }));
        let uniqueName = baseName;
        let i = 1;
        while (existing.has(uniqueName)) { uniqueName = baseName + i; i++; }
        // As its source holds a new one (a MAT-file: MATLAB's default element), else its name alone.
        const props = { ...sourceNewChildProperties(this), Name: uniqueName };
        const childSerial = { _rawElem: { _id: this._nextElementId(), _properties: props }, _properties: props };
        const childNode = this._createElementNode(uniqueName, props as Record<string, unknown>, childSerial as Record<string, unknown>);
        if (childNode) { this.addChild(childNode); this._markModified(); }
        return childNode;
    }

    // The highest element _id currently in use within this bus's id namespace.
    // Elements and the bus wrapper share one entry-scoped numbering (bus="1",
    // elements "2", "3", ...). Each child's raw element is walked recursively so
    // nested ids (e.g. a ServiceBus function element's Arguments) are counted too
    // — a new id must clear every id already present, not just the top-level ones.
    _maxElementId(): number {
        let max = 0;
        const consider = function (id: unknown): void {
            const n = typeof id === 'string' ? parseInt(id, 10) : typeof id === 'number' ? id : NaN;
            if (Number.isFinite(n) && n > max) { max = n; }
        };
        const walk = function (o: unknown): void {
            if (o && typeof o === 'object') {
                const rec = o as Record<string, unknown>;
                if ('_id' in rec) { consider(rec._id); }
                Object.keys(rec).forEach(function (k) { walk(rec[k]); });
            }
        };
        const wrapper = ((this.serial._rawVal as Record<string, unknown> | undefined)?._elements as Record<string, unknown>[] | undefined)?.[0];
        if (wrapper) { consider(wrapper._id); }
        this.children.forEach(function (c) { walk((c as BaseBusElementNode).serial._rawElem); });
        return max;
    }

    // Allocate a unique element _id: one past the highest existing id so a new
    // element never collides with the wrapper or a sibling (or a sibling's
    // nested arguments).
    _nextElementId(): string { return String(this._maxElementId() + 1); }

    execAddChild(): ChildAddEdit | null { return addChildUndoable(this); }
    execRemoveChild(child?: BaseNode): ChildUndoRedo | null { return removeChildUndoable(this, child); }

    // Overridden by each concrete bus to mint its own element class. The base
    // returns null, which addChildUndoable reports as a refused add — a bus type
    // that forgot to implement this adds nothing rather than a broken element.
    _createElementNode(_name: string, _props: Record<string, unknown>, _serial: Record<string, unknown>): BaseNode | null { return null; }

    static ELEMENT_CLASS_NAME = '';

    static _parseElements(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null, BusNodeClass: new (name: string, parent: BaseNode | null, serial: Record<string, unknown>) => BaseBusNode, ElementNodeClass: new (name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) => BaseBusElementNode): BaseBusNode {
        const elem = rawVal._elements && (rawVal._elements as unknown[])[0];
        const props = ((elem && (elem as Record<string, unknown>)._properties) || {}) as Record<string, unknown>;
        const serial = { _rawVal: rawVal, _properties: props };
        const node = new BusNodeClass(name, parent, serial as Record<string, unknown>);
        node.Description = (props.Description as string) || '';
        const busElements = props.Elements_internal as Record<string, unknown> | undefined;
        if (busElements && Array.isArray((busElements as Record<string, unknown>)._elements)) {
            ((busElements as Record<string, unknown>)._elements as Record<string, unknown>[]).forEach(function (busElem, index) {
                // An element that is not one (a hand-edited `null`, number or string) gets no
                // row, as one holding no properties gets none below; reported after the loop.
                if (!isElement(busElem)) { return; }
                const childProps = (busElem._properties as Record<string, unknown>) || {};
                const elemName = (childProps.Name as string) || '';
                // Skip phantom elements with empty properties — these arise when a
                // self-closing <Element Class="..."/> round-trips through the binary
                // XML serializer (representing a bus with 0 elements).
                if (!elemName && Object.keys(childProps).length === 0) { return; }
                const childSerial = { _rawElem: busElem, _properties: childProps };
                const childNode = new ElementNodeClass(elemName, node, childProps, childSerial as Record<string, unknown>);
                // Which <Element> of the file it was read from, if it was (EntrySource).
                recordOrigin(childNode, elementOriginAt((busElements as Record<string, unknown>)._elements, index));
                node.addChild(childNode);
            });
            // Said once for the entry, and the value kept as read, so an untouched save writes
            // it back whole; the rows are all an edit writes (C-190).
            if (reportNotElements((busElements as Record<string, unknown>)._elements as unknown[], name, 'bus element', 'bus')) {
                node._keepNullElement(rawVal);
            }
        } else if (busElements && (busElements as Record<string, unknown>)._elements !== undefined) {
            // A list of elements that is not a list (a hand-edited number, string, object or
            // `null`): no row, said once, and the value kept as read (C-190).
            reportNotAList((busElements as Record<string, unknown>)._elements, name, 'bus element', 'bus');
            node._keepNullElement(rawVal);
        } else if (busElements && (busElements as Record<string, unknown>)._properties) {
            const childProps = (busElements as Record<string, unknown>)._properties as Record<string, unknown>;
            const elemName = (childProps.Name as string) || '';
            const childSerial = { _rawElem: busElements, _properties: childProps };
            const childNode = new ElementNodeClass(elemName, node, childProps, childSerial as Record<string, unknown>);
            node.addChild(childNode);
        }
        return node;
    }

    static _createDefaultBus(name: string, parent: BaseNode | null, BusNodeClass: new (name: string, parent: BaseNode | null, serial: Record<string, unknown>) => BaseBusNode, className: string): BaseBusNode {
        let defaultProps: Record<string, unknown>;
        if (className === 'Simulink.Bus') { defaultProps = { DataScope: 'Auto', Description: '', Elements_internal: [], HeaderFile: '', PreserveElementDimensions: false }; }
        else if (className === 'Simulink.ConnectionBus') { defaultProps = { Description: '', Elements_internal: [] }; }
        else if (className === 'Simulink.ServiceBus') { defaultProps = { Description: '', Elements_internal: [] }; }
        else { defaultProps = {}; }
        // Through the shared helper rather than spelled out again here: this was the fourth
        // hand-written copy of MATLAB's scalar-object envelope, and it is how the extra
        // `_array_type: 'MATLABArray'` key outlived its removal from the other three.
        const rawVal = SimulinkObjectNode._defaultRawVal(className, defaultProps);
        // The same object the helper was handed — it documents that aliasing as a contract,
        // because an edit to the node's bag reaches the written bytes through it.
        const props = defaultProps;
        const serial = { _rawVal: rawVal, _properties: props };
        return new BusNodeClass(name, parent, serial as unknown as Record<string, unknown>);
    }
}

export { PropName, PropDataType, PropDescription, PropKind, PropClassAtom };
export default { BaseBusNode, BaseBusElementNode, PropName, PropDataType, PropDescription, PropKind, PropClassAtom };
