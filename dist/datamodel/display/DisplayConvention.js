// Copyright 2026 The MathWorks, Inc.
//
// The display convention, in one module. Every path that renders a value into
// the Value column reads its thresholds and its summary spelling from here, so
// one value cannot render two ways depending on which parser produced it. The
// threshold used to be the literal 50 in three places and absent from a fourth,
// which is exactly how the same array came to summarize on the object-property
// path and print unbounded on the variable path.
//
// The normative table this implements is in test/parity/matlab/DESIGN.md.
// A value with NO child rows — char, scalar string — is visible ONLY in the
// cell, so its budget is generous: a runaway guard against a pathological blob,
// not a display budget. Being a runaway guard is also why it applies to the
// EXPANDABLE literals too, on top of the element rule below: a 1x4 cell of
// 300-character strings is well under the element budget and still a
// 1200-character table cell.
export const SUMMARY_MAX_CHARS = 1000;
// A value WITH child rows is one expand away, so the cell is a summary and the
// budget is tight. Counted in ELEMENTS, not characters, so every 1x10 double
// renders like every other 1x10 double instead of depending on how many digits
// its values happen to have. This is the primary rule for numeric arrays, cells
// and string arrays.
export const SUMMARY_MAX_ELEMENTS = 10;
// A space inside the brackets. This deviates from mat2str (`[]`) deliberately,
// and matches what the object-property path has always emitted. There is no
// MATLAB spelling to match either way: checked against R2027a, mat2str([]) is
// '[]' and formattedDisplayText([]) / formattedDisplayText({}) are both the
// empty string. The one-space form makes an empty value visible in a table cell
// rather than reading as a rendering failure.
export const EMPTY_NUMERIC = '[ ]';
export const EMPTY_CELL = '{ }';
// MATLAB's size() drops trailing singleton dimensions past the second, so a
// 2x3x1 IS a 2x3. Doing the same keeps our spelling equal to MATLAB's and keeps
// a 2x3x1 out of the rank->=3 summary path.
export function effectiveDims(dims) {
    if (!dims || dims.length === 0) {
        return [1, 1];
    }
    if (dims.length === 1) {
        return [1, dims[0]];
    }
    const d = dims.slice();
    while (d.length > 2 && d[d.length - 1] === 1) {
        d.pop();
    }
    return d;
}
export function elementCount(dims) {
    return effectiveDims(dims).reduce(function (a, b) {
        return a * b;
    }, 1);
}
// Rank >= 3 has no MATLAB literal at all — mat2str errors with "Input matrix
// must be 2-D" — so there is nothing to match, and a 2-D-looking literal would
// be a lie: it would show page 1 and silently drop the rest.
export function needsSummary(dims) {
    const d = effectiveDims(dims);
    return d.length > 2 || elementCount(d) > SUMMARY_MAX_ELEMENTS;
}
export function overCharBudget(text) {
    return text.length > SUMMARY_MAX_CHARS;
}
// Angle brackets are the consumer's italic/gray signal AND the signal that a
// cell gets no editor (BaseNode.valueEditable). Every summary must use them;
// the `{1x3 cell}` and `[1x2 MyClass]` spellings rendered as ordinary editable
// text.
export function summaryForm(dims, className) {
    return '<' + effectiveDims(dims).join('x') + ' ' + className + '>';
}
//# sourceMappingURL=DisplayConvention.js.map