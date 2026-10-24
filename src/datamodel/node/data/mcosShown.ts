// Copyright 2026 The MathWorks, Inc.

// Properties of an object as MATLAB shows them that it saves under other names or in another form,
// which a node read from a file's objects is given beside the saved ones in its property bag, for
// its Property Inspector to read (mcosTypedNode): a Simulink.NumericType's Signedness,
// FractionLength and Slope, of the SignednessBool, FixedExponent and SlopeAdjustmentFactor it saves
// (Slope = SlopeAdjustmentFactor * 2^FixedExponent; FractionLength = -FixedExponent; a 0x0
// SignednessBool is 'Auto'); and a CoderInfo's Identifier, which it saves as Alias.

/** The Signedness MATLAB shows of a saved SignednessBool: true, false, or none (a 0x0 logical). */
export function signednessShown(saved: unknown): string | null {
  if (saved === true || saved === 1) {
    return 'Signed';
  }
  if (saved === false || saved === 0) {
    return 'Unsigned';
  }
  return Array.isArray(saved) && saved.length === 0 ? 'Auto' : null;
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

/** `bag`, a Parameter's or a Signal's as MCOS decoded it, with its CoderInfo's Identifier added beside the Alias it is saved as. */
export function withCoderInfoShown(bag: Record<string, unknown>): Record<string, unknown> {
  const coder = bag.CoderInfo as { _properties?: Record<string, unknown> } | undefined;
  const props = coder && typeof coder === 'object' ? coder._properties : undefined;
  if (props && typeof props.Alias === 'string' && !('Identifier' in props)) {
    props.Identifier = props.Alias;
  }
  return bag;
}
