// Copyright 2026 The MathWorks, Inc.

// Bridges the language-neutral `schema/` descriptors into the existing PropClass
// render contract. Lives OUTSIDE schema/ (it depends on both the schema and node
// types) so the schema module stays a self-contained, extractable package.
//
// Two surfaces are bridged:
//   - buildPILayout: turns a class's declarative PI layout (schema `layout`:
//     ordered groups → prop keys) into PIGroupDef[]. Each key resolves either to
//     a curated node atom (ATOM_BY_KEY — computed/live props like Name, Value,
//     Data Type) or to a hydrated schema prop (Dimensions, Storage Class, …).
//     This is the single generic implementation behind BaseNode.getPILayout.
//   - schemaColumns / schemaColumnLabels: the schema-driven read-only table
//     columns (Dimensions, Complexity, Storage Class, …). Column GROUPING is NOT
//     here — it is a global table concern owned by host/rowBuilder.COLUMN_GROUPS.

import { getSchema, getSchemaClasses, getLayout, hydrate, writeSourcePath } from '../schema/index.js';
import type { ResolvedProp } from '../schema/types.js';
import type { PropClass, PIGroupDef } from './BaseNode.js';
import type BaseNode from './BaseNode.js';
import type { SetPropertyResult } from './DataNode.js';
import PropName from '../prop/PropName.js';
import PropValue from '../prop/PropValue.js';
import PropDataType from '../prop/PropDataType.js';
import PropKind from '../prop/PropKind.js';
import PropClassAtom from '../prop/PropClass.js';
import PropBaseType from '../prop/PropBaseType.js';
import PropCondition from '../prop/PropCondition.js';
import PropSpecification from '../prop/PropSpecification.js';
import PropEnumValue from '../prop/PropEnumValue.js';
import PropMin from '../prop/PropMin.js';
import PropMax from '../prop/PropMax.js';
import PropUnit from '../prop/PropUnit.js';
import PropDescription from '../prop/PropDescription.js';

// Curated atom keys a schema `layout` may reference. These are the node-owned,
// often COMPUTED properties (Name→displayName, Value→displayValue formatting,
// Data Type→computed getter) that a static sourcePath cannot express — the schema
// declares WHERE they sit (layout), the atom supplies HOW to read/format them.
// Keyed by the lowercase layout key; the atom keeps its own display key ('Name').
// Extend this map when a new schema-driven class references a new atom key.
const ATOM_BY_KEY: Record<string, PropClass> = {
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

// Format a hydrated raw value for display. Arrays render the way MATLAB's own
// mat2str spells a row — `[1 1]`, space-separated — because that is the spelling
// every other surface in the product uses for the same value (a table cell for a
// 1x2 double, and PropDimensions for a bus element's Dimensions). A comma-joined
// `[1, 1]` gave `Simulink.Parameter.Dimensions` a second spelling in the Property
// Inspector that matched neither. Absent values render ''; everything else String().
function formatSchemaValue(value: unknown): string {
    if (value === undefined || value === null) {
        return '';
    }
    if (Array.isArray(value)) {
        return '[' + value.join(' ') + ']';
    }
    return String(value);
}

// Adapt one ResolvedProp to a PropClass. `column` controls the surface:
//   null  → PI-only (toRow skips column===null)
//   <key> → a table column emitted by toRow as row[key]
// `editorOverride` forces the editor (e.g. 'label' to keep the PI read-only even
// for a prop the table renders editable). readValue reads the node's
// serial._properties bag — display-only, never mutating serial. A 'select' prop
// with an options list contributes readOptions so the cell can render a dropdown.
function toPropClass(prop: ResolvedProp, column: string | null, editorOverride?: string): PropClass {
    const pc: PropClass = {
        key: prop.key,
        displayName: prop.label,
        column,
        editor: editorOverride ?? prop.editor,
        // The top-level _properties key this prop reads through (e.g. 'CoderInfo'
        // for 'CoderInfo.StorageClass'). Lets the PI "Other" catch-all exclude the
        // whole bag this prop already surfaces.
        sourceKeys: [prop.sourcePath.split('.')[0]],
        readValue: (node: BaseNode): string => {
            const props = (node as unknown as { serial?: { _properties?: Record<string, unknown> } }).serial?._properties;
            return formatSchemaValue(hydrate(props, prop));
        },
        format: (value: unknown): string => formatSchemaValue(value),
    };
    if (prop.options) {
        const opts = prop.options;
        pc.readOptions = (): string[] => opts;
    }
    return pc;
}

// The schema props the schema itself surfaces into the UI (PI groups + table
// columns) — marked `projected` in the registry. This is exactly the 4 object
// properties (dimensions, complexity, storageClass, alignment); the min/max/unit
// props are authored for reference but owned by the node, so they are excluded.
// Shared by the PI, table-column, group, and label bridges. Empty when the class
// has no schema.
function eligibleProps(className: string): ResolvedProp[] {
    const resolved = getSchema(className);
    if (!resolved) {
        return [];
    }
    return resolved.filter((p) => p.projected === true);
}

// Resolve one PI-layout key to a renderable PropClass. Curated atom keys
// (Name/Value/Data Type/…) resolve to the node atom; any other key is looked up in
// `schema` — the class's own resolved props — and forced read-only ('label')
// because the Property Inspector has no edit channel. A key matching neither is
// undefined and the caller's filter drops it, so a layout typo costs a missing PI
// row rather than a crash; the "every authored layout key resolves" test in
// test/schema/schemaBridge.test.ts is what keeps that from hiding a real property.
function resolvePropForKey(schema: ResolvedProp[] | undefined, key: string): PropClass | undefined {
    const resolved = schema?.find((p) => p.key === key);
    return ATOM_BY_KEY[key] ?? (resolved && toPropClass(resolved, null, 'label'));
}

// The Property Inspector layout for `className`, built from the declarative schema
// `layout` (ordered groups → prop keys). Returns null when the class has no schema
// layout, so BaseNode.getPILayout can fall back to a node-authored override. This
// is the single generic PI-layout implementation; grouping/order live in the
// schema, value resolution in the atoms/schema props.
export function buildPILayout(className: string): PIGroupDef[] | null {
    const layout = getLayout(className);
    if (!layout) {
        return null;
    }
    // One getSchema per class, not one per key: a layout has ~20 keys and each
    // lookup would otherwise re-walk the whole resolved prop list.
    const schema = getSchema(className);
    return layout.map((g) => ({
        group: g.group,
        items: g.items
            .map((key) => resolvePropForKey(schema, key))
            .filter((pc): pc is PropClass => pc !== undefined),
    }));
}

// The table columns contributed by the schema for a className. Each PropClass's
// `column` equals its key, so toRow emits row[key]; its editor comes from the
// schema, so editable props (storageClass select, alignment text) render editable
// cells while label props stay read-only.
export function schemaColumns(className: string): PropClass[] {
    return eligibleProps(className).map((prop) => toPropClass(prop, prop.key));
}

// Attempt to apply an edit to a schema-projected, editable property, writing back
// into the node's serial._properties bag along the prop's sourcePath (including
// nested CoderInfo). Returns:
//   null  — `key` is not a writable schema property (caller falls back to its own
//           setProperty logic); this covers unknown keys and read-only 'label' props.
//   true  — the value was validated and written; caller need do nothing more.
//   SetPropertyResult — validation failed; caller surfaces the refusal.
// The caller (DataNode.setProperty) owns _markModified via the returned true.
export function trySetSchemaProperty(node: BaseNode, key: string, stringValue: string): true | SetPropertyResult | null {
    const className = (node as unknown as { className?: string }).className;
    if (!className) {
        return null;
    }
    const resolved = getSchema(className);
    const prop = resolved?.find((p) => p.key === key && p.projected === true);
    if (!prop || prop.editor === 'label') {
        return null;
    }

    // Every writable projected prop today is an enumerated 'select' — the two
    // other projected props (headerFile, alignment) are 'label' and returned
    // above. A prop of some other editor would fall through here unvalidated, so
    // adding one means adding its validation alongside; there is deliberately no
    // speculative branch for a type we do not yet expose (notably `int`: MATLAB
    // constrains Alignment to -1 or a power of 2, which Number.isInteger does
    // not express, so a generic int check would accept values MATLAB rejects).
    if (prop.editor === 'select') {
        const options = prop.options ?? [];
        if (options.length > 0 && !options.includes(stringValue)) {
            return { error: true, reason: 'Invalid value for ' + prop.label, invalidValue: stringValue, validValue: '' };
        }
    }

    const props = (node as unknown as { serial?: { _properties?: Record<string, unknown> } }).serial?._properties;
    const ok = writeSourcePath(props, prop.sourcePath, stringValue);
    if (!ok) {
        return { error: true, reason: 'Cannot set ' + prop.label + ' (target property is absent)', invalidValue: stringValue, validValue: '' };
    }
    (node as unknown as { _markModified?: () => void })._markModified?.();
    return true;
}

// Column-key → display label for every schema-driven read-only column, unioned
// across all schema classes. The label lives once in the shared prop registry,
// so the host merges this over its base-column labels instead of hand-copying
// the schema labels (single source of truth).
export function schemaColumnLabels(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const className of getSchemaClasses()) {
        for (const prop of eligibleProps(className)) {
            map[prop.key] = prop.label;
        }
    }
    return map;
}
