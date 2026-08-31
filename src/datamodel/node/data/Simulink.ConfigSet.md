<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.ConfigSet — data-object fidelity

**Node class:** `ConfigSetNode` (`src/datamodel/node/data/ConfigSetNode.ts`)
**MATLAB class:** `Simulink.ConfigSet`
**Editable in our UI:** no (`valueEditable` explicitly returns `false`)
**Verified against:** not probed (no params.sldd fixture instantiates this class)

## Overview

A Simulink.ConfigSet represents a model configuration set. In MATLAB, it holds
dozens of solver/code-generation/diagnostic settings. In our UI it appears as a
read-only entry with an empty Value column and no inline editor. The node is
primarily seen in `.slx` files (the SLX parser sets the `active` flag for the
model's current configuration) and occasionally in `.sldd` files.

The node exposes [PropName, PropDataType] in `getProperties()`. It carries a
`ConfigName` getter (a view of the entry `name` — see below) and an optional
`active` boolean set by the SLX parser. The icon switches between
`check_settings` (active) and `settings` (inactive) based on this flag.

The node has a `createDefault` static for constructing minimal instances.

## Property table

| Property    | Editor | Serialized key           | Notes                         |
|-------------|--------|--------------------------|-------------------------------|
| Name        | text   | entry name AND _properties.Name | MATLAB identifier      |
| ConfigName  | —      | Name (in _properties)    | Getter over `name`; not stored separately |
| DataType    | label  | (className display)      | Read-only label               |

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

## Read-only / no-fixture status

- `valueEditable` is explicitly `false` in the source code.
- `displayValue` returns `''`.
- No `params.sldd` fixture instantiates this class (it appears in `.slx` models
  parsed via the SLX parser).
- **Contract-lock**: assert `valueEditable === false` and className via `createDefault`
  in `test/parity/fidelity/hostnodes.fidelity.test.ts`.

## Open questions / deferred

- **Active detection on SLDD path**: the `active` flag is only set by the SLX
  parser; on the SLDD path it is always `undefined` (treated as inactive). This is
  correct for standalone `.sldd` files.
- **Fixture generation**: deferred.
