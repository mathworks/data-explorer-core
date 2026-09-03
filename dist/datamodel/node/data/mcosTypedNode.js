// Copyright 2026 The MathWorks, Inc.
import * as NodeRegistry from '../NodeRegistry.js';
import MatlabVariableNode from './MatlabVariableNode.js';
import { decodeMcosBlob } from '../../parser/McosParser.js';
// Bridges the binary (MCOS) decode path to the same typed data-model nodes the
// SLDD (JSON) path builds, so a Simulink object resolves to the SAME node class
// with the SAME property values regardless of source format — one class per entry
// type, one presentation.
//
// The MCOS decoder (McosParser.decodeMcosBlob) now reconstructs each object's
// `_properties` bag in the exact shape the SLDD path produces (scalars as-is,
// matrices as Matrix(r,c) value objects, nested objects as { _object_class,
// _properties }). So both paths converge on a single call to
// NodeRegistry.parseValue with an identical `_array_class` value object — the
// binary path is no longer a special case.
//
// When no decoded properties are available (the decoder could not confidently
// resolve the object — e.g. it isn't in the blob, or its class didn't match), we
// fall back to an EMPTY SHELL: correct class and icon, empty columns, no children.
// That is honest — a wrong value is worse than an absent one — and still unifies
// the node class across formats.
// Generic class keys in the registry that are NOT concrete Simulink object
// classes — an opaque MCOS variable never carries these as its className, and
// routing to them would be wrong. Excluded from unification.
const GENERIC_KEYS = new Set(['MatlabVariable', 'MatlabStruct', 'CustomObject']);
// Returns a typed DataNode for any Simulink class the data model knows, populated
// from `properties` when supplied (SLDD-shaped) or as an empty shell otherwise, or
// null to signal the caller to fall back to the opaque representation.
//
// `elements`/`dimensions` describe an object ARRAY (e.g. a 20x1
// Simulink.VariableUsage): each entry is one element's decoded `_properties` bag,
// in MATLAB's own column-major order. When omitted, the object is treated as a
// scalar built from `properties`. An array routes through ObjectNode, which expands
// one child row per element — Name(1,1), Name(2,1), … down the columns, or a single
// linear Name(1), Name(2), … for a vector, matching MATLAB's own subscripts — each
// itself expanding into its property rows.
export function buildTypedNodeFromMcos(className, name, parent, properties, elements, dimensions) {
    if (!className || GENERIC_KEYS.has(className)) {
        return null;
    }
    // Prefer the full element list (object arrays); fall back to the single scalar bag.
    const elems = elements && elements.length > 0 ? elements : [properties || {}];
    // Every extent, not just the first two. Truncating to [d0, d1] reported MATLAB's
    // 2x3x2 obj2x3x2 as a 2x3 — a shape it never had — and handed the subscript
    // helper two extents for twelve elements, so elements 7..12 were labelled
    // (1,1)..(2,3) a second time. A missing or single-extent `dimensions` is a scalar
    // unless there are more elements than that, in which case it is a row vector.
    const dims = dimensions && dimensions.length >= 2
        ? dimensions.slice()
        : elems.length > 1
            ? [1, elems.length]
            : [1, 1];
    const isArray = elems.length > 1;
    // A class the data model KNOWS (Simulink.Parameter, …) routes to its own typed
    // node. A class it does NOT know is a customer-defined object: expand it as the
    // generic ObjectNode the SLDD path uses so its properties surface as child rows
    // (issue #3) — but ONLY when the decoder actually recovered properties, since an
    // empty bag has nothing to show and should stay an opaque shell. An object array
    // always carries per-element data, so it expands regardless of class knowledge.
    const isKnown = !!NodeRegistry.getClass(className);
    const hasData = isArray || elems.some((e) => e && Object.keys(e).length > 0);
    if (!isKnown && !hasData) {
        return null;
    }
    // The value object mirrors the SLDD `entry.value`: one _elements entry per array
    // element, each whose _properties is the decoded bag. NodeRegistry.parseValue
    // dispatches on _array_class — known class -> its typed node (scalar), unknown or
    // multi-element -> ObjectNode — so both converge on the same recursion the SLDD
    // paths use. Every typed node's parse() tolerates an empty _properties.
    const rawVal = {
        _array_class: className,
        _array_type: 'MATLABArray',
        _dimensions: dims,
        _mw_element_type: 'MATLABArray',
        _elements: elems.map((e) => ({ _properties: e || {} })),
    };
    try {
        return NodeRegistry.parseValue(rawVal, name, parent);
    }
    catch {
        // Any class whose parse() unexpectedly rejects the value degrades to the
        // opaque node rather than breaking the whole file.
        return null;
    }
}
// Decode the MCOS blob that carries every opaque object's real property values.
// A .mat file keeps it in an anonymous trailing element; an .slx model workspace in
// its own trailing-element list — hence `blobBytes` rather than a container-specific
// lookup. Returns null when there is nothing to decode (no opaque objects, or no
// blob), which callers treat as "every object stays an empty shell".
export function decodeMcosObjects(blobBytes, variables) {
    const opaque = variables.filter((v) => v.isOpaque && v.name);
    if (opaque.length === 0 || !blobBytes) {
        return null;
    }
    return decodeMcosBlob(blobBytes, opaque.map((v) => ({ name: v.name, className: v.className, rawBytes: v._rawBytes })));
}
// Model ONE opaque MCOS variable, or null to say "not an MCOS object — model it the
// container's normal way". Shared verbatim by MatNode (.mat) and ModelNode (.slx
// model workspace), which reach the identical three-way decision:
//
//   1. A class the data model knows, or an unknown class the decoder recovered
//      properties for -> the SAME typed node the SLDD path builds, so one Simulink
//      class has one node class and one presentation across all three formats.
//   2. No typed node for this class (e.g. Simulink.DataStore) but the decoder DID
//      resolve it -> the opaque MatlabVariableNode, enriched with those properties.
//   3. Neither -> null; the caller falls back to its plain-variable path, which
//      still shows the right class and icon from the variable's own metadata.
export function modelOpaqueMcosVariable(variable, decoded, parent) {
    const typed = buildTypedNodeFromMcos(variable.className, variable.name, parent, decoded?.properties, decoded?.elements, decoded?.dimensions);
    if (typed) {
        return typed;
    }
    if (decoded) {
        return MatlabVariableNode.createFromMcosDecoded(variable, decoded, parent);
    }
    return null;
}
//# sourceMappingURL=mcosTypedNode.js.map