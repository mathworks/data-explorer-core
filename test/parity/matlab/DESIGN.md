<!-- Copyright 2026 The MathWorks, Inc. -->

# MATLAB Parity Verification — design

**Date:** 2026-09-02
**Status:** approved, pending implementation plan
**MATLAB reference:** R2027a Prerelease (27.1.0.3353139), launched as
`mw -using Bmain matlab -nodesktop -batch ...`

## Goal

Verify, with MATLAB as the source of truth, that `data-explorer-core`:

1. **Parses without data loss** — every primitive and object type, at every
   shape, in every supported file format.
2. **Displays per the agreed convention** — one normative rule set, applied
   identically on every code path.
3. **Builds the correct tree** — parent/child relationships, child naming, and
   leaves that bottom out at primitives.
4. **Writes back correctly** — for `.sldd`, an edited model serializes to a file
   MATLAB reopens with the edited value and type intact.

The output is a committed test suite that runs in GitHub CI **without MATLAB**,
plus fixes for every defect it finds.

## Non-goals

- Verifying `.mat` / `.slx` write-back. Those formats are read-only in this repo;
  it exposes `_var` and the writers live in `data-explorer-vscode`.
- Recovering MCOS inheritance (see Known limitations).
- Presentation concerns beyond the display text itself. Italic/gray styling is
  the consumer's, triggered by the `<...>` form (`MatlabVariableNode.ts:454`).
- Refactoring unrelated to the convention or the defects found.

## Display convention

This is normative: the spec the suite asserts. It is **not** `mat2str`, and it is
**not** Model Explorer. Where it diverges from both, that is deliberate — this
project targets usability in VS Code, and improves on Model Explorer where it
can.

| case | display | note |
|---|---|---|
| empty numeric | `[ ]` | space inside — deviates from `mat2str` (`[]`) |
| empty cell | `{ }` | consistent with `[ ]` |
| empty char | `''` | already the complete literal; char does not expand |
| empty scalar string | `""` | same |
| 0x0 struct | `<0x0 struct>` | struct is always the angle form |
| numeric scalar | full JS round-trip precision, i.e. `String(n)` | **more** digits than MATLAB: `3.141592653589793`, not `mat2str`'s `3.14159265358979` |
| `int64` / `uint64` | exact decimal, never double-rounded | `18446744073709551615` |
| array / matrix | `[1 2; 3 4]` | `mat2str` plus a space after `;` — deliberate, reads better |
| logical | `true` / `false` | scalar and per element |
| char | `'it''s'` | embedded quote doubled |
| string | `"world"`, `["a" "bb"]` | |
| complex | `3+4i` | |
| cell | `{1, 'two', [3 4]}` | |
| struct | `<1x1 struct>` | always the angle form, regardless of size |
| over threshold, opaque, unrecoverable | `<mxn class>` | angle brackets **always** |

**Angle brackets are the italic signal.** Any summary form must use
`<mxn class>`. Today three different bracket styles are in use, so only some
summaries render italic — see defect 3.

### Threshold rule

The threshold follows **expandability**, not class. One rule, two constants, one
module.

- **No child rows** → the cell is the only way to see the value → threshold on
  **display length**, `SUMMARY_MAX_CHARS = 1000`. This is char and scalar string.
- **Has child rows** → the cell is a summary and the value is one expand away →
  threshold on **element count**, `SUMMARY_MAX_ELEMENTS = 10`. This is numeric
  array/matrix, cell, and string *array* (which does expand, via
  `_makeStringElement`).
- **struct** → always `<mxn struct>`; no threshold applies.

Rationale: element count makes shapes look consistent — every 1x10 double
renders like every other 1x10 double, rather than depending on how many digits
its values happen to have. `N = 10` keeps every vector and small matrix up to
2x5 / 3x3 as a literal while `1:30` summarizes. `M = 1000` means a realistic
description or unit string is never hidden behind a summary it cannot be
expanded out of; it is a runaway guard against a pathological blob, not a
display budget. (An earlier draft said 200, which contradicted its own worked
example of a 300-char description showing in full. The principle — text that
cannot expand should not be summarized — is the part that was agreed, so the
constant moved to fit it.)

| value | expands? | rule | display |
|---|---|---|---|
| 300-char description | no | chars | full text, quoted |
| `[1 2 3]` | yes | elements | `[1 2 3]` |
| `[1 2; 3 4]` | yes | elements | `[1 2; 3 4]` |
| `1:30` | yes | elements | `<1x30 double>` |
| `{1, 'two', [3 4]}` | yes | elements | `{1, 'two', [3 4]}` |
| `["a" "bb" … ×20]` | yes | elements | `<1x20 string>` |
| any struct | yes | n/a | `<mxn struct>` |

Unifying the threshold **changes current behaviour**: long arrays on the
variable path print in full today (unbounded) and will start summarizing. This
is intended.

## Object types

- **Known class** — the 20 schemas under `src/datamodel/schema/classes/`. Of
  these, 19 map to a real MATLAB class that can be instantiated (`enumType.json`
  is `Simulink.data.dictionary.EnumTypeDefinition`); `customObject.json` is the
  fallback schema for unknown classes, not a MATLAB class. Surface properties per
  the schema.
- **Unknown class** — surface the general property bag as child rows, expanding
  down to primitive leaves, each leaf following the convention above.

## Architecture

MATLAB is a **fixture generator**, not a test dependency. This is the central
decision: MATLAB cannot run in GitHub CI, so a MATLAB-gated suite would never
actually run for a public repo. Instead MATLAB emits committed truth, and the
tests read it.

```
test/parity/matlab/
  gen_truth.m                 MATLAB: the only entry point. Builds every
                              artifact from one case catalog, emits truth JSON.
  artifacts/
    sldd-text/cases.sldd      uncompressed-text dictionary
    sldd-binary/cases.sldd    compressed-binary dictionary
    slx/cases.slx             model workspace
    mat/cases.mat
    prj/                      project fixture (structure only)
  truth/
    sldd-text.json            per entry: MATLAB class, size, complexity,
    sldd-binary.json          mat2str, disp text, and for objects the full
    slx.json                  public property list with values and classes
    mat.json
    prj.json                  expected node tree only — a .prj carries no data
                              objects, so there is nothing to value-compare
  expect.ts                   the display convention, once, as a pure function
  README.md                   how to regenerate truth
  display.parity.test.ts
  structure.parity.test.ts
  lossless.parity.test.ts
  schemaProps.parity.test.ts
  writeback.live.test.ts      dev-only, gated on DEX_MATLAB_CMD
  drift.mjs                   dev script: regenerate truth and diff
```

### `gen_truth.m`

Declares the case catalog **once as data**. Every format is emitted from that
one catalog, so a new case is one line and appears everywhere automatically.
Where a case is illegal in a format, MATLAB records the actual failure in the
truth file, so the gap is visible in review rather than silently missing.

Dictionary format is selected by the `FileFormat` property
(`'uncompressed-text'` — the R2027a default — or `'compressed-binary'`); there
is no format argument to `Simulink.data.dictionary.create`.

### `expect.ts`

The convention above implemented once, as a pure function from **MATLAB truth**
(class, size, complexity, `mat2str`) to expected display text.

This is load-bearing. Expected strings are neither hand-written per case (which
does not scale to the matrix and rots silently) nor computed from our own parse
(which would make the test tautological). They are derived from facts MATLAB
reported, so the derivation is independent of the code under test, and the
convention lives in one file that reads like the normative table.

### Test tiers

**Tier 1 — committed truth, no MATLAB, runs in CI on every PR.**

| file | asserts |
|---|---|
| `display.parity.test.ts` | `displayValue` and Data Type, per format × case |
| `structure.parity.test.ts` | child counts, index naming (`v(1)`, `v(1,2)`, `s.f`, `c{1}`), leaves bottom out at primitives |
| `lossless.parity.test.ts` | stored value equals MATLAB's exact value; serialize→reparse is a fixed point |
| `schemaProps.parity.test.ts` | every property MATLAB reports on a known class is surfaced by the schema or on an explicit documented ignore list; unknown classes expand generically; derived-from-known behaves as unknown |

`lossless` is deliberately separate from `display`. Display is lossy by design
(a summary, a threshold); storage must not be. The dangerous failure is an
untouched cell writing back its *displayed* truncation, and only a separate
storage-level assertion catches it.

**Tier 2 — live MATLAB, dev-only, never in CI.** `writeback.live.test.ts`, gated
on `DEX_MATLAB_CMD` exactly as `roundTripHarness.ts` already does: for `.sldd`
in both formats, edit → serialize → MATLAB reopens → assert value and class.
A fixture cannot stand in for this; proving MATLAB accepts our output requires
MATLAB. `drift.mjs` regenerates truth and diffs it, catching release drift.

## Coverage matrix

**Formats:** `.sldd` uncompressed-text, `.sldd` compressed-binary, `.slx` model
workspace, `.mat`, `.prj` (structural only — carries no data objects).

**Primitives** — `double`, `single`, `int8`/`16`/`32`/`64`,
`uint8`/`16`/`32`/`64`, `logical`, `char`, `string`, complex; each as scalar,
row vector, column vector, matrix, empty. Non-finites (`Inf`, `-Inf`, `NaN`).
Integer-class extremes (`intmax`/`intmin` for 64-bit, which is where precision
breaks). Cell: nested, ragged, empty. Struct: scalar, array, nested, empty.

**Shapes that must be non-square and rank >= 3.** Every array case includes a
2x3 (never 2x2) and a 2x3x2. A square fixture cannot distinguish row-major from
column-major, and a rank-2 fixture cannot expose page handling — between them
those two gaps hid defects 6–9. Assertions compare against MATLAB's own
`ind2sub` subscript labels and per-element values, not against a hand-written
expectation.

**Known object classes** — the 19 MATLAB-instantiable classes behind
`schema/classes/`, each with non-default values on every writable property.
Object arrays — 3x1, 1x3, **2x3**, and **2x3x2** `Simulink.Parameter`, each
element carrying a distinguishable `Value` so a transposed label is detectable.
`.mat`/`.slx` only; the dictionary rejects object arrays. Container classes with real
children: `Bus`/`BusElement`, `ConnectionBus`/`ConnectionElement`,
`ServiceBus`/`FunctionElement`, `LookupTable`/`Breakpoint`,
`VariantVariable`/`VariantExpression`, `VariantBank`. The element classes
(`BusElement`, `ConnectionElement`, `FunctionElement`) have no schema file of
their own — they are covered as children of their container.

**Unknown classes** — a handwritten MCOS class with primitive, object, and array
properties; and one derived from `Simulink.Parameter`.

**Sections** — Design Data, Configurations, Other Data, Architectural Data
(`isderived = '1'`).

## Defects found during design

Each gets a failing test first, then the fix.

1. **`int64`/`uint64` past 2⁵³ lose precision — data loss.** `uint64` max reads
   back `18446744073709552000` instead of `18446744073709551615`. Both parser
   families are affected: `readNumericArray` in `MatParser` and `parseFloat` via
   `parseMatlabNum` (`XmlUtils.ts:24`) for `.sldd`. Needs an exact
   representation (`BigInt` or the source decimal string) carried through
   storage, display, and serialization.
2. **`string` in `.mat` / `.slx` renders `<1x1 string>` with blank Data Type —
   wrong output.** Root cause is deeper than a missing class-table entry: a MAT
   `string` array is stored as an **opaque MCOS object**, not one of
   `MatParser.CLASS_NAMES`' array classes, so it falls through the opaque path
   and reports 1x1 regardless of real size. A 1x2 string array displays
   identically to a scalar. The fix is MCOS `string` payload decoding in
   `McosParser`. Works correctly in `.sldd`, which is why this was not caught.
3. **Summary form inconsistent, so italic is inconsistent.** `_formatCell`
   emits `{1x3 cell}` (braces, `MatlabVariableNode.ts:508`) and the opaque array
   path emits `[1x2 MyClass]` (square brackets, `:435`). Neither renders italic.
   Both must be `<mxn class>`.
4. **Threshold duplicated and inconsistent.** `50` appears in
   `PropValue.format`, `_formatCell`, and `_formatString`, and is absent from
   `_formatArray` entirely — so the same array summarizes on the object-property
   path and prints unbounded on the variable path. Replace with the two shared
   constants above, applied by every path.
5. **Empty rendering split.** `PropValue.format` returns `[ ]` (correct) while
   the variable path returns `[]`. Unify on `[ ]`.

## Defects found by MATLAB-authored N-D / matrix fixtures

A second pass generated real MATLAB artifacts for shapes the suite had never
seen: N-D numeric, N-D cell, N-D and rank-2 struct arrays, and — the case that
had stayed invisible — object and struct **matrices**, whose row-major and
column-major orders differ. Generators: `probe_ndarray.m`, `probe_rank2.m`.
Every defect below was observed through the public `ingest` path, against
MATLAB's own `ind2sub` labels and values.

6. **Element streams are column-major; the subscript labels read them
   row-major — 4 of 6 labels name the wrong object.** This is the most severe
   finding. `ObjectNode.ts:196` and `StructNode.ts:237` both index with
   `Math.floor(ei / cols)` / `ei % cols`, but the element list arrives in
   MATLAB's column-major order. For a 2x3 `Simulink.Parameter` array `w` with
   `Value = row*10 + col`:

   | label | repo shows | MATLAB |
   |---|---|---|
   | `w(1,1)` | 11 | 11 ✓ |
   | `w(1,2)` | 21 | 12 ✗ |
   | `w(1,3)` | 12 | 13 ✗ |
   | `w(2,1)` | 22 | 21 ✗ |
   | `w(2,2)` | 13 | 22 ✗ |
   | `w(2,3)` | 23 | 23 ✓ |

   Only the two corners are right. **It is not N-D-specific and not
   object-specific:** a plain rank-2 2x3 struct array is transposed identically
   in *both* `.sldd` formats (`s2(1,2)` shows 21, MATLAB says 12). Vectors are
   correct, because there the two orders coincide — which is exactly why every
   existing fixture (all N x 1) missed it. One shared subscript helper, fed
   column-major, fixes both call sites.

7. **N-D arrays display only their first page.** `formatMatrix`
   (`MatlabVariableNode.ts:173`) loops `rows x cols`. A 2x3x2 double shows
   `[1 2 3; 4 5 6]` while carrying all 12 children; a 2x2x2 cell shows
   `{1, 2; 3, 4}` of 8. Note MATLAB's own `mat2str` **errors** on rank >= 3
   ("Input matrix must be 2-D"), so there is no literal to match — collapse to
   `<2x3x2 double>` rather than invent a multi-page inline form. `_formatString`
   has the same loop shape; not yet exercised by a fixture.

8. **Rank >= 3 produces subscripts that do not exist — in three duplicated
   places.** The formula `Math.floor(ei / cols) + 1`, `(ei % cols) + 1` with
   `isMatrix = dims[0] > 1 && dims[1] > 1` appears three times and consults
   `dims[2..]` in none of them:

   - `BaseNode.displayName` (`:256-274`) — numeric, cell and string array
     elements. **This is the most-used copy**, and it also owns the correct
     cell spelling `name{r,c}`, the one thing the three do not share.
   - `ObjectNode.ts:196`
   - `StructNode.ts:237`

   Observed on MATLAB-authored files: a 2x3x2 double labels `A(1,1)` … `A(4,3)`
   and a 2x2x2 cell labels `C{1,1}` … `C{4,2}` — row subscripts run to 4 in
   two-row arrays. A 2x3x2 object array labels `v(1,1)` … `v(4,3)`; a 2x3x2
   struct array in `.sldd` flattens to `<2x6 struct>` and labels `s(1,1)` …
   `s(2,6)`. MATLAB's are `A(1,1,1)` … `A(2,3,2)`. One shared helper emitting a
   full subscript tuple, parameterized by bracket style, replaces all three.
   Fixing only the object/struct pair leaves the numeric path — the common one —
   broken.

   Rank 2 is correct on the numeric/cell/string path: `Kp` labels `Kp(1,1)` …
   `Kp(2,3)` and its element list is row-major, so labels and data agree.
   Defect 6's transpose does **not** apply there; it is specific to the
   object/struct element lists, which arrive column-major.

9. **`mcosTypedNode.ts:55` truncates an object array's rank, and it is
   visible.** `[dimensions[0], dimensions[1]]` makes a 2x3x2 array report
   `<2x3 Simulink.Parameter>` — the container prints a shape that is not the
   object's. `ObjectNode` also carries no `_dims`, so unlike the bare
   numeric/cell/struct nodes (which do preserve full N-D dims) an object array's
   true rank is unrecoverable by a consumer.

10. **`.mat` struct arrays expand only their first element.** Any rank,
    including a 1x3: `s1` displays `<1x3 struct>` correctly but the tree holds a
    single `a` child, so 2 of 3 elements are simply absent. A 2x3 shows 1 of 6.
    The `.sldd` paths expand all elements (transposed — defect 6), so this is
    `.mat`-specific and is tree-level data loss, not a display issue.

11. **`_type: 'cdata'` is assumed to be complex double; R2027a also uses it as
    a uuencoded MAT-byte escape.** `parseCdata` (`MatlabVariableNode.ts:1793`)
    routes every non-numeric `cdata` payload through `decodeCdata` as
    complex-double bytes. In an **uncompressed-text** `.sldd` — the R2027a
    default — MATLAB stores N-D arrays, cell arrays, and N-D struct arrays as
    `{_type: 'cdata', _value: <uuencoded MAT stream>}`. Those decode to garbage
    denormals with fabricated imaginary parts and the wrong class: a 2x3x2
    double reads `[2.03711595937e-312+7i 4+8i …]`, and a 2x2x2 cell and a 2x3x2
    struct array both come back as complex numeric matrices. Rank-2 numeric
    (`Matrix(r,c)`) and rank-2 struct entries are unaffected. Serialization
    preserves the `cdata` entry byte-identically, so this is display/model
    corruption, **not** save-back data loss. Needs the payload sniffed and
    either decoded as a MAT stream or reported as unsupported — silently
    rendering it as complex is the defect.

12. **`.sldd` flattens rank >= 3 on read, and cannot spell it on write.**
    `parseDims` (`BinarySlddParser.ts:52-62`) explicitly folds any rank >= 3 into
    `[dims[0], prod(dims[1..])]`, so a `Dimension="2*3*2"` entry becomes `[2,6]`:
    a 2x3x2 double reads back as `[1 2 3 7 8 9; 4 5 6 10 11 12]` and a 2x3x2
    struct array as `<2x6 struct>`. **The files are not at fault** — MATLAB's own
    binary dictionary writes `Dimension="2*3*2"` with a flat column-major value
    list, and the text format carries a full MAT stream under `cdata` (defect
    11). Both preserve the rank; the parser discards it. On the write side the
    repo's own literal `Matrix(rows,cols)` (`BinarySlddParser.ts:480`) is 2-D
    only, so N-D write-back needs the `Dimension=` spelling MATLAB already
    uses — nothing has to be invented. Reading is a plain parser fix and comes
    first.

13. **Object and struct array containers expose no shape.**
    `MatlabVariableNode` is the only node class with a `dims` accessor
    (`:301-309`). `ObjectNode` and `StructNode` read `_dimensions` into local
    `rows`/`cols`, use them for the label, and drop them, so a 2x3
    `Simulink.Parameter` array reports `dims = undefined` to any consumer. Add
    the accessor alongside defect 6's shared helper, which wants the same
    `dims`. Note the related upstream claim that *elements* are
    indistinguishable — "every element … reports `<1x1 Simulink.Parameter>`" —
    does not hold for a **known** class: each element is a `ParameterNode` and
    displays its own `Value` (`w(1,1)` shows `11`). It would hold for
    unknown-class elements, which fall back to the generic `ObjectNode` display.

**Consequence to accept: `valueEditable` is keyed on the `<...>` form.**
`BaseNode.valueEditable` (`:276-282`) returns false for any display value
wrapped in angle brackets. Moving the summary forms onto `<mxn class>` (defect 3)
therefore makes summarized cells non-editable, where `{1x3 cell}` and
`[1x2 MyClass]` are editable today. That is the correct behaviour — a summary is
not a value you can retype — but it is a functional change, not only a styling
one, and the parity suite must assert it deliberately rather than discover it.

**Corrections to the upstream findings note.** Its claim that the container
"reports `<2x3x2 Simulink.Parameter>` correctly" holds only on the path that
supplies dimensions by hand (`addMatSourceParsed`); through the real MCOS
decoder the container reports `<2x3 …>`, because `mcosTypedNode` truncates
before `ObjectNode` is built (defect 9). Both observations are right for their
own path — the doc should say which. Its C4 was recorded as unconfirmed and
possibly N-D-only; it is confirmed, and it bites at rank 2 (defect 6).

**Correction to our own earlier record.** A first pass here reported that bare
array/cell/string children are named by bare linear index. That was wrong: it
read `_displayName ?? name`, bypassing the `BaseNode.displayName` **getter**
that computes the subscript. Those rows are correctly labelled `Kp(1,1)` and
`C{1,2}` at rank 2; the real defect in that getter is the rank >= 3 formula, now
folded into defect 8. The upstream note's retraction of its own C5 is correct.

`.sldd` cannot store an object array **at all** — `addEntry` rejects
`Simulink.Parameter`, `Simulink.Bus`, and even a 1x2 array with "Arrays of class
'X' are not supported in the dictionary." So the `.sldd` object-array expansion
code is unreachable from any MATLAB-authored file, and object-array parity is a
`.mat`/`.slx` question only.

## Known limitations, to verify and document

- **Derived MCOS classes.** A customer class `MyParam < Simulink.Parameter`
  ideally gets the `Simulink.Parameter` schema plus its custom properties. The
  file bytes do not record the superclass, and without MATLAB inheritance is not
  recoverable — so it is treated as an unknown class and takes the general
  expansion path. The suite verifies this degrades gracefully: no crash, no data
  loss, every property visible, values correct. It does not attempt a heuristic.
- **`.mat` / `.slx` / `.prj` are read-only.** No write-back verification.
- **Truth can go stale** against a future MATLAB release. `drift.mjs` is the
  mitigation; it is a developer action, not a CI gate.

## Risks

| risk | mitigation |
|---|---|
| `expect.ts` re-derives what `src` does, making tests tautological | derive only from MATLAB-reported class/size/complexity/`mat2str` |
| Threshold unification is user-visible (long arrays start summarizing) | called out above as intended; confirmed during design |
| Fixture size | one artifact per format, not per case; ~15–20 KB each, ~100 KB total |
| Defect 1 touches storage, display, and serialization | separate `lossless` tier asserts the storage guarantee independently of display |
