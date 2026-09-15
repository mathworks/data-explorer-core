import type { ISourceNode } from './NodeInterfaces.js';
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
export declare function buildTypeLinkIndex(source: ISourceNode): ReadonlySet<string>;
/**
 * The index for `source`, built on first ask and cached on the node.
 *
 * Lazy rather than built during parse, even though parse already visits every entry and
 * already knows each class: the post-invalidation rebuild needs this walk regardless, so
 * eager would only be priming — ~1-2 ms once, bought with a parser-to-index coupling. And
 * lazy is SELF-HEALING. A missed invalidation hook is corrected by the next unrelated
 * edit; an incrementally-maintained index stays wrong.
 */
export declare function typeLinkIndexOf(source: ISourceNode): ReadonlySet<string>;
/**
 * The link a Data Type cell reading `typeName` carries, or null when it stays plain text.
 *
 * The target is core's OWN existing grammar, `<name>@<srcId>`, so `resolveLink` round-trips
 * it with no new parser and no consumer learns a second target spelling.
 */
export declare function typeLinkTargetIn(source: ISourceNode, srcId: string, typeName: string): string | null;
//# sourceMappingURL=typeLinkIndex.d.ts.map