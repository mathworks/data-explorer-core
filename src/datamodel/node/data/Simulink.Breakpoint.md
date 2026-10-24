<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.Breakpoint — data-object fidelity

**Node class:** `BreakpointNode` (`src/datamodel/node/data/BreakpointNode.ts`)
**MATLAB class:** `Simulink.Breakpoint`
**Editable in our UI:** Name and Storage Class (the table's Storage Class column, a
17-value dropdown). Everything else is a read-only projection of the source bag. There is
no Description: MATLAB's class has none, so none is offered and an edit to one is refused
(see "Description" below).
**Verified against:** MATLAB R2027a (probe_class('Simulink.Breakpoint'))

## Overview

A Simulink.Breakpoint stores shared breakpoint data for use by multiple lookup
table blocks. It contains a Breakpoints sub-object (with Value, DataType,
Dimensions, Unit), CoderInfo, StructTypeInfo, and a SupportTunableSize flag. In our
UI the Breakpoint has no scalar value: the Value column is empty and not editable
(`valueEditable = false`). Its Property Inspector groups (from
`schema/classes/breakpoint.json`) are General (Name, Value, Data Type, Kind, Class),
Code Generation (Storage Class and the three StructTypeInfo keys under their
MATLAB labels Name / Data Scope / Header File) and Advanced (Support Tunable Size) — plus
the "Other" catch-all for what stays unmodelled. There is no Value Properties group,
because a Breakpoint has no `BreakpointsSpecification`. Every PI row but Name is a
label; Storage Class is editable in the TABLE, not the PI.

## Property table

| Property            | MATLAB type                       | SetAccess | Editable here | Serialized key (JSON / binary) | Editor | Allowed values / constraint |
|---------------------|-----------------------------------|-----------|---------------|--------------------------------|--------|-----------------------------|
| Name                | char                              | (entry)   | yes           | name / name                    | text   | Valid MATLAB identifier, unique in namespace |
| Description         | — (not a property)                | —         | no (refused)  | top-level key, only as read    | —      | A key the file already has is shown read-only and kept |
| Breakpoints         | Simulink.lookuptable.Breakpoint   | public    | no            | Breakpoints / Breakpoints      | —      | Sub-object (Value, DataType, Dimensions, Unit, FieldName) |
| CoderInfo           | Simulink.CoderInfo                | protected | no            | CoderInfo / CoderInfo          | —      | Sub-object |
| StructTypeInfo      | Simulink.lookuptable.StructTypeInfo | public  | no            | StructTypeInfo / StructTypeInfo | —     | Sub-object (DataScope, HeaderFileName, Name) |

The flat properties the schema surfaces individually (`schema/props/codeGen.json`,
`props/dataObject.json`) — the same five a `Simulink.LookupTable` has, minus its
table-instance switch. The left column is the MATLAB property; the schema key follows in
parentheses where the two differ.

| Property | MATLAB type | SetAccess | Editable here | Serialized path | Editor | Allowed values / constraint |
|----------|-------------|-----------|---------------|-----------------|--------|-----------------------------|
| CoderInfo.StorageClass (`storageClass`) | char (enum) | public | **yes** (table column) | CoderInfo.StorageClass | select | 17 values, per class — see "Allowed values" |
| StructTypeInfo.Name (`structTypeName`) | char | public | no (label) | StructTypeInfo.Name | label | Any string; default `''` |
| StructTypeInfo.DataScope (`structTypeDataScope`) | char (enum) | public | no (label) | StructTypeInfo.DataScope | label | 'Auto', 'Exported', 'Imported'; default 'Auto' |
| StructTypeInfo.HeaderFileName (`structTypeHeaderFile`) | char | public | no (label) | StructTypeInfo.HeaderFileName | label | Any string; default `''` |
| SupportTunableSize (`supportTunableSize`) | logical | public | no (label) | SupportTunableSize | label | true/false; blank when the file omits the key |

## Non-obvious behavior (the reason this doc exists)

### Value column

- A Breakpoint has no scalar "value" — `displayValue` returns `''` and
  `valueEditable` returns `false`. The entry appears in the table with an empty
  Value column. The breakpoint data lives in the nested Breakpoints sub-object.

### Description

- `Simulink.Breakpoint` has no Description property. In MATLAB R2027a (27.1.0.3409468,
  measured 2026-10-16) `isprop(Simulink.Breakpoint, 'Description')` is 0, and setting one
  fails with MATLAB:noPublicFieldForClass, "Unrecognized property 'Description' for class
  'Simulink.Breakpoint'." A dictionary MATLAB writes carries no top-level Description key,
  in either format. The `Breakpoints` sub-object has a Description of its own; that one is
  nested, unmodelled, and passes through as read.
- So none is offered, as for `Simulink.FunctionElement`: Description is not in
  `getProperties` or in the General group, `descriptionEditable` is false (the table cell
  has no editor), and `setProperty('Description', …)` is refused in MATLAB's words and
  leaves the entry unmodified. It used to be offered, accepted, and written as a top-level
  key.
- A top-level Description key the file already has (written by another tool, or by this
  package before the change) is shown read-only, in the Description column and in the
  Property Inspector's "Other" group, and is written back as read on both save paths.
  MATLAB opens such a file cleanly and ignores the key: measured in both formats with a key
  added by hand and with our former writer's output, 14 of 14 entries read and no warning.
  Test: `test/lutBreakpointNoDescription.test.ts`.

### Sub-objects

- Breakpoints.Value contains the actual numeric breakpoint array. This is not
  surfaced through the scalar editor — would require a dedicated array editor.
  Our UI preserves it during round-trip via the pass-through serialization.

### The five flat properties

This class used to declare NO schema at all — not even a layout — so everything MATLAB
models about its code generation reached the Property Inspector only as flattened "Other"
rows (`Other.CoderInfo.StorageClass`, `Other.StructTypeInfo.DataScope`, …). The five it now
declares behave exactly as a `Simulink.LookupTable`'s do; see that doc for the full account
of the nested `CoderInfo` / `StructTypeInfo` traversal, why an absent key is the common case
and renders each descriptor's own default, and why displaying a default must write nothing.

- **The group titles are MATLAB's, measured.** `+entry_adapter/+lut/Bp.m` reads the same
  `LutBase.getCodeGenDataDefinitionsPropAndItems` and
  `getCodeGenStructTypeDefinitionsPropAndItems` that `Lut.m` does, so the data-definition
  property and the three StructTypeInfo properties land in ONE `CodeGenerationGroup`, and
  `SupportTunableSize` sits alone in `AdvancedGroup`. MATLAB's PI resource catalog spells
  those "Code Generation" and "Advanced".

- **What a Breakpoint does NOT claim.** It has no
  `AllowMultipleInstancesOfTypeToHaveDifferentTableBreakpointSizes` — a LookupTable governs
  whether its instances may differ in table size, and a lone breakpoint set has no table to
  differ from — and no `BreakpointsSpecification`. Both are asserted ABSENT from the layout,
  not merely undisplayed: a copy-paste of `lookupTable.json` would otherwise give a
  Breakpoint two permanently blank rows.
  Test: `test/lookupTableFlatProps.test.ts`.

## Allowed values (enums / comboboxes)

- `CoderInfo.StorageClass` → the same 17 values as a `Simulink.LookupTable`, in MATLAB's
  own order: `Auto`, `Model default`, `ExportedGlobal`, `ImportedExtern`,
  `ImportedExternPointer`, `BitField`, `Const`, `Volatile`, `ConstVolatile`, `Define`,
  `ImportedDefine`, `ExportToFile`, `ImportFromFile`, `FileScope`, `Struct`, `GetSet`,
  `CompilerFlag`.

  **The reason is the shared adapter, not a separate measurement.**
  `LutBase.getCodeGenDataDefinitionsPropAndItems` is defined once and read by both `Lut.m`
  and `Bp.m`, and it takes its allowed values from the same `dataCache('StorageClass')` with
  no class-conditional narrowing — so the two classes share one list, and no evidence of a
  Breakpoint-specific set turned up. The 17 were measured on a LookupTable; they were not
  re-measured against a Breakpoint object.

  Like the LookupTable's, this list arrives through a per-class `$ref` override of the
  shared `storageClass` descriptor, and `resolveRef`'s merge is one level deep, so the
  override REPLACES the shared 6-value list rather than adding to it — which is what is
  wanted, since the 17 are not a superset (they include neither `SimulinkGlobal` nor
  `Custom`). `trySetSchemaProperty` validates against it, so it is an enforcement point:
  `Custom` is refused here and still accepted on a `Simulink.Parameter`. The LookupTable doc
  has the full rationale.
  Test: `test/lookupTableFlatProps.test.ts`.

- `StructTypeInfo.DataScope` → `Auto` | `Exported` | `Imported` (measured on R2027a). The
  descriptor carries no `options` array for it, because it ships `editor: 'label'` — there
  is no write to validate.

All other sub-object enum properties (`Breakpoints.DataType`, …) remain read-only and
unmodelled.

## Validation mirrored in code

- Name: validated by `DataNode.setProperty` → `validateMatlabName` (valid MATLAB
  identifier, unique in namespace, max 63 chars, not a keyword).
  Test: `test/parity/fidelity/typedef.fidelity.test.ts`.

- Description: refused outright by `BreakpointNode._noDescriptionRefusal`, which every setter and
  the session's edit ask first, with MATLAB's message, because the class has no such property.
  Test: `test/lutBreakpointNoDescription.test.ts`.

- `storageClass`: enforced by `trySetSchemaProperty` against this class's own 17-value
  `options` list — the only one of the five with a write path at all. A value outside the
  list is refused, and so is a legal value written into a bag that carries no `CoderInfo`
  (`writeSourcePath` never synthesizes a missing sub-object).
  Test: `test/lookupTableFlatProps.test.ts`.

- The other four (`structTypeName`, `structTypeDataScope`, `structTypeHeaderFile`,
  `supportTunableSize`): nothing to mirror. Each is a read-only projection of the source
  bag — `editor: 'label'`, not `projected`, not a node field — so `trySetSchemaProperty`
  declines it and no value ever reaches a validator.

## Round-trip coverage

- JSON sldd: parse → verify className + read-only contract → serialize → re-parse.
  Test: `test/parity/fidelity/typedef.fidelity.test.ts` (json format loop).
- Binary sldd: same.
  Test: `test/parity/fidelity/typedef.fidelity.test.ts` (binary format loop).
- MATLAB gate: none for Description, which MATLAB does not have. An earlier line here read
  "Description edit → MATLAB reads back. PASS.", but that gate asserted only the class.
  A file carrying a top-level Description key opens in MATLAB, and the key is ignored.
- The five flat properties, in-process only: a configured Breakpoint renders all five,
  including the two that travel through a nested sub-object, and a `storageClass` write
  lands at `CoderInfo.StorageClass`. **No MATLAB re-open gate was run for any of the five.**
  Test: `test/lookupTableFlatProps.test.ts`.

## Open questions / deferred

- **Breakpoint array editing**: The numeric data in Breakpoints.Value is a 1-D
  array that requires a dedicated editor UX. Not exposed via the scalar text
  editor; fully deferred.

- **SupportTunableSize is displayed but not editable**: it renders in the Advanced group as
  a read-only label. Editability deferred for the same reason as `StructTypeInfo.DataScope`
  below — no verified write path.

- **`StructTypeInfo.DataScope` shipped read-only even though its allowed set is known.**
  MATLAB accepts `Auto` | `Exported` | `Imported`, but nothing has verified the WRITE path:
  whether MATLAB reloads a dictionary in which we changed it, and what it does when the
  scope disagrees with the header-file setting. An unlock is worth only as much as the rule
  that refuses a bad value, so the property is a label until that rule exists.

- **TunableSizeName / TunableSizeValue**: Properties inside the Breakpoints
  sub-object for tunable-size configuration. Not exposed.
