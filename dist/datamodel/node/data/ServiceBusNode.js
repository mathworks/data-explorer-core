// Copyright 2026 The MathWorks, Inc.
import { BaseBusNode, BaseBusElementNode, PropName, PropKind, PropClassAtom } from './BaseBusNode.js';
import { renameFunctionInCatalog, renamedPrototype } from '../../parser/ScCatalog.js';
const CLASS_NAME = 'Simulink.ServiceBus';
// A ServiceBus element is a Simulink.FunctionElement (one service function). The
// element name is the function name, and the Value column shows the function's
// Prototype (e.g. "y = f(u,v)").
export class FunctionElementNode extends BaseBusElementNode {
    constructor(name, parent, props, serial) {
        super(name, parent, props, serial);
        this.Prototype = props.Prototype || '';
    }
    get icon() { return 'function'; }
    get className() { return 'Simulink.FunctionElement'; }
    // A function element has no meaningful data type — the DataType column is
    // empty (not applicable).
    get dataType() { return ''; }
    get displayValue() { return this.Prototype; }
    // A Simulink.FunctionElement has only Name / Prototype / Asynchronous /
    // Arguments (verified against MATLAB) — notably NO Description and NO
    // DataType. Surfacing those foreign props previously let an edit inject a key
    // the object doesn't own; we list just Name here (the Value column shows the
    // Prototype via displayValue).
    getProperties() { return [PropName]; }
    // Common "General" identity group. DataType/Description are intentionally
    // absent (a FunctionElement owns neither — see note above); the Value column
    // shows the Prototype via displayValue.
    getPILayout() { return [{ group: 'General', items: [PropName, PropKind, PropClassAtom] }]; }
    // In MATLAB the Name is the function the Prototype declares: setting the Name renames
    // that function in the Prototype (see Simulink.FunctionElement.md). So a rename here
    // renames it too, in this same call, which is what makes it one edit: the session's
    // undo replays setProperty('Name', old), which renames it back, and a host that
    // rewrites the owning entry writes both fields. A Prototype in which the function
    // cannot be found unambiguously refuses the rename and changes neither field, so a
    // Name the Prototype contradicts is never written.
    setProperty(propName, stringValue) {
        if (this._resolveProperty(propName) !== 'name' || stringValue === this.name) {
            return super.setProperty(propName, stringValue);
        }
        const prototype = renamedPrototype(this.Prototype, this.name, stringValue);
        if (prototype === null) {
            return {
                error: true,
                reason: `'${this.name}' cannot be renamed: its Prototype '${String(this.Prototype)}' does not declare the function '${this.name}' in the form [outputs =] ${this.name}(inputs), so the Prototype cannot be renamed with it, and MATLAB requires the two to match.`,
                invalidValue: stringValue,
                validValue: this.name,
            };
        }
        // The usual name checks (identifier, sibling uniqueness) still decide; the
        // Prototype moves only when the Name did.
        const oldName = this.name;
        const result = super.setProperty(propName, stringValue);
        if (result === true) {
            this.Prototype = prototype;
            this._functionRenamed(oldName, this.name);
        }
        return result;
    }
    // The System Composer catalog keeps its own copy of each function of a service
    // interface (`p_Name` / `p_FunctionPrototype`), so a rename is recorded there for the save
    // to carry (ScCatalog.renameFunctionInCatalog). Only for the function of an ENTRY: its
    // bus's parent is a section (the one parent with `_entryRenamed`), whose parent is the
    // dictionary holding the catalog. Undo replays this setter, so it records the way back.
    _functionRenamed(oldName, newName) {
        const bus = this.parent;
        const section = bus?.parent;
        if (!bus || typeof section?._entryRenamed !== 'function') {
            return;
        }
        const dictionary = section.parent;
        renameFunctionInCatalog(dictionary?.systemComposer, bus.name, oldName, newName);
    }
    // The Prototype is written back only once it is no longer the one read, so a
    // FunctionElement that was not renamed saves its Prototype exactly as it came in.
    _applyElementOverrides(props) {
        super._applyElementOverrides(props);
        if (this.Prototype !== (props.Prototype || '')) {
            props.Prototype = this.Prototype;
        }
    }
}
export class ServiceBusNode extends BaseBusNode {
    // A derived ServiceBus is an Architectural Data ServiceInterface.
    get icon() { return this.isDerived ? 'serviceInterfaces' : 'wsDefault'; }
    get className() { return CLASS_NAME; }
    // A service interface has no scalar value — the Value column is empty and not
    // editable, matching the other bus-like interface types.
    get displayValue() { return ''; }
    get valueEditable() { return false; }
    _createElementNode(name, props, serial) { return new FunctionElementNode(name, this, props, serial); }
    // Add a new service function. Unlike a plain bus element, a
    // Simulink.FunctionElement carries a Prototype ("y = fn(u,v)") and an
    // Arguments BusElement array [u, v, y]. The function name fn uses an
    // increasing number so it stays unique, and the element plus each argument
    // get fresh entry-scoped _ids (past every id already in use, including the
    // nested argument ids of sibling functions).
    addChildNode() {
        const existing = new Set(this.children.map(function (c) { return c.name; }));
        let n = this.children.length;
        let fnName = 'f' + n;
        while (existing.has(fnName)) {
            n++;
            fnName = 'f' + n;
        }
        const prototype = 'y = ' + fnName + '(u,v)';
        let id = this._maxElementId();
        const elemId = String(++id);
        const argNames = ['u', 'v', 'y'];
        const argElements = argNames.map(function (argName) {
            return { _id: String(++id), _properties: { Complexity: 'real', Dimensions: 1, DimensionsMode: 'Fixed', DocUnits: '', Name: argName } };
        });
        const props = {
            Arguments: { _array_class: 'Simulink.BusElement', _dimensions: [argElements.length, 1], _elements: argElements },
            Asynchronous: false,
            Name: fnName,
            Prototype: prototype,
        };
        const childSerial = { _rawElem: { _id: elemId, _properties: props }, _properties: props };
        const childNode = new FunctionElementNode(fnName, this, props, childSerial);
        this.addChild(childNode);
        this._markModified();
        return childNode;
    }
    static { this.ELEMENT_CLASS_NAME = 'Simulink.FunctionElement'; }
    static get defaultName() { return 'ServiceInterface'; }
    static createDefault(name, parent) { return BaseBusNode._createDefaultBus(name, parent, ServiceBusNode, CLASS_NAME); }
    static parse(rawVal, name, parent) { return BaseBusNode._parseElements(rawVal, name, parent, ServiceBusNode, FunctionElementNode); }
}
export default { ServiceBusNode, FunctionElementNode };
//# sourceMappingURL=ServiceBusNode.js.map