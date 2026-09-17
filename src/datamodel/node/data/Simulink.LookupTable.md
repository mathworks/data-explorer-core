<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.LookupTable — data-object fidelity

**Node class:** `LookupTableNode` (`src/datamodel/node/data/LookupTableNode.ts`)
**MATLAB class:** `Simulink.LookupTable`
**Editable in our UI:** Name, Description, and Storage Class (the table's Storage Class
column, a 17-value dropdown). Everything else is a read-only projection of the source bag.
**Verified against:** MATLAB R2027a (probe_class('Simulink.LookupTable'))

## Overview

A Simulink.LookupTable stores table data with breakpoints for use by lookup-table
blocks. It contains a Table sub-object, one or more Breakpoint sub-objects,
CoderInfo, StructTypeInfo, and configuration flags. In our UI the LookupTable has no
scalar value: the Value column is empty and not editable (`valueEditable = false`). Its
Property Inspector groups (from `schema/classes/lookupTable.json`) are General (Name,
Value, Data Type, Kind, Class, Description), Value Properties (Breakpoints
Specification), Code Generation (Storage Class, and the three StructTypeInfo keys under
their MATLAB labels Name / Data Scope / Header File) and Advanced (the two tunable-size
switches) — plus the "Other" catch-all for what stays unmodelled. Every PI row but Name
and Description is a label; Storage Class is editable in the TABLE, not the PI.

## Property table

| Property            | MATLAB type                  | SetAccess | Editable here | Serialized key (JSON / binary) | Editor | Allowed values / constraint |
|---------------------|------------------------------|-----------|---------------|--------------------------------|--------|-----------------------------|
| Name                | char                         | (entry)   | yes           | name / name                    | text   | Valid MATLAB identifier, unique in namespace |
| Description         | char                         | public    | yes           | (nested in sub-objects)        | text   | Any string |
| Table               | Simulink.lookuptable.Table   | public    | no            | Table / Table                  | —      | Sub-object (Value, DataType, Dimensions, Unit, FieldName) |
| Breakpoints         | Simulink.lookuptable.Breakpoint | public | no            | Breakpoints / Breakpoints      | —      | Sub-object (Value, DataType, Dimensions, Unit, FieldName) |
| CoderInfo           | Simulink.CoderInfo           | protected | no            | CoderInfo / CoderInfo          | —      | Sub-object |
| StructTypeInfo      | Simulink.lookuptable.StructTypeInfo | public | no       | StructTypeInfo / StructTypeInfo | —     | Sub-object (DataScope, HeaderFileName, Name) |
| BreakpointsSpecification | char (enum)             | public    | no (label)    | BreakpointsSpecification / same | label  | Default 'Explicit values' |

The flat properties the schema surfaces individually (`schema/props/codeGen.json`,
`props/dataObject.json`). The left column is the MATLAB property; the schema key follows
in parentheses where the two differ.

| Property | MATLAB type | SetAccess | Editable here | Serialized path | Editor | Allowed values / constraint |
|----------|-------------|-----------|---------------|-----------------|--------|-----------------------------|
| CoderInfo.StorageClass (`storageClass`) | char (enum) | public | **yes** (table column) | CoderInfo.StorageClass | select | 17 values, per class — see "Allowed values" |
| StructTypeInfo.Name (`structTypeName`) | char | public | no (label) | StructTypeInfo.Name | label | Any string; default `''` |
| StructTypeInfo.DataScope (`structTypeDataScope`) | char (enum) | public | no (label) | StructTypeInfo.DataScope | label | 'Auto', 'Exported', 'Imported'; default 'Auto' |
| StructTypeInfo.HeaderFileName (`structTypeHeaderFile`) | char | public | no (label) | StructTypeInfo.HeaderFileName | label | Any string; default `''` |
| SupportTunableSize (`supportTunableSize`) | logical | public | no (label) | SupportTunableSize | label | true/false; blank when the file omits the key |
| AllowMultipleInstancesOfTypeToHaveDifferentTableBreakpointSizes (`allowDifferentTableBpSizes`) | logical | public | no (label) | same | label | true/false; blank when the file omits the key |

## Non-obvious behavior (the reason this doc exists)

### Value column

- A LookupTable has no scalar "value" — `displayValue` returns `''` and
  `valueEditable` returns `false`. The entry appears in the table with an empty
  Value column. The data lives in nested sub-objects (Table, Breakpoints).

### Description

- The LookupTable's Description property is stored at the top-level _properties
  (when present). Non-string assignment in MATLAB produces "Value must be a
  character vector or a string scalar." — unreachable from our string editor.
  Type-guarded by the string editor.

### Sub-objects

- Table.Value and Breakpoints.Value contain the actual numeric data arrays. These
  are not surfaced through the scalar editor — they would require a dedicated
  array/table editor. Our UI preserves them during round-trip via the pass-through
  serialization (serial._rawVal is cloned with property overrides merged).

### The six flat properties, and why DISPLAY is what gets asserted

This class used to declare almost no schema — only `breakpointsSpecification` — so its
entire code-generation surface reached the Property Inspector as flattened "Other" rows
(`Other.CoderInfo.StorageClass`, `Other.StructTypeInfo.DataScope`, …): raw serialized
paths in a collapsed catch-all rather than named, grouped properties.

- **The group titles are MATLAB's, measured, not chosen.** MATLAB's own adapter
  (`+entry_adapter/+lut/Lut.m`) has `insertCodeGenGroup` concatenate
  `getCodeGenDataDefinitionsPropAndItems` with
  `getCodeGenStructTypeDefinitionsPropAndItems`, so the data-definition property and the
  three StructTypeInfo properties land in ONE `CodeGenerationGroup` — StructTypeInfo does
  not get a group of its own. `AdvancedGroup` holds
  `AllowMultipleInstancesOfTypeToHaveDifferentTableBreakpointSizes` first and then
  `SupportTunableSize`. MATLAB's PI resource catalog spells `CodeGenerationGroup` as
  "Code Generation" and `AdvancedGroup` as "Advanced".

- **Two of the six reach their value through a nested MCOS sub-object**, which is why the
  test asserts the RENDERED sheet rather than the JSON's contents: a `props` entry can
  resolve and still render blank, and the value has to travel `serial._properties` →
  `resolveSourcePath` → `hydrate` → `toPIObject` to be seen. `StructTypeInfo.HeaderFileName`
  is deliberately spelled differently from its schema key `structTypeHeaderFile` — the
  sourcePath, not the key, is what addresses the file.

- **Absent is the common case, not an edge one.** A JSON `.sldd` omits any property sitting
  at its default, so most files carry none of these keys. Each then renders its own
  descriptor default (`storageClass` → 'Auto', `structTypeDataScope` → 'Auto', the rest
  blank), and an incomplete `StructTypeInfo` — say one carrying only `Name` — falls back
  per leaf rather than to whatever the traversal last touched.

- **Displaying a default writes nothing.** `hydrate` substitutes the default into the
  returned value only, never back into the bag, so a LookupTable that is opened, rendered
  and saved keeps exactly the keys it arrived with on both save paths.

- **Surfacing a property must also silence its raw row.** Each prop declares
  `sourceKeys = [first path segment]`, so modelling `CoderInfo.StorageClass` excludes the
  whole raw `CoderInfo` bag from "Other" — otherwise one value appears twice under two
  names. `Table` and `Breakpoints` stay in "Other" on purpose: that is how a property
  nobody has modelled stays visible instead of being silently dropped.

  Test: `test/lookupTableFlatProps.test.ts`.

### The storageClass options are REPLACED per class, not widened

`storageClass` is a single shared descriptor in `props/codeGen.json`, used by
`Simulink.Parameter`, `Simulink.Signal` and these two classes — and the value sets are NOT
nested. MATLAB accepts 17 values on a LookupTable and the shared list holds 6, but the two
overlap in only FOUR (`Auto`, `ExportedGlobal`, `ImportedExtern`,
`ImportedExternPointer`): the LookupTable adds 13 the shared descriptor never listed, and
REFUSES the two it offers that are left over, `SimulinkGlobal` and `Custom`. So the 17 are
not a superset of the 6, and neither widening nor narrowing the shared entry is available —
widening would offer `Custom` on a LookupTable, narrowing would break Parameter and Signal.
Both LUT classes override `options` through a per-class `$ref` instead.

What makes that override a REPLACEMENT is `resolveRef` in `schema/index.ts`: it merges
`{ ...base, ...override }`, one level deep. An `options` array in the override substitutes
for the base's array wholesale — no concat, no deep union. That is exactly what is wanted
here, and worth knowing before authoring an override that only means to ADD a value.

And the list is an **enforcement point, not a dropdown decoration**:
`trySetSchemaProperty` compares an incoming `editor: 'select'` write against `prop.options`
and returns a refusal on a miss. So a `Custom` that a `Simulink.Parameter` accepts is
refused on a LookupTable, and a `CompilerFlag` a LookupTable accepts stays refused on a
Parameter. A refusal does not half-apply — the bag is byte-identical afterwards.
Test: `test/lookupTableFlatProps.test.ts` (both directions; the Parameter assertions are
what prove the override is per-class — "fixing" this by editing the shared descriptor
would leave the LookupTable assertions green and fail those).

### A Storage Class write can be legal and still refused

`writeSourcePath` never synthesizes a missing sub-object, so a bag with no `CoderInfo` gets
a refusal ("Cannot set Storage Class (target property is absent)") even for a value in the
list. A newly created LookupTable is exactly that bag: unlike `ParameterNode.createDefault`,
`LookupTableNode.createDefault` seeds no CoderInfo — so the value displays (default 'Auto')
and is not yet writable, and the refusal says which.
Test: `test/lookupTableFlatProps.test.ts`.

## Allowed values (enums / comboboxes)

- `CoderInfo.StorageClass` → the 17 values MATLAB accepts on a LookupTable, in MATLAB's
  own order: `Auto`, `Model default`, `ExportedGlobal`, `ImportedExtern`,
  `ImportedExternPointer`, `BitField`, `Const`, `Volatile`, `ConstVolatile`, `Define`,
  `ImportedDefine`, `ExportToFile`, `ImportFromFile`, `FileScope`, `Struct`, `GetSet`,
  `CompilerFlag`. Measured on R2027a. Held in `classes/lookupTable.json` as a `$ref`
  override, and again as the test's own literal so the schema cannot both define and
  verify the list.

- `StructTypeInfo.DataScope` → `Auto` | `Exported` | `Imported`, also measured on R2027a.
  The descriptor carries NO `options` array for it, because it ships `editor: 'label'`:
  there is no write to validate, and an options list is only worth authoring where
  something enforces it.

All other sub-object enum properties (`Table.DataType`, `Breakpoints.DataType`, …) remain
read-only and unmodelled.

## Validation mirrored in code

- Name: validated by `DataNode.setProperty` → `validateMatlabName` (valid MATLAB
  identifier, unique in namespace, max 63 chars, not a keyword).
  Test: `test/parity/fidelity/typedef.fidelity.test.ts`.

- No additional validation for Description (any string accepted).

- `storageClass`: enforced by `trySetSchemaProperty` against the class's own 17-value
  `options` list, returning `{ error: true, reason: 'Invalid value for Storage Class' }` on
  a miss and `'Cannot set Storage Class (target property is absent)'` when the bag has no
  `CoderInfo`. This is the only one of the six with a write path at all.
  Test: `test/lookupTableFlatProps.test.ts`.

- The other five (`structTypeName`, `structTypeDataScope`, `structTypeHeaderFile`,
  `supportTunableSize`, `allowDifferentTableBpSizes`): nothing to mirror. Each is a
  read-only projection of the source bag — `editor: 'label'`, not `projected`, not a node
  field — so `trySetSchemaProperty` declines it and no value ever reaches a validator.

## Round-trip coverage

- JSON sldd: parse → verify className + read-only contract → serialize → re-parse.
  Test: `test/parity/fidelity/typedef.fidelity.test.ts` (json format loop).
- Binary sldd: same.
  Test: `test/parity/fidelity/typedef.fidelity.test.ts` (binary format loop).
- MATLAB gate: Description edit → MATLAB reads back. PASS.
- The six flat properties, in-process only: a LookupTable that carries them renders every
  value including the two nested paths; one that omits them renders each descriptor
  default; and both bags keep exactly the keys they arrived with on both save paths after
  the sheet has been rendered. A `storageClass` write lands at `CoderInfo.StorageClass` for
  all 17 values. **No MATLAB re-open gate was run for any of the six.**
  Test: `test/lookupTableFlatProps.test.ts`.

## Open questions / deferred

- **Description not a MATLAB property**: MATLAB's Simulink.LookupTable does NOT
  expose a top-level `Description` property (attempting `obj.Description` errors:
  "Unrecognized method, property, or field 'Description' for class
  'Simulink.LookupTable'"). Our node stores/restores Description via the JSON
  `_properties` for in-process round-trip fidelity, but the MATLAB gate cannot
  assert it via the standard property-read path. The field is preserved in the
  serialized file but is not accessible from the MATLAB API at the top level.

- **Table/Breakpoint array editing**: The numeric data in Table.Value and
  Breakpoints[].Value is complex multi-dimensional data that requires a dedicated
  editor UX. Not exposed via the scalar text editor; fully deferred.

- **Multiple breakpoint dimensions**: LookupTable supports 1-D to N-D tables with
  multiple Breakpoints sub-objects. Our parser preserves all of them during
  round-trip but does not expose array editing for any dimension.

- **No Table / Breakpoints PI group either**, beyond the array editing above: MATLAB builds
  one group PER breakpoint, dynamically, for an N-D table — that is the lookup-table
  specification editor, a whole Simulink dialog rather than a row. None of the six flat
  properties touches it, so both bags keep reaching the sheet through "Other", which is
  what keeps them visible while unmodelled.

- **`StructTypeInfo.DataScope` shipped read-only even though its allowed set is known.**
  MATLAB accepts `Auto` | `Exported` | `Imported` and nothing has verified the WRITE path
  for it — whether MATLAB reloads a dictionary in which we changed it, and what it does
  when the scope disagrees with the header-file setting. The rule this repo goes by is that
  an unlock is worth only as much as the rule that refuses a bad value, so the property is
  a label until that rule exists. Same reason `Simulink.ValueType`'s Dimensions is a label.

- **The two tunable-size switches are displayed but not editable.** `SupportTunableSize`
  and `AllowMultipleInstancesOfTypeToHaveDifferentTableBreakpointSizes` render in the
  Advanced group as read-only labels. Editability deferred for the same reason as
  DataScope: no verified write path.

- **The 63-character property name is abbreviated in the schema.**
  `AllowMultipleInstancesOfTypeToHaveDifferentTableBreakpointSizes` is keyed
  `allowDifferentTableBpSizes`, and its `label` carries the spelled-out name. So the key is
  short without hiding the property: `test/parity/matlab/schemaProps.test.ts` carries a
  path→key rename table, so the parity check still measures the abbreviation against
  MATLAB's own property name rather than losing sight of it.
