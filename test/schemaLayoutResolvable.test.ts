// Copyright 2026 The MathWorks, Inc.
//
// THE GUARD FOR THE DEFECT CLASS THIS CHANGE FIXED THREE TIMES.
//
// The bug, stated as a mechanism rather than as three symptoms. `resolvePropForKey`
// (schemaBridge.ts) prefers `ATOM_BY_KEY` over the class's schema descriptor, and the atoms
// in that map read NODE FIELDS, not the descriptor's `sourcePath`. Nothing checked that the
// node class actually declares the field the atom reads. When it did not, two things went
// wrong at once:
//
//   - the Property Inspector row rendered blank — `getPropInfo` falls through to
//     `PropClassRef.format(this[key])`, and `format(undefined)` is '';
//   - `BaseNode.toPIObject` still added the layout key to `shownKeys`, so `buildOtherRows`
//     suppressed the raw source property from the "Other" catch-all as well.
//
// So a value that WAS in the file became unreachable in BOTH panes — not merely unstyled or
// misplaced, but gone. `Simulink.ValueType` shipped that way for `min`/`max`/`unit`;
// `Simulink.ConfigSet` and `Simulink.ConfigSetRef` would have shipped that way for
// `description` had the node fields not been added alongside the layout keys.
//
// THE INVARIANT this file pins, and the only one it pins: if the source carries a value at
// a layout key's source location, the Property Inspector row for that key must DISPLAY it.
// Empty is allowed when the source is empty. What is not allowed is a source value that
// vanishes.
//
// This is deliberately a guard over the SEAM and not over the twenty classes. Three separate
// per-class tests (valueTypeValueProps.test.ts, configSetSchemaProps.test.ts,
// schema/schemaBridge.test.ts) each pin one instance of the rule; none of them could see the
// NEXT class to get it wrong, because each was written after the fact from the symptom. The
// same shape as moduleBoundaries.test.ts: assert the rule between the paths, not each path.
//
// WHY THE THREE ASSERTIONS ARE ALL HERE, and none is redundant:
//
//   1. The sentinel sweep. For every (class, layout key) pair that HAS a source location,
//      build a real node whose serial carries a distinctive sentinel there, render the real
//      Property Inspector, and require the sentinel to appear in that key's row. This is the
//      invariant stated directly, and it is the only assertion that can catch a row that is
//      wired to the wrong location rather than to no location.
//   2. The structural check. No layout row may read a node field the INSTANCE does not have.
//      Cheaper, and it catches the trap the sweep would only catch on a class it can build:
//      a TypeScript `field?: string` declaration that is never assigned does not exist at
//      runtime (`useDefineForClassFields: false` emits nothing for it), which is exactly why
//      `ConfigSetNode.Description` was broken while LOOKING declared — `BaseNode` declares
//      `Description?: string` for every node. So this tests the instance, never the class.
//   3. The self-check. A deliberately broken case, run through the same checking logic, must
//      REPORT a failure. Without it, assertions 1 and 2 are two hundred lines of code that
//      have never been observed to fail, which is not evidence of anything.
//
// The sweep's coverage is asserted, not assumed (the "reading the tree" block below). A guard
// whose coverage can silently shrink to zero is worse than no guard: it reports success while
// checking nothing.
import { describe, it, expect } from 'vitest';
import { getLayout, getSchema, getSchemaClasses } from '../src/datamodel/schema/index.js';
import type { ResolvedProp } from '../src/datamodel/schema/types.js';
import { buildPILayout } from '../src/datamodel/node/schemaBridge.js';
import type { PropClass } from '../src/datamodel/node/BaseNode.js';
import NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import PropName from '../src/datamodel/prop/PropName.js';
import PropValue from '../src/datamodel/prop/PropValue.js';
import PropDataType from '../src/datamodel/prop/PropDataType.js';
import PropKind from '../src/datamodel/prop/PropKind.js';
import PropClassAtom from '../src/datamodel/prop/PropClass.js';
import PropBaseType from '../src/datamodel/prop/PropBaseType.js';
import PropCondition from '../src/datamodel/prop/PropCondition.js';
import PropSpecification from '../src/datamodel/prop/PropSpecification.js';
import PropEnumValue from '../src/datamodel/prop/PropEnumValue.js';
import PropMin from '../src/datamodel/prop/PropMin.js';
import PropMax from '../src/datamodel/prop/PropMax.js';
import PropUnit from '../src/datamodel/prop/PropUnit.js';
import PropDescription from '../src/datamodel/prop/PropDescription.js';
import '../src/datamodel/node/data/NodeClassMap.js';

// ─────────────────────────────────────────────────────────────────────────────────────────
// The atom map, mirrored BY IDENTITY
// ─────────────────────────────────────────────────────────────────────────────────────────

// schemaBridge's `ATOM_BY_KEY` is module-private, and so is `resolvePropForKey`. This is the
// same map, and it is checked against the real one BY OBJECT IDENTITY below (`resolved ===
// LAYOUT_ATOMS[key]`) rather than by name — so it cannot describe an atom the bridge does not
// actually use, in either direction:
//
//   - production adds an atom key a layout references → the bridge returns an atom this map
//     does not have, the identity check has nothing to compare, and the fallback assertion
//     (a descriptor-resolved row is keyed by the layout key itself) fails on the atom's
//     capitalised key. The mirror must be updated.
//   - production removes one → the bridge returns a descriptor where this map claims an atom,
//     and the identity check fails.
//
// A mirror that could quietly go stale would be worse than none: it would decide the source
// location for every row in the sweep.
const LAYOUT_ATOMS: Record<string, PropClass> = {
    name: PropName as unknown as PropClass,
    value: PropValue as unknown as PropClass,
    dataType: PropDataType as unknown as PropClass,
    kind: PropKind as unknown as PropClass,
    class: PropClassAtom as unknown as PropClass,
    baseType: PropBaseType as unknown as PropClass,
    condition: PropCondition as unknown as PropClass,
    specification: PropSpecification as unknown as PropClass,
    enumValue: PropEnumValue as unknown as PropClass,
    min: PropMin as unknown as PropClass,
    max: PropMax as unknown as PropClass,
    unit: PropUnit as unknown as PropClass,
    description: PropDescription as unknown as PropClass,
};

// ─────────────────────────────────────────────────────────────────────────────────────────
// The exemption allowlist: keys that genuinely have NO source location
// ─────────────────────────────────────────────────────────────────────────────────────────

// A layout key is exempt from the sweep only when there is nothing in the file to sweep FOR:
// the row's value is COMPUTED from the live node, so no `_properties` key exists that a
// sentinel could be planted at. The test does not take that on trust — an atom that computes
// its value is exactly an atom that declares `readValue`, and the derived set is asserted
// equal to this list below. Two consequences, both wanted: a new computed atom has to be
// added here deliberately, and an atom that LOSES its `readValue` (becoming field-backed, the
// shape that broke) falls into the sweep instead of quietly out of it.
//
// Each entry says why that key has no source, because "it is computed" is the claim being
// made and it is falsifiable per key.
const COMPUTED_NO_SOURCE: Record<string, string> = {
    // PropName.readValue → node.displayName. The row shows the ENTRY name (the dictionary key
    // the object is stored under), which is not `_properties.Name`: renaming an entry moves
    // the former and, for most classes, never writes the latter. ConfigSetNode makes the
    // point — its `ConfigName` is a getter over `this.name` precisely because holding a second
    // copy let the two drift and saved the stale one.
    name: 'reads node.displayName — the entry name, not a _properties key',
    // PropValue.readValue → node.displayValue, a per-class derivation (a summary form like
    // `<1x12 double>` for a large Parameter, '' for a class with no scalar value, a quoted
    // MATLAB literal for a char). No single source key holds what this row shows.
    value: 'reads node.displayValue — a per-class derivation, not one source key',
    // PropDataType.readValue → node.dataType, a getter: ParameterNode/SignalNode default an
    // absent DataType to 'auto', a bus element resolves `DataType_internal`, an enumeral has
    // none at all.
    dataType: 'reads the node.dataType getter, which resolves aliases and defaults',
    // PropKind.readValue → node.kind, the user-facing label ('Simulink Parameter', 'Value
    // Type'). Derived from the class plus classification/derived/MATLAB-variable overrides;
    // nothing in the file spells it.
    kind: 'reads the node.kind getter — a label derived from the class, never stored',
    // PropClassAtom.readValue → node.className. Comes off the raw value's `_array_class`
    // envelope, not from a property inside the `_properties` bag.
    class: 'reads the node.className getter — the _array_class envelope, not a property',
    // PropEnumValue.readValue → node.displayValue, which falls back to the FIRST enumeral when
    // the enum declares no DefaultValue. The fallback is the reason this is computed: the row
    // has a value for an enum whose file carries no such key at all.
    enumValue: 'reads node.displayValue, which falls back to the first enumeral child',
};

// ─────────────────────────────────────────────────────────────────────────────────────────
// Sentinels
// ─────────────────────────────────────────────────────────────────────────────────────────

// A sentinel has to be type-appropriate or the node refuses it before the row is ever
// reached: a char in a Min normalized as a number, a bogus enumeral in a StorageClass. And
// there have to be TWO of them per case. One is not enough — a row hard-wired to a constant,
// or one reading a DIFFERENT property that happens to hold the same text, passes a
// single-value test. Requiring the row to CHANGE when the source changes is what makes the
// assertion about the source rather than about the string.
type ProbeKind = 'string' | 'number' | 'bool' | 'dims' | 'option';
interface Probe {
    value: unknown;
    // The text the row must CONTAIN. `includes` rather than equality because some atoms
    // legitimately decorate: PropCondition/PropSpecification quote through formatMatlabChar,
    // so 'sentinelAlpha' displays as `'sentinelAlpha'`. The pairing with the A≠B check keeps
    // that from weakening the assertion.
    text: string;
}

const SENTINEL_A = 'sentinelAlpha';
const SENTINEL_B = 'sentinelBravo';

function probePair(kind: ProbeKind, options?: string[]): [Probe, Probe] {
    switch (kind) {
        case 'string':
            return [{ value: SENTINEL_A, text: SENTINEL_A }, { value: SENTINEL_B, text: SENTINEL_B }];
        // Distinctive integers, and one negative: Min/Max/Alignment/SampleTime all take
        // negative values in real files, so a sign-dropping format would show here.
        case 'number':
            return [{ value: 4242, text: '4242' }, { value: -7, text: '-7' }];
        case 'bool':
            return [{ value: true, text: 'true' }, { value: false, text: 'false' }];
        // Spelled the way MATLAB's mat2str spells a row — space-separated, which is what
        // formatSchemaValue and PropDimensions both produce. Different LENGTHS as well as
        // different numbers, so a row showing only the first element still fails.
        case 'dims':
            return [{ value: [4242, 7], text: '[4242 7]' }, { value: [9, 9, 9], text: '[9 9 9]' }];
        // A 'select' descriptor only accepts its own enumerals, so the sentinel has to be
        // one. The LAST two, never options[0]: that first entry is the declared default for
        // every option list in the registry today ('Auto'), and a row that ignored the source
        // entirely would display the default and pass. The case builder re-checks that
        // independently rather than relying on this comment.
        case 'option': {
            const opts = options as string[];
            const a = opts[opts.length - 1];
            const b = opts[opts.length - 2];
            return [{ value: a, text: a }, { value: b, text: b }];
        }
    }
}

// The probe kind for a DESCRIPTOR-resolved key, taken off the descriptor itself so a
// re-typed property is probed the new way without an edit here. `null` means "this test does
// not know how to make a value of that type" — recorded as a problem, never skipped silently.
function descriptorProbeKind(prop: ResolvedProp): ProbeKind | null {
    if (prop.options && prop.options.length >= 2) {
        return 'option';
    }
    switch (prop.type) {
        case 'dims': return 'dims';
        case 'bool': return 'bool';
        // 'any' covers the numeric-or-expression properties (Min/Max/StoredIntegerMinimum/
        // SampleTime/Slope/Bias/Bank); 'int' covers Alignment. A number is legal for all.
        case 'int': return 'number';
        case 'any': return 'number';
        case 'string': return 'string';
        default: return null;
    }
}

// The probe kind for a FIELD-BACKED atom, which has no descriptor to ask — the kind follows
// from the node field the atom reads. Listed rather than inferred because getting this wrong
// is silent: a string in Min is normalized away and the row would go blank for a reason that
// has nothing to do with the invariant. A field-backed atom missing from this map is recorded
// as a problem, so a new one cannot join a layout without a probe.
const ATOM_PROBE_KIND: Record<string, ProbeKind> = {
    min: 'number',
    max: 'number',
    unit: 'string',
    description: 'string',
    baseType: 'string',
    condition: 'string',
    specification: 'string',
};

// ─────────────────────────────────────────────────────────────────────────────────────────
// Building the source bag
// ─────────────────────────────────────────────────────────────────────────────────────────

// The 1x1 MATLABArray envelope MATLAB writes around a scalar object, as both parse paths hand
// it over — the same helper configSetSchemaProps.test.ts and schema/piGeneralAllNodes.test.ts
// use, so the sweep exercises the shape the product really sees.
function rawValue(className: string, properties: Record<string, unknown>): Record<string, unknown> {
    return {
        _array_class: className,
        _array_type: 'MATLABArray',
        _dimensions: [1, 1],
        _mw_element_type: 'MATLABArray',
        _elements: [{ _properties: properties }],
    };
}

// The `_object_class` MATLAB writes for each sub-object a nested sourcePath traverses, read
// off test/parity/artifacts/text/params.sldd (a real MATLAB-written dictionary). A nested
// probe has to be a real nested bag — `{_object_class, _properties}` at EVERY level — and not
// a plain dotted object, because that nesting is the thing `resolveSourcePath`/`propertyBag`
// walk: a flat `{'CoderInfo.StorageClass': x}` would be found by nothing and would prove
// nothing about how a real file resolves.
const OBJECT_CLASS_OF: Record<string, string> = {
    CoderInfo: 'Simulink.CoderInfo',
    CustomAttributes: 'SimulinkCSC.AttribClass_Simulink_Default',
    StructTypeInfo: 'Simulink.lookuptable.StructTypeInfo',
};

// A `_properties` bag holding `value` at `sourcePath`, and nothing else. Nothing else on
// purpose: a bag with one key makes it unambiguous which property a row is reading, and it is
// also the harshest case — the node gets no help from any other key.
function bagWithProbe(sourcePath: string, value: unknown): Record<string, unknown> {
    const parts = sourcePath.split('.');
    let current: unknown = value;
    for (let i = parts.length - 1; i >= 1; i--) {
        const owner = parts[i - 1];
        const objectClass = OBJECT_CLASS_OF[owner];
        if (!objectClass) {
            throw new Error(
                `No _object_class recorded for the '${owner}' sub-object of sourcePath '${sourcePath}'. ` +
                'Add it to OBJECT_CLASS_OF, taken from a MATLAB-written fixture — not invented.',
            );
        }
        current = { _object_class: objectClass, _properties: { [parts[i]]: current } };
    }
    return { [parts[0]]: current };
}

// A real node of `className`, built through the class the registry routes that name to — the
// same class a parsed file gets. `getClass` rather than `parseValue` so the node under test is
// the one registered for the className, not whatever the value's SHAPE would route to.
function buildNode(className: string, properties: Record<string, unknown>): Record<string, unknown> | null {
    const NodeClass = NodeRegistry.getClass(className);
    if (!NodeClass) {
        return null;
    }
    return NodeClass.parse(rawValue(className, properties), 'sentinelEntry', null) as unknown as Record<string, unknown>;
}

// What the Property Inspector actually DISPLAYS, keyed by row name — the `objects` bag, not
// the property sheet. The sheet says a row exists; this says what is in it, and "the row
// exists but is blank" is the whole defect.
function piBag(node: Record<string, unknown>): Record<string, unknown> {
    const pi = (node as unknown as { toPIObject(): { objects: unknown[] } | null }).toPIObject();
    if (!pi) {
        throw new Error('toPIObject() returned null — the node resolved no PI layout at all');
    }
    return pi.objects[0] as Record<string, unknown>;
}

// The PropClasses the node's layout ACTUALLY renders, flattened. Not the same list as
// buildPILayout's for every class — ValueTypeNode overrides getPILayout to route
// dimensions/complexity/dimensionsMode through atoms instead of descriptors — and it is the
// one the user sees, so the structural check reads both.
function renderedProps(node: Record<string, unknown>): PropClass[] {
    const layout = (node as unknown as { getPILayout(): { items: PropClass[] }[] | null }).getPILayout();
    return layout ? layout.flatMap((g) => g.items) : [];
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// The two checks, as pure functions
// ─────────────────────────────────────────────────────────────────────────────────────────

// One (class, key, source location) the sweep visits.
interface SweepCase {
    className: string;
    layoutKey: string;
    // The name the row appears under in the PI `objects` bag — the resolved PropClass's own
    // key, which for an atom is its capitalised display key ('Min') and for a descriptor is
    // the layout key itself ('storageClass').
    rowName: string;
    // Where in the file the value sits. For a descriptor this is the class's RESOLVED
    // sourcePath, so per-class $ref overrides are honoured (valueType.json narrows `unit` to
    // 'Unit'; signal.json moves `dataScope` to 'CoderInfo.CustomAttributes.DataScope'). For an
    // atom it is the atom's OWN raw key — using the descriptor's sourcePath for an
    // atom-resolved key is precisely the confusion that caused the bug.
    sourcePath: string;
    route: 'atom' | 'descriptor';
    kind: ProbeKind;
    options?: string[];
}

// Assertion 1, as a pure function over the two rendered strings. Pure so the self-check can
// call it on synthetic input without a node, a registry, or a mutation. Returns null when the
// row honours the invariant, else a message naming the class and the key — the message IS the
// test output, so it has to be enough to act on without reading this file.
function rowFailure(c: SweepCase, a: Probe, b: Probe, displayA: unknown, displayB: unknown): string | null {
    const where = `${c.className} / layout key '${c.layoutKey}' (row '${c.rowName}', ${c.route}-resolved, source '${c.sourcePath}')`;
    if (typeof displayA !== 'string' || typeof displayB !== 'string') {
        return `${where}: the Property Inspector has no row named '${c.rowName}' at all, so the source value is unreachable`;
    }
    if (!displayA.includes(a.text)) {
        return `${where}: source carries ${JSON.stringify(a.value)} but the row displays ${JSON.stringify(displayA)}`;
    }
    if (!displayB.includes(b.text)) {
        return `${where}: source carries ${JSON.stringify(b.value)} but the row displays ${JSON.stringify(displayB)}`;
    }
    if (displayA === displayB) {
        return `${where}: the row displays ${JSON.stringify(displayA)} for BOTH source values, so it is not reading the source`;
    }
    return null;
}

// Assertion 2, as a pure function over ONE resolved row and ONE built node.
//
// `readValue` present means the row does not read a plain node field — it either computes from
// the live node (an atom) or hydrates the source bag (a descriptor built by toPropClass).
// Neither can be checked structurally, and the sweep covers both.
//
// `readValue` absent means `getPropInfo` falls through to `format(this[key])`. Note `key` and
// not `nodeProperty ?? key`: getPropInfo uses `nodeProperty` only for the raw `value` field it
// carries alongside, so the field the DISPLAY depends on is `key`.
//
// The test is `in`, on the INSTANCE. `in` because a prototype getter is a perfectly good
// backing (ConfigSetNode.ConfigName is one) and because a legitimately-undefined own field (an
// unset Min) must pass — absent is the failure, not empty. The INSTANCE because a
// `field?: string` declaration that is never assigned does not exist at runtime, and BaseNode
// declares `Description?: string` for every node in the product: checking the class would have
// called the broken ConfigSetNode correct.
function fieldFailure(className: string, pc: PropClass, node: Record<string, unknown>, via: string): string | null {
    if (typeof pc.readValue === 'function') {
        return null;
    }
    if (pc.key in node) {
        return null;
    }
    return `${className} (${via}): row '${pc.key}' reads the node field '${pc.key}', which the built instance does not have — the row renders blank AND toPIObject adds '${pc.key}' to shownKeys, so buildOtherRows suppresses the raw property too`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Enumerating the pairs
// ─────────────────────────────────────────────────────────────────────────────────────────

const SCHEMA_CLASSES = getSchemaClasses();

// Every (class, layout key) pair, classified. Built once at module scope so the counts the
// coverage block asserts and the cases the sweep runs are the same enumeration.
const allPairs: string[] = [];
const exemptPairs: string[] = [];
const sweepCases: SweepCase[] = [];
// Anything that stopped a pair from being classified. Collected rather than thrown so ONE run
// reports every problem, and asserted empty — a pair that cannot be classified is a pair that
// silently leaves coverage, which is the failure mode this file exists to prevent.
const classificationProblems: string[] = [];
// Classes the sweep could not build a node for. Asserted to be exactly [] below.
const unbuildableClasses: string[] = [];
// Row names that collide inside one class's layout. A collision would make the sweep read
// another key's row and call it a pass — and it is a real PI bug in its own right (two
// properties of the same name in one sheet).
const rowNameCollisions: string[] = [];

for (const className of SCHEMA_CLASSES) {
    const authored = getLayout(className);
    const built = buildPILayout(className);
    if (!authored || !built) {
        classificationProblems.push(`${className}: declares no PI layout, so no key can be checked`);
        continue;
    }
    if (authored.length !== built.length) {
        classificationProblems.push(`${className}: ${authored.length} authored groups became ${built.length} built groups`);
        continue;
    }
    if (buildNode(className, {}) === null) {
        unbuildableClasses.push(className);
    }
    const resolvedProps = getSchema(className);
    const seenRowNames = new Set<string>();
    for (let g = 0; g < authored.length; g++) {
        // Index alignment is safe ONLY while nothing is filtered out, so it is checked rather
        // than assumed: buildPILayout drops a key that resolves to nothing, which would shift
        // every later key onto the wrong descriptor. (schema/schemaBridge.test.ts pins the
        // same equality from the other side; here it is a precondition of reading the pairs.)
        if (authored[g].items.length !== built[g].items.length) {
            classificationProblems.push(
                `${className} group '${authored[g].group}': ${authored[g].items.length} authored keys resolved to ` +
                `${built[g].items.length} rows — a layout key resolves to nothing`,
            );
            continue;
        }
        for (let i = 0; i < authored[g].items.length; i++) {
            const layoutKey = authored[g].items[i];
            const resolved = built[g].items[i];
            const pair = `${className}/${layoutKey}`;
            allPairs.push(pair);
            if (seenRowNames.has(resolved.key)) {
                rowNameCollisions.push(`${pair}: row name '${resolved.key}' is already used by another key in this class`);
            }
            seenRowNames.add(resolved.key);

            const atom = LAYOUT_ATOMS[layoutKey];
            if (atom) {
                if (resolved !== atom) {
                    classificationProblems.push(
                        `${pair}: schemaBridge resolved this key to a row named '${resolved.key}', not the atom LAYOUT_ATOMS ` +
                        'mirrors for it — ATOM_BY_KEY changed and the mirror in this file must be updated',
                    );
                    continue;
                }
                if (typeof atom.readValue === 'function') {
                    exemptPairs.push(pair);
                    continue;
                }
                const kind = ATOM_PROBE_KIND[layoutKey];
                if (!kind) {
                    classificationProblems.push(
                        `${pair}: field-backed atom with no entry in ATOM_PROBE_KIND — add the value kind its node field takes`,
                    );
                    continue;
                }
                // A field-backed atom's source is its own raw key(s). `sourceKeys` is a LIST
                // for a reason (PropUnit declares ['DocUnits','Unit'], the modern and legacy
                // spellings), and every spelling it claims is a location a real file can carry
                // the value at — so each becomes its own case. Claiming a spelling and not
                // displaying it is the same defect: toPIObject adds both to shownKeys, so the
                // unread one is suppressed from "Other" as well.
                for (const rawKey of atom.sourceKeys ?? [atom.key]) {
                    sweepCases.push({ className, layoutKey, rowName: atom.key, sourcePath: rawKey, route: 'atom', kind });
                }
                continue;
            }

            const descriptor = resolvedProps?.find((p) => p.key === layoutKey);
            if (!descriptor) {
                classificationProblems.push(`${pair}: resolves to neither an atom nor a schema descriptor`);
                continue;
            }
            if (resolved.key !== layoutKey) {
                classificationProblems.push(`${pair}: descriptor-resolved but the row is named '${resolved.key}'`);
                continue;
            }
            const kind = descriptorProbeKind(descriptor);
            if (!kind) {
                classificationProblems.push(`${pair}: descriptor type '${descriptor.type}' has no probe kind in this file`);
                continue;
            }
            const [a, b] = probePair(kind, descriptor.options);
            // A probe equal to the descriptor's declared default would let a row that ignores
            // the source pass: hydrate() substitutes the default when the path resolves to
            // nothing, so the two would be indistinguishable.
            if (a.value === descriptor.default || b.value === descriptor.default) {
                classificationProblems.push(
                    `${pair}: a probe value equals the descriptor default ${JSON.stringify(descriptor.default)}, ` +
                    'so a row ignoring the source would still pass',
                );
                continue;
            }
            sweepCases.push({
                className,
                layoutKey,
                rowName: layoutKey,
                sourcePath: descriptor.sourcePath,
                route: 'descriptor',
                kind,
                options: descriptor.options,
            });
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────────────────

describe('the guard is actually reading the schema tree', () => {
    // The block that makes the rest of this file mean something. A sweep over an empty list
    // passes, so the size and shape of the enumeration is asserted BEFORE the sweep runs.
    // Floors rather than exact counts (the idiom moduleBoundaries.test.ts uses): adding a
    // class or a layout key should not need an edit here, but nothing may DISAPPEAR.

    it('classifies every layout key of every schema class, with nothing left over', () => {
        expect(classificationProblems).toEqual([]);
    });

    it('covers every class in the schema registry — the skip list is EMPTY', () => {
        // Not "skips are listed": there are none. All twenty classes in CLASS_DEFS have a
        // NodeClassMap entry and all build from a bag holding one property, so a class that
        // stops being buildable trips this instead of quietly dropping out of the sweep.
        // schema/piGeneralAllNodes.test.ts pins the same fact from the registry side.
        expect(unbuildableClasses).toEqual([]);
    });

    it('gives every row in a class its own name, so no case reads another key\'s row', () => {
        expect(rowNameCollisions).toEqual([]);
    });

    it('sweeps the number of (class, key) pairs it claims to', () => {
        // Measured on the tree as it stands: 20 classes, 182 (class, key) pairs, 85 of them
        // computed-and-exempt, 97 with a source location — which become 100 probe cases,
        // because `unit` declares two raw spellings and each is a location a real file uses.
        expect(SCHEMA_CLASSES.length).toBeGreaterThanOrEqual(20);
        expect(allPairs.length).toBeGreaterThanOrEqual(182);
        expect(exemptPairs.length).toBeGreaterThanOrEqual(85);
        // The floor that matters most: this is the number of pairs actually PROBED. Every
        // other count can hold while this one collapses.
        expect(sweepCases.length).toBeGreaterThanOrEqual(100);
        // And the two halves account for the WHOLE: every pair enumerated is either exempt or
        // probed, so one cannot fall out of both. Counted through a Set because `unit`
        // contributes two cases for one pair, and compared for EQUALITY — a floor here would
        // let a pair leave coverage as long as another arrived.
        expect(new Set([...exemptPairs, ...sweepCases.map((c) => `${c.className}/${c.layoutKey}`)]).size).toBe(allPairs.length);
    });

    it('exempts exactly the keys whose value is COMPUTED, and no others', () => {
        // The allowlist is not trusted, it is derived and compared: an exempt key is an atom
        // key that declares `readValue`. So a new computed atom must be documented here
        // deliberately, and an atom that becomes field-backed falls INTO the sweep — the
        // direction that matters, since field-backed is the shape that broke.
        const derived = Object.keys(LAYOUT_ATOMS)
            .filter((k) => typeof LAYOUT_ATOMS[k].readValue === 'function')
            .sort();
        expect(derived).toEqual(Object.keys(COMPUTED_NO_SOURCE).sort());
        // And every exemption carries a reason, because "it is computed" is a claim about a
        // specific getter and a bare list of keys cannot be reviewed.
        for (const [key, why] of Object.entries(COMPUTED_NO_SOURCE)) {
            expect(why.length, `exemption '${key}' needs a reason`).toBeGreaterThan(20);
        }
    });

    it('probes the three keys the three shipped instances of this bug were found in', () => {
        // Named cases, so the sweep visibly covers the defects that motivated it rather than
        // covering some other 100 pairs. ValueType min/max/unit and ConfigSet(Ref) description
        // are the ones that shipped or nearly shipped blank.
        const probed = new Set(sweepCases.map((c) => `${c.className}/${c.layoutKey}`));
        for (const pair of [
            'Simulink.ValueType/min',
            'Simulink.ValueType/max',
            'Simulink.ValueType/unit',
            'Simulink.ConfigSet/description',
            'Simulink.ConfigSetRef/description',
        ]) {
            expect(probed, pair).toContain(pair);
        }
        // And the nested paths, which are the ones a hand-rolled flat bag would silently fail
        // to reach.
        const nested = sweepCases.filter((c) => c.sourcePath.includes('.'));
        expect(nested.length).toBeGreaterThanOrEqual(20);
        expect(nested.map((c) => c.sourcePath)).toContain('CoderInfo.CustomAttributes.DataScope');
        expect(nested.map((c) => c.sourcePath)).toContain('StructTypeInfo.Name');
    });
});

describe('a value the source carries reaches its Property Inspector row', () => {
    it('displays a sentinel planted at every layout key that has a source location', () => {
        // THE assertion. For each case: build two real nodes whose serial carries a different
        // sentinel at that key's source location, render the real Property Inspector for each,
        // and require that key's row to show each sentinel and to CHANGE between them.
        const failures: string[] = [];
        for (const c of sweepCases) {
            const [a, b] = probePair(c.kind, c.options);
            const nodeA = buildNode(c.className, bagWithProbe(c.sourcePath, a.value));
            const nodeB = buildNode(c.className, bagWithProbe(c.sourcePath, b.value));
            if (!nodeA || !nodeB) {
                failures.push(`${c.className}: no registered node class, so '${c.layoutKey}' cannot be checked`);
                continue;
            }
            const failure = rowFailure(c, a, b, piBag(nodeA)[c.rowName], piBag(nodeB)[c.rowName]);
            if (failure) {
                failures.push(failure);
            }
        }
        expect(failures).toEqual([]);
    });
});

describe('no layout row reads a node field the instance does not have', () => {
    it('checks the field behind every field-backed row, on the built INSTANCE', () => {
        // The cheaper half, and the one that states the mechanism directly: a row with no
        // `readValue` reads `this[key]`, and if the class never assigns that field the row is
        // blank AND the raw property is suppressed from "Other". Both the schema-resolved
        // layout and the layout the node actually renders are walked — they are not the same
        // list for every class, and the second is the one the user sees.
        const failures: string[] = [];
        for (const className of SCHEMA_CLASSES) {
            const node = buildNode(className, {});
            if (!node) {
                failures.push(`${className}: no registered node class`);
                continue;
            }
            for (const group of buildPILayout(className) ?? []) {
                for (const pc of group.items) {
                    const failure = fieldFailure(className, pc, node, 'schema layout');
                    if (failure) {
                        failures.push(failure);
                    }
                }
            }
            for (const pc of renderedProps(node)) {
                const failure = fieldFailure(className, pc, node, 'node getPILayout() override');
                if (failure) {
                    failures.push(failure);
                }
            }
        }
        expect(failures).toEqual([]);
    });
});

describe('the guard can fail — proved, not assumed', () => {
    // Without this block the two above are code that has never been observed to reject
    // anything. Each case here feeds a deliberately broken input to the SAME functions the
    // sweep uses and requires a failure to come back.
    //
    // Hermetic by construction: `rowFailure` and `fieldFailure` are pure, and the one
    // end-to-end case breaks a single throwaway INSTANCE (`delete` on its own property) rather
    // than the class, CLASS_DEFS, or the layout registry. Nothing here touches the schema
    // module's memoizing `cache` Map, so no later test in the run sees a different schema than
    // it would have.

    // A synthetic case, resembling nothing in the registry, for the pure-function checks.
    const synthetic: SweepCase = {
        className: 'Test.SyntheticClass',
        layoutKey: 'syntheticKey',
        rowName: 'SyntheticRow',
        sourcePath: 'SyntheticSource',
        route: 'atom',
        kind: 'string',
    };
    const [a, b] = probePair('string');

    it('accepts a row that reads the source (the check is not simply always-fail)', () => {
        expect(rowFailure(synthetic, a, b, SENTINEL_A, SENTINEL_B)).toBeNull();
    });

    it('reports a row that renders blank', () => {
        // The exact shape of the shipped bug: the row exists and is empty.
        const failure = rowFailure(synthetic, a, b, '', '');
        expect(failure).toContain('Test.SyntheticClass');
        expect(failure).toContain("'syntheticKey'");
        expect(failure).toContain(SENTINEL_A);
    });

    it('reports a row that is missing from the Property Inspector entirely', () => {
        const failure = rowFailure(synthetic, a, b, undefined, undefined);
        expect(failure).toContain('no row named');
    });

    it('reports a row whose text does not change when the source does', () => {
        // A row wired to a constant, or to some other property. Both sentinels are present in
        // the text, so only the A≠B test can catch it — this is what that test is for.
        const stuck = `${SENTINEL_A}/${SENTINEL_B}`;
        const failure = rowFailure(synthetic, a, b, stuck, stuck);
        expect(failure).toContain('for BOTH source values');
    });

    it('reports a field-backed row whose node field is absent, and accepts one that is present', () => {
        const absent = fieldFailure('Test.SyntheticClass', { key: 'NeverAssigned' } as unknown as PropClass, {}, 'synthetic');
        expect(absent).toContain('Test.SyntheticClass');
        expect(absent).toContain('NeverAssigned');
        expect(fieldFailure('Test.SyntheticClass', { key: 'NeverAssigned' } as unknown as PropClass, { NeverAssigned: undefined }, 'synthetic')).toBeNull();
        // An `undefined` own field passes on purpose: an unset Min is a legitimately empty
        // row, and this check is about a field that does not EXIST.
    });

    it('catches the shipped bug end to end when the node field is removed from an instance', () => {
        // The strongest form: reproduce the real defect on a real class through the real
        // Property Inspector, and require the real check to report it. Simulink.ConfigSet's
        // `description` is the case the design fixed — the layout key resolves to an atom that
        // reads `node.Description`, so an instance without that field renders blank while the
        // raw `Description` is suppressed from "Other". `delete` on the instance's own property
        // reproduces exactly the state `Description?: string`-without-assignment leaves behind,
        // and affects nothing beyond these two throwaway nodes.
        const c = sweepCases.find((s) => s.className === 'Simulink.ConfigSet' && s.layoutKey === 'description');
        expect(c, 'Simulink.ConfigSet/description must be IN the sweep for this to prove anything').toBeTruthy();
        const [pa, pb] = probePair(c!.kind);
        const nodeA = buildNode(c!.className, bagWithProbe(c!.sourcePath, pa.value))!;
        const nodeB = buildNode(c!.className, bagWithProbe(c!.sourcePath, pb.value))!;

        // Unbroken first, so the difference is attributable to the deletion and not to the bag.
        expect(rowFailure(c!, pa, pb, piBag(nodeA)[c!.rowName], piBag(nodeB)[c!.rowName])).toBeNull();

        delete nodeA.Description;
        delete nodeB.Description;
        const failure = rowFailure(c!, pa, pb, piBag(nodeA)[c!.rowName], piBag(nodeB)[c!.rowName]);
        expect(failure).toContain('Simulink.ConfigSet');
        expect(failure).toContain("'description'");
        // And the structural check sees the same instance the same way.
        expect(fieldFailure('Simulink.ConfigSet', PropDescription as unknown as PropClass, nodeA, 'broken instance'))
            .toContain('Description');
    });
});
