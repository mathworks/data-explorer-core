// Copyright 2026 The MathWorks, Inc.
// Whether an object of a MATLAB class has a Description property: MATLAB R2027a's answer to
// isprop(obj, 'Description'), measured on 2026-10-24 for every class the test fixtures hold an
// object of (test/parity/matlab/probe_description_isprop.m, test/descriptionApplies.test.ts).
// Asked by ObjectNode, which holds an object of any class; a node of its own class answers for
// its class itself (BaseNode.descriptionApplies). A table's is the Description of its Properties,
// which isprop answers for. A registered subclass answers as the class it extends.
//
// A leaf, as registeredSubclasses is, so that any node module can read it without a cycle.
import { superclassOf } from './registeredSubclasses.js';
const HAS_DESCRIPTION = new Set([
    'Simulink.AliasType',
    'Simulink.Bus',
    'Simulink.BusElement',
    'Simulink.ConfigSet',
    'Simulink.ConfigSetRef',
    'Simulink.ConnectionBus',
    'Simulink.ConnectionElement',
    'Simulink.NumericType',
    'Simulink.Parameter',
    'Simulink.ServiceBus',
    'Simulink.Signal',
    'Simulink.SolverCC',
    'Simulink.ValueType',
    'Simulink.VariantBank',
    'Simulink.data.dictionary.EnumTypeDefinition',
    'Simulink.lookuptable.Breakpoint',
    'Simulink.lookuptable.Table',
    'table',
]);
const HAS_NONE = new Set([
    'Simulink.Breakpoint',
    'Simulink.CoderInfo',
    'Simulink.FunctionElement',
    'Simulink.LoggingInfo',
    'Simulink.LookupTable',
    'Simulink.VariableUsage',
    'Simulink.VariantBankCoderInfo',
    'Simulink.VariantConfigurations',
    'Simulink.VariantControl',
    'Simulink.VariantExpression',
    'Simulink.VariantVariable',
    'Simulink.lookuptable.StructTypeInfo',
    'SimulinkCSC.AttribClass_Simulink_Default',
    'matlab.lang.OnOffSwitchState',
    'containers.Map',
    'datetime',
    'categorical',
    'embedded.fi',
]);
/** Whether an object of `className` has a Description, as MATLAB says; null for a class not measured. */
export function classHasDescription(className) {
    const cls = superclassOf(className) ?? className;
    if (HAS_DESCRIPTION.has(cls)) {
        return true;
    }
    return HAS_NONE.has(cls) ? false : null;
}
//# sourceMappingURL=descriptionClasses.js.map