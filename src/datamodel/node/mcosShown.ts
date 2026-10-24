// Copyright 2026 The MathWorks, Inc.

// Properties of an object as MATLAB shows them that it saves under other names or in another form,
// which a node read from a file's objects is given beside the saved ones in its property bag, for
// its Property Inspector to read (mcosTypedNode), and a dictionary's rows read of the saved ones
// alone (schemaBridge, shownPropertiesOf), one rule for both: a Simulink.NumericType's Signedness,
// FractionLength and Slope, of the SignednessBool, FixedExponent and SlopeAdjustmentFactor it saves
// (Slope = SlopeAdjustmentFactor * 2^FixedExponent; FractionLength = -FixedExponent; a 0x0
// SignednessBool is 'Auto'); a CoderInfo's Identifier, which it saves as Alias; and a
// Simulink.Parameter's Value held as a char row, which MATLAB loads as the string scalar it is.

import { emptyHeaderDims } from '../parser/XmlUtils.js';
import { superclassOf } from './registeredSubclasses.js';

/**
 * The Signedness MATLAB shows of a saved SignednessBool: true, false, or none (a 0x0 logical), which
 * a MAT-file's object holds as `[]`, a text dictionary as the logical `[]` and a binary one as the
 * logical's bare `Matrix(0,0)` header (XmlUtils.emptyHeaderDims).
 */
export function signednessShown(saved: unknown): string | null {
  if (saved === true || saved === 1) {
    return 'Signed';
  }
  if (saved === false || saved === 0) {
    return 'Unsigned';
  }
  if (Array.isArray(saved)) {
    return saved.length === 0 ? 'Auto' : null;
  }
  const leaf = saved !== null && typeof saved === 'object' ? (saved as { _type?: unknown; _value?: unknown }) : null;
  return leaf?._type === 'logical' && (leaf._value === '[]' || emptyHeaderDims(leaf._value) !== null) ? 'Auto' : null;
}

/** The three shown of a NumericType's saved bag, or null where it holds them not as numbers. */
export function numericTypeShown(bag: Record<string, unknown>): { Signed: string; FractionLength: number; Slope: number } | null {
  const fe = bag.FixedExponent;
  const saf = bag.SlopeAdjustmentFactor;
  const signed = signednessShown(bag.SignednessBool);
  if (typeof fe !== 'number' || typeof saf !== 'number' || signed === null) {
    return null;
  }
  return { Signed: signed, FractionLength: -fe + 0, Slope: saf * 2 ** fe };
}

/**
 * The saved three of a NumericType's bag that the shown three it also holds say otherwise, as what they
 * say: numericTypeShown's other way (SignednessBool true, false or a 0x0 logical for 'Signed',
 * 'Unsigned', 'Auto'; FixedExponent = -FractionLength; SlopeAdjustmentFactor = Slope * 2^FractionLength).
 * Only of a bag that holds both, which is a MAT-file's node's (withNumericTypeShown), whose edits write
 * the shown three while its save writes the saved: what a copy of it holds of them, so that the copy is
 * what the save writes. A dictionary's bag holds the saved three alone, or a hand-written shown pair.
 */
export function numericTypeSaved(bag: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!numericTypeShown(bag)) {
    return out;
  }
  const signed = bag.Signed;
  if (signed === 'Signed' || signed === 'Unsigned' || signed === 'Auto') {
    const saved = signed === 'Auto' ? [] : signed === 'Signed';
    if (signednessShown(bag.SignednessBool) !== signed) {
      out.SignednessBool = saved;
    }
  }
  const fl = bag.FractionLength;
  const exponent = typeof fl === 'number' && Number.isFinite(fl) ? -fl + 0 : (bag.FixedExponent as number);
  if (exponent !== bag.FixedExponent) {
    out.FixedExponent = exponent;
  }
  const slope = bag.Slope;
  if (typeof slope === 'number' && Number.isFinite(slope)) {
    const factor = slope / 2 ** exponent;
    if (factor !== bag.SlopeAdjustmentFactor) {
      out.SlopeAdjustmentFactor = factor;
    }
  }
  return out;
}

/** `bag`, a NumericType's as MCOS decoded it, with the shown three added where it holds the saved. */
export function withNumericTypeShown(bag: Record<string, unknown>): Record<string, unknown> {
  const shown = numericTypeShown(bag);
  if (shown) {
    for (const [k, v] of Object.entries(shown)) {
      if (!(k in bag)) {
        bag[k] = v;
      }
    }
  }
  return bag;
}

/**
 * `bag`, a Simulink.Parameter's as MCOS decoded it, with a Value held as a char row (a string, as the
 * decode gives a char) as the string scalar MATLAB loads it as: measured against MATLAB R2027a, a
 * Parameter whose Value cell holds the char row 's' loads with Value "s", class string, as its setter
 * makes of any text. Such a cell is what a save of this package writes for a string Value typed in
 * (McosEditRules: "a char row, which MATLAB loads as a string scalar"), in a MAT-file and in a
 * binary dictionary's encoded value alike, and the file opened again showed the char 's'. An empty
 * char is left as it is, as no such measurement holds it.
 */
export function withParameterValueShown(bag: Record<string, unknown>): Record<string, unknown> {
  if (typeof bag.Value === 'string' && bag.Value !== '') {
    bag.Value = [bag.Value];
  }
  return bag;
}

/**
 * The property bag of a `className` object as MATLAB shows it, for a row to read: what it saves under
 * other names shown as the property it is, of any file, a dictionary's as a MAT-file's. A
 * NumericType's Signedness, FractionLength and Slope (withNumericTypeShown), and a Parameter's or a
 * Signal's CoderInfo's Identifier, of the Alias it is saved as. A Signedness the file states, as a
 * hand-written dictionary does, is shown only where the bag holds no SignednessBool,
 * FixedExponent and SlopeAdjustmentFactor as numbers: where it holds them, the Signedness shown is
 * the SignednessBool's, whatever the stated one says. A MAT-file's object holds them (mcosTypedNode
 * adds them as it decodes one); a dictionary's holds what MATLAB saves alone, and its rows showed
 * nothing of them. Display only: `bag` itself is never changed, and is answered as it is where
 * nothing is to be added, so that what a writer writes of it stays the file's.
 */
export function shownPropertiesOf(className: string, bag: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!bag) {
    return bag;
  }
  if (className === 'Simulink.NumericType') {
    const shown = withNumericTypeShown({ ...bag });
    if (!('Signed' in shown) && typeof bag.Signedness === 'string') {
      shown.Signed = bag.Signedness;
    }
    return Object.keys(shown).length === Object.keys(bag).length ? bag : shown;
  }
  const coder = bag.CoderInfo as Record<string, unknown> | undefined;
  const inner = coderInfoShown(className) ? coderInfoBagOf(coder) : null;
  if (inner && typeof inner.Alias === 'string' && !('Identifier' in inner)) {
    const props = { ...inner, Identifier: inner.Alias };
    const elements = coder!._elements as Record<string, unknown>[] | undefined;
    return { ...bag, CoderInfo: coder!._properties ? { ...coder, _properties: props } : { ...coder, _elements: [{ ...(elements?.[0] ?? {}), _properties: props }] } };
  }
  return bag;
}

/**
 * Of a property a `className` object's row shows at `path` (a schema sourcePath), the property
 * MATLAB shows and what it saves it as, where it saves it under another name (shownPropertiesOf):
 * null where it saves it as it is.
 */
export function shownOfSaved(className: string, path: string): { property: string; saved: string } | null {
  if (className === 'Simulink.NumericType') {
    return NUMERIC_TYPE_SAVED[path] ?? null;
  }
  return path === 'CoderInfo.Identifier' && coderInfoShown(className) ? { property: 'CoderInfo.Identifier', saved: 'CoderInfo.Alias' } : null;
}

const NUMERIC_TYPE_SAVED: Record<string, { property: string; saved: string }> = {
  Signed: { property: 'Signedness', saved: 'SignednessBool' },
  FractionLength: { property: 'FractionLength', saved: 'FixedExponent' },
  Slope: { property: 'Slope', saved: 'SlopeAdjustmentFactor and FixedExponent' },
};

// Whether a `className` object's CoderInfo's Identifier is a row of it: a Parameter's, a Signal's,
// and their subclasses'.
function coderInfoShown(className: string): boolean {
  return CODER_INFO_SHOWN.has(className) || CODER_INFO_SHOWN.has(superclassOf(className) ?? '');
}

const CODER_INFO_SHOWN = new Set(['Simulink.Parameter', 'Simulink.Signal']);

// A CoderInfo's own bag, as a text dictionary (`{_object_class, _properties}`) or a binary one (an
// object array of one element) holds it, or null.
function coderInfoBagOf(coder: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!coder || typeof coder !== 'object') {
    return null;
  }
  if (coder._properties && typeof coder._properties === 'object') {
    return coder._properties as Record<string, unknown>;
  }
  const elements = coder._elements;
  const first = Array.isArray(elements) && elements.length === 1 ? (elements[0] as { _properties?: unknown } | null) : null;
  return first?._properties && typeof first._properties === 'object' ? (first._properties as Record<string, unknown>) : null;
}
