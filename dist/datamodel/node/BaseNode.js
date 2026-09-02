// Copyright 2026 The MathWorks, Inc.
import { buildPILayout } from './schemaBridge.js';
import { buildOtherRows } from './piOther.js';
// Columns the webview renders through a dedicated, format-specific branch (they
// consume a plain string cell and manage their own editability). Generic
// editable columns (the schema Code Generation columns) are NOT in this set, so
// only they receive the editable-object cell shape in toRow.
const DEDICATED_COLUMNS = new Set(['Name', 'Value', 'DataType', 'Class', 'Kind', 'Description', 'UsedBy', 'Status']);
export default class BaseNode {
    constructor(name, parent) {
        this.name = name;
        this.parent = parent;
        this.children = [];
    }
    get id() {
        return this.parent ? this.parent.id + '/' + this.name : this.name;
    }
    get icon() {
        return 'wsDefault';
    }
    // The raw class identity (e.g. 'Simulink.Bus', 'double'), shown in the Class
    // column.
    get className() {
        return '';
    }
    // The user-facing Kind (e.g. 'Bus', 'MATLAB Variable'), shown in the Kind
    // column. Base nodes with no friendlier name fall back to the class identity.
    get kind() {
        return this.className;
    }
    // The value shown in the Data Type column. Base nodes carry no distinct data
    // type, so this falls back to the class identity; DataNode narrows this to a
    // real data type only (empty for object types).
    get dataType() {
        return this.className;
    }
    get displayValue() {
        return '';
    }
    get disabled() {
        return false;
    }
    // A positional element of a container whose parent is a bare array/cell/string:
    // its name is a synthetic index (1, 2, …), not a real identifier.
    get isIndexedName() {
        return !!(this.parent &&
            (this.parent._kind === 'cell' || this.parent._kind === 'array' || this.parent._kind === 'string'));
    }
    // The sole signal for graying a Name cell: this node's displayed name is a
    // synthetic positional subscript, not a user-assigned identifier. Covers bare
    // array/cell/string indices (isIndexedName) and struct-array elements (which
    // carry a `Name(i)` alias in `_displayName`). Structural and independent of file
    // format — entries and struct FIELDS are never elements, so they render normally.
    get isElementName() {
        return this.isIndexedName || !!this._displayName;
    }
    // True when this node's CHILDREN are the properties of a MATLAB class object
    // (ObjectNode overrides it). A class property's name is fixed by the class
    // definition, so — unlike a struct field — it can never be renamed. Children
    // consult `this.parent?.isObjectPropertyBag` in nameEditable. Kept as a getter
    // on BaseNode (rather than an `instanceof ObjectNode` check) to avoid the import
    // cycle ObjectNode → DataNode → BaseNode.
    get isObjectPropertyBag() {
        return false;
    }
    get nameEditable() {
        if (this.isIndexedName) {
            return false;
        }
        if (this._displayName) {
            return false;
        }
        // A class property name is fixed by the class definition.
        if (this.parent?.isObjectPropertyBag) {
            return false;
        }
        return true;
    }
    // Called on a node after a structural edit added or removed a child of `child`
    // — i.e. one of ITS children changed shape, not this node's own list. Every node
    // ignores it: a tree row's existence is normally decided once, at parse time.
    // Simulink.Parameter is the exception, because its Value row exists only while
    // the value has something to expand into (see ParameterNode), so an edit two
    // levels down can add or remove that row.
    childStructureChanged(_child) { }
    canAddChild() {
        return false;
    }
    addChildNode() {
        return null;
    }
    addChild(child, index) {
        if (index !== undefined && index >= 0) {
            this.children.splice(index, 0, child);
        }
        else {
            this.children.push(child);
        }
        child.parent = this;
        return child;
    }
    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx >= 0) {
            this.children.splice(idx, 1);
            child.parent = null;
        }
    }
    _replaceWith(newNode) {
        if (!this.parent) {
            return false;
        }
        const idx = this.parent.children.indexOf(this);
        if (idx < 0) {
            return false;
        }
        newNode.parent = this.parent;
        this.parent.children[idx] = newNode;
        this.parent = null;
        return true;
    }
    // Flag the owning file as having unsaved changes. The `dirty` flag lives on the
    // source root (SlddNode/MatNode/ModelNode) — the node that knows about a file —
    // so any mutation deep in the tree has to walk up to find it. Silently does
    // nothing when the node is detached or the root is not a source (a bare subtree
    // in a test, or a section whose parent is not yet attached): a mutation with no
    // file behind it has nothing to mark.
    _markSourceDirty() {
        let root = this;
        while (root.parent) {
            root = root.parent;
        }
        const source = root;
        if (source.dirty !== undefined) {
            source.dirty = true;
        }
    }
    flatten() {
        const result = [];
        const stack = [this];
        while (stack.length > 0) {
            const node = stack.pop();
            result.push(node);
            for (let i = node.children.length - 1; i >= 0; i--) {
                stack.push(node.children[i]);
            }
        }
        return result;
    }
    get displayName() {
        if (this.parent &&
            (this.parent._kind === 'cell' || this.parent._kind === 'array' || this.parent._kind === 'string')) {
            const parentName = this.parent.displayName;
            const idx = this.parent.children.indexOf(this) + 1;
            const cols = this.parent._dims[1];
            const isMatrix = this.parent._dims[0] > 1 && cols > 1;
            if (this.parent._kind === 'cell') {
                return isMatrix
                    ? parentName + '{' + (Math.floor((idx - 1) / cols) + 1) + ',' + (((idx - 1) % cols) + 1) + '}'
                    : parentName + '{' + idx + '}';
            }
            return isMatrix
                ? parentName + '(' + (Math.floor((idx - 1) / cols) + 1) + ',' + (((idx - 1) % cols) + 1) + ')'
                : parentName + '(' + idx + ')';
        }
        return this._displayName || this.name;
    }
    get valueEditable() {
        const v = this.displayValue;
        if (v && v.charAt(0) === '<' && v.charAt(v.length - 1) === '>') {
            return false;
        }
        return true;
    }
    getPropInfo(PropClassRef) {
        const key = PropClassRef.key;
        let displayValue;
        if (PropClassRef.readValue) {
            displayValue = PropClassRef.readValue(this);
        }
        else {
            displayValue = PropClassRef.format(this[key]);
        }
        let editable = PropClassRef.editor !== 'label';
        if (key === 'Name') {
            editable = editable && this.nameEditable;
        }
        if (key === 'Value') {
            editable = editable && this.valueEditable;
        }
        return {
            key,
            displayName: PropClassRef.displayName,
            value: this[PropClassRef.nodeProperty || key],
            displayValue,
            editable,
            editor: PropClassRef.editor,
            options: PropClassRef.readOptions ? PropClassRef.readOptions(this) : undefined,
        };
    }
    toRow() {
        const parentId = this.parent && !this.parent.isContainer ? this.parent.id : null;
        const props = this.getProperties();
        const row = {
            ID: this.id,
            parent: parentId,
            Status: this.status || '',
        };
        for (let i = 0; i < props.length; i++) {
            const info = this.getPropInfo(props[i]);
            const column = props[i].column;
            if (column === null) {
                continue;
            }
            const colKey = column || info.key;
            if (colKey === 'Name') {
                row.Name = { label: info.displayValue, iconId: this.icon, disabled: this.disabled, editable: info.editable, element: this.isElementName };
            }
            else if (colKey === 'Value') {
                // A 'select' editor carries its dropdown options on the cell so the
                // webview can render a combobox instead of a text input.
                if (info.editor === 'select') {
                    row.Value = { text: info.displayValue, editable: info.editable, editor: 'select', options: info.options || [] };
                }
                else {
                    row.Value = info.displayValue;
                }
                row._valueEditable = info.editable;
            }
            else if (info.editable && !DEDICATED_COLUMNS.has(colKey)) {
                // An editable GENERIC column (e.g. the schema Code Generation columns).
                // Carry the editor + options onto the cell so the webview can open the
                // right editor. Columns with a dedicated webview render branch (DataType,
                // Class, …) consume a plain string and set their own editability, so they
                // are excluded here and fall through to the string form below.
                row[colKey] = { text: info.displayValue, editable: true, editor: info.editor, options: info.options };
            }
            else {
                row[colKey] = info.displayValue;
            }
        }
        if (!row.Name) {
            row.Name = { label: this.displayName, iconId: this.icon, disabled: this.disabled, editable: this.nameEditable, element: this.isElementName };
        }
        if (!('Value' in row)) {
            row.Value = this.displayValue;
            row._valueEditable = this.valueEditable;
        }
        if (!('DataType' in row)) {
            row.DataType = this.dataType;
        }
        if (!('Class' in row)) {
            row.Class = this.className;
        }
        if (!('Kind' in row)) {
            row.Kind = this.kind;
        }
        if (!('Description' in row)) {
            row.Description = this.Description || '';
        }
        return row;
    }
    getProperties() {
        return [];
    }
    // The Property Inspector layout (ordered groups → props). Default: the
    // declarative schema layout for this node's class, when one exists (see
    // schema/classes/*.json + buildPILayout). Node subclasses without a schema
    // layout override this to author their groups directly; a subclass may also
    // override to fully replace the schema-driven layout. Returns null when neither
    // a schema layout nor an override applies → no curated groups (toPIObject may
    // still show the "Other" group).
    getPILayout() {
        return buildPILayout(this.className);
    }
    toPIObject() {
        const layout = this.getPILayout();
        if (!layout) {
            return null;
        }
        const properties = [];
        const groups = [];
        const obj = { _id: { nodeId: this.id } };
        // Top-level raw `_properties` keys the curated/schema layout already shows, so
        // the "Other" catch-all below never re-lists them. A prop names its consumed
        // keys via `sourceKeys`; absent that, it consumes [nodeProperty ?? key].
        const shownKeys = new Set();
        for (let g = 0; g < layout.length; g++) {
            const groupDef = layout[g];
            const groupItems = [];
            for (let i = 0; i < groupDef.items.length; i++) {
                const PropClassRef = groupDef.items[i];
                const info = this.getPropInfo(PropClassRef);
                properties.push({
                    name: info.key,
                    displayName: info.displayName,
                    dataType: info.editor === 'bool' ? 'logical' : 'char',
                    renderer: info.editable ? 'rendererseditors/editors/TextBoxEditor' : 'rendererseditors/editors/LabelEditor',
                    inPlaceEditor: info.editable ? 'rendererseditors/editors/TextBoxEditor' : null,
                    editor: null,
                    editable: info.editable,
                    valid: true,
                });
                groupItems.push({ name: info.key, type: 'property' });
                obj[info.key] = info.displayValue;
                const keys = PropClassRef.sourceKeys ?? [PropClassRef.nodeProperty ?? PropClassRef.key];
                for (const k of keys) {
                    shownKeys.add(k);
                }
            }
            // Schema-driven classes open with a fixed "General" identity group, so group
            // titles are normally literal. A layout MAY still embed the `{name}` token to
            // fold its object name into a title (buildPILayout has no node instance); the
            // node substitutes its displayName here. Titles without the token pass through.
            const displayName = groupDef.group.replace('{name}', this.displayName);
            groups.push({
                name: displayName.replace(/[^A-Za-z0-9]+/g, '') + 'Group',
                type: 'group',
                displayName,
                items: groupItems,
                expanded: true,
            });
        }
        // "Other" catch-all: every remaining raw property this node carries but the
        // curated/schema layout did not surface. Namespaced property names ('Other.X')
        // avoid colliding with a group prop that shares a bare key.
        const rawProps = this.serial?._properties;
        const otherRows = buildOtherRows(rawProps, shownKeys);
        if (otherRows.length > 0) {
            const otherItems = [];
            for (const row of otherRows) {
                const propName = 'Other.' + row.name;
                properties.push({
                    name: propName,
                    displayName: row.name,
                    dataType: 'char',
                    renderer: 'rendererseditors/editors/LabelEditor',
                    inPlaceEditor: null,
                    editor: null,
                    editable: false,
                    valid: true,
                });
                otherItems.push({ name: propName, type: 'property' });
                obj[propName] = row.value;
            }
            groups.push({
                name: 'OtherGroup',
                type: 'group',
                displayName: 'Other',
                items: otherItems,
                expanded: false,
            });
        }
        return {
            propertySheet: { properties, groups },
            objects: [obj],
            showGroups: true,
            showDefaultGroup: false,
        };
    }
    serialize() {
        return null;
    }
}
//# sourceMappingURL=BaseNode.js.map