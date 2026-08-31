// Copyright 2026 The MathWorks, Inc.
import { BaseBusNode, BaseBusElementNode, PropName, PropDataType, PropDescription, PropKind, PropClassAtom, withSourceKeys } from './BaseBusNode.js';
const CLASS_NAME = 'Simulink.ConnectionBus';
// The default connection type when a physical element has no explicit domain.
const DEFAULT_CONNECTION_TYPE = 'Connection: <domain name>';
export class ConnectionBusElementNode extends BaseBusElementNode {
    constructor(name, parent, props, serial) {
        super(name, parent, props, serial);
        // The element's connection type is stored in Type_internal (falling back
        // to Type); when unset it is the generic 'Connection: <domain name>'.
        const rawType = props.Type_internal !== undefined ? props.Type_internal : props.Type;
        this.Type = rawType || DEFAULT_CONNECTION_TYPE;
    }
    // A derived PhysicalInterface's elements use the arch connection-element
    // icon; a plain Design Data ConnectionBus's use the workspace variant.
    get icon() { return this.parent?.isDerived ? 'typeConnectionElement' : 'wsConnectionElement'; }
    // The element's Class is its object class (Simulink.ConnectionElement), not
    // its mapped connection type — that belongs in the Data Type column below.
    get className() { return 'Simulink.ConnectionElement'; }
    // A connection element's mapped connection type is a real data type — show it.
    get dataType() { return this.Type; }
    getProperties() { return [PropName, PropDataType, PropDescription]; }
    // The Data Type column reads the connection type from the `Type_internal`
    // aliased raw key (falling back to `Type`), so widen sourceKeys to both
    // spellings — otherwise the alias leaks into the "Other" catch-all.
    // Common "General" identity group, then the element's value-semantics.
    // DataType widens sourceKeys to the `Type`/`Type_internal` aliases so neither
    // spelling leaks into "Other".
    getPILayout() {
        return [
            { group: 'General', items: [PropName, withSourceKeys(PropDataType, ['Type_internal', 'Type']), PropKind, PropClassAtom] },
            { group: 'Value Properties', items: [PropDescription] },
        ];
    }
    _applyElementOverrides(props) {
        const sp = this.serial._properties;
        const typeKey = 'Type_internal' in sp ? 'Type_internal' : 'Type';
        // Only write the type back when the source had it or it differs from the
        // implicit default, so untyped elements stay untouched.
        if (typeKey in sp || this.Type !== DEFAULT_CONNECTION_TYPE) {
            props[typeKey] = this.Type;
        }
        if ('Description' in sp || this.Description) {
            props.Description = this.Description;
        }
    }
}
export class ConnectionBusNode extends BaseBusNode {
    get icon() { return this.isDerived ? 'typeConnection' : 'wsConnectionBus'; }
    get className() { return CLASS_NAME; }
    _createElementNode(name, props, serial) { return new ConnectionBusElementNode(name, this, props, serial); }
    static { this.ELEMENT_CLASS_NAME = 'Simulink.ConnectionElement'; }
    static get defaultName() { return 'ConnectionBus'; }
    static createDefault(name, parent) { return BaseBusNode._createDefaultBus(name, parent, ConnectionBusNode, CLASS_NAME); }
    static parse(rawVal, name, parent) { return BaseBusNode._parseElements(rawVal, name, parent, ConnectionBusNode, ConnectionBusElementNode); }
}
export default { ConnectionBusNode, ConnectionBusElementNode };
//# sourceMappingURL=ConnectionBusNode.js.map