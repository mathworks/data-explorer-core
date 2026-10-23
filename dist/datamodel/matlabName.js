// Copyright 2026 The MathWorks, Inc.
//
// The rule for a name MATLAB can load: a valid identifier, not a keyword, at most
// namelengthmax (63) characters. It lives in its own module, with no model
// dependencies, because several node classes apply it and none should import another
// for it. DataNode.setProperty applies it to a rename, and a dictionary's and a
// MAT-file's Add (SectionNode.addEntry, MatNode.execAddEntry) to a new entry through
// newEntryName, so an entry cannot be created under a name it could not be renamed to,
// and is named alike in both.
const MATLAB_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const MATLAB_KEYWORDS = new Set([
    'break',
    'case',
    'catch',
    'classdef',
    'continue',
    'else',
    'elseif',
    'end',
    'for',
    'function',
    'global',
    'if',
    'otherwise',
    'parfor',
    'persistent',
    'return',
    'spmd',
    'switch',
    'try',
    'while',
]);
/** Why `name` is not a name MATLAB can load, or null when it is one. */
export function validateMatlabName(name) {
    if (!name || !name.trim()) {
        return 'Name cannot be empty';
    }
    if (!MATLAB_NAME_RE.test(name)) {
        return 'Invalid MATLAB name. Must start with a letter and contain only letters, digits, and underscores';
    }
    if (name.length > 63) {
        return 'Name exceeds maximum length of 63 characters';
    }
    if (MATLAB_KEYWORDS.has(name)) {
        return "'" + name + "' is a reserved MATLAB keyword";
    }
    return null;
}
/**
 * `base`, or `base` with the first counter appended (1, 2, …) that makes a name `taken` says no
 * entry holds: the name a new entry of a namespace is given, whose holder says what it holds
 * (SectionNode._uniqueName, MatNode._uniqueName).
 */
export function uniqueName(base, taken) {
    if (!taken(base)) {
        return base;
    }
    let i = 1;
    while (taken(base + i)) {
        i++;
    }
    return base + i;
}
/**
 * The name a new entry asked for as `asked` is given (uniqueName), and why it is no name MATLAB can
 * load, or null: the one rule of a dictionary's Add and a MAT-file's (SectionNode.addEntry,
 * MatNode.execAddEntry), which the session's addEntry says it applies. The name is judged as asked
 * for and again with its counter: the first stops an invalid name becoming a valid one by the
 * counter ('end' when an 'end' is already present must not become 'end1'), and the second stops a
 * valid 63-character name growing past namelengthmax.
 */
export function newEntryName(asked, taken) {
    const invalid = validateMatlabName(asked);
    if (invalid) {
        return { name: asked, invalid };
    }
    const name = uniqueName(asked, taken);
    return { name, invalid: name === asked ? null : validateMatlabName(name) };
}
//# sourceMappingURL=matlabName.js.map