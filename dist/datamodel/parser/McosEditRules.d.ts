import type { MatVariable } from './MatParser.js';
import type { McosEditRefusal } from './McosSubsystemEdit.js';
/** One property an object holds a triple for, as the rules read it. */
export interface McosHeld {
    refusal: McosEditRefusal | null;
    value: MatVariable | null;
}
/** An object of a subsystem, as the rules read it. */
export interface McosObjectHeld {
    className: string;
    stored: ReadonlyMap<string, McosHeld>;
}
/** A property's new value, by the property's public name ('Unit', not 'DocUnits'). */
export interface McosPropertyEdit {
    property: string;
    value: MatVariable;
}
/** One value cell to write: the name it is saved under, and the value, nameless. */
export interface McosCellValue {
    savedName: string;
    value: MatVariable;
}
export type McosRulesResult = {
    ok: true;
    cells: McosCellValue[];
} | {
    ok: false;
    property: string;
    message: string;
};
/** The name `property` of a `className` object is saved under, or null where it takes no edit. */
export declare function savedNameOf(className: string, property: string): string | null;
/** Whether objects of `className` take any edit at all. */
export declare function hasEditRules(className: string): boolean;
/**
 * Why `property` of the object `held` describes takes no edit whatever its new value, as a clause
 * naming it under `path` (the object's MATLAB path, `s.p`), or null where it takes one that the
 * value then decides (objectEditCells).
 */
export declare function propertyEditRefusal(held: McosObjectHeld, property: string, path: string): string | null;
/**
 * Why `value`, as `property` of a `className` object holds it now, is one the rules write no cell
 * of, as a clause naming the property under `path`, or null: what the editor asks of a property
 * before any edit of it, a Value an edit of an element or a field leaves of the class it is.
 */
export declare function propertyValueRefusal(className: string, property: string, value: MatVariable, path: string): string | null;
/**
 * What a member of a struct Value, `value`, is that the rules write no cell of (`a string`), or
 * null: a struct field of a Parameter holds what its Value may, and a char of any shape.
 */
export declare function valueMemberRefusal(value: MatVariable): string | null;
/**
 * The value cells to write for `edits` of the object `held` describes, each edit's own and those
 * MATLAB's own edit changes with it; or the first edit refused, and why, as a clause naming the
 * property under `path`. No edits is no cells.
 *
 * The edits are judged together, as the object a save leaves: a Min and a Max set in one save are
 * held to each other as they will be, not as they were.
 *
 * `followed`, for a Simulink.Parameter, is the DataType its node shows (followedDataType): MATLAB's
 * after each edit of its Value in turn, written in place of the one derived from the file's Value
 * and DataType, with the Value, or on its own where the edits typed the Value back to the file's.
 */
export declare function objectEditCells(held: McosObjectHeld, edits: readonly McosPropertyEdit[], path: string, followed?: string): McosRulesResult;
/**
 * The DataType of the Simulink.Parameter `held` once its Value is `v`, as MATLAB's own `p.Value = v`
 * makes it over a Value of class `before` (the file's, where none is given) under DataType `dt`: the
 * one its node shows as it follows each edit of the Value in turn. Null where the object holds no
 * DataType cell that reads, whose DataType the rules derive from the file's alone (valueCoWrites).
 */
export declare function followedDataType(held: McosObjectHeld, v: MatVariable, before: string | undefined, dt: string): string | null;
//# sourceMappingURL=McosEditRules.d.ts.map