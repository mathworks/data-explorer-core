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
// How many elements an array will expand into child nodes. Past this it expands
// into NONE, and the value is visible only as the summary the two budgets above
// produce.
//
// This is a different kind of limit from those two. They choose how to RENDER a
// value that is being shown either way; this one declines to build the nodes at
// all, because at this scale building them is what stops the file opening. A
// dictionary entry holding a 1000x1000 double is 1,000,000 elements: expanding it
// cost 1,000,001 nodes and ~690 MB for that one entry, and a host's table
// projection of the subtree is ~413 MB of rows. Measured on the file that prompted
// this — the 2.5 minutes it spent before failing were all in the expansion, not in
// the parse, which took one second.
//
// NOT a ParseWarning, by ParseWarning's own rule: the value was read completely and
// is saved completely, and "a reader that meets the limit of the FILE has read it
// correctly and must stay quiet". Nothing was lost to report. It is the same silent
// decline the host's grid panel already makes above its own 4096-element cap.
//
// 10,000 rather than a rounder 4,096 or 65,536 for one reason worth stating: it must
// stay ABOVE the host's grid cap. The grid renders only when it has one child per
// element (`children.length === count`, at most 4,096), so a cap at or below that
// would leave a griddable matrix with no children and silently kill the grid for
// exactly the matrices it exists for. Above it, the two limits compose: <=4,096 gets
// rows and a grid, <=10,000 gets rows, past that the summary alone.
//
// The cap is ALL-OR-NOTHING and must stay that way. `_elements` and the child nodes
// are two copies of one value, and every reader of it — the `Value` getter, each
// serializer — spells the choice `children.length > 0 ? children.map(...) : _elements`.
// A partial expansion would therefore be read through its children and would save
// the first N elements as the whole value. See test/largeArrayNotExpanded.test.ts.
export const MAX_EXPANDED_ELEMENTS = 10000;
// A space inside the brackets. This deviates from mat2str (`[]`) deliberately,
// and matches what the object-property path has always emitted. There is no
// MATLAB spelling to match either way: checked against R2027a, mat2str([]) is
// '[]' and formattedDisplayText([]) / formattedDisplayText({}) are both the
// empty string. The one-space form makes an empty value visible in a table cell
// rather than reading as a rendering failure.
export const EMPTY_NUMERIC = '[ ]';
export const EMPTY_CELL = '{ }';
// A `missing` element of a string array. This IS MATLAB's spelling — `disp(["" missing])`
// prints `<missing>` — and it is unquoted there, where every real element is quoted, so
// the display already distinguishes a `missing` from the four-character string
// `"<missing>"`. Angle brackets also withhold the editor (BaseNode.valueEditable), which
// is right: there is no text to type that produces a `missing`.
export const MISSING_STRING = '<missing>';
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