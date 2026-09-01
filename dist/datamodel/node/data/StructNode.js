// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode.js';
import * as NodeRegistry from '../NodeRegistry.js';
import { addChildUndoable, removeChildUndoable } from '../childEdit.js';
import PropName from '../../prop/PropName.js';
import PropValue from '../../prop/PropValue.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
import PropKind from '../../prop/PropKind.js';
import PropClassAtom from '../../prop/PropClass.js';
import { escapeXml, pad as xmlPad } from '../../parser/XmlUtils.js';
export default class StructNode extends DataNode {
    get icon() {
        return 'wsTree';
    }
    get className() {
        return 'struct';
    }
    // 'struct' is a real data type, so it belongs in the DataType column.
    get dataType() {
        return this.className;
    }
    // A struct is a MATLAB variable, like scalars/arrays/cells.
    get kind() {
        return 'MATLAB Variable';
    }
    get displayValue() {
        const d = this.serial._dimensions || [1, 1];
        return '<' + d.join('x') + ' struct>';
    }
    getProperties() {
        return [PropName, PropValue, PropDataType, PropDescription];
    }
    getPILayout() {
        // className is the data type 'struct' (shared with plain struct variables),
        // so this can't be schema-keyed; author the common "General" group directly.
        return [
            { group: 'General', items: [PropName, PropValue, PropDataType, PropKind, PropClassAtom, PropDescription] }
        ];
    }
    serializeElement() {
        const fields = this.serial._fields || [];
        const elem = {};
        fields.forEach((field) => {
            const child = this.children.find((c) => c.name === field);
            elem[field] = child ? child.serializeValue() : undefined;
        });
        return elem;
    }
    serializeValue() {
        if (this._rawInput !== undefined && this.status !== 'Modified') {
            return this._rawInput;
        }
        const d = this.serial._dimensions || [1, 1];
        const numElems = d[0] * d[1];
        const fields = this.serial._fields || [];
        if (this._isElementNode) {
            return this.serializeElement();
        }
        const elements = [];
        if (numElems > 1) {
            this.children.forEach((elemNode) => {
                elements.push(elemNode.serializeValue());
            });
        }
        else {
            elements.push(this.serializeElement());
        }
        const result = {
            _array_type: 'Struct',
            _dimensions: d,
            _elements: elements
        };
        if (this.serial._fields) {
            result._fields = fields;
        }
        result._mw_element_type = this.serial._mw_element_type || 'MATLABArray';
        return result;
    }
    serializeXml(tagName, attrs, indent) {
        const p = xmlPad(indent);
        const d = this.serial._dimensions || [1, 1];
        let attrStr = '';
        if (attrs && attrs.Name) {
            attrStr += ' Name="' + escapeXml(attrs.Name) + '"';
        }
        if (this._isElementNode) {
            let xml = p + '<Element>\n';
            for (const child of this.children) {
                xml += child.serializeXml('P', { Name: child.name }, indent + 1) + '\n';
            }
            xml += p + '</Element>';
            return xml;
        }
        const dimAttr = (d[0] === 1 && d[1] === 1) ? '' : ' Dimension="' + d[0] + '*' + d[1] + '"';
        let xml = p + '<' + tagName + attrStr + ' Class="struct"' + dimAttr + '>\n';
        const numElems = d[0] * d[1];
        if (numElems > 1) {
            for (const elemNode of this.children) {
                xml += elemNode.serializeXml('Element', {}, indent + 1) + '\n';
            }
        }
        else {
            xml += xmlPad(indent + 1) + '<Element>\n';
            for (const child of this.children) {
                xml += child.serializeXml('P', { Name: child.name }, indent + 2) + '\n';
            }
            xml += xmlPad(indent + 1) + '</Element>\n';
        }
        xml += p + '</' + tagName + '>';
        return xml;
    }
    canRemoveChild() {
        const d = this.serial._dimensions || [1, 1];
        return d[0] === 1 && d[1] === 1 && !this._isElementNode && this.children.length > 0;
    }
    removeChildNode(child) {
        const idx = this.children.indexOf(child);
        if (idx < 0) {
            return;
        }
        this.removeChild(child);
        if (this.serial._fields) {
            const fields = this.serial._fields;
            const fieldIdx = fields.indexOf(child.name);
            if (fieldIdx >= 0) {
                fields.splice(fieldIdx, 1);
            }
        }
        this._markModified();
    }
    restoreChildNode(child, index) {
        this.children.splice(index, 0, child);
        child.parent = this;
        if (this.serial._fields) {
            this.serial._fields.splice(index, 0, child.name);
        }
        this._markModified();
    }
    canAddChild() {
        const d = this.serial._dimensions || [1, 1];
        return d[0] === 1 && d[1] === 1 && !this._isElementNode;
    }
    addChildNode() {
        const baseName = 'field';
        const existing = new Set(this.children.map((c) => c.name));
        let uniqueName = baseName;
        let i = 1;
        while (existing.has(uniqueName)) {
            uniqueName = baseName + i;
            i++;
        }
        const childNode = NodeRegistry.parseValue(0, uniqueName, this);
        this.addChild(childNode);
        if (!this.serial._fields) {
            this.serial._fields = [];
        }
        this.serial._fields.push(uniqueName);
        this._markModified();
        return childNode;
    }
    execAddChild() { return addChildUndoable(this); }
    execRemoveChild(child) { return removeChildUndoable(this, child); }
    static parse(rawVal, name, parent) {
        const serial = {
            _dimensions: rawVal._dimensions,
            _fields: rawVal._fields,
            _mw_element_type: rawVal._mw_element_type
        };
        const node = new StructNode(name, parent, serial);
        node._rawInput = rawVal;
        const fields = rawVal._fields || [];
        const elements = rawVal._elements || [];
        if (elements.length > 1) {
            const dims = rawVal._dimensions || [1, elements.length];
            const rows = dims[0];
            const cols = dims[1];
            const isMatrix = rows > 1 && cols > 1;
            elements.forEach((elem, ei) => {
                const elemSerial = {
                    _dimensions: [1, 1],
                    _fields: fields,
                    _mw_element_type: rawVal._mw_element_type
                };
                const elemNode = new StructNode(String(ei), node, elemSerial);
                elemNode._isElementNode = true;
                elemNode._displayName = isMatrix
                    ? name + '(' + (Math.floor(ei / cols) + 1) + ',' + (ei % cols + 1) + ')'
                    : name + '(' + (ei + 1) + ')';
                fields.forEach((field) => {
                    const childNode = NodeRegistry.parseValue(elem[field], field, elemNode);
                    elemNode.addChild(childNode);
                });
                node.addChild(elemNode);
            });
        }
        else if (elements.length === 1) {
            fields.forEach((field) => {
                const childNode = NodeRegistry.parseValue(elements[0][field], field, node);
                node.addChild(childNode);
            });
        }
        return node;
    }
    static get defaultName() { return 'Struct'; }
    static createDefault(name, parent) {
        const rawVal = {
            _array_type: 'Struct',
            _dimensions: [1, 1],
            _num_fields: 0,
            _field_names: [],
            _elements: [{}]
        };
        return StructNode.parse(rawVal, name, parent);
    }
}
//# sourceMappingURL=StructNode.js.map