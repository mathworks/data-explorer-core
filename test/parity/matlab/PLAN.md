<!-- Copyright 2026 The MathWorks, Inc. -->

# MATLAB Parity Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 13 defects catalogued in `DESIGN.md` and land a committed, MATLAB-free test suite that pins every value shape, in every file format, against MATLAB-authored ground truth.

**Architecture:** MATLAB is a *fixture generator*, not a test dependency — `gen_truth.m` emits committed artifacts plus a truth JSON, and the tests read both. The display convention and the subscript rule each become one shared module that every code path calls, replacing the three-to-five duplicated copies that are the root cause of most defects here.

**Tech Stack:** TypeScript (ESM, `strict`), vitest, MATLAB R2027a (`mw -using Bmain matlab -nodesktop -batch`) for fixture generation only.

**Spec:** `test/parity/matlab/DESIGN.md` — approved. Read its *Display convention*, *Threshold rule*, and *Defects* sections before starting; this plan implements them and does not restate the rationale.

---

## Phase order and why

Ordered by value, subject to dependency. If work stops partway, everything completed is independently useful and committed.

| # | Phase | Defects closed | Depends on |
|---|---|---|---|
| 1 | Display convention module + shared test loader | — (foundation) | — |
| 2 | MATLAB truth corpus | — (foundation) | — |
| 3 | Shared subscript helper | **6, 8** | 1 |
| 4 | `.mat` struct-array elements | **10** | 3 |
| 5 | Text `.sldd` `cdata` MAT stream | **11** | — |
| 6 | `.sldd` rank preservation | **12** | 1 |
| 7 | Display convention wiring | **3, 4, 5, 7** | 1 |
| 8 | Container shape accessors | **9, 13** | 1, 3 |
| 9 | MCOS `string` decoding | **2** | — |
| 10 | 64-bit exactness | **1** | — |
| 11 | `expect.ts` + tier-1 parity suites | verifies all | 2, 7 |
| 12 | Live write-back tier + drift script | verifies write-back | 2, 11 |

Phase 1 is first because Phases 3, 6, 7 and 8 all import from it. Phase 2 is second because it needs MATLAB, which may not stay available, and because Phases 3–10 assert against its artifacts. Phase 3 is the highest-value *behaviour* fix: defect 6 currently names 4 of the 6 elements of a 2x3 object array after the wrong object.

---

## File structure

**New source modules** (both tiny, pure, no imports from `node/`, so no cycle risk):

- `src/datamodel/display/DisplayConvention.ts` — the thresholds, the empty spellings, `summaryForm`, `effectiveDims`, `elementCount`, `needsSummary`. One module so a value cannot render two ways depending on which parser produced it.
- `src/datamodel/display/Subscript.ts` — `subscriptLabel(name, index, dims, order, bracket)` and `ind2sub`. Replaces three duplicated copies of the subscript formula.

**Source modified:**

| File | Why |
|---|---|
| `src/datamodel/node/BaseNode.ts:256-275` | subscript copy #1 (numeric/cell/string elements) |
| `src/datamodel/node/data/ObjectNode.ts:178-199` | subscript copy #2; add `dims` accessor |
| `src/datamodel/node/data/StructNode.ts:224-245` | subscript copy #3; add `dims` accessor |
| `src/datamodel/node/data/MatlabVariableNode.ts` | `formatMatrix`, `_formatArray`, `_formatCell`, `_formatString`, `_formatScalar`, opaque `displayValue`, `parseCdata`, `_createFromMatStruct`, `_buildVarObject` |
| `src/datamodel/node/data/mcosTypedNode.ts:55` | stop truncating object-array rank |
| `src/datamodel/parser/BinarySlddParser.ts:52-62,480-501` | `parseDims` rank, N-D literal spelling |
| `src/datamodel/parser/MatParser.ts:129-130` | exact 64-bit values |
| `src/datamodel/parser/McosParser.ts` | `string` payload decoding |
| `src/datamodel/parser/XmlUtils.ts:13` | `formatMatlabNum` accepts `bigint` |
| `src/datamodel/prop/PropValue.ts:17-49` | share the thresholds and empty spelling |

**Tests created:**

```
test/displayConvention.test.ts       Phase 1  unit
test/subscript.test.ts               Phase 3  unit
test/parity/
  loadFile.ts                        Phase 1  THE loader every test below uses
  loadFile.test.ts                   Phase 1
test/parity/matlab/
  gen_truth.m                        Phase 2  MATLAB entry point
  README.md                          Phase 2  how to regenerate
  expect.ts                          Phase 11 the convention as a pure function
  loadTruth.ts                       Phase 11 artifact + truth loader
  expect.test.ts                     Phase 11 unit-tests expect.ts itself
  display.test.ts                    Phase 11
  structure.test.ts                  Phase 11
  schemaProps.test.ts                Phase 11
  lossless.test.ts                   Phase 11
  writeback.live.test.ts             Phase 12 gated on DEX_MATLAB_CMD
  drift.mjs                          Phase 12 dev script
```

**Artifact layout — one location, fixed here so the phases cannot drift.** The
corpus joins the existing fidelity artifacts rather than starting a parallel
tree, so `roundTripHarness.loadModel(format, fixture, uri)` — which resolves
`../artifacts/{text|binary}/<fixture>` — works on it unchanged:

```
test/parity/artifacts/
  truth.json          the single truth JSON, every format's expectations
  meta.json           MATLAB version + release that generated it
  text/params.sldd    (already committed, used by the fidelity suite)
  text/cases.sldd     Phase 2, uncompressed-text
  binary/params.sldd  (already committed)
  binary/cases.sldd   Phase 2, compressed-binary
  mat/cases.mat       Phase 2
  slx/cases.slx       Phase 2
```

`gen_truth.m` lives in `test/parity/matlab/` and writes to `../artifacts/`.
`loadTruth.ts` sits beside it and reads the same relative path. Nothing writes to
`test/parity/matlab/artifacts/` or `test/parity/matlab/truth/`.

Vitest's include glob is `test/**/*.test.ts` (see `vitest.config.ts`), so the
plain `*.test.ts` names above are picked up automatically — no config change.

**Existing tests that must change** (the fixes are deliberate behaviour changes; each is called out in the phase that causes it):

| Test | Line | Change | Phase |
|---|---|---|---|
| `test/objectArrayExpansion.test.ts` | 70-78 | 2x2 object labels become `m(1,1) m(2,1) m(1,2) m(2,2)` — the element list is column-major | 3 |
| `test/matlabVariableNode.test.ts` | 125 | `'[]'` -> `'[ ]'` | 7 |
| `test/matlabVariableNode.test.ts` | 133 | `{1x8 cell}` -> full literal (8 <= 10 elements); re-pin the summary with an 11-element cell and `<1x11 cell>` | 7 |
| `test/matlabVariableNode.test.ts` | 447 | `'[]'` -> `'[ ]'` | 7 |
| `test/matVariableFromMat.test.ts` | 98, 190 | `'[]'` -> `'[ ]'` | 7 |

`test/baseNode.test.ts:245,257` pin the rank-2 numeric and cell labels (`v(1,2)`, `c{1,2}`) and **must keep passing unchanged** — that path is row-major and is already correct. They are the regression guard for Phase 3.

---

## Decisions taken while writing this plan

Recorded here because the user is unavailable and these were judgment calls.

1. **Element *order* is not changed, only the labels.** `ObjectNode`/`StructNode` element lists arrive column-major. The fix labels element *i* with `ind2sub(i, dims)`, so a 2x3 array's rows read `w(1,1) w(2,1) w(1,2) …` — MATLAB's own `w(:)` order. The alternative (re-sorting children into row-major so the tree reads across rows) would also have to un-sort them in `StructNode`'s serialization for `.sldd` struct-array write-back, which is a live path. Labels-only is the smaller, reversible change and is what `DESIGN.md` defect 6 specifies.
2. **The char budget also acts as a runaway guard on expandable values.** `DESIGN.md` assigns element-count thresholds to expandable values and the char threshold to non-expandable ones. Applied literally, a 1x8 cell of 200-char strings renders as a 1600-char literal in a table cell. Since `SUMMARY_MAX_CHARS` is defined as a runaway guard rather than a display budget, Phase 7 applies it to every literal *in addition to* the element rule. Primary rule unchanged; this only bounds the pathological case. Update `DESIGN.md`'s threshold section to say so.
3. **`cdata` routes through `parseMatrix`, not a sniff.** The uudecoded payload is an 8-byte preamble plus a complete `miMATRIX` element, and `MatParser.parseMatrix` already handles complex, N-D, cell and struct — including the complex case the current code special-cases. So Phase 5 decodes once and dispatches through `parseMatVariable`, deleting the bespoke complex reader rather than adding a second one beside it.
4. **No `EnterPlanMode`.** `ExitPlanMode` blocks on user approval and the user is AFK; the plan is delivered as this file instead.

---

## Verification gate for every phase

Each phase ends with the same three commands. A phase is not done until all three are clean.

```bash
npm run typecheck
npm test
git add -A && git commit -m "[wip] <phase>"
```

Baseline at the start of this work: **82 test files, 1708 tests, all passing**; typecheck clean; branch `parity-matlab-fixes`.

---

## Phase 1: Display convention module and the shared test loader

Pure foundation. Adds no behaviour — nothing calls it until Phase 7 — so it cannot break a test on its own. Phases 3, 6, 7 and 8 all import from it.

### Task 1.1: `DisplayConvention.ts`

**Files:**
- Create: `src/datamodel/display/DisplayConvention.ts`
- Test: `test/displayConvention.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// Copyright 2026 The MathWorks, Inc.
//
// The display convention's arithmetic, in isolation. These pin the RULES; the
// rendered strings are pinned by test/matlabVariableNode.test.ts and by the
// parity suite against MATLAB truth.
import { describe, it, expect } from 'vitest';
import {
  SUMMARY_MAX_CHARS,
  SUMMARY_MAX_ELEMENTS,
  EMPTY_NUMERIC,
  EMPTY_CELL,
  effectiveDims,
  elementCount,
  needsSummary,
  overCharBudget,
  summaryForm,
} from '../src/datamodel/display/DisplayConvention.js';

describe('DisplayConvention constants', () => {
  it('keeps the two thresholds the spec agreed', () => {
    expect(SUMMARY_MAX_CHARS).toBe(1000);
    expect(SUMMARY_MAX_ELEMENTS).toBe(10);
  });

  it('spells empty with a space inside, both brackets', () => {
    expect(EMPTY_NUMERIC).toBe('[ ]');
    expect(EMPTY_CELL).toBe('{ }');
  });
});

describe('effectiveDims', () => {
  it('drops trailing singletons past the second, as MATLAB size() does', () => {
    expect(effectiveDims([2, 3, 1])).toEqual([2, 3]);
    expect(effectiveDims([2, 3, 1, 1])).toEqual([2, 3]);
  });

  it('keeps a real trailing extent and keeps interior singletons', () => {
    expect(effectiveDims([2, 3, 2])).toEqual([2, 3, 2]);
    expect(effectiveDims([2, 1, 2])).toEqual([2, 1, 2]);
  });

  it('normalizes degenerate input to a 2-D pair', () => {
    expect(effectiveDims([])).toEqual([1, 1]);
    expect(effectiveDims([5])).toEqual([1, 5]);
    expect(effectiveDims([1, 1])).toEqual([1, 1]);
  });
});

describe('elementCount', () => {
  it('multiplies every extent, including pages', () => {
    expect(elementCount([2, 3])).toBe(6);
    expect(elementCount([2, 3, 2])).toBe(12);
    expect(elementCount([0, 0])).toBe(0);
    expect(elementCount([1, 1])).toBe(1);
  });
});

describe('needsSummary', () => {
  it('is true for rank >= 3 at ANY size — mat2str itself has no literal for it', () => {
    expect(needsSummary([2, 2, 2])).toBe(true);
    expect(needsSummary([1, 1, 2])).toBe(true);
  });

  it('treats a trailing singleton as rank 2, not rank 3', () => {
    expect(needsSummary([2, 3, 1])).toBe(false);
  });

  it('is false at the element budget and true one past it', () => {
    expect(needsSummary([1, 10])).toBe(false);
    expect(needsSummary([1, 11])).toBe(true);
    expect(needsSummary([2, 5])).toBe(false);
    expect(needsSummary([3, 4])).toBe(true);
  });
});

describe('overCharBudget', () => {
  it('is false at the char budget and true one past it', () => {
    expect(overCharBudget('x'.repeat(SUMMARY_MAX_CHARS))).toBe(false);
    expect(overCharBudget('x'.repeat(SUMMARY_MAX_CHARS + 1))).toBe(true);
  });
});

describe('summaryForm', () => {
  it('always uses angle brackets — the italic and non-editable signal', () => {
    expect(summaryForm([1, 30], 'double')).toBe('<1x30 double>');
    expect(summaryForm([2, 3, 2], 'double')).toBe('<2x3x2 double>');
    expect(summaryForm([1, 3], 'cell')).toBe('<1x3 cell>');
    expect(summaryForm([0, 0], 'struct')).toBe('<0x0 struct>');
  });

  it('spells the shape the way MATLAB size() would', () => {
    expect(summaryForm([2, 3, 1], 'double')).toBe('<2x3 double>');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/displayConvention.test.ts`
Expected: FAIL — `Failed to resolve import "../src/datamodel/display/DisplayConvention.js"`.

- [ ] **Step 3: Write the module**

```ts
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

// A value with NO child rows is visible ONLY in the cell, so its budget is
// generous: a runaway guard against a pathological blob, not a display budget.
// char and scalar string.
export const SUMMARY_MAX_CHARS = 1000;

// A value WITH child rows is one expand away, so the cell is a summary and the
// budget is tight. Counted in ELEMENTS, not characters, so every 1x10 double
// renders like every other 1x10 double instead of depending on how many digits
// its values happen to have.
export const SUMMARY_MAX_ELEMENTS = 10;

// A space inside the brackets. This deviates from mat2str (`[]`) deliberately,
// and matches what the object-property path has always emitted.
export const EMPTY_NUMERIC = '[ ]';
export const EMPTY_CELL = '{ }';

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
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/displayConvention.test.ts`
Expected: PASS, 12 tests (2 constants + 3 `effectiveDims` + 1 `elementCount` + 3 `needsSummary` + 1 `overCharBudget` + 2 `summaryForm`).

- [ ] **Step 5: Full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; **83 files, 1720 tests, all passing** (nothing else imports the module yet, so no existing test can move). With Task 1.2's three tests as well, the full Phase 1 total is **84 files, 1723 tests**.

- [ ] **Step 6: Commit**

```bash
git add src/datamodel/display/DisplayConvention.ts test/displayConvention.test.ts
git commit -m "[wip] add the display convention as one shared module"
```

### Task 1.2: `test/parity/loadFile.ts` — the one loader every test uses

**Files:**
- Create: `test/parity/loadFile.ts`

This has to land before Phase 3 because every phase from there on opens a real
artifact, and eight hand-rolled loaders is how the suite ends up testing eight
different things.

- [ ] **Step 1: Write it**

Copy the module given verbatim under **Test harness conventions** (`bytesOf`,
`loadFile`, `flatten`, `findEntry`). Read that section now if you have not — it
also covers fixture locations, the default-vs-named export list, and the
`NodeClassMap` side-effect import.

- [ ] **Step 2: Prove it opens a committed artifact**

Create `test/parity/loadFile.test.ts`:

```ts
// Copyright 2026 The MathWorks, Inc.
//
// The loader is load-bearing for every parity suite, so it gets its own test:
// a broken loader would make every downstream suite fail for the wrong reason.
import { describe, it, expect } from 'vitest';
import { loadFile, findEntry, flatten } from './loadFile.js';

describe('loadFile', () => {
  it('opens a text .sldd through ingest and finds an entry', () => {
    const root = loadFile('./artifacts/text/params.sldd');
    expect(flatten(root).length).toBeGreaterThan(1);
    expect(findEntry(root, 'MyAlias').name).toBe('MyAlias');
  });

  it('opens the binary .sldd form of the same dictionary', () => {
    const root = loadFile('./artifacts/binary/params.sldd');
    expect(findEntry(root, 'MyAlias').name).toBe('MyAlias');
  });

  it('names the entries it does have when one is missing', () => {
    const root = loadFile('./artifacts/text/params.sldd');
    expect(() => findEntry(root, 'nope')).toThrow(/no entry "nope"; have: .*MyAlias/);
  });
});
```

- [ ] **Step 3: Run it**

Run: `npx vitest run test/parity/loadFile.test.ts`
Expected: PASS, 3 tests. A failure here is a fact about `ingest` worth knowing
before writing ten suites on top of it — if the binary case fails, check whether
`ingest`'s zip sniff needs the `.sldd` filename (`src/core/ingest.ts:56`).

- [ ] **Step 4: Commit**

```bash
git add test/parity/loadFile.ts test/parity/loadFile.test.ts
git commit -m "[wip] add the shared parity file loader"
```

---

## Phase 2: MATLAB truth corpus

Runs MATLAB once and commits what it produced. Everything from here on asserts against these files, so this phase is early: MATLAB may not stay available, and truth that exists cannot be argued with.

**Requires MATLAB.** Launch with `mw -using Bmain matlab -nodesktop -batch "run('<abs path>/gen_truth.m')"`. If MATLAB is unreachable, skip to Phase 3 — Phases 3–10 each carry hand-built fixtures using the values already MATLAB-verified in `DESIGN.md`, so only Phase 11 hard-blocks on this.

### Task 2.1: The case catalog and generator

**Files:**
- Create: `test/parity/matlab/gen_truth.m`

- [ ] **Step 1: Write the generator**

One catalog, every format emitted from it, so a new case is one line and appears everywhere. Where a case is illegal in a format, the failure is *recorded* rather than skipped, so the gap is visible in review.

> **DONE — the committed `test/parity/matlab/gen_truth.m` is authoritative, not this listing.** Six things
> below were contradicted by MATLAB and corrected in the file; the listing is kept for the reasoning, not
> as a source to copy. What MATLAB forced:
> 1. `Simulink.VariantVariable`'s `Choices` is `{condition, value, ...}` — `{'V == 1', 1, 'V == 2', 2}`, not
>    `{'A', Simulink.Parameter(1), ...}`.
> 2. `isobject("world")` is **true** — a `string` counts as an object, and `properties()` then reads the
>    string's *contents* as a class name. The property walk is gated `t.isobject && ~isstring(v) && isscalar(v)`.
> 3. `isscalar` in that guard matters on its own: `ar.Value` on a **nonscalar** Simulink data array does not
>    error, it silently returns element 1. Recording that as the array's property truth is a lie, so an object
>    array gets no `properties` block — its per-element truth is `linearSubs`/`linearValues`.
> 4. `formattedDisplayText` emits Command Window **HTML** for some classes (`struct` arrays, `Simulink.Bus`)
>    and not others, so no consumer can strip it with one rule. All seven call sites pass `'SuppressMarkup', true`.
> 5. `char` must not get per-element truth — DESIGN.md says char does not expand, and per-character
>    `linearValues` would make Phase 11 demand one child row per character. The element walk skips `ischar(v)`.
>    `string` is deliberately *not* skipped: a string array does expand.
> 6. MATLAB keys open dictionaries by **file name alone**, and a held section handle counts as a reference, so
>    two `cases.sldd` in different directories collide. The loop does `saveChanges; clear ds; close; clear dd;`
>    then `Simulink.data.dictionary.closeAll('-discard')`.
>
> Also settled: the `intmax('uint64')` entry is **`maxU64`**, and the model is named `cases`.

```matlab
% Copyright 2026 The MathWorks, Inc.
%
% Ground-truth generator for the MATLAB parity suite. Writes committed
% artifacts + truth JSON; the tests never launch MATLAB.
%
% Run:  matlab -nodesktop -batch "run('<abs path>/gen_truth.m')"
%
% Every array case is deliberately NON-SQUARE (2x3, never 2x2) and has a
% rank-3 sibling (2x3x2). A square fixture cannot distinguish row-major from
% column-major, and a rank-2 fixture cannot expose page handling; between them
% those two gaps hid six of the thirteen defects this suite exists to pin.

here = fileparts(mfilename('fullpath'));
% Honour an outdir set by the caller (drift.mjs, Phase 12) so the corpus can be
% regenerated to a scratch directory and diffed against what is committed.
if ~exist('outdir', 'var') || isempty(outdir)
    outdir = fullfile(here, '..', 'artifacts');
end
artdir = outdir;
for d = {artdir, fullfile(artdir,'mat'), fullfile(artdir,'slx'), ...
         fullfile(artdir,'text'), fullfile(artdir,'binary')}
    if ~exist(d{1}, 'dir'), mkdir(d{1}); end
end

%% ---- the catalog: {name, value} -------------------------------------------
C = {};
% primitives, scalar
C(end+1,:) = {'scalarD',   pi};
C(end+1,:) = {'negD',      -2.5};
C(end+1,:) = {'bigD',      1e300};
C(end+1,:) = {'tinyD',     1e-300};
C(end+1,:) = {'scalarS',   single(pi)};
C(end+1,:) = {'boolT',     true};
C(end+1,:) = {'boolF',     false};
C(end+1,:) = {'charStr',   'it''s'};
C(end+1,:) = {'strScalar', "world"};
C(end+1,:) = {'cplxScalar',3+4i};
% non-finites
C(end+1,:) = {'infP',      Inf};
C(end+1,:) = {'infN',      -Inf};
C(end+1,:) = {'nanV',      NaN};
C(end+1,:) = {'nonFinVec', [1 Inf -Inf NaN 5]};
% every integer class, scalar + extremes (64-bit is where precision breaks)
for cls = {'int8','int16','int32','int64','uint8','uint16','uint32','uint64'}
    k = cls{1};
    C(end+1,:) = {['s_' k],   cast(7, k)};
    C(end+1,:) = {['max_' k], intmax(k)};
    C(end+1,:) = {['min_' k], intmin(k)};
end
% shapes: row, column, NON-SQUARE matrix, rank 3, empty, over-threshold
C(end+1,:) = {'rowVec',  [1 2 3]};
C(end+1,:) = {'colVec',  [1; 2; 3]};
C(end+1,:) = {'mat2x3',  [1 2 3; 4 5 6]};
A = zeros(2,3,2); A(:,:,1) = [1 2 3; 4 5 6]; A(:,:,2) = [7 8 9; 10 11 12];
C(end+1,:) = {'nd2x3x2', A};
C(end+1,:) = {'emptyD',  []};
C(end+1,:) = {'long30',  1:30};
C(end+1,:) = {'exactly10', 1:10};
C(end+1,:) = {'eleven',  1:11};
C(end+1,:) = {'boolVec', [true false true]};
C(end+1,:) = {'i16Vec',  int16([1 2 3])};
C(end+1,:) = {'cplxVec', [1+2i 3-4i]};
% char / string arrays
C(end+1,:) = {'strArray', ["a" "bb" "ccc"]};
C(end+1,:) = {'strMat',   ["a" "bb" "ccc"; "d" "ee" "fff"]};
C(end+1,:) = {'longChar', repmat('x', 1, 300)};
C(end+1,:) = {'hugeChar', repmat('y', 1, 1500)};
% cells
C(end+1,:) = {'cellFlat',  {1, 'two', [3 4]}};
C(end+1,:) = {'cellNest',  {1, {2, {3}}}};
C(end+1,:) = {'cell2x3',   {1 2 3; 4 5 6}};
Cnd = cell(2,2,2); for k = 1:8, Cnd{k} = k; end
C(end+1,:) = {'cellNd',    Cnd};
C(end+1,:) = {'cellEmpty', {}};
% structs
C(end+1,:) = {'structScalar', struct('a', 1, 'b', 'txt')};
C(end+1,:) = {'structNest',   struct('a', struct('b', 2))};
clear sa; for k = 1:3, sa(k).a = k; sa(k).b = k*10; end
C(end+1,:) = {'struct1x3', sa};
clear sm; for k = 1:6, sm(k).a = k; end
C(end+1,:) = {'struct2x3', reshape(sm, [2 3])};
clear sn; for k = 1:12, sn(k).a = k; end
C(end+1,:) = {'structNd',  reshape(sn, [2 3 2])};
C(end+1,:) = {'structEmpty', struct([])};

%% ---- objects: scalars of every known class, plus object ARRAYS ------------
% Known classes get non-default values on writable properties so a dropped or
% defaulted property is detectable.
p = Simulink.Parameter(5); p.Description = 'a param'; p.Min = -10; p.Max = 10;
p.Unit = 'm/s'; p.DataType = 'int16';
C(end+1,:) = {'aParam', p};
sg = Simulink.Signal; sg.Description = 'a signal'; sg.DataType = 'single';
sg.Unit = 'K'; sg.Min = 0; sg.Max = 100;
C(end+1,:) = {'aSignal', sg};
b = Simulink.Bus; b.Description = 'a bus';
e1 = Simulink.BusElement; e1.Name = 'x'; e1.DataType = 'double'; e1.Dimensions = 3;
e2 = Simulink.BusElement; e2.Name = 'y'; e2.DataType = 'int8';
b.Elements = [e1 e2];
C(end+1,:) = {'aBus', b};
lt = Simulink.LookupTable; lt.StructTypeInfo.Name = 'LtType';
C(end+1,:) = {'aLookup', lt};
vv = Simulink.VariantVariable('Choices', {'A', Simulink.Parameter(1), 'B', Simulink.Parameter(2)});
C(end+1,:) = {'aVariant', vv};
% object ARRAYS -- .mat ONLY. Both the dictionary AND the .slx model workspace
% reject them in R2027a; each refusal is recorded, not worked around (see below).
% Value = row*10 + col makes the label->value mapping self-describing, which is
% what catches a transposed read.
clear w; for i = 1:2, for j = 1:3, w(i,j) = Simulink.Parameter(i*10 + j); end, end
OBJARR = {'objRow', [Simulink.Parameter(1) Simulink.Parameter(2) Simulink.Parameter(3)]
          'objCol', [Simulink.Parameter(1); Simulink.Parameter(2); Simulink.Parameter(3)]
          'obj2x3', w
          'obj2x3x2', reshape(arrayfun(@(k) Simulink.Parameter(k), 1:12), [2 3 2])};

%% ---- truth ---------------------------------------------------------------
% Field names are load-bearing: loadTruth.ts's Truth interface and drift.mjs
% both read `vars`, `objArr` and `notes.slddRejected`. Do not rename them here
% without changing both.
truth = struct('vars', struct(), 'objArr', struct(), 'notes', struct());
for i = 1:size(C,1)
    truth.vars.(C{i,1}) = truthOf(C{i,1}, C{i,2});
end
for i = 1:size(OBJARR,1)
    truth.objArr.(OBJARR{i,1}) = truthOf(OBJARR{i,1}, OBJARR{i,2});
end

%% ---- .mat ---------------------------------------------------------------
matvars = struct();
for i = 1:size(C,1),      matvars.(C{i,1})      = C{i,2}; end
for i = 1:size(OBJARR,1), matvars.(OBJARR{i,1}) = OBJARR{i,2}; end
save(fullfile(artdir,'mat','cases.mat'), '-struct', 'matvars');

%% ---- .slx model workspace ------------------------------------------------
% It does NOT hold object arrays either: assignin of a Simulink.Parameter array
% fails with "Creating an array of Simulink data or data type objects in the
% model workspace is not allowed." So every assignin is guarded exactly like the
% dictionary loop below, and the refusal is recorded in truth.notes.slxRejected
% (one level, entry name -> message, 'ACCEPTED' when it went in).
mdl = 'cases';
if bdIsLoaded(mdl), close_system(mdl, 0); end
new_system(mdl);
ws = get_param(mdl, 'ModelWorkspace');
slxRejected = struct();
for i = 1:size(C,1),      assignin(ws, C{i,1}, C{i,2}); end
for i = 1:size(OBJARR,1)
    try
        assignin(ws, OBJARR{i,1}, OBJARR{i,2});
        slxRejected.(OBJARR{i,1}) = 'ACCEPTED';
    catch e
        slxRejected.(OBJARR{i,1}) = e.message;
    end
end
truth.notes.slxRejected = slxRejected;
save_system(mdl, fullfile(artdir,'slx','cases.slx'), 'OverwriteIfChangedOnDisk', true);
close_system(mdl, 0);

%% ---- .sldd, both formats -------------------------------------------------
% Format is a PROPERTY; there is no format argument to create().
rejected = struct();
for fmt = {'uncompressed-text', 'compressed-binary'}
    f = fmt{1};
    sub = strrep(strrep(f, 'uncompressed-', ''), 'compressed-', '');
    fn = fullfile(artdir, sub, 'cases.sldd');   % artifacts/text/, artifacts/binary/
    if exist(fn, 'file'), delete(fn); end
    dd = Simulink.data.dictionary.create(fn);
    dd.FileFormat = f;
    ds = dd.getSection('Design Data');
    for i = 1:size(C,1)
        try
            ds.addEntry(C{i,1}, C{i,2});
        catch e
            rejected.(sub).(C{i,1}) = e.message;
        end
    end
    % Record the object-array boundary as truth rather than as a comment.
    for i = 1:size(OBJARR,1)
        try
            ds.addEntry(OBJARR{i,1}, OBJARR{i,2});
            rejected.(sub).(OBJARR{i,1}) = 'ACCEPTED';
        catch e
            rejected.(sub).(OBJARR{i,1}) = e.message;
        end
    end
    dd.saveChanges();
    dd.close();
end
truth.notes.slddRejected = rejected;

%% ---- write truth JSON ---------------------------------------------------
% ONE truth file, not one per format. A value's class, size and display are
% properties of the value, not of the container it was stored in; the per-format
% differences are all in notes.slddRejected. Four copies of the same JSON would
% just be four things to keep in sync.
writeJson(fullfile(artdir,'truth.json'), truth);
writeJson(fullfile(artdir,'meta.json'), ...
          struct('version', version, 'release', version('-release')));
disp('GEN_TRUTH OK');

%% ---- local functions ----------------------------------------------------
function t = truthOf(name, v)
    t = struct();
    t.name = name;
    t.class = class(v);
    t.size = size(v);
    t.numel = numel(v);
    t.iscomplex = ~isreal(v);
    t.islogical = islogical(v);
    t.isobject = isobject(v);
    t.isempty = isempty(v);
    t.disp = strtrim(formattedDisplayText(v));
    % mat2str ERRORS on rank >= 3 ("Input matrix must be 2-D"). That error IS
    % ground truth: it is why the fix collapses N-D to <2x3x2 double> instead
    % of inventing a multi-page literal.
    try
        t.mat2str = mat2str(v);
    catch e
        t.mat2str_error = e.message;
    end
    % One subscript label per element, in MATLAB's own column-major linear
    % order, so a transposed read is detectable element by element.
    n = numel(v);
    if n > 1 && n <= 64
        subs = cell(1, n);
        vals = cell(1, n);
        for k = 1:n
            subs{k} = subLabel(name, size(v), k, iscell(v));
            vals{k} = elemText(v, k);
        end
        t.linearSubs = subs;
        t.linearValues = vals;
    end
    if isobject(v)
        t.properties = propTruth(v);
    end
end

function s = subLabel(name, sz, k, isCell)
    sz = sz(1:max(2, find([sz 2] > 1, 1, 'last')));
    while numel(sz) > 2 && sz(end) == 1, sz(end) = []; end
    if sum(sz > 1) <= 1
        idx = sprintf('%d', k);
    else
        c = cell(1, numel(sz));
        [c{:}] = ind2sub(sz, k);
        idx = strjoin(cellfun(@(x) sprintf('%d', x), c, 'UniformOutput', false), ',');
    end
    if isCell
        s = sprintf('%s{%s}', name, idx);
    else
        s = sprintf('%s(%s)', name, idx);
    end
end

function txt = elemText(v, k)
    try
        if iscell(v)
            txt = strtrim(formattedDisplayText(v{k}));
        elseif isobject(v) && isprop(v, 'Value')
            txt = strtrim(formattedDisplayText(v(k).Value));
        elseif isstruct(v)
            f = fieldnames(v);
            txt = strtrim(formattedDisplayText(v(k).(f{1})));
        else
            txt = strtrim(formattedDisplayText(v(k)));
        end
    catch e
        txt = ['<error: ' e.message '>'];
    end
end

function p = propTruth(v)
    p = struct();
    names = properties(v);
    for i = 1:numel(names)
        n = names{i};
        try
            val = v.(n);
            p.(n) = struct('class', class(val), 'size', size(val), ...
                           'numel', numel(val), 'isempty', isempty(val), ...
                           'disp', strtrim(formattedDisplayText(val)));
            % A property's literal matters as much as an entry's — without it
            % expect.ts has nothing to compare and would summarize every
            % property, including a char like BaseType='int32'.
            try
                p.(n).mat2str = mat2str(val);
            catch e2
                p.(n).mat2str_error = e2.message;
            end
        catch e
            p.(n) = struct('error', e.message);
        end
    end
end

function writeJson(path, data)
    fid = fopen(path, 'w');
    fprintf(fid, '%s', jsonencode(data, 'PrettyPrint', true));
    fclose(fid);
end
```

- [ ] **Step 2: Run it**

```bash
cd /Users/weiwang/projects/data-explorer-core
mw -using Bmain matlab -nodesktop -batch "run('$PWD/test/parity/matlab/gen_truth.m')"
```

Expected: `GEN_TRUTH OK` on stdout, and these files present:

```bash
ls -R test/parity/artifacts
```
Expected, alongside the already-committed `text/params.sldd` and `binary/params.sldd`:
`truth.json`, `meta.json`, `mat/cases.mat`, `slx/cases.slx`, `text/cases.sldd`, `binary/cases.sldd`.

- [ ] **Step 3: Fix whatever MATLAB rejected**

Errors are expected on the first run — the catalog is aggressive on purpose. Two rules:

- A case MATLAB refuses to *construct* (a class whose constructor needs arguments, a property that is read-only in R2027a) is a bug in this script: fix the script.
- A case MATLAB refuses to *store in a dictionary* is truth: it lands in `truth.notes.slddRejected` and stays. Object arrays are the known instance — `addEntry` answers "Arrays of class 'Simulink.Parameter' are not supported in the dictionary." Confirm that string appears for all four `OBJARR` entries in both formats.

Iterate until `GEN_TRUTH OK` prints with no uncaught error.

- [ ] **Step 4: Sanity-check the truth by hand, then commit**

```bash
node -e "const t=require('./test/parity/artifacts/truth.json'); \
console.log(t.vars.nd2x3x2.mat2str_error, '|', t.vars.mat2x3.mat2str, '|', \
t.vars.maxU64.disp, '|', t.objArr.obj2x3.linearValues.join(','));"
```

Expected, and these four are the load-bearing ones:
- `nd2x3x2.mat2str_error` contains **"must be 2-D"** — proves defect 7's fix shape.
- `mat2x3.mat2str` is `[1 2 3;4 5 6]` — the literal our convention adds a space to.
- `maxU64.disp` is `18446744073709551615` — proves defect 1 is real data loss, not rounding taste. (The
  integer loop special-cases `uint64`, so `intmax('uint64')` is the single entry `maxU64`; Phases 10 and
  12 already spell it that way.)
- `obj2x3.linearValues` is `11,21,12,22,13,23` — column-major, which is defect 6's whole story.

```bash
git add test/parity/matlab/gen_truth.m test/parity/artifacts
git commit -m "[wip] add MATLAB-authored parity artifacts and truth JSON"
```

### Task 2.2: README

**Files:**
- Create: `test/parity/matlab/README.md`

- [ ] **Step 1: Write it**

```markdown
<!-- Copyright 2026 The MathWorks, Inc. -->

# MATLAB parity fixtures

`artifacts/` and `truth/` are **generated**. Do not hand-edit them.

MATLAB is a fixture generator, not a test dependency: it cannot run in GitHub CI,
so a MATLAB-gated suite would never actually run for a public repo. Instead MATLAB
emits truth once, the truth is committed, and the tests read it.

## Regenerate

    mw -using Bmain matlab -nodesktop -batch "run('$PWD/test/parity/matlab/gen_truth.m')"

Prints `GEN_TRUTH OK`. Then `npm test` — a diff in the artifacts with no diff in the
tests means MATLAB changed its own output; see `drift.mjs`.

## Layout

| path | what |
|---|---|
| `gen_truth.m` | the only entry point; one case catalog, every format emitted from it |
| `artifacts/mat/cases.mat` | every case, including object arrays |
| `artifacts/slx/cases.slx` | model `cases`; the same catalog **minus the object arrays**, which the model workspace also refuses |
| `artifacts/text/cases.sldd` | `FileFormat = 'uncompressed-text'` (the R2027a default) |
| `artifacts/binary/cases.sldd` | `FileFormat = 'compressed-binary'` |
| `artifacts/truth.json` | per entry: class, size, complexity, emptiness, `mat2str`, `disp`, per-element subscripts and values, and for objects the full property list; plus `notes.slddRejected` |
| `artifacts/meta.json` | the MATLAB release the truth came from |

## Three facts the corpus encodes

- **A dictionary cannot hold an object array at all.** `addEntry` rejects
  `Simulink.Parameter`, `Simulink.Bus`, even a 1x2: *"Arrays of class
  'Simulink.Parameter' are not supported in the dictionary."* Recorded in
  `truth.notes.slddRejected`, per format.
- **Neither can a `.slx` model workspace.** `assignin` fails with *"Creating an array
  of Simulink data or data type objects in the model workspace is not allowed."*
  Recorded in `truth.notes.slxRejected` (one level, not per format). So **object-array
  parity is a `.mat` question only** — `cases.mat` is the sole artifact holding all 74
  names. DESIGN.md's earlier claim that the model workspace holds object arrays is
  wrong for R2027a; MATLAB was asked and it refused.
- **`mat2str` errors on rank >= 3.** There is no one-line MATLAB literal for an N-D
  array, which is why our convention collapses it to `<2x3x2 double>` rather than
  printing a 2-D-looking lie. (`mat2str` also refuses objects outright, with a
  different message: *"Input matrix must be a numeric array, character array, or
  string array."*)

## Shapes are deliberately non-square

Every array case is 2x3, never 2x2, and has a 2x3x2 sibling. A square fixture cannot
distinguish row-major from column-major; a rank-2 fixture cannot expose page handling.
Between them those two gaps hid six of the thirteen defects in `DESIGN.md`.
```

- [ ] **Step 2: Commit**

```bash
git add test/parity/matlab/README.md
git commit -m "[wip] document how to regenerate the parity fixtures"
```

---

## Phase 3: Shared subscript helper — defects 6 and 8

The highest-value behaviour fix. Today a 2x3 `Simulink.Parameter` array labels 4 of its 6 elements after the wrong object, and every rank->=3 array emits subscripts for elements that do not exist (`A(4,3)` in a two-row array). The same formula is written **three** times and is wrong in all three.

### Task 3.1: `Subscript.ts`

**Files:**
- Create: `src/datamodel/display/Subscript.ts`
- Test: `test/subscript.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// Copyright 2026 The MathWorks, Inc.
//
// The subscript rule, in isolation. The two orders are the crux: numeric, cell
// and string element lists reach the node layer ROW-major (MatParser transposes
// each page on the way in), while object and struct element lists reach it
// COLUMN-major (MATLAB's own order, which the MCOS decoder and both SLDD paths
// preserve). One helper, told which it is holding.
import { describe, it, expect } from 'vitest';
import { subscriptLabel, ind2sub } from '../src/datamodel/display/Subscript.js';

describe('ind2sub', () => {
  it('matches MATLAB ind2sub on a 0-based column-major index', () => {
    // MATLAB: [r,c] = ind2sub([2 3], 1:6) -> (1,1)(2,1)(1,2)(2,2)(1,3)(2,3)
    const got = [0, 1, 2, 3, 4, 5].map((i) => ind2sub(i, [2, 3]).join(','));
    expect(got).toEqual(['1,1', '2,1', '1,2', '2,2', '1,3', '2,3']);
  });

  it('extends to rank 3', () => {
    expect(ind2sub(0, [2, 3, 2]).join(',')).toBe('1,1,1');
    expect(ind2sub(6, [2, 3, 2]).join(',')).toBe('1,1,2');
    expect(ind2sub(11, [2, 3, 2]).join(',')).toBe('2,3,2');
  });
});

describe('subscriptLabel — vectors take a single linear subscript', () => {
  it('numbers a row vector, a column vector and a scalar-ish list linearly', () => {
    for (const dims of [[1, 3], [3, 1]]) {
      expect([0, 1, 2].map((i) => subscriptLabel('v', i, dims, 'row-major', '()'))).toEqual([
        'v(1)', 'v(2)', 'v(3)',
      ]);
    }
  });

  it('uses braces for cells', () => {
    expect(subscriptLabel('c', 1, [1, 3], 'row-major', '{}')).toBe('c{2}');
  });
});

describe('subscriptLabel — row-major lists (numeric, cell, string)', () => {
  it('labels a 2x3 across the rows, which is what the existing tests pin', () => {
    const got = [0, 1, 2, 3, 4, 5].map((i) => subscriptLabel('v', i, [2, 3], 'row-major', '()'));
    expect(got).toEqual(['v(1,1)', 'v(1,2)', 'v(1,3)', 'v(2,1)', 'v(2,2)', 'v(2,3)']);
  });

  it('labels a 2x2 cell across the rows', () => {
    const got = [0, 1, 2, 3].map((i) => subscriptLabel('c', i, [2, 2], 'row-major', '{}'));
    expect(got).toEqual(['c{1,1}', 'c{1,2}', 'c{2,1}', 'c{2,2}']);
  });

  it('emits a THREE-part subscript for rank 3 — never a row index past the row count', () => {
    // MatParser hands us pages in order, each page row-major.
    const got = Array.from({ length: 12 }, (_, i) => subscriptLabel('A', i, [2, 3, 2], 'row-major', '()'));
    expect(got).toEqual([
      'A(1,1,1)', 'A(1,2,1)', 'A(1,3,1)', 'A(2,1,1)', 'A(2,2,1)', 'A(2,3,1)',
      'A(1,1,2)', 'A(1,2,2)', 'A(1,3,2)', 'A(2,1,2)', 'A(2,2,2)', 'A(2,3,2)',
    ]);
    expect(got.some((s) => /\(3,|\(4,/.test(s))).toBe(false);
  });
});

describe('subscriptLabel — column-major lists (object, struct)', () => {
  it('labels a 2x3 in MATLAB linear order, so label i names element i', () => {
    const got = [0, 1, 2, 3, 4, 5].map((i) => subscriptLabel('w', i, [2, 3], 'column-major', '()'));
    expect(got).toEqual(['w(1,1)', 'w(2,1)', 'w(1,2)', 'w(2,2)', 'w(1,3)', 'w(2,3)']);
  });

  it('labels a 2x2 in column order — the square case that hid the transpose', () => {
    const got = [0, 1, 2, 3].map((i) => subscriptLabel('m', i, [2, 2], 'column-major', '()'));
    expect(got).toEqual(['m(1,1)', 'm(2,1)', 'm(1,2)', 'm(2,2)']);
  });

  it('extends to rank 3', () => {
    const got = Array.from({ length: 12 }, (_, i) => subscriptLabel('v', i, [2, 3, 2], 'column-major', '()'));
    expect(got[0]).toBe('v(1,1,1)');
    expect(got[11]).toBe('v(2,3,2)');
    expect(got.some((s) => /\(3,|\(4,/.test(s))).toBe(false);
  });
});

describe('subscriptLabel — shape normalization', () => {
  it('treats a trailing singleton as rank 2', () => {
    expect(subscriptLabel('A', 1, [2, 3, 1], 'row-major', '()')).toBe('A(1,2)');
  });

  it('falls back to a linear subscript when dims are missing', () => {
    expect(subscriptLabel('v', 0, undefined, 'row-major', '()')).toBe('v(1)');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/subscript.test.ts`
Expected: FAIL — cannot resolve `Subscript.js`.

- [ ] **Step 3: Write the module**

```ts
// Copyright 2026 The MathWorks, Inc.
//
// MATLAB subscript labels for array element rows, in ONE place. Three call
// sites used to carry their own copy of this formula:
//
//   BaseNode.displayName   numeric / cell / string elements  (row-major list)
//   ObjectNode.parse       object-array elements             (column-major list)
//   StructNode.parse       struct-array elements             (column-major list)
//
// All three consulted dims[0] and dims[1] only, so every rank->=3 array emitted
// subscripts for elements that do not exist (A(4,3) in a two-row array), and the
// two column-major sites additionally read their list as if it were row-major,
// which named 4 of the 6 elements of a 2x3 object array after the wrong object.
// Vectors hid it, because there the two orders coincide -- and every fixture the
// repo had was a vector.
import { effectiveDims } from './DisplayConvention.js';

// Which order the caller's element list is in. NOT a property of the data: it is
// a property of the PATH the data took to get here.
export type ElementOrder = 'row-major' | 'column-major';
export type Bracket = '()' | '{}';

// MATLAB's ind2sub, on a 0-based column-major linear index.
export function ind2sub(colMajorIndex: number, dims: number[] | undefined | null): number[] {
  const d = effectiveDims(dims);
  const subs: number[] = [];
  let rest = colMajorIndex;
  for (let k = 0; k < d.length; k++) {
    subs.push((rest % d[k]) + 1);
    rest = Math.floor(rest / d[k]);
  }
  return subs;
}

// Where element `linearIndex` of a row-major-within-page list sits in MATLAB's
// own column-major order. This is the exact inverse of the reordering
// MatParser.transposeFromColMajor applies on the way in: per page, page order
// untouched.
function toColumnMajorIndex(linearIndex: number, dims: number[]): number {
  const rows = dims[0];
  const cols = dims[1];
  if (rows <= 1 || cols <= 1) {
    return linearIndex;
  }
  const page = rows * cols;
  const p = Math.floor(linearIndex / page);
  const within = linearIndex % page;
  const r = Math.floor(within / cols);
  const c = within % cols;
  return p * page + c * rows + r;
}

// `name(2,1)` / `name{1,2,2}` / `name(3)`.
//
// A vector takes the single linear subscript MATLAB itself uses, which is both
// correct and what the existing suite pins.
export function subscriptLabel(
  name: string,
  linearIndex: number,
  dims: number[] | undefined | null,
  order: ElementOrder,
  bracket: Bracket,
): string {
  const d = effectiveDims(dims);
  const open = bracket === '{}' ? '{' : '(';
  const close = bracket === '{}' ? '}' : ')';
  const spread = d.filter(function (n) {
    return n > 1;
  }).length;
  if (spread <= 1) {
    return name + open + (linearIndex + 1) + close;
  }
  const colMajor = order === 'column-major' ? linearIndex : toColumnMajorIndex(linearIndex, d);
  return name + open + ind2sub(colMajor, d).join(',') + close;
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/subscript.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/datamodel/display/Subscript.ts test/subscript.test.ts
git commit -m "[wip] add the subscript rule as one shared helper"
```

### Task 3.2: Wire `BaseNode.displayName` (subscript copy 1 of 3)

**Files:**
- Modify: `src/datamodel/node/BaseNode.ts:256-275`
- Test: `test/baseNode.test.ts` (add; the existing rank-2 cases must not move)

- [ ] **Step 1: Write the failing test** — append inside the existing `describe('BaseNode.displayName for positional elements', …)` block in `test/baseNode.test.ts`, reusing that file's local `withChildren` helper:

```ts
  it('emits a three-part subscript for a rank-3 array, not a row index past the rows', () => {
    const p = new BaseNode('A', null);
    (p as any)._kind = 'array';
    (p as any)._dims = [2, 3, 2];
    const got = withChildren(p, 12).map((k) => k.displayName);
    expect(got).toEqual([
      'A(1,1,1)', 'A(1,2,1)', 'A(1,3,1)', 'A(2,1,1)', 'A(2,2,1)', 'A(2,3,1)',
      'A(1,1,2)', 'A(1,2,2)', 'A(1,3,2)', 'A(2,1,2)', 'A(2,2,2)', 'A(2,3,2)',
    ]);
  });

  it('emits a three-part BRACED subscript for a rank-3 cell', () => {
    const p = new BaseNode('C', null);
    (p as any)._kind = 'cell';
    (p as any)._dims = [2, 2, 2];
    const got = withChildren(p, 8).map((k) => k.displayName);
    expect(got[0]).toBe('C{1,1,1}');
    expect(got[7]).toBe('C{2,2,2}');
    expect(got.some((s) => /\{3,|\{4,/.test(s))).toBe(false);
  });
```

Check the helper's real name and signature first: `sed -n '215,260p' test/baseNode.test.ts`. If `withChildren(parent, n)` differs, adapt the two calls — do not change the helper.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/baseNode.test.ts`
Expected: FAIL — got `A(1,1) A(1,2) A(1,3) A(2,1) … A(4,3)`, i.e. row subscripts running to 4 in a two-row array.

- [ ] **Step 3: Replace the formula with a call to the helper**

In `src/datamodel/node/BaseNode.ts`, add the import beside the existing ones:

```ts
import { subscriptLabel } from '../display/Subscript.js';
```

Replace lines 256-275 (the whole `get displayName()`) with:

```ts
  get displayName(): string {
    if (
      this.parent &&
      (this.parent._kind === 'cell' || this.parent._kind === 'array' || this.parent._kind === 'string')
    ) {
      // Numeric, cell and string element lists reach the node layer ROW-major:
      // MatParser.transposeFromColMajor reorders each page on the way in, and
      // the SLDD paths build the list the same way. So label i names element i
      // of a row-major list -- see Subscript.ts.
      return subscriptLabel(
        this.parent.displayName,
        this.parent.children.indexOf(this),
        this.parent._dims,
        'row-major',
        this.parent._kind === 'cell' ? '{}' : '()',
      );
    }
    return this._displayName || this.name;
  }
```

Note the `_dims!` non-null assertion is gone: `effectiveDims` handles `undefined`, and a `string`-kind parent built by a mutation path can legitimately have no dims yet.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/baseNode.test.ts`
Expected: PASS — including the pre-existing `v(1,2)` / `c{1,2}` / `c{1}(1)` cases at lines 232-267, unchanged. If any of those moved, the helper's row-major arm is wrong; fix the helper, not the test.

- [ ] **Step 5: Commit**

```bash
git add src/datamodel/node/BaseNode.ts test/baseNode.test.ts
git commit -m "[wip] fix rank-3 subscripts on the numeric/cell/string element path"
```

### Task 3.3: Wire `ObjectNode` and `StructNode` (copies 2 and 3)

**Files:**
- Modify: `src/datamodel/node/data/ObjectNode.ts:178-199`
- Modify: `src/datamodel/node/data/StructNode.ts:224-245`
- Modify: `test/objectArrayExpansion.test.ts:70-78` (behaviour change)
- Test: `test/objectArrayExpansion.test.ts`, `test/structNode.test.ts` (add)

- [ ] **Step 1: Write the failing tests**

First, **correct** the existing 2x2 expectation at `test/objectArrayExpansion.test.ts:70-78`. The element list is column-major, so the square case was transposed too — the *set* of labels was right, which is why it looked fine:

```ts
  it('labels a 2x2 matrix of objects in MATLAB column-major order', () => {
    const val = arrayValue('Simulink.Parameter', [2, 2], [
      { Value: 1 }, { Value: 2 }, { Value: 3 }, { Value: 4 },
    ]);
    const node = NodeRegistry.parseValue(val, 'm', null);
    // The elements arrive in MATLAB's own order, so element 2 IS m(2,1).
    expect(node.children.map((c: any) => c._displayName)).toEqual([
      'm(1,1)', 'm(2,1)', 'm(1,2)', 'm(2,2)',
    ]);
  });
```

Then add the two cases that actually catch the defects, in the same describe block:

```ts
  it('maps a 2x3 object array label to the value MATLAB puts there', () => {
    // MATLAB-authored truth (gen_truth.m, obj2x3): Value = row*10 + col, and
    // the element list arrives column-major: 11 21 12 22 13 23.
    const val = arrayValue('Simulink.Parameter', [2, 3], [
      { Value: 11 }, { Value: 21 }, { Value: 12 },
      { Value: 22 }, { Value: 13 }, { Value: 23 },
    ]);
    const node = NodeRegistry.parseValue(val, 'w', null);
    const pairs = node.children.map((c: any) => [c._displayName, c.Value]);
    expect(pairs).toEqual([
      ['w(1,1)', 11], ['w(2,1)', 21], ['w(1,2)', 12],
      ['w(2,2)', 22], ['w(1,3)', 13], ['w(2,3)', 23],
    ]);
  });

  it('emits three-part subscripts for a rank-3 object array', () => {
    const elems = Array.from({ length: 12 }, (_, i) => ({ Value: i + 1 }));
    const val = arrayValue('Simulink.Parameter', [2, 3, 2], elems);
    const node = NodeRegistry.parseValue(val, 'v', null);
    const labels = node.children.map((c: any) => c._displayName);
    expect(labels[0]).toBe('v(1,1,1)');
    expect(labels[11]).toBe('v(2,3,2)');
    expect(labels.some((s: string) => /\(3,|\(4,/.test(s))).toBe(false);
  });
```

And in `test/structNode.test.ts`, using that file's existing raw-value helper (check its name with `grep -n 'function .*Value\|const .*= (' test/structNode.test.ts | head`):

```ts
  it('labels a 2x3 struct array in MATLAB column-major order', () => {
    const val = {
      _mw_element_type: 'MATLABStruct',
      _dimensions: [2, 3],
      _fields: ['a'],
      _elements: [11, 21, 12, 22, 13, 23].map((n) => ({ a: { _type: 'double', _value: String(n) } })),
    };
    const node = StructNode.parse(val as any, 's', null);
    const pairs = node.children.map((c: any) => [c._displayName, c.children[0].displayValue]);
    expect(pairs).toEqual([
      ['s(1,1)', '11'], ['s(2,1)', '21'], ['s(1,2)', '12'],
      ['s(2,2)', '22'], ['s(1,3)', '13'], ['s(2,3)', '23'],
    ]);
  });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run test/objectArrayExpansion.test.ts test/structNode.test.ts`
Expected: FAIL — the 2x3 case reports `w(1,2)` holding 21 (MATLAB says 12), and the rank-3 case reports `v(4,3)`.

- [ ] **Step 3: Replace both formulas**

In `src/datamodel/node/data/ObjectNode.ts`, add:

```ts
import { subscriptLabel } from '../../display/Subscript.js';
```

and replace lines 178-199 with:

```ts
            const dims = (rawVal._dimensions as number[]) || [1, elements.length];
            elements.forEach((elem, ei) => {
                // Each element is a SCALAR object of the same class. Route it back
                // through NodeRegistry as a single-element value object so a KNOWN
                // class (Simulink.Parameter, …) becomes its own typed node and an
                // unknown/custom class becomes a scalar ObjectNode — the same
                // dispatch a standalone scalar would take.
                const elemRaw = {
                    _array_class: arrayClass,
                    _array_type: 'MATLABArray',
                    _dimensions: [1, 1],
                    _mw_element_type: (rawVal._mw_element_type as string) || 'MATLABArray',
                    _elements: [{ _properties: (elem._properties as Record<string, unknown>) || {} }],
                };
                const elemNode = NodeRegistry.parseValue(elemRaw, String(ei), node) as DataNode;
                // The MCOS decoder and both SLDD paths deliver elements in MATLAB's
                // own COLUMN-major order, so element ei is MATLAB's linear index
                // ei+1. Reading it row-major named 4 of the 6 elements of a 2x3
                // array after the wrong object.
                elemNode._displayName = subscriptLabel(name, ei, dims, 'column-major', '()');
                node.addChild(elemNode);
            });
```

In `src/datamodel/node/data/StructNode.ts`, add the same import and replace lines 225-239's `dims`/`rows`/`cols`/`isMatrix`/`_displayName` block with:

```ts
            const dims = (rawVal._dimensions as number[]) || [1, elements.length];
            elements.forEach((elem, ei) => {
                const elemSerial: Record<string, unknown> = {
                    _dimensions: [1, 1],
                    _fields: fields,
                    _mw_element_type: rawVal._mw_element_type
                };
                const elemNode = new StructNode(String(ei), node, elemSerial);
                elemNode._isElementNode = true;
                // Column-major, as MATLAB stores it — see ObjectNode.
                elemNode._displayName = subscriptLabel(name, ei, dims, 'column-major', '()');
```

leaving the `fields.forEach` body and `node.addChild(elemNode)` that follow untouched.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/objectArrayExpansion.test.ts test/structNode.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite, then fix fallout**

Run: `npm run typecheck && npm test`
Expected: **all passing.** Any other failure will be a test that pinned a matrix object/struct label; each such expectation is transposed in the same way and gets the same correction. Vectors cannot move. If a failure is *not* a label ordering, stop and investigate — it means the change reached further than intended.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "[wip] label object and struct array elements from MATLAB's own order

Both element lists arrive column-major and were read row-major, so 4 of the 6
labels on a 2x3 array named the wrong element; rank >= 3 also emitted subscripts
for elements that do not exist. Both now go through the shared helper."
```

---

## Phase 4: `.mat` struct-array elements — defect 10

A struct array in a `.mat` file currently shows **element 1 only**. `MatParser` reads one `MatVariable` per element per field, and `_createFromMatStruct` throws all but the first away:

```ts
const childVar = Array.isArray(fieldVar) ? fieldVar[0] : fieldVar;
```

So a 1x3 struct with `a = 1, 2, 3` displays `<1x3 struct>` with a single `a = 1` beneath it. `_buildVarObject` then has to compensate on the write side by replaying elements 2..N out of the parse snapshot (`MatlabVariableNode.ts:1452-1463`) — a workaround whose comment says outright that the tree "can speak for that element alone". Fix the read side and the compensation goes away.

Note the shape difference from `StructNode` (the SLDD path, Phase 3): there, element nodes exist and hold field children. Here we build the same shape — one child per element, subscript-labelled, each holding the fields — so the two paths finally agree.

### Task 4.1: Expand every element of a MAT struct array

**Files:**
- Modify: `src/datamodel/node/data/MatlabVariableNode.ts:1636-1653` (`_createFromMatStruct`)
- Test: `test/matStructArray.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// Copyright 2026 The MathWorks, Inc.
//
// A struct ARRAY from a .mat file. MatParser hands us one MatVariable per element
// per field; the node layer used to keep element 1 and drop the rest, so a 1x3
// struct displayed one field value and the other two were invisible.
import { describe, it, expect } from 'vitest';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import type { MatVariable } from '../src/datamodel/parser/MatParser.js';

function num(name: string, v: number): MatVariable {
  return {
    name, className: 'double', dimensions: [1, 1], isComplex: false,
    isLogical: false, value: v, fields: null,
  };
}

// A struct array as MatParser reports it: fields[f] is an array, one entry per
// element, in MATLAB's own column-major order.
function structArray(dims: number[], perElement: Record<string, number>[]): MatVariable {
  const fields: Record<string, MatVariable[]> = {};
  for (const fname of Object.keys(perElement[0])) {
    fields[fname] = perElement.map((e) => num(fname, e[fname]));
  }
  return {
    name: 's', className: 'struct', dimensions: dims, isComplex: false,
    isLogical: false, value: null, fields: fields as never,
  };
}

describe('MAT struct array expansion', () => {
  it('builds one child per element, each carrying its own field values', () => {
    const v = structArray([1, 3], [{ a: 1, b: 10 }, { a: 2, b: 20 }, { a: 3, b: 30 }]);
    const node = MatlabVariableNode.parseMatVariable(v, 's', null);

    expect(node.children.length).toBe(3);
    expect(node.children.map((c: any) => c.displayName)).toEqual(['s(1)', 's(2)', 's(3)']);
    const firstFields = node.children.map((c: any) => c.children.map((f: any) => f.name));
    expect(firstFields).toEqual([['a', 'b'], ['a', 'b'], ['a', 'b']]);
    const aVals = node.children.map((c: any) => c.children[0].displayValue);
    expect(aVals).toEqual(['1', '2', '3']);
    const bVals = node.children.map((c: any) => c.children[1].displayValue);
    expect(bVals).toEqual(['10', '20', '30']);
  });

  it('labels a 2x3 struct array in MATLAB column-major order', () => {
    // gen_truth.m struct2x3: a = row*10 + col, stored column-major.
    const v = structArray([2, 3], [11, 21, 12, 22, 13, 23].map((n) => ({ a: n })));
    const node = MatlabVariableNode.parseMatVariable(v, 's', null);
    const pairs = node.children.map((c: any) => [c.displayName, c.children[0].displayValue]);
    expect(pairs).toEqual([
      ['s(1,1)', '11'], ['s(2,1)', '21'], ['s(1,2)', '12'],
      ['s(2,2)', '22'], ['s(1,3)', '13'], ['s(2,3)', '23'],
    ]);
  });

  it('leaves a 1x1 struct exactly as it was — fields directly beneath the node', () => {
    const v: MatVariable = {
      name: 's', className: 'struct', dimensions: [1, 1], isComplex: false,
      isLogical: false, value: null,
      fields: { a: num('a', 7), b: num('b', 8) },
    };
    const node = MatlabVariableNode.parseMatVariable(v, 's', null);
    expect(node.children.map((c: any) => c.name)).toEqual(['a', 'b']);
    expect(node.children[0].displayValue).toBe('7');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/matStructArray.test.ts`
Expected: FAIL — the 1x3 case reports 2 children named `a` and `b` (the fields), not 3 elements. The 1x1 case already passes; keep it, it is the regression guard.

- [ ] **Step 3: Implement**

Replace `_createFromMatStruct` (lines 1636-1653) with:

```ts
  static _createFromMatStruct(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode {
    const node = new MatlabVariableNode(name, parent, {});
    node._rawBytes = variable._rawBytes || null;
    node._matVar = variable;
    node._kind = 'scalar';
    node._scalarType = 'struct';
    node._scalarValue = null;
    node._dims = variable.dimensions.slice();

    if (!variable.fields) {
      return node;
    }
    const fieldNames = Object.keys(variable.fields);
    const count = elementCount(node._dims);
    if (count <= 1) {
      for (const fieldName of fieldNames) {
        const fieldVar = variable.fields[fieldName];
        // A 1x1 struct stores the field directly, but tolerate the array form.
        const childVar = Array.isArray(fieldVar) ? fieldVar[0] : fieldVar;
        node.addChild(MatlabVariableNode.parseMatVariable(childVar, fieldName, node));
      }
      return node;
    }

    // A struct ARRAY gets one child per element, each holding that element's own
    // fields. Keeping only fields[f][0] used to make every element after the
    // first invisible, and forced _buildVarObject to replay them from the parse
    // snapshot on save. MatParser fills fields[f] in MATLAB's column-major
    // order, so element ei is MATLAB's linear index ei+1.
    for (let ei = 0; ei < count; ei++) {
      const elemNode = new MatlabVariableNode(String(ei + 1), node, {});
      elemNode._kind = 'scalar';
      elemNode._scalarType = 'struct';
      elemNode._scalarValue = null;
      elemNode._dims = [1, 1];
      elemNode._displayName = subscriptLabel(name, ei, node._dims, 'column-major', '()');
      for (const fieldName of fieldNames) {
        const fieldVar = variable.fields[fieldName];
        const childVar = Array.isArray(fieldVar) ? fieldVar[ei] : fieldVar;
        if (childVar) {
          elemNode.addChild(MatlabVariableNode.parseMatVariable(childVar, fieldName, elemNode));
        }
      }
      node.addChild(elemNode);
    }
    return node;
  }
```

Add to the imports at the top of the file:

```ts
import { elementCount } from '../../display/DisplayConvention.js';
import { subscriptLabel } from '../../display/Subscript.js';
```

`_displayName` is assigned rather than relying on `BaseNode.displayName`, because the parent's `_kind` here is `'scalar'` (a struct is modelled as a scalar with children), not `'array'`, so the getter's positional branch does not fire.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/matStructArray.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/datamodel/node/data/MatlabVariableNode.ts test/matStructArray.test.ts
git commit -m "[wip] expand every element of a MAT struct array, not just the first"
```

### Task 4.2: Rebuild struct-array fields from the live tree

**Files:**
- Modify: `src/datamodel/node/data/MatlabVariableNode.ts:1449-1464` (`_buildVarObject`, struct branch)
- Test: `test/matStructArray.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `test/matStructArray.test.ts`:

```ts
describe('MAT struct array write-back', () => {
  it('rebuilds every element from the tree, and an edit to element 2 survives', () => {
    const v = structArray([1, 3], [{ a: 1 }, { a: 2 }, { a: 3 }]);
    const node = MatlabVariableNode.parseMatVariable(v, 's', null);

    // Edit element 2's field. This is the case the old replay-from-snapshot
    // path could not express: it always took element 2 from the parse.
    const elem2 = node.children[1] as any;
    elem2.children[0].setValue('99');

    const rebuilt = (node as any)._var;
    expect(rebuilt.className).toBe('struct');
    expect(rebuilt.dimensions).toEqual([1, 3]);
    const aField = rebuilt.fields.a;
    expect(Array.isArray(aField)).toBe(true);
    expect(aField.length).toBe(3);
    expect(aField.map((f: any) => f.value)).toEqual([1, 99, 3]);
  });

  it('still rebuilds a 1x1 struct as a lone MatVariable per field', () => {
    const v: MatVariable = {
      name: 's', className: 'struct', dimensions: [1, 1], isComplex: false,
      isLogical: false, value: null, fields: { a: num('a', 7) },
    };
    const node = MatlabVariableNode.parseMatVariable(v, 's', null);
    (node.children[0] as any).setValue('8');
    const rebuilt = (node as any)._var;
    expect(Array.isArray(rebuilt.fields.a)).toBe(false);
    expect(rebuilt.fields.a.value).toBe(8);
  });
});
```

If `setValue` is not the mutator on this node (check with `grep -n 'setValue\|set value' src/datamodel/node/data/MatlabVariableNode.ts | head`), use whatever the class exposes and mark the node stale the way the existing mutation tests do — copy the idiom from `test/matVariableFromMat.test.ts`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/matStructArray.test.ts`
Expected: FAIL — `fields.a` comes back with 3 entries whose values are `1, 2, 3`: the edit is replayed away, because `[rebuilt, ...parsed.slice(1)]` takes element 1 from the tree and 2..N from the snapshot, and `rebuilt` is now an *element* node rather than a field.

- [ ] **Step 3: Implement**

Replace the struct branch of `_buildVarObject` (lines 1449-1464) with:

```ts
    if (this._scalarType === 'struct') {
      v.className = 'struct';
      const fields: Record<string, MatVariable | MatVariable[]> = {};
      if (elementCount(this._dims) > 1) {
        // A struct ARRAY models one child per ELEMENT, each holding that
        // element's fields, so a field rebuilds as one MatVariable per element
        // in the same column-major order MatParser read. This replaces a
        // replay-from-snapshot compensation that could only ever speak for
        // element 1 — an edit to element 2 was silently discarded on save.
        const fieldNames: string[] = [];
        for (const elem of this.children) {
          for (const f of elem.children) {
            if (fieldNames.indexOf(f.name) < 0) { fieldNames.push(f.name); }
          }
        }
        for (const fname of fieldNames) {
          fields[fname] = this.children.map(function (elem) {
            const f = elem.children.find(function (c) { return c.name === fname; });
            return (f as MatlabVariableNode)._var;
          });
        }
      } else {
        for (const child of this.children) {
          fields[child.name] = (child as MatlabVariableNode)._var;
        }
      }
      v.fields = fields;
    } else if (this._kind === 'scalar') {
```

A field missing from one element cannot happen — MATLAB struct arrays are homogeneous — but the `find` is why `fieldNames` is gathered by union rather than from `children[0]`: a defensive union costs nothing and keeps a malformed file from throwing here.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/matStructArray.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Full suite**

Run: `npm run typecheck && npm test`
Expected: all passing. `test/matVariableFromMat.test.ts` is the file most likely to have pinned the old shape — if a test there asserts a struct array's children are its field names, that expectation was pinning the defect; correct it to the element shape and say so in the commit message.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "[wip] rebuild MAT struct-array fields from the live tree

Drops the replay-from-snapshot compensation that made an edit to any element
after the first vanish on save."
```

---

## Phase 5: text `.sldd` `cdata` is a MAT byte stream — defect 11

In an uncompressed-text `.sldd`, MATLAB writes any value its XML schema cannot spell as `_type: 'cdata'`: a uuencoded **MAT-file element** — an 8-byte preamble followed by one `miMATRIX`. It is not "the complex-double encoding". `parseCdata` sniffs for a text form, then assumes everything else is a 2-D complex double and hand-reads `rows` at byte 40, `cols` at 44, a real block and an imaginary block (`MatlabVariableNode.ts:69-109, 1794-1827`). Anything else in a `cdata` — an int64, a rank-3 array, a real-only value, a cell — is read as garbage complex numbers or falls through to the char catch-all.

`MatParser.parseMatrix` already reads all of that, including complex, N-D, cell and struct, and `_createFromMatNumeric` already renders complex scalars and arrays. So the fix is to **decode the bytes and hand them to the existing reader**, deleting `decodeCdata` rather than extending it. Fewer lines out than in.

**Round-trip is the risk.** `cdata` write-back is byte-identical today only because an untouched node returns its captured `_rawInput` (`MatlabVariableNode.ts:1096-1109`). The factories reached via `parseMatVariable` set `_matVar`/`_rawBytes` but not `_rawInput`, so the new path must set it explicitly. Task 5.2 pins that.

### Task 5.1: Route `cdata` through `parseMatrix`

**Files:**
- Modify: `src/datamodel/node/data/MatlabVariableNode.ts:69-110` (replace `decodeCdata`)
- Modify: `src/datamodel/node/data/MatlabVariableNode.ts:1794-1840` (`parseCdata`)
- Test: `test/cdataParse.test.ts` (create)

- [ ] **Step 1: Write the failing test**

The fixtures must be MATLAB-authored, not hand-built, or the test proves nothing about the byte layout. Generate them first:

```bash
mkdir -p /tmp/cdata && cat > /tmp/cdata/gen.m <<'EOF'
outdir = '/tmp/cdata';
vals = { ...
  'cplxScalar', 3 + 4i, ...
  'cplxRow',    [1+1i, 2+2i, 3+3i], ...
  'cplx2x3',    [1+1i 2+2i 3+3i; 4+4i 5+5i 6+6i], ...
  'i64',        int64(9007199254740993), ...
  'nd',         reshape(1:12, [2 3 2]) };
fn = fullfile(outdir, 'cdata.sldd');
if exist(fn,'file'), delete(fn); end
dd = Simulink.data.dictionary.create(fn);
dd.FileFormat = 'uncompressed-text';
ds = dd.getSection('Design Data');
notes = {};
for k = 1:2:numel(vals)
    try
        ds.addEntry(vals{k}, vals{k+1});
    catch e
        notes{end+1} = [vals{k} ': ' e.message];
    end
end
dd.saveChanges(); dd.close();
for i=1:numel(notes), disp(notes{i}); end
% Report which entries actually landed as cdata, so the test only pins real ones.
txt = fileread(fn);
disp('--- CDATA ENTRIES ---');
for k = 1:2:numel(vals)
    if ~isempty(strfind(txt, vals{k})), disp(vals{k}); end
end
disp('GEN OK');
EOF
mw -using Bmain matlab -nodesktop -batch "run('/tmp/cdata/gen.m')"
cp /tmp/cdata/cdata.sldd test/fixtures/cdata.sldd
```

Then read the generated file to see which entries MATLAB actually stored as `_type="cdata"` (`grep -c cdata test/fixtures/cdata.sldd`, and inspect the entry names around each). **Pin only those.** If MATLAB stores `i64` or `nd` as a typed matrix rather than cdata, drop them from this test — Phases 6 and 10 cover those paths, and asserting a layout MATLAB does not produce is worse than not asserting it.

```ts
// Copyright 2026 The MathWorks, Inc.
//
// A text .sldd `cdata` payload is a uuencoded MAT-file ELEMENT, not "the complex
// encoding". It used to be hand-read as a 2-D complex double at fixed byte
// offsets, so every other thing MATLAB puts there came back as garbage. It now
// goes through MatParser, which already reads all of it.
import { describe, it, expect } from 'vitest';
import { loadFile, findEntry } from './parity/loadFile.js';

const root = loadFile('../fixtures/cdata.sldd');

function entry(name: string): any {
  return findEntry(root, name);
}

describe('text .sldd cdata', () => {
  it('reads a complex scalar', () => {
    expect(entry('cplxScalar').displayValue).toBe('3+4i');
  });

  it('reads a complex row vector in MATLAB order', () => {
    const n = entry('cplxRow');
    expect(n.children.map((c: any) => c.displayValue)).toEqual(['1+1i', '2+2i', '3+3i']);
  });

  it('reads a complex 2x3 row-major, so element (1,2) is 2+2i', () => {
    const n = entry('cplx2x3');
    expect(n.children.map((c: any) => c.displayName)).toEqual([
      'cplx2x3(1,1)', 'cplx2x3(1,2)', 'cplx2x3(1,3)',
      'cplx2x3(2,1)', 'cplx2x3(2,2)', 'cplx2x3(2,3)',
    ]);
    expect(n.children.map((c: any) => c.displayValue)).toEqual([
      '1+1i', '2+2i', '3+3i', '4+4i', '5+5i', '6+6i',
    ]);
  });
});
```

Adjust `addSlddSource` / `getChildren` to whatever `test/parity/fidelity/roundTripHarness.ts:1-80` uses — reuse its `addSlddSource` and `entryByName` helpers rather than re-deriving them. Check first: `sed -n '1,80p' test/parity/fidelity/roundTripHarness.ts`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/cdataParse.test.ts`
Expected: the complex cases may already pass (that is the one shape the old reader handled); the 2x3 case is the discriminator — the old reader transposed by hand and did not label rank-2 elements. If all three pass before the change, add the case for whichever non-complex value MATLAB really stored as cdata, since that is the defect.

- [ ] **Step 3: Implement**

Replace `decodeCdata` (lines 69-110) with a decoder that returns bytes and nothing more:

```ts
// A text .sldd stores a value its XML schema cannot spell as uuencoded bytes:
// six bits per printable character, offset by 0x20. What those bytes CONTAIN is
// an 8-byte preamble followed by one MAT-file miMATRIX element — so decoding
// stops here and MatParser reads the rest. This function used to keep going and
// hand-read a 2-D complex double at fixed offsets (rows at 40, cols at 44),
// which meant every other class MATLAB puts in a cdata came back as garbage
// complex numbers or fell through to a char.
function uudecode(str: string): Uint8Array {
  const bits: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const v = str.charCodeAt(i) - 0x20;
    for (let b = 5; b >= 0; b--) {
      bits.push((v >> b) & 1);
    }
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte = (byte << 1) | bits[i * 8 + b];
    }
    bytes[i] = byte;
  }
  return bytes;
}
```

Replace the body of `parseCdata` from line 1799 (`try {`) through the end of the `try` block (line 1827, `return node;`) with:

```ts
    try {
      const bytes = uudecode(valStr);
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      // 8-byte preamble, then one miMATRIX element: tag (type, byte count) at 8,
      // payload at 16.
      const tagType = dv.getUint32(8, true);
      const tagSize = dv.getUint32(12, true);
      if (tagType !== MI_MATRIX) {
        throw new Error('cdata is not a MAT matrix element');
      }
      const variable = parseMatrix(dv, 16, tagSize);
      const node = MatlabVariableNode.parseMatVariable(variable, name, parent);
      // parseMatVariable's factories set _matVar/_rawBytes but not _rawInput, and
      // an untouched node writes itself back by replaying _rawInput verbatim. Set
      // it so a cdata entry nobody edited still round-trips byte-identical.
      node._rawInput = rawVal;
      return node;
    } catch (_e) {
```

leaving the existing char fallback in the `catch` untouched — a `cdata` we cannot decode is still better shown as its raw text than dropped.

Add near the top of the file, beside the existing imports:

```ts
import { parseMatrix, type MatVariable } from '../../parser/MatParser.js';
```

(`MatVariable` is very likely imported already — check with `grep -n "from '../../parser/MatParser" src/datamodel/node/data/MatlabVariableNode.ts` and extend that import rather than adding a second one.) Add the constant beside the other module-level constants:

```ts
const MI_MATRIX = 14;
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/cdataParse.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm the old reader is gone**

Run: `grep -n 'decodeCdata\|realParts\|imagParts' src/datamodel/node/data/MatlabVariableNode.ts`
Expected: no output. There is no lint script in this repo, so nothing will flag a newly-unused `formatComplex` for you — check by hand with `grep -rn formatComplex src/` and delete it only if nothing else calls it.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "[wip] read text-sldd cdata as the MAT element it is

Replaces a hand-rolled 2-D complex-double reader at fixed byte offsets with the
MAT parser that already handles complex, N-D, cell and struct."
```

### Task 5.2: Pin byte-identical cdata round-trip

**Files:**
- Test: `test/cdataParse.test.ts` (append)

- [ ] **Step 1: Write the test**

```ts
describe('text .sldd cdata round-trip', () => {
  it('re-serializes an untouched cdata entry byte-identically', () => {
    const original = readFileSync('test/fixtures/cdata.sldd');
    const m = model();
    const out = m.serialize(URI) as Uint8Array | string;
    const outBytes = typeof out === 'string' ? new TextEncoder().encode(out) : out;
    expect(Buffer.from(outBytes).equals(Buffer.from(original))).toBe(true);
  });
});
```

Use the repo's real serialize entry point — check `grep -n 'serialize' src/datamodel/DataModel.ts | head` and mirror how `test/parity/fidelity/*.test.ts` calls it, including any normalization those tests apply. If the existing fidelity suite already covers a cdata fixture byte-identically, extend that suite with this fixture instead of writing a new assertion here, and note it in the commit.

- [ ] **Step 2: Run it**

Run: `npx vitest run test/cdataParse.test.ts`
Expected: PASS. A failure here means `_rawInput` is not reaching the writer — check that `parseCdata`'s new path sets it *after* `parseMatVariable` returns, and that nothing in the factories clears it.

- [ ] **Step 3: Full suite**

Run: `npm run typecheck && npm test`
Expected: all passing.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "[wip] pin byte-identical round-trip for text-sldd cdata entries"
```

---

## Phase 6: `.sldd` rank preservation — defect 12

MATLAB's own binary dictionary writes a 2x3x2 double as `Dimension="2*3*2"` with a flat column-major element list. Our reader collapses it:

```ts
// BinarySlddParser.ts:52-62
return [parts[0], parts.slice(1).reduce((a, b) => a * b, 1)];   // 2*3*2 -> [2, 6]
```

so the tree reports a 2x6 that MATLAB never had — wrong shape, wrong subscripts, and a `Matrix(2,6)` written back on save. The header comment at `:34-41` acknowledges the flattening as if it were the format's limit. It is not: it is ours.

The write side is the same story — `formatMatrix` (`:480-501`) reads `dims[0]`/`dims[1]` only, and `parseMatrixValue` in the node layer (`MatlabVariableNode.ts:189-214`) matches `/^Matrix\((\d+),(\d+)\)$/`, so nothing downstream could carry a third extent even if the reader supplied one.

**Serial-string contract.** `Matrix(r,c)` becomes `Matrix(d1,d2,...,dn)` for rank >= 3 and is unchanged at rank <= 2, so every existing fixture and expectation still matches byte-for-byte. The element body stays row-major-within-page, which is what `transposeColumnMajor` already produces for page 0 — Task 6.1 extends it to every page.

### Task 6.1: Read all extents, transpose every page

**Files:**
- Modify: `src/datamodel/parser/BinarySlddParser.ts:34-62` (`parseDims` + its header comment)
- Modify: `src/datamodel/parser/BinarySlddParser.ts:430-443` (`transposeColumnMajor`)
- Test: `test/slddRank.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// Copyright 2026 The MathWorks, Inc.
//
// MATLAB's binary dictionary writes Dimension="2*3*2" with a flat column-major
// body. We used to fold that to [2,6] on read, reporting a shape MATLAB never
// had and writing Matrix(2,6) back on save.
import { describe, it, expect } from 'vitest';
import { parseDims, transposeColumnMajor } from '../src/datamodel/parser/BinarySlddParser.js';

describe('parseDims', () => {
  it('keeps every extent', () => {
    expect(parseDims('2*3*2')).toEqual([2, 3, 2]);
    expect(parseDims('2*2*2*2')).toEqual([2, 2, 2, 2]);
  });

  it('is unchanged at rank 2 and below', () => {
    expect(parseDims('2*3')).toEqual([2, 3]);
    expect(parseDims('1*5')).toEqual([1, 5]);
    expect(parseDims('5')).toEqual([1, 5]);
    expect(parseDims('')).toEqual([1, 1]);
    expect(parseDims('junk')).toEqual([1, 1]);
  });

  it('drops a trailing singleton, as MATLAB size() does', () => {
    expect(parseDims('2*3*1')).toEqual([2, 3]);
  });
});

describe('transposeColumnMajor', () => {
  it('transposes EVERY page of a rank-3 array, not just the first', () => {
    // MATLAB: A = reshape(1:12,[2 3 2]); A(:)' is 1..12 column-major.
    // Page 1 is [1 3 5; 2 4 6], page 2 is [7 9 11; 8 10 12].
    const got = transposeColumnMajor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [2, 3, 2]);
    expect(got).toEqual([1, 3, 5, 2, 4, 6, 7, 9, 11, 8, 10, 12]);
  });

  it('is unchanged at rank 2', () => {
    expect(transposeColumnMajor([1, 2, 3, 4, 5, 6], [2, 3])).toEqual([1, 3, 5, 2, 4, 6]);
  });

  it('leaves a vector alone', () => {
    expect(transposeColumnMajor([1, 2, 3], [1, 3])).toEqual([1, 2, 3]);
    expect(transposeColumnMajor([1, 2, 3], [3, 1])).toEqual([1, 2, 3]);
  });
});
```

Both functions are module-private today. Export them (`export function parseDims`, `export function transposeColumnMajor`) — they are the unit under test and the file already exports its parse entry points.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/slddRank.test.ts`
Expected: FAIL — no export, then `[2,6]` for `2*3*2` and only page 1 transposed.

- [ ] **Step 3: Implement**

Replace `parseDims` and the misleading part of its header comment with:

```ts
// A Dimension attribute is `d1*d2*...*dn`. Every extent is kept: MATLAB's own
// binary dictionary writes a 2x3x2 as "2*3*2" with a flat column-major body, so
// folding the trailing extents into the column count (2x6) reported a shape
// MATLAB never had, mislabelled every element, and wrote Matrix(2,6) back on
// save. A trailing singleton is dropped because MATLAB's size() drops it too:
// a 2x3x1 IS a 2x3.
//
// A single extent is a row vector (1xN), and anything unparseable is a scalar —
// an unreadable Dimension used to format as `Matrix(3,undefined)` with an empty
// body, losing every element.
export function parseDims(dimension: string): number[] {
  const parts = dimension.split('*').map(Number);
  if (parts.some(function (n) { return !Number.isFinite(n) || n < 0; })) {
    return Number.isFinite(parts[0]) && parts.length === 1 ? [1, parts[0]] : [1, 1];
  }
  if (parts.length === 1) {
    return Number.isFinite(parts[0]) ? [1, parts[0]] : [1, 1];
  }
  const dims = parts.slice();
  while (dims.length > 2 && dims[dims.length - 1] === 1) {
    dims.pop();
  }
  return dims;
}
```

Note `parseDims('')` → `''.split('*')` is `['']` → `Number('')` is `0`, which is finite, so it returns `[1, 0]`, not `[1, 1]`. Guard the empty string explicitly at the top:

```ts
  if (!dimension) {
    return [1, 1];
  }
```

Replace `transposeColumnMajor` with the per-page form:

```ts
// Column-major (MATLAB) to row-major-within-page (what the display layer reads).
// An N-D array is a stack of rows x cols pages, each stored column-major in turn,
// so every page is transposed and the page order is untouched — the same rule
// MatParser.transposeFromColMajor applies to .mat data. Handling only dims[0] and
// dims[1] left every page after the first in column order, so a rank-3 array's
// later pages displayed transposed.
export function transposeColumnMajor(values: number[], dims: number[]): number[] {
  const rows = dims[0];
  const cols = dims[1];
  if (rows <= 1 || cols <= 1) {
    return values;
  }
  const page = rows * cols;
  const result = values.slice();
  for (let base = 0; base + page <= values.length; base += page) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        result[base + r * cols + c] = values[base + c * rows + r];
      }
    }
  }
  return result;
}
```

The `cols <= 1` guard is new: the old version returned early only on `rows <= 1`, and a column vector fell through to a loop that happened to be an identity. Starting from `values.slice()` is what keeps a declared-length mismatch from leaving holes.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/slddRank.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/datamodel/parser/BinarySlddParser.ts test/slddRank.test.ts
git commit -m "[wip] keep every dimension a .sldd declares, transpose every page"
```

### Task 6.2: Carry rank through the serial string

**Files:**
- Modify: `src/datamodel/parser/BinarySlddParser.ts:480-501` (`formatMatrix`)
- Modify: `src/datamodel/parser/BinarySlddParser.ts:356` (the empty-matrix literal)
- Modify: `src/datamodel/node/data/MatlabVariableNode.ts:189-214` (`parseMatrixValue`)
- Modify: `src/datamodel/node/data/MatlabVariableNode.ts:1922-1947` (`parseTypedArray`)
- Test: `test/slddRank.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';

describe('Matrix(...) serial string', () => {
  it('parses a rank-3 header and gives the node all three extents', () => {
    const raw = {
      _type: 'double',
      _value: 'Matrix(2,3,2)\n[[1, 3, 5]; [2, 4, 6]; [7, 9, 11]; [8, 10, 12]]',
    };
    const node = MatlabVariableNode.parseTypedArray(raw, 'A', null) as any;
    expect(node._dims).toEqual([2, 3, 2]);
    expect(node.children.length).toBe(12);
    expect(node.children.map((c: any) => c.displayName)).toEqual([
      'A(1,1,1)', 'A(1,2,1)', 'A(1,3,1)', 'A(2,1,1)', 'A(2,2,1)', 'A(2,3,1)',
      'A(1,1,2)', 'A(1,2,2)', 'A(1,3,2)', 'A(2,1,2)', 'A(2,2,2)', 'A(2,3,2)',
    ]);
  });

  it('still parses a rank-2 header exactly as before', () => {
    const raw = { _type: 'double', _value: 'Matrix(2,3)\n[[1, 2, 3]; [4, 5, 6]]' };
    const node = MatlabVariableNode.parseTypedArray(raw, 'B', null) as any;
    expect(node._dims).toEqual([2, 3]);
    expect(node._elements).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/slddRank.test.ts`
Expected: FAIL — the rank-3 header does not match the 2-group regex, so `parseMatrixValue` returns null and `parseTypedArray` produces the `[0,0]` empty node.

- [ ] **Step 3: Implement**

Change `parseMatrixValue` to report all extents:

```ts
function parseMatrixValue(
  raw: Record<string, unknown>,
): { dims: number[]; elements: number[]; type: string } | null {
  const lines = (raw._value as string).split('\n');
  const header = lines[0];
  // Rank 3 and up appear as Matrix(2,3,2). The two-group form was the only one
  // matched, so an N-D entry fell through to an empty node.
  const dimsMatch = header.match(/^Matrix\((\d+(?:,\d+)*)\)$/);
  if (!dimsMatch) {
    return null;
  }
  const dims = dimsMatch[1].split(',').map(function (s) {
    return parseInt(s, 10);
  });
  const body = lines.slice(1).join('');

  const numbers: number[] = [];
  // Inf/-Inf/NaN are elements too, and a digits-only pattern would skip them —
  // shifting every later element one slot left and corrupting the whole matrix.
  const numMatches = body.match(/-?(?:[\d.]+(?:[eE][+-]?\d+)?|Inf|NaN)/g);
  if (numMatches) {
    numMatches.forEach(function (s: string) {
      numbers.push(parseMatlabNum(s));
    });
  }

  return { dims: dims.length >= 2 ? dims : [1, dims[0] || 0], elements: numbers, type: raw._type as string };
}
```

and in `parseTypedArray` (line 1938) replace

```ts
    node._dims = [parsed.rows, parsed.cols];
```

with

```ts
    node._dims = parsed.dims.slice();
```

On the write side, make `formatMatrix` emit every extent and lay out every page:

```ts
function formatMatrix(values: number[], dims: number[], type: string): unknown {
  const rows = dims[0];
  const cols = dims[1];
  type = type || 'double';
  const header = 'Matrix(' + dims.join(',') + ')';
  // Column vector: single bracketed list
  if (cols === 1 && dims.length <= 2) {
    const formatted = values.map((v) => formatNumLiteral(v, type));
    return { _type: type, _value: header + '\n[' + formatted.join(', ') + ']' };
  }
  // One bracketed group per row, pages laid out in order — the body a rank-3
  // entry needs is just its pages' rows concatenated, which is what the reader
  // above consumes.
  const rowStrs: string[] = [];
  const pages = Math.max(1, Math.floor(values.length / Math.max(1, rows * cols)));
  for (let p = 0; p < pages; p++) {
    const base = p * rows * cols;
    for (let r = 0; r < rows; r++) {
      const row: string[] = [];
      for (let c = 0; c < cols; c++) {
        row.push(formatNumLiteral(values[base + r * cols + c], type));
      }
      rowStrs.push('[' + row.join(', ') + ']');
    }
  }
  return { _type: type, _value: header + '\n[' + rowStrs.join('; ') + ']' };
}
```

At rank <= 2 this is byte-identical to the old output: `pages` is 1 and `header` is `Matrix(r,c)`. Also update line 356's empty-matrix literal from `'Matrix(' + dimParts[0] + ',' + dimParts[1] + ')'` to `'Matrix(' + dimParts.join(',') + ')'` so an empty N-D cell element agrees with the reader.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/slddRank.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Full suite**

Run: `npm run typecheck && npm test`
Expected: all passing. The fidelity suites in `test/parity/fidelity/` are the ones that would catch a serial-string regression; if one fails, diff the serialized output against the fixture and confirm the difference is confined to a genuinely N-D entry.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "[wip] carry N-D shape through the Matrix() serial string both ways"
```

### Task 6.3: Verify against a MATLAB-authored dictionary

**Files:**
- Test: `test/slddRank.test.ts` (append)

- [ ] **Step 1: Reuse the existing fixture**

`test/parity/matlab/probe_ndarray.m` already writes a 2x3x2 `A` into both dictionary formats. Regenerate and keep them as fixtures:

```bash
mkdir -p /tmp/c4probe
mw -using Bmain matlab -nodesktop -batch "run('$PWD/test/parity/matlab/probe_ndarray.m')"
cp /tmp/c4probe/fix_uncompressed_text.sldd test/fixtures/nd_text.sldd
cp /tmp/c4probe/fix_compressed_binary.sldd test/fixtures/nd_binary.sldd
cp /tmp/c4probe/truth.json test/fixtures/nd_truth.json
```

- [ ] **Step 2: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadFile, findEntry } from './parity/loadFile.js';

describe('a MATLAB-authored 2x3x2 in both .sldd formats', () => {
  const truth = JSON.parse(readFileSync('test/fixtures/nd_truth.json', 'utf8'));

  for (const [label, file] of [['text', 'nd_text.sldd'], ['binary', 'nd_binary.sldd']] as const) {
    it('reports the shape MATLAB reports (' + label + ')', () => {
      const a = findEntry(loadFile('../fixtures/' + file), 'A');
      expect((a as any)._dims).toEqual(truth.A_size);
      expect(a.displayValue).toBe('<2x3x2 double>');
      expect(a.children.length).toBe(12);
      // truth.A_linear is MATLAB's column-major 1..12; our children are
      // row-major within each page, so map label -> value and compare against
      // the subscript MATLAB itself assigned.
      const byLabel = new Map(a.children.map((c: any) => [c.displayName, Number(c.displayValue)]));
      expect(byLabel.get('A(1,1,1)')).toBe(1);
      expect(byLabel.get('A(2,1,1)')).toBe(4);
      expect(byLabel.get('A(1,1,2)')).toBe(7);
      expect(byLabel.get('A(2,3,2)')).toBe(12);
    });
  }
});
```

`loadFile` and `findEntry` come from `test/parity/loadFile.js` — the shared loader described under **Test harness conventions**, which you create before Phase 3. Note the MATLAB truth for these indices: `A(:,:,1) = [1 2 3; 4 5 6]`, so `A(2,1,1)` is 4 and `A(1,1,2)` is 7. `displayValue` on the container is asserted as `<2x3x2 double>`, which is Phase 7's form — if Phase 7 has not landed yet, assert `_dims` and the labels only and add the `displayValue` line in Phase 7.

- [ ] **Step 3: Run it**

Run: `npx vitest run test/slddRank.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "[wip] pin N-D .sldd shape against a MATLAB-authored dictionary"
```

### Task 6.4: the two write-path holes — defect 15

Phase 3's verifier found two `serializeValue` gaps that no test in the repo
covers, and I measured both against the Phase 2 corpus before writing this task.
They belong here because both are shape/structure lost on **write**, which is
what this phase is about, and because Phase 11's `lossless.test.ts` (Task 11.6)
is a read-write-read assertion that will fail on both — fix them before the test
that catches them, not after.

**Hole 1 — every `.mat`-sourced struct serializes to `null`.** Measured on
`cases.mat`: `structScalar`, `structNest`, `struct1x3`, `struct2x3` and
`structNd` **all** produce `null`. On the `.mat` path a struct arrives as
`_kind: 'scalar'` with `_scalarType: 'struct'`, and `_serializeScalar`
(`MatlabVariableNode.ts:1112`) has arms for `string` and `complex` and a
`needsTypedLiteral` check, then falls through to `return this._scalarValue` —
which is `undefined` for a struct. So copying a struct from a `.mat` into a
dictionary writes `null` and the entry's contents are gone, silently. The text
`.sldd` path is unaffected only by luck: there a struct has `_kind: undefined`
and takes the `_rawInput` early return, so the intact `_array_type: 'Struct'`
object passes straight through. Any *modified* `.sldd` struct hits the same hole.

**Hole 2 — `_serializeArray`'s bare-JSON path carries no shape at all.**
Measured: `nd2x3x2` from `cases.mat` serializes to `[1,2,3,4,5,6,7,8,9,10,11,12]`
and `mat2x3` to `[1,2,3,4,5,6]`. There is no `_dimensions` key and no
`Matrix(...)` header, so a 2x3x2 reads back as a 1x12 and a 2x3 as a 1x6 — and
because the children are row-major, even the element order is wrong against
MATLAB's column-major linearization. Note this is a *different* hole from Task
6.2: that one widens the `Matrix(r,c)` string, which only the typed path emits.
`_serializeCell` already does the right thing (`_dimensions: this._dims`), so the
fix is to make the array path match the cell path it sits next to.

**Files:**
- Modify: `src/datamodel/node/data/MatlabVariableNode.ts:1112` (`_serializeScalar`), `:1128` (`_serializeArray`)
- Test: `test/serializeShape.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// Copyright 2026 The MathWorks, Inc.
//
// serializeValue must not lose a struct's contents or an array's shape. Both
// holes are defect 15; both were invisible because no test round-tripped a
// .mat-sourced struct or an N-D numeric.
import { describe, it, expect } from 'vitest';
import { loadFile, findEntry } from './parity/loadFile.js';

const MAT = ['./parity/artifacts/mat/cases.mat', 'cases.mat'] as const;

describe('serializeValue preserves struct contents (defect 15, hole 1)', () => {
  for (const name of ['structScalar', 'structNest', 'struct1x3', 'struct2x3', 'structNd']) {
    it(name + ' does not serialize to null', () => {
      const n = findEntry(loadFile(MAT[0], MAT[1]), name) as any;
      const out = n.serializeValue();
      expect(out, 'a null here wipes the entry on save').not.toBe(null);
      expect(out).not.toBe(undefined);
      expect((out as Record<string, unknown>)._array_type).toBe('Struct');
      // The shape must survive too, so the reader rebuilds the same array.
      expect((out as Record<string, unknown>)._dimensions).toEqual(n._dims);
    });
  }
});

describe('serializeValue preserves array shape (defect 15, hole 2)', () => {
  it('a 2x3x2 double does not flatten to a bare 12-element list', () => {
    const n = findEntry(loadFile(MAT[0], MAT[1]), 'nd2x3x2') as any;
    const out = n.serializeValue() as Record<string, unknown>;
    // Whatever form it takes, the rank must be recoverable from it.
    expect(Array.isArray(out), 'a bare array has nowhere to put [2,3,2]').toBe(false);
    expect(out._dimensions ?? out._value).toBeDefined();
    if (out._dimensions) { expect(out._dimensions).toEqual([2, 3, 2]); }
  });

  it('a 2x3 double keeps its two extents', () => {
    const n = findEntry(loadFile(MAT[0], MAT[1]), 'mat2x3') as any;
    const out = n.serializeValue() as Record<string, unknown>;
    expect(Array.isArray(out)).toBe(false);
    if (out._dimensions) { expect(out._dimensions).toEqual([2, 3]); }
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/serializeShape.test.ts`
Expected: FAIL — 5 struct cases assert `null` is not `null`; both array cases assert a bare `Array.isArray` true is false.

- [ ] **Step 3: Implement**

Give `_serializeScalar` the missing struct arm, immediately after the `string` arm. A struct's contents live in its children, exactly as `_serializeCell` reads them:

```ts
    if (this._scalarType === 'struct') {
      // Without this arm a struct falls through to `return this._scalarValue`,
      // which is undefined for a struct -- the entry serializes to null and its
      // contents are gone. The .sldd path only escapes because it takes the
      // _rawInput early return; a modified .sldd struct lands here too.
      return this._serializeStructValue();
    }
```

and add the helper next to `_serializeCell`, mirroring its shape so both paths
emit the one form the readers already accept:

```ts
  // The `_array_type: 'Struct'` form, rebuilt from the tree. Deliberately the
  // same shape a text .sldd carries in _rawInput, so a struct read from a .mat
  // and written to a .sldd round-trips through the existing reader unchanged.
  _serializeStructValue(): unknown {
    const fields: string[] = [];
    const elements: Record<string, unknown>[] = [];
    for (const child of this.children) {
      const c = child as MatlabVariableNode;
      if (!fields.includes(c.name)) {
        fields.push(c.name);
      }
    }
    // A struct node's children are its fields for a 1x1 and its elements for an
    // array; StructNode owns the array case, so a MatlabVariableNode struct is
    // the scalar one and its children are fields.
    const one: Record<string, unknown> = {};
    for (const child of this.children) {
      const c = child as MatlabVariableNode;
      one[c.name] = c.serializeValue();
    }
    elements.push(one);
    return {
      _array_type: 'Struct',
      _dimensions: effectiveDims(this._dims),
      _elements: elements,
      _fields: fields,
      _mw_element_type: 'MATLABArray',
    };
  }
```

Import `effectiveDims` from `../../display/DisplayConvention.js` if the file does not already have it — `grep -n effectiveDims src/datamodel/node/data/MatlabVariableNode.ts` first.

Then close hole 2 by giving the bare path the same `_dimensions` channel the cell path has. Replace the final `return` of `_serializeArray` (`:1147`):

```ts
    const values = this.children.map(function (c) {
      return (c as MatlabVariableNode).serializeValue();
    });
    // A bare JSON array has nowhere to carry [2,3,2], so a matrix written that
    // way reads back as a vector. Only a true vector may serialize bare.
    const d = effectiveDims(this._dims);
    if (d.length <= 1 || d[0] === 1 || d[1] === 1) {
      return values;
    }
    return {
      _array_type: 'Matrix',
      _dimensions: d,
      _elements: values,
      _mw_element_type: 'MATLABArray',
    };
```

**Check the reader accepts `_array_type: 'Matrix'` before you commit to that
key.** Run `grep -rn "_array_type" src/` and use whatever spelling the parse side
already recognizes for a shaped numeric array; if none exists, prefer the typed
`{_type, _value: 'Matrix(2,3,2)\n...'}` literal Task 6.2 just taught the reader,
and assert that form in the test instead. Do not invent a form only the writer
understands — the test's `_dimensions ?? _value` branch permits either, so pick
the one the reader can actually read back.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/serializeShape.test.ts`
Expected: PASS.

Then the full suite, because `serializeValue` is on every save path:

Run: `npx vitest run`
Expected: no new failures. If a `.sldd` write fixture changes bytes, read the diff before accepting it — a shaped form where a bare list used to be is the intended change; anything else is not.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "[wip] stop serializeValue wiping structs and flattening matrices"
```

---

## Phase 7: wire the display convention — defects 3, 4, 5, 7

Five places decide how a container prints, and no two agree:

| Site | Empty | Summary form | Threshold |
|---|---|---|---|
| `MatlabVariableNode._formatArray` `:475` | `[]` | none | none — a 10000-element array renders in full |
| `MatlabVariableNode._formatCell` `:491` | `{}` | `{2x3 cell}` (braces) | display length > 50 |
| `MatlabVariableNode._formatString` `:513` | — | `<1x2 string>` | display length > 50 |
| `MatlabVariableNode` opaque `:433` | — | `[1x3 double]` (square brackets) | always |
| `PropValue.format` `:40-47` | `[ ]` | `<1x7 double>` | display length > 50 |

The angle-bracket form is the consumer's signal for gray/italic *and* the key `BaseNode.valueEditable` reads, so this is a functional change too: a summarized cell stops offering an editor. That is correct — you cannot sensibly type a 2x3x2 into a one-line text box — and Task 7.4 asserts it deliberately rather than letting it happen quietly.

The rule (DESIGN.md, threshold section):
- **No child rows** (a summary is the only thing the user will ever see): threshold on display length, `SUMMARY_MAX_CHARS = 1000`.
- **Has child rows** (the elements are expandable): threshold on element count, `SUMMARY_MAX_ELEMENTS = 10`, *and* the char budget as a runaway guard so a 1x8 cell of 200-char strings cannot render a 1600-char literal.
- **Rank >= 3**: always summarize. `mat2str` itself errors on rank >= 3 ("Input matrix must be 2-D"), so there is no MATLAB one-liner to match.
- **struct**: always `<mxn struct>`, at every size.
- **Empty**: `[ ]` for numeric, `{ }` for cell — MATLAB's own `formattedDisplayText` spelling, and already what `PropValue.format` returns for null.

### Task 7.1: `formatMatrix` and `_formatArray`

**Files:**
- Modify: `src/datamodel/node/data/MatlabVariableNode.ts:173-187` (`formatMatrix`)
- Modify: `src/datamodel/node/data/MatlabVariableNode.ts:475-489` (`_formatArray`)
- Test: `test/matlabVariableNode.test.ts` (modify `:125`, `:447`; add)

- [ ] **Step 1: Write the failing test**

Add to `test/matlabVariableNode.test.ts`, in the display describe block:

```ts
  it('spells an empty numeric as MATLAB does', () => {
    const node = MatlabVariableNode.parseTypedArray({ _type: 'double', _value: 'nope' }, 'e', null);
    expect(node.displayValue).toBe('[ ]');
  });

  it('renders a 10-element array in full and summarizes at 11', () => {
    const ten = { _type: 'double', _value: 'Matrix(1,10)\n[' + [1,2,3,4,5,6,7,8,9,10].join(', ') + ']' };
    expect(MatlabVariableNode.parseTypedArray(ten, 'a', null).displayValue).toBe('[1 2 3 4 5 6 7 8 9 10]');
    const eleven = { _type: 'double', _value: 'Matrix(1,11)\n[' + [1,2,3,4,5,6,7,8,9,10,11].join(', ') + ']' };
    expect(MatlabVariableNode.parseTypedArray(eleven, 'a', null).displayValue).toBe('<1x11 double>');
  });

  it('summarizes a rank-3 array whatever its element count', () => {
    const raw = { _type: 'double', _value: 'Matrix(2,3,2)\n[[1, 3, 5]; [2, 4, 6]; [7, 9, 11]; [8, 10, 12]]' };
    expect(MatlabVariableNode.parseTypedArray(raw, 'A', null).displayValue).toBe('<2x3x2 double>');
  });

  it('renders a 2x3 as a MATLAB matrix literal', () => {
    const raw = { _type: 'double', _value: 'Matrix(2,3)\n[[1, 2, 3]; [4, 5, 6]]' };
    expect(MatlabVariableNode.parseTypedArray(raw, 'B', null).displayValue).toBe('[1 2 3; 4 5 6]');
  });
```

Then change the two existing `'[]'` expectations at `test/matlabVariableNode.test.ts:125` and `:447` to `'[ ]'`, and the same at `test/matVariableFromMat.test.ts:98` and `:190`. Confirm the exact lines first: `grep -n "'\[\]'" test/*.test.ts`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/matlabVariableNode.test.ts`
Expected: FAIL — `[]` for empty, the 11-element array renders in full, the rank-3 array renders `[1 3 5; 2 4 6; 7 9 11; 8 10 12]` (four rows for a two-row array).

- [ ] **Step 3: Implement**

Replace `formatMatrix` (lines 173-187) with a version that walks the elements it has instead of a rows x cols grid:

```ts
// A MATLAB matrix literal: `[1 2 3; 4 5 6]`. Only ever called for rank <= 2 —
// the caller summarizes anything higher, because mat2str itself refuses rank >= 3
// and there is no MATLAB one-line spelling to match.
//
// The row loop used to run to dims[0] x dims[1] and print '?' for anything it
// could not find, so an element list shorter than the declared shape filled the
// display with question marks. It now formats the elements that exist.
function formatMatrix(rows: number, cols: number, elements: unknown[]): string {
  if (elements.length === 0) {
    return EMPTY_NUMERIC;
  }
  const rowStrs: string[] = [];
  for (let r = 0; r < rows; r++) {
    const vals: string[] = [];
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= elements.length) { break; }
      vals.push(formatMatlabNum(elements[i]));
    }
    if (vals.length > 0) { rowStrs.push(vals.join(' ')); }
  }
  return '[' + rowStrs.join('; ') + ']';
}
```

Replace `_formatArray` (lines 475-489) with:

```ts
  _formatArray(): string {
    const elems =
      this.children.length > 0
        ? this.children.map(function (c) {
            return (c as MatlabVariableNode)._scalarValue;
          })
        : this._elements;
    if (elems.length === 0) {
      return EMPTY_NUMERIC;
    }
    const className = this._scalarType === 'logical' ? 'logical' : this._scalarType || 'double';
    // Rank >= 3, or more elements than a one-line literal should carry. Elements
    // are expandable child rows, so the count rule applies and the user loses
    // nothing: the values are one click away.
    if (needsSummary(this._dims)) {
      return summaryForm(this._dims, className);
    }
    const formatted =
      this._scalarType === 'logical'
        ? elems.map(function (v) { return v ? 'true' : 'false'; })
        : elems;
    const text = formatMatrix(this._dims[0], this._dims[1], formatted);
    // The count rule alone is not a bound on LENGTH: ten 200-character elements
    // are still a 2000-character cell. The char budget is the runaway guard.
    return overCharBudget(text) ? summaryForm(this._dims, className) : text;
  }
```

Add to the imports:

```ts
import {
  EMPTY_CELL,
  EMPTY_NUMERIC,
  needsSummary,
  overCharBudget,
  summaryForm,
} from '../../display/DisplayConvention.js';
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/matlabVariableNode.test.ts test/matVariableFromMat.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "[wip] give numeric arrays one display rule: [ ] empty, <mxn class> summary"
```

### Task 7.2: `_formatCell`, `_formatString`, `_formatScalar`

**Files:**
- Modify: `src/datamodel/node/data/MatlabVariableNode.ts:466-467` (struct), `:491-531`
- Test: `test/matlabVariableNode.test.ts` (modify `:133`; add)

> **OBLIGATION — do not regress the column-major read (defect 14).** This task
> rewrites both formatters wholesale, and both already carry a fix that Phase 5
> landed: they index the element list `[c * rows + r]`, **not** `[r * cols + c]`.
> A cell or string element list is column-major (`MatParser.parseMatrix`
> transposes only its numeric branch, `MatParser.ts:234`), so a row-major read
> prints MATLAB's `{1 2 3; 4 5 6}` as `{1, 4, 2; 5, 3, 6}`. The listings below
> already have the correct index — copy them literally. `test/cellElementOrder.test.ts`
> will fail loudly if this regresses, so run it as part of Step 4, not just the
> one file named above:
>
> ```bash
> npx vitest run test/matlabVariableNode.test.ts test/cellElementOrder.test.ts
> ```

- [ ] **Step 1: Write the failing test**

The existing expectation at `test/matlabVariableNode.test.ts:133` pins `{1x8 cell}` for an 8-element cell. Under the count rule 8 <= 10, so that cell now renders its literal. Re-pin the summary with an 11-element cell and correct the 8-element case:

```ts
  it('renders an 8-element cell in full — under the element budget', () => {
    const node = cellOf(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(node.displayValue).toBe("{'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'}");
  });

  it('summarizes an 11-element cell in angle brackets', () => {
    const node = cellOf(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']);
    expect(node.displayValue).toBe('<1x11 cell>');
  });

  it('summarizes a short cell whose CONTENTS are huge', () => {
    const long = 'x'.repeat(300);
    const node = cellOf([long, long, long, long]);
    expect(node.displayValue).toBe('<1x4 cell>');
  });

  it('spells an empty cell as MATLAB does', () => {
    expect(cellOf([]).displayValue).toBe('{ }');
  });

  it('always summarizes a struct, at every size', () => {
    expect(structNodeOf([1, 1]).displayValue).toBe('<1x1 struct>');
    expect(structNodeOf([2, 3]).displayValue).toBe('<2x3 struct>');
  });
```

`cellOf` and `structNodeOf` are local helpers — write them in the test file from the shapes the existing tests in that file already build (`grep -n 'parseCell\|_scalarType = .struct' test/matlabVariableNode.test.ts`). Do not invent a new raw-value shape; copy the one the file uses.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/matlabVariableNode.test.ts`
Expected: FAIL — `{}` for empty, `{1x11 cell}` in braces, and the 4-element cell of 300-char strings renders 1200 characters.

- [ ] **Step 3: Implement**

Replace `_formatCell` (lines 491-511) with:

```ts
  _formatCell(): string {
    if (this.children.length === 0) {
      return EMPTY_CELL;
    }
    if (needsSummary(this._dims)) {
      return summaryForm(this._dims, 'cell');
    }
    const rows = this._dims[0];
    const cols = this._dims[1];
    const rowStrs: string[] = [];
    for (let r = 0; r < rows; r++) {
      const vals: string[] = [];
      for (let c = 0; c < cols; c++) {
        // [c * rows + r], NOT [r * cols + c]: the cell element list is
        // column-major. See the obligation note at the top of this task.
        const child = this.children[c * rows + r];
        vals.push(child ? child.displayValue : EMPTY_NUMERIC);
      }
      rowStrs.push(vals.join(', '));
    }
    const text = '{' + rowStrs.join('; ') + '}';
    return overCharBudget(text) ? summaryForm(this._dims, 'cell') : text;
  }
```

Replace `_formatString` (lines 513-531) with:

```ts
  _formatString(): string {
    const d = this._dims;
    if (d[0] === 1 && d[1] === 1 && this._elements.length === 1) {
      return formatMatlabString(String(this._elements[0]));
    }
    if (needsSummary(d)) {
      return summaryForm(d, 'string');
    }
    const rows = d[0];
    const cols = d[1];
    const rowStrs: string[] = [];
    for (let r = 0; r < rows; r++) {
      const vals: string[] = [];
      for (let c = 0; c < cols; c++) {
        // Column-major, same as _formatCell above.
        const el = this._elements[c * rows + r];
        vals.push(formatMatlabString(el !== undefined ? String(el) : ''));
      }
      rowStrs.push(vals.join(' '));
    }
    const text = '[' + rowStrs.join('; ') + ']';
    return overCharBudget(text) ? summaryForm(d, 'string') : text;
  }
```

Replace the struct line in `_formatScalar` (line 467) with:

```ts
    if (this._scalarType === 'struct') {
      // Always a summary, at every size: MATLAB never prints a struct inline.
      return summaryForm(this._dims, 'struct');
    }
```

`summaryForm` normalizes through `effectiveDims`, so a struct whose `_dims` is `[]` prints `<1x1 struct>` rather than `<... struct>` — one more thing the raw join could not do.

Also apply the budget to a long char scalar. A 1500-character char array should not render inline:

```ts
    if (this._scalarType === 'char') {
      const text = formatMatlabChar(String(this._scalarValue));
      return overCharBudget(text) ? summaryForm(this._dims, 'char') : text;
    }
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/matlabVariableNode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "[wip] one summary form for cells, strings, structs and long chars"
```

### Task 7.3: the opaque and `PropValue` sites

**Files:**
- Modify: `src/datamodel/node/data/MatlabVariableNode.ts:433-436`
- Modify: `src/datamodel/prop/PropValue.ts:40-47`
- Test: `test/matlabVariableNode.test.ts`, `test/propValue.test.ts` (add; create the latter if absent)

- [ ] **Step 1: Write the failing test**

```ts
// test/propValue.test.ts
// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import PropValue from '../src/datamodel/prop/PropValue.js';

describe('PropValue.format arrays', () => {
  it('spells empty as MATLAB does', () => {
    expect(PropValue.format([])).toBe('[ ]');
    expect(PropValue.format(null)).toBe('[ ]');
  });

  it('renders up to 10 elements inline and summarizes at 11', () => {
    expect(PropValue.format([1, 2, 3])).toBe('[1 2 3]');
    expect(PropValue.format([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe('[1 2 3 4 5 6 7 8 9 10]');
    expect(PropValue.format([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toBe('<1x11 double>');
  });

  it('uses the shared summary form, so the consumer styles it like every other', () => {
    const s = PropValue.format(Array.from({ length: 20 }, (_, i) => i));
    expect(s.startsWith('<') && s.endsWith('>')).toBe(true);
  });
});
```

and for the opaque site, in `test/matlabVariableNode.test.ts`:

```ts
  it('summarizes an opaque array in angle brackets, not square ones', () => {
    const node = new MatlabVariableNode('o', null, {}) as any;
    node._isOpaque = true;
    node._opaqueClassName = 'string';
    node._mcosValue = ['a', 'b'];
    node._mcosDimensions = [1, 2];
    expect(node.displayValue).toBe('<1x2 string>');
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/propValue.test.ts test/matlabVariableNode.test.ts`
Expected: FAIL — `[1x2 string]` in square brackets, and `PropValue.format` renders 11 elements inline (33 characters, under the old 50-char threshold).

- [ ] **Step 3: Implement**

In `MatlabVariableNode.displayValue`, replace lines 433-436:

```ts
        if (Array.isArray(this._mcosValue)) {
          const dims = this._mcosDimensions || [1, (this._mcosValue as unknown[]).length];
          // Angle brackets, like every other summary: square brackets read as a
          // MATLAB literal, and the consumer table keys its gray/italic styling
          // (and its no-editor rule) on the angle-bracket form.
          return summaryForm(dims, this._opaqueClassName || 'double');
        }
```

and the two `'<1x1 ' + this._opaqueClassName + '>'` literals at `:432` and `:438` become `summaryForm([1, 1], this._opaqueClassName || 'double')`, so nothing in this getter spells the form by hand.

In `PropValue.ts`, replace the array branch:

```ts
        if (Array.isArray(value)) {
            if (value.length === 0) { return EMPTY_NUMERIC; }
            if (value.length === 1 && typeof value[0] === 'string') {
                return formatMatlabString(value[0]);
            }
            // The same rule the node layer uses. This atom renders a PROPERTY
            // value, which has no child rows to expand into, so the char budget
            // is what matters — but a list this long is unreadable inline well
            // before it is long, hence the element rule too.
            const dims = [1, value.length];
            if (needsSummary(dims)) { return summaryForm(dims, 'double'); }
            const arrStr = '[' + value.map(formatMatlabNum).join(' ') + ']';
            return overCharBudget(arrStr) ? summaryForm(dims, 'double') : arrStr;
        }
```

with

```ts
import { EMPTY_NUMERIC, needsSummary, overCharBudget, summaryForm } from '../display/DisplayConvention.js';
```

and change the two `'[ ]'` literals at `:19` and `:41` to `EMPTY_NUMERIC` so the spelling lives in one place.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/propValue.test.ts test/matlabVariableNode.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite**

Run: `npm run typecheck && npm test`
Expected: all passing. Property-display tests across `test/` may have pinned a 50-char threshold — a value between 11 elements and 50 characters now summarizes where it did not. Each such expectation is the convention changing as designed; update it and list the files in the commit body.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "[wip] route the opaque and property display paths through the convention"
```

### Task 7.4: Pin the `valueEditable` consequence

**Files:**
- Test: `test/baseNode.test.ts` (append)

- [ ] **Step 1: Write the test**

```ts
  it('offers no editor for a summarized value, and does for an inline one', () => {
    // valueEditable keys on the angle-bracket form, so moving summaries onto
    // <mxn class> deliberately makes summarized cells read-only: a 2x3x2 cannot
    // be typed into a one-line box. Assert it rather than let it drift.
    const inline = MatlabVariableNode.parseTypedArray(
      { _type: 'double', _value: 'Matrix(1,3)\n[1, 2, 3]' }, 'a', null);
    expect(inline.displayValue).toBe('[1 2 3]');
    expect(inline.valueEditable).toBe(true);

    const summarized = MatlabVariableNode.parseTypedArray(
      { _type: 'double', _value: 'Matrix(2,3,2)\n[[1, 3, 5]; [2, 4, 6]; [7, 9, 11]; [8, 10, 12]]' }, 'A', null);
    expect(summarized.displayValue).toBe('<2x3x2 double>');
    expect(summarized.valueEditable).toBe(false);
  });
```

Import `MatlabVariableNode` in `test/baseNode.test.ts` if it is not already imported; if that file is meant to stay free of node-subclass imports, put this test in `test/matlabVariableNode.test.ts` instead.

- [ ] **Step 2: Run it**

Run: `npx vitest run test/baseNode.test.ts`
Expected: PASS — this documents behaviour Tasks 7.1-7.3 already produced.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "[wip] pin that a summarized value is read-only"
```

---

## Phase 8: container shape accessors — defects 9 and 13

Two small gaps that make the parity suite unable to see what it needs to check.

**Defect 9.** `mcosTypedNode.ts:55` truncates the shape on the way in:

```ts
const dims = dimensions && dimensions.length >= 2 ? [dimensions[0], dimensions[1]] : [1, 1];
```

A 2x3x2 object array out of a `.mat` or `.slx` MCOS stream becomes a 2x3, so the container prints `<2x3 Simulink.Parameter>` for twelve elements and the element labels run past the end. Phase 3's helper handles rank >= 3 correctly, but only if it is given the extents — this is the site that withholds them.

**Defect 13.** `ObjectNode` and `StructNode` know their shape (`serial._rawVal._dimensions` / `serial._dimensions`) but expose it only baked into `displayValue`. A parity test that wants to compare against MATLAB's `size()` has to parse the display string it is also asserting — a test that cannot fail independently of the thing it checks. Both get a `dims` accessor.

### Task 8.1: Keep every extent through the MCOS path

**Files:**
- Modify: `src/datamodel/node/data/mcosTypedNode.ts:37-55`
- Test: `test/mcosTypedNode.test.ts` (add; create if absent — check with `ls test/ | grep -i mcos`)

- [ ] **Step 1: Write the failing test**

```ts
// Copyright 2026 The MathWorks, Inc.
//
// An object array out of an MCOS stream. The shape used to be truncated to its
// first two extents, so a 2x3x2 reported as a 2x3 and half its elements were
// labelled past the end of the array.
import { describe, it, expect } from 'vitest';
import { buildTypedNodeFromMcos } from '../src/datamodel/node/data/mcosTypedNode.js';

function elems(n: number) {
  return Array.from({ length: n }, (_, i) => ({ Value: { _type: 'double', _value: String(i + 1) } }));
}

describe('buildTypedNodeFromMcos shape', () => {
  it('keeps all three extents of a rank-3 object array', () => {
    const node = buildTypedNodeFromMcos('Simulink.Parameter', 'v', null, null, elems(12), [2, 3, 2]) as any;
    expect(node).toBeTruthy();
    expect(node.dims).toEqual([2, 3, 2]);
    expect(node.displayValue).toBe('<2x3x2 Simulink.Parameter>');
    expect(node.children.length).toBe(12);
    const labels = node.children.map((c: any) => c.displayName);
    expect(labels[0]).toBe('v(1,1,1)');
    expect(labels[11]).toBe('v(2,3,2)');
  });

  it('is unchanged for a rank-2 array', () => {
    const node = buildTypedNodeFromMcos('Simulink.Parameter', 'w', null, null, elems(6), [2, 3]) as any;
    expect(node.dims).toEqual([2, 3]);
    expect(node.displayValue).toBe('<2x3 Simulink.Parameter>');
  });

  it('is unchanged for a scalar', () => {
    const node = buildTypedNodeFromMcos('Simulink.Parameter', 'p', null, { Value: { _type: 'double', _value: '5' } }) as any;
    expect(node.dims).toEqual([1, 1]);
  });
});
```

The `Value` shape above must match what the SLDD path feeds `ParameterNode.parse` — copy it from an existing MCOS or object-array test rather than guessing (`grep -rn 'buildTypedNodeFromMcos' test/ | head`).

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/mcosTypedNode.test.ts`
Expected: FAIL — no `dims` accessor, and `[2,3]` where MATLAB says `[2,3,2]`.

- [ ] **Step 3: Implement**

Replace line 55 with:

```ts
  // Every extent, not just the first two. Truncating to [d0, d1] reported a
  // 2x3x2 as a 2x3, which both mislabelled the elements past page 1 and printed
  // a shape MATLAB never had. A missing or 1-element `dimensions` is a scalar
  // unless we have more elements than that, in which case it is a row vector.
  const dims =
    dimensions && dimensions.length >= 2
      ? dimensions.slice()
      : elems.length > 1
        ? [1, elems.length]
        : [1, 1];
```

and update the header comment at `:37-41` to say `Name(1,1), Name(2,1), …` in column-major order, since Phase 3 changed what those labels are.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/mcosTypedNode.test.ts`
Expected: the rank-2 and scalar cases PASS; the rank-3 case still fails on `dims` until Task 8.2. Run them together after 8.2 — or write 8.2 first if you prefer a single green step.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "[wip] stop truncating an MCOS object array's shape to two extents"
```

### Task 8.2: `dims` on `ObjectNode` and `StructNode`

**Files:**
- Modify: `src/datamodel/node/data/ObjectNode.ts:47-52`
- Modify: `src/datamodel/node/data/StructNode.ts:38-41`
- Test: `test/objectArrayExpansion.test.ts`, `test/structNode.test.ts` (append)

- [ ] **Step 1: Write the failing test**

In `test/objectArrayExpansion.test.ts`:

```ts
  it('exposes its shape as data, not only inside displayValue', () => {
    const val = arrayValue('Simulink.Parameter', [2, 3], [
      { Value: 11 }, { Value: 21 }, { Value: 12 }, { Value: 22 }, { Value: 13 }, { Value: 23 },
    ]);
    const node = NodeRegistry.parseValue(val, 'w', null) as any;
    expect(node.dims).toEqual([2, 3]);
    // A nested scalar object carries no _dimensions at all.
    const scalar = NodeRegistry.parseValue(arrayValue('Simulink.Parameter', [1, 1], [{ Value: 1 }]), 'p', null) as any;
    expect(scalar.dims).toEqual([1, 1]);
  });
```

In `test/structNode.test.ts`:

```ts
  it('exposes its shape as data', () => {
    const val = { _mw_element_type: 'MATLABStruct', _dimensions: [2, 3], _fields: ['a'], _elements: [] };
    expect((StructNode.parse(val as any, 's', null) as any).dims).toEqual([2, 3]);
  });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run test/objectArrayExpansion.test.ts test/structNode.test.ts`
Expected: FAIL — `node.dims` is `undefined`.

- [ ] **Step 3: Implement**

In `ObjectNode.ts`, replace lines 47-52 with:

```ts
    // The shape as DATA. A parity test that has to read the display string to
    // learn the shape cannot fail independently of the string it is checking.
    get dims(): number[] {
        const raw = (this.serial._rawVal as Record<string, unknown>) || {};
        // A nested object carries no _dimensions at all — it is always a scalar.
        return effectiveDims(raw._dimensions as number[] | undefined);
    }

    get displayValue(): string {
        return summaryForm(this.dims, this.arrayClass);
    }
```

with

```ts
import { effectiveDims, summaryForm } from '../../display/DisplayConvention.js';
```

In `StructNode.ts`, replace lines 38-41 with:

```ts
    get dims(): number[] {
        return effectiveDims(this.serial._dimensions as number[] | undefined);
    }

    get displayValue(): string {
        return summaryForm(this.dims, 'struct');
    }
```

and the same import. Leave the other `serial._dimensions` reads in `StructNode` (lines 69, 100, 159, 187) alone — they feed serialization, where the stored value must go back exactly as it came, not normalized.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/objectArrayExpansion.test.ts test/structNode.test.ts test/mcosTypedNode.test.ts`
Expected: PASS, including Task 8.1's rank-3 case.

- [ ] **Step 5: Full suite**

Run: `npm run typecheck && npm test`
Expected: all passing. `effectiveDims` normalizes, so a node whose `_dimensions` was `[3]` now displays `<1x3 …>` instead of `<3 …>` — if a test pinned the single-extent spelling, that spelling was wrong (MATLAB has no 1-D size) and the expectation gets corrected.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "[wip] expose container shape as data on ObjectNode and StructNode"
```

---

## Phase 9: MATLAB `string` from a `.mat` file — defect 2

A MATLAB `string` in a `.mat` file is an opaque MCOS object, and `McosParser.buildObjectValue:480-484` gives up on it by design:

```ts
if (cls && cls.fullName === STRING_CLASS_NAME) {
  return NOT_AVAILABLE;
}
```

Two separate things are wrong downstream, and only one of them depends on cracking the payload:

1. **Shape and type.** A 1x2 string array displays `<1x1 string>` — the sentinel path at `:438` hardcodes `1x1` — and its Data Type column is blank, because `dataType` returns `''` for anything opaque (`:370-372`). `string` is a genuine MATLAB data type, not a class name, so blanking it is wrong regardless of whether we can read the text. This is fixable now, with no reverse engineering.
2. **The text.** Recoverable only if the payload layout holds up under a probe.

So Task 9.1 probes, Task 9.2 fixes shape and type unconditionally, and Task 9.3 decodes the text **if and only if** the probe confirms a layout. If it does not, 9.2 still lands and the sentinel stays — an honest `<1x2 string>` with Data Type `string` beats a wrong `<1x1 string>` with a blank type. **Do not guess a byte layout.** A decoder built on a guess produces plausible mojibake, which is worse than the sentinel.

### Task 9.1: Probe the payload

**Files:**
- Create: `test/parity/matlab/probe_string.m`
- Create: `test/parity/matlab/STRING_MCOS.md` (the findings)

- [ ] **Step 1: Write the probe**

```matlab
% What does MATLAB actually put in a .mat file for a string?
% Writes fixtures and dumps the MCOS subsystem bytes so the layout can be read
% off the file rather than guessed.
outdir = '/tmp/strprobe';
if ~exist(outdir, 'dir'), mkdir(outdir); end

sScalar = "hello";
sRow    = ["alpha", "beta", "gamma"];
s2x3    = ["a" "b" "c"; "d" "e" "f"];
sEmptyE = "";
sMissing = [string(missing), "x"];
sUnicode = ["caf" + char(233), "na" + char(239) + "ve"];

save(fullfile(outdir, 'strings.mat'), 'sScalar', 'sRow', 's2x3', 'sEmptyE', 'sMissing', 'sUnicode');
save(fullfile(outdir, 'strings_v7.mat'), '-v7', 'sScalar', 'sRow', 's2x3');

truth = struct();
truth.sScalar_size = size(sScalar);
truth.sRow_size = size(sRow);
truth.s2x3_size = size(s2x3);
truth.sRow_disp = formattedDisplayText(sRow);
truth.s2x3_disp = formattedDisplayText(s2x3);
truth.sScalar_chars = double(char(sScalar));
truth.sRow_chars = cellfun(@(c) double(c), cellstr(sRow), 'UniformOutput', false);
truth.s2x3_linear = cellstr(s2x3(:))';       % MATLAB column-major order
truth.sMissing_ismissing = ismissing(sMissing);
truth.sUnicode_codes = cellfun(@(c) double(c), cellstr(sUnicode), 'UniformOutput', false);
fid = fopen(fullfile(outdir, 'truth.json'), 'w');
fprintf(fid, '%s', jsonencode(truth));
fclose(fid);

% Raw bytes of the uncompressed file, so the subsystem can be read directly.
save(fullfile(outdir, 'strings_nocomp.mat'), '-v7.3', 'sRow');   % HDF5, for comparison
f = fopen(fullfile(outdir, 'strings.mat'), 'r');
b = fread(f, Inf, 'uint8=>uint8');
fclose(f);
fid = fopen(fullfile(outdir, 'strings_bytes.txt'), 'w');
fprintf(fid, '%d\n', b);
fclose(fid);
fprintf('bytes: %d\n', numel(b));
disp('PROBE OK');
```

Run it:

```bash
mw -using Bmain matlab -nodesktop -batch "run('$PWD/test/parity/matlab/probe_string.m')"
cp /tmp/strprobe/strings.mat test/fixtures/strings.mat
cp /tmp/strprobe/truth.json test/fixtures/strings_truth.json
```

- [ ] **Step 2: Dump what our parser already sees**

Write a throwaway script (do NOT commit it) that loads the fixture through `parseMat` and prints, for each variable: `className`, `dimensions`, and — for the MCOS subsystem variable — every cell's `className`, `dimensions` and first 32 values:

```bash
cat > /tmp/strprobe/dump.mjs <<'EOF'
import { readFileSync } from 'node:fs';
import { parseMat } from './dist/datamodel/parser/MatParser.js';
const buf = readFileSync('test/fixtures/strings.mat');
const parsed = parseMat(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
for (const v of parsed.variables) {
  console.log('---', JSON.stringify(v.name), v.className, JSON.stringify(v.dimensions), v._anonymous ? '(anon)' : '');
  if (Array.isArray(v.value)) {
    v.value.slice(0, 12).forEach((c, i) => {
      if (c && typeof c === 'object') {
        const vals = Array.isArray(c.value) ? c.value.slice(0, 32) : c.value;
        console.log('  cell', i, c.className, JSON.stringify(c.dimensions), JSON.stringify(vals));
      } else { console.log('  cell', i, c); }
    });
  }
}
EOF
npm run build && node /tmp/strprobe/dump.mjs
```

- [ ] **Step 3: Write down what you found**

Create `test/parity/matlab/STRING_MCOS.md` recording, from the dump and not from memory:
- which subsystem cell holds `sRow`'s data and what class it is,
- the leading metadata words and what each one means (version, ndims, extents, per-element character counts),
- how the character data is encoded (UTF-16 code units, and how they are packed into the containing class),
- how an empty string and a `missing` are distinguished,
- whether `-v7` and the default `-v7.3` differ in any of the above.

State plainly anything you could **not** determine. That note is what Task 9.3 implements against, and it is the deliverable of this task even if the layout turns out to be undecodable.

- [ ] **Step 4: Commit**

```bash
git add test/parity/matlab/probe_string.m test/parity/matlab/STRING_MCOS.md test/fixtures/strings.mat test/fixtures/strings_truth.json
git commit -m "[wip] probe how MATLAB stores a string in a .mat file"
```

### Task 9.2: Correct shape and Data Type for an unrecoverable string

**Files:**
- Modify: `src/datamodel/parser/McosParser.ts:476-487`
- Modify: `src/datamodel/node/data/MatlabVariableNode.ts:427-439` (opaque `displayValue`), `:370-372` (`dataType`)
- Test: `test/matStringOpaque.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// Copyright 2026 The MathWorks, Inc.
//
// A MATLAB string out of a .mat file. Even when the text cannot be recovered, the
// SHAPE and the DATA TYPE are both known — a 1x2 used to display <1x1 string>
// with a blank Data Type, which is wrong twice over.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadFile, findEntry } from './parity/loadFile.js';

const truth = JSON.parse(readFileSync('test/fixtures/strings_truth.json', 'utf8'));
const root = loadFile('../fixtures/strings.mat');

function entryNamed(name: string): any {
  return findEntry(root, name);
}

describe('MAT string shape and type', () => {
  it('reports a string array with the shape MATLAB reports', () => {
    const n = entryNamed('sRow');
    expect(n.dataType).toBe('string');
    expect(truth.sRow_size).toEqual([1, 3]);
    // Either the text was decoded (Task 9.3) or the sentinel stands — but the
    // shape and the type are right either way.
    if (n.displayValue.startsWith('<')) {
      expect(n.displayValue).toBe('<1x3 string>');
    }
  });

  it('reports a scalar string as 1x1', () => {
    const n = entryNamed('sScalar');
    expect(n.dataType).toBe('string');
  });
});
```

Use whatever `addMatSource`/`getChildren` signature the repo has — copy the idiom from `test/matVariableFromMat.test.ts`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/matStringOpaque.test.ts`
Expected: FAIL — `dataType` is `''`, and `displayValue` is `<1x1 string>` for a 1x3.

- [ ] **Step 3: Implement**

In `McosParser.ts`, carry the shape alongside the sentinel instead of discarding it. `buildObjectValue` returns a bare `NOT_AVAILABLE` today; the decoder's caller already receives a `dimensions` field (`createFromMcosDecoded`'s `decoded.dimensions`), so the fix is to make sure the string branch populates it from the opaque array's own declared dimensions rather than defaulting to `[1,1]`. Trace it from the call site: `grep -n 'createFromMcosDecoded\|decodeMcos' src/datamodel/**/*.ts` and set `dimensions` at whichever site builds the `decoded` object for a `string`-classed variable.

In `MatlabVariableNode.dataType` (lines 370-372):

```ts
  get dataType(): string {
    // `string` is a real MATLAB data type even though it arrives as an opaque
    // MCOS object, so it belongs in the DataType column. Every other opaque
    // className is a Class name (Simulink.Parameter), which is not a type.
    if (this._isOpaque) {
      return this._opaqueClassName === 'string' ? 'string' : '';
    }
    return this.className;
  }
```

and in the opaque branch of `displayValue`, replace the two hardcoded `1x1` literals so the sentinel path uses the real shape:

```ts
      return summaryForm(this._mcosDimensions || [1, 1], this._opaqueClassName || 'double');
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/matStringOpaque.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite and commit**

Run: `npm run typecheck && npm test`

```bash
git add -A
git commit -m "[wip] report a MAT string's real shape and its data type"
```

### Task 9.3: Decode the text — only if Task 9.1 confirmed the layout

**Files:**
- Modify: `src/datamodel/parser/McosParser.ts:476-487`
- Test: `test/matStringOpaque.test.ts` (append)

- [ ] **Step 1: Decide, in writing**

Read `test/parity/matlab/STRING_MCOS.md`. If it does not state the layout with enough certainty to write a decoder — every metadata word accounted for, character encoding and packing known, empty and `missing` distinguishable — **stop here.** Record the decision in `STRING_MCOS.md` under a "Not implemented" heading with what is still unknown, note it in DESIGN.md's Known limitations section, and move to Phase 10. This is a legitimate outcome, not a failure: the sentinel is honest and Task 9.2 already fixed what was verifiably wrong.

- [ ] **Step 2: Write the failing test**

```ts
describe('MAT string text', () => {
  it('recovers the text of a string array in MATLAB order', () => {
    const n = entryNamed('sRow');
    expect(n.children.map((c: any) => c.displayValue)).toEqual(['"alpha"', '"beta"', '"gamma"']);
  });

  it('recovers a scalar string', () => {
    expect(entryNamed('sScalar').displayValue).toBe('"hello"');
  });

  it('labels a 2x3 string array by MATLAB subscript', () => {
    const n = entryNamed('s2x3');
    const byLabel = new Map(n.children.map((c: any) => [c.displayName, c.displayValue]));
    // truth.s2x3_linear is MATLAB's column-major cellstr: a d b e c f.
    expect(byLabel.get('s2x3(1,1)')).toBe('"' + truth.s2x3_linear[0] + '"');
    expect(byLabel.get('s2x3(2,1)')).toBe('"' + truth.s2x3_linear[1] + '"');
    expect(byLabel.get('s2x3(1,2)')).toBe('"' + truth.s2x3_linear[2] + '"');
  });

  it('keeps non-ASCII characters intact', () => {
    const n = entryNamed('sUnicode');
    const codes = (n.children[0].displayValue as string).replace(/"/g, '').split('').map((ch) => ch.charCodeAt(0));
    expect(codes).toEqual(truth.sUnicode_codes[0]);
  });

  it('distinguishes an empty string from missing', () => {
    expect(entryNamed('sEmptyE').displayValue).toBe('""');
    const m = entryNamed('sMissing');
    expect(m.children[0].displayValue).toBe('<missing>');
    expect(m.children[1].displayValue).toBe('"x"');
  });
});
```

Adjust the quoting to whatever `formatMatlabString` produces (`grep -n 'export function formatMatlabString' -A 8 src/datamodel/parser/MatlabValueParser.ts`), and drop the `missing` case if `STRING_MCOS.md` could not distinguish it — replace it with an assertion of whatever the layout *does* let you tell apart, and note the gap.

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx vitest run test/matStringOpaque.test.ts`
Expected: FAIL — every value is `<not available>`.

- [ ] **Step 4: Implement against `STRING_MCOS.md`**

Replace the `STRING_CLASS_NAME` early return in `buildObjectValue` with a decoder that reads the object's own saved payload per the documented layout and returns a value shaped like the `string`-kind variable the node layer already renders (`_kind = 'string'`, `_dims`, `_elements`) — that path exists and is exercised by `MatlabVariableNode._formatString`, so no new display code is needed. Keep the sentinel as the fallback for any element the layout cannot account for: partial recovery per element, never a wrong character.

Write the decoder as a named function with a comment block transcribing the layout from `STRING_MCOS.md`, so the next reader does not have to re-derive it.

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npx vitest run test/matStringOpaque.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite and commit**

Run: `npm run typecheck && npm test`

```bash
git add -A
git commit -m "[wip] decode MATLAB string values out of the MCOS subsystem"
```

---

## Phase 10: 64-bit integers, exactly — defect 1

`intmax('uint64')` is 18446744073709551615. A JavaScript `number` cannot hold it: we display `18446744073709552000`. Same for `intmin('int64')`. This is a **silent value corruption on both read and write** — the wrong number is what gets serialized back.

Three sites lose the digits, and one already keeps them:

| Path | Today | |
|---|---|---|
| `.mat` read | `Number(view.getBigInt64(...))` — `MatParser.ts:129-130` | lossy |
| `.sldd` typed **scalar** | `parseMatlabNum(...)` in `MatlabVariableNode.parseTypedScalar:1789` | lossy *(the parser kept the exact text at `BinarySlddParser.ts:456`; the node throws it away)* |
| `.sldd` typed **array** | `text.split(/\s+/).map(Number)` — `BinarySlddParser.ts:323`, and `parseMatlabNum` in `parseMatrixValue` | lossy |
| `.sldd` serialize | `formatMatlabNum` -> `String(num)` — `XmlUtils.ts:13-18` | already exact for a `bigint`, since `String(10n)` is `'10'` |

**The rule: `bigint` only where a `number` would be wrong.** A 64-bit value inside the safe-integer range stays a `number`, so nothing in the existing code, tests or arithmetic changes; only the values that are currently corrupted switch representation. Mixed types within one array are harmless because every display and serialize path goes through `formatMatlabNum`, which handles both.

### Task 10.1: `formatMatlabNum` and an exact integer parse

**Files:**
- Modify: `src/datamodel/parser/XmlUtils.ts:13-31`
- Test: `test/xmlUtils.test.ts` (add; create if absent)

- [ ] **Step 1: Write the failing test**

```ts
// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { formatMatlabNum, parseMatlabNum, parseMatlabInt } from '../src/datamodel/parser/XmlUtils.js';

describe('formatMatlabNum', () => {
  it('spells a bigint exactly', () => {
    expect(formatMatlabNum(18446744073709551615n)).toBe('18446744073709551615');
    expect(formatMatlabNum(-9223372036854775808n)).toBe('-9223372036854775808');
  });

  it('is unchanged for numbers, including the non-finites', () => {
    expect(formatMatlabNum(3)).toBe('3');
    expect(formatMatlabNum(-1.5)).toBe('-1.5');
    expect(formatMatlabNum(Infinity)).toBe('Inf');
    expect(formatMatlabNum(-Infinity)).toBe('-Inf');
    expect(formatMatlabNum(NaN)).toBe('NaN');
  });
});

describe('parseMatlabInt', () => {
  it('keeps every digit of a 64-bit limit', () => {
    expect(parseMatlabInt('18446744073709551615')).toBe(18446744073709551615n);
    expect(parseMatlabInt('-9223372036854775808')).toBe(-9223372036854775808n);
  });

  it('returns a plain number when one is exact', () => {
    expect(parseMatlabInt('42')).toBe(42);
    expect(parseMatlabInt('-7')).toBe(-7);
    expect(parseMatlabInt('9007199254740991')).toBe(9007199254740991);
  });

  it('tolerates the .sldd type suffixes and whitespace', () => {
    expect(parseMatlabInt(' 18446744073709551615U ')).toBe(18446744073709551615n);
    expect(parseMatlabInt('5F')).toBe(5);
  });

  it('falls back to parseMatlabNum for anything not an integer literal', () => {
    expect(parseMatlabInt('Inf')).toBe(Infinity);
    expect(parseMatlabInt('1.5')).toBe(1.5);
    expect(parseMatlabInt('junk')).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/xmlUtils.test.ts`
Expected: FAIL — `parseMatlabInt` does not exist.

- [ ] **Step 3: Implement**

```ts
// A number as MATLAB spells it. Only the non-finite values differ from
// String(num), but they differ in a way that matters: MATLAB cannot read the
// JavaScript spelling 'Infinity' back, and our own MatlabValueParser rejects it
// too — so a value displayed as 'Infinity' is also an uneditable one.
//
// A bigint reaches here for the 64-bit integers a double cannot hold exactly
// (intmax('uint64') reads back as ...552000 through a number). String() already
// spells one correctly; the branch is here so the contract is visible.
export function formatMatlabNum(num: unknown): string {
    if (typeof num === 'bigint') {
        return num.toString();
    }
    if (typeof num === 'number' && !isFinite(num)) {
        return isNaN(num) ? 'NaN' : num > 0 ? 'Inf' : '-Inf';
    }
    return String(num);
}

// An integer literal, kept exact. Returns a plain number whenever one is exact,
// so only the values a double would corrupt change representation and every
// existing caller, comparison and test sees what it saw before. The .sldd type
// suffixes (5U, 5F) are stripped because the typed scalar path stores the literal
// with them attached.
export function parseMatlabInt(text: string): number | bigint {
    const t = text.trim().replace(/[FUL]$/, '');
    if (!/^[+-]?\d+$/.test(t)) {
        return parseMatlabNum(text);
    }
    const big = BigInt(t);
    const asNum = Number(big);
    return Number.isSafeInteger(asNum) ? asNum : big;
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/xmlUtils.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "[wip] add an exact integer parse and bigint formatting"
```

### Task 10.2: `.mat` 64-bit reads

**Files:**
- Modify: `src/datamodel/parser/MatParser.ts:103-135` (`readNumericArray`), `:219-236` (the numeric branch's types)
- Test: `test/mat64.test.ts` (create)

- [ ] **Step 1: Generate MATLAB truth and write the failing test**

```bash
mkdir -p /tmp/int64 && cat > /tmp/int64/gen.m <<'EOF'
outdir = '/tmp/int64';
maxU64 = intmax('uint64');  minI64 = intmin('int64');  maxI64 = intmax('int64');
safeI64 = int64(9007199254740993);          % 2^53+1: the first integer a double misses
arrU64 = [intmax('uint64'), uint64(1), uint64(0)];
save(fullfile(outdir,'int64.mat'), 'maxU64','minI64','maxI64','safeI64','arrU64');
truth = struct('maxU64', sprintf('%s', string(maxU64)), 'minI64', sprintf('%s', string(minI64)), ...
               'maxI64', sprintf('%s', string(maxI64)), 'safeI64', sprintf('%s', string(safeI64)));
fid = fopen(fullfile(outdir,'truth.json'),'w'); fprintf(fid,'%s',jsonencode(truth)); fclose(fid);
disp(string(maxU64)); disp('GEN OK');
EOF
mw -using Bmain matlab -nodesktop -batch "run('/tmp/int64/gen.m')"
cp /tmp/int64/int64.mat test/fixtures/int64.mat
cp /tmp/int64/truth.json test/fixtures/int64_truth.json
```

Confirm MATLAB printed `18446744073709551615` — that string is the assertion.

```ts
// Copyright 2026 The MathWorks, Inc.
//
// A JavaScript number cannot hold intmax('uint64'): it reads back as
// 18446744073709552000, and that wrong number is what got serialized on save.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadFile, findEntry } from './parity/loadFile.js';

const truth = JSON.parse(readFileSync('test/fixtures/int64_truth.json', 'utf8'));
const root = loadFile('../fixtures/int64.mat');

function entryNamed(name: string): any {
  return findEntry(root, name);
}

describe('64-bit integers from a .mat file', () => {
  it('displays intmax(uint64) with every digit', () => {
    expect(truth.maxU64).toBe('18446744073709551615');
    expect(entryNamed('maxU64').displayValue).toBe(truth.maxU64);
  });

  it('displays intmin(int64) and intmax(int64) exactly', () => {
    expect(entryNamed('minI64').displayValue).toBe(truth.minI64);
    expect(entryNamed('maxI64').displayValue).toBe(truth.maxI64);
  });

  it('keeps 2^53+1, the first integer a double misses', () => {
    expect(entryNamed('safeI64').displayValue).toBe(truth.safeI64);
  });

  it('keeps exactness inside an array', () => {
    const n = entryNamed('arrU64');
    expect(n.children.map((c: any) => c.displayValue)).toEqual([truth.maxU64, '1', '0']);
  });

  it('reports the class as MATLAB does', () => {
    expect(entryNamed('maxU64').dataType).toBe('uint64');
    expect(entryNamed('minI64').dataType).toBe('int64');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/mat64.test.ts`
Expected: FAIL — `18446744073709552000`.

- [ ] **Step 3: Implement**

In `MatParser.ts`, widen the return type and keep the 64-bit values exact:

```ts
function readNumericArray(view: DataView, sub: SubElement, count: number): (number | bigint)[] {
    const values: (number | bigint)[] = [];
```

and replace the two 64-bit cases:

```ts
        // A double cannot hold intmax('uint64') — it reads back as
        // 18446744073709552000, and that wrong number was what got written on
        // save. Keep a bigint only when a number would be wrong, so every other
        // caller sees exactly what it saw before.
        case MI_INT64: values.push(exactInt(view.getBigInt64(off + i * 8, true))); break;
        case MI_UINT64: values.push(exactInt(view.getBigUint64(off + i * 8, true))); break;
```

with, beside `readNumericArray`:

```ts
function exactInt(big: bigint): number | bigint {
    const asNum = Number(big);
    return Number.isSafeInteger(asNum) ? asNum : big;
}
```

In the numeric branch of `parseMatrix` (lines 221-237), the complex mapping and the scalar unwrap both assume `number`. Widen them:

```ts
            const realValues = readNumericArray(view, realSub, totalElements);

            if (isComplex && offset < end) {
                const imagSub = readSubelement(view, offset);
                offset += imagSub.totalSize;
                const imagValues = readNumericArray(view, imagSub, totalElements);
                const colMajor = realValues.map((r, i) => ({ re: r, im: imagValues[i] }));
                result.value = transposeFromColMajor(colMajor, dimensions);
            } else {
                const rowMajor = transposeFromColMajor(realValues, dimensions);
                result.value = rowMajor.length === 1 ? rowMajor[0] : rowMajor;
            }
```

The `as number[]` cast is dropped; `transposeFromColMajor` already takes and returns `unknown[]`, and `result.value` is `unknown`, so nothing downstream needs a change. Complex 64-bit ints are not a MATLAB thing worth special-casing — `{re, im}` carrying a bigint formats correctly through `formatComplex` only if that function uses `formatMatlabNum`; check it (`grep -n 'function formatComplex' -A 10 src/datamodel/node/data/MatlabVariableNode.ts`) and if it uses `String()` or arithmetic, leave complex on `number` by calling `Number()` in the complex branch only, with a comment saying why.

Then follow the type through: run `npm run typecheck` and fix each site it names. Expect `MatlabVariableNode._createFromMatNumeric` and `_buildVarObject`'s array branch to need `number | bigint` in a signature or two. Do **not** silence any of them with `as number` — that is the cast that reintroduces the bug.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/mat64.test.ts && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "[wip] read 64-bit integers out of .mat files without losing digits"
```

### Task 10.3: `.sldd` 64-bit scalars and arrays

**Files:**
- Modify: `src/datamodel/node/data/MatlabVariableNode.ts:1789` (`parseTypedScalar`)
- Modify: `src/datamodel/parser/BinarySlddParser.ts:323` and `:467-478` (`formatNumLiteral`)
- Modify: `src/datamodel/node/data/MatlabVariableNode.ts:203-213` (`parseMatrixValue`'s element parse)
- Test: `test/sldd64.test.ts` (create)

- [ ] **Step 1: Generate truth and write the failing test**

```bash
cat > /tmp/int64/gensldd.m <<'EOF'
outdir = '/tmp/int64';
for fmt = {'uncompressed-text','compressed-binary'}
    f = fmt{1};
    fn = fullfile(outdir, ['i64_' strrep(f,'-','_') '.sldd']);
    if exist(fn,'file'), delete(fn); end
    dd = Simulink.data.dictionary.create(fn);
    dd.FileFormat = f;
    ds = dd.getSection('Design Data');
    ds.addEntry('maxU64', intmax('uint64'));
    ds.addEntry('minI64', intmin('int64'));
    ds.addEntry('arrI64', [intmax('int64'), int64(1)]);
    dd.saveChanges(); dd.close();
end
disp('GEN OK');
EOF
mw -using Bmain matlab -nodesktop -batch "run('/tmp/int64/gensldd.m')"
cp /tmp/int64/i64_uncompressed_text.sldd test/fixtures/i64_text.sldd
cp /tmp/int64/i64_compressed_binary.sldd test/fixtures/i64_binary.sldd
```

```ts
// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { loadFile, findEntry } from './parity/loadFile.js';

describe('64-bit integers from a .sldd', () => {
  for (const [label, file] of [['text', 'i64_text.sldd'], ['binary', 'i64_binary.sldd']] as const) {
    it('keeps every digit of a scalar (' + label + ')', () => {
      const root = loadFile('../fixtures/' + file);
      const find = (n: string) => findEntry(root, n);
      expect(find('maxU64').displayValue).toBe('18446744073709551615');
      expect(find('minI64').displayValue).toBe('-9223372036854775808');
      expect(find('arrI64').children.map((c: any) => c.displayValue)).toEqual([
        '9223372036854775807', '1',
      ]);
    });
  }
});
```

`loadFile`/`findEntry` are from `test/parity/loadFile.ts` — see **Test harness conventions**.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/sldd64.test.ts`
Expected: FAIL — `18446744073709552000` for the scalar. The parser preserved the exact text at `BinarySlddParser.ts:456`; the node's `parseMatlabNum` at `:1789` is what discards it.

- [ ] **Step 3: Implement**

In `parseTypedScalar` (`MatlabVariableNode.ts:1785-1790`), use the exact parse for the integer classes:

```ts
    if (rawVal._type === 'logical') {
      const valStr = (rawVal._value as string).replace(/[FU]$/, '');
      node._scalarValue = valStr === '1' || valStr === 'true';
    } else if (rawVal._type === 'int64' || rawVal._type === 'uint64') {
      // The parser kept the exact literal; parseMatlabNum would round it away.
      node._scalarValue = parseMatlabInt(rawVal._value as string);
    } else {
      node._scalarValue = parseMatlabNum((rawVal._value as string).replace(/[FU]$/, ''));
    }
```

In `parseMatrixValue` (`:203-213`), parse each element exactly when the class is 64-bit:

```ts
  const is64 = raw._type === 'int64' || raw._type === 'uint64';
  const numbers: (number | bigint)[] = [];
  // Inf/-Inf/NaN are elements too, and a digits-only pattern would skip them —
  // shifting every later element one slot left and corrupting the whole matrix.
  const numMatches = body.match(/-?(?:[\d.]+(?:[eE][+-]?\d+)?|Inf|NaN)/g);
  if (numMatches) {
    numMatches.forEach(function (s: string) {
      numbers.push(is64 ? parseMatlabInt(s) : parseMatlabNum(s));
    });
  }
```

and widen the return type to `{ dims: number[]; elements: (number | bigint)[]; type: string }`.

In `BinarySlddParser.ts:311-331` (the typed numeric branch), keep the array elements exact:

```ts
    const is64 = type === 'int64' || type === 'uint64';
    const parts = text.trim().split(/\s+/).map(is64 ? parseMatlabInt : Number);
```

`transposeColumnMajor` and `formatMatrix` then carry `(number | bigint)[]`; widen both signatures. `formatNumLiteral(num: number | bigint, type: string)` needs no body change — `formatMatlabNum` handles both, and the `single`/`uint8` branches never see a bigint.

Follow `npm run typecheck` through the rest, again without casting.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/sldd64.test.ts && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Round-trip the exact value through MATLAB**

This is the assertion that matters: the corrupted number used to be what got *written*.

```bash
npx vitest run test/parity/fidelity
```

Expected: all passing (byte-identical round-trip proves nothing was rewritten). Phase 12's live write-back tier adds the edit-and-reopen case for these entries; add `maxU64` to its catalog when you get there.

- [ ] **Step 6: Full suite and commit**

Run: `npm test`

```bash
git add -A
git commit -m "[wip] keep 64-bit .sldd integers exact from read through serialize"
```

---

## Test harness conventions — read before writing any test in any phase

**This section governs every phase above and below.** The illustrative test code in Phases 3-10 shows the *assertions*; if any snippet still spells a loader as `new DataModel()` / `m.addSlddSource(...)` / `m.getChildren(uri)`, that API **does not exist** — use the shared loader below. Fix the call, keep the assertion.

**1. Loading a file.** There is one dispatcher that handles all four formats, and it is what the parity suite should use:

**Create this module first — before Phase 3 — and import it everywhere.** Several
illustrative snippets in Phases 3-10 open a file with a hand-rolled loader; every
one of them should be this instead. Writing it once is the difference between one
correct loader and eight near-misses.

`test/parity/loadFile.ts`:

```ts
// Copyright 2026 The MathWorks, Inc.
//
// The one way a test opens a real artifact: through `ingest`, the entry point a
// host actually calls, so format sniffing is exercised too. Every parity and
// fixture test imports from here rather than reaching for a parser directly.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../../src/index.js';
import { ingest } from '../../src/core/ingest.js';
import '../../src/datamodel/node/NodeClassMap.js';

/** Read a file relative to THIS module and hand back a detached ArrayBuffer. */
export function bytesOf(rel: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(rel, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/**
 * Ingest an artifact and return its root node. `filename` must carry the real
 * extension — ingest dispatches on it (.sldd / .slx / .mat / .prj).
 */
export function loadFile(rel: string, filename?: string): any {
  const name = filename ?? (rel.split('/').pop() as string);
  return ingest(createSession(), bytesOf(rel), { filename: name }) as any;
}

/** Every node under `root`, breadth-first. */
export function flatten(root: any): any[] {
  const out: any[] = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.shift();
    if (!n) { continue; }
    out.push(n);
    if (n.children) { stack.push(...n.children); }
  }
  return out;
}

/** The node for a named entry; throws with a useful message when absent. */
export function findEntry(root: any, name: string): any {
  const hit = flatten(root).find(
    (n) => n?.name === name && !String(n?.id ?? '').startsWith('section:'),
  );
  if (!hit) {
    throw new Error(
      'no entry "' + name + '"; have: ' +
      flatten(root).map((n) => n?.name).filter(Boolean).join(', '),
    );
  }
  return hit;
}
```

So a snippet in Phases 3-10 that reads

```ts
const m = new DataModel();
m.addSlddSource(URI, readFileSync('test/fixtures/cdata.sldd'));
const node = /* hand-rolled tree walk */;
```

becomes

```ts
import { loadFile, findEntry } from './parity/loadFile.js';   // adjust the depth
const root = loadFile('../fixtures/cdata.sldd');
const node = findEntry(root, 'cplxScalar');
```

`loadTruth.ts` (Task 11.1) imports `flatten` and `findEntry` from here and adds
only the corpus-specific parts (the truth JSON, the artifact name map). There is
exactly one definition of "the node for this name" in the test tree.

`ingest` routes by extension: `.sldd` sniffs JSON-vs-zip and calls `session.addDataSource`, `.slx` calls `addModelSource`, `.mat` calls `addMatSource`, `.prj` unzips and calls `addProjectSource`. A `.mat`-only test may call `session.addMatSource(name, bytes(rel))` directly, as `test/matNode.test.ts:19-22` does.

**2. A text `.sldd` is JSON, not XML.** `ingest` does `JSON.parse` on it. So `_type: 'cdata'` and `Matrix(2,3)\n[...]` are JSON string values — which is why the node layer parses them from strings. `BinarySlddParser` converts the *binary* (zip) form into the same JSON-shaped content. Do not write an XML-shaped fixture.

**3. Fixture locations.** Committed fixtures live in `test/fixtures/` (see `test/fixtures/make-fixtures.mjs`, and `test/fixtures/mcos/` for MCOS-bearing files). The fidelity suite's own artifacts live in `test/parity/artifacts/{text,binary}/`. New MATLAB-authored parity artifacts go in `test/parity/artifacts/` alongside `truth.json`, per DESIGN.md. When a phase above says `test/fixtures/<x>`, that is correct for a one-off unit fixture; the Phase 2 corpus is the shared one.

**4. Prefer synthesized MAT bytes over committed binaries for unit tests.** `test/tools/matBytes.js` exports `matFile`, `numericVar`, `structVar`, `charVar`, `matrix`, `arrayFlags`, `dims`, `varName`, `CLASS`, `MI` — used by `test/matVariableFromMat.test.ts` to build a `.mat` in-process. A unit test that needs one shape should build it there rather than commit a binary. **Commit a MATLAB-authored binary only when MATLAB's own byte layout is the thing under test** — Phase 5 (cdata), Phase 9 (string MCOS), Phase 10 (64-bit), Phase 6's dictionary check, and the Phase 2 corpus. Extend `matBytes.js` if it lacks a helper (it has no `cellVar`, for instance); that is in scope.

**5. Imports.** `MatlabVariableNode` is a **default** export (`import MatlabVariableNode from '.../MatlabVariableNode.js'`), and it re-exports the `MatVariable` type. `StructNode`, `ObjectNode`, `DataModel` (the session singleton, `src/core/DataModel.js`) are default exports too. Check each import against the file before writing it — a named-vs-default mistake fails at typecheck, which is cheap, but it wastes a cycle.

**6. `NodeClassMap` must be imported for its side effect** before `NodeRegistry.parseValue` will dispatch: `import '../src/datamodel/node/NodeClassMap.js';` (see `test/parity/fidelity/roundTripHarness.ts:24`). A test that skips it gets bare nodes and confusing failures.

**7. MATLAB gating.** `DEX_MATLAB_CMD` (launcher + fixed args, e.g. `mw -using Bmain matlab`) and optional `DEX_MATLAB_CWD`. When unset, MATLAB-dependent assertions **skip**, never fail — that is how the suite stays green in CI and for external contributors. Reuse this convention exactly; do not invent a second env var.

---

## Phase 11: `expect.ts` and the tier-1 parity suites

The four suites that turn the Phase 2 corpus into assertions. Everything before this fixed defects one at a time; this is the net that catches the next one.

**The load-bearing rule for `expect.ts`:** it derives the expected display **from what MATLAB reported** — class, size, complexity, `mat2str`, `formattedDisplayText` — and **never from our own parse**. If the expectation is computed from the same data model it is checking, the suite passes no matter how wrong the model is. Every function in `expect.ts` takes truth-JSON fields as arguments and returns a string; none of them may import anything from `src/datamodel/`.

### Task 11.1: `loadTruth.ts`

**Files:**
- Create: `test/parity/matlab/loadTruth.ts`
- Test: exercised by Tasks 11.3-11.6 (no standalone suite — it is a fixture loader)

- [ ] **Step 1: Write it**

```ts
// Copyright 2026 The MathWorks, Inc.
//
// Loads the MATLAB-authored corpus and the artifacts it describes. One place, so
// the four parity suites cannot drift apart in how they find a node.
//
// The truth JSON is written by gen_truth.m (Phase 2) and is the ONLY source of
// expected values. Nothing here reads the data model.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFile, flatten, findEntry } from '../loadFile.js';

export { flatten, findEntry as entry };

const ARTIFACTS = fileURLToPath(new URL('../artifacts/', import.meta.url));

// These names mirror gen_truth.m's truthOf() and propTruth() EXACTLY — MATLAB's
// jsonencode uses the struct's field names verbatim, so a rename on either side
// silently breaks the other.
export interface PropTruth {
  class: string;
  size: number[];
  numel: number;
  isempty: boolean;
  disp: string;
  mat2str?: string;
  mat2str_error?: string;
}

export interface VarTruth {
  name: string;
  class: string;
  size: number[];
  numel: number;
  iscomplex: boolean;
  islogical: boolean;
  isobject: boolean;
  isempty: boolean;
  disp: string;
  /** absent for rank >= 3 — mat2str errors there, and that error is the point */
  mat2str?: string;
  mat2str_error?: string;
  /** present only when 1 < numel <= 64; MATLAB's own column-major order */
  linearSubs?: string[];
  linearValues?: string[];
  properties?: Record<string, PropTruth | { error: string }>;
}

export interface Truth {
  vars: Record<string, VarTruth>;
  /** object arrays. `.mat` ONLY — both .sldd formats and the .slx model workspace refuse them. */
  objArr: Record<string, VarTruth>;
  notes: {
    /** per format ('text' | 'binary') -> per entry -> 'ACCEPTED' or MATLAB's message */
    slddRejected: Record<string, Record<string, string>>;
    /** ONE level: per entry -> 'ACCEPTED' or MATLAB's message. Not per format — there is one .slx. */
    slxRejected: Record<string, string>;
  };
}

export function truth(): Truth {
  return JSON.parse(readFileSync(ARTIFACTS + 'truth.json', 'utf8')) as Truth;
}

export type Artifact = 'sldd-text' | 'sldd-binary' | 'slx' | 'mat';

const FILES: Record<Artifact, string> = {
  'sldd-text': 'text/cases.sldd',
  'sldd-binary': 'binary/cases.sldd',
  slx: 'slx/cases.slx',
  mat: 'mat/cases.mat',
};

/** True when the generator produced this artifact — a suite skips rather than fails. */
export function hasArtifact(a: Artifact): boolean {
  return existsSync(ARTIFACTS + FILES[a]);
}

/**
 * Load a corpus artifact and return its root node. `loadFile` resolves relative
 * to test/parity/, hence the './artifacts/…' prefix; it goes through `ingest`, so
 * format sniffing is under test too. Basename-only filenames matter: `ingest`
 * dispatches on the extension.
 */
export function loadArtifact(a: Artifact): any {
  return loadFile('./artifacts/' + FILES[a]);
}

/** Element rows of a container, keyed by their subscript label. */
export function elementsByLabel(node: any): Map<string, any> {
  return new Map((node.children || []).map((c: any) => [c.displayName, c]));
}
```

- [ ] **Step 2: Verify it loads**

Run: `npx vitest run test/parity/matlab/` (no suites yet — expect "no test files found", which confirms the module at least typechecks once Task 11.3 imports it). Then `npm run typecheck`.

- [ ] **Step 3: Commit**

```bash
git add test/parity/matlab/loadTruth.ts
git commit -m "[wip] add the parity corpus loader"
```

### Task 11.2: `expect.ts`

**Files:**
- Create: `test/parity/matlab/expect.ts`
- Test: `test/parity/matlab/expect.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// Copyright 2026 The MathWorks, Inc.
//
// expect.ts is the convention expressed as a pure function of what MATLAB
// reported. It is tested on its own because a bug HERE would make the parity
// suites agree with a wrong data model — the one failure mode a parity suite
// cannot detect from the inside.
import { describe, it, expect } from 'vitest';
import { expectedDisplay } from './expect.js';

// Field names are MATLAB's, because gen_truth.m's jsonencode emits them verbatim:
// iscomplex, isempty, islogical, isobject, mat2str_error.
const t = (over: any) => ({
  name: 'v', class: 'double', size: [1, 1], iscomplex: false, isempty: false,
  islogical: false, isobject: false, numel: 1, disp: '', ...over,
});

describe('expectedDisplay', () => {
  it('is the mat2str literal for a small real matrix', () => {
    expect(expectedDisplay(t({ size: [2, 3], numel: 6, mat2str: '[1 2 3;4 5 6]' })))
      .toBe('[1 2 3; 4 5 6]');
  });

  it('is a scalar literal for a scalar', () => {
    expect(expectedDisplay(t({ mat2str: '5' }))).toBe('5');
  });

  it('is the summary form when mat2str itself refused', () => {
    expect(expectedDisplay(t({
      class: 'double', size: [2, 3, 2], numel: 12,
      mat2str_error: 'Input matrix must be 2-D',
    }))).toBe('<2x3x2 double>');
  });

  it('is the summary form past the element budget', () => {
    expect(expectedDisplay(t({
      size: [1, 11], numel: 11, mat2str: '[1 2 3 4 5 6 7 8 9 10 11]',
    }))).toBe('<1x11 double>');
  });

  it('renders exactly 10 elements inline', () => {
    expect(expectedDisplay(t({
      size: [1, 10], numel: 10, mat2str: '[1 2 3 4 5 6 7 8 9 10]',
    }))).toBe('[1 2 3 4 5 6 7 8 9 10]');
  });

  it('is [ ] for an empty numeric and { } for an empty cell', () => {
    expect(expectedDisplay(t({ size: [0, 0], numel: 0, isempty: true }))).toBe('[ ]');
    expect(expectedDisplay(t({ class: 'cell', size: [0, 0], numel: 0, isempty: true }))).toBe('{ }');
  });

  it('always summarizes a struct', () => {
    expect(expectedDisplay(t({ class: 'struct' }))).toBe('<1x1 struct>');
    expect(expectedDisplay(t({ class: 'struct', size: [2, 3], numel: 6 }))).toBe('<2x3 struct>');
  });

  it('summarizes past the char budget even under the element budget', () => {
    const long = "'" + 'x'.repeat(1200) + "'";
    expect(expectedDisplay(t({
      class: 'cell', size: [1, 2], numel: 2, mat2str: '{' + long + ',' + long + '}',
    }))).toBe('<1x2 cell>');
  });

  it('quotes a char scalar as a MATLAB literal', () => {
    expect(expectedDisplay(t({ class: 'char', size: [1, 5], numel: 5, mat2str: "'hello'" })))
      .toBe("'hello'");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/parity/matlab/expect.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `expect.ts`**

```ts
// Copyright 2026 The MathWorks, Inc.
//
// The display convention, computed from what MATLAB REPORTED and nothing else.
//
// This module must not import anything from src/datamodel/. If it derived its
// expectation from our own parse, the parity suites would agree with the data
// model no matter how wrong the model was — the one failure mode a parity suite
// cannot see from the inside. The constants are restated here on purpose: this is
// the independent statement of the rule, and if the two ever disagree, THAT is
// the finding.
import type { VarTruth } from './loadTruth.js';

export const MAX_CHARS = 1000;
export const MAX_ELEMENTS = 10;

/** MATLAB's size(), with a trailing singleton dropped as MATLAB drops it. */
export function effective(size: number[]): number[] {
  const d = size.slice();
  while (d.length > 2 && d[d.length - 1] === 1) { d.pop(); }
  if (d.length === 0) { return [1, 1]; }
  if (d.length === 1) { return [1, d[0]]; }
  return d;
}

export function summary(size: number[], className: string): string {
  return '<' + effective(size).join('x') + ' ' + className + '>';
}

/**
 * mat2str spells a matrix `[1 2 3;4 5 6]`; the data model puts a space after the
 * semicolon. That is the ONLY normalization applied, and it is applied to
 * MATLAB's string, never to ours.
 */
export function normalizeMat2str(s: string): string {
  return s.replace(/;/g, '; ');
}

export function expectedDisplay(v: VarTruth): string {
  const dims = effective(v.size);
  if (v.class === 'struct') {
    return summary(dims, 'struct');
  }
  if (v.isempty || v.numel === 0) {
    return v.class === 'cell' ? '{ }' : '[ ]';
  }
  // mat2str refuses rank >= 3 ("Input matrix must be 2-D"), so there is no MATLAB
  // one-line spelling to match and the summary is the only correct answer.
  if (v.mat2str_error || dims.length > 2) {
    return summary(dims, v.class);
  }
  if (v.numel > MAX_ELEMENTS) {
    return summary(dims, v.class);
  }
  if (v.mat2str === undefined) {
    return summary(dims, v.class);
  }
  const literal = normalizeMat2str(v.mat2str);
  return literal.length > MAX_CHARS ? summary(dims, v.class) : literal;
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/parity/matlab/expect.test.ts`
Expected: PASS, 9 tests.

If a case fails because MATLAB's `mat2str` spelling differs from ours in a way beyond the semicolon (a cell's `{'a','b'}` vs our `{'a', 'b'}`, or a logical's `true`/`false`), extend `normalizeMat2str` with that one rule **and a comment naming the exact MATLAB spelling it is reconciling.** Do not reach for a general-purpose whitespace strip: that would let a real spacing defect through.

- [ ] **Step 5: Commit**

```bash
git add test/parity/matlab/expect.ts test/parity/matlab/expect.test.ts
git commit -m "[wip] state the display convention independently of the data model"
```

### Task 11.3: `display.test.ts` — every value, every format

**Files:**
- Create: `test/parity/matlab/display.test.ts`

- [ ] **Step 1: Write it**

```ts
// Copyright 2026 The MathWorks, Inc.
//
// Every value in the MATLAB-authored corpus, in every format that can hold it,
// displayed as the convention says MATLAB displays it. This is the suite that
// makes the next display defect fail a test instead of reaching a user.
import { describe, it, expect } from 'vitest';
import { truth, loadArtifact, hasArtifact, entry, type Artifact } from './loadTruth.js';
import { expectedDisplay } from './expect.js';

const T = truth();
const FORMATS: Artifact[] = ['sldd-text', 'sldd-binary', 'slx', 'mat'];

for (const fmt of FORMATS) {
  describe('display parity — ' + fmt, () => {
    if (!hasArtifact(fmt)) {
      it.skip('artifact not generated — run gen_truth.m', () => {});
      return;
    }
    const root = loadArtifact(fmt);
    const isSldd = fmt === 'sldd-text' || fmt === 'sldd-binary';
    // notes.slddRejected is keyed by format subdirectory, then by entry name;
    // the value is MATLAB's own message, or the literal 'ACCEPTED'.
    const rejected = (isSldd
      ? T.notes.slddRejected?.[fmt === 'sldd-text' ? 'text' : 'binary']
      : undefined) || {};

    for (const [name, v] of Object.entries(T.vars)) {
      // The dictionary refuses some values outright (object arrays, and whatever
      // else gen_truth.m recorded). A value the format cannot hold is not a
      // parity failure — but the SKIP has to be justified by MATLAB's own
      // rejection message, not by our convenience.
      if (isSldd && rejected[name] && rejected[name] !== 'ACCEPTED') {
        it.skip(name + ' — MATLAB rejected: ' + rejected[name], () => {});
        continue;
      }
      it(name + ' displays as MATLAB does', () => {
        const node = entry(root, name);
        expect(node.displayValue).toBe(expectedDisplay(v));
      });
      it(name + ' reports the class MATLAB reports', () => {
        const node = entry(root, name);
        // dataType is the type column; a bare MATLAB value's is its class.
        expect(node.dataType || node.className).toBe(v.class);
      });
    }
  });
}
```

- [ ] **Step 2: Run it**

Run: `npx vitest run test/parity/matlab/display.test.ts`
Expected: **some failures.** That is the point — each one is either a real remaining defect or a truth/convention disagreement.

- [ ] **Step 3: Triage every failure, in writing**

For each failure, decide and record which it is:
1. **A defect Phases 3-10 did not cover** — fix it, with its own test in the phase where it belongs, and add a line to DESIGN.md's defect list.
2. **`expect.ts` mis-stating the convention** — fix `expect.ts` and its unit test.
3. **A genuine format limitation** — add it to the skip list *keyed by MATLAB's own message*, and record it under DESIGN.md's Known limitations.

Never make a failure go away by loosening the assertion (`toContain`, a regex, a `try/catch`). If you cannot classify a failure, leave it failing and say so in the commit body — a known-red assertion with a written reason is worth more than a green one that checks nothing.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "[wip] add the display parity suite across all four formats"
```

### Task 11.4: `structure.test.ts` — the parent/child tree

**Files:**
- Create: `test/parity/matlab/structure.test.ts`

- [ ] **Step 1: Write it**

```ts
// Copyright 2026 The MathWorks, Inc.
//
// The tree shape: does every container expand into exactly the elements MATLAB
// says it has, labelled with MATLAB's own subscripts, each holding MATLAB's value
// for THAT subscript? The label->value mapping is the assertion that catches a
// transpose, which a count-only check cannot see.
import { describe, it, expect } from 'vitest';
import { truth, loadArtifact, hasArtifact, entry, elementsByLabel, type Artifact } from './loadTruth.js';

const T = truth();
const FORMATS: Artifact[] = ['sldd-text', 'sldd-binary', 'slx', 'mat'];

for (const fmt of FORMATS) {
  describe('structure parity — ' + fmt, () => {
    if (!hasArtifact(fmt)) {
      it.skip('artifact not generated — run gen_truth.m', () => {});
      return;
    }
    const root = loadArtifact(fmt);
    const isSldd = fmt === 'sldd-text' || fmt === 'sldd-binary';
    // Two refusal maps, two shapes. notes.slddRejected is keyed by format
    // subdirectory THEN entry name; notes.slxRejected is one level, entry name
    // only. This suite is the only one that must consult slxRejected, because it
    // is the only one that iterates T.objArr — and in R2027a the .slx model
    // workspace refuses an object array just as the dictionary does, so
    // entry(root, 'objRow') would throw from findEntry on fmt === 'slx'.
    const rejected = (isSldd
      ? T.notes.slddRejected?.[fmt === 'sldd-text' ? 'text' : 'binary']
      : fmt === 'slx'
        ? T.notes.slxRejected
        : undefined) || {};

    // gen_truth.m records `linearValues` as one display string per MATLAB linear
    // index and `linearSubs` as the matching subscript label — so the pair is a
    // map from MATLAB's own label to MATLAB's own value. Both are present only
    // when 1 < numel <= 64.
    for (const [name, v] of Object.entries({ ...T.vars, ...T.objArr })) {
      if (!v.linearValues || v.linearValues.length <= 1) { continue; }
      if (rejected[name] && rejected[name] !== 'ACCEPTED') {
        it.skip(name + ' — MATLAB rejected: ' + rejected[name], () => {});
        continue;
      }
      it(name + ' expands into MATLAB-labelled elements holding MATLAB values', () => {
        const node = entry(root, name);
        expect(node.children.length).toBe(v.numel);
        const byLabel = elementsByLabel(node);
        // Every label MATLAB assigns must exist exactly once, and hold the value
        // MATLAB puts at that subscript. Cross-check our independently computed
        // label against MATLAB's own, so a bug in subLabelFor cannot hide one in
        // the data model.
        for (let k = 0; k < v.linearValues!.length; k++) {
          const label = subLabelFor(name, k, v.size, v.class === 'cell');
          expect(label, 'subLabelFor disagrees with MATLAB').toBe(v.linearSubs![k]);
          const child = byLabel.get(label);
          expect(child, label).toBeTruthy();
          expect(child.displayValue, label).toBe(v.linearValues![k]);
        }
      });
    }
  });
}

/**
 * MATLAB's subscript label for linear index k — ind2sub, spelled out. Written
 * here rather than imported from src/ for the same reason expect.ts is: an
 * independent statement of the rule.
 */
function subLabelFor(name: string, k: number, size: number[], isCell: boolean): string {
  const d = size.slice();
  while (d.length > 2 && d[d.length - 1] === 1) { d.pop(); }
  const [open, close] = isCell ? ['{', '}'] : ['(', ')'];
  // One spread dimension or fewer: MATLAB indexes it linearly, v(4), not v(1,4).
  if (d.filter((n) => n > 1).length <= 1) {
    return name + open + (k + 1) + close;
  }
  const subs: number[] = [];
  let rest = k;
  for (let i = 0; i < d.length; i++) {
    subs.push((rest % d[i]) + 1);
    rest = Math.floor(rest / d[i]);
  }
  return name + open + subs.join(',') + close;
}
```

- [ ] **Step 2: Run it and triage**

Run: `npx vitest run test/parity/matlab/structure.test.ts`
Expected: failures triaged exactly as in Task 11.3 — fix, correct the expectation, or justify a skip by MATLAB's message. This suite is the one that would have caught defect 4 (the object-array transpose) on day one.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "[wip] add the structure parity suite: MATLAB label -> MATLAB value"
```

### Task 11.5: `schemaProps.test.ts` — object properties

**Files:**
- Create: `test/parity/matlab/schemaProps.test.ts`

- [ ] **Step 1: Write it**

```ts
// Copyright 2026 The MathWorks, Inc.
//
// For each known Simulink class in the corpus, every property MATLAB reports must
// surface with MATLAB's value. gen_truth.m sets non-default values precisely so a
// property that silently falls back to its default fails here.
import { describe, it, expect } from 'vitest';
import { truth, loadArtifact, hasArtifact, entry, type Artifact, type VarTruth }
  from './loadTruth.js';
import { expectedDisplay } from './expect.js';

const T = truth();
const FORMATS: Artifact[] = ['sldd-text', 'sldd-binary', 'slx', 'mat'];

for (const fmt of FORMATS) {
  describe('property parity — ' + fmt, () => {
    if (!hasArtifact(fmt)) {
      it.skip('artifact not generated — run gen_truth.m', () => {});
      return;
    }
    const root = loadArtifact(fmt);
    const isSldd = fmt === 'sldd-text' || fmt === 'sldd-binary';
    const rejected = (isSldd
      ? T.notes.slddRejected?.[fmt === 'sldd-text' ? 'text' : 'binary']
      : undefined) || {};

    for (const [name, v] of Object.entries(T.vars)) {
      if (!v.properties) { continue; }
      if (isSldd && rejected[name] && rejected[name] !== 'ACCEPTED') {
        it.skip(name + ' — MATLAB rejected: ' + rejected[name], () => {});
        continue;
      }
      it(name + ' surfaces every property MATLAB reports', () => {
        const node = entry(root, name);
        const kids = new Map((node.children || []).map((c: any) => [c.name, c]));
        for (const [prop, pv] of Object.entries(v.properties!)) {
          // propTruth records {error} instead of {class,size,disp} for a property
          // MATLAB itself could not read. Nothing to assert against.
          if ('error' in pv) { continue; }
          const child = kids.get(prop);
          expect(child, name + '.' + prop).toBeTruthy();
          expect(child.displayValue, name + '.' + prop).toBe(
            expectedDisplay({
              name: prop, iscomplex: false, islogical: false, isobject: false, ...pv,
            } as VarTruth),
          );
        }
      });
      it(name + ' reports its MATLAB class', () => {
        expect(entry(root, name).className).toBe(v.class);
      });
    }
  });
}
```

A property whose value is a nested object (a `Simulink.Parameter`'s `CoderInfo`, a `Simulink.Bus`'s `Elements`) has no `mat2str`; `gen_truth.m`'s `propTruth` records its class and size, so `expectedDisplay` returns the summary form — which is what the tree shows for a nested object. If a class in the corpus needs a different rule, add it to `expect.ts` with a comment naming the class, not a blanket exception.

- [ ] **Step 2: Run it and triage**

Run: `npx vitest run test/parity/matlab/schemaProps.test.ts`
Expected: failures triaged as above. A property that appears in MATLAB and not in the tree is a real gap and gets a defect entry in DESIGN.md.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "[wip] add the object-property parity suite"
```

### Task 11.6: `lossless.test.ts` — read, write, read

**Files:**
- Create: `test/parity/matlab/lossless.test.ts`

- [ ] **Step 1: Write it**

```ts
// Copyright 2026 The MathWorks, Inc.
//
// An unedited file must serialize back to something that re-parses to the same
// tree. This catches the class of defect where the DISPLAY is right but the write
// path drops or rounds a value — which is how a 64-bit integer and a struct
// array's later elements were both being lost.
import { describe, it, expect } from 'vitest';
import { loadArtifact, hasArtifact, type Artifact } from './loadTruth.js';
import { serializeModel, reparseModel } from '../fidelity/roundTripHarness.js';

// Compare the whole display tree, not one value.
function displayTree(root: any): string[] {
  const out: string[] = [];
  const walk = (n: any, depth: number) => {
    out.push('  '.repeat(depth) + n.displayName + ' = ' + n.displayValue + ' [' + (n.dataType || n.className || '') + ']');
    for (const c of n.children || []) { walk(c, depth + 1); }
  };
  for (const c of root.children || []) { walk(c, 0); }
  return out;
}

for (const fmt of ['sldd-text', 'sldd-binary'] as Artifact[]) {
  describe('lossless round-trip — ' + fmt, () => {
    if (!hasArtifact(fmt)) {
      it.skip('artifact not generated — run gen_truth.m', () => {});
      return;
    }
    const format = fmt === 'sldd-text' ? 'json' as const : 'binary' as const;
    it('re-parses to the same tree after an untouched serialize', () => {
      const before = loadArtifact(fmt);
      const tree = displayTree(before);
      const bytes = serializeModel(before, format);
      const after = reparseModel(bytes, format, 'cases.sldd', 'test://lossless-' + fmt);
      expect(displayTree(after)).toEqual(tree);
    });
  });
}
```

- [ ] **Step 2: Add the one export this needs**

`roundTripHarness.ts` already has the re-parse logic, but `reparseEntry` returns a single entry and this test needs the root. Refactor rather than copy — in `test/parity/fidelity/roundTripHarness.ts`:

```ts
/** Re-parse serialized bytes and return the ROOT node (see reparseEntry for one entry). */
export function reparseModel(
  bytes: Uint8Array,
  format: SlddFormat,
  fixture: string,
  uri: string,
): any {
  DataModel.removeDataSource(uri);
  return addSlddSource(uri, fixture, bytes);
}
```

and rewrite `reparseEntry` to go through it, so there is exactly one re-parse path:

```ts
export function reparseEntry(bytes: Uint8Array, format: SlddFormat, fixture: string, name: string): any {
  const uri = `test://rt-${Math.abs(hash(name + format))}.sldd`;
  return entryByName(reparseModel(bytes, format, fixture, uri), uri, name);
}
```

Two harnesses that disagree is worse than one. Note also that `serializeModel` takes the **root node** (it calls `model.serialize()` / `serializeBinarySldd(model)`), and `loadArtifact` returns the root node from `ingest` — so they compose. If `serializeBinarySldd` rejects the ingest-produced root, that mismatch is itself a finding: record it and use `loadModel(format, 'cases.sldd', uri)` from the harness instead, which produces the node shape the serializer was built against.

- [ ] **Step 3: Run it and triage**

Run: `npx vitest run test/parity/matlab/lossless.test.ts test/parity/fidelity/`
Expected: PASS if Phases 4, 6 and 10 landed correctly; a failure names the exact node whose value the write path changes. The fidelity suites are included because Step 2 changed a function they all use.

- [ ] **Step 4: Full suite**

Run: `npm run typecheck && npm test`
Expected: all passing, or a written account in the commit body of what is red and why.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "[wip] add the lossless round-trip parity suite"
```

---

## Phase 12: live write-back tier and the drift script

Everything so far proves we *read* what MATLAB wrote. This phase proves MATLAB can read what *we* write — the half that matters most, because a wrong value written to a file is not recoverable by re-reading it.

**Most of this already exists.** `test/parity/fidelity/roundTripHarness.ts` exports `serializeModel`, `reparseEntry`, `matlabAvailable` and `matlabAssertRoundTrip`, and `verify_roundtrip.m` already opens a serialized dictionary in MATLAB and asserts a property equals what we set — including the `_0xHH_` key encoding that gets dotted paths past `jsondecode`. Do not build a second harness. Extend that one to assert an **entry's own value and class** (not only a property path), and drive it from the corpus.

### Task 12.1: Assert an entry's value, not only a property

**Files:**
- Modify: `test/parity/fidelity/verify_roundtrip.m`
- Test: exercised by Task 12.2

- [ ] **Step 1: Read what is there**

Run: `cat test/parity/fidelity/verify_roundtrip.m`

Note how it resolves the entry, how it decodes the `_0xHH_` keys, how it compares a value, and exactly what it prints on pass (`RESULT PASS`) and fail. The new code must print the same sentinels — `matlabAssertRoundTrip` greps for `RESULT PASS`.

- [ ] **Step 2: Add the two reserved keys**

Extend the spec vocabulary with:
- `__value__` — the entry's own value. Compare with `isequal` **and** compare `class()`; a `5` that came back as a `double` when we wrote an `int32` is a failure, and `isequal(int32(5), 5)` is true, so class must be checked separately.
- `__size__` — the entry's `size()`, compared with `isequal`.

`__class__` is already handled (the harness comment documents it); confirm that and reuse it rather than adding a third spelling.

For each, print one `ASSERT <key>: PASS|FAIL expected=<...> actual=<...>` line in the file's existing format, and keep the existing final `RESULT PASS` / `RESULT FAIL` behaviour. Use `mat2str` for the printed forms so a non-finite or a 64-bit value is legible in the failure output — and guard it in `try/catch` because `mat2str` errors on rank >= 3 (print `size` and `class` in that case).

- [ ] **Step 3: Verify the script alone**

```bash
mw -using Bmain matlab -nodesktop -batch "cd('$PWD/test/parity/fidelity'); verify_roundtrip('$PWD/test/parity/artifacts/text/params.sldd','MyAlias','{\"__class__\":\"Simulink.AliasType\"}')"
```

Expected: `RESULT PASS`. `MyAlias` is the first entry in that committed fixture and it is a `Simulink.AliasType` with `BaseType` `int32`; the other entry names are `MyBkpt, MyBus, MyConnBus, MyEnum, MyLUT, MyNumType, MyValueType, MyVarCtrl, MyVarExpr, MyVarVar, boolFlag, ...` (40 in all — list them with the command below if you need a different shape).

```bash
node -e "const j=JSON.parse(require('fs').readFileSync('test/parity/artifacts/text/params.sldd','utf8')); console.log(j['__MW_TEXT_PARTS__']['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.map(e=>e.name+' '+e.value._array_class).join('\n'))"
```

This step proves the script still runs before any JS depends on it.

- [ ] **Step 4: Commit**

```bash
git add test/parity/fidelity/verify_roundtrip.m
git commit -m "[wip] let the MATLAB gate assert an entry's own value, class and size"
```

### Task 12.2: `writeback.live.test.ts`

**Files:**
- Create: `test/parity/matlab/writeback.live.test.ts`

- [ ] **Step 1: Write it**

```ts
// Copyright 2026 The MathWorks, Inc.
//
// Edit -> serialize -> MATLAB reopens it -> MATLAB agrees. This is the only tier
// that can prove a write is correct, because a value we write wrongly and then
// read back with the same wrong assumption looks fine from inside.
//
// Skipped wholesale when DEX_MATLAB_CMD is unset, so CI and external contributors
// stay green. Set it to the launcher plus its fixed args, e.g.
//   DEX_MATLAB_CMD="mw -using Bmain matlab"
import { describe, it, expect } from 'vitest';
import { loadModel, entryByName, serializeModel, reparseEntry, matlabAvailable, matlabAssertRoundTrip }
  from '../fidelity/roundTripHarness.js';

// One case per thing a write can get wrong, not one per data type: the value
// classes here are the ones whose write path this project changed.
const CASES = [
  { entry: 'kp', set: '42', expect: { __value__: 42, __class__: 'double' } },
  { entry: 'maxU64', set: '18446744073709551615', expect: { __value__: '18446744073709551615', __class__: 'uint64' } },
  { entry: 'rowVec', set: '[7 8 9]', expect: { __value__: [7, 8, 9], __size__: [1, 3], __class__: 'double' } },
  { entry: 'mat2x3', set: '[9 8 7; 6 5 4]', expect: { __size__: [2, 3], __class__: 'double' } },
];

for (const format of ['json', 'binary'] as const) {
  describe('live write-back — ' + format, () => {
    if (!matlabAvailable()) {
      it.skip('DEX_MATLAB_CMD unset — live gate skipped', () => {});
      return;
    }
    for (const c of CASES) {
      it('MATLAB reads back our edit to ' + c.entry, () => {
        const uri = 'test://wb-' + format + '-' + c.entry + '.sldd';
        // loadModel resolves ../artifacts/{text|binary}/<fixture>, which is where
        // Phase 2 wrote the corpus — hence the same 'cases.sldd' for both formats.
        const model = loadModel(format, 'cases.sldd', uri);
        const node = entryByName(model, uri, c.entry);
        node.setProperty('Value', c.set);
        const bytes = serializeModel(model, format);
        // In-process first: a failure here is ours, not MATLAB's, and says so.
        const reparsed = reparseEntry(bytes, format, 'cases.sldd', c.entry);
        expect(reparsed.displayValue).toBeTruthy();
        // Then the gate that actually matters.
        const out = matlabAssertRoundTrip(bytes, c.entry, c.expect);
        expect(out).toMatch(/RESULT PASS/);
      });
    }
  });
}
```

Two things to sort out while writing this:
- **The four `CASES` entry names must exist in the corpus.** `kp`, `maxU64`, `rowVec` and `mat2x3` are the names Phase 2's catalog uses for a scalar double, `intmax('uint64')`, a 1x3 and a 2x3. Check them against `gen_truth.m` (`grep -n "C(end+1" test/parity/matlab/gen_truth.m`) and against `truth.notes.slddRejected.text` — if the dictionary refused one, drop that case and say so in the commit rather than inventing an entry.
- **`setProperty('Value', …)` is the mutation entry point** used by the fidelity suites; confirm the exact call for a plain MATLAB variable entry (`grep -n "setProperty('Value'" test/parity/fidelity/*.test.ts | head`) and copy it, including any `session.editProperty` wrapping those tests use so undo state stays consistent.
- **`__value__` for a 64-bit integer is passed as a STRING** in the case above, because JSON cannot carry `18446744073709551615` exactly either — the same limit that caused defect 1. `verify_roundtrip.m` must compare a string-valued `__value__` against `sprintf('%s', string(actual))`. Add that branch in Task 12.1 and note it in the script's comment.

- [ ] **Step 2: Run it without MATLAB**

Run: `npx vitest run test/parity/matlab/writeback.live.test.ts`
Expected: all skipped, suite green. This is the CI behaviour and it must hold.

- [ ] **Step 3: Run it with MATLAB**

```bash
env DEX_MATLAB_CMD="mw -using Bmain matlab" npx vitest run test/parity/matlab/writeback.live.test.ts
```

(In tcsh: `env VAR=value cmd`, not `VAR=value cmd`.)

Expected: PASS. A `RESULT FAIL` here is the highest-value failure this project can produce — it means we write something MATLAB reads differently. Triage it as a defect, not as a test problem.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "[wip] add the live MATLAB write-back tier for edited entry values"
```

### Task 12.3: `drift.mjs` — one command to regenerate and compare

**Files:**
- Create: `test/parity/matlab/drift.mjs`
- Modify: `package.json` (a script entry)

- [ ] **Step 1: Write it**

```js
// Copyright 2026 The MathWorks, Inc.
//
// Regenerate the MATLAB corpus and report what changed. The corpus is checked in
// so the suite runs without MATLAB, which means it can silently go stale against
// a newer MATLAB. This is the command that catches that: run it when the MATLAB
// version changes, or before trusting a green parity run.
//
//   npm run parity:drift
//
// Exits 0 when the regenerated truth matches what is committed, 1 when it does
// not, printing a per-variable diff. A non-zero exit is NOT necessarily a bug in
// our code — it may be a MATLAB behaviour change, which is exactly the thing
// worth knowing about.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const COMMITTED = join(HERE, '..', 'artifacts', 'truth.json');
const LAUNCH = process.env.DEX_MATLAB_CMD || '';

if (!LAUNCH) {
  console.error('DEX_MATLAB_CMD is unset. Set it to the launcher plus its fixed args, e.g.');
  console.error('  env DEX_MATLAB_CMD="mw -using Bmain matlab" npm run parity:drift');
  process.exit(2);
}
if (!existsSync(COMMITTED)) {
  console.error('no committed truth at ' + COMMITTED + ' — run gen_truth.m first (Phase 2)');
  process.exit(2);
}

const out = mkdtempSync(join(tmpdir(), 'dexdrift-'));
const [bin, ...args] = LAUNCH.split(' ');
const script = join(HERE, 'gen_truth.m');
console.log('regenerating into ' + out);
execFileSync(bin, [...args, '-nodesktop', '-batch',
  `outdir='${out}'; run('${script}')`], { stdio: 'inherit', maxBuffer: 64 * 1024 * 1024 });

const fresh = JSON.parse(readFileSync(join(out, 'truth.json'), 'utf8'));
const old = JSON.parse(readFileSync(COMMITTED, 'utf8'));

let drift = 0;
for (const section of ['vars', 'objArr']) {
  const a = old[section] || {};
  const b = fresh[section] || {};
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const sa = JSON.stringify(a[name] ?? null);
    const sb = JSON.stringify(b[name] ?? null);
    if (sa !== sb) {
      drift++;
      console.log('\nDRIFT ' + section + '.' + name);
      console.log('  committed: ' + sa);
      console.log('  regenerated: ' + sb);
    }
  }
}
// Both refusal maps. A change here is the MOST interesting kind of drift: it
// means MATLAB lifted (or added) a storage restriction, which retires a skip.
for (const key of ['slddRejected', 'slxRejected']) {
  const ra = JSON.stringify(old.notes?.[key] ?? {});
  const rb = JSON.stringify(fresh.notes?.[key] ?? {});
  if (ra !== rb) {
    drift++;
    console.log('\nDRIFT notes.' + key);
    console.log('  committed: ' + ra);
    console.log('  regenerated: ' + rb);
  }
}

if (drift === 0) {
  console.log('\nno drift: the committed corpus matches this MATLAB.');
  process.exit(0);
}
console.log('\n' + drift + ' variable(s) drifted. Review each, then re-copy the artifacts if the new');
console.log('behaviour is correct — and update DESIGN.md if the CONVENTION changed.');
process.exit(1);
```

`gen_truth.m` honours an `outdir` set by the caller before `run(...)` — Phase 2 wrote it that way and proved it by regenerating into `/tmp/gtprobe` without disturbing the repo copy.

**Compare `truth.json`, never container bytes.** Only `truth.json` and `meta.json` are byte-reproducible; `cases.mat`, `cases.slx` and both `cases.sldd` differ on every run because MATLAB stamps each entry with a fresh UUID and `lastmod` (e.g. `"lastmod": "20260903T121143.963203"`). A byte comparison of the containers would report drift every single time and train the reader to ignore it.

- [ ] **Step 2: Add the script entry**

In `package.json`, beside the existing scripts:

```json
    "parity:drift": "node test/parity/matlab/drift.mjs",
```

Match the surrounding quoting and comma placement exactly; a trailing-comma mistake here breaks every npm command in the repo.

- [ ] **Step 3: Run it**

```bash
env DEX_MATLAB_CMD="mw -using Bmain matlab" npm run parity:drift
```

Expected: `no drift`. If it reports drift on the very first run, the generator is not deterministic — find the non-deterministic field (a timestamp, a temp path, a handle) and stop recording it, rather than accepting the noise.

- [ ] **Step 4: Commit**

```bash
git add test/parity/matlab/drift.mjs package.json
git commit -m "[wip] add parity:drift to regenerate the corpus and diff it"
```

### Task 12.4: README and final verification

**Files:**
- Modify: `test/parity/matlab/README.md` (created in Phase 2)
- Modify: `test/parity/matlab/DESIGN.md`

- [ ] **Step 1: Finish the README**

It must answer, for someone who has never seen this directory:
- what the corpus is and which MATLAB wrote it (record the version `gen_truth.m` reports);
- how to regenerate it (`gen_truth.m`, and `npm run parity:drift` to check);
- how to run each tier, and which need `DEX_MATLAB_CMD`;
- what to do when a parity test fails — the three-way triage from Task 11.3, written out;
- the one rule: **`expect.ts` never imports from `src/`.**

- [ ] **Step 2: Update DESIGN.md**

Two edits the implementation earned:
1. The threshold section records the char budget as a runaway guard on expandable values, not only the element rule (decision 2 in this plan's decisions table).
2. Each defect 1-13 gets its resolution: fixed in phase N, or moved to Known limitations with the reason (defect 2's text decoding, if Task 9.3 stopped at the probe).

- [ ] **Step 3: Final verification**

```bash
npm run verify
env DEX_MATLAB_CMD="mw -using Bmain matlab" npm test
env DEX_MATLAB_CMD="mw -using Bmain matlab" npm run parity:drift
```

Expected: clean, all passing, no drift. **There is no `npm run lint` in this repo** — `npm run verify` is the full gate (`typecheck && build && smoke && test && check:pack && check:leak`), and it is what to run here, because `check:pack` and `check:leak` are the two that would catch a new test-only module accidentally shipped in the package. The second command runs the live tiers that `verify` skips — both must pass, and a suite that passes only *because* it skipped is not passing.

- [ ] **Step 4: Squash the `[wip]` commits and open the branch for review**

```bash
git log --oneline main..HEAD
```

Review the list, then rebase into one commit per phase (or one per defect group) with a message that names the defect and the MATLAB behaviour it now matches. **Do not push and do not open a PR** — that needs explicit authorization.

---

## Done when

- [ ] All 13 defects in DESIGN.md are either fixed with a test that fails without the fix, or recorded under Known limitations with a written reason.
- [ ] `npm run verify` clean, with MATLAB configured and without.
- [ ] `npm run parity:drift` reports no drift.
- [ ] The four tier-1 suites assert against MATLAB-authored truth, and `expect.ts` imports nothing from `src/`.
- [ ] The live write-back tier passes for both `.sldd` formats.
- [ ] No assertion was loosened to make a failure disappear.

