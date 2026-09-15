// Copyright 2026 The MathWorks, Inc.
//
// Which entry names in a source are TYPE DEFINITIONS, and the link a Data Type cell
// naming one of them carries.
//
// A `Data Type` cell mostly names another entry of the same dictionary — an alias type,
// a numeric type, an enum definition, a bus, a value type. Measured over a real customer
// dictionary, 222 of its 235 distinct Data Type values resolve to an entry here, and
// every one of those lands on one of the five classes below. The thirteen that do not are
// exactly the built-ins (`double`, `uint8`, `boolean`, …) plus names nothing in that file
// defines. That is why this needs no list of built-in type names: a built-in simply is
// not an entry, so the same lookup rejects it.
//
// CLASS-gated rather than name-gated: a `Simulink.Parameter` named `adtBool` must not be
// a link target, because that is not what a Data Type cell naming `adtBool` means.
// TOP-LEVEL-only (`isEntry`), for the same reason definedNamesOf is: a bus element or a
// struct field is not a definition.
import type { INode, ISourceNode } from './NodeInterfaces.js';

// The classes a Data Type cell can legitimately name. A closed set, and deliberately
// short: every addition claims that a cell reading this name means THAT object, so it is
// a decision about the column's meaning rather than a list to keep topped up.
const TYPE_DEFINING_CLASSES: ReadonlySet<string> = new Set([
  'Simulink.AliasType',
  'Simulink.NumericType',
  'Simulink.data.dictionary.EnumTypeDefinition',
  'Simulink.Bus',
  'Simulink.ValueType',
]);

/**
 * One shallow walk of the two-level entry structure — the same shape and the same
 * `isEntry` gate `definedNamesOf` walks, over sections for a dictionary and over the root
 * for a `.mat`. NOT `flatten()`: a 31,000-entry dictionary flattens to 128,000 nodes, and
 * every node below an entry is by definition not one.
 *
 * Defensive about its input for the reason definedNamesOf is: `addParsedSource` takes a
 * tree this package did not build, and one malformed node must not take the whole answer
 * down — a missing link is recoverable, a throw inside toRow costs a row.
 */
export function buildTypeLinkIndex(source: ISourceNode): ReadonlySet<string> {
  const names = new Set<string>();
  const add = (node: INode | null | undefined): void => {
    if (
      node &&
      node.isEntry === true &&
      typeof node.name === 'string' &&
      node.name !== '' &&
      TYPE_DEFINING_CLASSES.has(node.className)
    ) {
      names.add(node.name);
    }
  };
  const childrenOf = (node: INode | null): readonly INode[] =>
    node && Array.isArray(node.children) ? node.children : [];
  for (const child of childrenOf(source as unknown as INode)) {
    add(child); // a `.mat` keeps its variables at the root
    for (const grandchild of childrenOf(child)) {
      add(grandchild); // a dictionary keeps its entries under a section
    }
  }
  return names;
}

/**
 * The index for `source`, built on first ask and cached on the node.
 *
 * Lazy rather than built during parse, even though parse already visits every entry and
 * already knows each class: the post-invalidation rebuild needs this walk regardless, so
 * eager would only be priming — ~1-2 ms once, bought with a parser-to-index coupling. And
 * lazy is SELF-HEALING. A missed invalidation hook is corrected by the next unrelated
 * edit; an incrementally-maintained index stays wrong.
 */
export function typeLinkIndexOf(source: ISourceNode): ReadonlySet<string> {
  const cached = source._typeLinkIndex;
  if (cached) {
    return cached;
  }
  const built = buildTypeLinkIndex(source);
  source._typeLinkIndex = built;
  return built;
}

/**
 * The link a Data Type cell reading `typeName` carries, or null when it stays plain text.
 *
 * The target is core's OWN existing grammar, `<name>@<srcId>`, so `resolveLink` round-trips
 * it with no new parser and no consumer learns a second target spelling.
 */
export function typeLinkTargetIn(source: ISourceNode, srcId: string, typeName: string): string | null {
  if (typeof typeName !== 'string' || typeName === '') {
    return null;
  }
  return typeLinkIndexOf(source).has(typeName) ? `${typeName}@${srcId}` : null;
}
