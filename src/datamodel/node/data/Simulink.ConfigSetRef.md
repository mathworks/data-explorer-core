<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.ConfigSetRef — data-object fidelity

**Node class:** `ConfigSetRefNode` (`src/datamodel/node/data/ConfigSetRefNode.ts`)
**MATLAB class:** `Simulink.ConfigSetRef`
**Editable in our UI:** no value editor (`valueEditable` explicitly returns `false`);
Name and Description are editable, SourceName is read-only
**Verified against:** not probed (no params.sldd fixture instantiates this class)
**Measured, not matched:** MATLAB's own inspector adapter
(`+entry_adapter/ConfigSetRef.m`) groups and labels the source differently — a
deliberate divergence, recorded below.

## Overview

A Simulink.ConfigSetRef is a reference to an external configuration set (stored in
a data dictionary). It carries a `SourceName` string identifying which configuration
set it points to. Like ConfigSet, it is primarily encountered in `.slx` files.

The node exposes [PropName, PropDataType, PropDescription] in `getProperties()`, so the
table's Description column reads the node's `Description` field rather than `toRow`'s
fallback. `SourceName` is deliberately NOT there: it reaches the Property Inspector as a
schema descriptor and has no table column. The `active` flag (set by the SLX parser)
drives the icon: `check_configurationReference` (active) vs. `configurationReference`
(inactive).

The Property Inspector layout is schema-driven: one **General** group
(`schema/classes/configSetRef.json`) listing the five identity keys, then `sourceName`,
then `description`.

The node has a `createDefault` static for constructing minimal instances (with an
empty `SourceName`).

## Property table

| Property    | Editor | Serialized key             | Notes                       |
|-------------|--------|----------------------------|-----------------------------|
| Name        | text   | entry name                 | MATLAB identifier           |
| SourceName  | label  | SourceName (in _properties)| Name of referenced config; read-only, PI row only (no table column); written unconditionally |
| Description | textArea | Description (in _properties) | Any string; gated on save |
| DataType    | label  | (className display)        | Read-only label             |

## Non-obvious behavior (the reason this doc exists)

### SourceName reaches the PI as a schema descriptor, not a node atom

`sourceName` is not an `ATOM_BY_KEY` key, so its row resolves to the schema descriptor
(declared in `schema/props/core.json`, listed for this class by `configSetRef.json`'s
`props`) and hydrates `serial._properties.SourceName` rather than reading
`node.SourceName`. That is sound only while the row is read-only: an edit lands on the
field, so the row would go on showing the untouched bag. If SourceName ever becomes
editable it has to move to an atom — the divergence `ValueTypeNode.getPILayout` records
at length.
`test/configSetSchemaProps.test.ts` asserts the hydrated value and the field AGREE,
which is the assertion that fails to say so.

One fixed `sourcePath: "SourceName"` is enough despite the era-varying spelling
(`SourceName` in R2021a and later, `WSVarName` in R2018a and earlier) because the
normalization happens upstream, before any node is built: `SlxParser.configSetIdentity`
reads `props.SourceName ?? props.WSVarName ?? ''` into `ParsedConfigSet.sourceName`
(`src/datamodel/parser/SlxParser.ts:192` for the R2026b+ JSON layout, `:211` for every
XML era), and `ModelSectionNode.addConfigSetEntry` writes it back as `props.SourceName`
(`src/datamodel/node/container/ModelSectionNode.ts:69-71`).

### SourceName is read-only, where MATLAB offers a combobox

MATLAB's `SourceName` is an editable combobox whose allowed values come from
`configset.internal.util.getReferenceableConfigSets(csr)` — a query against the live
model, which we cannot answer from a file. Offering free text where MATLAB offers a
constrained list would be an unlock without a rule that refuses a bad value, so the
descriptor is `editor: "label"`. It is still saved unconditionally: a reference that
cannot say what it points at is not a reference, so the key is written even as the
empty string a half-built entry carries. Contrast a `ConfigSet`'s `Name`, which is a
view of the entry name — a rename must move that and must NOT touch this.
Test: `test/configSetSerialize.test.ts` owns the ownership question;
`test/configSetSchemaProps.test.ts` pins the row's label and its `editable === false`.

### Source Name sits in General, not in MATLAB's own group — deliberately

MATLAB's `+entry_adapter/ConfigSetRef.m` puts `SourceName` in a group titled
**Referenced Configuration**, alongside `SourceLocation` and `SourceResolved`, and
labels the row just **"Name"** — a label that only reads correctly because of the group
title. We put `sourceName` in **General**, labelled **"Source Name"**. Two reasons.
First, we model neither group-mate: `SourceLocation` is out for the reason recorded at
`src/datamodel/parser/SlxParser.ts:59-62` (it exports as the literal `Base Workspace`
even when the set came from a data dictionary, so it is not a fact about the file), and
`SourceResolved` is live-model resolution state no file carries — so matching MATLAB
would mean a group of exactly one row. Second, "Source Name" in General conveys what
"Name" under that group title conveys.

### Description

Same field, same mechanism, same gate as a `Simulink.ConfigSet`: the `description`
layout key resolves to the `PropDescription` atom, which reads the node's `Description`
**field**, not the descriptor's `sourcePath`, and the constructor used to drop its
`props` argument entirely — see `Simulink.ConfigSet.md`'s "Description is read from the
node field, not the schema descriptor" and, for the mechanism in full,
`Simulink.ValueType.md`'s "The value properties were modelled but unreachable".
`Description` is gated by `SimulinkObjectNode._gatedProps` so a reference whose file
never carried one does not gain an empty one on save.
Test: `test/configSetSchemaProps.test.ts`; the class of bug is guarded at the seam by
`test/schemaLayoutResolvable.test.ts`.

## Read-only / no-fixture status

- `valueEditable` is explicitly `false` in the source code.
- `displayValue` returns `''`.
- No `params.sldd` fixture instantiates this class.
- **Contract-lock**: assert `valueEditable === false`, className, `displayValue === ''`,
  the icon, and `getProperties()` === [Name, DataType, Description] via `createDefault`
  in `test/parity/fidelity/hostnodes.fidelity.test.ts`.
- Description is editable even so: `descriptionEditable` is `BaseNode`'s default `true`,
  which is a different question from `valueEditable`.

## Validation mirrored in code

- Name: validated by `DataNode.setProperty` → `validateMatlabName` (valid MATLAB
  identifier, unique in namespace, max 63 chars, not a keyword).

- Description: nothing to mirror — any string is accepted.

- SourceName: none, and none to mirror — the row is read-only, so no value of ours ever
  reaches it. MATLAB's constraint is a live-model query (see above), which is why.

## Round-trip coverage

- Both save paths (`_getSerializedProperties` for the compressed-binary `.sldd`,
  `serializeValue` for the JSON of an uncompressed-text one), in both directions and in
  every state the Description gate distinguishes, plus `SourceName` written
  unconditionally in each of them, plus a check that the two paths name the same keys.
  Test: `test/configSetSchemaProps.test.ts`.
- Every unmodeled property in the bag is re-emitted untouched. Same test.
- Rename must not touch `SourceName`: `test/configSetSerialize.test.ts`.
- Two-save-path agreement for the whole cluster: `test/absentPropertyWriteBack.test.ts`.
- MATLAB re-open gate: NOT run for the Description edit — see below.

## Open questions / deferred

- **MATLAB re-open gate for the Description edit — NOT RUN.** Verified in-process
  (serialize → re-parse) only; no fixture instantiates this class, and no PASS is
  recorded for it anywhere in the repo. Same status as `Simulink.ConfigSet`.

- **SourceName editing**: would need the allowed set MATLAB gets from
  `getReferenceableConfigSets`, which is a live-model query. If it is ever unlocked, the
  row must move from the schema descriptor to a node atom first (see above).

- **Fixture generation**: deferred.
