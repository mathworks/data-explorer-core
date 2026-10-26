// Copyright 2026 The MathWorks, Inc.
//
// How often the values under a node have changed, as a generation, for a verdict judged of a value
// to be kept until it may no longer hold: editText's, on the text an editor of a value shown as a
// summary is seeded with (the D14 ruling of the 2026-10-26 edit bash). Judging it spells the value
// whole and reads it back, which a row asked for at every repaint cannot afford to do again for a
// value nobody changed.
//
// Two generations are asked of a node. Its entry's, which every edit of a value at or under the
// entry moves on (DataNode._markModified: a value's own edit, an element's, an Add, a removal), and
// every edit, undo and redo the session makes of it, or a host makes of it itself, in the bracket
// it is made in (DataModel.mutateSubtree, editInEntry, withTwins): an undo may put a value back
// without marking it edited. And its source's (its topmost node), which an edit of what is in no
// entry moves on: a host's of a whole section or source. An edit of one entry leaves what was judged
// of every other as it was. Held beside the nodes and only ever moved forward, so that an undo,
// which puts back what a node holds of its own, cannot put back a generation a verdict was judged at.
const generations = new WeakMap();
let latest = 0;
/** Move `node`'s generation on: what was judged of any value under it is to be judged again. */
export function valueChanged(node) {
    generations.set(node, ++latest);
}
/** Move the generation of `node`'s source, its topmost node, on. */
export function sourceValuesChanged(node) {
    valueChanged(topOf(node));
}
/** Move on the generation of the entry `node` is in, or of its source where it is in none. */
export function entryValuesChanged(node) {
    if (node.owningEntry) {
        valueChanged(node.owningEntry);
    }
    else {
        sourceValuesChanged(node);
    }
}
const verdicts = new WeakMap();
let judgments = 0;
/** How many verdicts have been judged, kept ones not counted: what an edit cost the rows built after it. */
export function verdictsJudged() {
    return judgments;
}
/**
 * `judge`'s verdict on `node`'s value, judged once for the generations of its entry and its source
 * (an entry-less node's are its topmost node's) and kept until either moves on.
 */
export function keptVerdict(node, judge) {
    const top = topOf(node);
    const at = (generations.get(node.owningEntry ?? top) ?? 0) + ':' + (generations.get(top) ?? 0);
    const held = verdicts.get(node);
    if (held?.at === at) {
        return held.verdict;
    }
    judgments++;
    const verdict = judge();
    verdicts.set(node, { at, verdict });
    return verdict;
}
function topOf(node) {
    let top = node;
    while (top.parent) {
        top = top.parent;
    }
    return top;
}
//# sourceMappingURL=valueGeneration.js.map