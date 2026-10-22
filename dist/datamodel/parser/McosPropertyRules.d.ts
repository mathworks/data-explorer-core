import type { MatVariable } from './MatParser.js';
/** How a triple holds its value: a value cell, an index into the string table, an integer. */
export type McosHeldKind = 'cell' | 'str' | 'int';
/** One triple an object holds, by what its value is. */
export type McosHeldValue = {
    kind: 'cell';
    value: MatVariable | null;
} | {
    kind: 'str';
    text: string;
} | {
    kind: 'int';
    value: number;
} | {
    kind: 'other';
};
/** An object as the rules read it. */
export interface McosRuleObject {
    className: string;
    held: ReadonlyMap<string, McosHeldValue>;
    defaults: ReadonlyMap<string, MatVariable>;
    handle?: boolean;
}
/** A property's new value, by the property's public name ('Unit', not 'DocUnits'). */
export interface McosRuleEdit {
    property: string;
    value: MatVariable;
}
/** The edits of one object of a save. */
export interface McosRuleTarget {
    key: string;
    object: McosRuleObject;
    edits: readonly McosRuleEdit[];
    bus?: {
        key: string;
        elements: readonly McosRuleObject[];
        index: number;
    };
}
/** One change to an object's property list. */
export type McosTripleOp = {
    op: 'set';
    savedName: string;
    kind: 'cell';
    value: MatVariable;
} | {
    op: 'set';
    savedName: string;
    kind: 'str';
    text: string;
} | {
    op: 'set';
    savedName: string;
    kind: 'int';
    value: number;
} | {
    op: 'remove';
    savedName: string;
};
export type McosRulePlan = {
    ok: true;
    objects: {
        key: string;
        ops: McosTripleOp[];
    }[];
} | {
    ok: false;
    key: string;
    property: string;
    message: string;
};
/**
 * Whether `a` and `b` are one value as MATLAB's omission compares them: the same class, size and
 * complexity, and the same elements, NaN equal to NaN; text by its characters; a struct by its
 * fields in order, a cell by its members. Class- and size-strict: `zeros(1,0)` is not `[]`, and is
 * saved.
 */
export declare function identicalValues(a: MatVariable | null | undefined, b: MatVariable | null | undefined): boolean;
/** Whether objects of `className` take any edit of their properties in a MAT-file. */
export declare function hasPropertyRules(className: string): boolean;
/**
 * The name `property` of a `className` object is saved under, and how its triple holds it, or null
 * where these rules take no edit of it.
 */
export declare function propertyRowOf(className: string, property: string): {
    savedName: string;
    kind: McosHeldKind;
} | null;
/** The public name of the property a `className` object saves as `saved` ('Unit' of 'DocUnits'), or `saved` where no row names it. */
export declare function publicNameOf(className: string, saved: string): string;
/**
 * The values an edit of `property` of a `className` object may take, where they are a closed set
 * (a row's choices, a NumericType's DataTypeMode and Signedness, which its handler takes), or
 * null: what an editor of it offers as a dropdown.
 */
export declare function propertyChoices(className: string, property: string): readonly string[] | null;
/**
 * Whether `property` of a `className` object is one its setters change with an edit of another and
 * no edit sets itself (a Parameter's Dimensions and Complexity, which follow its Value).
 */
export declare function isCoWritten(className: string, property: string): boolean;
/**
 * What a Simulink.Parameter's Value `v` is that these rules write none of (`a cell`, `a sparse
 * double`), or null where they take it: a member of a struct Value where `inStruct`, which holds
 * what a Value may but text.
 */
export declare function parameterValueRefusal(v: MatVariable, inStruct: boolean): string | null;
/** MATLAB's DataType after `p.Value = v` of class `now` over a Value of class `old` under DataType `dt`, measured. */
export declare function parameterDataTypeAfter(old: string, now: string, dt: string): string;
/**
 * The triple operations that write `targets`, the edits of one save, each object's in the order
 * its edits were made, and those MATLAB's own setters make with them; or the first edit refused,
 * the object and property it is about, and why, in words naming it. The edits of one object are
 * judged together, as the object a save leaves: a Min and a Max set in one save are held to each
 * other as they will be. A key named twice is one object, its edits one list.
 */
export declare function planPropertyEdits(targets: readonly McosRuleTarget[]): McosRulePlan;
//# sourceMappingURL=McosPropertyRules.d.ts.map