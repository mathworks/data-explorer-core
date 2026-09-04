// Copyright 2026 The MathWorks, Inc.

import DataNode from '../DataNode.js';
import * as NodeRegistry from '../NodeRegistry.js';
import type BaseNode from '../BaseNode.js';
import type { PropClass, PIGroupDef } from '../BaseNode.js';
import { addChildUndoable, removeChildUndoable } from '../childEdit.js';
import type { ChildAddEdit, ChildUndoRedo } from '../childEdit.js';
import PropName from '../../prop/PropName.js';
import PropValue from '../../prop/PropValue.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
import PropKind from '../../prop/PropKind.js';
import PropClassAtom from '../../prop/PropClass.js';
import { escapeXml, pad as xmlPad } from '../../parser/XmlUtils.js';
import { subscriptLabel } from '../../display/Subscript.js';
import { effectiveDims, elementCount, summaryForm } from '../../display/DisplayConvention.js';

export default class StructNode extends DataNode {
    _isElementNode?: boolean;

    get icon(): string {
        return 'wsTree';
    }

    get className(): string {
        return 'struct';
    }

    // 'struct' is a real data type, so it belongs in the DataType column.
    get dataType(): string {
        return this.className;
    }

    // A struct is a MATLAB variable, like scalars/arrays/cells.
    get kind(): string {
        return 'MATLAB Variable';
    }

    get displayValue(): string {
        return summaryForm(this.dims, 'struct');
    }

    // Every extent a MATLAB struct array declares, normalized the way MATLAB's own
    // size() reports it. Read this rather than serial._dimensions[0]/[1]: MATLAB
    // writes a 1x1x3 struct array as Dimension="1*1*3" and a 2x3x2 as "2*3*2", so a
    // rank-2 reading of either one contradicts the element list underneath it.
    //
    // Public, and named like MatlabVariableNode.dims, because the shape is DATA: it
    // was reachable only inside displayValue, so a consumer that wanted MATLAB's
    // size() had to parse the display string it was also checking.
    get dims(): number[] {
        return effectiveDims(this.serial._dimensions as number[] | undefined);
    }

    // How many <Element>s the array has — the product of EVERY extent. d[0]*d[1]
    // said 6 for a 2x3x2 (which then wrote Dimension="2*3" over twelve elements and
    // segfaulted MATLAB's XML reader) and 1 for a 1x1x3 (which wrapped the three
    // elements in one bogus outer <Element> and, on the serializeValue path, threw
    // their contents away).
    get _numElements(): number {
        return elementCount(this.dims);
    }

    // A struct array's children are its ELEMENTS; only a scalar struct's children
    // are its fields. Anything that edits or reads fields has to ask this and not
    // `d[0] === 1 && d[1] === 1`, which is true of a 1x1x3 array as well.
    get _isScalarStruct(): boolean {
        return this._numElements === 1;
    }

    getProperties(): PropClass[] {
        return [PropName, PropValue, PropDataType, PropDescription];
    }

    getPILayout(): PIGroupDef[] {
        // className is the data type 'struct' (shared with plain struct variables),
        // so this can't be schema-keyed; author the common "General" group directly.
        return [
            { group: 'General', items: [PropName, PropValue, PropDataType, PropKind, PropClassAtom, PropDescription] }
        ];
    }

    serializeElement(): Record<string, unknown> {
        const fields = (this.serial._fields as string[]) || [];
        const elem: Record<string, unknown> = {};
        fields.forEach((field) => {
            const child = this.children.find((c) => c.name === field);
            elem[field] = child ? (child as DataNode).serializeValue() : undefined;
        });
        return elem;
    }

    serializeValue(): unknown {
        if (this._rawInput !== undefined && this.status !== 'Modified') {
            return this._rawInput;
        }
        const d = this.dims;
        const fields = (this.serial._fields as string[]) || [];

        if (this._isElementNode) {
            return this.serializeElement();
        }

        const elements: Record<string, unknown>[] = [];
        if (this._numElements > 1) {
            this.children.forEach((elemNode) => {
                elements.push((elemNode as StructNode).serializeValue() as Record<string, unknown>);
            });
        } else {
            elements.push(this.serializeElement());
        }

        const result: Record<string, unknown> = {
            _array_type: 'Struct',
            _dimensions: d,
            _elements: elements
        };
        if (this.serial._fields) {
            result._fields = fields;
        }
        result._mw_element_type = (this.serial._mw_element_type as string) || 'MATLABArray';
        return result;
    }

    serializeXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string {
        const p = xmlPad(indent);
        const d = this.dims;
        let attrStr = '';
        if (attrs && attrs.Name) { attrStr += ' Name="' + escapeXml(attrs.Name) + '"'; }

        if (this._isElementNode) {
            let xml = p + '<Element>\n';
            for (const child of this.children) {
                xml += (child as DataNode).serializeXml('P', { Name: child.name }, indent + 1) + '\n';
            }
            xml += p + '</Element>';
            return xml;
        }

        // Every extent, joined — MATLAB's own spelling for a 1x1x3 struct array is
        // `Class="struct" Dimension="1*1*3"` with one <Element> per element. Writing
        // `d[0] + '*' + d[1]` promised 6 elements over a 2x3x2's twelve, and for a
        // 1x1x3 dropped the attribute entirely (d[0] and d[1] are both 1), which
        // MATLAB's XML reader answers with a segmentation fault rather than an error.
        const dimAttr = d.every((n) => n === 1) ? '' : ' Dimension="' + d.join('*') + '"';
        let xml = p + '<' + tagName + attrStr + ' Class="struct"' + dimAttr + '>\n';
        if (this._numElements > 1) {
            for (const elemNode of this.children) {
                xml += (elemNode as DataNode).serializeXml('Element', {}, indent + 1) + '\n';
            }
        } else {
            xml += xmlPad(indent + 1) + '<Element>\n';
            for (const child of this.children) {
                xml += (child as DataNode).serializeXml('P', { Name: child.name }, indent + 2) + '\n';
            }
            xml += xmlPad(indent + 1) + '</Element>\n';
        }
        xml += p + '</' + tagName + '>';
        return xml;
    }

    // A struct ARRAY has a single field list shared by every element — that is what
    // makes it an array rather than a bag of unrelated structs — so renaming a field
    // on one element renames it on all of them, and each element's matching child
    // has to be renamed too. Without that, every OTHER element serialized its value
    // under a field name it no longer had: undefined, and the value simply gone from
    // the saved file. An element hands the job up to the array root, which owns them
    // all; the root then renames the shared list once (super) and fixes up the
    // siblings. Renaming a child that already carries the new name is a no-op, which
    // is what makes this safe to call from the element that triggered it.
    _renameField(from: string, to: string): void {
        if (this._isElementNode && this.parent instanceof StructNode) {
            this.parent._renameField(from, to);
            return;
        }
        super._renameField(from, to);
        for (const element of this.children) {
            if (!(element as StructNode)._isElementNode) {
                continue;
            }
            for (const field of element.children) {
                if (field.name === from) {
                    field.name = to;
                }
            }
        }
    }

    canRemoveChild(): boolean {
        return this._isScalarStruct && !this._isElementNode && this.children.length > 0;
    }

    removeChildNode(child: BaseNode): void {
        const idx = this.children.indexOf(child);
        if (idx < 0) { return; }
        this.removeChild(child);
        if (this.serial._fields) {
            const fields = this.serial._fields as string[];
            const fieldIdx = fields.indexOf(child.name);
            if (fieldIdx >= 0) {
                fields.splice(fieldIdx, 1);
            }
        }
        this._markModified();
    }

    restoreChildNode(child: BaseNode, index: number): void {
        this.children.splice(index, 0, child);
        child.parent = this;
        if (this.serial._fields) {
            (this.serial._fields as string[]).splice(index, 0, child.name);
        }
        this._markModified();
    }

    canAddChild(): boolean {
        return this._isScalarStruct && !this._isElementNode;
    }

    addChildNode(): DataNode {
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
        (this.serial._fields as string[]).push(uniqueName);
        this._markModified();
        return childNode;
    }

    execAddChild(): ChildAddEdit<DataNode> | null { return addChildUndoable(this); }
    execRemoveChild(child?: BaseNode): ChildUndoRedo | null { return removeChildUndoable(this, child); }

    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): StructNode {
        const serial: Record<string, unknown> = {
            _dimensions: rawVal._dimensions,
            _fields: rawVal._fields,
            _mw_element_type: rawVal._mw_element_type
        };
        const node = new StructNode(name, parent, serial);
        node._rawInput = rawVal;
        const fields = (rawVal._fields as string[]) || [];
        const elements = (rawVal._elements as Record<string, unknown>[]) || [];

        if (elements.length > 1) {
            const dims = (rawVal._dimensions as number[]) || [1, elements.length];
            elements.forEach((elem, ei) => {
                const elemSerial: Record<string, unknown> = {
                    _dimensions: [1, 1],
                    _fields: fields,
                    _mw_element_type: rawVal._mw_element_type
                };
                const elemNode = new StructNode(String(ei), node, elemSerial);
                elemNode._isElementNode = true;
                // Column-major, as MATLAB stores it — see ObjectNode.
                elemNode._displayName = subscriptLabel(name, ei, dims, 'column-major', '()');
                fields.forEach((field) => {
                    const childNode = NodeRegistry.parseValue(elem[field], field, elemNode);
                    elemNode.addChild(childNode);
                });
                node.addChild(elemNode);
            });
        } else if (elements.length === 1) {
            fields.forEach((field) => {
                const childNode = NodeRegistry.parseValue(elements[0][field], field, node);
                node.addChild(childNode);
            });
        }

        return node;
    }

    static get defaultName(): string { return 'Struct'; }

    static createDefault(name: string, parent: BaseNode | null): StructNode {
        const rawVal: Record<string, unknown> = {
            _array_type: 'Struct',
            _dimensions: [1, 1],
            _num_fields: 0,
            _field_names: [],
            _elements: [{}]
        };
        return StructNode.parse(rawVal, name, parent);
    }
}
