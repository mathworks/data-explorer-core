// Copyright 2026 The MathWorks, Inc.
//
// The rule for a name MATLAB can load: a valid identifier, not a keyword, at most
// namelengthmax (63) characters. It lives in its own module, with no model
// dependencies, because two node classes apply it and neither should import the
// other for it. DataNode.setProperty applies it to a rename and SectionNode.addEntry
// applies it to a new entry, so an entry cannot be created under a name it could not
// be renamed to.

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
export function validateMatlabName(name: string): string | null {
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
