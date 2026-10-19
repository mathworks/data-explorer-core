// Copyright 2026 The MathWorks, Inc.

import DataNode from '../DataNode.js';
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import { addChildUndoable, removeChildUndoable } from '../childEdit.js';
import type { ChildAddEdit, ChildUndoRedo } from '../childEdit.js';
import PropName from '../../prop/PropName.js';
import PropValue from '../../prop/PropValue.js';
import PropEnumValue from '../../prop/PropEnumValue.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
import PropKind from '../../prop/PropKind.js';
import PropClassAtom from '../../prop/PropClass.js';
import { isElement, reportNotAList, reportNotElements } from './notAnElement.js';
import { elementOriginAt, originOf, recordElementOrigins, recordOrigin, taggingOrigins } from '../../parser/EntrySource.js';

const CLASS_NAME = 'Simulink.data.dictionary.EnumTypeDefinition';

export class EnumValueNode extends DataNode {
    Value: unknown;
    Description: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>) {
        super(name, parent, { _rawProps: props });
        this.Value = props.Value;
        this.Description = (props.Description as string) || '';
    }
    // The enumeral that the parent EnumType defaults to gets the "current" icon;
    // every other enumeral gets the plain bus-element icon. When the parent has no
    // DefaultValue set, the first enumeral is treated as the current one. A
    // derived (Architectural Data) enum uses the arch "current" icon; a plain
    // Design Data enum uses the workspace variant.
    get icon(): string {
        const parent = this.parent as EnumTypeNode | null;
        if (!parent) { return 'busElement'; }
        const isCurrent = parent.DefaultValue
            ? parent.DefaultValue === this.name
            : parent.children[0] === this;
        if (!isCurrent) { return 'busElement'; }
        return parent.isDerived ? 'typeElement' : 'wsElement';
    }
    get className(): string { return CLASS_NAME; }
    // An enumeral has no meaningful data type — the DataType column is empty
    // (not applicable).
    get dataType(): string { return ''; }
    get displayValue(): string { return this.Value !== undefined ? String(this.Value) : ''; }
    get disabled(): boolean { return true; }
    getProperties(): PropClass[] { return [PropName, PropValue, PropDescription]; }
    // An enumeral shares its parent's className (EnumTypeDefinition), so it can't
    // be schema-keyed; author the common "General" group directly. DataType is
    // omitted (an enumeral has no data type — see dataType getter above).
    getPILayout() { return [{ group: 'General', items: [PropName, PropValue, PropKind, PropClassAtom, PropDescription] }]; }
    serializeValue(): unknown {
        const raw = { ...(this.serial._rawProps as Record<string, unknown>) };
        raw.Name = this.name; raw.Value = this.Value; raw.Description = this.Description;
        return raw;
    }
}

export class EnumTypeNode extends DataNode {
    DefaultValue: string;
    Description: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) {
        super(name, parent, serial);
        this.DefaultValue = (props.DefaultValue as string) || '';
        this.Description = (props.Description as string) || '';
    }
    get icon(): string { return this.isDerived ? 'typeEnum' : 'wsEnum'; }
    get className(): string { return CLASS_NAME; }
    // The Value column shows the enum's DefaultValue; when none is set it falls
    // back to the first enumeral's name (the same one marked "current" by the
    // child icon rule).
    get displayValue(): string {
        if (this.DefaultValue) { return this.DefaultValue; }
        return (this.children[0] && this.children[0].name) || '';
    }
    getProperties(): PropClass[] { return [PropName, PropEnumValue, PropDataType, PropDescription]; }

    // An enumeration type whose properties are held beside its class is shown as read, and takes
    // an edit of its name alone, which the save writes back as read (DataNode._inlineObjectBag,
    // _refuseInlineBagEdit).
    get valueEditable(): boolean { return !this._inlineObjectBag() && super.valueEditable; }
    get descriptionEditable(): boolean { return !this._inlineObjectBag() && super.descriptionEditable; }
    setProperty(propName: string, stringValue: string): ReturnType<DataNode['setProperty']> {
        if (this._isUnchangedCommit(propName, stringValue)) {
            return true;
        }
        return this._refuseInlineBagEdit(propName, stringValue) ?? super.setProperty(propName, stringValue);
    }
    // PI layout is schema-driven (schema/classes/enumType.json). NOTE: EnumValueNode
    // shares this className but keeps its own getPILayout override (a value row, not
    // the enum type), so it never resolves the schema layout.

    _getSerializedProperties(): Record<string, unknown> {
        const enumerals = this.children.map(function (child) { return (child as EnumValueNode).serializeValue(); });
        // Each enumeral's origin in the file, for the save that merges an edited entry (EntrySource).
        if (taggingOrigins()) { recordElementOrigins(enumerals, this.children.map(originOf)); }
        const props = { ...(this.serial._properties as Record<string, unknown>) };
        if ('DefaultValue' in (this.serial._properties as Record<string, unknown>) || this.DefaultValue) { props.DefaultValue = this.DefaultValue; }
        if ('Description' in (this.serial._properties as Record<string, unknown>) || this.Description) { props.Description = this.Description; }
        const rawEnumerals = (this.serial._rawEnumerals as Record<string, unknown>) || {};
        // An enum read with no Enumerals, and given no enumeral since, is written as it was
        // read, with none. The wrapper made up for it had no `_array_type`, so no writer had a
        // spelling for it: a paste into a binary dictionary wrote it as the char `[object
        // Object]`, and a text save added the key to the file (typeLink.sldd's avtEngSt; C-205).
        if (enumerals.length === 0 && rawEnumerals._array_type === undefined && rawEnumerals._elements === undefined) {
            return props;
        }
        // One given an enumeral since, or whose wrapper says no `_array_type`, is a struct
        // array of them, as MATLAB writes Enumerals (createDefault), in MATLAB's key order.
        const spelled = rawEnumerals._array_type === undefined
            ? { _array_type: 'Struct', _dimensions: [], _elements: [], _fields: ['Name', 'Value', 'Description'], ...rawEnumerals }
            : rawEnumerals;
        const enumWrapper: Record<string, unknown> = { ...spelled, _elements: enumerals };
        // Keep _dimensions in sync with the enumeral count so adding or removing
        // one stays consistent. Enumerals are stored as a row-vector struct array.
        enumWrapper._dimensions = [1, enumerals.length];
        props.Enumerals = enumWrapper;
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

    addChildNode(): EnumValueNode {
        const existing = new Set(this.children.map(function (c) { return c.name; }));
        let i = 1; let uniqueName = 'enum' + i;
        while (existing.has(uniqueName)) { i++; uniqueName = 'enum' + i; }
        // Enumeral values are stored as strings (e.g. "0", "1") to match the
        // source format, so the new value is stringified.
        const nextVal = String(this.children.length);
        const props = { Name: uniqueName, Value: nextVal, Description: '' };
        const childNode = new EnumValueNode(uniqueName, this, props);
        this.addChild(childNode); this._markModified();
        return childNode;
    }

    execAddChild(): ChildAddEdit<EnumValueNode> | null { return addChildUndoable(this); }
    execRemoveChild(child?: BaseNode): ChildUndoRedo | null { return removeChildUndoable(this, child); }

    static get defaultName(): string { return 'EnumType'; }

    static createDefault(name: string, parent: BaseNode | null): EnumTypeNode {
        const enumerals = { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ Description: '', Name: 'enum1', Value: '0' }], _fields: ['Name', 'Value', 'Description'] };
        const rawVal = SimulinkObjectNode._defaultRawVal(CLASS_NAME, { Enumerals: enumerals });
        const props = SimulinkObjectNode._propsOf(rawVal);
        const serial = { _rawVal: rawVal, _properties: props, _rawEnumerals: enumerals };
        const node = new EnumTypeNode(name, parent, props, serial as unknown as Record<string, unknown>);
        const childProps = enumerals._elements[0];
        const childNode = new EnumValueNode('enum1', node, childProps as unknown as Record<string, unknown>);
        node.addChild(childNode);
        return node;
    }

    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): EnumTypeNode {
        const elem = rawVal._elements && (rawVal._elements as unknown[])[0];
        const props = ((elem && (elem as Record<string, unknown>)._properties) || {}) as Record<string, unknown>;
        const enumerals = ((props.Enumerals) || {}) as Record<string, unknown>;
        const serial = { _rawVal: rawVal, _properties: props, _rawEnumerals: enumerals };
        const node = new EnumTypeNode(name, parent, props, serial as Record<string, unknown>);
        if (Array.isArray(enumerals._elements)) {
            (enumerals._elements as Record<string, unknown>[]).forEach(function (en, index) {
                // An enumeral that is not one (a hand-edited `null`, number or string) gets no
                // row; reported after the loop.
                if (!isElement(en)) { return; }
                const enumName = (en.Name as string) || '';
                const childNode = new EnumValueNode(enumName, node, en);
                // Which <Element> of the file it was read from, if it was (EntrySource).
                recordOrigin(childNode, elementOriginAt(enumerals._elements, index));
                node.addChild(childNode);
            });
            // Said once for the entry, and the value kept as read, so an untouched save writes
            // it back whole; the rows are all an edit writes (C-190).
            if (reportNotElements(enumerals._elements as unknown[], name, 'enumeral', 'enumeration')) {
                node._keepNullElement(rawVal);
            }
        } else if (enumerals._elements !== undefined) {
            // A list of enumerals that is not a list (a hand-edited number, string, object or
            // `null`): no row, said once, and the value kept as read (C-190).
            reportNotAList(enumerals._elements, name, 'enumeral', 'enumeration');
            node._keepNullElement(rawVal);
        }
        return node;
    }
}

export default { EnumTypeNode, EnumValueNode };
