<!-- Copyright 2026 The MathWorks, Inc. -->

# Code Generation schema columns — fidelity

**Source:** `src/datamodel/schema/props/codeGen.json`
**Bridge:** `src/datamodel/node/schemaBridge.ts`
**Applies to:** `Simulink.Parameter`, `Simulink.Signal` (via class refs)
**Verified against:** MATLAB R2027a (probe_enum via CoderInfo.StorageClass path)

## Overview

The Code Generation group contributes three schema-projected columns to the
Property Inspector and data table: **Storage Class** (editable dropdown),
**Header File** (read-only label), and **Alignment** (editable text, except
under StorageClass `Auto`). These are properties of the `Simulink.CoderInfo`
sub-object nested at `_properties.CoderInfo._properties.*` in the serialized
entry.

**Storage Class** and **Alignment** are editable in the table. The Property
Inspector shows all three read-only: it has no edit channel for schema rows.
Edits flow through `trySetSchemaProperty` in `schemaBridge.ts`. Storage Class is
validated against the schema's `options` list and written to
`CoderInfo._properties.StorageClass` via `writeSourcePath`. Alignment has its
own rule and write form (below).

## Property table

| Column key | Label | sourcePath | type | editor | Editable | Group |
|------------|-------|------------|------|--------|----------|-------|
| storageClass | Storage Class | CoderInfo.StorageClass | string | select | **yes** | Code Generation |
| headerFile | Header File | CoderInfo.CustomAttributes.HeaderFile | string | label | no | Code Generation |
| alignment | Alignment | CoderInfo.Alignment | int | text | **yes**, unless StorageClass is `Auto` | Code Generation |

## StorageClass — allowed values (via CoderInfo.StorageClass path)

Our schema writes to the `CoderInfo.StorageClass` property directly (not the
top-level `obj.StorageClass` shortcut). The CoderInfo.StorageClass property is
a true enum with a fixed allowed set. Tested on both `Simulink.Parameter` and
`Simulink.Signal` — the CoderInfo enum is identical for both:

| Value | Accepted | Stored as | Notes |
|-------|----------|-----------|-------|
| Auto | yes | Auto | Default |
| SimulinkGlobal | yes | Model default | Legacy alias; MATLAB normalizes on read |
| ExportedGlobal | yes | ExportedGlobal | |
| ImportedExtern | yes | ImportedExtern | |
| ImportedExternPointer | yes | ImportedExternPointer | |
| Custom | yes | Custom | Requires CustomStorageClass to be set separately |
| Model default | yes | Model default | Alternative spelling of SimulinkGlobal |

### Values NOT valid on CoderInfo.StorageClass

The top-level `obj.StorageClass` shortcut also accepts CSC (Custom Storage
Class) names like `BitField`, `Struct`, `GetSet`, `Volatile`, `Define`,
`Localizable`, `Reusable` — these work only through the shortcut (which
internally sets `StorageClass='Custom'` + `CustomStorageClass=<name>`). They
are **rejected** on `CoderInfo.StorageClass` directly:

> Error setting property 'StorageClass' of class 'CoderInfo':
> There is no enumerated value named 'BitField'.

Since our write path is `CoderInfo.StorageClass`, these CSC values are correctly
**excluded** from our dropdown.

### Our schema options vs MATLAB truth

Schema options: `["Auto", "SimulinkGlobal", "ExportedGlobal", "ImportedExtern", "ImportedExternPointer", "Custom"]`

All 6 values are accepted by MATLAB at our write path (`CoderInfo.StorageClass`).
There is **no fidelity gap**: we do not accept anything MATLAB rejects, and
MATLAB does not reject anything in our options list. The `trySetSchemaProperty`
validation matches MATLAB exactly for this write path.

### Rejection message (invalid token)

When the user types a token not in the options list, `trySetSchemaProperty`
returns:

```
{ error: true, reason: "Invalid value for Storage Class", invalidValue: "<input>" }
```

MATLAB's verbatim rejection (via `CoderInfo.StorageClass`):

> Error setting property 'StorageClass' of class 'CoderInfo':
> There is no enumerated value named '<input>'.

## headerFile — why read-only

`CoderInfo.CustomAttributes.HeaderFile` is a free-form char property. It is only
meaningful when StorageClass is 'Custom' and a CSC that uses a header file is
selected. Because:
1. Editing it without the matching CSC context would produce an inconsistent state.
2. The valid value depends on the active CustomStorageClass (not something we can
   validate in isolation).

It is rendered with `editor: 'label'` — `trySetSchemaProperty` returns `null`
(not a writable schema prop), so the edit path is never reached.

## alignment — MATLAB's rule

`CoderInfo.Alignment` is an int32. Measured in R2027a (27.1.0.3409468,
2026-10-16), on `Simulink.Parameter`, `Simulink.Signal` and their `mpt.*`
subclasses:

- The value is converted as int32 first: round half away from zero,
  saturating, with NaN as 0 and `true` as 1. So 1.5 is stored as 2, 2.5 becomes
  3 and is refused, and 2^31 becomes 2147483647 and is refused.
- The value must then be -1 (the default) or a power of two from 1 to 2^30.
  Anything else is refused with "<n> is not a valid alignment boundary. The
  alignment boundary must be either -1 or a power of two no more than 128." We
  leave out "no more than 128", because MATLAB does not apply it: 256 through
  2^30 are all accepted.
- A char value is refused with "Value must be numeric or logical." A table
  cell's text is read as the number it spells: a decimal literal, `Inf`, `NaN`,
  `true` or `false`. Anything else, including empty text, gets that refusal.
- Only after the value check, under StorageClass `Auto` (the default, and most
  entries), every value but -1 is refused: "Cannot set Alignment when
  StorageClass is 'Auto'." So 3 under `Auto` is refused as 3. The table cell is
  a plain string there, through the `editableFor` hook on the column's
  PropClass, which `BaseNode.getPropInfo` honours.
- Setting StorageClass to `Auto` resets Alignment to -1 (MATLAB also warns
  "Alignment is ignored when StorageClass is 'Auto'.", which has no channel
  here). Undoing that edit restores the StorageClass and not the Alignment, as
  in MATLAB.

### The written form

- In a text `.sldd`, MATLAB writes a non-default value as
  `"Alignment": {"_type": "int32", "_value": "8"}`, the first key of
  CoderInfo's `_properties`, and leaves the key out at -1. A binary `.sldd`
  always holds `<P Name="Alignment" Class="int32">8</P>`, or -1.
- On read-back, a typed int32, a typed double and a bare number all load. A
  **string** `"16"` loads as -1, silently, so the edit would be lost. An
  invalid value, or any value under `Auto`, also loads as -1.
- So the write keeps the form the file already holds: a typed leaf keeps its
  `_type`, and a bare number stays bare. A new key is a typed int32, inserted
  where MATLAB's sorted text puts it. A string leaf is replaced by a typed one,
  and a string is never written. Setting -1 removes the key in a text
  dictionary and writes int32 -1 in a binary one. An absent key at -1 stays
  absent. Setting the value already held marks nothing.

## Validation mirrored in code

- `schemaBridge.ts: trySetSchemaProperty` → for `storageClass` (editor 'select'):
  validates `stringValue` is in `prop.options`; rejects with
  `"Invalid value for Storage Class"`. Test:
  `test/parity/fidelity/schemaColumns.fidelity.test.ts`.
- `alignment` (editor 'text', on Parameter and Signal): `setAlignment` and
  `writeAlignment` in `schemaBridge.ts` apply the rule and the written form
  above, and a `storageClass` write to `Auto` resets it. Test:
  `test/alignmentEdit.test.ts`, which runs over the MATLAB-written entries in
  `test/fixtures/classes_r2027a_{text,binary}.sldd`.
- `headerFile` (editor 'label'): `trySetSchemaProperty` returns `null` (not
  writable), so `DataNode.setProperty` falls through to field-based logic,
  which also does not handle it. It is effectively read-only.
- **No generic validation.** `trySetSchemaProperty` validates each writable
  prop by its own rule: the 'select' options, and Alignment's. There is no
  generic `int` branch, because `Number.isInteger` accepts 3, which MATLAB
  refuses as an Alignment. Adding a writable prop of a new editor type
  requires adding its validation at the same time.

## Round-trip coverage

- JSON sldd: set storageClass → serialize → re-parse → value preserved.
  Test: `test/parity/fidelity/schemaColumns.fidelity.test.ts` (format 'json').
- Binary sldd: same. Test: same file (format 'binary').
- Alignment, both formats: an edit saves as MATLAB wrote the same value
  (pSC set to 8 gives pAl8's CoderInfo exactly). Set back to -1, it gives
  pAlM1's. StorageClass set to `Auto` gives pNo's. Each re-parses. Test:
  `test/alignmentEdit.test.ts`.
- MATLAB re-open value-equality gate: set CoderInfo.StorageClass to
  'ExportedGlobal' → MATLAB reads it back as 'ExportedGlobal'. Set to 'Auto' →
  reads back 'Auto'. Test: same file (gated on DEX_MATLAB_CMD).

## Open questions / deferred

- **SimulinkGlobal normalization**: MATLAB normalizes 'SimulinkGlobal' to
  'Model default' on read-back. Our serializer writes the literal string
  'SimulinkGlobal' into the sldd. MATLAB will accept this and normalize it, so
  the MATLAB gate for 'SimulinkGlobal' should assert the read-back value is
  'Model default'. This is a display-only nuance, not a data-loss risk.
- **Custom + CustomStorageClass**: Setting StorageClass to 'Custom' is valid but
  incomplete without also setting CustomStorageClass. The schema does not yet
  expose CustomStorageClass as editable. A file that already has Custom will
  display correctly; setting it TO Custom from the dropdown is technically valid
  but leaves CSC attributes unchanged. Acceptable for Phase 2.
