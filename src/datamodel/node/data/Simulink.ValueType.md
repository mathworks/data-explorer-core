<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.ValueType — data-object fidelity

**Node class:** `ValueTypeNode` (`src/datamodel/node/data/ValueTypeNode.ts`)
**MATLAB class:** `Simulink.ValueType`
**Editable in our UI:** yes (Name, Description, Min, Max, Complexity, DimensionsMode)
**Verified against:** MATLAB R2027a (probe_class('Simulink.ValueType'))
**Partly unverified:** the Min / Max / Complexity / DimensionsMode unlock is verified
in-process only. There is no MATLAB re-open gate for those four — see "Open questions".

## Overview

A Simulink.ValueType defines a reusable value-type specification (data type, unit,
dimensions, complexity, min/max bounds) that can be applied to signals, states, and
parameters. In our UI the ValueType has no scalar "value": the Value column is empty and
not editable (`valueEditable = false`). The Data Type column shows the underlying
DataType property (defaulting to 'double'). The Property Inspector shows Name, DataType,
Dimensions, Complexity, DimensionsMode, Min, Max, Unit, and Description — the same
value-property surface a `Simulink.BusElement` gets, and for the same reason: MATLAB
models these properties on the object, so a UI that hides them is hiding data the file
carries.

## Property table

| Property       | MATLAB type  | SetAccess | Editable here | Serialized key (JSON / binary) | Editor   | Allowed values / constraint |
|----------------|-------------|-----------|---------------|--------------------------------|----------|-----------------------------|
| Name           | char        | (entry)   | yes           | name / name                    | text     | Valid MATLAB identifier, unique in namespace |
| Description    | char        | public    | yes           | Description / Description      | textArea | Any string |
| DataType       | char        | public    | no (label)    | DataType / DataType            | label    | Any string (free-form; MATLAB validates downstream) |
| Unit           | char        | public    | no (label)    | Unit / Unit                    | label    | Any string (SI or custom unit) |
| Min            | double / [] | public    | yes           | Min / Min                      | text     | Finite real double scalar; `[]` clears |
| Max            | double / [] | public    | yes           | Max / Max                      | text     | Finite real double scalar; `[]` clears |
| Complexity     | char (enum) | public    | yes           | Complexity / Complexity        | select   | 'real' or 'complex' (exact case); `''` clears |
| DimensionsMode | char (enum) | public    | yes           | DimensionsMode / DimensionsMode | select  | 'Fixed' or 'Variable' (exact case); `''` clears |
| Dimensions     | double      | public    | no (label)    | Dimensions / Dimensions        | label    | Positive integer row vector |

## Non-obvious behavior (the reason this doc exists)

### The value properties were modelled but unreachable

`schema/classes/valueType.json` already carried a layout naming `min`, `max`, `unit`,
`dimensions` and `complexity`, and every one of those rows rendered BLANK. Those keys
resolve through `schemaBridge`'s `ATOM_BY_KEY` to atoms that read node FIELDS, and
`ValueTypeNode` had no such fields — so each row read empty AND was added to `shownKeys`,
which had the "Other" catch-all suppress the raw source key as well. A `"Unit": "m"` in
the dictionary was therefore invisible in both panes at once
(`test/parity/artifacts/text/params.sldd`'s `MyValueType` is exactly that file). The fix
is the fields; the layout did not need to change.
Test: `test/valueTypeValueProps.test.ts`.

### Unit is spelled `Unit`, not `DocUnits`

MATLAB serializes a ValueType's unit as a flat `Unit` key, where a `Simulink.Parameter`'s
or `Simulink.Signal`'s is `DocUnits` (both measured off dictionaries MATLAB wrote). The
node reads both spellings so a file written either way displays, `Unit` first, and writes
back under whichever spelling the file used. `PropUnit` already declares
`sourceKeys = ['DocUnits', 'Unit']`, so neither spelling leaks into "Other".
The per-class `sourcePath: "Unit"` override in `valueType.json` says the same thing on the
schema side; it is pinned by a test that reads the resolved descriptor, because nothing in
the rendered UI depends on it today.

### Complexity / DimensionsMode — displayed default vs saved key

A ValueType that declares neither DISPLAYS MATLAB's default, `real` and `Fixed` — the same
pair `Simulink.BusElement` defaults to, and NOT the `auto` a `Simulink.Signal` uses. Two
places have to agree on that: `valueType.json` overrides the shared `dimensionsMode`
descriptor's `default` per class (which feeds the TABLE column via `schemaColumns`) and the
constructor's fallback feeds the Property Inspector. The test asserts the two AGREE rather
than asserting each alone.

Display values only: `_serializedOverrides` writes each key only when the FILE carried it
or the live value differs from the default, so a ValueType the file left silent saves
silent. See the BusElement doc for why the gate cannot be a truthiness test.

### No `*_internal` aliases

Unlike `Simulink.BusElement`, none of these properties is read through a `*_internal`
alias: a probe wrote a ValueType with every property non-default and the dictionary came
back with flat keys only. That aliasing is specific to bus elements in SLX XML, so looking
for it here would be inventing a spelling MATLAB does not use.

### Value column

- A ValueType has no scalar "value" — `displayValue` returns `''` and
  `valueEditable` returns `false`. The DataType property (defaulting to 'double')
  is surfaced in the Data Type column, not the Value column.

### Description

- Non-string assignment (`5`, `[1 2]`, `true`, `struct(...)`, `{1,2}`) in MATLAB
  produces **"Value must be a character vector or a string scalar."** This rejection
  is **unreachable** from our string editor. Type-guarded by the string editor.

### DataType (label, not editable)

- The ValueType's DataType is shown as a label in the Data Type column. It is not
  editable through the current UI (shown as a label, not a text editor). If made
  editable in the future, it accepts any character vector (free-form in MATLAB).

## Allowed values (enums / comboboxes)

- Complexity → `['real', 'complex']` (`PropComplexity.readOptions`)
- DimensionsMode → `['Fixed', 'Variable']` (`PropDimensionsMode.readOptions`)

Exact case, not normalized in either direction: MATLAB wrote 'real' lower case and 'Fixed'
capitalized and refuses the other spelling of each, so a case-insensitive match here would
produce a file MATLAB will not load.

## Validation mirrored in code

- Name: validated by `DataNode.setProperty` → `validateMatlabName` (valid MATLAB
  identifier, unique in namespace, max 63 chars, not a keyword).
  Test: `test/parity/fidelity/typedef.fidelity.test.ts`.

- Min / Max: `setProperty` routes to `DataNode._setMinMax`, the shared finite-real-double-
  scalar rule (`{error, reason: "<Label> must be a finite real double scalar value"}`).
  The generic numeric path it bypasses wrongly accepts Inf/NaN.
  Test: `test/valueTypeValueProps.test.ts`.

- Complexity / DimensionsMode: `setProperty` routes to `DataNode._rejectUnknownEnumeral`,
  which reads the legal set off the prop atom's `readOptions` — the same call the dropdown
  is built from, so the offered choices and the accepted values cannot drift — and returns
  `{error, reason: "There is no enumerated value named 'X'."}`. `''` is a CLEAR, not a
  rejection; see the BusElement doc for the full rationale.
  Test: `test/valueTypeValueProps.test.ts`.

- No additional validation for Description (any string accepted).

## Round-trip coverage

- JSON sldd: parse → verify className + read-only contract → serialize → re-parse.
  Test: `test/parity/fidelity/typedef.fidelity.test.ts` (json format loop).
- Binary sldd: same.
  Test: `test/parity/fidelity/typedef.fidelity.test.ts` (binary format loop).
- JSON and binary sldd, over `params.sldd`'s `MyValueType`: an untouched ValueType keeps
  exactly its own keys; an edit to each value property survives serialize + re-parse;
  picking a default or clearing an edit adds no key; a cleared bound goes out as `[]`; the
  unit is written under the spelling the file used; and both save paths name the same keys.
  Test: `test/valueTypeValueProps.test.ts`.
- MATLAB gate: Description edit → MATLAB reads back the edited string. PASS.

## Open questions / deferred

- **MATLAB re-open gate for the newly editable properties — NOT RUN.** Min, Max,
  Complexity and DimensionsMode are verified in-process (serialize → re-parse) only. No
  MATLAB was available where the unlock was made, so there is no PASS to record that
  MATLAB loads the written file and reads the values back. Same status as the
  `Simulink.BusElement` enum unlock, and worth running in the same pass.

- **Dimensions stays read-only**: a positive double vector with a symbolic-char
  alternative. Left a label for the reason `BusElementNode` records — the constraint has
  not been worked out here, and an unlock is worth only as much as the rule that refuses a
  bad value. It is also absent from `_serializedOverrides` for that reason: with no live
  value to write, the file's own key passes through untouched.

- **DataType editability**: Currently a label; could become a text editor if the
  Property Inspector UX is extended. Accepts any char (no enum constraint in
  MATLAB — downstream Simulink validation catches invalid types).
