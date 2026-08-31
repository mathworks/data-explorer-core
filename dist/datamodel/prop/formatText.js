// Copyright 2026 The MathWorks, Inc.
// The shared `format` for prop atoms whose value is plain display text: an unset
// or empty value renders blank, anything else renders as text. Written as a real
// conversion rather than the `(value as string) || ''` these atoms each used to
// spell out, because that cast is a lie the compiler cannot catch — a truthy
// non-string (a raw Dimensions vector, say) passed straight through, and
// getPropInfo assigns the result to a display-text field, so the table would
// receive an array where it expects a string. Atoms whose value is not plain
// text (PropValue, PropDimensions, PropNumberOfEntries) define their own format.
export function formatText(value) {
    // Falsy covers undefined/null/''/0/false alike; none of these atoms carries a
    // numeric or boolean value, so blanking them all matches the previous behaviour.
    return value ? String(value) : '';
}
//# sourceMappingURL=formatText.js.map