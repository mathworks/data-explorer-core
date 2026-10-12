export declare const KIND_BY_CLASS: Record<string, string>;
export declare const DERIVED_KIND_BY_CLASS: Record<string, string>;
export declare const KIND_BY_CLASSIFICATION: Record<string, string>;
/**
 * The row `key` names in one of the tables above, or undefined when it names none.
 *
 * By OWN key only. The keys are words a file supplies — a class name, a catalog
 * classification — and `toString`, `valueOf`, `constructor` and the rest of
 * Object.prototype's members are valid MATLAB class names: on these object literals
 * `KIND_BY_CLASS['toString']` is the inherited function, so the Kind of such a class
 * came back a function (and of `constructor`, the Object function) rather than the raw
 * class name every other unlisted class falls back to.
 */
export declare function kindIn(table: Record<string, string>, key: string): string | undefined;
export declare function matlabVariableKind(isDerived: boolean): string;
export declare function kindForClass(className: string, opts?: {
    isDerived?: boolean;
    isMatlabVariable?: boolean;
    classification?: string;
}): string;
//# sourceMappingURL=kindMap.d.ts.map