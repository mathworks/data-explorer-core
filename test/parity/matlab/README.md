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

There is a second corpus alongside this one, with its own generator and its own
question: [The `.mdl` corpus](#the-mdl-corpus), which is about containers rather
than values.

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

`gen_truth.m` lives here and writes to `../artifacts/`; `gen_mdl.m` lives here too
and writes to `../artifacts/mdl/` and nowhere else. Nothing writes to
`test/parity/matlab/artifacts/`.

| path | what |
|---|---|
| `gen_truth.m` | the only entry point for the corpus: one case catalog, every format emitted from it |
| `gen_mdl.m` | the entry point for the SECOND, separate corpus: the `.mdl` flavours and their `.slx` twins — see [The `.mdl` corpus](#the-mdl-corpus) |
| `probe_*.m`, `probe_writeback*.mjs` | one-question probes — see the table below. None of them writes to `artifacts/` |
| `wbcompare.m` | the comparison both write-back gates share: `fullsig`, which walks a value to every leaf spelling class, size, complexity and exact value |
| `DESIGN.md` | the display convention, the coverage matrix, and the numbered defects this suite exists to pin |
| `drift.mjs` | regenerate BOTH corpora into a temp directory and diff `truth.json` and `mdl_truth.json` against what is committed — the check for MATLAB-release drift |
| `STRING_MCOS.md` | how MATLAB stores a `string` in a `.mat`: the metadata segment the parser skipped, the packed `uint64` payload, and what could not be determined |
| `../artifacts/truth.json` | the expectations, for every format at once |
| `../artifacts/meta.json` | `version` and `release` of the MATLAB that wrote the corpus |
| `../artifacts/mat/cases.mat` | all 77 cases — the only format that holds the object arrays |
| `../artifacts/slx/cases.slx` | model `cases`, 73 cases in its model workspace |
| `../artifacts/text/cases.sldd` | 73 entries in Design Data, `FileFormat = 'uncompressed-text'` |
| `../artifacts/binary/cases.sldd` | the same 73, `FileFormat = 'compressed-binary'` |
| `../artifacts/mdl/` | the `.mdl` corpus — six model files and `mdl_truth.json`, all written by `gen_mdl.m` |

**`text/params.sldd` and `binary/params.sldd` are not part of this corpus.** They
are the older, hand-made fidelity fixtures used by `test/parity/fidelity/*.test.ts`,
and they predate `gen_truth.m` — it neither reads nor rewrites them. The two
suites share the `artifacts/` tree only so that
`roundTripHarness.loadModel(format, fixture, uri)`, which resolves
`../artifacts/{text|binary}/<fixture>`, works on both unchanged.

`.prj` has no case file: a project carries no data objects, so parity for it is
structural only.

### The probes

Each one asks MATLAB a single question the corpus could not answer, and the answer
is recorded in `DESIGN.md` under the defect it settled. They are developer tools,
not tests: nothing in `npm test` runs them, and each prints a completion marker of
its own on the last line (`CHARSHAPE OK`, `ND_RICH OK`, `PROBEDONE`,
`WRITEBACKDONE`, …) so a probe that died halfway is not mistaken for one that found
nothing. Every one takes an absolute path — `-batch` starts in whatever directory
you launched from — and those that write a dictionary need an ABSOLUTE output
directory, because `Simulink.data.dictionary.open` rejects a relative one with
`SLDD:sldd:DictionaryNotFound` (which turns every verdict into a meaningless FAIL).

| probe | question | writes | fixture it produced |
|---|---|---|---|
| `probe_ndarray.m` | what does MATLAB write for a rank-3 numeric array, in both flavours? | `/tmp/c4probe` | `nd_text.sldd`, `nd_binary.sldd` |
| `probe_rank2.m` | is a rank-2 struct/object matrix transposed on read? (defect 6) | `/tmp/c4probe` | — |
| `probe_nd_edge.m` | the two N-D shapes a rank-2 reading does not merely get wrong but crashes on: `1*1*3`, and a `2*3*2` complex | `/tmp/ndedge` | `nd_1x1x3.sldd`, `nd_complex.sldd` |
| `probe_matrix_serial.m` | which `Matrix(...)` spellings can MATLAB read back? (defect 19) | `tempdir` | — |
| `probe_rank3_serial.m` | is there ANY literal spelling for rank >= 3, or is cdata the only form? (defect 22) | `tempdir` | — |
| `probe_nd_rich.m` | what exactly is in the cdata stream, for all thirteen rank-3 kinds? | `$ND_RICH_OUT` or `tempdir/ndrich` | `nd_rich.sldd` |
| `probe_nd_nested.m` | at which LEVEL does the cdata go when the N-D value is nested? (defect 22's placement rule) | `$ND_NESTED_OUT` or `tempdir/ndnested` | `nd_nested.sldd` |
| `probe_typed_shapes.m` | how is a typed array spelled at the top level, in a struct field, in a cell? (defects 21, 23) | `$TYPED_SHAPES_OUT` or `tempdir/typedshapes` | `typed_text.sldd`, `typed_binary.sldd` |
| `probe_char_shape.m` | what does a dictionary do with a char array that is not 1xN, and which literals does MATLAB accept for one? (defect 25) | `$CHAR_SHAPE_OUT` or `tempdir/charshape` | `char_text.sldd`, `char_binary.sldd` |
| `probe_string.m` | how does MATLAB store a `string` in a `.mat`, and which heap cell holds the text? (`STRING_MCOS.md`) | `$STRING_OUT` or `tempdir/strprobe` | `strings.mat`, `strings_truth.json`, `strings_mixed.mat` |
| `probe_writeback.mjs` + `.m` | **the acceptance gate for the TEXT dictionary**: does MATLAB read back the JSON `_value` our writer emits? | `$PROBE_OUT` | — |
| `probe_writeback_bin.mjs` + `.m` | **the acceptance gate for the BINARY dictionary**: does MATLAB read back the XML chunk our writer emits? (defects 27-30) | `$PROBE_OUT` | — |

The two `probe_writeback` probes are the only two-part probes and the only ones with a
pass/fail verdict. Both read the BUILT package, so a stale `dist/` is a stale verdict, and
both need `PROBE_OUT` to be the same ABSOLUTE path in each half.

The text gate splices our serialization of ONE entry into a copy of the MATLAB-authored
dictionary it came from, and the `.m` half reopens each spliced file and compares against
the untouched original:

```bash
npm run build
env PROBE_OUT=/tmp/wb node test/parity/matlab/probe_writeback.mjs
env PROBE_OUT=/tmp/wb mw -using Bmain matlab -nodesktop \
    -batch "run('$PWD/test/parity/matlab/probe_writeback.m')"
```

Its last line is `WRITEBACK FAILURES n of m`. **Zero is the only acceptable result**
(currently 0 of 54, 5 controls). A case our writer cannot produce at all counts as a
failure, not as an absence.

The binary gate cannot splice, because `serializeBinarySldd` rebuilds the WHOLE package —
every entry's XML, the DataSource header, the dictionary object, the zip. One rebuilt file
therefore carries every entry at once, and the manifest lists each entry as its own case so
a failure names the value rather than the file:

```bash
npm run build
env PROBE_OUT=/tmp/wbbin node test/parity/matlab/probe_writeback_bin.mjs
env PROBE_OUT=/tmp/wbbin mw -using Bmain matlab -nodesktop \
    -batch "run('$PWD/test/parity/matlab/probe_writeback_bin.m')"
```

Its last line is `WRITEBACK FAILURES n of m` too, then `WRITEBACKBINDONE` (currently
**0 of 101**, 10 controls). Set `PROBE_SHOWSIG=1` to print the full `fullsig` of both
sides of every case — the way to tell a real PASS from a vacuous one, which is how
defect 28 was found. Two controls per source file: `control_copy_*` hands MATLAB the bytes
it wrote, and `control_zip_*` hands back MATLAB's own `chunk0.xml` repacked by `fflate`, so
a zip we build is proved readable independently of anything we put inside it.

Both gates need every node in the subtree marked modified, not just the root:
`_markModified` walks UP the chain and an unmodified node replays its `_rawInput`, so
marking a container leaves the writer untested on every field and element beneath it.

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
page handling; between them those two gaps hid six of the defects recorded in
`DESIGN.md` — a count deliberately left un-tallied here, because it only ever
grows and a stale number reads as a claim.

The one place a square fixture is used on purpose is the live write-back gate,
where the logical matrix is `[true true; false false]`: 2x2, so the *shape* alone
cannot catch a transpose, but its element order can — column-major it is
`1 0 1 0`, transposed `1 1 0 0`. That is how defect 44 was distinguished from a
shape-only bug.

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

## The `.mdl` corpus

A second, separate corpus, written by `gen_mdl.m` into `../artifacts/mdl/`. It
answers a different question from `cases.*`: not "what is this value", but "does
the same block diagram open to the same data model out of every container it can
be stored in". `.mdl` comes in **two on-disk flavours**, both of which real users
still have, and the test holds each of them to the `.slx` written from the very
same in-memory model.

| file | flavour |
|---|---|
| `mdlcases.mdl` | **modern** — an OPC *text* package: the exact part set a `.slx` zips, delimited by `__MWOPC_PART_BEGIN__` lines instead, binary parts base64'd. What `save_system` writes for a `.mdl` today |
| `mdlcases_R2011b.mdl` | **classic** — the pre-R2012 nested-brace text, via `'ExportToVersion'`. The model workspace lives in a top-level `MatData` section, uuencoded |
| `mdlcases_R2017b.mdl` | classic again, from the LAST release that wrote one: same grammar, but it keeps the linked data dictionary and records model references a second way (`ExternalFileReference`) |
| `mdlcases.slx` | the twin every flavour above is compared against |
| `mdlmcos.mdl` / `mdlmcos.slx` | the modern-only pair, one `Simulink.Parameter` in the model workspace |
| `mdl_truth.json` | what MATLAB says about each *model* — recorded from the model, not from any one file, so it is the shared expectation all flavours are held to |

`mdlcases` is a catalog of what a *model file* can get wrong, not of data types:
`Const`/`Gain` for the ordinary bare-identifier parameter, `TF` for coefficients
hiding in `Numerator`/`Denominator` (no allowlist could have known to look there),
`Sat` with `UpperLimit = Inf` and `Sum` with `Inputs = |++` for the values that
must *not* be reported as references to a variable, a two-line block name (`\n`
in `.mdl`, `&#xA;` in `.slx`), a nested subsystem so the walk must recurse, a
`ModelReference` to `mdl_child`, a linked `mdlparams.sldd`, two config sets, and a
model workspace holding one of every primitive container.

**`mdlcases`' workspace is plain values only, on purpose.** A Simulink data object
in it makes the R2011b export give up on the workspace entirely and repoint it at
a `.m` file, leaving the classic `MatData` path nothing to parse. MCOS in a `.mdl`
is therefore covered by `mdlmcos`, which has no classic flavour.

### Regenerate

```bash
mw -using Bmain matlab -nodesktop -batch "run('$PWD/test/parity/matlab/gen_mdl.m')"
```

Prints `GEN_MDL OK` and rewrites all seven files. It honours `outdir` exactly as
`gen_truth.m` does, which is how `drift.mjs` regenerates it somewhere harmless and
diffs it. **Only `mdl_truth.json` is byte-reproducible** — it records no UUID and no
timestamp; the six model files differ every run, because
`metadata/coreProperties.xml` and `simulink/blockDiagram.json` carry a per-save
timestamp and UUID. That is also the *only* difference between the modern `.mdl`
and its `.slx` twin, which is what makes the byte-level part comparison below
possible at all.

Two things about the generator worth not rediscovering: `save_system` to
`<name>.slx` beside an existing `<name>.mdl` is an **in-place format upgrade** —
Simulink writes the `.slx` and deletes the `.mdl` — so the twins are written to a
scratch directory and moved in afterwards; and `'ExportToVersion'` **renames the
block diagram** to the target file name, so the classic files carry
`mdlcases_R2011b` as the model name and as the prefix of every block path, which
the test normalises away.

### What `mdl.parity.test.ts` asserts

Two kinds of claim, and the distinction matters:

- **against MATLAB truth** — the block list, the parameter usages, the config sets
  and which is active, the referenced model names, the workspace variables and each
  one's display and class. `mdl_truth.json` only, never our own parse.
- **across flavours** — every `.mdl`'s row shape must equal the `.slx`'s, and for
  the modern flavour the claim is stronger still: the two containers must hold the
  same part keys with byte-identical contents, `simulink/modelWorkspace.mxarray`
  included, excepting only the two per-save parts above. That one assertion is what
  proves the base64 decode, not a sampled value from it.

Four divergences are **expected**, and asserted rather than assumed. In a classic
file `release` and `uuid` are `''` (the format records neither), `lastModified` is
MATLAB's own `Fri Sep 04 10:15:29 2026` spelling rather than ISO 8601,
`rawContents` and `zipEntries` are `null` (there is no zip), and **R2011b drops the
linked data dictionary** — so the block row that links into it is a plain string
there and a link target in every other flavour. R2017b keeps it.

## The `.slx` layout corpus

A third corpus, written by `gen_slx.m` into `../artifacts/slx_layouts/`. Where the
`.mdl` corpus asks whether one diagram survives every **container**, this one asks
whether it survives every **part layout** — because `.slx` is not one format.

A `.slx` is an OPC zip, and its part set has changed five times. The JSON parts
this parser was first written against arrived in **R2026b**; every release before
that wrote XML. So the layouts below are not a nicety for museum pieces, they are
the layout of essentially every `.slx` in existence.

Measured rather than assumed — `save_system(..., 'ExportToVersion', R)` for
R = R2012a … R2026b, then reading the zip directory of each:

| Release | block diagram | config set index | graphical interface | model workspace | blocks |
|---|---|---|---|---|---|
| R2012a-R2014a | `blockdiagram.xml` | *inline* | *inline* | `modelworkspace.mat` | in `blockdiagram.xml` |
| R2014b | `blockdiagram.xml` | *inline* | `graphicalInterface.xml` | `modelworkspace.mat` | in `blockdiagram.xml` |
| R2015a-R2019a | `blockdiagram.xml` | `configSetInfo.xml` | `graphicalInterface.xml` | `modelworkspace.mat` | in `blockdiagram.xml` |
| R2019b | `blockdiagram.xml` | `configSetInfo.xml` | `graphicalInterface.xml` | **`modelWorkspace.mxarray`** | in `blockdiagram.xml` |
| R2020a-R2024a | `blockdiagram.xml` | `configSetInfo.xml` | `graphicalInterface.xml` | `modelWorkspace.mxarray` | **`systems/*.xml`** |
| R2024b-R2026a | `blockdiagram.xml` | `configSetInfo.xml` | **`graphicalInterface.json`** | `modelWorkspace.mxarray` | `systems/*.xml` |
| R2026b+ | **`blockDiagram.json`** | **`configSetInfo.json`** | `graphicalInterface.json` | `modelWorkspace.mxarray` | `systems/*.xml` |

Note the casing change at the flip: `blockdiagram.xml` has a lowercase `d`,
`blockDiagram.json` a capital `D`. Both are real part names, so a case-insensitive
lookup would be a bug rather than a shortcut — the suite asserts the corpus
contains both spellings.

One file per row that a single export can reach:

| file | layout |
|---|---|
| `slxcases.slx` | the current release; the reference every other file is compared against |
| `slxcases_R2025a.slx` | graphical interface JSON, block diagram and config set index still XML — the R2024b-R2026a era |
| `slxcases_R2021a.slx` | all three XML — the R2020a-R2024a era, five years long and so the file most likely to turn up |
| `slxcases_R2018a.slx` | blocks *inside* `blockdiagram.xml`, workspace in `modelworkspace.mat` — the R2015a-R2019a era |
| `slxcases_R2013b.slx` | no config set index and no graphical interface part at all: both inline in the block diagram |
| `slxws.slx` / `slxws_R2021a.slx` / `slxws_R2018a.slx` | the same question for a different *storage* choice: a model workspace backed by an external `.mat` |
| `slxws_data.mat` | that external workspace, which is where `slxws`' variables actually live |
| `slx_truth.json` | what MATLAB says about each *model*, plus the `lastwarn` from every export |

`slxcases` is deliberately the **same diagram** `gen_mdl.m` builds, for the same
reasons — see the `.mdl` catalog above — so a finding in either suite is directly
comparable to the other. Its workspace is plain values only, for the same reason
`mdlcases`' is: a Simulink data object makes the oldest exports give up on the
workspace and repoint it at a `.m` file, leaving the `modelworkspace.mat` path
nothing to parse.

### Regenerate

```bash
mw -using Bmain matlab -nodesktop -batch "run('$PWD/test/parity/matlab/gen_slx.m')"
```

Prints `GEN_SLX OK` and rewrites all ten files. It honours `outdir` exactly as
`gen_truth.m` does. As with the `.mdl` corpus, only `slx_truth.json` is
byte-reproducible; the model files carry a per-save timestamp and UUID.

Two things about the generator worth not rediscovering. `'ExportToVersion'`
**renames the block diagram** to the target file name, so every legacy file carries
`slxcases_R20xxy` as the model name and as the prefix of every block path — which
the test normalises away. And `slxws`' `.mat` is named **relatively**, the way a
real model names it, so it only resolves once the model itself is on disk in the
same directory: saving the model *before* setting `DataSource`/`FileName` and
calling `reload()` is the required order, not a preference.

### What `slxLayouts.parity.test.ts` asserts

Three kinds of claim:

- **the layout is real** — each fixture is asserted to carry the parts its era
  wrote, and *not* the other flavours of those same parts. Without this the parity
  comparison could pass vacuously: a corpus accidentally regenerated from one
  release would be comparing a file to itself.
- **against MATLAB truth** — the block list, the parameter usages, the config sets
  and which is active, the referenced model names, the workspace variables and each
  one's display and class. `slx_truth.json` only, never our own parse.
- **across layouts** — every legacy file's row shape must equal the current
  release's. This is the claim legacy support makes, and a wrong-but-consistent
  reader cannot satisfy it, because the reference side is read by code that predates
  the legacy readers entirely.

### Where it degrades, and why that is the file's limit rather than ours

Every one of these is asserted, so it stays deliberate rather than becoming
folklore:

- **no model UUID before R2020a.** `ModelUUID` does not exist in the file. Nothing
  invents one; hashing the bytes would produce a value that looks like MATLAB's and
  is not, which is worse than an empty column.
- **no data dictionary in R2013b.** Dictionaries arrived in R2014a, and MATLAB drops
  the link on export — the suite's expectation here is MATLAB's *own warning*,
  recorded verbatim by the generator, rather than a sentence we wrote.
- **R2013b writes no `$bdroot`.** A reference block path is rooted at the model's
  literal name, which an export has just renamed; the recorded name is the only safe
  prefix to strip.
- **a `Simulink.ConfigSetRef` in a legacy file reads as a plain `Simulink.ConfigSet`.**
  The modern path distinguishes them by an `_object_class` field that the XML layout
  has no counterpart for in this corpus. Left alone on purpose: no fixture proves
  what MATLAB writes there, and guessing would put an untested branch in the parser.
  Recorded in `docs/TODO.md` instead.

Everything else — blocks including those nested inside a subsystem, all eight
workspace variables with their exact values, both config sets with the right one
active, the model reference, the linked dictionary, and the external-`.mat` pointer
— reads identically out of all five layouts.

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
| `mdl.parity.test.ts` | the `.mdl` corpus: each flavour against MATLAB's truth, and each against its `.slx` twin |
| `slxLayouts.parity.test.ts` | the `.slx` layout corpus: each era's part layout is real, each file against MATLAB's truth, and each against the current release's rows |

`lossless` is deliberately separate from `display`: display is lossy by design (a
summary, a threshold), storage must not be, and only a storage-level assertion
catches a value written back in its truncated display form.

**Tier 2 — live MATLAB, dev-only, never in CI.** `writeback.live.test.ts` (edit
-> serialize -> MATLAB reopens -> assert value, `size()` and `class()`, for both
`.sldd` formats), `drift.mjs`, and the older per-node assertions in
`test/parity/fidelity/*` and `test/fidelitySmoke.test.ts`. A fixture cannot stand
in for any of them: proving MATLAB reads what *we* wrote requires MATLAB.

It is the only tier that can prove a write is *correct*, and the asymmetry is the
point — a value written wrongly and then read back with the same wrong assumption
looks fine from inside. Five defects were found this way and could not have been
found any other way (42-46 in `DESIGN.md`): the 64-bit write path rounding, the
logical-array literal MATLAB itself prints being refused as invalid input, the two
output paths that only became reachable once that literal was accepted, and an edit
under a `saveobj` envelope written only to a sibling property MATLAB's `loadobj`
ignores. In `writeback.live.test.ts` there is one case per thing a *write* can get
wrong rather than one per data type — the exact 64-bit integers, shape, element
order, the non-finites, char, and logical — and each carries its own `why` string,
which is what the test name reports.

**Run the whole suite with MATLAB configured, not just the new file.** Defect 46
came from a `test/parity/fidelity` assertion that had existed for phases without
ever executing, because the gate skips when `DEX_MATLAB_CMD` is unset and CI never
sets it. A live assertion that never runs is not a gate. The same first run also
turned up two test-level faults — a live `it` with no explicit timeout, reporting
the 5s default instead of a verdict, and an expectation still asserting a
limitation the code had since fixed. Both are recorded in `DESIGN.md` beside 46 so
they are not rediscovered as defects.

**A `RESULT FAIL` here is the highest-value failure this project can produce: it
means we write something MATLAB reads differently.** Triage it as a defect, not as
a test problem.

Every live `it` needs its own explicit timeout — there is no global one, and the 5s
default reports a timeout instead of whatever MATLAB was about to say.
`writeback.live.test.ts` uses `120_000` and the older suites `60_000`: a launch is
~21s in the steady state, but the FIRST of a session took over 65s because a cold
start pays the licence checkout and MATLAB's startup on top of the work, and that
file makes two dozen launches where the others make one or two. So a timeout on the
first case only is a cold start, not a defect. Expect `writeback.live` to take 8-10
minutes and a full MATLAB-configured `npm test` around 10.

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

Tier 1's four suites, `loadTruth.ts` and `expect.ts` landed in Phase 11 of
`PLAN.md`; `writeback.live.test.ts` and `drift.mjs` in Phase 12. The corpus is
also still read by `test/parity/loadFile.test.ts`, which is what proves the
format sniffing every tier-1 suite relies on.
