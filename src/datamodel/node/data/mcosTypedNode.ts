// Copyright 2026 The MathWorks, Inc.

import { shownPropertiesOf, withParameterValueShown } from '../mcosShown.js';
import { superclassOf } from '../registeredSubclasses.js';
import * as NodeRegistry from '../NodeRegistry.js';
import MatlabVariableNode from './MatlabVariableNode.js';
import { decodeMcosBlob, decodeMcosVariables, STRING_CLASS_NAME, unreadCellSlots, type McosDecodeIssue } from '../../parser/McosParser.js';
import { mcosRefused, setMcosDecoded, setMcosRefused } from './mcosDecodedTable.js';
import { setMcosPlace } from '../mcosPlace.js';
import type BaseNode from '../BaseNode.js';
import type DataNode from '../DataNode.js';
import { shortArrayMessage, type MatVariable } from '../../parser/MatParser.js';
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
  // What the object saves under other names as the property MATLAB shows (mcosShown.shownPropertiesOf:
  // a NumericType's Signedness, FractionLength and Slope, a CoderInfo's Identifier), the one rule a
  // dictionary's rows read too, held in the bag, which a MAT-file's editor writes; and a Parameter's
  // Value held as a char row as the string MATLAB loads it as.
  const parameter = className === 'Simulink.Parameter' || superclassOf(className) === 'Simulink.Parameter';
  const bagOf = (e: Record<string, unknown> | null) => {
    if (!e) {
      return {};
    }
    const shown = shownPropertiesOf(className, e) ?? e;
    // On a bag of its own: shownPropertiesOf answers the decoded bag itself where it adds
    // nothing, which the decode's caller holds, and reads again where the typed view fails.
    return parameter ? withParameterValueShown({ ...shown }) : shown;
  };
  const rawVal = {
    _array_class: className,
    _array_type: 'MATLABArray',
    _dimensions: dims,
    _mw_element_type: 'MATLABArray',
    _elements: elems.map((e) => ({ _properties: bagOf(e) })),
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
 *
 * Read short includes a struct array or a cell holding fewer elements than it declares
 * (shortArrayOf), which MatParser.collectUndecoded reports outside an object: its rows are the
 * elements held, and a `<1x3 struct>` with one row said nothing of the other two. And a cell with
 * a slot the decoder could not read (McosParser.unreadCellSlots), which shows as not decoded: one
 * MatParser recorded without decoding says so with its reason, above, as `c{1}` does at the top
 * of a .mat; any other is a cell not read, as an element that is not a matrix is counted there.
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
  const short = shortArrayOf(node);
  if (short) {
    warnings.push({ code: 'part-unreadable', message: shortArrayMessage(path, short.declared, short.read, short.unit), part: path });
  }
  // A Simulink.Parameter keeps its value node out of its children when it has no rows.
  const valueNode = (node as unknown as { _valueNode?: BaseNode | null })._valueNode;
  const children = valueNode && !node.children.includes(valueNode) ? [...node.children, valueNode] : node.children;
  for (const child of children) {
    // An element by its subscript under `path` (BaseNode._labelUnder, which is displayName's rule
    // and matlabPath's), a field or a property by its name. Read off isIndexedName, an element of
    // an object or struct array was a field called `3`: "arr.3.Value", for arr(3).Value.
    reportUndecoded(child, child._labelUnder(() => path) ?? path + '.' + child.name, warnings);
  }
}

/**
 * The counts of a struct array or a cell under a decoded object that holds fewer elements than
 * it declares, off the bag its node was built from (StructNode.parse, MatlabVariableNode.parseCell):
 * the product of its extents, and the elements it holds. McosParser lays out a bag for each
 * element held (buildStructValue, structElementsHeld) and a cell's elements read, and the node
 * has a row for each. Null for any other node, for one holding every element it declares, and
 * for one whose extents are not all numbers, which StructNode does not count either. A struct
 * array with no element rows by design (MatlabVariableNode._unexpandedStruct) is none of these:
 * it is read from its stream, and holds no such bag.
 */
function shortArrayOf(node: BaseNode): { declared: number; read: number; unit: 'element' | 'cell' } | null {
  const raw = (node as DataNode)._rawInput as Record<string, unknown> | null | undefined;
  const unit = raw?._array_type === 'Struct' ? 'element' : raw?._array_type === 'Cell' ? 'cell' : null;
  const dims = raw?._dimensions;
  const held = raw?._elements;
  if (!unit || !Array.isArray(dims) || !dims.every((x) => typeof x === 'number') || !Array.isArray(held)) {
    return null;
  }
  const declared = (dims as number[]).reduce((a, b) => a * b, 1);
  // A slot held that the decoder could not read, and that says nothing of its own, is not read.
  let read = held.length;
  for (const variable of unit === 'cell' ? unreadCellSlots(raw)?.values() ?? [] : []) {
    if (!variable?.undecoded) {
      read--;
    }
  }
  return declared > read ? { declared, read, unit } : null;
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
  // An enumeration value's bag, in the binary dictionary reader's form (McosParser.enumerationValue).
  enumeration?: Record<string, unknown>;
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
// tree attached twice reflects only the second. Walked with an explicit stack, so the walk
// has no depth limit of its own. MatParser reads a tree to MAX_NESTING levels (128).
//
// One the decoder REFUSED is recorded as refused (mcosDecodedTable.setMcosRefused), which
// is what tells it from one with nothing to decode against; every other one is cleared, the
// detach (`blobBytes` null) included, so a refusal goes with the attach that found it.
//
// `warnings`, when given, gets one `part-unreadable` per object the decoder could not read
// or read only in part (McosParser.McosDecodeIssue), named by its MATLAB path the way
// MatParser.collectUndecoded names an undecoded piece: `s.f`, `s(2).f`, `c{3}`, 1-based.
// `rootPath` is what a top-level variable is called in that path when it is not its own
// name: a dictionary's encoded value, whose stream MATLAB writes unnamed, is the entry's.
export function attachMcosDecoded(
  blobBytes: Uint8Array | null | undefined,
  variables: MatVariable[],
  warnings?: ParseWarning[],
  rootPath?: string,
): void {
  const opaque: PathStep[] = [];
  // Pushed in reverse, so the walk, and the warnings with it, go in file order.
  const stack = variables.map((v): PathStep => ({ v, up: null, name: rootPath ?? v.name, index: 0 })).reverse();
  while (stack.length > 0) {
    const step = stack.pop()!;
    const v = step.v;
    if (v.isOpaque) {
      opaque.push(step);
      continue;
    }
    const children: PathStep[] = [];
    if (v.fields) {
      for (const [name, field] of Object.entries(v.fields)) {
        if (Array.isArray(field)) {
          field.forEach((element, i) => children.push({ v: element, up: step, name, index: i + 1 }));
        } else {
          children.push({ v: field, up: step, name, index: 0 });
        }
      }
    }
    if (v.className === 'cell' && Array.isArray(v.value)) {
      // A slot MatParser could not read is a null, not a variable.
      (v.value as (MatVariable | null)[]).forEach((cell, i) => {
        if (cell) children.push({ v: cell, up: step, name: null, index: i + 1 });
      });
    }
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  const issues = new Map<MatVariable, McosDecodeIssue>();
  const decoded =
    blobBytes && opaque.length > 0 ? decodeMcosVariables(blobBytes, opaque.map((step) => step.v), issues) : null;
  // Read before the loop takes the issues: a variable met twice is refused both times.
  const refused = new Set<MatVariable>();
  for (const [variable, issue] of issues) {
    if (issue.refused) refused.add(variable);
  }
  for (const step of opaque) {
    const variable = step.v;
    setMcosDecoded(variable, decoded?.get(variable));
    setMcosRefused(variable, refused.has(variable));
    const issue = issues.get(variable);
    // Taken once: a host's tree can hold one variable object in two places.
    issues.delete(variable);
    if (issue && warnings) {
      const path = pathOf(step);
      warnings.push({
        code: 'part-unreadable',
        message: `the MATLAB object "${path}" `
          + (issue.refused ? 'could not be decoded, so its properties are not shown' : 'was decoded in part')
          + `: ${issue.reason}.`,
        part: path,
      });
    }
  }
}

// Where one variable stands in the tree attachMcosDecoded walks: a root (`up` null, `name`
// its path), a field (`.name`), an element of a struct array (`(index).name`), or a cell
// element (`{index}`, `name` null). Kept as steps and spelled only for a variable that has
// something to report, so a deep tree costs one small object per variable, not a path each.
interface PathStep {
  v: MatVariable;
  up: PathStep | null;
  name: string | null;
  index: number;
}

function pathOf(step: PathStep): string {
  const parts: string[] = [];
  for (let s: PathStep | null = step; s; s = s.up) {
    if (!s.up) {
      parts.push(s.name ?? '');
    } else if (s.name === null) {
      parts.push(`{${s.index}}`);
    } else {
      parts.push(s.index > 0 ? `(${s.index}).${s.name}` : `.${s.name}`);
    }
  }
  return parts.reverse().join('');
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
// A known class with no decode is case 1, built from no properties at all, unless the
// decoder REFUSED it (mcosDecodedTable.mcosRefused): its bytes name an object the table does
// not hold, or objects of another class, so a typed node would be an empty object of the
// declared class that is not the one in the file, and a copy of it would write that. It is
// case 3, the plain opaque, and the refusal is a warning (attachMcosDecoded). One with
// nothing to decode against — no blob, or a handle that is only the null object — is not
// refused, and stays the typed node it has always been.
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
  // An enumeration value is the node a binary dictionary's is: its bag is that reader's.
  if (decoded?.enumeration) {
    return NodeRegistry.parseValue(decoded.enumeration, name, parent);
  }
  if (!decoded && mcosRefused(variable)) {
    return null;
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
    if (decoded) {
      placeObjects(typed, variable, decoded);
    }
    return typed;
  }
  if (decoded) {
    return MatlabVariableNode.createFromMcosDecoded(variable, decoded, parent, name);
  }
  return null;
}

// Records which object of the file each node of a decoded object is (mcosPlace.setMcosPlace):
// a scalar's node is element 0 of its variable's handle, and an object array's element rows are
// its elements in order, which is MATLAB's column-major order, the handle's and the decode's
// (buildTypedNodeFromMcos). An array whose rows are not one per id the handle holds is placed
// nowhere: no row of it could be told for which object it is.
function placeObjects(typed: DataNode, variable: MatVariable, decoded: McosDecoded): void {
  const ids = variable.mcosHandle?.ids;
  if (!ids || ids.length === 0) {
    return;
  }
  if (decoded.elements.length > 1) {
    if (typed.children.length === ids.length && decoded.elements.length === ids.length) {
      typed.children.forEach((element, k) => setMcosPlace(element, variable, k));
    }
    return;
  }
  if (ids.length === 1) {
    setMcosPlace(typed, variable, 0);
  }
}
