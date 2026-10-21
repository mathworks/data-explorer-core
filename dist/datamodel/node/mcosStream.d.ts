import type BaseNode from './BaseNode.js';
/**
 * What answers for an edit inside a stream, with a MAT-file's three answers
 * (MatNode._editRefusal, _editValueRefusal, _valueRefusal): why an edit of `key` at `node` is
 * refused whatever its value, why the value it makes the property hold is, and why a value node
 * typed in for `node` is; or null where the stream's save writes it. `entry` is the entry `node`
 * is in. And, as a MAT-file says it (MatNode._followedProperty), what a property that follows an
 * edit of another follows to once the stream is saved, or undefined.
 */
export interface McosStreamGate {
    _editRefusal(entry: BaseNode, node: BaseNode, key: string): string | null;
    _editValueRefusal(entry: BaseNode, node: BaseNode, key: string, value: unknown): string | null;
    _valueRefusal(entry: BaseNode, node: BaseNode, value: BaseNode): string | null;
    _followedProperty(entry: BaseNode, node: BaseNode, key: string): unknown;
    _twinsOutside(root: BaseNode): BaseNode[];
    _mirrorTwins(root: BaseNode): BaseNode[];
    _nodeEdited(node: BaseNode): void;
}
export declare function setMcosStreamGate(holder: object, gate: McosStreamGate): void;
/** The gate of the stream `holder` holds, or undefined for a node that holds none. */
export declare function mcosStreamGateOf(holder: object): McosStreamGate | undefined;
/**
 * The gate of the stream `node` is in, at or above it within its entry, or null for a node in
 * none. Duck-typed on `isContainer`, as BaseNode.encodedHolderOf walks: the walk stops at the
 * first container, which an entry is a child of.
 */
export declare function mcosStreamGateAbove(node: BaseNode | null | undefined): McosStreamGate | null;
//# sourceMappingURL=mcosStream.d.ts.map