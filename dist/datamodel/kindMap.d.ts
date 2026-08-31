export declare const KIND_BY_CLASS: Record<string, string>;
export declare const DERIVED_KIND_BY_CLASS: Record<string, string>;
export declare const KIND_BY_CLASSIFICATION: Record<string, string>;
export declare function matlabVariableKind(isDerived: boolean): string;
export declare function kindForClass(className: string, opts?: {
    isDerived?: boolean;
    isMatlabVariable?: boolean;
    classification?: string;
}): string;
//# sourceMappingURL=kindMap.d.ts.map