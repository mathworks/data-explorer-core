/** A node whose rows the ceiling may decline to build: a MatlabVariableNode read out of a .mat file. */
interface Cuttable {
    /** How many direct rows the ceiling declined to build here; absent when it built them. */
    _cutByCeiling?: number;
}
/** A node, as far as counting it and what is under it goes. */
interface Counted {
    children: Counted[];
}
/**
 * Runs `build` with `ceiling` nodes to build, and says how many containers it built without
 * their rows and which was the first of them, in the order it built them (depth first).
 */
export declare function buildUnderCeiling<T, N extends Cuttable>(ceiling: number, build: () => T): {
    result: T;
    cut: number;
    firstCut: N | null;
};
/** Counts `n` nodes the ceiling builds whatever is left of it: the variables at the top of the file. */
export declare function chargeNodes(n: number): void;
/**
 * Whether `node` may build its `k` direct rows: yes, taking them from the ceiling, when they
 * fit in what is left of it, or when no ceiling is armed; otherwise no, and `node` is recorded
 * as built without them.
 */
export declare function admitRows(node: Cuttable, k: number): boolean;
/**
 * `build`, with no ceiling, for a node the ceiling never cuts (an MCOS object's typed node);
 * then every node under what it built is counted against the ceiling under way. The node
 * itself is a variable or its container's row, which is counted already.
 */
export declare function buildUncut<T extends Counted | null>(build: () => T): T;
/**
 * `build` under a ceiling of its own, `left` nodes, or under none (null), whatever build is
 * under way: the subtree a node with no rows answers from (MatlabVariableNode._withCeilingTwin),
 * which is no part of the file's tree and counts against nothing in it.
 */
export declare function buildApart<T>(left: number | null, build: () => T): T;
export {};
//# sourceMappingURL=matNodeCeiling.d.ts.map