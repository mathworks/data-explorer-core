<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.Parameter — data-object fidelity

**Node class:** `ParameterNode` (`src/datamodel/node/data/ParameterNode.ts`)
**MATLAB class:** `Simulink.Parameter`
**Editable in our UI:** yes
**Verified against:** MATLAB R2027a (probe_class('Simulink.Parameter'))

## Overview

A Simulink.Parameter stores a tunable value (scalar, vector, matrix, complex,
logical, string, or struct) along with metadata (data type, units, min/max bounds,
description, code-generation settings). In our UI the Parameter surfaces as an
editable entry whose Value column shows the formatted value and whose Property
Inspector exposes Name, Value, DataType, Min, Max, Unit, Description, and the
schema-projected CoderInfo columns (StorageClass, Alias, etc.).

## Property table

| Property      | MATLAB type          | SetAccess | Editable here | Serialized key (JSON / binary) | Editor   | Allowed values / constraint |
|---------------|---------------------|-----------|---------------|--------------------------------|----------|-----------------------------|
| Name          | char                | (entry)   | yes           | name / name                    | text     | Valid MATLAB identifier, unique in namespace |
| Value         | varies              | public    | yes           | Value / Value                  | text     | Numeric scalar/array/matrix, complex, logical, string, struct (no cells, no empty struct leaves) |
| DataType      | char                | public    | no (label)    | DataType / DataType            | label    | Any string (free-form; MATLAB validates downstream). Absent key = `'auto'` |
| Min           | double / []         | public    | yes           | Min / Min                      | text     | Finite real double scalar, or [] to clear |
| Max           | double / []         | public    | yes           | Max / Max                      | text     | Finite real double scalar, or [] to clear |
| Unit          | char                | public    | no (label)    | DocUnits / DocUnits            | label    | Any string |
| Description   | char                | public    | yes           | Description / Description      | text     | Any string |
| Complexity    | char (enum)         | public    | no (hidden)   | Complexity / Complexity        | —        | 'real' or 'complex' |
| Dimensions    | double row vector   | public    | no            | Dimensions / Dimensions        | —        | Positive integer row vector |
| StorageClass  | char (enum)         | public    | yes (schema)  | CoderInfo.StorageClass         | combo    | schemaBridge-validated |
| Alignment     | int32               | public    | yes (schema), not under StorageClass `Auto` | CoderInfo.Alignment | text | -1 or a power of two from 1 to 2^30; see CodeGeneration.schema-columns.md |
| CoderInfo     | Simulink.CoderInfo  | protected | nested        | CoderInfo / CoderInfo          | —        | Sub-object, not directly assigned |

## Non-obvious behavior (the reason this doc exists)

### Value

- `Value = {1,2}` (cell) → **"Invalid value specified for parameter. Value must be a numeric array, fi object, enumerated value, structure whose fields contain valid values, string scalar, or an expression."**
  A cell array is NOT a valid Parameter.Value. This is a hard reject.

- `Value = struct('a',[])` → **"A valid structure must be numeric"**
  A struct Value where any leaf is empty/null is rejected.

- `Value = scalar/array/matrix/complex/logical/string/char/[]` → all OK (stored verbatim with the type preserved).

- The whole set is measured by `test/parity/matlab/probe_parameter_value.m`, whose 78 cases
  are in `test/fixtures/parameter_value_truth.json`. By the 2026-10-15 ruling on C-160 and
  C-042 core mirrors it at edit time, with MATLAB's message (`ParameterNode._refuseValueBelow`
  and the Parameter's own Value setter):
  - the Value itself, typed into the Parameter or into its Value row: a cell and a string
    array of more than one element are refused (`Simulink:Data:Param_Invalid_Value`);
  - a field of a struct Value, at any depth: also `[]` and `''` (`""` and a char are
    accepted), with `Simulink:Parameters:PrmInvalidStruct`, "A valid structure must be
    numeric";
  - a field under a struct ARRAY: also a value unlike the same field in another element in
    class, complexity or size (a char may differ in length), and every one of these is
    refused with `Simulink:Parameters:PrmInvalidArrayOfStructs`, "A valid array of
    structures must be numeric and homogeneous in terms of data type and dimensions".
  A plain struct variable keeps taking all of them. Only an edit is judged: a file's own
  value reads and saves as it is.

### The Value child row (presentation, Parameter-only)

A Parameter shows a `Value` child row **only when the value has something to expand
into** — more than one element (vector, matrix, string array) or struct fields. A
SCALAR of any class (plain double, `int16(500)`, `single`, `logical`, `Inf`, `3+4i`,
a string) is shown whole in the Parameter's own Value column and gets no row.

The on-disk spelling deliberately does NOT decide this. MATLAB writes a plain double
scalar as a bare JSON number but `int16(500)`, `Inf`, and complex as `{ _type, _value }`
wrapper objects, so the older "raw value is an object → add a row" rule gave a row to
some scalars and not others, and gave the same `Inf` parameter a row in a JSON
dictionary but not in a binary one (`BinarySlddParser.parseTypedValue` hands back a
bare number for class `double`).

`ParameterNode._adoptValueNode` implements it: the value node is always built, and is
kept as `_valueNode` whether or not it becomes a child. That is load-bearing — the node
is what writes the `_type`/`cdata` wrapper back out, so a scalar rendered inline off a
bare `this.Value` would save as an untyped double.

The rule is re-applied after every structural edit, not just at parse time, because an
edit can move the value across the line: deleting elements of `[1 2]` down to one
collapses the value node to the scalar `1`, and the row has to go with them (and come
back on undo). `childEdit`'s add/remove wrappers — including their undo/redo closures —
call `parent.childStructureChanged(container)` after the mutation, a `BaseNode` no-op
that only `ParameterNode` overrides. It fires there rather than inside the four
containers' own `removeChildNode`/`restoreChildNode` because it must run AFTER the
collapse bookkeeping those methods do last.

Scoped to `Simulink.Parameter` on purpose. Any other class — including a custom object
that happens to have a `Value` property — keeps the general expansion rule, because a
property bag's rows ARE its properties.
Test: `test/parameterNode.test.ts` (`ParameterNode.parse — Value child row`, including
the custom-class scoping guard).

### Min / Max

- `Min = [1 2 3]` / `Inf` / `-Inf` / `NaN` / `5+2i` / `'text'` → **"Minimum must be a finite real double scalar value"**
- `Max = [1 2 3]` / `Inf` / `-Inf` / `NaN` / `5+2i` / `'text'` → **"Maximum must be a finite real double scalar value"**
- `Min = []` or `Max = []` → clears the bound (MATLAB stores `[]`).
- MATLAB does NOT enforce Min <= Max (it accepts Min=5, Max=1). We match this: no cross-check.

### DataType

- Shown in the **Data Type column** and the PI's Data Type label (`ParameterNode.dataType`).
  `DataNode.dataType` returns `''` — most object classes have no data type of their own —
  so before the override every Parameter in every dictionary showed a blank cell.
- **An absent `DataType` key means `'auto'`**, MATLAB's default, not "unknown". A text
  sldd omits the key for a default-typed Parameter; a binary one writes
  `DataType="auto"` explicitly. Verified on a matched pair of MATLAB-written dictionaries, one
  text and one binary, made by the same script: `P01_Default` has no key in the text file and `"auto"` in the
  binary one. The default is display-only — `_getSerializedProperties` copies the on-disk
  properties, so nothing writes `auto` back into a file that did not have it.
- Free-form text: builtins (`int16`), a type defined elsewhere in the dictionary
  (`SensorReading`), `Bus: X` / `Enum: X` / `fixdt(...)` expressions, and hand-written
  typedef names (`CntrU16_t`) all pass through verbatim. Nothing here maps or validates.
  Test: `test/parameterNode.test.ts` (`ParameterNode.dataType`).
- **It follows the Value**, as MATLAB's `p.Value = v` re-derives it, one edit at a time: of the
  class of the Value before the edit and the DataType then (`ParameterNode._followSourceDataType`,
  `_classFollowed`). `"abc"` and then `7` typed over a `single` Parameter's `5` leave `'auto'`, in
  every format. Test: `test/dictionaryParameterDataType.test.ts`.

### DataType / Unit / Description

- Non-string assignment (`5`, `[1 2]`, `true`, `struct(...)`, `{1,2}`) →
  **"Value must be a character vector or a string scalar."**
  This rejection is **unreachable** from our string editor (the UI always delivers
  a string), so no code is added for it. Type-guarded by the string editor.

### StorageClass

- Enum validation is owned by `schemaBridge.ts` (not this node). Out-of-set
  strings → **"'X' is not a valid storage class"**.

### Complexity

- Enum: only 'real' and 'complex'. Any other string →
  **"There is no enumerated value named 'X'."**
  Not currently exposed in our UI editor.

### Dimensions and Complexity follow the Value

MATLAB keeps both as the Value's. It refuses a numeric Dimensions other than the Value's size
(`Simulink:Data:UDDData_CannotSetCustomDimensions`) and any Complexity set
(`Simulink:Data:UDDData_CannotSetComplexity`). After an edit of the Value, both are the Value's
size and complexity. Measured for every edit core makes by
`test/parity/matlab/probe_parameter_shape.m` (R2027a, truth `parameter_shape.truth.json`).
Exceptions:

- a symbolic Dimensions (`'[1,N]'`) is kept;
- an empty Value keeps both: `[]` typed over a `[1 3]` complex row leaves `[1 3]` and `complex`;
- a struct Value keeps its Complexity;
- text is a string scalar: `'abc'` and `''` give `[1 1]` and `real`.

`ParameterNode._followValueShape` sets both from the Value after every edit: an Add, a removal,
a Value typed on the Parameter, on its Value row or on one of its elements, and the undo or redo
of each. Each is set only where the file holds it. The undo of each edit then puts back what
the two held before it: for a Value typed in, `_restorerFor`; for an Add, a removal or an edit of
the Value row or of an element, `childStructureRestorer`, which the undo calls through
`childEdit.holdersRestorer`. For a file MATLAB wrote that is the restored Value's shape. A
hand-edited file can hold another (MATLAB refuses that state), and its undo gives back what was
read: pRow with `[1 5]` for its three elements, cut to two and undone, is `[1 5]` again, where it
came back as `[1 3]`. Tests: `test/parameterShape.test.ts`, `test/parameterShapeUndoAsRead.test.ts`.

## Allowed values (enums / comboboxes)

| Property     | Accepted set                 | Rejection message |
|-------------|------------------------------|-------------------|
| Complexity  | `real`, `complex`            | "There is no enumerated value named 'X'." |
| StorageClass| `Auto`, `ExportedGlobal` (+ CSC-registered classes) | "'X' is not a valid storage class" |

## Validation mirrored in code

- `ParameterNode.setProperty('Value', ...)` rejects cell values (parsed.type === 'cell')
  → returns `{error, reason: "Invalid value specified for parameter. Value must be
  a numeric array, fi object, enumerated value, structure whose fields contain
  valid values, string scalar, or an expression."}`. Mirrors the verbatim MATLAB
  R2027a message.
  Test: `test/parity/fidelity/parameter.fidelity.test.ts`.

- `ParameterNode.setProperty('Value', ...)` rejects unparseable expressions
  (MatlabValueParser returns null) → `{error, reason: "Invalid MATLAB expression"}`.
  Test: same file.

- `DataNode._setMinMax` enforces finite real double scalar for Min/Max.
  Test: `test/parity/fidelity/parameter.fidelity.test.ts` (Min→3, Max→99 round-trip).

- StorageClass enum validation: owned by `schemaBridge.ts` (separate agent scope).

## Round-trip coverage

- JSON sldd: parse → edit Min/Max/Value → serialize → re-parse → value preserved.
  Test: `test/parity/fidelity/parameter.fidelity.test.ts` (json format loop).
- Binary sldd: same.
  Test: `test/parity/fidelity/parameter.fidelity.test.ts` (binary format loop).
- MATLAB re-open value-equality gate:
  - `Min=3, Max=99` → MATLAB reads 3 and 99. PASS.
  - `Value=42` → MATLAB reads 42. PASS.
  - `Value=[1 2 3]` → in-process only (verify_roundtrip.m's jsondecode converts
    JSON arrays to column vectors; MATLAB stores the row vector — shape mismatch in
    the gate's isequal. Class assertion still validates MATLAB opens the file).
  Test: `test/parity/fidelity/parameter.fidelity.test.ts` (gated on DEX_MATLAB_CMD).

## Open questions / deferred

- **Struct Value editing**: a struct Value's fields are edited on its child rows, and an
  edit there is held to MATLAB's rules (see Value, above). So is a STRUCTURAL edit (the
  ruling A2, 2026-10-15 evening), as measured by `probe_parameter_value.m`'s `structural`
  cases: the gates (`canAddChild`, `canRemoveChild`) close on an edit whose resulting Value
  MATLAB refuses, and `_structuralRefusal` gives MATLAB's message
  (`ParameterNode._refuseStructureBelow`). Refused: removing the last field of a struct
  nested in the Value (`struct('a', struct())`, PrmInvalidStruct), and, in a struct array,
  adding or removing a field of a struct, or an element of an array, in one element
  (PrmInvalidArrayOfStructs, or the outermost scalar struct's PrmInvalidStruct). Accepted:
  every other field or element added or removed, and the Value's own last field
  (`struct()` is a valid Value).

- **Dimensions property**: complex validation rules exist (positive integer row
  vector, no trailing 1 for >2D, symbolic expressions). Not currently editable in
  our UI; deferred.

- **Complexity property**: enum-validated ('real'/'complex') but not surfaced in
  the UI editor. Deferred.

- **verify_roundtrip.m array handling**: JSON arrays become MATLAB column vectors
  via jsondecode, causing shape mismatch with row-vector Parameter.Value. A future
  improvement could reshape expected arrays in the M-function; for now array
  assertions are in-process only.
