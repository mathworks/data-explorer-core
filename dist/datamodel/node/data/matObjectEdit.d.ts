import type BaseNode from '../BaseNode.js';
import type { MatVariable } from '../../parser/MatParser.js';
import { type McosWrittenCell } from '../../parser/MatFileWriter.js';
import { type McosSubsystemRecords } from '../../parser/McosSubsystemCodec.js';
import { type McosAppendSession } from '../../parser/McosTemplateMerge.js';
import { type McosEditedObject } from '../../parser/McosObjectWrite.js';
import { type McosRuleObject, type McosRuleTarget, type McosTripleOp } from '../../parser/McosPropertyRules.js';
import { type McosObjectState } from './mcosObjectEdit.js';
/** Where a property a node offers is: its object's own, or of an object it holds; and its public name. */
export interface MatSpot {
    nested: {
        saved: string;
        index: number;
    } | null;
    property: string;
}
/**
 * An editor a MAT-file offers of a property its node shows read-only everywhere else
 * (MatNode._offeredEditor, _setOffered): the property the rules write; where the node shows it,
 * which the edit writes: a node field (a bus element's and a ValueType's Dimensions column), read
 * first, and a key of its property bag (what the Property Inspector reads), either or both; and what
 * a typed text is taken as: text as typed, one of the rules' choices, true or false, a number, or a
 * row of numbers ([2 3], -1). Not a bus element's bag, which is its bus's too.
 */
export interface MatBagEditor {
    property: string;
    bag?: string;
    field?: string;
    mirror?: string;
    kind: 'text' | 'choice' | 'flag' | 'number' | 'numbers';
}
/** What the node `holder` shows of the property an editor writes (MatBagEditor): its field, else its bag's key. */
export declare function matBagEditorShown(holder: BaseNode, editor: MatBagEditor): unknown;
/** Every editor a MAT-file offers on a node of `className` (BAG_EDITORS). */
export declare function matBagEditorsOf(className: string): MatBagEditor[];
/**
 * Whether a node's `property` is a spot of its class at all, by the class alone: of an object's own
 * row (`objectClass` its class), its OWN_SPOTS; of a bus element's row (`objectClass` null and the
 * row's class a BusElement), its ELEMENT_SPOTS.
 */
export declare function matOffersSpot(objectClass: string | null, rowClass: string, property: string): boolean;
/** The editor a MAT-file offers of `key` on a node of `className`, or null (BAG_EDITORS). */
export declare function matBagEditorOf(className: string, key: string): MatBagEditor | null;
/** One object a node edits: the node's own, or one it holds. */
interface MatHeldObject {
    shared?: string;
    objectId: number;
    handleOf?: string;
    rule: McosRuleObject;
    path: string;
    bus?: {
        key: string;
        elements: McosRuleObject[];
        index: number;
    };
}
/** What the editor judged of one spot before any edit. */
interface MatSpotState {
    spot: MatSpot;
    holder: BaseNode;
    reference: MatVariable | null;
    exact: string | null;
    asRead: MatVariable | null;
}
/** What a node's object holds, read once, and what the editor judged of the node before any edit. */
export interface MatObjectState extends McosObjectState {
    records: McosSubsystemRecords;
    objects: Map<string, MatHeldObject>;
    spots: Map<string, MatSpotState>;
    payload?: number;
    valueAsRead?: MatVariable;
    elementRows?: BaseNode[];
    structure?: {
        base: MatObjectState;
        added: BaseNode[];
    };
}
/**
 * The value of `property` the node `holder` holds now, as the variable a save writes, nameless; or
 * why it holds none, as the rest of a clause about the property. `field`, when given, is what the
 * node would hold instead, as the node holds it (a bound as a number or undefined, text as a
 * string, a Value as the value node an edit would make). The properties mcosObjectEdit reads, as
 * it reads them; a bus element's Name as the row's name; a StorageClass as its column shows it;
 * any other as the text the node's field of that name holds.
 */
export declare function spotValue(holder: BaseNode, property: string, field?: {
    value: unknown;
}): MatVariable | string;
/**
 * What the object at `node` holds in `records`, read, and what its node offers and shows of it as
 * it stands; or why no edit of it can be written, as a clause naming it. Made once a node, the first
 * time the editor asks (MatNode._objectState).
 */
export declare function matObjectStateOf(records: McosSubsystemRecords, node: BaseNode): MatObjectState | string;
/**
 * What the node of an object, and each row of it a spot is read off, holds that a save does not
 * write, as text to compare: every field but its spots' and those following them, and its property
 * bag but the keys they are saved under (of a CoderInfo, those of its spots). Taken when the
 * state is made, and asked again at the save, which refuses a node whose other fields changed.
 */
export declare function matFingerprintOf(node: BaseNode, state: Pick<MatObjectState, 'spots' | 'objects' | 'held'>): string;
/** The spot key of a Bus's elements added or removed, an edit of its node's own row ('Value', a row added or removed). */
export declare const BUS_ELEMENTS = "Elements";
/** The name a Bus's elements are saved under, which an element added or removed writes. */
export declare const ELEMENTS_SAVED = "Elements_internal";
/**
 * The state of the Bus at `node` with its element rows as they stand (busStructureOf), `base` the
 * state read, its elements removed and added in `sub`, which this writes them into (a copy of the
 * records `base` was read from, or of a superset of them); `base` itself where its rows are as
 * read; or why they cannot be written, as a clause. The name an element added is given in `sub`
 * is its row's where none of the file's kept is called so, and its Name is held to the rules
 * whatever it is (no reference), so that the save writes the row's.
 */
export declare function projectedBusState(sub: McosSubsystemRecords, base: MatObjectState, node: BaseNode, session: McosAppendSession): MatObjectState | string;
/**
 * Whether the node of an object holds nothing a save does not write that differs from what it held
 * when its state was read (matFingerprintOf), and each element row added to it since nothing that
 * differs from what it held when first written (projectedBusState).
 */
export declare function matFingerprintHolds(node: BaseNode, state: MatObjectState): boolean;
/**
 * The spot of the object at `object` an edit of `key` at `node` changes, by its key, or why it
 * changes none a save writes, as a clause. A key of the object's own row names the property (the
 * Property Inspector's lowerCamel keys, `complexity` as MATLAB's `Complexity`), or the property of
 * an object it holds that its column shows (`storageClass`, its CoderInfo's StorageClass); a key of
 * a bus element's row, that element's (its Name, for the row's own name); an edit at or under a
 * Simulink.Parameter's Value node, its Value (mcosObjectEdit.propertyAt's rule). `describe` false
 * answers REFUSED for a refusal, unworded, for an editor drawn.
 */
export declare function matPropertyAt(state: MatObjectState, object: BaseNode, node: BaseNode, key: string, describe?: boolean): {
    key: string;
} | {
    why: string;
};
/** Why no edit of the object at `node` is taken at all, its class being one with no rules, as a clause, or null. */
export declare function matClassRefusal(state: MatObjectState, node: BaseNode): string | null;
/**
 * How the object at a node is shared with other nodes of the file: 'twins', a Parameter or a Signal
 * other nodes hold the handle of too, each shown each edit (mcosObjectEdit.mirrorTwins), and named
 * by `with`; 'value', any other object another node is too, which shows no edit made through this
 * one; or null for one no other node is.
 */
export type MatSharing = {
    kind: 'twins' | 'value';
    with: BaseNode;
} | null;
/**
 * Why an edit of the spot `key` of the object at `node` is refused whatever its value, as a clause,
 * or null where its value decides: its value as the node held it did not read back as the file's
 * (MatSpotState.exact); the node holds none a save writes; the object is shared with another node,
 * which would not show the edit. Of a Bus's Elements (BUS_ELEMENTS), why no element row is added
 * or removed (busStructureRefusal).
 */
export declare function matSpotRefusal(state: MatObjectState, node: BaseNode, key: string, sharing: MatSharing): string | null;
/**
 * matSpotRefusal of each object's node and spot, found once and kept until an edit at or under the
 * node (forget), as mcosObjectEdit.McosPropertyVerdicts keeps its own.
 */
export declare class MatSpotVerdicts {
    readonly _byNode: WeakMap<BaseNode, Map<string, string | null>>;
    of(state: MatObjectState, node: BaseNode, key: string, sharing: MatSharing): string | null;
    /** An edit at `edited`: what was found of every node at or above it is forgotten. */
    forget(edited: BaseNode): void;
}
/**
 * Every edit of the object at `node`: each spot whose value is not the file's, with `pending`, an
 * edit about to be made (a spot's key and the value it would hold), in place of what the node
 * holds of it; as the rules' targets, one per object the edits are of; or why one cannot be
 * written, as a clause. A spot the node holds no value of a save writes is not one the editor
 * offered, and is taken as it was read; one whose value as read was not the file's is an edit only
 * where the node holds another value than it did then.
 *
 * A Simulink.Parameter's DataType goes with its Value: the node shows the DataType MATLAB's own
 * `p.Value = v` leaves (matShownDataType), so where its Value is edited its DataType is written as
 * the node holds it, the file's included, and the rules hold the two to each other.
 */
export declare function matObjectEditsOf(state: MatObjectState, node: BaseNode, pending?: {
    key: string;
    value: MatVariable;
}, more?: ReadonlyMap<string, MatVariable>): {
    targets: McosRuleTarget[];
    strings: MatStringEdit[];
} | {
    why: string;
};
/** The text a `string` object of the file is to hold: its payload's value cell, and the text, column-major, and size. */
export interface MatStringEdit {
    objectId: number;
    valueIndex: number;
    texts: (string | null)[];
    dims: number[];
}
/**
 * Why the edits of the object at `node`, with `pending` in place of what the node holds of its
 * spot, are refused by the rules, as a clause, or null where a save writes them.
 */
export declare function matEditsRefusal(state: MatObjectState, node: BaseNode, pending?: {
    key: string;
    value: MatVariable;
}, more?: ReadonlyMap<string, MatVariable>): string | null;
/**
 * The DataType the Simulink.Parameter at `node` holds after an edit of its Value, as its node is to
 * show it (ParameterNode._followSourceDataType, which asks after each change of its Value, an undo
 * and a redo included): dataTypeShownFor its Value's class now. Null for another class, or a Value
 * the node holds none of a save writes.
 */
export declare function matShownDataType(state: MatObjectState, node: BaseNode): string | null;
/**
 * The NumericType at `node` as MATLAB's setter of `property` leaves it given `value`, from what its
 * node holds now (not the file: an earlier edit's mode gates this one): its bag's shown values, by
 * key, to show; or why MATLAB's setter refuses it (McosPropertyRules.planPropertyEdits, on an object
 * holding what the node does).
 */
export declare function matNumericTypeAfter(state: MatObjectState, node: BaseNode, property: string, value: MatVariable): {
    values: Record<string, unknown>;
} | {
    why: string;
};
/** The subsystem a save writes for the edits of a MAT-file's objects, for MatFileWriter. */
export interface MatObjectsWritten {
    element: Uint8Array;
    records: McosSubsystemRecords;
    cells: McosWrittenCell[];
    swapOnly: boolean;
    edited: McosEditedObject[];
}
/**
 * The subsystem element with every edit of the objects at `nodes` written into it (MatObjectsWritten);
 * or null where none of them holds an edit (each as it was read, or edited back). Throws
 * MatWriteError, naming the variable an object is in and why, for an object or an edit it cannot
 * write: one its editor would not have offered, one the rules refuse, two nodes of one object
 * edited to two values of one property, one a path the editor did not judge changed.
 *
 * `stateOf` is what the editor judged of each node (MatNode._objectState), `entryOf` the variable a
 * node is in, for the message, and `more` the save's other edits of the records (a `string`'s).
 */
export declare function matObjectSubsystemEdit(records: McosSubsystemRecords, nodes: readonly BaseNode[], stateOf: (node: BaseNode) => MatObjectState | string, entryOf: (node: BaseNode) => string, more?: {
    has: boolean;
    edit: (sub: McosSubsystemRecords) => void;
}): MatObjectsWritten | null;
export type { McosTripleOp };
//# sourceMappingURL=matObjectEdit.d.ts.map