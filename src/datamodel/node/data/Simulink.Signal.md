<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.Signal — data-object fidelity

**Node class:** `SignalNode` (`src/datamodel/node/data/SignalNode.ts`)
**MATLAB class:** `Simulink.Signal`
**Editable in our UI:** yes (Min, Max only; Description via text area; schema
columns StorageClass/Alignment via schemaBridge)
**Verified against:** MATLAB R2027a (probe_class('Simulink.Signal'))

## Overview

A `Simulink.Signal` data object defines attributes of a signal (data type,
dimensions, sampling mode, etc.) that a Simulink model can reference. Unlike
`Simulink.Parameter`, a Signal has **no scalar Value** — `displayValue` is `''`
and `valueEditable` is `false`.

The only directly-editable numeric properties surfaced in our UI are **Min** and
**Max** (validated by `_setMinMax` on `DataNode`). **Complexity** and
**DimensionsMode** are editable dropdowns over the Signal's own enums (validated by
`_rejectUnknownEnumeral` on `DataNode`). All other properties are either read-only
labels or delegated to the schema bridge (Code Generation columns).

## Property table

| Property | MATLAB type | SetAccess | Editable here | Serialized key | Editor | Constraint |
|----------|-------------|-----------|---------------|----------------|--------|------------|
| Name | char | — | yes | (entry name) | text | valid MATLAB identifier, unique in namespace |
| DataType | char | public | no | DataType | label | free-form char (MATLAB validates at model compile, not at assignment) |
| Min | double/[] | public | yes | Min | text | finite real double scalar; `[]` clears |
| Max | double/[] | public | yes | Max | text | finite real double scalar; `[]` clears |
| Unit | char | public | no | DocUnits or Unit | label | unit expression (parser too complex to mirror) |
| Description | char | public | yes | Description | textArea | any string |
| Dimensions | double/char | public | no | — | — | not an editable column (complex multi-type acceptance) |
| DimensionsMode | char (enum) | public | yes | DimensionsMode | select | enum {auto, Fixed, Variable}; default auto |
| Complexity | char (enum) | public | yes | Complexity | select | enum {auto, real, complex}; default auto |
| SampleTime | double | public | no | — | — | not surfaced |
| SamplingMode | char (enum) | public | no | — | — | enum {auto}; not surfaced |
| InitialValue | char | public | no | — | — | free-form char; not surfaced as editable column |
| CoderInfo | Simulink.CoderInfo | protected | via schema | CoderInfo.* | select/text | schemaBridge owns StorageClass + Alignment |
| LoggingInfo | Simulink.LoggingInfo | protected | no | LoggingInfo | — | not exposed |
| HasCoderInfo | logical | protected | no | — | — | dependent, hidden |
| RTWInfo | Simulink.CoderInfo | protected | no | — | — | hidden alias for CoderInfo |
| Units | — | protected | no | — | — | hidden, unreadable |

## Non-obvious behavior

### Min / Max — finite real double scalar

MATLAB rejects any value that is not a single, finite, real, double scalar:

- `Min = [1 2 3]` → **"Minimum must be a finite real double scalar value"**
- `Min = Inf` → **"Minimum must be a finite real double scalar value"**
- `Min = -Inf` → **"Minimum must be a finite real double scalar value."**
- `Min = NaN` → **"Minimum must be a finite real double scalar value"**
- `Min = 5+2i` → **"Minimum must be a finite real double scalar value"**
- `Min = 'text'` → **"Minimum must be a finite real double scalar value"**
- `Min = true` → **"Minimum must be a finite real double scalar value"**
- `Min = []` → **OK** (clears to empty/default)
- `Max` follows the same rules with "Maximum" in the message.

Note: MATLAB does NOT enforce `Min <= Max`. Setting `Min=5, Max=1` is accepted.
The code mirrors this: no cross-check is applied.

### No scalar Value

A Signal has no Value field (unlike Parameter). `displayValue` is always `''`
and `valueEditable` is `false`. The setProperty path for Value is never reached.

### DataType / Unit / Description / InitialValue — char-only

These MATLAB properties reject numeric assignment with "Value must be a character
vector or a string scalar." Our UI always passes strings, so that rejection is
**unreachable** from the string editor. No dead validation code is added.

- **DataType** is `editor: 'label'` (read-only in our UI) because MATLAB accepts
  arbitrary free-form strings as data type specs, validated only at model compile.
- **Unit** is `editor: 'label'` because it goes through a unit-expression parser
  we cannot faithfully replicate.
- **Description** is `editor: 'textArea'` — any string is accepted by MATLAB at
  assignment time, so no validation is needed.
- **InitialValue** is not surfaced as an editable column.

### Enum properties (DimensionsMode, Complexity, SamplingMode)

These accept only specific tokens (case-insensitive on first char for some):
- **DimensionsMode**: `Fixed`, `Variable`, `auto` (also accepts `Auto` → stores
  `auto`). Out-of-set → "There is no enumerated value named 'X'."
- **Complexity**: `real`, `complex`, `auto`. Same error pattern.
- **SamplingMode**: `auto` only. Same error pattern.

Measured in R2027a (27.1.0.3409468, 2026-10-16): `set(Simulink.Signal, 'Complexity')`
is `auto|real|complex` and `set(Simulink.Signal, 'DimensionsMode')` is
`auto|Fixed|Variable`, both defaulting to `auto`, and `mpt.Signal` has the same two.
`''` is refused too. A text `.sldd` holds a non-default value as a top-level key
(`"Complexity": "complex"`) and has no key at `auto`, even for a Signal set to
`complex` and back; a binary one always holds the key
(`<P Name="Complexity" Class="char">auto</P>`).

**Complexity** and **DimensionsMode** are editable dropdowns (C-030, the 2026-10-16
group E ruling): `PropSignalComplexity` and `PropSignalDimensionsMode`, in the table
and in the Property Inspector, both reading the node field. `setProperty` refuses any
other value with MATLAB's message. Two deliberate differences:
- MATLAB matches case-insensitively and stores the canonical spelling (`'Complex'` →
  `complex`, `'fixed'` → `Fixed`). We match exactly, as for BusElement and ValueType;
  the dropdown only offers canonical spellings.
- An empty value is a CLEAR (the licence `_rejectUnknownEnumeral` gives every enum),
  so an undo of an edit can restore absence. It shows and saves as `auto`, never as `''`.

Both save paths write the key when the file had it or the value is not `auto`, so an
untouched Signal, or one set back to `auto`, saves with no new key, as MATLAB does.
Test: `test/signalEnumProps.test.ts`.

**SamplingMode** is still a label; its validation is not mirrored.

### Dimensions — complex multi-type

Dimensions accepts positive integer scalars, row vectors `[2 3]`, symbolic char
identifiers `'varName'`, and the inherit token `-1`. It rejects `0`, negative
(except `-1`), non-integer, NaN, complex, matrices, empty, and logical. The
detailed error:

> "Invalid 'Dimensions' property specified. This property must be a double vector
> consisting of either positive elements such that their cumulative product is less
> than or equal to 2147483647, or elements with value of -1..."

Dimensions is NOT an editable column in our UI (not projected), so this complex
validation is not mirrored.

## Validation mirrored in code

- `SignalNode.setProperty('Min'|'Max', ...)` delegates to `DataNode._setMinMax`
  which enforces the finite-real-double-scalar rule. Returns
  `{error, reason: "<Label> must be a finite real double scalar value"}`.
  Test: `test/parity/fidelity/signal.fidelity.test.ts`.
- `SignalNode.setProperty('complexity'|'dimensionsMode', ...)` delegates to
  `DataNode._rejectUnknownEnumeral`, which reads the legal set off the atom the
  dropdown is built from. Returns `{error, reason: "There is no enumerated value
  named 'X'."}`. Test: `test/signalEnumProps.test.ts`.
- Read-only props (DataType, Unit, Dimensions, SamplingMode, InitialValue): not
  editable in our UI; editor is `'label'` or column not projected. No dead
  validation needed.
- Description: free-form char, any string accepted — no validation needed.
- Schema columns (StorageClass, Alignment): owned by `schemaBridge.ts`.

## Round-trip coverage

- JSON sldd: parse → edit Min/Max → serialize → re-parse → values preserved.
  Test: `test/parity/fidelity/signal.fidelity.test.ts` (format 'json').
- Binary sldd: same. Test: same file (format 'binary').
- MATLAB re-open value-equality gate: set Min=-5, Max=10 → MATLAB reads them
  back. Test: same file (gated on DEX_MATLAB_CMD).
- Complexity/DimensionsMode, both formats: a default Signal set to complex/Variable
  saves as what MATLAB itself wrote for one (sigC in
  `test/fixtures/classes_r2027a_{text,binary}.sldd`: the text bag equal as a value,
  the binary element character for character), and re-parses as set. Test:
  `test/signalEnumProps.test.ts`. MATLAB R2027a opened a text and a binary file
  holding that write and read back complex/Variable, with no warning (measured
  2026-10-16, not a gate in this repo).

## Open questions / deferred

- **SampleTime**: accepts `0`, positive scalars, `Inf`, `-1` (inherit); rejects
  negative (except -1), arrays, NaN, complex, strings. Not surfaced as a column
  — deferred. Error message is generic "Invalid SampleTime specified".
- **Dimensions**: complex mixed-type acceptance makes it unsafe to expose as
  editable without a purpose-built parser (C-025). Safe as read-only.
  DimensionsMode, a closed enum, is editable (see above).
