// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode.js';
import PropName from '../../prop/PropName.js';
import PropValue from '../../prop/PropValue.js';
import PropEnumValue from '../../prop/PropEnumValue.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
import PropKind from '../../prop/PropKind.js';
import PropClassAtom from '../../prop/PropClass.js';
const CLASS_NAME = 'Simulink.data.dictionary.EnumTypeDefinition';
export class EnumValueNode extends DataNode {
    constructor(name, parent, props) {
        super(name, parent, { _rawProps: props });
        this.Value = props.Value;
        this.Description = props.Description || '';
    }
    // The enumeral that the parent EnumType defaults to gets the "current" icon;
    // every other enumeral gets the plain bus-element icon. When the parent has no
    // DefaultValue set, the first enumeral is treated as the current one. A
    // derived (Architectural Data) enum uses the arch "current" icon; a plain
    // Design Data enum uses the workspace variant.
    get icon() {
        const parent = this.parent;
        if (!parent) {
            return 'busElement';
        }
        const isCurrent = parent.DefaultValue
            ? parent.DefaultValue === this.name
            : parent.children[0] === this;
        if (!isCurrent) {
            return 'busElement';
        }
        return parent.isDerived ? 'typeElement' : 'wsElement';
    }
    get className() { return CLASS_NAME; }
    // An enumeral has no meaningful data type — the DataType column is empty
    // (not applicable).
    get dataType() { return ''; }
    get displayValue() { return this.Value !== undefined ? String(this.Value) : ''; }
    get disabled() { return true; }
    getProperties() { return [PropName, PropValue, PropDescription]; }
    // An enumeral shares its parent's className (EnumTypeDefinition), so it can't
    // be schema-keyed; author the common "General" group directly. DataType is
    // omitted (an enumeral has no data type — see dataType getter above).
    getPILayout() { return [{ group: 'General', items: [PropName, PropValue, PropKind, PropClassAtom, PropDescription] }]; }
    serializeValue() {
        const raw = Object.assign({}, this.serial._rawProps);
        raw.Name = this.name;
        raw.Value = this.Value;
        raw.Description = this.Description;
        return raw;
    }
}
export class EnumTypeNode extends DataNode {
    constructor(name, parent, props, serial) {
        super(name, parent, serial);
        this.DefaultValue = props.DefaultValue || '';
        this.Description = props.Description || '';
    }
    get icon() { return this.isDerived ? 'typeEnum' : 'wsEnum'; }
    get className() { return CLASS_NAME; }
    // The Value column shows the enum's DefaultValue; when none is set it falls
    // back to the first enumeral's name (the same one marked "current" by the
    // child icon rule).
    get displayValue() {
        if (this.DefaultValue) {
            return this.DefaultValue;
        }
        return (this.children[0] && this.children[0].name) || '';
    }
    getProperties() { return [PropName, PropEnumValue, PropDataType, PropDescription]; }
    // PI layout is schema-driven (schema/classes/enumType.json). NOTE: EnumValueNode
    // shares this className but keeps its own getPILayout override (a value row, not
    // the enum type), so it never resolves the schema layout.
    _getSerializedProperties() {
        const enumerals = this.children.map(function (child) { return child.serializeValue(); });
        const props = Object.assign({}, this.serial._properties);
        if ('DefaultValue' in this.serial._properties || this.DefaultValue) {
            props.DefaultValue = this.DefaultValue;
        }
        if ('Description' in this.serial._properties || this.Description) {
            props.Description = this.Description;
        }
        const rawEnumerals = this.serial._rawEnumerals || {};
        const enumWrapper = {};
        Object.keys(rawEnumerals).forEach(function (k) { if (k === '_elements') {
            enumWrapper._elements = enumerals;
        }
        else {
            enumWrapper[k] = rawEnumerals[k];
        } });
        if (!('_elements' in rawEnumerals)) {
            enumWrapper._elements = enumerals;
        }
        // Keep _dimensions in sync with the enumeral count so adding or removing
        // one stays consistent. Enumerals are stored as a row-vector struct array.
        enumWrapper._dimensions = [1, enumerals.length];
        props.Enumerals = enumWrapper;
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
        const existing = new Set(this.children.map(function (c) { return c.name; }));
        let i = 1;
        let uniqueName = 'enum' + i;
        while (existing.has(uniqueName)) {
            i++;
            uniqueName = 'enum' + i;
        }
        // Enumeral values are stored as strings (e.g. "0", "1") to match the
        // source format, so the new value is stringified.
        const nextVal = String(this.children.length);
        const props = { Name: uniqueName, Value: nextVal, Description: '' };
        const childNode = new EnumValueNode(uniqueName, this, props);
        this.addChild(childNode);
        this._markModified();
        return childNode;
    }
    execAddChild() {
        if (!this.canAddChild()) {
            return null;
        }
        const child = this.addChildNode();
        if (!child) {
            return null;
        }
        const self = this;
        const index = this.children.indexOf(child);
        return { node: child, undo() { self.removeChildNode(child); }, redo() { self.restoreChildNode(child, index); } };
    }
    execRemoveChild(child) {
        if (!this.canRemoveChild() || !child) {
            return null;
        }
        const index = this.children.indexOf(child);
        if (index < 0) {
            return null;
        }
        this.removeChildNode(child);
        const self = this;
        return { undo() { self.restoreChildNode(child, index); }, redo() { self.removeChildNode(child); } };
    }
    static get defaultName() { return 'EnumType'; }
    static createDefault(name, parent) {
        const enumerals = { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ Description: '', Name: 'enum1', Value: '0' }], _fields: ['Name', 'Value', 'Description'] };
        const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: { Enumerals: enumerals } }] };
        const props = rawVal._elements[0]._properties;
        const serial = { _rawVal: rawVal, _properties: props, _rawEnumerals: enumerals };
        const node = new EnumTypeNode(name, parent, props, serial);
        const childProps = enumerals._elements[0];
        const childNode = new EnumValueNode('enum1', node, childProps);
        node.addChild(childNode);
        return node;
    }
    static parse(rawVal, name, parent) {
        const elem = rawVal._elements && rawVal._elements[0];
        const props = ((elem && elem._properties) || {});
        const enumerals = ((props.Enumerals) || {});
        const serial = { _rawVal: rawVal, _properties: props, _rawEnumerals: enumerals };
        const node = new EnumTypeNode(name, parent, props, serial);
        if (enumerals._elements) {
            enumerals._elements.forEach(function (en) {
                const enumName = en.Name || '';
                const childNode = new EnumValueNode(enumName, node, en);
                node.addChild(childNode);
            });
        }
        return node;
    }
}
export default { EnumTypeNode, EnumValueNode };
//# sourceMappingURL=EnumTypeNode.js.map