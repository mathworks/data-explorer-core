import type { MatVariable } from './MatParser.js';
/**
 * Why an edit was refused.
 *
 * - `malformed`: a layer does not parse exactly — a byte count that does not tile its
 *   element, a struct without exactly one MCOS field, an opaque that is not a
 *   FileWrapper__, a blob whose segments do not tile, a triple naming a string or a cell
 *   that is not there.
 * - `unsupported`: it parses, as a blob this editor was not measured on: a version other
 *   than 4.0, big-endian, or a file header holding more than the one table MATLAB R2027a
 *   writes there. Any of them could hold a reference to a cell this cannot see.
 * - `bad-object`: the id names no object: 0 (the null object, which MATLAB writes for a
 *   deleted handle), past the object table, or not a whole number.
 * - `not-stored`: the object's property list has no such property. It is at its class
 *   default, and MATLAB saves no value for one, so there is no cell to replace; setting it
 *   means inserting a triple, which moves every later offset in the blob. So is every
 *   property of an object whose class saves it as one payload (its property list is 0).
 * - `not-a-cell`: the property is stored, but not in a cell: as a string-table index (a
 *   Parameter's Complexity, a CoderInfo's StorageClass), an integer, or an object id.
 * - `shared-cell`: another triple — of any object, a constructor argument, or a per-array
 *   property — names the same cell, which a swap would change too. MATLAB writes one cell
 *   per value, and no MATLAB-written file was seen sharing one.
 * - `shared-list`: another object's row names the same property list, whose every cell a swap
 *   would change for both. MATLAB writes a list per object, and no file was seen sharing one.
 * - `object-reference`: the cell, the old one or the new, holds an object reference: a
 *   uint32 whose first word is the handle magic, at any depth, or an object of any kind.
 *   MATLAB turns such a word into an object on load, so the swap would re-point the
 *   object graph, not change a value.
 * - `bad-cell`: the new cell is not one whole nameless miMATRIX whose payloads hold what
 *   its dims declare, or the subsystem it makes is past what its int32 dims can say.
 * - `duplicate-edit`: two edits name one property.
 */
export type McosEditRefusal = 'malformed' | 'unsupported' | 'bad-object' | 'not-stored' | 'not-a-cell' | 'shared-cell' | 'shared-list' | 'object-reference' | 'bad-cell' | 'duplicate-edit';
export interface McosRefusal {
    ok: false;
    reason: McosEditRefusal;
    savedName?: string;
    message: string;
}
/** One property's new value. */
export interface McosCellEdit {
    savedName: string;
    cell: Uint8Array;
}
export type McosEditResult = {
    ok: true;
    bytes: Uint8Array;
} | McosRefusal;
/** One triple of an object's property list, as storedProperties reports it. */
export interface McosStoredProperty {
    savedName: string;
    flag: number;
    cellIndex: number | null;
    refusal: McosEditRefusal | null;
}
export type McosStoredResult = {
    ok: true;
    className: string;
    properties: McosStoredProperty[];
} | McosRefusal;
/** A sub-element: its tag, type, payload and length, and where it ends, padding included. */
export interface McosSub {
    at: number;
    type: number;
    data: number;
    bytes: number;
    end: number;
}
/** An miMATRIX element and the sub-elements that tile it. */
export interface McosLayer {
    at: number;
    end: number;
    subs: McosSub[];
}
/** A triple of a property list, constructor-argument list or per-array map, and where it is. */
export interface McosTriple {
    name: number;
    flag: number;
    value: number;
    at: number;
}
/** A row of the object table: words 0, 3 and 4 of its 24 bytes. */
export interface McosObjectRow {
    classId: number;
    ctorList: number;
    pvList: number;
}
/**
 * A subsystem read whole, every position an offset into `bytes`. What readMcosSubsystem
 * gives, for a caller asking several questions of one subsystem.
 */
export interface McosSubsystem {
    readonly bytes: Uint8Array;
    readonly outer: McosLayer;
    readonly struct: McosLayer;
    readonly mcosField: number;
    readonly opaque: McosLayer;
    readonly cellArray: McosLayer;
    readonly cells: McosSub[];
    readonly blobAt: number;
    readonly strings: string[];
    readonly classes: (string | null)[];
    readonly objects: McosObjectRow[];
    readonly ctorLists: McosTriple[][];
    readonly pvLists: McosTriple[][];
    readonly perArray: McosTriple[];
    readonly valueCells: number;
    readonly references: ReadonlyMap<number, number>;
    readonly listUsers: ReadonlyMap<number, number>;
}
export type McosSubsystemRead = {
    ok: true;
    subsystem: McosSubsystem;
} | McosRefusal;
/**
 * Reads a subsystem element whole, for a caller asking several questions of one; or refuses
 * it, when a layer does not parse exactly or is one this editor was not measured on.
 */
export declare function readMcosSubsystem(bytes: Uint8Array): McosSubsystemRead;
/**
 * Every property object `objectId` saved a triple for, in the order of its property list,
 * and whether editMcosSubsystem takes a swap of each: what the node layer decides
 * editability by. A property it does not list is at its class default, and takes none.
 */
export declare function storedProperties(subsystem: Uint8Array | McosSubsystem, objectId: number): McosStoredResult;
/**
 * The subsystem with the value cells of object `objectId`'s properties replaced, one per
 * edit, and every other byte as it was; or why not, for the first edit refused (nothing is
 * written then). No edits is the subsystem re-emitted as it was read.
 */
export declare function editMcosSubsystem(subsystem: Uint8Array | McosSubsystem, objectId: number, edits: readonly McosCellEdit[]): McosEditResult;
/** The edits of one object, for editMcosObjects. */
export interface McosObjectEdits {
    objectId: number;
    edits: readonly McosCellEdit[];
}
/**
 * editMcosSubsystem for the edits of several objects at once, the subsystem re-emitted once around
 * all of them; or why not, for the first edit refused (nothing is written then). An object named
 * twice is refused, as one property edited twice is: its edits are one list.
 */
export declare function editMcosObjects(subsystem: Uint8Array | McosSubsystem, objects: readonly McosObjectEdits[]): McosEditResult;
/**
 * What value cell `cellIndex` of the subsystem holds, read as MatParser reads a matrix (which is
 * how McosParser reads the same cell into an object's property), or null for an index past the
 * cells or a cell that does not read.
 */
export declare function cellValueAt(subsystem: McosSubsystem, cellIndex: number): MatVariable | null;
/**
 * The id of element `index` (0-based, column-major, MATLAB's order) of the objects a handle
 * names, or null when it names none there: an index past its elements, or the null object 0,
 * which MATLAB writes for a deleted handle. The handle is MatVariable's `mcosHandle`, or the
 * words [0xDD000000, ndims, dims…, ids…, classIdx] as they are held (McosHandle.ts).
 */
export declare function objectIdOf(handle: {
    dims: number[];
    ids: number[];
} | number[] | null | undefined, index?: number): number | null;
/**
 * A fresh value cell for `v`: MatWriter's nameless miMATRIX, which keeps the two rules MATLAB
 * writes a subsystem cell by — a payload of 1 to 4 bytes takes the small tag, and a value
 * goes out in its own class's type, never narrowed (a double 5 is miDOUBLE) — so the cell of
 * a value MATLAB would have saved is the cell MATLAB saves. Throws MatWriteError for a value
 * MatWriter cannot write, an object among them.
 */
export declare function valueCellOf(v: MatVariable): Uint8Array;
//# sourceMappingURL=McosSubsystemEdit.d.ts.map