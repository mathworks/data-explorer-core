// Copyright 2026 The MathWorks, Inc.
//
// The display convention, computed from what MATLAB REPORTED and nothing else.
//
// This module must not import anything from src/. If it derived its expectation
// from our own parse, the parity suites would agree with the data model no matter
// how wrong the model was — the one failure mode a parity suite cannot see from
// the inside. The constants are restated here on purpose: this is the independent
// statement of the rule, and if the two ever disagree, THAT is the finding.
import type { PropTruth, VarTruth } from './loadTruth.js';

export const MAX_CHARS = 1000;
export const MAX_ELEMENTS = 10;

/** MATLAB's size(), with a trailing singleton dropped as MATLAB drops it. */
export function effective(size: number[]): number[] {
  const d = size.slice();
  while (d.length > 2 && d[d.length - 1] === 1) { d.pop(); }
  if (d.length === 0) { return [1, 1]; }
  if (d.length === 1) { return [1, d[0]]; }
  return d;
}

export function summary(size: number[], className: string): string {
  return '<' + effective(size).join('x') + ' ' + className + '>';
}

/**
 * mat2str spells a matrix `[1 2 3;4 5 6]`; the data model puts a space after the
 * semicolon. That is the ONLY normalization applied, and it is applied to
 * MATLAB's string, never to ours.
 */
export function normalizeMat2str(s: string): string {
  return s.replace(/;/g, '; ');
}

/**
 * Whether the value gets child rows, which is what decides WHICH budget bounds it.
 * The rule follows expandability, not class: a value with no child rows can only be
 * seen in its table cell, so its bound is display LENGTH; a value one expand away
 * from its elements is bounded by ELEMENT COUNT.
 *
 * char and a scalar string are the no-child cases. A char row is one value, not N
 * elements — measured in elements, every char longer than ten characters would
 * summarize, and `longChar` (1x300) is a literal in all four channels.
 */
export function expandable(v: Pick<VarTruth, 'class' | 'numel'>): boolean {
  if (v.class === 'char') { return false; }
  if (v.class === 'string') { return v.numel > 1; }
  return v.numel > 1;
}

/** MATLAB's float classes — the only ones whose spelling we deliberately widen. */
const FLOAT = new Set(['double', 'single']);

/**
 * MATLAB has no one-line spelling for these, so there is nothing to adjudicate a
 * literal against: `mat2str` refuses a cell and every object class outright. Their
 * VALUES are still checked, through the element rows (structure.test.ts) and the
 * property rows (schemaProps.test.ts) — this only says the container's own cell
 * text is ours, not MATLAB's.
 *
 * `string` is the exception that has to be named: MATLAB answers isobject("a")
 * TRUE — a string is an object, not a fundamental type — yet mat2str spells a
 * string array happily, `["a" "bb" "ccc"]`. CLASS decides, not isobject.
 */
export function hasMatlabLiteral(v: VarTruth): boolean {
  if (v.class === 'cell') { return false; }
  if (v.class === 'string') { return true; }
  return !v.isobject;
}

/**
 * An object ARRAY, on the same isobject-minus-string reading as hasMatlabLiteral.
 * Kept separate from the scalar case because a scalar Simulink data object shows
 * its Value in the cell, and an array cannot — there are numel of them.
 */
export function isObjectArray(v: Pick<VarTruth, 'class' | 'isobject' | 'numel'>): boolean {
  return v.isobject && v.class !== 'string' && v.numel > 1;
}

/**
 * The `Value` property MATLAB's own properties() list reports, when it reports one.
 * Undefined when the class has no `Value` at all, or when reading it errored.
 *
 * This is the whole basis for the empty-cell rule below, and it is read off
 * MATLAB's list rather than a class list of ours on purpose: MATLAB gives
 * Simulink.Parameter a `Value`, and gives Simulink.Signal (InitialValue),
 * Simulink.Bus (Elements), Simulink.LookupTable (Table) and
 * Simulink.VariantVariable (Specification, Bank) none.
 */
export function valueProp(v: VarTruth): PropTruth | undefined {
  const p = v.properties?.Value;
  if (p === undefined || 'error' in p) { return undefined; }
  return p;
}

/**
 * A property measured as if it were an entry, so it goes through expectedDisplay
 * unchanged. `isobject: false` because gen_truth.m's propTruth records no isobject
 * flag — true for every property in this corpus, and a Value that is itself an
 * object would need propTruth extended before this could be trusted for it.
 */
export function asVar(name: string, p: PropTruth): VarTruth {
  return {
    name,
    class: p.class,
    size: p.size,
    numel: p.numel,
    isempty: p.isempty,
    disp: p.disp,
    mat2str: p.mat2str,
    mat2str_error: p.mat2str_error,
    iscomplex: false,
    islogical: p.class === 'logical',
    isobject: false,
  };
}

/**
 * The expected table cell, or null when MATLAB offers no spelling to compare
 * against (see hasMatlabLiteral). Null is not "anything goes" — a null means the
 * suite must assert the value some other way, and each caller does.
 */
export function expectedDisplay(v: VarTruth): string | null {
  const dims = effective(v.size);
  // Always the angle form, at every size. These are the two kinds MATLAB itself
  // never prints inline — its own disp answers `1x3 struct array with fields:`
  // and `1×3 Parameter array with properties:`, a summary of class and size and
  // nothing more. The angle form carries exactly that, so there is no length or
  // element question to ask.
  if (v.class === 'struct' || isObjectArray(v)) {
    return summary(dims, v.class);
  }
  // A SCALAR Simulink data object shows its Value, and shows NOTHING when MATLAB's
  // property list gives the class no Value: a Simulink.Signal, Bus, LookupTable or
  // VariantVariable has no single value to put in a cell, so the cell is empty.
  // Which classes those are is MATLAB's answer, not a list of ours — see valueProp.
  if (v.isobject && v.class !== 'string') {
    if (v.properties === undefined) { return null; }
    if (!('Value' in v.properties)) { return ''; }
    const p = valueProp(v);
    // 'Value' is there but reading it errored: MATLAB gave no value, so neither can we.
    return p === undefined ? null : expectedDisplay(asVar(v.name, p));
  }
  if (v.isempty || v.numel === 0) {
    // char is already its own complete literal when empty, and does not expand.
    if (v.class === 'char') { return "''"; }
    return v.class === 'cell' ? '{ }' : '[ ]';
  }
  // mat2str refuses rank >= 3 ("Input matrix must be 2-D"), so there is no MATLAB
  // one-line spelling to match and the summary is the only correct answer.
  if (dims.length > 2) {
    return summary(dims, v.class);
  }
  if (expandable(v) && v.numel > MAX_ELEMENTS) {
    return summary(dims, v.class);
  }
  if (v.mat2str === undefined) {
    return hasMatlabLiteral(v) ? summary(dims, v.class) : null;
  }
  const literal = normalizeMat2str(v.mat2str);
  // The char budget bounds every literal, on top of the element rule: it is a
  // runaway guard, not a display budget, so a 1x2 cell of 300-char strings is
  // under the element budget and still summarized.
  return literal.length > MAX_CHARS ? summary(dims, v.class) : literal;
}

/**
 * The text a PROPERTY SHEET cell shows for a property MATLAB reported, or null
 * when MATLAB's own output pins no single answer.
 *
 * A property sheet is not a table cell, and the difference is one rule: a cell
 * holds a MATLAB LITERAL (`'m/s'`, quoted, because that is what you would type to
 * get the value back), a property sheet holds the VALUE (`m/s`, because the cell
 * IS the text box you edit the unit in). So char and string take MATLAB's own
 * text — `disp`, which for a char row is the characters and nothing else — and
 * everything else keeps the mat2str spelling, which is already the value.
 *
 * Null for a nested object (mat2str refuses it, and its contents are a sub-sheet
 * of their own) and for anything MATLAB gave no mat2str for. Null means the
 * caller must assert presence some other way — it never means anything goes.
 */
export function expectedPropertyText(p: PropTruth): string | null {
  if ('error' in p) { return null; }
  if (p.class === 'char' || p.class === 'string') { return p.disp; }
  if (p.mat2str === undefined) { return null; }
  return normalizeMat2str(p.mat2str);
}

/**
 * The sub-property names MATLAB's own disp lists for a nested object, read off the
 * `Name: value` lines of `formattedDisplayText`. `CoderInfo with properties:` /
 * `    StorageClass: 'Auto'` yields ['StorageClass'].
 *
 * This exists because a nested object property can surface two ways: under its own
 * name (`Other.CoderInfo.StorageClass`) or projected into a column of its own
 * (`storageClass`). The second is only checkable against MATLAB if MATLAB says what
 * the sub-properties are called — and its disp does.
 */
export function subPropertyNames(p: PropTruth): string[] {
  if ('error' in p || !p.disp) { return []; }
  const names: string[] = [];
  for (const line of p.disp.split('\n')) {
    const m = /^\s+([A-Za-z]\w*):/.exec(line);
    if (m) { names.push(m[1]); }
  }
  return names;
}

/**
 * Split a literal into its numeric tokens and the skeleton between them, so a
 * comparison can be exact about STRUCTURE and lenient only about a float's digits.
 * `[1 2; 3 4]` -> skeleton `[# #; # #]`, tokens ['1','2','3','4'].
 */
const NUMERIC = /-?(?:\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|Inf|NaN)/g;

function split(s: string): { skeleton: string; tokens: string[] } {
  const tokens: string[] = [];
  const skeleton = s.replace(NUMERIC, (m) => { tokens.push(m); return '#'; });
  return { skeleton, tokens };
}

/** mat2str's own default precision, and therefore the resolution of its answer. */
const MAT2STR_DIGITS = 15;

/**
 * MATLAB prints 15 significant digits; we print JavaScript's shortest round-trip
 * spelling, which is MORE digits for a double (3.141592653589793 vs
 * 3.14159265358979) and FEWER for a single (3.14159274 vs 3.14159274101257). Both
 * denote the same stored value, and the convention table records ours as deliberate.
 *
 * Note that MATLAB's spelling is LOSSY: `Number('3.14159265358979')` is a different
 * double from `Math.PI`, so plain numeric equality fails here. The right comparison
 * is at mat2str's own resolution — round both to 15 significant digits.
 *
 * The token must also be canonical, `String(Number(tok)) === tok`. Without that,
 * `3.1400000000000001` would pass against `3.14`: the same number, spelled a way
 * the convention does not allow.
 */
function sameFloatToken(actual: string, expected: string, className: string): boolean {
  if (actual === expected) { return true; }
  // Inf/-Inf/NaN are MATLAB's spellings and ours; Number('Inf') is NaN, so they
  // can only be compared as text, and they already were.
  if (/Inf|NaN/.test(actual) || /Inf|NaN/.test(expected)) { return false; }
  const a = Number(actual);
  const e = Number(expected);
  if (!Number.isFinite(a) || !Number.isFinite(e)) { return false; }
  if (String(a) !== actual) { return false; }
  // A single carries fewer bits than either spelling shows, so float32 resolution —
  // not 15 digits — is what makes 3.14159274 and 3.14159274101257 one value.
  if (className === 'single') { return Math.fround(a) === Math.fround(e); }
  return Number(a.toPrecision(MAT2STR_DIGITS)) === Number(e.toPrecision(MAT2STR_DIGITS));
}

/**
 * Whether `actual` is the display this truth entry calls for. Exact string equality
 * for every class whose spelling we claim to match MATLAB's; for a float class,
 * identical structure with numerically equal, canonically spelled tokens.
 */
export function literalMatches(actual: string, v: VarTruth): boolean {
  return matches(actual, expectedDisplay(v), v.class);
}

/** As literalMatches, for the property-sheet convention. See expectedPropertyText. */
export function propertyTextMatches(actual: string, p: PropTruth): boolean {
  return matches(actual, expectedPropertyText(p), 'error' in p ? '' : p.class);
}

function matches(actual: string, want: string | null, className: string): boolean {
  if (want === null) { return true; }
  if (actual === want) { return true; }
  if (!FLOAT.has(className)) { return false; }
  const a = split(actual);
  const w = split(want);
  if (a.skeleton !== w.skeleton || a.tokens.length !== w.tokens.length) { return false; }
  return a.tokens.every((tok, i) => sameFloatToken(tok, w.tokens[i], className));
}

/**
 * MATLAB's own Data Type for the value: the class, except that an object has no
 * data type of its own and reports its underlying one (or nothing). Only the
 * primitive classes are asserted from here.
 */
export function expectedDataType(v: VarTruth): string {
  return v.class;
}
