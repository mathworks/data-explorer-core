// Copyright 2026 The MathWorks, Inc.
// Properties of an object as MATLAB shows them that it saves under other names or in another form,
// which a node read from a file's objects is given beside the saved ones in its property bag, for
// its Property Inspector to read (mcosTypedNode): a Simulink.NumericType's Signedness,
// FractionLength and Slope, of the SignednessBool, FixedExponent and SlopeAdjustmentFactor it saves
// (Slope = SlopeAdjustmentFactor * 2^FixedExponent; FractionLength = -FixedExponent; a 0x0
// SignednessBool is 'Auto'); and a CoderInfo's Identifier, which it saves as Alias.
/** The Signedness MATLAB shows of a saved SignednessBool: true, false, or none (a 0x0 logical). */
export function signednessShown(saved) {
    if (saved === true || saved === 1) {
        return 'Signed';
    }
    if (saved === false || saved === 0) {
        return 'Unsigned';
    }
    return Array.isArray(saved) && saved.length === 0 ? 'Auto' : null;
}
/** The three shown of a NumericType's saved bag, or null where it holds them not as numbers. */
export function numericTypeShown(bag) {
    const fe = bag.FixedExponent;
    const saf = bag.SlopeAdjustmentFactor;
    const signed = signednessShown(bag.SignednessBool);
    if (typeof fe !== 'number' || typeof saf !== 'number' || signed === null) {
        return null;
    }
    return { Signed: signed, FractionLength: -fe + 0, Slope: saf * 2 ** fe };
}
/** `bag`, a NumericType's as MCOS decoded it, with the shown three added where it holds the saved. */
export function withNumericTypeShown(bag) {
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
export function withCoderInfoShown(bag) {
    const coder = bag.CoderInfo;
    const props = coder && typeof coder === 'object' ? coder._properties : undefined;
    if (props && typeof props.Alias === 'string' && !('Identifier' in props)) {
        props.Identifier = props.Alias;
    }
    return bag;
}
//# sourceMappingURL=mcosShown.js.map