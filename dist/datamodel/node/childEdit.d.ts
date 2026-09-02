import type BaseNode from './BaseNode.js';
export interface ChildEditableNode<C extends BaseNode = BaseNode> {
    children: BaseNode[];
    parent: BaseNode | null;
    canAddChild(): boolean;
    addChildNode(): C | null;
    canRemoveChild(): boolean;
    removeChildNode(child: BaseNode): void;
    restoreChildNode(child: BaseNode, index: number): void;
}
export interface ChildUndoRedo {
    undo: () => void;
    redo: () => void;
}
export interface ChildAddEdit<C extends BaseNode = BaseNode> extends ChildUndoRedo {
    node: C;
}
export declare function addChildUndoable<C extends BaseNode>(node: ChildEditableNode<C>): ChildAddEdit<C> | null;
export declare function removeChildUndoable(node: ChildEditableNode, child?: BaseNode): ChildUndoRedo | null;
//# sourceMappingURL=childEdit.d.ts.map