// Copyright 2026 The MathWorks, Inc.
import * as NodeRegistry from './NodeRegistry.js';
import MatlabVariableNode from './data/MatlabVariableNode.js';
import ConstantNode from './data/ConstantNode.js';
import StructNode from './data/StructNode.js';
import ObjectNode from './data/ObjectNode.js';
import ParameterNode from './data/ParameterNode.js';
import SignalNode from './data/SignalNode.js';
import { BusNode } from './data/BusNode.js';
import { ConnectionBusNode } from './data/ConnectionBusNode.js';
import { ServiceBusNode } from './data/ServiceBusNode.js';
import { EnumTypeNode } from './data/EnumTypeNode.js';
import AliasTypeNode from './data/AliasTypeNode.js';
import ConfigSetNode from './data/ConfigSetNode.js';
import VariantExpressionNode from './data/VariantExpressionNode.js';
import VariantVariableNode from './data/VariantVariableNode.js';
import LookupTableNode from './data/LookupTableNode.js';
import BreakpointNode from './data/BreakpointNode.js';
import NumericTypeNode from './data/NumericTypeNode.js';
import ValueTypeNode from './data/ValueTypeNode.js';
import VariantControlNode from './data/VariantControlNode.js';
import VariantBankNode from './data/VariantBankNode.js';
import VariantBankCoderInfoNode from './data/VariantBankCoderInfoNode.js';
import CustomObjectNode from './data/CustomObjectNode.js';
import ConfigSetRefNode from './data/ConfigSetRefNode.js';
import VariantConfigurationDataNode from './data/VariantConfigurationDataNode.js';
const CLASS_MAP = {
    'MatlabVariable': MatlabVariableNode,
    // A Constant is a derived MATLAB variable; registering it lets Architectural
    // Data offer "Add Constant" directly (addEntry('Constant') → a scalar Constant).
    'Constant': ConstantNode,
    'MatlabStruct': StructNode,
    'Simulink.Parameter': ParameterNode,
    // mpt.Parameter and mpt.Signal are the Embedded Coder subclasses of the two
    // classes above, and they are everywhere in production dictionaries: MPT
    // ("module packaging tool") is what a project switches to the moment it needs
    // custom storage classes and memory sections for code generation. A subclass
    // presents every property its superclass does, so it needs the superclass's
    // node and not one of its own — sharing the class rather than copying it is
    // also what keeps the two from drifting apart as the Parameter/Signal nodes
    // grow. The node reports the class it actually read (see ParameterNode's
    // className), so a user still sees `mpt.Parameter` in the Class column; only
    // the TREATMENT is inherited.
    //
    // Deliberately NOT added to any section's ALLOWED_TYPES: these are classes we
    // READ, not classes we offer to create. Nothing in the read path consults that
    // list — a parsed entry lands in a section by its metadata namespace — while
    // offering "Add mpt.Parameter" would mean claiming we write a well-formed
    // mpt object from scratch, which the MATLAB round-trip gate has never checked.
    'mpt.Parameter': ParameterNode,
    'Simulink.LookupTable': LookupTableNode,
    'Simulink.Breakpoint': BreakpointNode,
    'Simulink.Signal': SignalNode,
    'mpt.Signal': SignalNode,
    'Simulink.Bus': BusNode,
    'Simulink.ConnectionBus': ConnectionBusNode,
    'Simulink.ServiceBus': ServiceBusNode,
    'Simulink.NumericType': NumericTypeNode,
    'Simulink.AliasType': AliasTypeNode,
    'Simulink.ValueType': ValueTypeNode,
    'Simulink.data.dictionary.EnumTypeDefinition': EnumTypeNode,
    'Simulink.VariantExpression': VariantExpressionNode,
    'Simulink.VariantControl': VariantControlNode,
    'Simulink.VariantVariable': VariantVariableNode,
    'Simulink.VariantBank': VariantBankNode,
    'Simulink.VariantBankCoderInfo': VariantBankCoderInfoNode,
    'CustomObject': CustomObjectNode,
    'Simulink.ConfigSet': ConfigSetNode,
    'Simulink.ConfigSetRef': ConfigSetRefNode,
    'Simulink.VariantConfigurationData': VariantConfigurationDataNode,
    'Simulink.VariantConfigurations': VariantConfigurationDataNode
};
// A parsed value is only ever probed for MATLAB's structural marker keys
// (`_array_type`, `_array_class`, …) when it is a non-null object. Narrowing that
// once here lets each matcher below read as the single key test it actually is.
// Returns null for anything not object-shaped, so `asObject(v)?._k === x` is false
// for a primitive rather than throwing.
function asObject(val) {
    return val !== null && typeof val === 'object' ? val : null;
}
// ORDER IS SIGNIFICANT: parseValue takes the FIRST match, so the specific shapes
// (a cellstr, the tagged `_array_type`/`_object_class` forms, a Matrix payload)
// must precede the broad `Array.isArray` / primitive catch-alls below them.
const STRUCTURAL_PARSERS = [
    { matcher: (val) => Array.isArray(val) && val.length > 0 && val.every((el) => typeof el === 'string'), NodeClass: MatlabVariableNode },
    { matcher: (val) => asObject(val)?._array_type === 'String', NodeClass: MatlabVariableNode },
    { matcher: (val) => asObject(val)?._array_type === 'Struct', NodeClass: StructNode },
    { matcher: (val) => asObject(val)?._array_type === 'Cell', NodeClass: MatlabVariableNode },
    { matcher: (val) => { const o = asObject(val); return !!o && !!o._type && typeof o._value === 'string' && o._value.indexOf('Matrix(') === 0; }, NodeClass: MatlabVariableNode },
    { matcher: (val) => Array.isArray(val), NodeClass: MatlabVariableNode },
    { matcher: (val) => !!asObject(val)?._array_class, NodeClass: ObjectNode },
    { matcher: (val) => !!asObject(val)?._object_class, NodeClass: ObjectNode },
    { matcher: (val) => val === null || val === undefined || typeof val === 'number' || typeof val === 'boolean' || typeof val === 'string', NodeClass: MatlabVariableNode }
];
export function getClass(className) {
    return CLASS_MAP[className] || null;
}
export function parseValue(rawVal, name, parent) {
    const obj = asObject(rawVal);
    if (obj && obj._array_class) {
        // General array rule: a value object with MORE THAN ONE element is a
        // vector/matrix of objects (e.g. a 3x1 Simulink.Parameter, a 20x1
        // Simulink.VariableUsage). Expand it uniformly — regardless of class or
        // source format — into an ObjectNode array container that holds one child
        // per element, each element parsed as a SCALAR through its own typed node.
        // Only a SINGLE-element value object dispatches straight to its typed class.
        const elements = obj._elements || [];
        if (elements.length > 1) {
            return ObjectNode.parse(obj, name, parent);
        }
        const NodeClass = CLASS_MAP[obj._array_class];
        if (NodeClass) {
            return NodeClass.parse(rawVal, name, parent);
        }
        // An UNKNOWN _array_class falls through to the matcher chain, where the
        // `_array_class` entry routes it to ObjectNode as a generic object.
    }
    for (const { matcher, NodeClass } of STRUCTURAL_PARSERS) {
        if (matcher(rawVal)) {
            return NodeClass.parse(rawVal, name, parent);
        }
    }
    // No matcher claimed it: an object carrying none of MATLAB's structural marker
    // keys (so not reached by the chain's object entries, nor by its primitive
    // catch-all). MatlabVariableNode models it opaquely rather than dropping it.
    return MatlabVariableNode.parse(rawVal, name, parent);
}
export function getRegisteredClasses() {
    return Object.keys(CLASS_MAP);
}
// Reclass a just-parsed plain MATLAB variable as a Constant (for a derived, i.e.
// Architectural Data, entry). Only a bare MatlabVariableNode qualifies: an opaque
// MCOS object, a struct, or any object-class node keeps its own class. This is the
// single seam that makes Design↔Arch conversion automatic — SectionNode calls it
// after rebinding isderived, so a variable pasted into arch becomes a Constant and
// one pasted back into design reparses as a plain variable.
export function wrapDerivedVariable(node) {
    if (node.constructor === MatlabVariableNode && !node._isOpaque) {
        return ConstantNode.fromVariable(node);
    }
    return node;
}
// Installing into NodeRegistry is what makes this module's side-effect import
// (from the barrel and from src/node) load-bearing: every node class reaches the
// class map through the registry, so nothing else needs to import this file.
const api = { getClass, parseValue, getRegisteredClasses, wrapDerivedVariable };
NodeRegistry.init(api);
export default api;
//# sourceMappingURL=NodeClassMap.js.map