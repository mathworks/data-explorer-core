import type BaseNode from '../BaseNode.js';
import type { MatVariable } from '../../parser/MatParser.js';
import { type McosSubsystem } from '../../parser/McosSubsystemEdit.js';
import { type McosObjectHeld, type McosPropertyEdit } from '../../parser/McosEditRules.js';
/** What a node's object holds, read once, and what the editor judged of the node before any edit. */
export interface McosObjectState {
    objectId: number;
    held: McosObjectHeld;
    cellIndex: ReadonlyMap<string, number>;
    exact: ReadonlyMap<string, string | null>;
    asRead: ReadonlyMap<string, MatVariable>;
    late: boolean;
    fingerprint: string;
}
/** The node of an object at or above `node`, up to and including `entry`, or null for none. */
export declare function objectNodeAt(entry: BaseNode, node: BaseNode): BaseNode | null;
/** Every node of an object at or under `node`. */
export declare function objectNodesUnder(node: BaseNode): BaseNode[];
/**
 * The property of the object at `object` an edit of `key` at `node` changes, or why it changes
 * none a save writes, as a clause. A key of the object's own row names the property (the Property
 * Inspector's lowerCamel keys, `dimensions`, as MATLAB's `Dimensions`). Anything at or under a
 * Simulink.Parameter's Value node, an element, a struct field, a row added or removed, is its Value.
 * The name of the object's row, which is not the entry's, is where it stands in a struct or a cell,
 * which a save writes as it was read.
 */
export declare function propertyAt(object: BaseNode, node: BaseNode, key: string): {
    property: string;
} | {
    why: string;
};
/**
 * What the object at `node` holds in `subsystem`, read, and the node's fingerprint as it stands;
 * or why no edit of it can be written, as a clause naming it. For MatNode, which keeps one per
 * node from the first time its editor asks.
 */
export declare function objectStateOf(subsystem: McosSubsystem, node: BaseNode): McosObjectState | string;
/**
 * Why no edit of the object at `node` is taken at all, its class being one with no rules
 * (McosEditRules.hasEditRules), as a clause, or null.
 */
export declare function classRefusal(state: McosObjectState, node: BaseNode): string | null;
/**
 * Why an edit of `property` of the object at `node` is refused whatever its value, as a clause, or
 * null where its value decides: not one the node holds an editor's value of, one the rules refuse
 * for the object (McosEditRules.propertyEditRefusal: at its default, an index, an object), one
 * whose value as the node held it did not read back as the file's (McosObjectState.exact), and one
 * whose value now is of a class the rules write none of (McosEditRules.propertyValueRefusal: a
 * sparse Value, which an edit of an element leaves sparse).
 */
export declare function propertyRefusal(state: McosObjectState, node: BaseNode, property: string): string | null;
/**
 * The value of `property` the node of an object holds now, as the variable a save writes, nameless;
 * or why it holds none, as the rest of a clause about the property. `field`, when given, is what the
 * node would hold instead, as the node holds it: a bound as a number or undefined, text as a string,
 * a Value as the value node an edit would make (MatNode._editValueRefusal).
 */
export declare function nodePropertyValue(node: BaseNode, property: string, field?: {
    value: unknown;
}): MatVariable | string;
/**
 * Why `value`, a node built of the text an edit typed into `node`, a field of the struct Value of
 * the Parameter at `object` (or a row under one), is what such a field holds no cell of, as a
 * clause, or null: text, which MATLAB refuses in a Parameter's struct, and anything else the rules
 * do not write (McosEditRules.valueMemberRefusal).
 */
export declare function memberRefusal(object: BaseNode, node: BaseNode, value: BaseNode): string | null;
/**
 * An edit of one element of an array Value, as its setter is about to make it
 * (MatlabVariableNode._setConstrainedValue): the element's row, and the number it is about to hold,
 * or a complex element's text.
 */
export interface ElementEdit {
    element: BaseNode;
    scalar: unknown;
}
/**
 * Every edit of the object at `node`: each property the node holds an editor's value of whose
 * value is not the cell's, with `pending`, an edit about to be made, in place of what the node holds
 * of it; or why one cannot be written, as a clause. A property the node holds no value of a save can
 * write (a Value of a class it has no converter for) is not one the editor offered, and is taken as
 * it was read; one held at its default is an edit only where the node holds another value.
 */
export declare function objectEditsOf(state: McosObjectState, node: BaseNode, pending?: {
    property: string;
    value: MatVariable;
}): {
    edits: McosPropertyEdit[];
} | {
    why: string;
};
/** What a node holds that a save does not write, as text to compare: see the file header. */
export declare function fingerprintOf(node: BaseNode): string;
/** One cell an edit of objects writes, for the save's self-check. */
export interface McosPlannedCell {
    objectId: number;
    cellIndex: number;
    savedName: string;
    value: MatVariable;
}
/**
 * The subsystem element with every edit of the objects at `nodes` written into its cells, and the
 * cells written; or null where none of them holds an edit (each as it was read, or edited back).
 * Throws MatWriteError, naming the variable an object is in and why, for an object or an edit it
 * cannot write: one its editor would not have offered, one the rules refuse, two nodes of one object
 * edited to two values of one property, one a path the editor did not judge changed.
 *
 * `stateOf` is what the editor judged of each node (MatNode._objectState), and `entryOf` the
 * variable a node is in, for the message.
 */
export declare function objectSubsystemEdit(subsystem: McosSubsystem, nodes: readonly BaseNode[], stateOf: (node: BaseNode) => McosObjectState | string, entryOf: (node: BaseNode) => string): {
    element: Uint8Array;
    cells: McosPlannedCell[];
} | null;
//# sourceMappingURL=mcosObjectEdit.d.ts.map