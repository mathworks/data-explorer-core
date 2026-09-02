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
  **display length**, `SUMMARY_MAX_CHARS = 200`. This is char and scalar string.
- **Has child rows** → the cell is a summary and the value is one expand away →
  threshold on **element count**, `SUMMARY_MAX_ELEMENTS = 10`. This is numeric
  array/matrix, cell, and string *array* (which does expand, via
  `_makeStringElement`).
- **struct** → always `<mxn struct>`; no threshold applies.

Rationale: element count makes shapes look consistent — every 1x10 double
renders like every other 1x10 double, rather than depending on how many digits
its values happen to have. `N = 10` keeps every vector and small matrix up to
2x5 / 3x3 as a literal while `1:30` summarizes. `M = 200` means a realistic
description or unit string is never hidden behind a summary it cannot be
expanded out of.

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

**Known object classes** — the 19 MATLAB-instantiable classes behind
`schema/classes/`, each with non-default values on every writable property.
Object arrays (e.g. 3x1 `Simulink.Parameter`). Container classes with real
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
