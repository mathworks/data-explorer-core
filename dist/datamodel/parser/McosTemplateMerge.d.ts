import { type McosDescriptor, type McosSubsystemRecords } from './McosSubsystemCodec.js';
/**
 * The classes a new `.mat` variable can be created as here: every one with a template, but the
 * BusElement, which is created only inside a Bus (mergeTemplateObject's `elements`,
 * addBusElements). What a host offers to create in a MAT-file.
 */
export declare const CREATABLE_MCOS_CLASSES: readonly string[];
/** The class rows one save has added, by class: MATLAB's append writes one per class per save. */
export interface McosAppendSession {
    classes: Map<string, number>;
}
/** A save's session: hand the same one to every merge of one save, as MATLAB shares its rows. */
export declare function createAppendSession(): McosAppendSession;
/** A new object merged into a subsystem: its id, its class row, and what its variable holds. */
export interface McosNewObject {
    objectId: number;
    classIndex: number;
    className: string;
    descriptor: McosDescriptor;
}
/** The class-17 element of a new top-level variable `name` holding `obj`. */
export declare function newObjectVariable(name: string, obj: McosNewObject): Uint8Array;
export interface McosMergeOptions {
    session?: McosAppendSession;
    elements?: readonly string[];
}
/**
 * An empty subsystem in the templates' shape, for a file that has none: what MATLAB's append
 * writes into such a file before the new object. Every template's layers, blob version and
 * sections are the same; only the class systems its stream says it holds differ, and the
 * `string` template's are MCOS alone. So the shape is that, whatever `className` (which must have
 * a template), and each merge gives the stream the class systems its object brings
 * (addClassSystems): a subsystem whose 'handle' object was merged and dropped again is never said
 * to hold one.
 */
export declare function createTemplateSubsystem(className: string): McosSubsystemRecords;
/**
 * A new object of `className`, default-constructed, merged into `sub`: every record of the
 * template copied in MATLAB's order, with a class row per class new to `options.session`.
 * Returns its id, class row and the reference its variable holds. Throws MatWriteError, having
 * changed nothing, for a class with no template, a subsystem of another blob version, or
 * `elements` for a class that is not a Bus or naming an element twice.
 */
export declare function mergeTemplateObject(sub: McosSubsystemRecords, className: string, options?: McosMergeOptions): McosNewObject;
/** The ids of the elements of Bus object `busId`, in order. */
export declare function busElementsOf(sub: McosSubsystemRecords, busId: number): number[];
/**
 * New BusElements named `names` appended to Bus object `busId`, which the file holds already;
 * returns their ids. MATLAB's append would write the whole Bus again; this appends the elements'
 * records and replaces the Bus's Elements reference cell in place, naming the old elements and
 * then the new, so nothing that names the Bus changes. A reference names one class row for all
 * its elements, so the new ones take the file's BusElement row, their property lists made right
 * against that row's defaults (a property saved exactly when it differs). Measured against
 * MATLAB R2023b, R2024b and R2027a, into Buses each of them wrote: loads equal to the Bus
 * MATLAB's own edit saves.
 */
export declare function addBusElements(sub: McosSubsystemRecords, busId: number, names: readonly string[], options?: {
    session?: McosAppendSession;
}): number[];
/**
 * Element `index` (0-based) taken out of Bus object `busId`; returns its id. Its records stay,
 * named by nothing, as MATLAB's own appends leave the objects they replace; the Bus's Elements
 * reference cell is replaced in place without it, 0x0 once it held the last (as MATLAB saves an
 * emptied Bus, class row kept).
 */
export declare function removeBusElement(sub: McosSubsystemRecords, busId: number, index: number): number;
//# sourceMappingURL=McosTemplateMerge.d.ts.map