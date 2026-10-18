// Copyright 2026 The MathWorks, Inc.

// The node-count ceiling of a .mat file's tree (DisplayConvention.MAT_NODE_CEILING): how many
// nodes MatNode.fromParsed builds the file's variables with, all of them together, and which
// containers it declines to build the rows of past it. MEM-CEIL, the maintainer's group F
// ruling of 2026-10-18, group 3: a node-count ceiling with a source warning now, lazy
// expansion later, as its own item.
//
// ARMED ONLY WHILE A .mat FILE'S TREE IS BUILT (buildUnderCeiling), as MatWriter arms its
// budget only while one value is written, and set back in a finally. Nothing else is built
// under it: a dictionary's value read out of a MAT stream (MatlabVariableNode.parseEncoded,
// parseCdata), which is an entry a user edits, and a model's workspace
// (ModelSectionNode.addWorkspaceEntry), whose warnings the C-232 ruling keeps off the model.
//
// A container is built with ALL its direct rows or with NONE (admitRows), for the reason
// MAX_EXPANDED_ELEMENTS is: its rows and what it was read from are two copies of one value,
// and a container with some of its rows would be read through them. The rows of a struct
// array are its elements and their fields together, since an element row holds no value of
// its own. A container that does not fit has no rows (`_cutByCeiling`) and keeps what it was
// read from (`_matVar`), so what it shows and what a copy of it is are what they were: it
// answers from the subtree rebuilt for the asking (MatlabVariableNode._withCeilingTwin), whole
// and with no ceiling for a copy, its own rows alone for its literal, and drops it after. Each
// container under one built with its rows decides for itself, depth first, so the file's first
// values are whole and the later ones have no rows.
//
// Every variable at the top of the file is built and counted before any row under one, so
// every name is listed, and a tree with no MCOS object in it is at most the ceiling or its
// variables, whichever is more. An MCOS object's typed node (a Simulink.Parameter, an object
// array, a decoded string) is built whole, whatever is left, and what it holds is counted
// (buildUncut): its rows, a typed object's properties or a string's elements, are built from
// a decode rather than from the variable, and a cut one would have nothing to answer from.

/** A node whose rows the ceiling may decline to build: a MatlabVariableNode read out of a .mat file. */
interface Cuttable {
  /** How many direct rows the ceiling declined to build here; absent when it built them. */
  _cutByCeiling?: number;
}

/** A node, as far as counting it and what is under it goes. */
interface Counted {
  children: Counted[];
}

/** What is left of one build's ceiling, and what it declined. */
interface Building {
  left: number;
  cut: number;
  firstCut: Cuttable | null;
}

/** The ceiling of the build under way (buildUnderCeiling), or null between builds. */
let building: Building | null = null;

/**
 * Runs `build` with `ceiling` nodes to build, and says how many containers it built without
 * their rows and which was the first of them, in the order it built them (depth first).
 */
export function buildUnderCeiling<T, N extends Cuttable>(
  ceiling: number,
  build: () => T,
): { result: T; cut: number; firstCut: N | null } {
  const outer = building;
  const own: Building = { left: ceiling, cut: 0, firstCut: null };
  building = own;
  try {
    const result = build();
    return { result, cut: own.cut, firstCut: own.firstCut as N | null };
  } finally {
    building = outer;
  }
}

/** Counts `n` nodes the ceiling builds whatever is left of it: the variables at the top of the file. */
export function chargeNodes(n: number): void {
  if (building) {
    building.left -= n;
  }
}

/**
 * Whether `node` may build its `k` direct rows: yes, taking them from the ceiling, when they
 * fit in what is left of it, or when no ceiling is armed; otherwise no, and `node` is recorded
 * as built without them.
 */
export function admitRows(node: Cuttable, k: number): boolean {
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
export function buildUncut<T extends Counted | null>(build: () => T): T {
  const outer = building;
  building = null;
  let node: T;
  try {
    node = build();
  } finally {
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
export function buildApart<T>(left: number | null, build: () => T): T {
  const outer = building;
  building = left === null ? null : { left, cut: 0, firstCut: null };
  try {
    return build();
  } finally {
    building = outer;
  }
}

function nodesUnder(node: Counted): number {
  let n = 0;
  const stack: Counted[] = [...node.children];
  while (stack.length > 0) {
    const c = stack.pop()!;
    n++;
    for (const g of c.children) {
      stack.push(g);
    }
  }
  return n;
}
