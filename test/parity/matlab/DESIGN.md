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

**`[ ]` is ours, not MATLAB's.** Checked against R2027a while implementing
Phase 7: MATLAB offers no spelling to match for an empty. `mat2str([])` is
`[]`, and `formattedDisplayText([])` / `formattedDisplayText({})` are both the
empty string. `[ ]` is this project's choice — it is what the object-property
path has always emitted, and the one-space form makes an empty value visible in
a table cell instead of reading as a rendering failure.

### A property sheet is not a table cell

The table above is the **table cell** convention: a cell holds a MATLAB LITERAL,
because what it shows is what you would type to get the value back. The Property
Inspector holds the **value**, because its cell IS the text box you edit the
property in. One property, two right answers:

| | table cell | property sheet |
|---|---|---|
| `Unit = 'm/s'` | `'m/s'` | `m/s` |
| `Description = ''` | `''` | (empty) |
| `Dimensions = [1 1]` | `[1 1]` | `[1 1]` |
| `Min = -10` | `-10` | `-10` |

So the difference is exactly one rule — **char and string take MATLAB's own text
(`disp`) instead of its `mat2str` literal** — and everything else keeps the
mat2str spelling, which for a number or an array already IS the value. That one
rule is the whole of `expectedPropertyText` in `expect.ts`; `expectedDisplay` is
the cell form and the two share the float-tolerance matcher, so a divergence
between them can only ever be this rule and never an accident of formatting.

A nested object property (`CoderInfo`) gets **no** expected text: `mat2str`
refuses it, and its contents are a sub-sheet of their own. There the suite
asserts PRESENCE instead — see defect 37 below for what that catches.

**The property surface is `toPIObject()`, not the tree.** An object's properties
are not its child rows, and conflating the two was the plan's own mistake for
Phase 11: `aParam` has no children at all, and `aBus`'s children are its bus
ELEMENTS. `toPIObject()` returns one flat namespace per node — a curated or
schema-group prop under its own key (`Value`, `dimensions`), a nested
sub-property under its raw path (`Other.CoderInfo.StorageClass`) — and that,
matched case-insensitively on the last path segment, is what MATLAB's
`properties()` list is checked against.

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

`SUMMARY_MAX_CHARS` **also bounds the expandable literals**, on top of the
element rule. Applied literally, the element rule alone is not a bound on
length: a 1x4 cell of 300-character strings is 8 elements under budget and a
1200-character table cell. Since the char budget is defined as a runaway guard
rather than a display budget, it applies to every literal — primary rule
unchanged, pathological case bounded.

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
| `{300 chars ×4}` | yes | elements, then chars | `<1x4 cell>` |
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
test/parity/artifacts/
  truth.json                  ONE truth file, not one per format: MATLAB's
                              measurements are of the VALUE, and the value is
                              the same in every format. Per entry: class, size,
                              iscomplex/islogical/isobject/isempty, mat2str (or
                              mat2str_error), disp, per-element linearSubs /
                              linearValues / linearElems, and for an object the
                              full public property list measured the same way.
                              A per-format claim is a `verdict`, recorded where
                              a format REFUSED the case.
  text/cases.sldd             uncompressed-text dictionary
  binary/cases.sldd           compressed-binary dictionary
  slx/cases.slx               model workspace
  mat/cases.mat

test/parity/matlab/
  gen_truth.m                 MATLAB: the only entry point. Builds every
                              artifact from one case catalog, emits truth.json.
  loadTruth.ts                loads truth.json and all four artifacts; the
                              accessors the suites share (elementsByLabel,
                              childrenByName, piProperties, piLookup, refused)
  expect.ts                   the display convention, once, as a pure function
  expect.test.ts              expect.ts on its own — see below
  display.test.ts
  structure.test.ts
  lossless.test.ts
  schemaProps.test.ts
  writeback.live.test.ts      dev-only, gated on DEX_MATLAB_CMD
  drift.mjs                   dev script: regenerate truth and diff
  README.md                   how to regenerate truth
  probe_*.m / *.mjs           one-question probes, kept as the record of what
                              MATLAB was actually asked
```

A `.prj` carries no data objects, so there is nothing to value-compare and no
artifact of its own; its structural coverage lives with the other loaders.

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

**`expect.ts` imports nothing from `src/`**, and that is enforced by reading it, not
by a lint rule — it is the one file whose independence the whole tier rests on.

**It is unit-tested on its own** (`expect.test.ts`), because a bug HERE would make
every parity suite agree with a wrong data model: the one failure mode a parity suite
cannot detect from the inside. So the thresholds, the empty spellings, the
object-array rule, the `isobject("a")` trap, the float tolerances at `double` and
`single` resolution, and the property-sheet rule each get an assertion of their own.

### Test tiers

**Tier 1 — committed truth, no MATLAB, runs in CI on every PR.**

| file | asserts |
|---|---|
| `display.test.ts` | `displayValue` and Data Type, per format × case, plus every element row's value |
| `structure.test.ts` | child counts, shape, index naming (`v(1)`, `v(1,2)`, `s.f`, `c{1}`), row ORDER against MATLAB's linearization, leaves bottom out at primitives |
| `lossless.test.ts` | an untouched serialize→reparse is a fixed point of the whole display tree |
| `schemaProps.test.ts` | every property MATLAB reports on an object is surfaced by the Property Inspector with MATLAB's value; a nested object surfaces by name, by its sub-properties, or as element rows |
| `expect.test.ts` | the convention itself, independently of any artifact |

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
**`.mat` only** — verified against R2027a in Phase 2: the dictionary rejects object
arrays (*"Arrays of class 'Simulink.Parameter' are not supported in the dictionary."*)
and so does the `.slx` model workspace (*"Creating an array of Simulink data or data
type objects in the model workspace is not allowed."*). An earlier draft of this
document claimed the model workspace holds them; MATLAB was asked directly and it
does not. Both refusals are recorded in `truth.notes`. Container classes with real
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
   storage, display, and serialization. **Fixed across four phases, one channel
   at a time**, and it took that long because there are six paths, not one: the
   two `.sldd` readers in Phase 8 (defects 29 and 30 — the second survived the
   first, which is the lesson), the `.mat` reader in Task 10.2, and the EDIT path
   in Phase 12 (defect 42), which no in-process round trip could see. The
   representation is the **source decimal string**, not `BigInt`: it survives
   `JSON.stringify`, it is what MATLAB itself writes, and it needs no arithmetic —
   `XmlUtils.parseExactNum` hands back a number where a double is lossless and
   canonical decimal text where it is not, so every path that was already correct
   stayed on numbers.
2. **`string` in `.mat` / `.slx` renders `<1x1 string>` with blank Data Type —
   wrong output.** Root cause is deeper than a missing class-table entry: a MAT
   `string` array is stored as an **opaque MCOS object**, not one of
   `MatParser.CLASS_NAMES`' array classes, so it falls through the opaque path
   and reports 1x1 regardless of real size. A 1x2 string array displays
   identically to a scalar. The fix is MCOS `string` payload decoding in
   `McosParser`. Works correctly in `.sldd`, which is why this was not caught.
   **Fixed in Phases 9 and 10.** The shape and the Data Type came first (Task 9.2,
   defect 31), and the decoding did **not** stop at the probe: Task 9.3 reversed
   the payload and reads the text itself (defect 33), with what could and could not
   be determined written up in `STRING_MCOS.md`. What moved to Known limitations is
   narrower than "strings" — a `string` **nested inside a struct field or a cell**
   in a `.mat`, which is a nested-MCOS gap shared with every class rather than
   anything about strings.
3. **Summary form inconsistent, so italic is inconsistent.** `_formatCell`
   emits `{1x3 cell}` (braces, `MatlabVariableNode.ts:508`) and the opaque array
   path emits `[1x2 MyClass]` (square brackets, `:435`). Neither renders italic.
   Both must be `<mxn class>`. Fixed in Phase 7: every summary now comes from the
   single `summaryForm` in `DisplayConvention.ts:75`, and two existing tests that
   had pinned the square-bracket form (`'[1x3 Simulink.Parameter]'`, `'[3x1 C]'`)
   were corrected toward the angle form.
4. **Threshold duplicated and inconsistent.** `50` appears in
   `PropValue.format`, `_formatCell`, and `_formatString`, and is absent from
   `_formatArray` entirely — so the same array summarizes on the object-property
   path and prints unbounded on the variable path. Replace with the two shared
   constants above, applied by every path. Fixed in Phase 7: all four paths call
   `needsSummary`/`overCharBudget`, and `SUMMARY_MAX_ELEMENTS = 10` /
   `SUMMARY_MAX_CHARS = 1000` are declared once. Verified against MATLAB's own
   `numel`: `truth.vars.exactly10` prints its literal, `truth.vars.eleven`
   summarizes.
5. **Empty rendering split.** `PropValue.format` returns `[ ]` (correct) while
   the variable path returns `[]`. Unify on `[ ]`. Fixed in Phase 7 via the shared
   `EMPTY_NUMERIC`/`EMPTY_CELL` constants. Note MATLAB offers nothing to match
   here — `formattedDisplayText([])` is the empty string and `mat2str([])` is
   `[]` — so `[ ]` is this project's own spelling, per the normative table above.
   One empty is deliberately left behind: an empty **string array** still prints
   `[]`, because `_formatString`'s row loop falls through to `'[' + '' + ']'`
   (`MatlabVariableNode.ts:608`) and no artifact reaches it.

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
   column-major, fixes both call sites. Fixed in Phase 3, together with defect 8:
   `src/datamodel/display/Subscript.ts` owns `ind2sub`, the row-major to
   column-major remap and `subscriptLabel`, and the three call sites pass their
   bracket style and their element order rather than each deriving both. Defect 14
   is the correction this fix earned — the order is uniform by **kind**, not by
   rank — and `test/cellElementOrder.test.ts` pins the pairing against MATLAB's own
   `linearSubs`/`linearValues` in all four formats, with a numeric control so a
   future "make everything column-major" cannot pass either.

7. **N-D arrays display only their first page.** `formatMatrix`
   (`MatlabVariableNode.ts:173`) loops `rows x cols`. A 2x3x2 double shows
   `[1 2 3; 4 5 6]` while carrying all 12 children; a 2x2x2 cell shows
   `{1, 2; 3, 4}` of 8. Note MATLAB's own `mat2str` **errors** on rank >= 3
   ("Input matrix must be 2-D"), so there is no literal to match — collapse to
   `<2x3x2 double>` rather than invent a multi-page inline form. `_formatString`
   has the same loop shape; not yet exercised by a fixture. Fixed across Phases 6
   and 7: the rank test lives in `needsSummary` (`DisplayConvention.ts:62`) and
   `_formatArray`, `_formatCell` and `_formatString` all consult it, so a 2x3x2
   prints `<2x3x2 double>` and is no longer indistinguishable from a genuine 2x3
   in the same file.

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
   broken. Fixed in Phase 3 by the same `Subscript.ts` as defect 6; all three
   copies are gone, so a rank the helper learns is a rank every label knows.

   Rank 2 is correct on the **numeric** path only: `Kp` labels `Kp(1,1)` …
   `Kp(2,3)` and its element list really is row-major, so labels and data agree.
   An earlier draft of this document extended that claim to cell and string
   arrays. **That was wrong**, and defect 14 below is the correction:
   `MatParser.parseMatrix` runs only its *numeric* branch through
   `transposeFromColMajor` (`MatParser.ts:234`); the cell branch (`:317`) stores
   `result.value = cells` in file order, which is MATLAB's column order. So the
   order is not uniform even within rank 2 — numeric is row-major, cell and
   string join struct and object in being column-major.

9. **`mcosTypedNode.ts:55` truncates an object array's rank, and it is
   visible.** `[dimensions[0], dimensions[1]]` makes a 2x3x2 array report
   `<2x3 Simulink.Parameter>` — the container prints a shape that is not the
   object's. `ObjectNode` also carries no `_dims`, so unlike the bare
   numeric/cell/struct nodes (which do preserve full N-D dims) an object array's
   true rank is unrecoverable by a consumer. Fixed in Phase 8, which found the
   truncation in **three** places, not one: `mcosTypedNode.ts:55` (the only one
   this entry named), `McosParser.decodeMcosBlob` (the root-variable path, and the
   one that actually bit `cases.mat`) and `McosParser.resolveValue` (a nested
   object-array property, pinned by the new MATLAB-authored
   `test/fixtures/mcos/ndNested.mat`). A second symptom this entry does not
   mention was fixed with it: before the fix `obj2x3x2` emitted six **duplicate**
   labels, `obj2x3x2(1,1)` appearing once holding `1` and again holding `7`.

10. **`.mat` struct arrays expand only their first element.** Any rank,
    including a 1x3: `s1` displays `<1x3 struct>` correctly but the tree holds a
    single `a` child, so 2 of 3 elements are simply absent. A 2x3 shows 1 of 6.
    The `.sldd` paths expand all elements (transposed — defect 6), so this is
    `.mat`-specific and is tree-level data loss, not a display issue. Fixed in
    Phase 4.

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
    rendering it as complex is the defect. Fixed in Phase 5: the payload is
    sniffed and the MAT stream decoded, so the rank-3 double, cell and struct
    array each read as themselves instead of as six garbage complex numbers.
    Silently rendering it as complex was the worst available outcome — the value
    looked plausible — which is why the sniff, not a widened decoder, is the fix.

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
    first. Fixed in Phase 6 (read, and the `Dimension=` write for numeric, cell
    and struct), pinned against MATLAB-authored dictionaries in
    `test/slddRank.test.ts` and `test/slddNdWriteBack.test.ts`. Two things that
    entry did not anticipate: the 1x1 "omit the attribute" guards were themselves
    rank bugs (`dims[0] === 1 && dims[1] === 1` is also true of a 1x1x3, so they
    now require `dims.length <= 2`), and a first extent of 1 hit row-vector
    shortcuts that flattened `1*2*2` to a 1x4. MATLAB re-read our output and
    reported `struct [2 3 2]`, `cell [2 2 2]` and `double [2 3 2]` under
    `isequaln`.

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
    Fixed in Phase 8: both classes now expose `dims` off the shared
    `effectiveDims`, and `StructNode`'s pre-existing `_shape` getter was renamed to
    it rather than duplicated. One behaviour fix rode along inside what the plan
    called a mere accessor — a trailing-singleton `2x3x1` object array now reports
    `[2,3]` and displays `<2x3 ...>`, which MATLAB confirmed directly:
    `size(reshape(arrayfun(@(k) Simulink.Parameter(k),1:6),[2 3 1]))` is `[2 3]`.

14. **Cell and string element lists arrive column-major, and both the labels
    and the inline literal read them row-major.** Found while implementing
    defect 6's shared helper, and it invalidates this document's own earlier
    claim (see the rank-2 paragraph above). `MatParser.parseMatrix` calls
    `transposeFromColMajor` **only** in its numeric branch (`MatParser.ts:234`,
    guarded by `arrayClass >= 6 && arrayClass <= 15`); the cell branch (`:317`)
    assigns `result.value = cells` in file order and the struct branch pushes
    field elements in file order. MATLAB writes all of them down its columns. So
    at the node layer the order is **not uniform by rank, it is uniform by
    kind**: numeric is row-major, and cell, string, struct and object are
    column-major. Two symptoms, both real, both format-independent:
    `BaseNode.displayName` passed `'row-major'` for every kind, so MATLAB's
    `c{1,2}` (value `2`) was labelled onto the element holding `4`; and
    `_formatCell`/`_formatString` build the inline literal by reading
    `[r * cols + c]`, printing MATLAB's `{1 2 3; 4 5 6}` as
    `{1, 4, 2; 5, 3, 6}`. A square fixture cannot see either one — the label SET
    and the literal's shape are both right, only the pairing is wrong — and
    every cell/string fixture in the repo was 2x2 or a vector. The non-square
    `cell2x3` and `strMat` in `cases.mat` are what exposed it, in all four
    formats. Fixed in Phase 5 and locked by `test/cellElementOrder.test.ts`,
    which also carries a numeric control so a future "make everything
    column-major" fix cannot pass.

15. **`serializeValue` wipes a `.mat` struct and flattens every matrix.** Two
    write-path holes, found by Phase 3's verifier and measured against
    `cases.mat`. First: all five `.mat` struct cases — `structScalar`,
    `structNest`, `struct1x3`, `struct2x3`, `structNd` — serialize to `null`.
    On the `.mat` path a struct is `_kind: 'scalar'` / `_scalarType: 'struct'`,
    and `_serializeScalar` (`MatlabVariableNode.ts:1112`) has no struct arm, so
    it falls through to `return this._scalarValue`, which is `undefined` for a
    struct. Copy a struct from a `.mat` into a dictionary and the entry's
    contents are silently gone. The text `.sldd` escapes only because its struct
    has `_kind: undefined` and takes the `_rawInput` early return — a *modified*
    `.sldd` struct hits the same hole. Second: `_serializeArray`'s bare-JSON path
    (`:1147`) emits a naked list, so `nd2x3x2` writes as `[1..12]` and `mat2x3`
    as `[1,2,3,4,5,6]` — no `_dimensions`, no `Matrix(...)` header, nothing to
    carry the shape, and since the children are row-major the element order is
    wrong against MATLAB's column-major linearization too. `_serializeCell`,
    directly alongside, does carry `_dimensions`. Distinct from defect 12, which
    widens the `Matrix(r,c)` string only the *typed* path emits. Owned by Phase 6
    Task 6.4, deliberately ahead of the `lossless.test.ts` round-trip in Phase 11
    that would otherwise land red. Fixed in Phase 6 for the **JSON** write path
    (`_serializeScalar` gained a struct arm; `_serializeArray` now emits the typed
    `Matrix(...)` literal for anything with two spread extents). The XML twin of
    the same hole survived and is defect 16 below — the cross-phase sweep's
    finding, and the reason "defect 15 is fixed" was true but incomplete.

## Defects found by the cross-phase sweep

Phases 6, 7 and 8 were each verified in isolation and each was sound in isolation.
The sweep walked one value through all four of its channels at once — parsed
`dims`, displayed summary, consumer-visible `dims` accessor, and the bytes a write
emits — for `nd2x3x2`, `cellNd`, `structNd` and the `obj*` arrays, in all four
formats. Channels 1-3 agreed everywhere. Channel 4 did not, in four places, each
invisible to a single-phase check because each phase looked only at the writer it
had touched. Locked by `test/crossPhaseShape.test.ts`.

16. **`serializeXml` has no struct arm, so a `.mat`/`.slx` struct writes as
    `Class="struct">0` — and MATLAB then refuses the file.** The XML twin of
    defect 15's first hole. On the `.mat` and `.slx` paths a struct is
    `_kind: 'scalar'` / `_scalarType: 'struct'`, and `_serializeScalarXml`
    (`MatlabVariableNode.ts:1356`) tested `string`, `char`, `logical`, `complex`
    and `double` and then fell through to its numeric tail, emitting
    `<P Name="Value" Class="struct">0</P>` — every field and every element gone.
    Phase 6 closed the JSON half and DESIGN recorded defect 15 as fixed, but the
    **binary dictionary writer goes through `serializeXml`**, so copying a `.mat`
    struct into a compressed-binary dictionary still emptied it. The `.sldd`
    formats escaped only because they route struct XML through `StructNode`, which
    was correct — so all four formats had to be compared before it could be seen.
    Worse than data loss: substituting that byte sequence for `struct2x3`'s value
    in MATLAB's own `test/parity/artifacts/binary/cases.sldd` makes
    `Simulink.data.dictionary.open` answer **"Failed to open file"**, while the
    same rezip with MATLAB's bytes untouched opens and reads `struct [2 3]`.
    Fixed by the sweep, by routing `_serializeScalarXml`'s struct arm through
    `_serializeStructValue` into `StructNode` rather than growing a second
    struct-XML writer. MATLAB now reads our output back `EQUAL` under `isequaln`
    for `struct2x3` `[2 3]`, `structNd` `[2 3 2]` and `structScalar` `[1 1]`.
    Note that **no test anywhere pinned the broken output** — the whole suite
    stayed green through the fix — which is why four phases passed over it.

17. **An object array's `Dimension=` contradicts the body beneath it.** A pure
    interaction defect: Phase 8 made `ObjectNode` report its true rank, so
    `obj2x3x2` now says `dims = [2,3,2]` and displays
    `<2x3x2 Simulink.Parameter>`, but both object-array XML writers still spelled
    only two extents — `ObjectNode.ts:135` (`dims[0] + '*' + (dims[1] ?? 1)`) and
    `DataNode.ts:613` (`_serializeObjectPropertyXml`) — so the attribute promised
    six elements over the twelve `<Element>`s below it. Before Phase 8 every
    channel said `[2,3]`: wrong, but self-consistent, which is why Phase 8's own
    verifier measured the XML as byte-identical and filed it non-blocking. MATLAB
    supplies no ground truth for an object array's `Dimension=` — it refuses
    object arrays in both `.sldd` flavours and in the `.slx` model workspace
    (`truth.notes.slddRejected` / `slxRejected`) — but a tag that contradicts its
    own body is wrong under any reading, and Phase 6 established the consequence
    for the struct analogue: MATLAB's XML reader **segfaults** on a
    `Dimension="2*3"` carrying twelve `<Element>`s. Fixed in both writers to
    MATLAB's struct-array spelling: every extent named, one `<Element>` per
    element. The rank-2 spelling is unchanged and locked by a control test.

18. **The binary `.sldd` reader turns `Inf` and `-Inf` into `NaN`.** Not a shape
    defect, but the same cross-format disagreement the sweep looks for, found the
    same way: one MATLAB value, four readers, one answer that differs.
    `BinarySlddParser` split its whitespace-separated numeric body in three
    places and reached for plain `Number` in two of them (`:337`, `:376`), keeping
    `parseMatlabNum` only in the third (`:645`). `Number('Inf')` is `NaN`, because
    JavaScript spells infinity `'Infinity'` — so MATLAB's own bytes for
    `nonFinVec`,
    `<P Name="Value" Class="double" Dimension="1*5">1.0 Inf -Inf NaN 5.0</P>`,
    read back as `[1 NaN NaN NaN 5]`: both infinities destroyed on load and
    indistinguishable afterwards from a real `NaN`, against
    `truth.vars.nonFinVec.mat2str` `[1 Inf -Inf NaN 5]`. `.mat`, text `.sldd` and
    `.slx` were all correct, which is why no single-format test caught it.
    Pre-existing rather than phase-introduced — first noticed by Phase 7's
    verifier and unowned until now. Fixed with one shared
    `XmlUtils.parseNumericBody` used by all three sites, so they cannot drift
    again. A second half had to be fixed with it: a bare JSON array cannot carry a
    non-finite (`JSON.stringify` writes `null`, and the entry really did serialize
    to `[1,null,null,null,5]`), so `formatTypedVector` now falls back to the typed
    literal MATLAB itself uses in a text dictionary,
    `{"_type":"double","_value":"[1.0, Inf, -Inf, NaN, 5.0]"}`. MATLAB reads our
    output back `EQUAL`.

19. **Our `Matrix(...)` serial spelling is one MATLAB reads as an empty matrix,
    at every rank — and there were two writers of it that disagreed.**
    `MatlabVariableNode._buildMatrixString` emitted newline-joined rows —
    `Matrix(2,3)\n[1, 2, 3]\n[4, 5, 6]` — while MATLAB's own text artifact spells
    the same value `Matrix(2,3)\n[[1.0, 2.0, 3.0]; [4.0, 5.0, 6.0]]` and a 3x1 as
    a **flat** `Matrix(3,1)\n[1.0, 2.0, 3.0]`. Asked directly
    (`probe_matrix_serial.m`, which patches one entry's literal in a copy of
    MATLAB's own text `cases.sldd` and opens each with
    `Simulink.data.dictionary.open`), MATLAB reads our form as
    `class=double size=[1 0] numel=0` — the value is **silently gone**, no error,
    the file opens cleanly — and reads its own bracketed form back as `[2 3]` at
    every class probed (`double`, `logical`, `int16`, `uint64`) and every shape
    (`[2 3]`, `[1 3]`, `[3 1]`). The trailing `.0` is optional; the
    bracket-and-`'; '` join is what MATLAB requires.

    This is the sweep's own class of finding twice over. First, it was
    **format-dependent**, which is how it stayed hidden: the same `mat2x3`
    serialized to MATLAB's bracketed form out of a text/binary `.sldd` (the
    `_rawInput` passthrough replays MATLAB's bytes) and to our newline form out of
    `.mat`/`.slx`, so both spellings sat side by side in one corpus and no
    single-format test disagreed with itself. Second, the string had **two
    writers** — `BinarySlddParser.formatMatrix` (`:513`, the .sldd reader's own
    output) and `MatlabVariableNode._buildMatrixString` — and Phase 6 widened both
    to rank 3 independently without noticing they already disagreed at rank 2.
    That is exactly the duplication Phase 3 exists to prevent, arriving through
    the back door: each phase check compared a writer against itself.

    Fixed by the sweep. Both callers now go through one
    `XmlUtils.formatMatrixSerial`, and `formatNumLiteral` beside it restores the
    class suffixes MATLAB spells in a typed literal (`3.14159274F`,
    `18446744073709551615U`, bare for the signed integers, a forced `.0` for
    double) — without which MATLAB reads a typed body back as **double**, so the
    old writer lost the class as well as the shape. Seven existing expectations
    pinned the unreadable spelling and were corrected toward MATLAB
    (`matParser.test.ts`, `matlabVariableNode.test.ts` x3, `serializeShape.test.ts`
    x2, `slddRank.test.ts`), each with a comment naming what MATLAB actually does.
    Still true and still unowned: MATLAB accepts **no** inline spelling for rank
    >= 3 or for complex in either form (it writes a `cdata` MAT stream), so our
    rank-3 body is the same *form* as the rank-2 one for our own reader's benefit,
    and a text-format N-D or complex edit cannot be made MATLAB-readable at all
    without a `cdata`/MAT-stream writer.

### Exposed by the sweep, not fixed by it

Two of the three have since been closed by the write-back gate pass below, which is
why each carries a **Fixed** paragraph; the heading records who found them, not who
fixed them. 20 is still unowned.

20. **A text `.sldd` empty struct is never a struct.** `structEmpty` reads back as
    a `MatlabVariableNode` with `_dims [1,1]` and displays `[0]`, where `.mat`,
    binary `.sldd` and `.slx` all give `<0x0 struct>` and
    `truth.vars.structEmpty` is `{class: 'struct', size: [0,0], numel: 0}`. The
    text parser never makes it a struct, so `_formatScalar`'s struct arm is never
    reached. This is the only place in the corpus where "a struct is always the
    angle form" — the rule Phase 7 wired — fails. Pre-existing and unchanged by
    these phases; needs an owner.

21. **A typed vector gains a `Matrix(1,N)` header MATLAB does not write.** Found
    while establishing 19, from MATLAB's own bytes rather than by inference:
    `test/parity/artifacts/text/cases.sldd` stores `i16Vec` as
    `{"_type": "int16", "_value": "[1, 2, 3]"}` and `u64Vec` as
    `{"_type": "uint64", "_value": "[18446744073709551615U, 1U, 0U]"}` — no
    header at all for a 1xN — while reserving `Matrix(3,1)` for the column
    orientation, whose shape a flat list could not otherwise carry. A plain double
    row vector it writes as a bare JSON array (`rowVec` -> `"value": [1, 2, 3]`).
    Our writer emits `Matrix(1,3)\n[1, 2, 3]` for the typed row case. MATLAB reads
    that back correctly (probes `D_row_flat` and `E_row_grouped`, both `[1 3]`), so
    this is not data loss — but it rewrites a line MATLAB wrote differently, so
    every save diffs untouched neighbours, which is the same objection defect 4 was
    filed under. Deliberately not folded into 19's fix: dropping the header changes
    the round-trip contract for a class of value the sweep had no MATLAB-verified
    reason to touch, and the shape a 1xN needs is already implied. Left with its
    evidence rather than fixed silently.

    **Fixed** (commit `466d81b`), once reading our own code disproved the reason it had
    been deferred. `BinarySlddParser.formatTypedVector` has *always* written a row bare
    on the READ path, under the identical `dims.length <= 2 && dims[0] === 1` guard — so
    the codebase already held both spellings, and the write path was the one disagreeing
    with MATLAB *and* with its neighbour. "One spelling for every typed array" was
    therefore never true of this repo. The fix is one line in the shared
    `XmlUtils.formatMatrixSerial`, so both writers changed together. MATLAB's own
    `typed_text.sldd` states the bare-row rule six times (`i32Vec`, `sglVec`, `lglVec`,
    `u64Vec2`, `sTyped`'s `a` and `d` fields, `cTyped`'s first element); eight of that
    fixture's nine entries are now byte-identical through our writer, up from three, the
    ninth differing only by the `_mw_element_type` key recorded under divergences below.
    The "not data loss" half is confirmed in the other direction too: asked to open a
    dictionary carrying `Matrix(1,3)\n[1, 2, 3]` for an int16, MATLAB answers
    `int16 [1 3]` (`literal/i16Vec` in the gate below), so the old form really was churn
    and not loss for as long as it stood. New `test/typedShapes.test.ts` reads
    `typed_text.sldd` as ground truth for the rule and for its column/matrix controls.

22. **A text `.sldd` has NO literal spelling for rank >= 3, so `Matrix(d1,d2,d3)`
    destroys the value — and defect 12's fix emits exactly that.** Found by
    round-tripping our serializer's real output through MATLAB rather than through
    our own reader, which is the check every earlier verification was missing: if
    we emit a spelling MATLAB cannot read, our reader reading it back proves only
    that we are self-consistent. Defect 19's probe table established the grouped
    rank-2 body but has **no rank-3 row**; the header was widened to
    `Matrix(d1,...,dn)` on the assumption it generalizes. Asked directly
    (`test/parity/matlab/probe_rank3_serial.m`, six candidate spellings for a
    2x3x2 whose answer must be `size [2 3 2]`, `A(:)' = [1 4 2 5 3 6 7 10 8 11 9 12]`):

        Matrix(2,3,2)\n[[1.0,2.0,3.0]; [4.0,5.0,6.0]; [7.0,...]; [10.0,...]]  -> [1 0] EMPTY
        Matrix(2,3,2)\n[flat column-major]                                     -> [1 0] EMPTY
        Matrix(2,3,2)\n[[[..];[..]], [[..];[..]]]   (nested pages)             -> [1 0] EMPTY
        Matrix(2,3,2)\nreshape([...], 2, 3, 2)                                 -> [1 0] EMPTY
        reshape([...], 2, 3, 2)          (bare expression, no header)          -> [1 1] scalar 0
        cat(3, [[..];[..]], [[..];[..]]) (bare expression, no header)          -> [1 1] scalar 0

    So `_value` is a restricted literal grammar that stops at rank 2, not a MATLAB
    expression — the two constructor forms are not evaluated, they parse as a
    scalar `0`. MATLAB's own file confirms the intended channel: it stores
    `nd2x3x2`, `cellNd` **and** `structNd` as `{"_type": "cdata"}`, a uuencoded MAT
    byte stream, while spelling every rank-2 sibling as a literal (`mat2x3` ->
    `Matrix(2,3)`, `cell2x3` -> `_array_type: 'Cell'` with `_dimensions: [2,3]`).
    The cdata stream is the ONLY form MATLAB reads at rank >= 3, for every kind.

    Measured end-to-end (`.probe_roundtrip.mts` — edit one element through
    `setProperty('Value', ...)`, serialize, splice into MATLAB's own dictionary,
    reopen in MATLAB; an unedited re-stringify is the control and reads clean):

        nd2x3x2   ours: Matrix(2,3,2)\n[[99.0, ...]]        MATLAB: size [1 0], numel 0  -- GONE
        cellNd    ours: _dimensions [2,3,2], 12 elements    MATLAB: 2x3 cell, 6 elements -- PAGE 2 GONE

    Note this is not purely a regression: before defect 12's fix the same edit
    wrote `Matrix(2,3)` and lost half the values, so the case was already broken.
    It went from losing half to losing all of it, while newly *claiming* the right
    shape. Also note `cell2x3`'s `_elements` is `[1,4,2,5,3,6]` in MATLAB's own
    file — column-major, defect 14 corroborated from the bytes.

    The fix is to write the cdata stream, and the encoder is nearly built already:
    `test/tools/matBytes.ts` has `numericVar` / `cellVar` / `structVar` (all taking
    N-D `dimensions`) plus `mxArrayFile`, which emits exactly the container MATLAB
    uses — magic `00 01 49 4D`, four zero bytes, then one `miMATRIX` element
    (verified against MATLAB's own three cdata bodies: tag `14` at offset 8, size at
    12, `06 00 00 00 08 00 00 00` array flags at 16). What is missing is a
    `uuencode` (the exact inverse of `MatlabVariableNode.uudecode:91` — a raw
    6-bit-per-character stream, no line framing) and for that builder to live in
    `src/` instead of `test/`. Owned by Phase 6, reopened.

    **Fixed** (commit `a318f7a`). `src/datamodel/parser/CdataCodec.ts` gained
    `uuencode`, the exact inverse of the existing `uudecode`, and
    `src/datamodel/parser/MatWriter.ts` is the `src/` home of the MAT-stream builder —
    `matCdata` is the four-byte preamble plus one `miMATRIX` element, uuencoded.
    `serializeValue` takes that branch for rank >= 3 of every class and, per defect 24,
    for complex at every rank. Our streams are byte-identical to MATLAB's own for all
    thirteen kinds in `nd_rich.sldd`.

    **The placement rule, which this entry did not anticipate.** The stream goes at the
    LEAF, wherever the value sits, with every container above it in its ordinary JSON
    form: an N-D struct field is a cdata string inside a normal fields object, not a
    cdata for the whole struct. Measured from `probe_nd_nested.m`'s six placements —
    entry value, object property, struct field, cell element, two levels down — and
    pinned in `test/serializeNdCdata.test.ts`. It matters because a stream written one
    level too HIGH still decodes to the right value, so our own reader would accept it
    and only a comparison at the leaf against MATLAB's JSON can see the mistake. That is
    why the gate's `nested` batch extracts through the containers (`.Value`,
    `.Dimensions`, `.deep`, `{2}`, `.inner.deep`) rather than comparing whole entries.

    **Gate result.** All thirteen `rich` kinds, all six `nested` placements and all three
    `edit` cases — a real `setProperty` on one cell of a 2x3x2 double, of a 2x3x2 cell and
    of a 2x3x2 struct array — reopen in MATLAB at the right class and size, with the edit
    in the right cell and the other eleven elements unchanged, inside
    `WRITEBACK FAILURES 0 of 54`. Both claims the entry left standing are discharged:
    there IS a MATLAB-readable channel for rank >= 3 in a text dictionary, and it is the
    one MATLAB uses itself.

**On duplication.** The sweep's fourth task was to check the three phases had not
each grown their own copy of one helper. They had not, on the display side:
`effectiveDims`, `elementCount`, `needsSummary`, `overCharBudget`, `summaryForm`,
`ind2sub` and `subscriptLabel` each have exactly one definition and every consumer
imports it, and Phase 6's temporary module-local `needsPageSummary` was folded into
the shared `needsSummary` by Phase 7 with no copy left behind. The duplication was
on the *write* side and predated the phases: two `Matrix(...)` writers, both
widened to rank 3 by Phase 6 in ignorance of each other — that is defect 19, now
one shared `XmlUtils.formatMatrixSerial`. Two copies survive, both older:

- `MatParser.transposeFromColMajor` (`:152`) is body-identical to
  `XmlUtils.transposeFromColumnMajorND`, introduced by commit `947e879`. A
  mechanical call swap, left alone only because it is outside this sweep's blast
  radius and its two copies currently agree.
- `BinarySlddParser.parseDims` (`:73-75`) reimplements the trailing-singleton rule
  that `DisplayConvention.effectiveDims` (`:47-49`) owns, verbatim. Not a
  mechanical swap — it is also a string parser, handling `''`, `'junk'` and
  negatives — but it is two copies of one MATLAB rule and they can drift.
  Recorded rather than refactored, since consolidating it means a parser importing
  a display module.

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
'X' are not supported in the dictionary." Neither can a `.slx` model workspace:
`assignin` fails with "Creating an array of Simulink data or data type objects in
the model workspace is not allowed." So the `.sldd` object-array expansion code is
unreachable from any MATLAB-authored file, and object-array parity is a **`.mat`
question only** — `cases.mat` is the one artifact that holds all four arrays.

Two further R2027a facts Phase 2 established, both of which change what a test may
assume:

- **`isobject("world")` is true.** A `string` reports as an object, and
  `properties()` then interprets the string's *contents* as a class name. Anything
  walking properties must exclude `isstring`.
- **`obj.Value` on a nonscalar Simulink data array silently returns element 1**
  rather than erroring. So an object array has no meaningful array-level property
  value, and recording one would be a lie dressed as truth. Per-element truth
  (`linearSubs`/`linearValues`) is the only honest form.

## Defects found by asking MATLAB to read what we write

Every check before this one round-tripped through our OWN reader, which is
self-consistency and not truth — and that is exactly how defect 19 (a `Matrix()` body
MATLAB discards as an empty 1x0) and defect 22 (a rank-3 header it discards the same
way) each survived three verification passes. `probe_writeback.mjs` /
`probe_writeback.m` close that hole from the other side: the JS half takes a dictionary
MATLAB wrote, replaces one entry's value with OUR serialization of it — after a real
`setProperty` edit, where the case is about editing — and the MATLAB half opens each
spliced file with `Simulink.data.dictionary.open` and compares against the untouched
original. Its last line is `WRITEBACK FAILURES n of m`, and zero is the only acceptable
result.

Currently **0 of 54**, over nine batches: `rich` (thirteen rank-3 kinds), `nested` (the
same value in six placements), `typed` (nine typed and char shapes), `char` (six char
shapes), `charedit` (seven retypes through the editor), `complex` (two), `edit` (three
entry edits), `paramedit` (three object-property edits), `literal` (five hand-written
`_value` spellings, to pin the grammar with our writer out of the loop). Five controls
re-stringify each source dictionary untouched: if MATLAB cannot read one of those, the
probe's own JSON handling is at fault and no verdict beside it means anything.

Two things the gate itself needed before its verdicts meant anything, both worth
recording because each let it pass while testing nothing:

- **`deepMark`.** `_markModified` walks UP the chain and never down, and an unmodified
  node replays its `_rawInput` verbatim. So marking a container left every field and
  element byte-copied out of the source file, and the writer was never asked about them
  — the `nested`, `typed` and `complex` batches were all passing on a byte copy. (The
  `rich` batch was immune: its whole value is one cdata built from the live tree.)
- **A recursive `deepsig`.** MATLAB's `isequal` is NUMERIC, so it cannot see a field
  demoted from `single` to `double`. Negative-controlled by hand-demoting `sTyped`'s
  fields and confirming the gate then fails.

23. **An array-valued typed field or element writes `[object Object]` into the XML.**
    Found by `probe_typed_shapes.m`, which asked where MATLAB puts a typed literal.
    MATLAB spells such a vector as ONE literal for the whole array —
    `{"_type": "int32", "_value": "[1, 2]"}` — at the top level, in a struct field and
    in a cell element alike, never as a JSON list of per-element literals. The list is
    what mapping `serializeValue` over the children produces, since each child needs its
    own tag, and it is not merely an unusual spelling: `serializeValue` is shared with
    the XML channel, where `DataNode.serializePropertyXml` `String()`-joined the objects
    and wrote `Class="double" Dimension="1*2">[object Object] [object Object]` for an
    int32 struct field — a property carrying no numbers at all. Corrupt, not lossy.
    `_syncArraySerial` has always had the rule right for the edit path; only the
    no-serial path (a value that reached us from a `.mat` or `.slx` rather than from a
    text dictionary) fell through to the children. Fixed in `a318f7a` by giving
    `_serializeArray` the same rule, so the per-child list is reserved for the classes
    the bare JSON form can carry.

24. **Complex has no literal spelling at ANY shape, not just rank >= 3.** Defect 22
    framed the cdata stream as a rank rule. It is not: MATLAB's own text dictionary
    stores a complex SCALAR and a complex VECTOR as MAT byte streams too —
    `cases.sldd`'s `cplxScalar` and `cplxVec` are both streams. We emitted
    `{"_type": "cdata", "_value": "3+4i"}`, which is the BINARY dictionary's plain-text
    form for the same property, and MATLAB reads that out of a *text* dictionary as an
    empty 1x0 double: the same silent disappearance as defect 19, from the same cause —
    a spelling borrowed from the format next door. Fixed in `a318f7a`:
    `serializeValue` takes the stream branch for complex at every rank, and the output
    is byte-identical to MATLAB's own bytes for both entries. The XML channel was and
    remains correct — `_serializeTypedPropertyXml` discriminates on `isMatCdata` and
    writes the `Class="double" IsComplex="1"` property from the stream — so this was
    text-only, which is why the binary artifact could not see it.

25. **A char array's SHAPE is lost, scrambled, or invented, in every channel a char
    travels through.** Every char in the corpus was a row vector (`charStr` 1x4,
    `longChar` 1x300, `hugeChar` 1x1500), so no channel had ever been asked the shape
    question for this class. `probe_char_shape.m` asked it — a 2x2, a 2x3, a 3x1 column,
    an empty, a 2x3x2 and a numeric control, written to both dictionary flavours — and
    MATLAB turned out to have TWO spellings, neither of them ours:

    - **text `.sldd`**: a 1xN row is a bare JSON string (`"it's"`), an empty char is
      `""`, and any other rank-2 shape is
      `{"_type": "mxchar", "_value": "Matrix(2,2)\n[[97, 98]; [99, 100]]"}` — character
      CODES, one bracketed group per ROW. A 3x1 column is a header over a FLAT body,
      `Matrix(3,1)\n[97, 98, 99]`, exactly as `formatMatrixSerial` spells a numeric
      column. Rank >= 3 falls back to a cdata MAT stream, as every class does there.
    - **binary / `.slx`**: `<P Class="char" Dimension="2*2">acbd</P>`, the text
      column-major; a 1xN row and an empty char carry NO `Dimension` at all.

    We read neither. The `Dimension=` was ignored at all three sites that consumed it
    and the mxchar envelope was unknown, so MATLAB's own 2x2 came back as a 1x1 char
    holding `acbd` — the shape gone AND the characters in an order nobody had typed. On
    the way out, a char field of a struct went through the generic typed-value path and
    became `Class="mxchar" Dimension="2*2">97 99 98 100`: a class MATLAB does not have,
    holding numbers where its characters were. Both are `[object Object]`-grade output,
    not churn.

    The fix is one invariant rather than four special cases: a char is ONE
    `_kind: 'scalar'`, `_scalarType: 'char'` node whose `_scalarValue` holds the whole
    text in MATLAB's own column-major storage order, with the real extents on `_dims`.
    So `['ab'; 'cd']` stores as `'acbd'`. That is already what a `.mat` char payload
    carries (`MatParser` deliberately does not transpose it, and `MatWriter.charBody`
    says so) and what the XML body carries, so the channels differ only in how they
    SPELL a shape they now share. One rule decides that —
    `charNeedsShape(dims) = !(dims.length <= 2 && dims[0] === 1)`, the char twin of
    defect 21's row-vector rule — and it is read by the binary reader, the text writer
    and the XML writer alike. `charCodesRowMajor` / `charTextFromCodes` /
    `formatMxCharSerial` beside it in `XmlUtils` are the whole of the mxchar spelling,
    in one place.

    **Eight channels had to be fixed, not one**, and the last three were only visible
    after the first five were right:

    1. the text `.sldd` reader (the mxchar envelope, previously unknown);
    2. the binary/XML reader (the `Dimension=` attribute, previously ignored);
    3. the text writer (`mxchar` for a shaped char, bare string for a row);
    4. the XML writer (`Class="char" Dimension="…"`, never `Class="mxchar"`);
    5. the display, which showed the 12-character storage of a 2x3x2 as one quoted
       string — the storage, not the value — and now summarizes as `<2x3x2 char>`;
    6. the `.mat` snapshot, whose `dimensions` feed `MatWriter`;
    7. **the public `dims` accessor**, which was the only channel still disagreeing with
       MATLAB's `size()` after the writers were right: the bare-string channel leaves
       `_dims` at `[1,1]` however long the text is, so a consumer asking for the 1x4
       `'it''s'` was told `1x1`, and an empty char claimed one character where there are
       none. A char's extents now come from one place, `_textDims`, which every channel
       reads (empty -> `[0,0]`; `_dims` when it accounts for every character; else
       `[1, text.length]`);
    8. **the edit path**, which had no file to compare against and was still wrong after
       everything above. The table shows a 2x2 char as `['ab'; 'cd']` and seeds its
       editor with that text, so committing it unchanged must be a no-op — and it was
       not: `tokenizeStrings` discarded WHICH quote a row had used, so the display's own
       literal read back as a string array and the entry was silently retyped
       char -> string and reshaped 2x2 -> 2x1.

    Channel 8 was fixed at the parser, against MATLAB rather than against our reader.
    `probe_char_shape.m`'s LITERALS section `eval`s eleven spellings and prints the class,
    size and column-major text of each, including the ones MATLAB refuses, and all eleven
    now agree with `MatlabValueParser`: **the quote decides the class.** `['ab'; 'cd']` is
    a 2x2 char and `["ab"; "cd"]` is a 2x1 string; ANY double-quoted piece promotes the
    whole literal to string; `['a', 'b']` is a 1x2 char, because pieces on one row
    concatenate horizontally; `['ab'; 'c']` is a MATLAB *error* (unequal row lengths) and
    is refused here too; `['']` is a 0x0 char.

    Pinned by `test/charShape.test.ts` (53 tests) against MATLAB's own bytes in both
    flavours — byte-identity per shape per channel, the two flavours converging on
    identical nodes, `charNeedsShape` directly, and the commit round trip — plus the
    placement half in `typedShapes.test.ts` and the parser half in
    `matlabValueParser.test.ts`, where three old expectations had asserted that a
    single-quoted bracketed list is a string array; MATLAB's probe proved the tests wrong
    rather than the code, and they were rewritten. Gate: all six `char` shapes and all
    seven `charedit` retypes PASS, including the flatten (`['ab';'cd']` -> `'hello'`, the
    mxchar envelope having to disappear again) and the concat (`['ab' 'cd']` -> `'abcd'`).

26. **`ParameterNode._adoptValueNode` wrote our own intermediate spelling straight to
    disk, bypassing the writer.** The adopted node was left unmodified, and an
    unmodified `MatlabVariableNode` replays its `_rawInput`. That replay is right for a
    value read off disk — it is byte-for-byte round-trip fidelity — but for a value we
    just synthesised from what the user typed it emits our intermediate without ever
    consulting the writer, and two of those intermediates are spellings MATLAB destroys:

        setProperty('Value', '3+4i')       -> {_type: 'cdata', _value: '3+4i'}    (defect 24)
        setProperty('Value', '[1 2; 3 4]') -> Matrix(2,2)\n[1, 2]\n[3, 4]         (defect 19)

    Both read back out of a text dictionary as an empty 1x0 double. So the two most
    ordinary Parameter edits there are — type a complex scalar, type a matrix — were
    lost on the first save, while the writer had been emitting the correct form for both
    all along; it simply was not being reached. Fixed in `a318f7a` by marking an edited
    value Modified, which is also just true of it. This is the one path every other
    batch misses: they edit an ENTRY, and `paramedit` edits an object PROPERTY.

**Typed-scalar literals: the same churn, one level down.** `_serializeScalar` wrote
`formatMatlabNum`'s bare number where MATLAB writes a class suffix inside a `_value`
body — `7U` for a uint8, `3.14159274F` for a single, bare for a signed integer, a forced
`.0` for a double. Measured across ~30 MATLAB-written scalars in `cases.sldd`; it is
exactly `formatNumLiteral`'s rule, which the ARRAY path already used, so the same value
spelled itself two ways depending on whether it had siblings. Churn rather than loss —
the `_type` tag carries the class — and now consistent, from one helper.

### The binary channel: asking MATLAB to read the XML we write

Everything above was measured on the TEXT dictionary, whose `_value` is a JSON literal.
The compressed-binary flavour is a different writer over a different grammar — an XML
chunk inside a zip — and it had never been read back by MATLAB at all. The fidelity
suite's one write-back check reopened `params.sldd` after a scalar string edit; nothing
else. So `probe_writeback_bin.mjs` / `probe_writeback_bin.m` ask the same question of that
channel, with one structural difference from the text gate that decides the whole shape of
the probe: the text gate splices OUR serialization of ONE entry into a copy of MATLAB's
file, but `serializeBinarySldd` rebuilds the WHOLE package — every entry's XML, the
DataSource header, the dictionary object, the zip. One rebuilt file therefore carries every
entry at once, and the manifest lists each entry as its own case so a failure names the
value rather than the file.

Currently **0 of 101** over two batches: `rebuild` (every entry of every MATLAB-authored
binary dictionary in the corpus — 94 entries over `char_binary`, `typed_binary`,
`nd_binary`, `nd_complex` and `cases.sldd`, each node `deepMark`ed so the writer is asked
about it rather than replaying `_rawInput`) and `edit` (7 consumer edits: an N-D numeric,
cell and struct element, a char retype, a char no-op, a complex scalar, and a matrix typed
into a `Simulink.Parameter` `Value`). Ten controls, two per source file:
`control_copy_*` hands MATLAB the bytes it wrote, and `control_zip_*` hands back MATLAB's
own `chunk0.xml` repacked by `fflate` — so a zip we build is proved readable independently
of anything we put inside it. All ten OK.

**`fullsig` — the comparison, not the probe, was the limiting factor.** The text gate's
`deepsig` compared class and size to the leaf, which is enough for a struct and useless
for an object: `aVariant` PASSed while carrying nothing, because both sides reported
`Simulink.VariantVariable [1 1]` and neither side's *contents* were read. `fullsig` in
`wbcompare.m` walks to every leaf spelling class, size, complexity and exact value —
integers in full digits, floats at `%.17g`, char in column-major order, objects through
`properties()`, with `formattedDisplayText(v, 'SuppressMarkup', true)` as the last resort
for a class that exposes no readable property. That last resort is what turned defect 28
from a vacuous PASS into `2 choices` vs `0 choices`. Re-running the TEXT gate under
`fullsig` keeps it at **0 of 54**, so the stricter comparison found nothing there — the
text channel was as green as it had claimed.

27. **A 64-bit integer one level down is written `Class="char"`.** `typed_binary.sldd`'s
    `sTyped` is MATLAB's own struct with a `uint64` array field, and the gate measured
    `d:uint64[1 2]=7,8` going out and `d:char[1 3]='7 8'` coming back — the class gone
    and the value now a row of digit characters. `BinarySlddParser.isNumericClass` (and
    `parseCellElement`'s duplicate copy of the same class list) omitted `int64` and
    `uint64`, so `parseTypedValue` fell through to `default: return text || ''` and handed
    the writer a bare string, which it could only spell as char. The ENTRY-level path never
    had the gap, which is why `s_uint64` and `maxU64` were right at the top level and the
    same class was wrong one level down — the exact shape of defect 15, in a different
    parser. Fixed by giving `isNumericClass` the two classes, routing bodies through one
    `numericBody(text, type)` helper, and adding `case 'int64': case 'uint64':` to
    `parseTypedValue`'s switch; `transposeColumnMajor` was generified over `T` on the way,
    since a 64-bit body is no longer a `number[]`.

28. **An object's `saveobj` payload was destroyed, and a property MATLAB never wrote grew
    beside it.** When a class serializes through `saveobj`, MATLAB writes its whole state
    as ONE UNNAMED `<P Source="saveobj" PropertyType="any" Class="struct">`. A property bag
    needs a key, and the reader keyed it off an absent `@_Name` — so it landed under the
    literal string `'undefined'`, and the writer emitted `Name="undefined"`. MATLAB's
    `loadobj` then finds no envelope and builds an EMPTY object: `cases.sldd`'s `aVariant`
    reopened as a `Simulink.VariantVariable` with **0 choices where MATLAB wrote 2**, its
    whole `V == 1 / V == 2` condition table gone. Compounding it, the individual properties
    are not siblings of an envelope, so `VariantVariableNode` read no `Specification`,
    substituted its own `''` default, and wrote that back as a real
    `<P Name="Specification" Class="char"/>` — an empty char standing in for a value MATLAB
    keeps inside the envelope.

    Only four values in the corpus take an envelope: `aVariant` (a `struct` payload) and
    `strArray` / `strMat` / `strScalar` (a `cell` payload, `Class="string"`). The three
    string ones already round-tripped byte-identically through
    `MatlabVariableNode._serializeStringXml`, so only the VariantVariable ever reached
    `parseStructElement`. Fixed on both sides of the bag: the reader files the envelope
    under a reserved key `XmlUtils.SAVEOBJ_KEY` (`'_saveobj'`), `DataNode.pxAttrs` turns
    that key back into `Source="saveobj" PropertyType="any"` for every `<P>` this file
    writes, `DataNode._mergeProps` drops an EMPTY property override under an envelope (a
    default, not an edit — a non-empty one is still written, since discarding a real edit
    is worse), and `ObjectNode` gives the reserved key no tree row while re-carrying it
    into every rebuilt bag FIRST, because it has no child to be rebuilt from.

    **Decision: the payload is preserved VERBATIM under the reserved key; its fields are
    not lifted into the property bag.** The two channels genuinely disagree about how a
    `VariantVariable` is spelled — binary carries a saveobj struct holding a 2x1
    `Condition`/`Value` struct, while text carries a flat `Bank`/`Choices`/`Specification`
    bag whose `Choices` is a nested `simulink.variant.Variable` with an `fChoices` field.
    Translating between the two is a question no artifact in the corpus answers, and
    guessing it would put an invented spelling into a file MATLAB reads. Preserving the
    bytes costs the tree one hidden row and loses nothing.

    The reserved-key rule is `name.charAt(0) === '_'`, tested rather than the constant: a
    MATLAB identifier cannot begin with an underscore, so a reserved key can never collide
    with or hide a real property, and the display and edit paths can filter on that rule
    alone without knowing which reserved keys exist.

29. **64-bit integers lost their exactness one step before the file.** MATLAB's
    `int64`/`uint64` range is wider than a double's exact one BY CONSTRUCTION, and every
    re-parse point in the write path funnelled through `parseFloat`. So `i64Unsafe`
    (2^53 + 1 = 9007199254740993, which MATLAB itself wrote) came back
    **9007199254740992** — in range, silently off by one — and `maxU64` went out as
    `18446744073709552000U` after `BinarySlddParser` had read it exactly.

    Fixed by carrying such a value as canonical decimal TEXT from reader to writer. The
    test is the ROUND TRIP and not the class, so the rule is narrow: a token that survives
    `String(Number(t))` unchanged stays a `number` (`XmlUtils.parseExactNum`), and only one
    that does not takes the text form. `42U` is still `42`, `'+7'` and `'007'` canonicalize
    to `7`, and no currently-passing path changes behaviour. It fits because
    `_scalarValue: unknown`, `_elements: unknown[]` and `MatVariable.value: unknown` were
    already permissive. Six functions were the whole of it: `DataNode._numToken` (a single
    re-parse point replacing `parseMatlabNum` at four call sites) and `_parseMatrixNums`,
    `MatlabVariableNode.parseMatrixValue` / `parseTypedScalar` / `parseTypedVector`, and
    `MatWriter.toBigInt` / `realPart`, where `Number(x) || 0` had been rounding the token
    back into a double on the way into the byte stream.

30. **An out-of-range token does not clamp — it abandons the REST of the body.** The
    interesting half of defect 29, and the reason the rounding was corruption rather than a
    nit. `u64Vec` is `[18446744073709551615, 1, 0]`; written as
    `18446744073709552000 1 0`, whose first token is now OUT of uint64 range, MATLAB read
    it back as **`[18446744073709551615, 0, 0]`** — a perfectly representable `1` destroyed
    by its NEIGHBOUR's overflow. `i64Vec`'s `[intmax, intmin, -1]` came back
    `[intmax, 0, 0]` the same way, losing two of three elements to one bad token.

    A SCALAR hides this: `maxU64` PASSed before the fix, because MATLAB saturates a lone
    out-of-range token to `intmax('uint64')`, which for that one value happens to be the
    right answer. So the scalar was correct by luck of saturation while the array it is an
    element of was two-thirds destroyed — which is why the regression tests assert whole
    array bodies and not single elements.

Defects 27-30 are pinned by `test/binaryWriteBackGate.test.ts` (15 tests), which rebuilds
the same chunks the probe hands MATLAB and asserts the attributes and digits directly, so a
regression fails `npm test` rather than waiting for the next MATLAB run. One existing test
had to be corrected rather than kept: `crossPhaseShape.test.ts`'s 64-bit case had
deliberately pinned the KNOWN-WRONG `18446744073709552000U` — the sweep that added it owned
only the CLASS half of the answer — and now pins MATLAB's own bytes.

### Divergences measured and accepted

Each of these is a place where our output or behaviour differs from MATLAB's, was
measured rather than inferred, and is recorded here instead of fixed. None loses data;
the reason for leaving each one is stated.

- **`_mw_element_type` is stamped on every wrapper we write; MATLAB stamps only the
  OUTERMOST wrapper of an entry's value.** Five examples across `cases.sldd`,
  `typed_text.sldd` and `nd_nested.sldd` and no counter-example: not on a nested cell
  (`cellNest`'s two inner levels), not on a nested struct (`structNest.a`,
  `ndTwoLevel.inner`), not on a wrapper held as an object property (`aBus`'s
  `Elements_internal`, `aVariant`'s `fChoices`). MATLAB accepts the extra key — the
  gate's `typed/cTyped` reopens `isequal` with the same class at every leaf — so this is
  diff churn of defect 21's kind. Left because the key is written from a dozen sites and
  none of them knows whether it is the outermost. Pinned in `typedShapes.test.ts`.
- **A 1x1 cell ELEMENT gains a `Dimension="1*1"` MATLAB omits.** MATLAB's own binary
  `cases.sldd` writes `<Element Class="cell">` for the innermost 1x1 cell of `cellNest`
  while stating every other extent it uses; our writer always joins the dims. Churn, of
  the same shape as defect 21 — and now **measured harmless** rather than assumed to be:
  `probe_writeback_bin` rebuilds the XML of every entry of that dictionary, this attribute
  included, and MATLAB reads `cellNest` back as
  `cell[1 2]{double=1, cell[1 2]{double=2, cell[1 1]{double=3}}}` under `fullsig` — the
  same class, size and value at every leaf. Verifying this was the open task the bullet
  named; the gate closed it.

  Diffed against MATLAB's chunk, this is now the ONE site in the whole file: exactly one
  `Dimension="1*1"` in our rebuild against zero in MATLAB's. The bullet used to name
  `struct1x3` and the `<P Source="saveobj" ... Class="cell">` string envelope as well, and
  neither still adds one — a struct element carries no `Class` or `Dimension` at all, and
  all three saveobj cell envelopes come back byte-identical (defect 28).
- **A `Simulink.Parameter`'s `Dimensions` property goes stale when its Value changes
  shape.** Measured on `cases.sldd`: `aParam` carries `Dimensions: [1,1]` beside a
  scalar `Value` of 5, and after `setProperty('Value', '[1 2; 3 4]')` the serialized
  value is the 2x2 matrix literal while `Dimensions` is still `[1,1]`. MATLAB derives
  that property from the value, so it cannot disagree there. Left because deriving it
  means deciding what `Dimensions: -1` (MATLAB's own default, which `createDefault`
  writes) should become, and no MATLAB-authored artifact in the corpus pins that.
- **`Simulink.Parameter.Value` coerces ALL text to a 1x1 `string`; we keep `char`.**
  Measured directly (R2027a): `p.Value = 'abc'` reports `string`, size `[1 1]`, and
  `p.Value = ['ab'; 'cd']` reports `string("acbd")`, size `[1 1]` — MATLAB flattens
  column-major itself. Plain dictionary ENTRIES keep char and its shape, which is why
  defect 25 lives at the entry and there is no shape to keep at this property. Left
  because coercing would retype every char Parameter in the corpus. This measurement
  also killed a change: an mxchar arm had been added to `ParameterNode` on the
  assumption a char matrix belonged there, and MATLAB's answer removed it.
- **`Simulink.Parameter.Value` rejects a string ARRAY; we accept one.**
  `p.Value = ["ab"; "cd"]` raises `Simulink:Data:Param_Invalid_Value`, the same error as
  a cell — the accepted set is a string SCALAR. We write an `_array_type: 'String'`
  wrapper. Refusing it is a one-line change, left because the corpus has no
  MATLAB-authored counter-example to pin a reader against, and because defect 25's
  parser change means a user typing `['ab'; 'cd']` no longer reaches that arm at all;
  only the genuinely double-quoted spelling does.
- **`MatlabValueParser` rejects MATLAB's typed constructors.** `int16(500)`,
  `single(1.5)`, `uint8(7)` and `string("a")` all parse to `null`, so a user cannot type
  the class-changing form of a value the reader displays and the writer can spell. The
  bare literals (`true`, `Inf`, `3+4i`, `[1 2; 3 4]`, `['ab'; 'cd']`) are all accepted.
  A gap in the edit surface rather than a divergence in output.
- **`setProperty` silently accepts an unknown property name.** `setProperty('NoSuchThing',
  'zzz')` returns `true` and creates an own property on the node; nothing is serialized
  and nothing is marked modified, so the value simply vanishes on the next read. It
  should be an error object like the others. Falls out of `DataNode.setProperty`'s
  `typeof current` dispatch, where `undefined` takes the string branch.
- **An empty char reports `[0,0]` from a stored `_dims` of `[1,1]`.** MATLAB's own size
  for `''` is `[0,0]` and that is what the accessor, the display and the writers all
  report, but it is DERIVED by `_textDims` rather than stored: the bare-JSON-string
  channel gives no shape at all, so `_dims` is left at `[1,1]`. Anything reading the
  private field instead of the accessor will disagree with MATLAB.

## Defects found by reversing the MCOS `string` payload

`probe_string.m` asked one question the corpus could not answer — how does MATLAB store a
`string` in a `.mat`? — and the answer is written up in `STRING_MCOS.md`, verified in both
directions: the whole `uint64` word list predicted from MATLAB's own `size`, `strlength`
and text, then compared word for word against the bytes in the file (11 of 11 cases match).
Two separate things were wrong and only one of them needs the text decoded.

31. **A `string` array reported `[1,1]` with a blank Data Type.** `cases.mat`'s `strArray`
    is 1x3 and `strMat` is 2x3, and both displayed `<1x1 string>`. The cause is that a
    `string` array is ONE MCOS object however many elements it holds — unlike a 1x3
    `Simulink.Parameter`, which is three — so the object handle a named variable carries
    says `[1,1]` for every shape, and the real extents are inside the object's own payload
    cell. That cell is reached through a metadata segment `McosParser.parseMetaTable`
    never read: object-row **word3** indexes a TYPE-1 block segment at `[w[3], w[4])`,
    alongside the type-2 segment at `[w[5], w[6])` it already parsed. A `string` has
    exactly one type-1 property, named `"any"`, flag 1, whose heap index is the payload —
    the binary form of the text dictionary's `saveobj` envelope (defect 28).

    `payload cell = objId + 1` fits every file whose only objects are strings and is NOT
    the rule: `test/fixtures/strings_mixed.mat` has the string as object 4 with its
    payload at `cells[9]`, because the `Simulink.Parameter` ahead of it took the first
    seven heap slots. A reader built on that coincidence reads the Parameter's `CoderInfo`
    as text, so the fixture is committed specifically to fail such a reader.

    Second, `string` is a genuine MATLAB **data type**, not just a class name, so it is the
    one opaque className that belongs in the DataType column. Every other one
    (`Simulink.Parameter`) is a Class and stays suppressed.

    Both halves land whatever happens to the text: the extents are small integers. Pinned
    by `test/matStringOpaque.test.ts` (31 tests, over all eleven probe cases plus the two
    corpus entries) and by the unit pair in `matlabVariableNode.test.ts`.

**The text needed one thing more, and it was not the layout.**
`MatParser.readNumericArray` read a 64-bit integer through
`Number(view.getBigUint64(...))`, and a `uint64` holding four packed UTF-16 code units is
routinely outside a double's exact range: 11 of the 154 payload words across the eleven
cases are not exactly representable, and because code unit 3 sits in the HIGH bits the
rounding lands on the LOW bits — unit 0, the FIRST character of every group. Decoded
straight out of the words that reader gave us, **6 of 11 cases came out wrong**, each as
the plausible mojibake a guessed layout would produce (`"café"` → `` "`afé" ``). Exact
64-bit `.mat` reads were therefore a hard prerequisite; **defect 32 below removed it**, and
**defect 33 is the text** (both are listed after it, in the order they were done).

## Defects found by asking a `.mat` for a 64-bit integer

32. **`.mat` was the last channel that could not read `intmax('uint64')`.** Defects 29 and
    30 fixed the text and binary dictionaries by carrying an int64/uint64 a double cannot
    hold as its own decimal TEXT (`XmlUtils.parseExactNum`), from reader to writer.
    `MatParser.readNumericArray` kept `Number(view.getBigInt64(...))`, so the same nine
    values in the same corpus displayed differently depending on which of MATLAB's four
    files you opened:

    | | text / binary / slx | mat |
    |---|---|---|
    | `maxU64` | 18446744073709551615 | 18446744073709552000 |
    | `max_int64` | 9223372036854775807 | 9223372036854776000 |
    | `i64Unsafe` | 9007199254740993 | 9007199254740992 |

    The `.mat` column is not merely rounded: 18446744073709552000 is **outside** uint64
    range, the value MATLAB's own reader refuses rather than clamps (defect 29's own
    finding). `i64Unsafe` is 2^53 + 1 — the first integer a double misses, and the reason
    the test is a round trip and not a range check.

    Fixed by `XmlUtils.exactInt(bigint)`, the binary twin of `parseExactNum`: same
    `number | string` result, same rule (`Number.isSafeInteger` decides), so the two
    readers cannot disagree about which values take the text form and no value a double
    does hold changes representation. `readNumericArray` returns `(number | string)[]`.

    **The representation was already chosen; this defect only extends it.** The plan for
    this task (PLAN.md Task 10.1) proposed a `bigint` and a `parseMatlabInt` returning one.
    That would have been a SECOND exact form beside the decimal string the `.sldd` readers,
    `DataNode`, `MatlabVariableNode` and `MatWriter` already speak — every display path
    goes through `formatMatlabNum`, which is `String()`, so a string is already exact
    everywhere a number is. Tasks 10.1 and 10.3 are therefore satisfied as written, in the
    other representation, and only the `.mat` read path was outstanding.

    Three consumers had to widen, and each was a real hole, not a type-checker complaint:

    - `McosParser.resolveValue` returned a numeric property only on
      `typeof val === 'number'`, so a scalar int64 property arriving as a token would have
      been **dropped from the object entirely** — worse than the rounding.
    - `MatWriter.realPart`/`imagPart` put `{re, im}` through `Number(...) || 0`, which
      would round the real part of a complex int64 one step after the reader kept it exact.
      Both now go through a shared `exactPart`.
    - `isExactToken` was private to `MatWriter`; it is now the single exported definition
      in `XmlUtils`, so the readers, the MCOS resolver and the byte packer share one rule
      for what counts as exact.

    Pinned by `test/mat64.test.ts` (10 tests): every 64-bit entry in the corpus asserted
    against `truth.json`'s `mat2str` **in all four channels at once** — the point being
    that a value which survives `.sldd` and dies in `.mat` is exactly this bug — plus the
    element rows of both vectors (a summary line and its children are formatted by
    different code), `exactInt`'s boundary behaviour, and a byte-level round trip through
    `encodeMatVariable` that checks `maxU64` leaves as the eight bytes MATLAB wrote.

## Defects found by decoding the `string` payload's text

33. **Two of the four formats could not show a string's characters at all.** The same
    string, authored once in MATLAB and saved four ways, read back two different ways:

    | | text / binary `.sldd` | `.mat` / `.slx` |
    |---|---|---|
    | `strScalar` | `"world"` | `<1x1 string>` |
    | `strArray` | `["a" "bb" "ccc"]` | `<1x3 string>` (`<1x1 string>` before defect 31) |
    | `strMat` | `["a" "bb" "ccc"; "d" "ee" "fff"]` | `<2x3 string>` |
    | child rows | one per element, with its text | none |

    So the format a user happened to open decided whether they could see their own value,
    and an MCOS-held string had no child rows at any size. A string PROPERTY was worse: an
    unrecoverable-value sentinel, `<not available>`, in place of the text.

    Fixed by decoding the payload cell per the layout `STRING_MCOS.md` records —
    `McosParser.stringPayload` returns MATLAB's own `size()` and one text element per
    entry, column-major — and by handing that to the node layer as the state a string array
    already carries everywhere else (`_kind = 'string'`, `_dims`, `_elements`), so the
    display, the child rows, the subscript labels and the icon all come from the one
    existing path rather than from new MCOS-specific code. All four formats now produce
    byte-identical display values, child names and child values.

    Four details are the substance of it, and each is a way to be wrong that looks right:

    - **The code units are one continuous stream.** An element does not start a fresh
      word: `"alpha" "beta" "gamma"` packs as `alph | abet | agam | ma__`. A decoder that
      restarted per element reads `"alph"`, `"abet"`, `"agam"`.
    - **The count is CODE UNITS, not characters.** `"a😀b"` counts 4 because the emoji is
      a surrogate pair, and MATLAB's own `strlength` says 4 too. Walking characters
      desynchronizes the whole stream after the first astral character.
    - **`""` and `missing` are told apart by the count word** — 0 versus all ones — not by
      absence, and `strings(0,0)` writes no count words at all. Three distinct empties.
    - **Exact 64-bit reads (defect 32) are load-bearing.** A count or data word arrives as
      a decimal TOKEN when a double cannot hold it, which is the common case for a word
      packing four characters. Every read goes through `payloadWord`, which takes a number
      or a token; `typeof word === 'number'` alone would skip exactly those words.

    **Partial recovery is per element, and the sentinel stays** for a payload whose words
    do not account for the text: the shape is still reported (the extents are small
    integers and survive conditions the packed words do not), with no characters invented.
    `<not available>` is now unreachable in the corpus rather than the corpus's answer.

    Three display decisions, all following MATLAB where MATLAB has a spelling:

    - **`missing` displays as `<missing>`, unquoted** — MATLAB's own `disp` spelling. The
      marker in `_elements` is `null`, not that text, because the real string whose
      characters are `<missing>` must still print quoted. Unquoted also means the angle
      brackets withhold the editor, which is right: no text a user can type is a `missing`.
    - **`strings(0,0)` displays as `[ ]`**, the convention's empty-value spelling, matching
      the empty numeric rather than emitting the bare `[]` the literal loop would produce.
      MATLAB prints nothing at all for it, so there is no spelling to match.
    - **A `string` gets the string icon in every format.** The icon is keyed on the MCOS
      class name, and `string` — the one opaque class that is a data type — had no entry,
      so the same array showed `wsString` out of a dictionary and the generic `wsDefault`
      out of a `.mat`.

    **A decoded string stays read-only, deliberately.** Nothing in this package writes a
    `.mat` MCOS subsystem: an opaque variable's bytes go back out verbatim. An accepted
    edit would update the node and change nothing in the file, so `valueEditable`,
    `canAddChild` and `canRemoveChild` all refuse, on the array and on its element rows,
    and `_setConstrainedValue` refuses as the second gate for a caller that skips the
    first. A decoded string is the first opaque node to have child rows at all and the
    first to display ordinary editable-looking text, so it is the first for which those
    gates matter — before it, no opaque node had a `_kind` that reached the vector case.

    Pinned by `test/matStringOpaque.test.ts` (31 tests): every element of all eleven probe
    cases against MATLAB's text AND against MATLAB's code units, the surrogate pair, the
    six cases the inexact read used to corrupt, column-major order, the subscript labels at
    ranks 1–3, the three empties, all four formats compared to each other and to
    `truth.json`, the `-v7` flavour, the read-only gates, and the string properties of
    `object_props.mat`'s two hand-authored classes.

## Defects found by walking the tree MATLAB describes

Phases 9–10 built the tier-1 suites: `loadTruth.ts` loads MATLAB's `truth.json` and
all four artifacts, `expect.ts` states the convention as a pure function of what
MATLAB reported, and `display.test.ts` / `structure.test.ts` put every corpus entry
in every format through it. 596 + 184 assertions, and the 24 skips are MATLAB's own
refusals, each titled with MATLAB's message — `Arrays of class 'Simulink.Parameter'
are not supported in the dictionary` for the object arrays in a `.sldd`, and the
model-workspace equivalent for the `.slx`. Not a skip list we chose; a skip list
MATLAB dictated.

**`linearElems` is why element rows became checkable at all.** `gen_truth.m` already
recorded `linearValues` — `formattedDisplayText` per element — but that is MATLAB's
COMMAND WINDOW format, not the table-cell convention: `1` for a logical where a cell
says `true`, `1.0000 + 2.0000i` where a cell says `1+2i`, `3     4` where a cell says
`[3 4]`, unquoted text for a string. Comparing a cell against the command window
would have failed for every one of those and proved nothing. So `linearElems` takes
the SAME measurements on element `k` that `truthOf` takes on a variable — class,
size, `iscomplex`, `isempty`, `disp`, `mat2str` — and an element is then just another
value that goes through the same `expectedDisplay()`. Which element is measured is
itself a rule (`elemSubject`): a cell row shows its CONTENT `v{k}`, a data-object row
shows `v(k).Value`, a struct row shows the 1x1 struct, everything else shows `v(k)` —
and `isstring` is tested before `isobject`, because `isobject("a")` is true and the
object branch would otherwise ask a string for a `Value`.

34. **An empty numeric read as 1x0 out of a text dictionary and 0x0 out of the other
    three.** MATLAB writes a bare `[]` for `[]`, and `size([])` is 0x0 — which the
    binary dictionary, the `.slx` and the `.mat` all reported. Only the text path
    said 1x0, because `parseTypedVector` set `_dims = [1, rawVal.length]`
    unconditionally. 1x0 is not a harmless off-by-one: it is the shape of
    `x=1; x(1)=[]`, a genuinely different value, and it is what
    `_updateArrayAfterRemove` produces. A stored `[]` has no removal behind it.
    Fixed by making the empty case `[0, 0]`. Pinned by
    `matlabVariableNode.test.ts` alongside the shape it must not be.

35. **`struct([])` displayed as `[0]`.** `{_type: 'struct', _value: '[]'}` is MATLAB's
    only text spelling for an empty struct, and it is the sole `_type: 'struct'` in
    the whole corpus. Dispatched on its leading `[`, it went to `parseTypedVector`,
    which read the empty literal as one element of value 0 — so a 0x0 struct
    presented as a 1x1 numeric vector containing zero. Fixed with a `parseEmptyStruct`
    arm ahead of the shape dispatch, building deliberately the same node
    `_createFromMatStruct` builds for the same value (scalar kind, `struct` class,
    null value, real extents), so `<0x0 struct>` comes out of the existing
    `displayValue` struct arm in all four channels and no empty case is added to it.
    A struct with FIELDS never arrives this way — MATLAB writes `_array_type: 'Struct'`
    for rank ≤ 2 and a cdata byte stream for rank ≥ 3 — so the guard is exact.

36. **A numeric matrix lists its element ROWS in storage order, not MATLAB's.**
    **Pinned, not fixed.** MATLAB linearizes column-major, so a 2x3 is
    (1,1) (2,1) (1,2) (2,2) (1,3) (2,3); the tree lists
    (1,1) (1,2) (1,3) (2,1) (2,2) (2,3), because `_elements` is row-major within each
    page and the child rows come out in `_elements` order. Cell, string, struct and
    object arrays are all column-major already, so this is one kind, and only at rank
    ≥ 2 with both leading extents > 1 — a vector's two orders coincide. The labels and
    the values are correct either way; it is the row ORDER that differs, so nothing is
    wrong on screen except the sequence.

    Not fixed because the fix is not local. Child order and storage order are the same
    list today, at roughly ten creation sites, and `_syncElementFromChild` recovers an
    element's index with `children.indexOf(child)` — so decoupling them means every
    writer learning the permutation too, on top of the paired transposes in
    `MatParser`, `BinarySlddParser`, `XmlUtils`, `MatWriter` and `DataNode`. That is a
    storage-layer change with a display-layer motive, and it is worth doing
    deliberately rather than as a parity fix.

    `structure.test.ts` asserts it EXACTLY and in BOTH directions: `listsInStorageOrder`
    classifies from MATLAB's own class and size (not from a list of entry names, so a
    new fixture is classified automatically), the storage-order arm compares against
    MATLAB's label list permuted by the page-preserving transpose, and the other arm
    compares against MATLAB's linear order untouched. The day this is fixed the test
    goes red and gets moved to the other arm, rather than quietly agreeing with
    whatever the model happens to do.

## Defects found by putting MATLAB's property list through the Property Inspector

Phase 11's `schemaProps.test.ts` asks a narrower question than `display.test.ts`: for
every property MATLAB's `properties()` lists on every object in the corpus, in every
format, does the Property Inspector show MATLAB's value? 168 assertions, no skips.
Five defects, all in the same shape — a property MATLAB reports that our sheet does
not, or reports differently.

The suite's premise had to be corrected first. The plan assumed an object's properties
were its child rows keyed by `name`; they are not, and no amount of tree-walking would
have found them (see *A property sheet is not a table cell* above). The property
surface is `toPIObject()`.

37. **`Simulink.Signal.DataType` never surfaced, in any format, though every format
    carried the key.** All four raw bags held `DataType: "single"` and the Data Type
    column and the PI row were blank for every Signal everywhere. `SignalNode` simply
    never read the key: it had no `DataType` field and no `dataType` getter, so
    `PropDataType` had nothing to read. Fixed on exactly `ParameterNode`'s terms — read
    both `DataType_internal` and `DataType` (a `.sldd` may store either spelling, which
    is why `BusNode` reads both), default to `'auto'` when absent because that is
    MATLAB's default rather than a missing value, and expose it through a `dataType`
    getter so the column and the row share one source. Display-only:
    `_getSerializedProperties` copies the on-disk bag, so the default is never written
    into a file that did not have it.

38. **Four `Simulink.Signal` defaults were wrong or missing whenever the text
    dictionary omitted the key.** The text `.sldd` omits default-valued properties;
    the binary, `.slx` and `.mat` channels write them explicitly. So the same object
    read four ways gave two answers:

    | | text `.sldd` | MATLAB |
    |---|---|---|
    | `Dimensions` | (empty) | `-1` |
    | `Complexity` | `real` | `auto` |
    | `SampleTime` | (empty) | `-1` |
    | `SamplingMode` | (empty) | `auto` |

    `Complexity` is the instructive one: the sheet was not blank, it was **confidently
    wrong**, because the shared `complexity` registry entry carries
    `Simulink.Parameter`'s default (`real`) and `Simulink.Signal`'s is `auto`. A
    per-class default is the whole mechanism the `$ref` override form exists for, so
    the fix is four `{ "$ref": ..., "default": ... }` entries in `signal.json` and no
    code. Defaults hydrate for display only and are never written back, so a minimal
    file stays minimal.

39. **`Simulink.LookupTable.BreakpointsSpecification` was absent from the sheet
    entirely** when the text dictionary omitted it — not blank, not defaulted, simply
    not a row. MATLAB reports `'Explicit values'`. Fixed by authoring the prop in the
    registry with that default and giving `lookupTable.json` a second group for it.

40. **`Simulink.VariantVariable` carries almost no property data in three of the four
    channels, and its choices are invisible in all four.** MATLAB's public property
    list is `Specification` and `Bank`, both empty in the corpus, so a new `bank`
    registry entry defaulting to `''` (defect 39's fix again) is what makes the suite
    green — and green here is a weaker statement than it looks. What is actually in the
    four channels:

    | | raw bag |
    |---|---|
    | text `.sldd` | `Bank`, `Specification`, and `Choices` as a nested `simulink.variant.Variable` holding a 1x2 `simulink.variant.Choice` array (`fValue`, `fVariantCondition`) |
    | binary `.sldd` | one undecoded `_saveobj` struct: `Choices` as a 2x1 `Condition`/`Value` struct, `Specification: []`, `Bank: []` |
    | `.slx` | `{}` |
    | `.mat` | `{}` |

    **Not fixed**, and three separate things are wrong. The binary dictionary leaves the
    whole object as `_saveobj` and leaks that internal key into the Property Inspector
    as a row of its own, so the object's real properties are reachable only by decoding
    it. The `.slx` and the `.mat` produce an empty bag — the object is there, named and
    classed, with nothing in it. And the choice table that MATLAB's own `disp` leads
    with (`V == 1 → 1`, `V == 2 → 2`) is present in two channels' bytes and displayed
    in none; even the text channel renders `Choices.fChoices` as empty. Parity does not
    catch it because MATLAB does not call `Choices` a property, so this is recorded from
    the raw bags rather than from a failing assertion.

41. **The schema Property Inspector spelled a numeric array `[1, 1]` where mat2str and
    every other surface spell `[1 1]`.** `Simulink.Parameter.Dimensions` therefore had
    a third spelling of one value: a table cell said `[1 1]`, a bus element's
    `PropDimensions` said `[1 1]`, and the schema-driven PI row said `[1, 1]`. Fixed in
    `formatSchemaValue` — a space join, the convention's array spelling. This changed
    the formatter's own published contract, so `schemaBridgeEdit.test.ts`'s assertion on
    `format([2, 3])` was updated with the reason inline rather than worked around.

**Two of these fixes had to be moved, and the reason is a convention worth keeping.**
Adding `bank` and `breakpointsSpecification` inside each class's `General` group turned
`piGeneralAllNodes.test.ts` red, correctly: the identity group is deliberately fixed at
`[Name, value-like, DataType, Kind, Class]` (plus `Description` where the class has
one), so that the first thing a user sees is the same five things for every class. A new
property goes in a group AFTER General — here a `Value Properties` group in each class
JSON — and the test that says so is doing its job.

## Defects found by asking MATLAB to reopen an edit

Phase 12 adds the one tier that can prove a write is *correct*. Every other tier reads a
file MATLAB authored; `writeback.live.test.ts` edits a value, serializes, and asks MATLAB
to reopen the result and report the value, its `size()` and its `class()`. The asymmetry
is the point: a value we write wrongly and then read back with the same wrong assumption
looks fine from inside, and four of the five defects below were invisible to every
in-process round trip in this repo.

Defect 46 came from the older `test/parity/fidelity/*` live assertions rather than from the
new file — they had existed for phases without ever being run against MATLAB, because the
gate skips when `DEX_MATLAB_CMD` is unset and CI never sets it. Running the whole suite with
MATLAB configured is therefore its own act, and belongs in the Phase 12 checklist beside the
new tier: `env DEX_MATLAB_CMD="..." npm test`. The same run surfaced two test-level faults
worth recording so they are not rediscovered as defects:

- `fidelitySmoke.test.ts` had no explicit timeout, so with MATLAB configured it reported
  vitest's 5s default as a failure instead of a verdict. Every live `it` needs its own
  timeout; there is no global one.
- `variable.fidelity.test.ts`'s `i16Scalar` case asserted `__class__: 'double'`, carrying a
  note that the editor could not preserve an integer class. `classAfterEdit` had lifted that
  limitation, and `MatlabVariable.md` documents the replacement rule — an int16 entry edited
  to `500` stays int16, matching MATLAB's own `v(:) = 500`. The stale expectation sat green
  in CI because the assertion it contradicted only runs with MATLAB. Triaged as category 2
  (the expectation mis-stated the convention) and corrected to `int16`.

42. **The 64-bit integer WRITE path rounded, so typing back the digits a cell was
    already showing stored a different number.** Defects 29/30 and Task 10.2 fixed the
    four *readers* — an integer no double can hold is carried as its own decimal text
    from the file to the display — and the write path never went through that machinery.
    A committed cell re-enters the model through `MatlabValueParser`, whose
    `Number(str)` put every literal back through a double:

    | entry | typed | stored |
    |---|---|---|
    | `maxU64` | `18446744073709551615` | `18446744073709552000U` |
    | `i64Unsafe` | `9007199254740993` | `9007199254740992` |
    | `u64Vec` | `[18446744073709551615 2 3]` | `[18446744073709552000U, 2U, 3U]` |

    And `18446744073709552000` is not merely rounded, it is **out of uint64 range** —
    MATLAB's reader abandons the rest of a body when it hits one, so `u64Vec`'s
    perfectly representable neighbours were destroyed by their neighbour's overflow.

    Fixed by routing `parseMatlabNumber` through the existing `XmlUtils.parseExactNum`
    *after* the strict literal gate, so the accept set cannot have widened, and by
    making the narrowing **class-aware**. That second half is the whole subtlety: the
    parser is class-BLIND (a bare `7` is always `'double'`), and only `int64`/`uint64`
    can carry an exact token. Under any other class the double IS the value, and MATLAB
    agrees — a bare decimal literal is a double in MATLAB, so `x = 18446744073709551615`
    stores the nearest double there too. Keeping the text under a double class would
    write a JSON **string** that reads back as the CHAR `'18446744073709551615'`. Hence
    `XmlUtils.exactForClass` on the entry path (whose class the node knows) and
    `MatlabValueParser.collapseExact` for the two class-blind consumers — a cell
    element, whose class comes from its own literal, and a `Simulink.Parameter.Value`,
    which has no class beside it to consult.

43. **`[true false true]` — MATLAB's own spelling of a logical array — was refused as an
    invalid expression, and the only accepted spelling silently retyped the entry.**
    `mat2str` prints a logical array that way and the corpus's `boolVec` cell displays
    exactly that, so a user who committed the text they were being shown got "Invalid
    MATLAB expression". The one literal that *was* accepted, `[1 0 1]`, changed the
    entry's class from logical to double and wrote a bare JSON array. This is the same
    invariant defects 25 and 42 broke: **a value's own displayed text must be acceptable
    input.**

    Fixed in `tokenizeNumbers`, which now takes `true`/`false` as elements and reports
    whether *every* element was one. Our behaviour now matches MATLAB in both spellings
    and in the mixed case, which is the part that makes the rule non-obvious:

    | literal | MATLAB | us |
    |---|---|---|
    | `[true false true]` | logical | logical |
    | `[1 0 1]` | double | double |
    | `[true 1 false]` | double (one numeric element promotes the lot) | double |

    `classAfterEdit` is deliberately *not* consulted on the logical arm — it exists to
    let a class the parser cannot see survive a bare numeric edit, and here the literal
    states the class itself. It also still excludes `'logical'` for the numeric arm,
    because keeping logical there would render a typed `7` as `true`, which MATLAB
    rejects.

44. **The binary `.sldd` reader dropped a logical array's shape and its element order,
    at every rank.** All three sites that decode a `Class="logical" Dimension="..."`
    body — entry value, cell element, object/struct property — split the body and joined
    it straight back into a flat list, so the logical class alone skipped BOTH halves of
    what the numeric branch beside it has always done. A 2x2 came back a 1x4 *with its
    four values in column-major order*, a 3x1 came back a 1x3, and an N-D came back
    flat. The json channel was correct the whole time, which is how the gap survived: it
    is the same class of split that let defect 30 outlive the fix for 29.

    This one was **only reachable once 43 was fixed** — before it no logical matrix
    could be typed at all — and there is no logical matrix in the MATLAB corpus to have
    caught it on read. `binarySlddValues.test.ts` had pinned the flat spelling with the
    note *"pinned so a later change to the logical spelling is a deliberate one"*; this
    is that change. Fixed by one `logicalValue` helper at all three sites, mirroring the
    numeric branch exactly: transpose out of column-major, bare bracketed list for a
    rank-2 row, `Matrix(r,c,...)` for anything else.

45. **A `Simulink.Parameter`'s logical Value lost both its class and its shape.**
    `ParameterNode.setProperty` had an arm for a double array and none for a logical
    one, so a logical array fell through to the scalar tail and was stored as the
    parser's bare JS list: `p.Value = [true false; false true]` was written
    `"Value": [1, 0, 0, 1]` and reopened in MATLAB as a **1x4 double**. Found by asking
    the same question of the other write path once 43 made the literal typeable. Fixed
    with a logical arm that goes through the shared `formatMatrixSerial`, which already
    spells a row bare and a column or matrix with a `Matrix(r,c)` header; `[true]`
    collapses to a bare `true`, so both spellings of the same 1x1 land on the same
    bytes.

46. **An edit under a `saveobj` envelope was written only where nothing reads it.**
    The other half of defect 28. A class that serializes through `saveobj` has its whole
    state inside one unnamed `<P Source="saveobj">`, and its individual properties are
    NOT siblings of that envelope. Defect 28 fixed the envelope's *survival*; an edit
    still never reached it. `DataNode._mergeProps` wrote a non-empty override as a
    sibling `<P>` only, on the stated reasoning that discarding a real edit is worse than
    writing a property MATLAB's loadobj *may* ignore. MATLAB settled the "may": it does
    ignore it. Editing `aVariant`'s `Specification` to `'myNewVar'` in a **binary**
    dictionary produced a file MATLAB reopened with `Specification` `''` — the edit was
    written, and written somewhere nothing loads.

    Invisible from inside for the sharpest possible reason: our own reader reads the
    sibling too. `fresh.Specification` was `'myNewVar'`, the in-process round trip agreed
    with itself, and the two disagreed only about the file. The json channel has no
    envelope, so it was correct throughout — the writer-split again.

    Fixed by also writing the value INTO the envelope, via a `writeIntoSaveobj` helper
    that only touches a field the envelope **already declares** (an edit must not invent
    a field in a struct `loadobj` is about to destructure), only a 1x1 envelope (a single
    property bag cannot say which element of an object array an edit belongs to, and a
    dictionary cannot hold one anyway), and only on a copy (this runs during
    serialization, and the envelope is parse state shared with `_rawVal` — writing
    through it would make serializing a model change the model).

    The sibling is **kept** rather than replaced: nothing in this package decodes an
    envelope back into a node property, so dropping it would make our own round trip
    lose the edit MATLAB now keeps. Writing both leaves every consumer correct and is
    strictly additive over the old behaviour. Decoding the envelope — which would make
    the sibling unnecessary, and would also fix the VariantVariable choices that display
    in no format — is the remaining half of defect 40 and is not done here.

    An EMPTY override is still dropped, unchanged: read through a sibling that is not
    there, `Specification` is `''` — a default, not a value — and writing it back would
    replace MATLAB's own empty 0x0 double with an empty char.

**Why 44, 45 and 46 are numbered separately from 43 and 28.** They are different code
paths that each would have shipped a file MATLAB reads differently. 44 and 45 became
reachable at once when 43 opened an input gate; 46 was reachable all along and simply
unasked. Keeping them apart records both lessons: fixing an *input* gate opens output
paths that were never exercised, and a live assertion that never runs is not a gate. It
is also why the live tier's failures are triaged as defects rather than as test problems.

## Defects found by asking MATLAB for four earlier `.slx` layouts

Phase 13 adds `slxLayouts.parity.test.ts` and the `artifacts/slx_layouts/` corpus:
`gen_slx.m` builds one diagram, saves it at the current release, and then asks
`save_system(..., 'ExportToVersion', R)` for R2025a, R2021a, R2018a and R2013b. That
one call spans **five** part layouts, because the `.slx` package has been rearranged
four times: the block diagram and the config set index moved to JSON in R2026b, the
graphical interface in R2024b, the blocks moved out of the block diagram into
`systems/*.xml` in R2020a, and the model workspace stopped being a MAT-file part in
R2019b. The corpus is the cheapest possible way to hold all five at once — five files
and one truth JSON, no MATLAB at test time.

The point worth recording is that only ONE of the two defects it found is in the new
code. The corpus was built to exercise a fallback path, and it caught a live bug in the
path it was falling back FROM.

47. **Every model reference vanished from an R2024b-R2026a file, in the JSON reader
    that predates this phase.** `graphicalInterface.json` has two shapes. The three
    releases that moved this part to JSON while the block diagram was still XML wrap
    their content in a `"GraphicalInterface"` object; R2026b flattened it and marks the
    element with `_mw_element_name` instead. `extractModelReferences` read only the flat
    shape, found no `ModelReferences` key, and returned `[]` — no error, no empty-state
    difference a caller could see, just a model hierarchy silently reported as flat.

    This is the same wrapping `parseModelParts` was ALREADY unwrapping one call earlier
    for the block diagram (`bd.BlockDiagram || bd`), which is what makes it a defect
    rather than a gap: the convention was known and applied in one place out of two.
    Fixed with the same `gi.GraphicalInterface || gi`.

    Why no existing test caught it: every `.slx` in every other corpus is written by the
    current release, so the flat shape is the only one they contain. A reader can be
    wrong about a three-release window for as long as no fixture is older than the
    window.

48. **A block nested inside a subsystem was invisible in a pre-R2020a file.** In that
    layout every system lives inside `blockdiagram.xml`, and a subsystem's `<System>` is
    a child of its `<Block>`. `findAll(system, 'Block')` does not descend into an element
    it has already matched, so scanning the root system returned its direct blocks only,
    and `InnerGain`'s `Gain=inner` — a real parameter reference into the dictionary — was
    dropped. Six expected rows, five delivered.

    Fixed by walking the systems explicitly (`legacySystems`): push the root, and for
    every `Block` found, push whatever `System` hangs off it. The same walk is why block
    scanning is scoped to `Model.System` rather than `Model`: a legacy block diagram
    carries `<BlockDefaults>` and `<BlockParameterDefaults>` as siblings of `<System>`,
    both full of template blocks that are not in the diagram at all.

**Why the new layouts are read as fallbacks, in that order, and never as a mode.** The
user constraint for this phase was "do not break the current version file parsing," and
the structure enforces it rather than testing for it: each part is looked for in JSON
first, then XML, then inline, and the JSON branches are the untouched originals. A
current-release file therefore never evaluates a legacy branch — `legacyModel` returns
`null` for it, since `blockDiagram.json` and `blockdiagram.xml` are different part names.
That casing pair is itself a trap the suite pins: capital `D` in the JSON name, lowercase
in the XML one, so a case-insensitive part lookup would read a current file down the
legacy path. One test asserts the corpus contains both spellings, so the pair cannot
quietly become one.

The suite is also checked for teeth the same way every other tier is: with
`SlxParser.ts` reverted to its pre-phase version, 66 of its 193 tests fail.

## Known limitations, to verify and document

- **Derived MCOS classes.** A customer class `MyParam < Simulink.Parameter`
  ideally gets the `Simulink.Parameter` schema plus its custom properties. The
  file bytes do not record the superclass, and without MATLAB inheritance is not
  recoverable — so it is treated as an unknown class and takes the general
  expansion path. The suite verifies this degrades gracefully: no crash, no data
  loss, every property visible, values correct. It does not attempt a heuristic.
- **`.mat` / `.slx` / `.mdl` / `.prj` are read-only.** No write-back verification.
- **A classic (pre-R2012) `.mdl` cannot answer four questions a `.slx` can.** It records
  no release and no UUID, so both come back `''`; its `lastModified` is MATLAB's
  `Fri Sep 04 10:15:29 2026` spelling rather than ISO 8601; and there is no zip, so
  `rawContents` and `zipEntries` are `null`. A fifth is MATLAB's own limit rather than the
  format's: exporting to R2011b **drops the linked data dictionary**, so the block row that
  links into it is a plain string there and a link target in every other flavour (R2017b
  keeps it). All five are asserted in `mdl.parity.test.ts` rather than assumed — an
  unasserted divergence is indistinguishable from a parse bug.
- **Three things an earlier `.slx` layout cannot answer.**
  A pre-R2020a file records no `ModelUUID`, so it comes back `''`; R2013b predates data
  dictionaries and MATLAB drops the link on export, so there is nothing to link (the
  suite's expectation there is MATLAB's own `lastwarn`, recorded by the generator, not a
  sentence we wrote); and R2013b roots a reference block path at the model's literal name
  rather than `$bdroot`, which an export has just renamed, so the recorded name is the
  only safe prefix to strip. All three are asserted in `slxLayouts.parity.test.ts`;
  everything else — blocks including nested ones, all eight workspace values, both config
  sets with the right one active, the reference, the dictionary, and the external-`.mat`
  pointer — reads identically out of all five layouts.

  A fourth entry here used to be a deliberate omission: a `Simulink.ConfigSetRef` in a
  legacy file read as a plain `Simulink.ConfigSet`, because the modern path told the two
  apart by an `_object_class` field that no fixture in this corpus showed an XML
  counterpart for, and guessing one would have put a branch in the parser that no failing
  test closes. **Now measured and closed** — `probe_configsetref.m` asked MATLAB, and the
  answer was not the single guessable fact: the class is the `ClassName=` attribute in
  every XML era, but the property naming what the ref points at is `SourceName` from
  R2021a and `WSVarName` in R2018a and earlier. `slxcfgref.slx` plus one export per era
  now hold the parser to it, and the layout suite's config assertion compares class and
  source rather than name alone. See "Where a config set records what it *is*" in
  `README.md`.
- **An MCOS object NESTED in a struct field or a cell element shows a summary, not its
  contents.** `test/fixtures/strings_nested.mat` (MATLAB-authored, `probe_string.m`) has a
  struct with a `Simulink.Parameter` field and a string field, and a cell holding both:
  each presents as `<1x1 Simulink.Parameter>` / `<1x1 string>` with no property rows and no
  text. The cause is not string-specific. Only NAMED variables reach the decoder —
  `decodeMcosObjects` filters `v.isOpaque && v.name` — and a nested opaque is built by
  `MatlabVariableNode._createOpaque` from a `MatVariable` that has no name, so the shared
  blob is never consulted for it. Closing it means threading the blob into the nested
  constructors, and additionally making `MatParser`'s cell branch set `_rawBytes` on cell
  children at all (only its struct branch does today, at `MatParser.ts:307`), so a cell
  element has no object handle to resolve. Pinned as today's answer by the last two tests
  in `matStringOpaque.test.ts`, so a change to it is a deliberate one.
- **A `missing` has no dictionary spelling.** If a decoded string array carrying a
  `missing` were copied into a `.sldd`, the element would serialize as JSON `null`; what
  MATLAB reads that back as was not measured. Not reachable today (a `.mat` string is
  read-only and nothing else produces a `missing`), and recorded rather than invented — the
  alternative would be writing `""`, which is a different value MATLAB can tell apart.
- **A numeric matrix's element ROWS are in storage order, not MATLAB's** — defect 36.
  Pinned exactly and in both directions by `structure.test.ts`; the fix is a
  storage-layer change and is deliberately not a parity fix.
- **A `Simulink.VariantVariable`'s choices are not displayed in any format**, and three
  of the four channels carry no property data for it at all — defect 40. Recorded from
  the raw bags, because MATLAB does not call `Choices` a property and parity therefore
  passes.
- **Truth can go stale** against a future MATLAB release. `drift.mjs` is the
  mitigation (both corpora: `truth.json` and `mdl_truth.json`); it is a developer
  action, not a CI gate.

## Risks

| risk | mitigation |
|---|---|
| `expect.ts` re-derives what `src` does, making tests tautological | derive only from MATLAB-reported class/size/complexity/`mat2str` |
| Threshold unification is user-visible (long arrays start summarizing) | called out above as intended; confirmed during design |
| Fixture size | one artifact per format, not per case; ~15–20 KB each, ~100 KB total |
| Defect 1 touches storage, display, and serialization | separate `lossless` tier asserts the storage guarantee independently of display |
