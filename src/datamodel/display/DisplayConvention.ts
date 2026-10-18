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

// How many nodes a .mat file's tree is built with, all of its variables together: the cap
// above is one container's, and nothing capped the file's. allMidi.mat, a customer's 8 MB
// file of 1x1024 arrays in nested struct arrays, opened as 2,016,325 nodes and 2.5 GB of
// heap, with every container in it under the cap above (MEM-CEIL; the maintainer's group F
// ruling of 2026-10-18, group 3: a node-count ceiling with a source warning now, lazy
// expansion later, as its own item).
//
// Measured on allMidi.mat in node 24, as heap in use after a collection: 2,016,325 nodes and
// 2,535 MiB uncut, 499,999 nodes and 1,280 MiB under this ceiling. The 1,516,326 nodes it no
// longer builds were 1,255 MiB, some 0.85 KiB each, so about 870 MiB of what is left is the
// parse's own, which the ceiling does not touch. No other .mat file in the corpus reaches it:
// the next, allMidiSeq.mat, opens as 208,074 nodes, and every one opens as it did.
//
// Past it, a container is built with ALL its rows or with NONE, as the cap above is and for
// its reason, and one warning on the file says so ('part-not-expanded'). Unlike the cap
// above it is not silent: what it declines to build depends on what came before it in the
// file, not on the value, so the same struct is whole in one file and has no rows in
// another. See matNodeCeiling.ts.
export const MAT_NODE_CEILING = 500_000;

// Every numeric empty, of any class, shape and complexity: MATLAB's Workspace browser's own
// text, space inside (its ValueCol, getWorkspaceDisplay's Value; the 2026-10-15 display ruling
// makes the browser the authority). mat2str([]) says '[]' and formattedDisplayText([]) says
// nothing, which is why this once read as this package's own spelling; neither is what the
// browser draws. Measured: test/fixtures/display/browser_short.truth.json.
export const EMPTY_NUMERIC = '[ ]';
// A 0x0 cell, as MATLAB's Workspace browser shows it (the 2026-10-15 display ruling): no space.
// A cell of any other empty shape shows its size-and-class summary (MatlabVariableNode._formatCell).
export const EMPTY_CELL = '{}';

// A `missing` element of a string array. This IS MATLAB's spelling — `disp(["" missing])`
// prints `<missing>` — and it is unquoted there, where every real element is quoted, so
// the display already distinguishes a `missing` from the four-character string
// `"<missing>"`. Angle brackets also withhold the editor (BaseNode.valueEditable), which
// is right: there is no text to type that produces a `missing`.
export const MISSING_STRING = '<missing>';

// MATLAB's size() drops trailing singleton dimensions past the second, so a
// 2x3x1 IS a 2x3. Doing the same keeps our spelling equal to MATLAB's and keeps
// a 2x3x1 out of the rank->=3 summary path.
export function effectiveDims(dims: number[] | undefined | null): number[] {
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

export function elementCount(dims: number[] | undefined | null): number {
  return effectiveDims(dims).reduce(function (a, b) {
    return a * b;
  }, 1);
}

// Rank >= 3 has no MATLAB literal at all — mat2str errors with "Input matrix
// must be 2-D" — so there is nothing to match, and a 2-D-looking literal would
// be a lie: it would show page 1 and silently drop the rest.
export function needsSummary(dims: number[] | undefined | null): boolean {
  const d = effectiveDims(dims);
  return d.length > 2 || elementCount(d) > SUMMARY_MAX_ELEMENTS;
}

export function overCharBudget(text: string): boolean {
  return text.length > SUMMARY_MAX_CHARS;
}

// Angle brackets are the consumer's italic/gray signal AND the signal that a
// cell gets no editor (BaseNode.valueEditable). Every summary must use them;
// the `{1x3 cell}` and `[1x2 MyClass]` spellings rendered as ordinary editable
// text.
export function summaryForm(dims: number[] | undefined | null, className: string): string {
  return '<' + effectiveDims(dims).join('x') + ' ' + className + '>';
}

// The Class column's text, as MATLAB's Workspace browser writes it (its ClassCol, which is
// getClassString(value, false, true, true)), and not class() alone: the class, then in
// parentheses what the browser calls the value's attributes, `double (complex)`,
// `int16 (complex)`, `double (sparse)`, `double (sparse complex)`, `logical (sparse)`. An
// enumeration whose values are logical shows its underlying type first,
// `logical (matlab.lang.OnOffSwitchState)`. That is the one such class this package can know
// without the class's definition, which no data file holds: it is MATLAB's own, and its values
// are logical (the 2026-10-15 display study's H9). An int-backed enumeration is its class alone,
// `DispColor`. Measured in R2027a: test/fixtures/display/browser_short.truth.json.
export function classColumnText(className: string, attributes: { complex?: boolean; sparse?: boolean } = {}): string {
  if (className === 'matlab.lang.OnOffSwitchState') {
    return 'logical (matlab.lang.OnOffSwitchState)';
  }
  const attrs = [attributes.sparse ? 'sparse' : '', attributes.complex ? 'complex' : ''].filter((a) => a !== '');
  return attrs.length > 0 ? className + ' (' + attrs.join(' ') + ')' : className;
}

// A sparse array's summary, `<10x10 sparse double>`: the storage, then MATLAB's class()
// of the value, which is its elements' (double, logical, single — complex is still
// double, and the caller names it, `<1x2 sparse complex double>`, in MATLAB's browser's word
// order, as a dense complex array's summary is `<1x11 complex double>`). It is the only
// thing a sparse array's own cell ever shows, at any size, a 1x1 and an empty one
// included, and inside a cell's literal: MATLAB's struct and cell displays print a small
// one inline, and this package deliberately does not. The value is one click away, as
// one element row per non-zero.
export function sparseSummaryForm(dims: number[] | undefined | null, className: string): string {
  return summaryForm(dims, 'sparse ' + className);
}
