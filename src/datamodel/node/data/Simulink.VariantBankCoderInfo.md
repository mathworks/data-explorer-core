<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.VariantBankCoderInfo — data-object fidelity

**Node class:** `VariantBankCoderInfoNode` (`src/datamodel/node/data/VariantBankCoderInfoNode.ts`)
**MATLAB class:** `Simulink.VariantBankCoderInfo`
**Editable in our UI:** no. The Value column is read-only, and a Value edit is refused: the
MATLAB class has no Value.
**Verified against:** MATLAB R2027a (27.1.0.3409468), 2026-10-16, and the entry `vbciD` MATLAB
wrote into `test/fixtures/classes_r2027a_{text,binary}.sldd` (`make_classes_r2027a.m`)

## Overview

A Simulink.VariantBankCoderInfo stores code-generation settings for variant banks. MATLAB's
class has five properties: HeaderFile, DefinitionFile, PreStatement, PostStatement and
Qualifier. All five are char, and all default to `''` except Qualifier, which defaults to
`'None'`. A dictionary holds the object as a saveobj envelope of those five, in both formats,
with nothing beside it. None of the five is modelled as a property of the node yet; the
envelope is written back as it was read.

The node lists PropName, PropValue and PropDataType. PropValue stays as a read-only column, for
a Value key a file already carries (see below). `createDefault` makes the envelope MATLAB writes
for a new entry, with its fields, order and defaults measured from a MATLAB-written dictionary,
and nothing beside it.

## Property table

| Property   | Editor | Serialized key           | Notes                         |
|------------|--------|--------------------------|-------------------------------|
| Name       | text   | entry name               | MATLAB identifier             |
| Value      | none   | written back as read     | Not a property of the class; shown only where the file carries one |
| DataType   | label  | (className display)      | Read-only label               |

## Value: the class has none

Measured in R2027a: `isprop(Simulink.VariantBankCoderInfo, 'Value')` is 0, and setting one fails
with "Unrecognized property 'Value' for class 'Simulink.VariantBankCoderInfo'."

This node used to offer one anyway. The cell took a text editor (`valueEditable` was inherited,
and true), `setProperty('Value', …)` returned true, and both save paths wrote the text beside
the envelope: `_properties: {Value: …}` in a text dictionary, `<P Name="Value" Class="char">…</P>`
after the saveobj `P` in a binary one. MATLAB opens both files with no error and no warning,
reads every entry, and builds an object with no Value, its Qualifier still `'None'`; the value
is silently dropped. So the edit was accepted, saved, and had no effect. Every MATLAB-written
entry also showed `''`, which implies a char value the class does not have.

Following MATLAB (the 2026-10-16 ruling, group E, C-169), as `Simulink.VariantBank` does (C-168)
and a bus element does (`BaseBusElementNode`):

- `valueEditable` is false, so neither the table nor the Property Inspector offers an editor.
- `setProperty('Value', …)` is refused: "'<name>' is a Simulink.VariantBankCoderInfo, which has
  no Value, so none can be set on it." An entry still in an encoded stream keeps that refusal's
  reason.
- `_serializedOverrides` is empty, so no save writes a Value. A Value key a file already carries
  (only ever this package's) passes through `_mergeProps` unchanged, and is shown quoted.
- An entry whose file carries no Value key, which is every one MATLAB writes, shows an empty
  cell.

Locked by `test/variantBankNoValue.test.ts` (both formats, and `createDefault`) and the
`READ_ONLY` row of `test/variantLeafNodes.test.ts`. The envelope's fields are pinned by
`test/newEntryEnvelopeBothFormats.test.ts`, and the property list by
`test/parity/fidelity/hostnodes.fidelity.test.ts`.

## Open questions / deferred

- **The class's own fields** (C-169 option (b)): show and edit HeaderFile, DefinitionFile,
  PreStatement, PostStatement and Qualifier out of the envelope. The MATLAB-written fixtures
  this was waiting for now exist (`vbciD` above).
