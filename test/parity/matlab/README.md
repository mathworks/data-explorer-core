<!-- Copyright 2026 The MathWorks, Inc. -->

# MATLAB parity fixtures

A corpus of 77 named cases — every primitive class, shape, threshold and object
container this package claims to read — written by real MATLAB into all four
supported formats, plus a JSON record of what MATLAB itself says each case is.
The tests assert against that record.

**The truth was written by MATLAB `27.1.0.3353139 (R2027a) Prerelease`**
(`version('-release')` = `2027a`); `artifacts/meta.json` carries both strings so
a stale corpus is identifiable without rerunning anything.

Everything under `../artifacts/` is **generated**. Do not hand-edit it, and never
write an expected value by hand when MATLAB can be asked for it.

MATLAB is a fixture generator, not a test dependency. It cannot run in GitHub CI,
so a fully MATLAB-gated suite would never actually run for this repo: MATLAB
emits truth once, the truth is committed, and the tests read it.

## Regenerate

```bash
mw -using Bmain matlab -nodesktop -batch "run('$PWD/test/parity/matlab/gen_truth.m')"
```

Prints `GEN_TRUTH OK` and rewrites all six generated files in place. The path
must be absolute — `-batch` starts in whatever directory you launched from.

`gen_truth.m` honours an `outdir` set by the caller, so the corpus can be
regenerated somewhere harmless and diffed against what is committed (this is how
`drift.mjs` checks for release drift):

```bash
mw -using Bmain matlab -nodesktop -batch \
  "outdir='/tmp/scratch'; run('$PWD/test/parity/matlab/gen_truth.m')"
```

**Only the two JSON files are byte-reproducible.** A regenerate into `/tmp` gives
byte-identical `truth.json` and `meta.json`; `cases.mat`, `cases.slx` and both
`cases.sldd` differ every run because MATLAB stamps each entry with a fresh UUID
and `lastmod` (e.g. `"lastmod": "20260903T121143.963203"`). Compare `truth.json`,
not container bytes. A diff in `truth.json` with no diff in the tests means
MATLAB changed its own answer — that is a finding, not a test to fix.

## Layout

`gen_truth.m` lives here and writes to `../artifacts/`. Nothing writes to
`test/parity/matlab/artifacts/`.

| path | what |
|---|---|
| `gen_truth.m` | the only entry point: one case catalog, every format emitted from it |
| `probe_ndarray.m`, `probe_rank2.m` | the design-time probes that produced the rank-3 and object-array evidence in `DESIGN.md`; they write to `/tmp/c4probe`, not to `artifacts/` |
| `DESIGN.md` | the display convention, the coverage matrix, and the 13 defects this suite exists to pin |
| `../artifacts/truth.json` | the expectations, for every format at once |
| `../artifacts/meta.json` | `version` and `release` of the MATLAB that wrote the corpus |
| `../artifacts/mat/cases.mat` | all 77 cases — the only format that holds the object arrays |
| `../artifacts/slx/cases.slx` | model `cases`, 73 cases in its model workspace |
| `../artifacts/text/cases.sldd` | 73 entries in Design Data, `FileFormat = 'uncompressed-text'` |
| `../artifacts/binary/cases.sldd` | the same 73, `FileFormat = 'compressed-binary'` |

**`text/params.sldd` and `binary/params.sldd` are not part of this corpus.** They
are the older, hand-made fidelity fixtures used by `test/parity/fidelity/*.test.ts`,
and they predate `gen_truth.m` — it neither reads nor rewrites them. The two
suites share the `artifacts/` tree only so that
`roundTripHarness.loadModel(format, fixture, uri)`, which resolves
`../artifacts/{text|binary}/<fixture>`, works on both unchanged.

`.prj` has no case file: a project carries no data objects, so parity for it is
structural only.

## The catalog

77 names, in `gen_truth.m`'s `C` (73) and `OBJARR` (4), landing in `truth.json`
as `vars` and `objArr`:

- 11 scalars (`double`, `single`, `logical`, `char`, `string`, complex, plus
  `1e300`/`1e-300`) and 4 non-finites (`Inf`, `-Inf`, `NaN`, and a vector mixing them);
- 24 integers — scalar, `intmax` and `intmin` for all eight classes, because
  64-bit extremes are where double-rounding shows;
- 3 cases no `double` can hold: `u64Vec` = `[intmax('uint64') 1 0]`,
  `i64Vec` = `[intmax('int64') intmin('int64') -1]`, and `i64Unsafe` = 2^53+1, the
  smallest integer a `double` cannot represent. Arrays, not just scalars — a
  per-element conversion is where a scalar special case stops helping, and these are
  the only 64-bit cases that reach `.slx` at all;
- shapes: row, column, `2x3`, `2x3x2`, empty; typed vectors (`logical`, `int16`, complex);
- display-threshold neighbours `exactly10`, `eleven`, `long30`, `longChar`, `hugeChar` (1x1500);
- 5 cell cases (flat, nested, `2x3`, `2x3x2`, empty) and 6 struct cases (scalar, nested, `1x3`, `2x3`, `2x3x2`, empty);
- 5 object cases with non-default values on every writable property —
  `aParam`, `aSignal`, `aBus`, `aLookup`, `aVariant` — which are the entries
  carrying a `properties` block in `truth.json`;
- 4 `Simulink.Parameter` arrays — `objRow` (1x3), `objCol` (3x1), `obj2x3`,
  `obj2x3x2` — each element holding a distinguishable `Value` so a transposed
  label is detectable.

**Every array case is 2x3, never 2x2, and has a 2x3x2 sibling.** A square fixture
cannot distinguish row-major from column-major and a rank-2 fixture cannot expose
page handling; between them those two gaps hid six of the thirteen defects in
`DESIGN.md`.

Per entry, `truth.json` records `class`, `size`, `numel`, `iscomplex`,
`islogical`, `isobject`, `isempty`, MATLAB's own `disp`
(`formattedDisplayText(..., 'SuppressMarkup', true)`), `mat2str` — or
`mat2str_error` with MATLAB's message when there is no literal — and, when
`1 < numel <= 64`, `linearSubs`/`linearValues`: one subscript label and one value
per linear index, so the label-to-value mapping itself is assertable.

## What MATLAB refuses to store

Two refusals. Both are recorded in `truth.notes` **and both cases stay in the
catalog**: a limit that is deleted from the corpus is a limit nobody re-checks
next release, and skipping a case keyed by MATLAB's own message means the skip
disappears by itself the day MATLAB lifts the restriction.

1. **A data dictionary cannot hold an object array.** All four arrays, both
   formats. `truth.notes.slddRejected.text` and `.binary`, keyed by entry name:

   > Arrays of class 'Simulink.Parameter' are not supported in the dictionary.

   Every one of the other 73 cases was accepted; both dictionaries hold 73 entries.

2. **Neither can a `.slx` model workspace** — the same four, in
   `truth.notes.slxRejected` (one level, not per format):

   > Creating an array of Simulink data or data type objects in the model workspace is not allowed.

   So **object-array parity is a `.mat` question only.** `cases.mat` holds all 77
   and `obj2x3` round-trips out of it as `Simulink.Parameter`, `[2 3]`, values
   `11 21 12 22 13 23` (column-major). DESIGN.md's older claim that the model
   workspace holds object arrays is wrong for R2027a.

In both maps a name whose value is the string `ACCEPTED` was *not* rejected;
tests must compare against the message, not merely check for the key's presence.

A third boundary is recorded per entry rather than in `notes`: **`mat2str` has no
answer for rank >= 3** — for `nd2x3x2` it fails with

> Input matrix must be 2-D.

which is why the convention summarizes an N-D array as `<2x3x2 double>` instead
of printing a 2-D-looking lie.

## Tiers, and which need `DEX_MATLAB_CMD`

**Tier 1 — committed truth, no MATLAB, runs in CI on every PR.** Reads
`artifacts/` through `test/parity/loadFile.ts` (which goes through `ingest`, so
format sniffing is exercised too) and `loadTruth.ts`:

| suite | asserts |
|---|---|
| `display.test.ts` | `displayValue` and Data Type, per format x case |
| `structure.test.ts` | child counts, MATLAB's own index labels, and the value at each label |
| `schemaProps.test.ts` | every property MATLAB reports on a known class is surfaced, with MATLAB's value |
| `lossless.test.ts` | the stored value is MATLAB's exact value, and serialize -> reparse is a fixed point |

`lossless` is deliberately separate from `display`: display is lossy by design (a
summary, a threshold), storage must not be, and only a storage-level assertion
catches a value written back in its truncated display form.

**Tier 2 — live MATLAB, dev-only, never in CI.** `writeback.live.test.ts` (edit
-> serialize -> MATLAB reopens -> assert value and class, for both `.sldd`
formats) and `drift.mjs`. A fixture cannot stand in for these: proving MATLAB
reads what *we* wrote requires MATLAB.

Tier 2 is gated on `DEX_MATLAB_CMD` — launcher plus fixed args, e.g.
`mw -using Bmain matlab` — with optional `DEX_MATLAB_CWD`, exactly the convention
`test/parity/fidelity/roundTripHarness.ts` already uses. Do not add a second env
var. **When it is unset those assertions skip, never fail**; that is what keeps
the suite green in CI and for external contributors, and it also means a green
`npm test` on a machine without MATLAB has not exercised tier 2 at all.

```bash
npm test                                                     # tier 1
npm run verify                                               # the full gate; skips tier 2
env DEX_MATLAB_CMD="mw -using Bmain matlab" npm test         # tier 1 + tier 2
env DEX_MATLAB_CMD="mw -using Bmain matlab" npm run parity:drift
```

(`tcsh` has no `VAR=value cmd` form — use `env`.) There is no `npm run lint` in
this repo; `npm run verify` is the gate.

## When a parity test fails

Classify it, in writing, as exactly one of three things:

1. **A real defect** — fix the code, keep a test that fails without the fix, and
   add the defect to `DESIGN.md`.
2. **The expectation mis-states the convention** — fix `expect.ts` and its unit
   test, and say what the convention actually is.
3. **A genuine format limitation** — skip the case *keyed by MATLAB's own
   message*, as the object arrays are, and record it under Known limitations in
   `DESIGN.md`.

Never make a failure disappear by loosening the assertion (`toContain`, a regex,
a `try/catch`). An unclassifiable failure stays red with a written reason: a
known-red assertion is worth more than a green one that checks nothing.

## The one rule

**`expect.ts` must never import from `src/`.** An expectation derived from the
code under test agrees with that code no matter how wrong it is. Every function
in `expect.ts` takes `truth.json` fields — class, size, complexity, `mat2str`,
`disp` — and returns a string.

---

Tier 1's four suites, `loadTruth.ts`, `expect.ts`, `writeback.live.test.ts` and
`drift.mjs` land in Phases 11 and 12 of `PLAN.md`; until then the corpus is
exercised only by `test/parity/loadFile.test.ts`.
