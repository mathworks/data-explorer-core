// Copyright 2026 The MathWorks, Inc.
import DataNode, { customSaveOf, elementClassOf, isFieldBag, objectValueClassOf } from '../DataNode.js';
import * as NodeRegistry from '../NodeRegistry.js';
import PropName from '../../prop/PropName.js';
import PropValue from '../../prop/PropValue.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
import PropKind from '../../prop/PropKind.js';
import PropClassAtom from '../../prop/PropClass.js';
import { OBJECT_ICON } from '../icons.js';
import { ENUM_KEY, enumeralOf, escapeXml, isEnumBag, pad as xmlPad, SAVEOBJ_KEY } from '../../parser/XmlUtils.js';
import { effectiveDims, elementCount, summaryForm } from '../../display/DisplayConvention.js';
import { oneWrite, writeUnderWay } from '../../parser/MatWriter.js';
import { setOwn } from '../../parser/ownKeys.js';
// The class of `child`, one of the element nodes of an object array of class `arrayClass`: the
// class ObjectNode.parse built it as, which its value's wrapper names, and otherwise the array's.
function elementNodeClass(child, arrayClass) {
    const raw = child.serial?._rawVal;
    const own = raw && typeof raw === 'object' ? raw._array_class : undefined;
    return typeof own === 'string' && own !== '' ? own : arrayClass;
}
// One element of an object array as its own node is handed it (ObjectNode.parse): every key it
// was read with but `_object_class`, which is the class of the node's wrapper instead. An element
// that is not an object at all, which only a hand-edited text dictionary holds, holds no
// properties, as it always did.
function elementBody(element) {
    if (!isFieldBag(element)) {
        return { _properties: {} };
    }
    const body = {};
    for (const key of Object.keys(element)) {
        if (key !== '_object_class') {
            setOwn(body, key, element[key]);
        }
    }
    return body;
}
// One element of an object array as it is written back: `written`, what its node wrote for it,
// with `_object_class` naming its class `own` where that is not the array's `arrayClass`, in the
// place `read`, the element as it was read, held it, and otherwise first, as MATLAB writes its
// keys in order and `_object_class` sorts before `_properties`.
function elementWritten(written, read, own, arrayClass) {
    const body = elementBody(written);
    if (own === arrayClass) {
        return body;
    }
    const order = read && typeof read === 'object' && '_object_class' in read ? Object.keys(read) : ['_object_class'];
    const out = {};
    for (const key of order) {
        if (key === '_object_class') {
            out._object_class = own;
        }
        else if (Object.prototype.hasOwnProperty.call(body, key)) {
            setOwn(out, key, body[key]);
        }
    }
    for (const key of Object.keys(body)) {
        if (!Object.prototype.hasOwnProperty.call(out, key)) {
            setOwn(out, key, body[key]);
        }
    }
    return out;
}
export default class ObjectNode extends DataNode {
    constructor(name, parent, arrayClass, serial) {
        super(name, parent, serial);
        this.arrayClass = arrayClass;
    }
    get icon() {
        // A derived Simulink.ServiceBus is an Architectural Data ServiceInterface;
        // give it the service-interface icon instead of the generic object one.
        if (this.isDerived && this.arrayClass === 'Simulink.ServiceBus') {
            return 'serviceInterfaces';
        }
        // An object ARRAY is an array OF something, and this node is the only row
        // that stands for the whole of it, so it reads as what its elements are: a
        // 1x3 Simulink.Parameter is parameters down the whole column, not a generic
        // object sitting above three parameter rows. Ask the ELEMENT rather than map
        // the class name here — the element node is what decides how that class
        // looks, so the two can never come to disagree, and an array of a class this
        // data model has no icon for still lands on OBJECT_ICON because its elements
        // are ObjectNodes that answer exactly that. Of an array mixing classes, an element of
        // the array's own class answers, where there is one: a Simulink.Signal array whose
        // first element is a subclass with no node of its own reads as the signals it holds.
        if (this._isElementArray && this.children.length > 0) {
            const own = this.children.find((c) => elementNodeClass(c, this.arrayClass) === this.arrayClass);
            return (own ?? this.children[0]).icon;
        }
        return OBJECT_ICON;
    }
    get className() {
        return this.arrayClass;
    }
    // This node's children are MATLAB class properties, whose names are fixed by
    // the class definition and therefore not renameable (see BaseNode).
    get isObjectPropertyBag() {
        return true;
    }
    // The shape as DATA, normalized the way MATLAB's own size() reports it. It used
    // to exist only baked into displayValue, so a consumer — a parity test above all
    // — had to parse the display string to learn the shape, and could not check the
    // shape independently of the string it was already asserting.
    get dims() {
        const raw = this.serial._rawVal || {};
        // A nested object ({ _object_class, _properties }) carries no _dimensions at
        // all — it is always a scalar, which effectiveDims spells [1, 1].
        return effectiveDims(raw._dimensions);
    }
    // An enumeration value read out of a cell (XmlUtils.ENUM_KEY) shows its enumeral, as
    // MATLAB names it, `GearMode.Reverse`; an array of them, or one with no enumeral name, its
    // summary as any object does, and each element of the array its own enumeral.
    get displayValue() {
        const rawVal = this.serial._rawVal;
        if (rawVal && isEnumBag(rawVal)) {
            const elements = rawVal._elements || [];
            const enumeral = elements.length === 1 ? enumeralOf(elements[0]) : null;
            if (enumeral?.name && elementCount(this.dims) === 1) {
                return this.arrayClass + '.' + enumeral.name;
            }
        }
        return summaryForm(this.dims, this.arrayClass);
    }
    // Nothing here edits an enumeration value, and its enumeral is not text that reads back as
    // one: `GearMode.Reverse` typed into a MATLAB value is a char.
    get valueEditable() {
        return !isEnumBag(this.serial._rawVal) && super.valueEditable;
    }
    getProperties() {
        return [PropName, PropValue, PropDataType, PropDescription];
    }
    getPILayout() {
        // Object nodes carry a dynamic className (the MATLAB class), so they can't
        // be schema-keyed; author the common "General" identity group directly to
        // match the schema-driven classes.
        return [
            { group: 'General', items: [PropName, PropValue, PropDataType, PropKind, PropClassAtom, PropDescription] }
        ];
    }
    // Rebuild the object's serialized value from its LIVE child nodes so a property
    // edit writes back (issue #3). Without this the loaded `_rawVal` is emitted
    // verbatim and edits are silently discarded. An object with no expanded children
    // (an object array, or an empty object) has nothing to rebuild and keeps its raw
    // value unchanged.
    serializeValue() {
        if (!writeUnderWay()) {
            return oneWrite(() => this.serializeValue());
        }
        const rawVal = this.serial._rawVal || {};
        // An enumeration value as it was read, an array of them included: nothing edits one,
        // and the rebuild below keeps only each element's `_properties`, where an enumeral has
        // none.
        if (this.children.length === 0 || isEnumBag(rawVal)) {
            return rawVal;
        }
        // Object ARRAY: each child is a scalar element node (an ObjectNode for a
        // custom class, or a typed node like ParameterNode for a known one). Rebuild
        // one `_elements` entry per element from its own serialized value, preserving
        // the array wrapper.
        //
        // `parse` hands every element back to NodeRegistry inside a single-element
        // { _array_class, _elements: [{ _properties }] } wrapper, so a child's
        // serialized form carries that same wrapper back — a typed node rebuilds it
        // and a scalar ObjectNode echoes it. Unwrap it to the bare { _properties }
        // entry the outer array holds. Anything else (an element whose node
        // serializes to a bare scalar, or to null) contributes an empty bag: the
        // wrapper is the only shape this array form can carry.
        //
        // An element the file held as `null` comes back in that wrapper as `null`, for as long
        // as nothing changed it (see parse), and goes back as the `null` it was. Gathered for
        // XML, a typed one comes back as the element its class writes for one holding no
        // properties instead (DataNode._xmlProperties).
        //
        // Each element goes back as its node wrote it, every key the element was read with
        // included (see parse), with an element of a class other than the array's carrying that
        // class as its `_object_class`, as MATLAB's text format spells it. It went back as
        // `{_properties}` alone: each element's `_id`, `_custom_save` and `_object_class` were
        // gone from the file on every save, an untouched one included.
        if (this._isElementArray) {
            const read = rawVal._elements || [];
            const elements = this.children.map((child, k) => {
                const elemVal = child.serializeValue();
                const first = Array.isArray(elemVal?._elements)
                    ? elemVal._elements[0]
                    : undefined;
                if (first === null) {
                    return null;
                }
                return elementWritten(first ?? { _properties: {} }, read[k], elementNodeClass(child, this.arrayClass), this.arrayClass);
            });
            return { ...rawVal, _elements: elements };
        }
        // In a binary dictionary this JSON is what the XML is spelled from wherever a parent
        // writes this object from its value (an object's property, a Parameter's Value), and
        // what a copy out of it carries, so there it holds only the reserved keys XML can spell.
        const props = this._rebuiltProperties(this._ownerFormat() === 'xml');
        // Nested-object form { _id?, _object_class, _properties }: keep the identity
        // keys, replace only _properties.
        if (rawVal._object_class) {
            return { ...rawVal, _properties: props };
        }
        // Top-level value-object form { _array_class, _elements: [{ _id?, _properties }] }:
        // keep the wrapper and the element's identity keys, replace only _properties.
        const rawElements = rawVal._elements || [{}];
        const firstElem = { ...rawElements[0], _properties: props };
        return { ...rawVal, _elements: [firstElem] };
    }
    // XML write-back. An object ARRAY emits one <Element Class="..."> per element
    // (with a Dimension attr) so a multi-element value round-trips; a scalar falls
    // back to DataNode's single-element form.
    serializeXml(tagName, attrs, indent) {
        if (!writeUnderWay()) {
            return oneWrite(() => this.serializeXml(tagName, attrs, indent));
        }
        // Dims no Dimension can spell, refused, finally (DataNode._spellableOrRefuse).
        this._spellableOrRefuse((this.serial._rawVal || {})._dimensions, this.arrayClass || 'object');
        // An enumeration value, scalar, array or empty, as it was read (DataNode._enumXml): an
        // entry's cell writes each element through here.
        if (isEnumBag(this.serial._rawVal)) {
            const name = attrs && attrs.Name ? ' Name="' + escapeXml(attrs.Name) + '"' : '';
            return DataNode._enumXml(tagName, name, this.name, this.serial._rawVal, indent, undefined);
        }
        if (!this._isElementArray) {
            return super.serializeXml(tagName, attrs, indent);
        }
        const p = xmlPad(indent);
        const ip = xmlPad(indent + 1);
        const rawVal = this.serial._rawVal || {};
        const dims = rawVal._dimensions || [this.children.length, 1];
        let attrStr = '';
        if (attrs && attrs.Name) {
            attrStr += ' Name="' + escapeXml(attrs.Name) + '"';
        }
        // Every extent, not just the first two. Phase 8 stopped the MCOS decoder
        // truncating rank, so this node now reports [2,3,2] through `dims` and
        // displays <2x3x2 Simulink.Parameter> — but this attribute still said "2*3"
        // over the twelve <Element>s below it, the node contradicting itself.
        // MATLAB gives no ground truth for an object array's Dimension= (it refuses
        // object arrays in both .sldd flavours and the .slx model workspace,
        // truth.notes.slddRejected/slxRejected), but a Dimension= that contradicts
        // its own body is wrong regardless: for the struct analogue MATLAB's XML
        // reader segfaults on "2*3" carrying twelve elements. Its struct-array
        // spelling — every extent named, one <Element> each — is the only form
        // known to be accepted for an N-D array of things.
        const dimAttr = ' Dimension="' + (dims.length > 1 ? dims.join('*') : dims[0] + '*1') + '"';
        let xml = p + '<' + tagName + attrStr + dimAttr + '>\n';
        // Each element under its own class, which its node is of (see parse): every one was
        // written as the array's, so a subclass element beside a Simulink.Signal was saved as a
        // second subclass element.
        for (const child of this.children) {
            xml += ip + '<Element Class="' + escapeXml(elementNodeClass(child, this.arrayClass)) + '">\n';
            const props = child._xmlProperties();
            for (const [propName, propVal] of Object.entries(props)) {
                xml += DataNode.serializePropertyXml(propName, propVal, indent + 2, child, child._propertyAt(propName)) + '\n';
            }
            xml += ip + '</Element>\n';
        }
        xml += p + '</' + tagName + '>';
        return xml;
    }
    // The property bag the XML writers iterate into <P>s: _serializeSimulinkObjectXml, and
    // serializeXml for each element of an object array.
    //
    // With the saveobj envelope a text dictionary spells beside the element's bag, as
    // `_custom_save`, put in it under SAVEOBJ_KEY, the one key the XML spells as MATLAB's unnamed
    // saveobj <P>, and the spelling a binary dictionary's reader gives the same envelope. For a
    // class with no typed node it is the object's whole state, and it went out as an empty
    // <Element>. After the properties, where SimulinkObjectNode._propsOf puts it for a typed
    // class. Here and not in _storedProperties, because the JSON keeps it where it was read:
    // serializeValue writes the element's other keys back as they are.
    _getSerializedProperties() {
        const props = this._rebuiltProperties(true);
        const rawVal = this.serial._rawVal || {};
        const elements = rawVal._object_class ? undefined : rawVal._elements;
        const envelope = Array.isArray(elements) && elements.length === 1 ? customSaveOf(elements[0]) : undefined;
        if (envelope !== undefined) {
            setOwn(props, SAVEOBJ_KEY, envelope);
        }
        return props;
    }
    // The property bag rebuilt from live children, in the stored bag's own key order. Each
    // property's value is its child's own serialized form, so a nested object/struct/cell
    // edit recurses through the same path.
    //
    // A reserved key has no child to be rebuilt from (_addPropertyChildren), so it is
    // carried across from the stored bag, in its place: rebuilding from children alone
    // dropped a saveobj envelope, which for a class with no typed node is the object's whole
    // state, and the `_overridden_*` keys MATLAB writes into a table's bag. A file need not
    // hold its reserved keys first, so writing them first would reorder a bag on every save.
    // setOwn because the names are the file's: `__proto__` is a reserved key too, and an
    // assignment would hand it to the prototype setter.
    //
    // `forXml` keeps only the one reserved key XML can spell, SAVEOBJ_KEY, which goes out as
    // MATLAB's unnamed saveobj <P> (DataNode.pxAttrs). Any other went out as a named <P>, such
    // as `<P Name="_overridden_data" …>`: a property the class does not have, in a format
    // MATLAB does not write these keys into, since its binary dictionary holds a table with
    // none of them.
    _rebuiltProperties(forXml) {
        const stored = this._storedProperties();
        const rows = new Map();
        for (const child of this.children) {
            if (!rows.has(child.name)) {
                rows.set(child.name, child);
            }
        }
        const props = {};
        for (const key of Object.keys(stored)) {
            const row = rows.get(key);
            if (row) {
                setOwn(props, key, row.serializeValue());
                rows.delete(key);
            }
            else if (key.charAt(0) === '_' && (!forXml || key === SAVEOBJ_KEY)) {
                setOwn(props, key, stored[key]);
            }
        }
        // A row the stored bag has no key for, which nothing builds today: written after the
        // bag's own keys, where rebuilding from the children always put it.
        for (const [name, row] of rows) {
            setOwn(props, name, row.serializeValue());
        }
        return props;
    }
    // The bag `parse` built this node's rows from, as the file holds it: a nested object's
    // `_properties`, or a scalar value object's `_elements[0]._properties`. An object array's
    // own node has none; each element node has its own.
    //
    // Read from `_rawVal` rather than copied into `serial._properties` at parse, the key a
    // typed node keeps its bag under, because BaseNode.toPIObject lists whatever that key
    // holds in the Property Inspector's "Other" group: every property of an object, which
    // the tree already shows as its rows, would be listed a second time there.
    _storedProperties() {
        const rawVal = this.serial._rawVal || {};
        let bag;
        if (rawVal._object_class) {
            bag = rawVal._properties;
        }
        else if (Array.isArray(rawVal._elements) && rawVal._elements.length === 1) {
            bag = rawVal._elements[0]?._properties;
        }
        return bag && typeof bag === 'object' ? bag : {};
    }
    static parse(rawVal, name, parent) {
        const serial = { _rawVal: rawVal };
        // Two shapes converge here (issue #3):
        //   • a top-level value object: { _array_class, _elements: [{ _properties }] }
        //   • a nested object property: { _object_class, _properties } (no _elements
        //     wrapper), reached when a struct field or cell element is itself an
        //     object. NodeRegistry dispatches both here so nested objects expand no
        //     matter where in the graph they sit.
        // A value object of one element is an object of its element's class
        // (DataNode.objectValueClassOf), which an element of another class names.
        const arrayClass = (rawVal._object_class ?? objectValueClassOf(rawVal));
        const node = new ObjectNode(name, parent, arrayClass, serial);
        // Surface the object's serialized properties as child nodes so it expands
        // in the tree like a struct.
        //   • Nested object ({ _object_class, _properties }): one scalar bag.
        //   • Top-level value object ({ _array_class, _elements }): a SCALAR (one
        //     element) expands its properties directly; an ARRAY (N elements, e.g. a
        //     20x1 Simulink.VariableUsage) expands one child ObjectNode per element,
        //     named `name(i)`, each of which then expands into its own property rows.
        if (rawVal._object_class) {
            ObjectNode._addPropertyChildren(node, rawVal._properties);
            return node;
        }
        // MATLAB writes every element as an object, but a text dictionary is JSON anyone can
        // edit, and an element can be `null`. Reading `_properties` off one threw, and the throw
        // failed the open of the whole dictionary. A null element holds no property, so it has
        // no rows; it is kept as read, and goes back as `null` while nothing changes it.
        const elements = rawVal._elements || [];
        if (elements.length > 1) {
            node._isElementArray = true;
            const dims = rawVal._dimensions || [1, elements.length];
            elements.forEach((elem, ei) => {
                // Each element is a SCALAR object of its own class: the array's, or the
                // `_object_class` an element of another class carries, as MATLAB's text format
                // and the binary reader spell a mixed-class array (DataNode.elementClassOf). Route
                // it back through NodeRegistry as a single-element value object so a KNOWN
                // class (Simulink.Parameter, …) becomes its own typed node and an
                // unknown/custom class becomes a scalar ObjectNode — the same
                // dispatch a standalone scalar would take. A null element goes in as
                // the null it is, which both of those keep (NodeClassMap.parseValue).
                //
                // The element goes in whole, every key MATLAB wrote on it with it: its `_id`, its
                // `_custom_save`, which for a class that saves through saveobj is its whole
                // state, and an enumeral (XmlUtils.ENUMERATION_KEY). Only its `_object_class`
                // stays out, being the class of the wrapper it goes in. It used to go in as
                // `{_properties}` alone, which every save then wrote back, an untouched one of
                // a text dictionary included.
                const elemRaw = {
                    _array_class: elementClassOf(elem, arrayClass),
                    _array_type: 'MATLABArray',
                    _dimensions: [1, 1],
                    _mw_element_type: rawVal._mw_element_type || 'MATLABArray',
                    _elements: [elem === null || elem === undefined ? null : elementBody(elem)],
                };
                // An element of an enumeration array is the scalar enumeration value it holds,
                // so that it shows its own enumeral.
                if (isEnumBag(rawVal)) {
                    elemRaw[ENUM_KEY] = rawVal[ENUM_KEY];
                }
                const elemNode = NodeRegistry.parseValue(elemRaw, String(ei), node);
                // The MCOS decoder and both SLDD paths deliver elements in MATLAB's
                // own COLUMN-major order, so element ei is MATLAB's linear index
                // ei+1. Reading it row-major named 4 of the 6 elements of a 2x3
                // array after the wrong object. The label itself is derived from
                // this spec on demand (BaseNode.displayName), so it follows a
                // rename of the array.
                elemNode._subscript = { index: ei, dims, order: 'column-major', bracket: '()' };
                node.addChild(elemNode);
            });
        }
        else if (elements.length === 1) {
            // A scalar whose element is null has no rows, so it writes back the value it read
            // (serializeValue).
            ObjectNode._addPropertyChildren(node, elements[0]?._properties);
        }
        return node;
    }
    // Build a child node per serialized property. Every value — scalar, struct,
    // cell, string, or a nested { _object_class, _properties } object — routes
    // through NodeRegistry.parseValue, which now recognizes the nested-object shape
    // and dispatches it back to ObjectNode. This single path makes objects expand
    // recursively even when nested inside a struct field or a cell element.
    static _addPropertyChildren(node, properties) {
        if (!properties || typeof properties !== 'object') {
            return;
        }
        for (const propName of Object.keys(properties)) {
            // A reserved key is not a property and gets no row. Today that is only
            // SAVEOBJ_KEY, the bag key the reader has to invent for MATLAB's unnamed
            // saveobj envelope (XmlUtils.SAVEOBJ_KEY): shown, it would put a `_saveobj`
            // struct next to the real properties in the tree and offer it for editing.
            // The '_' test rather than the constant because a MATLAB identifier cannot
            // begin with '_', so no real property name can ever be hidden by this rule.
            if (propName.charAt(0) === '_') {
                continue;
            }
            const child = NodeRegistry.parseValue(properties[propName], propName, node);
            node.addChild(child);
        }
    }
}
//# sourceMappingURL=ObjectNode.js.map