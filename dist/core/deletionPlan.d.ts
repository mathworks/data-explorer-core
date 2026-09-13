import type DataNode from '../datamodel/node/DataNode.js';
export interface ChildGroup {
    /** The entry to reserialize once, after all its children are removed. */
    entry: DataNode;
    /** Its children to remove, in selection order. */
    children: DataNode[];
}
export interface DeletionPlan {
    /** Whole entries to remove, in selection order. */
    entries: DataNode[];
    /** Children to remove, grouped by owning entry, groups in first-seen order. */
    childGroups: ChildGroup[];
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
export declare function planDeletion(rowIds: readonly string[], findNode: (rowId: string) => DataNode | null): DeletionPlan;
//# sourceMappingURL=deletionPlan.d.ts.map