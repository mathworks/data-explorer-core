/** Why `name` is not a name MATLAB can load, or null when it is one. */
export declare function validateMatlabName(name: string): string | null;
/**
 * `base`, or `base` with the first counter appended (1, 2, …) that makes a name `taken` says no
 * entry holds: the name a new entry of a namespace is given, whose holder says what it holds
 * (SectionNode._uniqueName, MatNode._uniqueName).
 */
export declare function uniqueName(base: string, taken: (name: string) => boolean): string;
/**
 * The name a new entry asked for as `asked` is given (uniqueName), and why it is no name MATLAB can
 * load, or null: the one rule of a dictionary's Add and a MAT-file's (SectionNode.addEntry,
 * MatNode.execAddEntry), which the session's addEntry says it applies. The name is judged as asked
 * for and again with its counter: the first stops an invalid name becoming a valid one by the
 * counter ('end' when an 'end' is already present must not become 'end1'), and the second stops a
 * valid 63-character name growing past namelengthmax.
 */
export declare function newEntryName(asked: string, taken: (name: string) => boolean): {
    name: string;
    invalid: string | null;
};
//# sourceMappingURL=matlabName.d.ts.map