// Copyright 2026 The MathWorks, Inc.
/** The ceiling of the build under way (buildUnderCeiling), or null between builds. */
let building = null;
/**
 * Runs `build` with `ceiling` nodes to build, and says how many containers it built without
 * their rows and which was the first of them, in the order it built them (depth first).
 */
export function buildUnderCeiling(ceiling, build) {
    const outer = building;
    const own = { left: ceiling, cut: 0, firstCut: null };
    building = own;
    try {
        const result = build();
        return { result, cut: own.cut, firstCut: own.firstCut };
    }
    finally {
        building = outer;
    }
}
/** Counts `n` nodes the ceiling builds whatever is left of it: the variables at the top of the file. */
export function chargeNodes(n) {
    if (building) {
        building.left -= n;
    }
}
/**
 * Whether `node` may build its `k` direct rows: yes, taking them from the ceiling, when they
 * fit in what is left of it, or when no ceiling is armed; otherwise no, and `node` is recorded
 * as built without them.
 */
export function admitRows(node, k) {
    if (!building || k === 0) {
        return true;
    }
    if (k <= building.left) {
        building.left -= k;
        return true;
    }
    node._cutByCeiling = k;
    building.cut++;
    if (!building.firstCut) {
        building.firstCut = node;
    }
    return false;
}
/**
 * `build`, with no ceiling, for a node the ceiling never cuts (an MCOS object's typed node);
 * then every node under what it built is counted against the ceiling under way. The node
 * itself is a variable or its container's row, which is counted already.
 */
export function buildUncut(build) {
    const outer = building;
    building = null;
    let node;
    try {
        node = build();
    }
    finally {
        building = outer;
    }
    if (outer && node) {
        outer.left -= nodesUnder(node);
    }
    return node;
}
/**
 * `build` under a ceiling of its own, `left` nodes, or under none (null), whatever build is
 * under way: the subtree a node with no rows answers from (MatlabVariableNode._withCeilingTwin),
 * which is no part of the file's tree and counts against nothing in it.
 */
export function buildApart(left, build) {
    const outer = building;
    building = left === null ? null : { left, cut: 0, firstCut: null };
    try {
        return build();
    }
    finally {
        building = outer;
    }
}
function nodesUnder(node) {
    let n = 0;
    const stack = [...node.children];
    while (stack.length > 0) {
        const c = stack.pop();
        n++;
        for (const g of c.children) {
            stack.push(g);
        }
    }
    return n;
}
//# sourceMappingURL=matNodeCeiling.js.map