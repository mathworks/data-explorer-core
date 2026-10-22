import type { MatVariable } from './MatParser.js';
import { type McosSubsystemRecords } from './McosSubsystemCodec.js';
import type { McosRuleObject, McosTripleOp } from './McosPropertyRules.js';
/** The value a whole miMATRIX element holds, read as MatParser reads a matrix, or null where it does not read. */
export declare function elementValue(element: Uint8Array): MatVariable | null;
/**
 * What the rules read of object `objectId`: its class, every triple of its property list by saved
 * name, and the fields of its class's defaults struct in the file (the entry of the per-class
 * defaults cell for its class row), which is what an omitted property loads as.
 */
export declare function ruleObjectOf(sub: McosSubsystemRecords, objectId: number): McosRuleObject;
/**
 * What the rules read of the object a 'handle' opaque value cell holds (a CoderInfo saved by MATLAB
 * R2024b or earlier, or from the R2023b templates): object 1 of its own small blob, its class and
 * its triples; no defaults struct, since such an object saves every property. Or why not, as a
 * clause: an opaque that does not read whole.
 */
export declare function handleRuleObjectOf(cell: Uint8Array): McosRuleObject | string;
/** The fields of class row `classIndex`'s defaults struct, read; none where the file holds no 1x1 struct there. */
export declare function defaultsOf(sub: McosSubsystemRecords, classIndex: number): Map<string, MatVariable>;
/**
 * The ids of the objects property `savedName` of object `objectId` holds: the objects its value
 * cell names (a nested object, an array of them: a Bus's Elements_internal), or the one object
 * its triple names; null where it holds none.
 */
export declare function heldObjectIds(sub: McosSubsystemRecords, objectId: number, savedName: string): number[] | null;
/**
 * `ops` made on object `objectId` of `sub`, in place and in order, through the codec's edits: a
 * value set into a cell swaps the cell the triple names, or inserts a triple naming a new cell
 * appended after every other; a text or an integer set replaces its triple in place, or inserts
 * one; a removal takes the triple out and leaves its cell, which nothing names any more. Throws
 * MatWriteError, having made the ops before it, for one the codec refuses (a cell another triple
 * names too), or a value cell this package cannot write, naming the property as a user does.
 */
export declare function applyTripleOps(sub: McosSubsystemRecords, objectId: number, ops: readonly McosTripleOp[]): void;
/**
 * `ops` made on the CoderInfo a 'handle' opaque holds, the value of property `saved` of object
 * `ownerId`: the opaque rebuilt with its StorageClass, Identifier (saved as Alias) and Alignment as
 * the ops set them, as MATLAB's own save writes it (McosSubsystemCodec.editHandleCoderInfo), and the
 * owner's value cell swapped for it. Throws MatWriteError for what the codec refuses, or an op on
 * any other property.
 */
export declare function applyHandleOps(sub: McosSubsystemRecords, ownerId: number, saved: string, ops: readonly McosTripleOp[]): void;
/**
 * The ops of each object of one save, by object id; of the CoderInfo of a 'handle' opaque, by the
 * id of the object that holds it and the property it is (`handleOf`, 'CoderInfo').
 */
export interface McosObjectOps {
    objectId: number;
    ops: readonly McosTripleOp[];
    handleOf?: string;
}
/**
 * The subsystem `records` hold with `objects`' ops made, written, and read back against the
 * records meant (verifySubsystem): its element, and those records; or why not, as a clause.
 * `records` are left as they were. `more`, when given, makes the save's other edits of the records
 * (a `string` variable's) before the subsystem is written, and `also` names the objects and
 * properties it writes. The element is held to the edited records, and they to `records`, every
 * object and property no edit names as it was (editedObjects), unless `verify` is false: a save's
 * self-check verifies the element as it lands in the file (MatFileWriter.subsystemRecordsDiffer),
 * once.
 */
export declare function writeObjectEdits(records: McosSubsystemRecords, objects: readonly McosObjectOps[], more?: (sub: McosSubsystemRecords) => void, also?: readonly McosEditedObject[], verify?: boolean): {
    ok: true;
    element: Uint8Array;
    records: McosSubsystemRecords;
} | {
    ok: false;
    message: string;
};
/**
 * The objects of a subsystem `objects`' ops and `also` edit, each with the saved names of the
 * properties they write: of a 'handle' opaque, the property holding it; of an object saved as one
 * payload (a `string`), 'any'. What the codec holds a written subsystem's edits to
 * (verifySubsystem's `edited`): every other object, property and value cell as it was read.
 */
export declare function editedObjects(objects: readonly McosObjectOps[], also?: readonly McosEditedObject[]): McosEditedObject[];
/** An object a save's edits write, and the saved names of the properties they write of it. */
export interface McosEditedObject {
    objectId: number;
    properties: readonly string[];
}
//# sourceMappingURL=McosObjectWrite.d.ts.map