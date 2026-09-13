// Copyright 2026 The MathWorks, Inc.
//
// What a multi-row delete amounts to in the model: entries to remove whole, and
// nested children grouped under the entry each belongs to.
//
// Delete is the one action with no DESTINATION, which is why it is row-granular while
// copy/cut/paste/drag stay entry-granular. That makes it the one action whose operands can
// be a mix of entries and children across sections, and this is where that mix becomes
// work: one removal per entry, one text splice per entry whose children changed, all in a
// single undo step.
//
// Shared by every front-end for the reason it was already shared by two providers of one
// front-end: the formats differ only in how they get a live model and how they splice
// text — never in what deleting a row means. `findNode` is injected for the first
// difference; the splice stays with the caller for the second.
//
// GROUPING IS THE POINT. Two children of one bus must arrive as ONE group: each group
// reserializes its entry, so two groups over the same entry would each write a stale
// copy and the second would undo the first. Same reason a drop path dedupes by
// owning entry.
import { owningEntryOf } from '../datamodel/node/DataNode.js';
// Whether any node STRICTLY above `node` is in the selection. Deleting an ancestor
// already removes this node, so planning both would splice a child out of an entry
// that is about to disappear — and the second model op would throw on a node no longer
// in the tree.
//
// The chain is `BaseNode`, not `DataNode`: a section and a source root sit above every
// entry and are ContainerNodes. They can never BE in the selection (nothing resolves a
// row id to one), so the walk simply passes them; typing them out would only mean
// stopping the walk early and calling it a narrower type.
function hasSelectedAncestor(node, selected) {
    for (let n = node?.parent; n; n = n.parent) {
        if (selected.has(n))
            return true;
    }
    return false;
}
/**
 * Plan the deletion of `rowIds`.
 *
 * A row id that resolves to nothing, to a section header, or to a node with no owning
 * entry contributes nothing rather than aborting the gesture: one stale id in a
 * selection must not make Delete do nothing at all. That tolerance extends to what
 * `findNode` hands back — the two members read here, `isEntry` and `parent`, are read off
 * the object, so a resolver that answers with a section (a ContainerNode, which has no
 * `isEntry` at all) yields nothing for that row instead of a type error at runtime.
 *
 * Nothing is mutated here. The plan is read-only, which is what lets a caller compute
 * selectors and the post-delete selection BEFORE any removal changes the tree.
 */
export function planDeletion(rowIds, findNode) {
    // Resolved once, in order, so identity comparisons below are against the same objects
    // the caller will act on.
    const nodes = [];
    const seen = new Set();
    for (const rowId of rowIds) {
        const node = findNode(rowId);
        if (!node || seen.has(node))
            continue;
        seen.add(node);
        nodes.push(node);
    }
    const entries = [];
    const childGroups = [];
    const groupOf = new Map();
    for (const node of nodes) {
        if (hasSelectedAncestor(node, seen))
            continue;
        if (node.isEntry) {
            entries.push(node);
            continue;
        }
        const entry = owningEntryOf(node);
        if (!entry)
            continue;
        let group = groupOf.get(entry);
        if (!group) {
            group = { entry, children: [] };
            groupOf.set(entry, group);
            childGroups.push(group);
        }
        group.children.push(node);
    }
    return { entries, childGroups };
}
//# sourceMappingURL=deletionPlan.js.map