<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.ConfigSet — data-object fidelity

**Node class:** `ConfigSetNode` (`src/datamodel/node/data/ConfigSetNode.ts`)
**MATLAB class:** `Simulink.ConfigSet`
**Editable in our UI:** no value editor (`valueEditable` explicitly returns `false`);
Name and Description are editable
**Verified against:** not probed (no params.sldd fixture instantiates this class)

## Overview

A Simulink.ConfigSet represents a model configuration set. In MATLAB, it holds
dozens of solver/code-generation/diagnostic settings. In our UI it appears as an
entry with an empty Value column and no value editor. The node is
primarily seen in `.slx` files (the SLX parser sets the `active` flag for the
model's current configuration) and occasionally in `.sldd` files.

The node exposes [PropName, PropDataType, PropDescription] in `getProperties()`, so
the table's Description column reads the node's `Description` field rather than
`toRow`'s fallback. It carries a `ConfigName` getter (a view of the entry `name` —
see below) and an optional `active` boolean set by the SLX parser. The icon switches
between `check_settings` (active) and `settings` (inactive) based on this flag.

The Property Inspector layout is schema-driven: one **General** group
(`schema/classes/configSet.json`) listing the five identity keys and then
`description`, which is where every other class file that carries a Description in
General puts it.

The node has a `createDefault` static for constructing minimal instances.

## Property table

| Property    | Editor | Serialized key           | Notes                         |
|-------------|--------|--------------------------|-------------------------------|
| Name        | text   | entry name AND _properties.Name | MATLAB identifier      |
| ConfigName  | —      | Name (in _properties)    | Getter over `name`; not stored separately |
| Description | textArea | Description (in _properties) | Any string; gated on save   |
| DataType    | label  | (className display)      | Read-only label               |

## Non-obvious behavior (the reason this doc exists)

### Name and ConfigName are one value

In a `.sldd` the entry name and the config set's own `Name` property are the same
string, and both parse paths (`ConfigSetNode.parse`, `ModelSectionNode.addConfigSetEntry`)
build the node with `_properties.Name` equal to the entry name. `ConfigName` is
therefore a getter over `name` rather than a second stored copy, and
`_getSerializedProperties` writes the live name into `props.Name` — the same
pattern `BaseBusElementNode.serializeValue` uses for a bus element.

This was previously a field assigned once in the constructor, which let the two
drift: renaming the entry updated `name` and the tree but serialized the stale
`ConfigName`, so the saved file kept the OLD name and the entry reverted on
reopen. Contrast `ConfigSetRefNode.SourceName`, which names an *external* config
set and correctly stays independent of a rename. Both behaviours are pinned in
`test/configSetSerialize.test.ts`.

### Description is read from the node field, not the schema descriptor

`description` is a key in `schemaBridge`'s `ATOM_BY_KEY`, and `resolvePropForKey`
prefers the atom over the class's schema descriptor — so the layout row resolves to
`PropDescription`, which reads the node's `Description` **field**, never the
descriptor's `sourcePath`. The constructor used to drop its `props` argument
entirely, which left the field looking declared while not existing: `BaseNode`
declares `Description?: string` for every node, and a TypeScript `field?: string`
that is never assigned emits nothing at runtime.

Adding `description` to `configSet.json` alone would therefore have shipped the exact
defect `Simulink.ValueType` shipped — see its "The value properties were modelled but
unreachable" section for the mechanism. The fix is the constructor's assignment, not
the layout. `test/schemaLayoutResolvable.test.ts` now guards the whole class of bug at
the seam, rather than per class after the fact.
Test: `test/configSetSchemaProps.test.ts` — the first assertion of each block is that
the value DISPLAYS, in both panes, not that a row exists.

### Description is gated on save; Name is not

`_serializedOverrides` writes `Name` unconditionally — a config set MATLAB can load
has to be able to say what it is called, and because the key is a view of `name`, a
renamed entry saves under the new name on both paths. `Description` goes through
`SimulinkObjectNode._gatedProps`, which keeps the key only when the FILE already
carried it or the node now holds a value. A config set whose file never carried a
Description must not gain an empty one, or opening a dictionary and saving it with no
edits produces a diff in source control. Same terms as every other Description in this
cluster (AliasType, Breakpoint, CustomObject, LookupTable, NumericType).

### The properties MATLAB's Property Inspector shows that we do not model

MATLAB models four more parameters a config set's inspector shows — `StartTime`,
`StopTime`, `SystemTargetFile`, `SourceLocation` — and none of them is modeled here.
`test/configSetSchemaProps.test.ts` pins the omission together with the measurement
that decided it (the config-set part of every era fixture in
`test/parity/artifacts/slx_layouts/`). For the first three, three reasons at once: a
value at its default is not written at all, in any era; the R2026b+ JSON nests them
inside a heterogeneous `Simulink.ConfigComponent` array keyed by `_object_class`,
which a fixed schema `sourcePath` cannot address; and one era (R2025a XML) carries
none of the three. A layout key for any of them would render a permanently blank row
on some era of every real file — the defect above, not a step towards parity.
`SourceLocation` is out for a different reason, recorded at
`src/datamodel/parser/SlxParser.ts:59-62`: it survives an export as the literal
`Base Workspace` even when the set came from a data dictionary, so on a file we might
be handed it is not a fact about the model.

Not modeling them is not hiding them: the PI's "Other" catch-all still lists whichever
of them a file happens to carry, which is what makes a blank modeled row the strictly
worse option.

## Read-only / no-fixture status

- `valueEditable` is explicitly `false` in the source code.
- `displayValue` returns `''`.
- No `params.sldd` fixture instantiates this class (it appears in `.slx` models
  parsed via the SLX parser).
- **Contract-lock**: assert `valueEditable === false`, className, `displayValue === ''`,
  the icon, and `getProperties()` === [Name, DataType, Description] via `createDefault`
  in `test/parity/fidelity/hostnodes.fidelity.test.ts`.
- Description is editable even so: `descriptionEditable` is `BaseNode`'s default `true`,
  which is a different question from `valueEditable` — a config set with no scalar value
  can still be described.

## Validation mirrored in code

- Name: validated by `DataNode.setProperty` → `validateMatlabName` (valid MATLAB
  identifier, unique in namespace, max 63 chars, not a keyword).

- Description: nothing to mirror — any string is accepted, and the string editor cannot
  deliver the non-string MATLAB would reject.

## Round-trip coverage

- Both save paths (`_getSerializedProperties` for the compressed-binary `.sldd`,
  `serializeValue` for the JSON of an uncompressed-text one), in both directions and in
  every state the gate distinguishes: a file with no Description gains none; a file's
  Description comes straight back; a Description typed onto an entry that had none is
  written; and the two paths name the same keys.
  Test: `test/configSetSchemaProps.test.ts`.
- Every unmodeled property in the bag is re-emitted untouched — a config set holds dozens
  of solver parameters we do not model, and a save that dropped them would lose most of
  the entry. Same test.
- The `Name`/rename ownership question: `test/configSetSerialize.test.ts`.
- Two-save-path agreement for the whole cluster: `test/absentPropertyWriteBack.test.ts`.
- MATLAB re-open gate: NOT run for the Description edit — see below.

## Open questions / deferred

- **MATLAB re-open gate for the Description edit — NOT RUN.** The edit is verified
  in-process (serialize → re-parse) only. The sibling classes with the same gated
  Description each record a PASS of their own (`Simulink.Breakpoint`,
  `Simulink.LookupTable`, `Simulink.NumericType`, `Simulink.ValueType`); this class has
  none, and no fixture instantiates it, so there is nothing here to cite.

- **Active detection on SLDD path**: the `active` flag is only set by the SLX
  parser; on the SLDD path it is always `undefined` (treated as inactive). This is
  correct for standalone `.sldd` files.
- **Fixture generation**: deferred.
