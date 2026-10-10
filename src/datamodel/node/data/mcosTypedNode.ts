// Copyright 2026 The MathWorks, Inc.

import * as NodeRegistry from '../NodeRegistry.js';
import MatlabVariableNode from './MatlabVariableNode.js';
import { decodeMcosBlob, decodeMcosVariables, STRING_CLASS_NAME } from '../../parser/McosParser.js';
import { setMcosDecoded } from './mcosDecodedTable.js';
import type BaseNode from '../BaseNode.js';
import type DataNode from '../DataNode.js';
import type { MatVariable } from '../../parser/MatParser.js';
import { reasonOf, type ParseWarning } from '../../parser/ParseWarning.js';
import { unbackedColumns } from '../../parser/SparseData.js';

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
export function buildTypedNodeFromMcos(
  className: string,
  name: string,
  parent: BaseNode | null,
  properties?: Record<string, unknown> | null,
  elements?: Record<string, unknown>[] | null,
  dimensions?: number[] | null,
  // Where a degrade goes, when the caller kept somewhere for it to go. Optional and
  // trailing, the shape SlddNode.parse established: whoever owns the array passes it
  // and this appends. Node construction is downstream of the parse that produced that
  // array, which is why this had to be threaded rather than returned.
  warnings?: ParseWarning[],
): DataNode | null {
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
  const dims =
    dimensions && dimensions.length >= 2
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
  let node: DataNode;
  try {
    node = NodeRegistry.parseValue(rawVal, name, parent);
  } catch (err) {
    // Any class whose parse() unexpectedly rejects the value degrades to the
    // opaque node rather than breaking the whole file — and now says so, because
    // the degraded node is indistinguishable from a variable this reader simply
    // models that way. What is lost is the TYPED view: the property rows the class
    // would have expanded into, which is the whole reason this bridge exists.
    //
    // Only this path warns. The two earlier `return null`s above are not losses —
    // a generic key, or an unknown class the decoder recovered nothing for, is this
    // reader meeting the limit of the DATA, and ParseWarning's header is explicit
    // that warning about those would put a count on ordinary files.
    warnings?.push({
      code: 'part-unreadable',
      message:
        `the MATLAB object "${name}" was decoded but its ${className} view could not be built, ` +
        `so it is shown as an opaque variable without its property rows (${reasonOf(err)})`,
      part: name,
    });
    return null;
  }
  if (warnings) {
    reportUndecoded(node, name, warnings);
  }
  return node;
}

/**
 * One warning per value under a decoded object that the reader recorded without
 * decoding — an array declaring more elements than its bytes hold, in a
 * Simulink.Parameter's Value or any other property — or read short, named the way MATLAB names it
 * (`p.Value`, `h.M{2}`), with the reader's reason, as MatParser reports the same value at
 * the top of a .mat or in a struct field. A property is decoded with the object, after the file's own walk, so
 * nothing else reports it, and the row alone said only `not decoded`.
 */
function reportUndecoded(node: BaseNode, path: string, warnings: ParseWarning[]): void {
  const reason = node instanceof MatlabVariableNode && node._undecoded ? node._matVar?.undecoded : undefined;
  if (reason) {
    warnings.push({ code: 'part-unreadable', message: `"${path}" was not decoded: ${reason}.`, part: path });
  }
  // And a sparse array read short because its dims word declares more columns than its
  // column index holds, as MatParser reports one outside an object.
  const unbacked = node instanceof MatlabVariableNode && node._sparse ? unbackedColumns(node._sparse, node._dims) : null;
  if (unbacked) {
    warnings.push({ code: 'part-unreadable', message: `"${path}" ${unbacked}.`, part: path });
  }
  // A Simulink.Parameter keeps its value node out of its children when it has no rows.
  const valueNode = (node as unknown as { _valueNode?: BaseNode | null })._valueNode;
  const children = valueNode && !node.children.includes(valueNode) ? [...node.children, valueNode] : node.children;
  for (const child of children) {
    const own = child.displayName;
    const outer = node.displayName;
    const step = child.isIndexedName && own.startsWith(outer) ? own.slice(outer.length) : '.' + child.name;
    reportUndecoded(child, path + step, warnings);
  }
}

// One decoded object. `elements`/`dimensions` are populated for an object ARRAY; a
// scalar carries only `properties`.
export interface McosDecoded {
  value: unknown;
  properties: Record<string, unknown>;
  elements: Record<string, unknown>[];
  dimensions: number[];
  // A `string`'s text, column-major, `null` per element for a MATLAB `missing` and null
  // for the whole array when the payload declared a shape without recoverable text.
  stringElements?: (string | null)[] | null;
}

// Decode the MCOS blob that carries every opaque object's real property values.
// A .mat file keeps it in an anonymous trailing element; an .slx model workspace in
// its own trailing-element list — hence `blobBytes` rather than a container-specific
// lookup. Returns null when there is nothing to decode (no opaque objects, or no
// blob), which callers treat as "every object stays an empty shell".
//
// The by-name form: NAMED top-level opaques only. MatNode and ModelNode decode through
// attachMcosDecoded below instead, which reaches the nested objects this cannot key.
export function decodeMcosObjects(
  blobBytes: Uint8Array | null | undefined,
  variables: MatVariable[],
): Map<string, McosDecoded> | null {
  const opaque = variables.filter((v) => v.isOpaque && v.name);
  if (opaque.length === 0 || !blobBytes) {
    return null;
  }
  return decodeMcosBlob(
    blobBytes,
    opaque.map((v) => ({ name: v.name, className: v.className, rawBytes: v._rawBytes })),
  );
}

// Decode EVERY opaque in a parsed tree against the container's MCOS blob, in one call,
// and attach each one's result to it in mcosDecodedTable: the top-level variables, and
// equally the struct fields (of a scalar struct and of every element of a struct
// array) and the cell elements below them, at any depth. A nested object has no name
// to be looked up by, so the result is keyed by the variable itself — which is also
// what lets MatlabVariableNode.parseMatVariable, the one dispatch every nested value
// goes through, build it without being handed anything new. The variables themselves
// are not touched; see mcosDecodedTable for why.
//
// A variable left without one could not be resolved with confidence, or there was no
// blob; the node layer then models it exactly as it did before this existed. That
// includes a variable decoded by an EARLIER attach that this one does not repeat, so a
// tree attached twice reflects only the second. Walked with an explicit stack, because
// a struct nested a few thousand deep is a legal file.
export function attachMcosDecoded(blobBytes: Uint8Array | null | undefined, variables: MatVariable[]): void {
  const opaque: MatVariable[] = [];
  const stack: MatVariable[] = variables.slice();
  while (stack.length > 0) {
    const v = stack.pop()!;
    if (v.isOpaque) {
      opaque.push(v);
      continue;
    }
    if (v.fields) {
      for (const field of Object.values(v.fields)) {
        if (Array.isArray(field)) {
          for (const element of field) stack.push(element);
        } else {
          stack.push(field);
        }
      }
    }
    if (v.className === 'cell' && Array.isArray(v.value)) {
      // A slot MatParser could not read is a null, not a variable.
      for (const cell of v.value as (MatVariable | null)[]) {
        if (cell) stack.push(cell);
      }
    }
  }
  const decoded = blobBytes && opaque.length > 0 ? decodeMcosVariables(blobBytes, opaque) : null;
  for (const variable of opaque) {
    setMcosDecoded(variable, decoded?.get(variable));
  }
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
//
// A `string` short-circuits ahead of all three. It is the one opaque className that is a
// MATLAB DATA TYPE rather than a class with properties, so case 1 would hand it to a
// typed/object node and present a value-less property shell; the opaque node knows how to
// render its decoded text as a string array.
export function modelOpaqueMcosVariable(
  variable: MatVariable,
  decoded: McosDecoded | undefined,
  parent: BaseNode | null,
  // Forwarded, not consumed: the only loss on this path is the one buildTypedNodeFromMcos
  // can report, and cases 2 and 3 below are fallbacks that show the class correctly.
  warnings?: ParseWarning[],
  // The node's name. A top-level variable's own; for an object nested in a struct field
  // or a cell element — which has no name of its own in the file — the field name or
  // the cell index it is shown under (MatlabVariableNode.parseMatVariable).
  name: string = variable.name,
): DataNode | null {
  if (variable.className === STRING_CLASS_NAME && decoded) {
    return MatlabVariableNode.createFromMcosDecoded(variable, decoded, parent, name);
  }
  const typed = buildTypedNodeFromMcos(
    variable.className,
    name,
    parent,
    decoded?.properties,
    decoded?.elements,
    decoded?.dimensions,
    warnings,
  );
  if (typed) {
    return typed;
  }
  if (decoded) {
    return MatlabVariableNode.createFromMcosDecoded(variable, decoded, parent, name);
  }
  return null;
}
