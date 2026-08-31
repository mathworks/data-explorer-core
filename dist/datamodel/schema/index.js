// Copyright 2026 The MathWorks, Inc.
import core from './props/core.json' with { type: "json" };
import dataObject from './props/dataObject.json' with { type: "json" };
import codeGen from './props/codeGen.json' with { type: "json" };
import typeObject from './props/typeObject.json' with { type: "json" };
import parameter from './classes/parameter.json' with { type: "json" };
import signal from './classes/signal.json' with { type: "json" };
import valueType from './classes/valueType.json' with { type: "json" };
import aliasType from './classes/aliasType.json' with { type: "json" };
import numericType from './classes/numericType.json' with { type: "json" };
import enumType from './classes/enumType.json' with { type: "json" };
import bus from './classes/bus.json' with { type: "json" };
import connectionBus from './classes/connectionBus.json' with { type: "json" };
import serviceBus from './classes/serviceBus.json' with { type: "json" };
import variantControl from './classes/variantControl.json' with { type: "json" };
import variantExpression from './classes/variantExpression.json' with { type: "json" };
import variantVariable from './classes/variantVariable.json' with { type: "json" };
import variantBank from './classes/variantBank.json' with { type: "json" };
import variantBankCoderInfo from './classes/variantBankCoderInfo.json' with { type: "json" };
import variantConfigurationData from './classes/variantConfigurationData.json' with { type: "json" };
import configSet from './classes/configSet.json' with { type: "json" };
import configSetRef from './classes/configSetRef.json' with { type: "json" };
import lookupTable from './classes/lookupTable.json' with { type: "json" };
import breakpoint from './classes/breakpoint.json' with { type: "json" };
import customObject from './classes/customObject.json' with { type: "json" };
const REGISTRY = {
    ...core,
    ...dataObject,
    ...codeGen,
    ...typeObject,
};
// A class file authors either the new object form ({ props, layout }) or the
// legacy bare reference array. Normalize both to ClassDef so the rest of the
// loader is shape-agnostic.
function normalizeClassDef(raw) {
    if (Array.isArray(raw)) {
        return { props: raw };
    }
    return raw;
}
const CLASS_DEFS = Object.fromEntries(Object.entries({
    ...parameter,
    ...signal,
    ...valueType,
    ...aliasType,
    ...numericType,
    ...enumType,
    ...bus,
    ...connectionBus,
    ...serviceBus,
    ...variantControl,
    ...variantExpression,
    ...variantVariable,
    ...variantBank,
    ...variantBankCoderInfo,
    ...variantConfigurationData,
    ...configSet,
    ...configSetRef,
    ...lookupTable,
    ...breakpoint,
    ...customObject,
}).map(([cls, def]) => [cls, normalizeClassDef(def)]));
const cache = new Map();
function resolveRef(ref) {
    const key = typeof ref === 'string' ? ref : ref.$ref;
    const base = REGISTRY[key];
    if (!base) {
        return null;
    }
    const override = typeof ref === 'string' ? {} : ref;
    // base ⊕ override; drop the $ref marker. Never mutate the registry entry.
    const merged = { ...base, ...override };
    delete merged.$ref;
    return { key, ...merged };
}
// Returns the ordered, resolved property descriptors for a className, or
// undefined if the class has no schema (caller falls back to legacy behavior).
export function getSchema(className) {
    if (cache.has(className)) {
        return cache.get(className);
    }
    const def = CLASS_DEFS[className];
    const resolved = def ? def.props.map(resolveRef).filter((p) => p !== null) : undefined;
    cache.set(className, resolved);
    return resolved;
}
// The Property Inspector layout (ordered groups → prop keys) declared for a
// className, or undefined if the class has no schema or authors no layout. This
// is the single declarative source of PI grouping/order; the node's atom bridge
// resolves each key to a renderable property.
export function getLayout(className) {
    return CLASS_DEFS[className]?.layout;
}
// The classNames that have a schema (the keys of the class-definition registry).
// Lets a host/UI layer enumerate schema-backed classes without a node instance.
export function getSchemaClasses() {
    return Object.keys(CLASS_DEFS);
}
// Given a container object and the next path segment, return the object that
// directly holds that key. Model sub-objects nest their fields one of two ways:
//   flat MCOS:      { _object_class, _properties: { key: ... } }
//   MATLABArray:    { _array_class, _mw_element_type: 'MATLABArray', _elements: [ { _properties: { key: ... } } ] }
// so if the key is not already at the top level, descend into whichever inner
// bag actually carries it. Returns the container unchanged when nothing matches
// (so `container[key]` then yields undefined).
function propertyBag(container, key) {
    if (key in container) {
        return container;
    }
    const inner = container._properties;
    if (inner && typeof inner === 'object' && key in inner) {
        return inner;
    }
    const elements = container._elements;
    if (Array.isArray(elements) && elements[0] && typeof elements[0] === 'object') {
        const elemProps = elements[0]._properties;
        if (elemProps && typeof elemProps === 'object') {
            return elemProps;
        }
    }
    return container;
}
// Unwrap a typed-scalar leaf `{ _type, _value }` (e.g. an int32 stored as
// { _type:'int32', _value:'-1' }) to a primitive. Numeric MATLAB types coerce to
// Number; everything else returns the raw `_value`. Plain values pass through.
function unwrapScalar(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const o = value;
        if ('_type' in o && '_value' in o) {
            const t = String(o._type);
            if (/^u?int|^double$|^single$/.test(t)) {
                const n = Number(o._value);
                return Number.isNaN(n) ? o._value : n;
            }
            return o._value;
        }
    }
    return value;
}
// Walk a dotted sourcePath against a `_properties` bag. Non-terminal hops descend
// through nested sub-objects (flat `_properties` OR MATLABArray-wrapped
// `_elements[0]._properties`). Returns undefined if any hop is absent — the caller
// then substitutes the descriptor's default. Typed-scalar leaves are unwrapped.
export function resolveSourcePath(properties, path) {
    if (!properties) {
        return undefined;
    }
    const parts = path.split('.');
    let current = properties;
    for (let i = 0; i < parts.length; i++) {
        if (current === null || current === undefined || typeof current !== 'object') {
            return undefined;
        }
        const bag = propertyBag(current, parts[i]);
        current = bag[parts[i]];
    }
    return unwrapScalar(current);
}
// Given a container and the next path segment, return the bag a value should be
// WRITTEN into — the write-side mirror of propertyBag. Unlike the read side, the
// leaf key need not already exist (we may be adding an omitted default), so we
// pick the bag by container shape: an inner `_properties` (flat MCOS) or
// `_elements[0]._properties` (MATLABArray) if present, else the container itself.
function writableBag(container) {
    const inner = container._properties;
    if (inner && typeof inner === 'object') {
        return inner;
    }
    const elements = container._elements;
    if (Array.isArray(elements) && elements[0] && typeof elements[0] === 'object') {
        const elemProps = elements[0]._properties;
        if (elemProps && typeof elemProps === 'object') {
            return elemProps;
        }
    }
    return container;
}
// Write `value` at a dotted sourcePath in a `_properties` bag, mutating in place.
// Non-terminal hops descend into nested sub-objects (flat `_properties` OR
// MATLABArray-wrapped `_elements[0]._properties`) via writableBag. A pre-existing
// typed-scalar leaf `{_type,_value}` keeps its shape (only `_value` is rewritten,
// stringified to match the parsed form); any other leaf is written as the plain
// value. Returns false without mutating if an intermediate sub-object is absent
// (we never synthesize e.g. a missing CoderInfo). Display/edit-only; the caller
// owns dirty-marking and serialization.
export function writeSourcePath(properties, path, value) {
    if (!properties) {
        return false;
    }
    const parts = path.split('.');
    let current = properties;
    for (let i = 0; i < parts.length - 1; i++) {
        const next = propertyBag(current, parts[i])[parts[i]];
        if (next === null || next === undefined || typeof next !== 'object') {
            return false;
        }
        current = next;
    }
    const leafKey = parts[parts.length - 1];
    const bag = writableBag(current);
    if (!bag) {
        return false;
    }
    const existing = bag[leafKey];
    if (existing && typeof existing === 'object' && !Array.isArray(existing) && '_type' in existing && '_value' in existing) {
        existing._value = String(value);
    }
    else {
        bag[leafKey] = value;
    }
    return true;
}
// Read a property's value from a `_properties` bag for DISPLAY, substituting the
// descriptor's declared default when the value is absent. This is display-only:
// it never writes back to the bag, so serialization stays minimal (defaults are
// not persisted). Returns the raw value; the caller/app formats by `prop.type`.
export function hydrate(properties, prop) {
    const raw = resolveSourcePath(properties, prop.sourcePath);
    return raw === undefined ? prop.default : raw;
}
//# sourceMappingURL=index.js.map