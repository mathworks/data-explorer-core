interface Placed {
    parent: Placed | null;
    owningEntry?: object | null;
}
/** Move `node`'s generation on: what was judged of any value under it is to be judged again. */
export declare function valueChanged(node: object): void;
/** Move the generation of `node`'s source, its topmost node, on. */
export declare function sourceValuesChanged(node: Placed): void;
/** Move on the generation of the entry `node` is in, or of its source where it is in none. */
export declare function entryValuesChanged(node: Placed): void;
/** How many verdicts have been judged, kept ones not counted: what an edit cost the rows built after it. */
export declare function verdictsJudged(): number;
/**
 * `judge`'s verdict on `node`'s value, judged once for the generations of its entry and its source
 * (an entry-less node's are its topmost node's) and kept until either moves on.
 */
export declare function keptVerdict<T>(node: Placed, judge: () => T): T;
export {};
//# sourceMappingURL=valueGeneration.d.ts.map